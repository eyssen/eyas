// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createConversationService, generateTaskId } from './conversation-service.js'
import { createLazyGateway } from '@modules/model/lazy-gateway.js'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { resolveInstance } from '@core/instance.js'
import { migrateLegacyWorkspaces } from './workspace-migration.js'
import { migrateLegacyThinkingToEffort } from './effort-migration.js'

function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Boot migration: move conversation workspaces from <dataDir>/workspaces to
 * the workspaces root when that is somewhere else (a data dir inside a git
 * checkout), and repoint the conversations that used them. Runs only when the
 * database being migrated is the instance's own — a context on a scratch or
 * in-memory database (tests, tools) must never move the instance's folders.
 */
export function relocateLegacyWorkspaces(ctx: Pick<ModuleContext, 'db' | 'logger'>): void {
  try {
    const main = ctx.db.all<{ name: string; file: string }>(sql`PRAGMA database_list`).find((d) => d.name === 'main')
    if (!main?.file) return
    const instance = resolveInstance({ ensureDirs: false })
    const rel = relative(realOrResolved(instance.dataDir), realOrResolved(main.file))
    if (rel.startsWith('..') || isAbsolute(rel)) return
    migrateLegacyWorkspaces({
      db: ctx.db,
      legacyRoot: join(instance.dataDir, 'workspaces'),
      newRoot: instance.workspacesDir,
      logger: ctx.logger,
    })
  } catch (err) {
    ctx.logger.warn({ err: String(err) }, 'conversations: relocating legacy workspaces failed — conversations keep their current folders')
  }
}

/**
 * One-time-in-effect, idempotent boot migration: databases created before
 * continuity became EYAS-replay-only carry a `conversations.sdk_session_id`
 * column holding host CLI session ids. Nothing reads or writes it any more;
 * the stale ids are cleared so no host session reference survives. A database
 * without the column (every fresh install) is left untouched.
 */
export function clearLegacyProviderSessionIds(ctx: Pick<ModuleContext, 'db' | 'logger'>): void {
  try {
    const columns = ctx.db.all<{ name: string }>(sql`PRAGMA table_info(conversations)`)
    if (!columns.some((c) => c.name === 'sdk_session_id')) return
    ctx.db.run(sql.raw(`UPDATE conversations SET sdk_session_id = NULL WHERE sdk_session_id IS NOT NULL`))
  } catch (err) {
    ctx.logger.warn({ err }, 'conversations: clearing legacy provider session ids failed')
  }
}

