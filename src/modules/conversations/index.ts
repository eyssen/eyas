// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createConversationService, generateTaskId } from './conversation-service.js'
import { createLazyGateway } from '@modules/model/lazy-gateway.js'

export const conversationsModule: EyasModule = {
  id: 'conversations',
  name: 'Conversations',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Persistent conversations with AI providers — streaming, context tracking',
  dependencies: ['model'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)

    // Add task_id column if not present
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN task_id TEXT`)) } catch { /* already exists */ }

    // Add attachments column to messages if not present
    try { ctx.db.run(sql.raw(`ALTER TABLE conversation_messages ADD COLUMN attachments TEXT DEFAULT '[]'`)) } catch { /* already exists */ }

    // Add SDK session ID for Claude Code conversation continuity
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN sdk_session_id TEXT`)) } catch { /* already exists */ }

    // Agent lifecycle columns
    const agentColumns = [
      `ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'simple'`,
      `ALTER TABLE conversations ADD COLUMN agent_id TEXT`,
      `ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT`,
      `ALTER TABLE conversations ADD COLUMN goal_description TEXT`,
      `ALTER TABLE conversations ADD COLUMN complexity TEXT`,
      `ALTER TABLE conversations ADD COLUMN total_cost_usd REAL DEFAULT 0`,
    ]
    for (const ddl of agentColumns) {
      try { ctx.db.run(sql.raw(ddl)) } catch { /* already exists */ }
    }

    // Extended Thinking config: 'off' | 'on' | 'auto', with optional budget
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN thinking TEXT NOT NULL DEFAULT 'off'`)) } catch { /* already exists */ }
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN thinking_budget INTEGER`)) } catch { /* already exists */ }

    // Reasoning effort level: 'low' | 'medium' | 'high' | 'max' (NULL = off)
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN effort TEXT`)) } catch { /* already exists */ }

    // Orchestration mode: 'solo' | 'auto' | 'deep' (NULL = auto)
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN orchestration TEXT`)) } catch { /* already exists */ }

    // Per-conversation voice scope override ('internal' | 'external' | NULL).
    // Read by the active-voice resolver; must exist on a fresh production DB.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN voice_scope_override TEXT`)) } catch { /* already exists */ }

    // Multi-version code search pin (JSON SearchContextSpec).
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN search_context TEXT`)) } catch { /* already exists */ }

    // Coding workspace: JSON string[] of absolute paths (first = primary cwd).
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN working_directories TEXT`)) } catch { /* already exists */ }

    // God Mode flag — independent of orchestration (solo/auto/deep).
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN god_mode INTEGER NOT NULL DEFAULT 0`)) } catch { /* already exists */ }

    // Backfill existing conversations without task_id
    const noTaskId = (ctx.db as any).all(sql`SELECT id FROM conversations WHERE task_id IS NULL`) as any[]
    for (const row of noTaskId) {
      const taskId = generateTaskId()
      ctx.db.run(sql`UPDATE conversations SET task_id = ${taskId} WHERE id = ${row.id}`)
    }

    // Create unique index on task_id
    ctx.db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_task_id ON conversations(task_id)`)

    // One-time normalization: sub-conversations used to be written with mode
    // 'agent', a literal outside the ConversationMode union that no consumer
    // understands — it made every existing child invisible to the bot-executor
    // (`mode IN ('managed','autonomous')`). New rows are written as 'managed';
    // this repairs the old ones (D11).
    try { ctx.db.run(sql`UPDATE conversations SET mode = 'managed' WHERE mode = 'agent'`) } catch { /* pre-migration schema */ }

    // Agent lifecycle indexes
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversations(parent_conversation_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_conv_mode ON conversations(mode)`)

    const conversationService = createConversationService(ctx.db, ctx.bus)
    ctx.conversations = conversationService

    // D14 — chat:<conversationId> ownership resolver for the WS topic ACL.
    ;(ctx as any).wsAcl?.registerResolver('chat', (userId: string, conversationId: string) =>
      conversationService.ownsConversation(conversationId, userId))

    ctx.logger.info('Conversations module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createConversationRoutes } = await import('./routes.js')
    // Lazy getters — these modules may not be initialized yet at route registration time
    const getDocuments = () => (ctx as any).documents as import('@modules/documents/document-service').DocumentService | undefined
    const getAgentRunner = () => (ctx as any).agents?.runner as ReturnType<typeof import('@modules/agent/agent-runner').createAgentRunner> | undefined
    const getToolRegistry = () => (ctx as any).tools?.registry as import('@modules/tools/tool-registry').ToolRegistry | undefined
    const getDecisionEngine = () => (ctx as any).decisionEngine as import('@modules/model/routing/decision-engine').DecisionEngine | undefined
    const getAssembler = () => (ctx as any).promptAssembler ?? undefined
    const getSkills = () => (ctx as any).skills as { loader: any; matcher: any } | undefined
    const getContextRecorder = () => (ctx as any).contextRecorder as import('@modules/observability/context-recorder').ContextRecorder | undefined

    // Memory lifecycle hooks — wired into conversation routes for automatic fact extraction
    let memoryHooks: import('./routes.js').ConversationMemoryHooks | undefined
    const memory = (ctx as any).memory as import('@modules/memory/memory-service').MemoryService | undefined
    if (memory?.episodic) {
      const { createMemoryLifecycle } = await import('@modules/memory/consolidation/memory-lifecycle.js')
      memoryHooks = createMemoryLifecycle({ episodic: memory.episodic })
      ctx.logger.info('Memory lifecycle hooks wired into conversations')
    }

    const getBoard = () => (ctx as any).board as { projects: { getWithStages(id: string): { defaultAgentId: string | null; stages: { id: string; isClosed: boolean; sortOrder: number }[] } | null } } | undefined

    // Lazy gateway: privacy + observability replace ctx.model during their own
    // onStart, which may run after this one. Capturing it by value pinned the
    // raw gateway, so the no-tools chat fallback bypassed tracing (and would
    // now bypass failover too). Same pattern as agent/index.ts.
    const lazyGateway = createLazyGateway(() => ctx.model)

    // F2 T9 — config `model.pricing` override, read fresh on every access.
    const getPricingOverrides = () => (ctx.config as any)?.model?.pricing

    // Lazy team auto-propose — agent module registers orchestrator + teamSessions
    // after conversations routes may already exist.
    const getTeamPropose = () => {
      const agents = (ctx as any).agents as
        | {
            orchestrator?: import('./team-auto-propose.js').TeamProposeDeps['orchestrator']
            teamSessions?: import('./team-auto-propose.js').TeamProposeDeps['teamSessions']
          }
        | undefined
      if (!agents?.orchestrator || !agents?.teamSessions) return undefined
      return {
        orchestrator: agents.orchestrator,
        teamSessions: agents.teamSessions,
        bus: ctx.bus,
        wsBroadcast: (topic: string, message: unknown) => {
          try {
            ;(ctx as any).wsRegistry?.broadcast(topic, message)
          } catch {
            /* WS optional at boot */
          }
        },
        logger: ctx.logger,
      }
    }

    const getGodMode = () => {
      const orch =
        (ctx as any).godMode ??
        (ctx as any).agents?.godModeOrchestrator
      if (!orch?.start) return undefined
      return {
        orchestrator: orch as import('@modules/agent/god-mode/orchestrator.js').GodModeOrchestrator,
        enabled: ctx.config.agent?.godModeEnabled !== false,
        limits: {
          min: ctx.config.agent?.godModeMinParticipants ?? 2,
          max: ctx.config.agent?.godModeMaxParticipants ?? 5,
        },
        getLiveKeys: async () => {
          const { collectGodModeLiveKeys } = await import('@modules/agent/god-mode/index.js')
          return collectGodModeLiveKeys(ctx as any)
        },
        pricing: (ctx.config as any)?.model?.pricing,
        broadcast: (topic: string, message: unknown) => {
          try {
            ;(ctx as any).wsRegistry?.broadcast(topic, message)
          } catch {
            /* WS optional at boot */
          }
        },
      }
    }

    createConversationRoutes(
      ctx.http,
      ctx.conversations,
      lazyGateway,
      ctx.providerConfig,
      getDocuments,
      getAgentRunner,
      getToolRegistry,
      getDecisionEngine,
      getAssembler,
      getSkills,
      memoryHooks,
      getBoard,
      getPricingOverrides,
      getTeamPropose,
      getGodMode,
      getContextRecorder,
    )
    ctx.logger.info('Conversations module started')
  },

  async onStop() {},
}