export const conversationsModule: EyasModule = {
  id: 'conversations',
  name: 'Conversations',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Persistent conversations with AI providers — streaming, context tracking',
  dependencies: ['model', 'tools'],
  frontend: {
    widgets: [{ id: 'conversations.recent', titleKey: 'home.widget.conversations.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, created_at TEXT NOT NULL)`)

    // Add task_id column if not present
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN task_id TEXT`)) } catch { /* already exists */ }

    // Add attachments column to messages if not present
    try { ctx.db.run(sql.raw(`ALTER TABLE conversation_messages ADD COLUMN attachments TEXT DEFAULT '[]'`)) } catch { /* already exists */ }

    // Per-turn metadata of an assistant reply (JSON TurnMeta: outcome, usage,
    // cost source, binding, effort). The single additive block for this
    // column; NULL on user messages and on replies stored before it existed.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversation_messages ADD COLUMN turn_meta TEXT`)) } catch { /* already exists */ }

    // Continuity is EYAS replay only, so no provider session id is stored any
    // more. Databases from before that keep the legacy sdk_session_id column
    // (inert: nothing reads or writes it); clear the stale host session ids it
    // still holds. Fresh databases never get the column.
    clearLegacyProviderSessionIds(ctx)

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

    // Model binding (D3): 'pinned' | 'auto' | 'inherit' (model/binding.ts).
    // The single additive block for this column. The UPDATE sits inside the
    // same try, so it runs exactly once — in the boot that adds the column —
    // and never flips a row a user later set: agent-bound conversations and
    // sub-conversations follow their colleague ('inherit'); agentless ones
    // keep their pair ('pinned'; one without a pair fixes the default on its
    // next turn).
    try {
      ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN model_binding TEXT NOT NULL DEFAULT 'pinned'`))
      ctx.db.run(sql.raw(`UPDATE conversations SET model_binding = 'inherit' WHERE agent_id IS NOT NULL OR parent_conversation_id IS NOT NULL`))
    } catch { /* already exists */ }
    // 1 = the user chose the stored pair in the model picker (H5): a pinned
    // conversation then fails closed when that pair is unavailable instead of
    // answering with the install default. Every existing row carries a pair
    // the system stamped, so it starts at 0.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN model_user_chosen INTEGER NOT NULL DEFAULT 0`)) } catch { /* already exists */ }

    // Legacy Extended Thinking columns ('off' | 'on' | 'auto' + a budget).
    // Migration-only: read once by migrateLegacyThinkingToEffort below.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN thinking TEXT NOT NULL DEFAULT 'off'`)) } catch { /* already exists */ }
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN thinking_budget INTEGER`)) } catch { /* already exists */ }

    // Reasoning effort: a rung of the canonical ladder (model/reasoning/ladder.ts); NULL = Auto.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN effort TEXT`)) } catch { /* already exists */ }

    // Orchestration mode: 'solo' | 'auto' | 'deep' (NULL = auto)
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN orchestration TEXT`)) } catch { /* already exists */ }

    // Off-ladder effort values → Auto; a legacy thinking budget → its effort
    // level (idempotent — a converted row no longer matches).
    migrateLegacyThinkingToEffort(ctx.db, ctx.logger)

    // Per-conversation voice scope override ('internal' | 'external' | NULL).
    // Read by the active-voice resolver; must exist on a fresh production DB.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN voice_scope_override TEXT`)) } catch { /* already exists */ }

    // Multi-version code search pin (JSON SearchContextSpec).
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN search_context TEXT`)) } catch { /* already exists */ }

    // Coding workspace: JSON string[] of absolute paths (first = primary cwd).
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN working_directories TEXT`)) } catch { /* already exists */ }

    // God Mode flag — independent of orchestration (solo/auto/deep).
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN god_mode INTEGER NOT NULL DEFAULT 0`)) } catch { /* already exists */ }
    // F1 — per-conversation brand override. Null means "inherit from the
    // project"; the resolver only treats a non-null value as an override.
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN design_system_id TEXT`)) } catch { /* already exists */ }
    try { ctx.db.run(sql.raw(`ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'`)) } catch { /* already exists */ }
    try {
      ctx.db.run(sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_home_thread ON conversations(user_id, agent_id) WHERE kind = 'home' AND agent_id IS NOT NULL`,
      ))
    } catch { /* older SQLite without partial indexes — home-thread lookup still works */ }

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

    // Workspaces leave a data dir that sits inside a git checkout.
    relocateLegacyWorkspaces(ctx)

    const conversationService = createConversationService(ctx.db, ctx.bus, ctx.logger)
    ctx.conversations = conversationService

    // D14 — chat:<conversationId> ownership resolver for the WS topic ACL.
    ;(ctx as any).wsAcl?.registerResolver('chat', (userId: string, conversationId: string) =>
      conversationService.ownsConversation(conversationId, userId))

    ctx.logger.info('Conversations module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createSkillDecisionStore, ensureSkillDecisionSchema } = await import('./skill-gate.js')
    ensureSkillDecisionSchema(ctx.db)
    const skillDecisions = createSkillDecisionStore(ctx.db)

    const { createConversationRoutes } = await import('./routes.js')
    // Lazy getters — these modules may not be initialized yet at route registration time
    const getDocuments = () => (ctx as any).documents as import('@modules/documents/document-service').DocumentService | undefined
    const getAgentRunner = () => (ctx as any).agents?.runner as ReturnType<typeof import('@modules/agent/agent-runner').createAgentRunner> | undefined
    const getToolRegistry = () => (ctx as any).tools?.registry as import('@modules/tools/tool-registry').ToolRegistry | undefined
    const getDecisionEngine = () => (ctx as any).decisionEngine as import('@modules/model/routing/decision-engine').DecisionEngine | undefined
    const getAssembler = () => (ctx as any).promptAssembler ?? undefined
    const getSkills = () => (ctx as any).skills as { loader: any; matcher: any } | undefined
    const getContextRecorder = () => (ctx as any).contextRecorder as import('@modules/observability/context-recorder').ContextRecorder | undefined

    // Memory lifecycle hooks — lazy proxy (see memory-hooks.ts for why).
    const { createLazyMemoryHooks } = await import('./memory-hooks.js')
    const memoryHooks = createLazyMemoryHooks(() => (ctx as any).memory, ctx.logger)

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
        // The roster a God Mode message goes to (the privacy ingress check).
        participants: () => {
          const store = (ctx as any).agents?.godMode as
            | { getConfig(): { participants: Array<{ providerId: string; modelId: string }> } }
            | undefined
          return store?.getConfig().participants ?? []
        },
      }
    }

    // Lazy: the privacy module may start after conversations. Absent (the
    // module disabled): no ingress check.
    const getInboundPrivacy = () => {
      const privacy = ctx.privacy
      if (!privacy) return undefined
      return {
        service: privacy,
        emit: (event: string, payload: unknown) => ctx.bus.emit(event, payload),
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
      // Lazy: the design module registers after conversations.
      () => (ctx as any).designs,
      // Not lazy: without it no skill is applied at all, so it must exist
      // before the first turn rather than whenever some other module starts.
      skillDecisions,
      // Lazy: the memory module may start later, and it owns the fail-soft
      // handling of its own extraction. (Recall needs no slot: it is the
      // assembler's turn block, built through ctx.memoryRecall.)
      () => (ctx as any).memoryCapture,
      // Lazy: media module may start after conversations; merge job documentIds
      // onto the assistant turn's attachmentIds.
      () => (ctx as any).media,
      // Lazy: studio module may start after conversations; same attach path.
      () => (ctx as any).studio,
      // Lazy: read per title, so a module order that sets it later still works.
      () => ctx.auxiliaryModel,
      // The model binding resolver (model/binding.ts), read per turn.
      () => ctx.modelBinding,
      // Lazy: the agent module starts after conversations. The route reads
      // the colleague's model (binding) and tool list (tool scope).
      () => (ctx as any).agents?.registry,
      // Effort writes are validated against the conversation's model.
      () => ctx.reasoningRegistry,
      // Turn failures and turn-metadata issues (the turn sink).
      ctx.logger,
      // Privacy ingress: refuse a new block-class message before it is stored.
      getInboundPrivacy,
      // The turn's effort intent walks the delegating parents (effort-intent.ts).
      ctx.db,
    )
    ctx.logger.info('Conversations module started')
  },

  async onStop() {},
}
