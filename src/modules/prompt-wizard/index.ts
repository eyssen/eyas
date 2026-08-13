// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createWizardService } from './wizard-service.js'
import { createWorkspaceLoader } from './workspace-loader.js'
import { createWorkspaceWatcher } from './workspace-watcher.js'
import { createPromptAssembler } from './assembler.js'
import { createWorkspaceWriter } from './workspace-writer.js'
import { createProjectContextLoader } from './project-context-loader.js'
import { createSoulPipeline } from './soul-pipeline.js'
import {
  resolveTeamContextImpl,
  resolveMemoryContextImpl,
  resolveCodeSearchContextImpl,
} from './context-resolvers.js'
import { refreshMasterSeedsFromKnownDefaults } from './seed-migration.js'
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'
import { DEFAULT_PERSONALITY } from './master-prompt.js'

export const promptWizardModule: EyasModule = {
  id: 'prompt-wizard',
  name: 'Prompt Wizard',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Prompt template management with inheritance chain — master, project-type, project, conversation',
  dependencies: [],
  optional: ['conversations'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      target_id TEXT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      section TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    // Migration: add section and locked columns
    try {
      ctx.db.run(sql`ALTER TABLE prompt_templates ADD COLUMN section TEXT`)
    } catch { /* column already exists */ }
    try {
      ctx.db.run(sql`ALTER TABLE prompt_templates ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`)
    } catch { /* column already exists */ }

    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_prompt_level ON prompt_templates(level)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_prompt_target ON prompt_templates(target_id)`)

    const wizardService = createWizardService(ctx.db)
    ;(ctx as any).promptWizard = wizardService
    ctx.logger.info('Prompt Wizard module registered')
  },

  async onStart(ctx: ModuleContext) {
    const dataDir = (ctx.config as any)?.dataDir ?? 'data'

    // v2: workspace loader + file watcher (watcher invalidates loader cache on any workspace change)
    const loader = createWorkspaceLoader({ dataDir })
    const watcher = createWorkspaceWatcher({ dataDir })
    watcher.onInvalidate((agentId) => loader.invalidate(agentId))
    await watcher.start()
    ;(ctx as any).workspaceLoader = loader
    ;(ctx as any)._workspaceWatcher = watcher

    const { createPromptWizardRoutes } = await import('./routes.js')

    const writer = createWorkspaceWriter({ dataDir })
    ;(ctx as any).workspaceWriter = writer

    const soulPipeline = createSoulPipeline({ writer })
    ;(ctx as any).soulPipeline = soulPipeline

    const projectContextLoader = createProjectContextLoader({
      dataDir,
      resolveProjectType: async (projectId) => {
        const board = (ctx as any).board
        if (!board?.projects?.get) return null
        const proj = board.projects.get(projectId)
        if (!proj?.typeId) return null
        return { id: proj.typeId }
      },
    })

    // Pull resolveActiveVoice lazily from communication module (started after prompt-wizard)
    const resolveActiveVoiceAdapter = async (params: { agentId: string; channelContext: unknown; conversationId: string | null }) => {
      const activeVoice = (ctx as any).activeVoiceResolver
      if (!activeVoice) {
        // communication module not yet started — fall back to internal voice with a placeholder profile.
        // Real wiring kicks in once communication.onStart sets ctx.activeVoiceResolver.
        return {
          scope: 'internal' as const,
          reason: 'fallback (communication module not ready)',
          profile: {
            address: 'tegező' as const,
            tone: 'kiegyensúlyozott' as const,
            verbosity: 'lényegre törő' as const,
            directness: 'direkt + udvarias' as const,
            humor: 'nincs' as const,
            emoji: 'soha' as const,
            blockedPhrases: [],
            signature: '',
          },
        }
      }
      // The assembler passes `channelContext: unknown`. Treat it as ChannelContext or fall back to owner-DM.
      const fallbackChannelCtx = {
        channelType: 'web' as string,
        conversationKind: 'owner-dm' as const,
        participants: [{ id: 'owner', type: 'owner' as const }],
        origin: 'inbound' as const,
      }
      const channelCtx = (params.channelContext as any) ?? fallbackChannelCtx
      const result = await activeVoice({
        agentId: params.agentId,
        conversationId: params.conversationId,
        channelId: null,
        channelContext: channelCtx,
      })
      return { scope: result.scope, reason: result.reason, profile: result.profile }
    }

    const assembler = createPromptAssembler({
      workspaceLoader: loader,
      projectContextLoader,
      resolveSkillsFor: async (_agentId) => {
        const svc = (ctx as any).skills
        if (!svc?.loader?.list) return []
        try {
          const enabled = svc.loader.list(true) as Array<{ name?: string; description?: string; content?: string }>
          return enabled.map((s) => ({ name: s.name ?? '', oneLine: (s.description ?? s.content ?? '').slice(0, 120) }))
        } catch {
          return []
        }
      },
      resolveToolsFor: async (_agentId) => {
        const tools = (ctx as any).tools
        if (!tools?.registry?.toToolDefinitions) return []
        try {
          const defs = tools.registry.toToolDefinitions() as Array<{ name: string; description: string }>
          return defs.map((t) => ({ name: t.name, oneLine: t.description }))
        } catch {
          return []
        }
      },
      resolveTeamContext: (convId) => resolveTeamContextImpl(ctx, convId),
      resolveMemoryContext: (convId, agentId) => resolveMemoryContextImpl(ctx, convId, agentId),
      resolveCodeSearchContext: (convId) => resolveCodeSearchContextImpl(ctx, convId),
      resolveActiveVoice: resolveActiveVoiceAdapter,
      resolveRuntime: () => ({
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' }),
        channel: 'unknown',
        os: process.platform,
        version: (ctx.config as any)?.version ?? '1.0.0',
        ownerName: (ctx.config as any)?.ownerName ?? 'User',
      }),
      resolveContextWindow: async (_agentId) => 200_000,  // sensible default; real lookup comes when modelRegistry is ready
      resolveMasterSections: async () => {
        const svc = (ctx as any).promptWizard
        return {
          identity: svc?.getMasterSection?.('identity') ?? CORE_IDENTITY,
          coreRules: svc?.getMasterSection?.('core-rules') ?? CORE_RULES,
          personality: svc?.getMasterSection?.('personality') ?? DEFAULT_PERSONALITY,
        }
      },
    })

    ;(ctx as any).promptAssembler = assembler

    // Seed master prompt sections into DB for frontend visibility
    const { getMasterPrompt } = await import('./master-prompt.js')
    const master = getMasterPrompt()
    const now = new Date().toISOString()
    const masterSections = [
      { id: 'master-identity', section: 'identity', name: 'System Identity', content: master.identity, locked: 1 },
      { id: 'master-core-rules', section: 'core-rules', name: 'Core Rules', content: master.coreRules, locked: 1 },
      { id: 'master-personality', section: 'personality', name: 'Default Personality', content: master.personality, locked: 0 },
    ]
    for (const s of masterSections) {
      ctx.db.run(sql`INSERT OR IGNORE INTO prompt_templates
        (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
        VALUES (${s.id}, 'master', NULL, ${s.name}, ${s.content}, ${s.section}, ${s.locked}, 1, 'system', ${now}, ${now})`)
      // NOTE: no re-sync UPDATE — master sections are owner-editable (D2). Reset-to-default is a separate explicit action (Phase 2 UI).
    }
    // One-time upgrade: refresh rows still holding a known prior shipped-default
    // seed (INSERT OR IGNORE above never touches an existing row).
    refreshMasterSeedsFromKnownDefaults(ctx.db, { identity: master.identity, coreRules: master.coreRules, personality: master.personality })

    createPromptWizardRoutes(ctx.http, (ctx as any).promptWizard, assembler)
    ctx.logger.info('Prompt Wizard module started')
  },

  async onStop(ctx: ModuleContext) {
    const watcher = (ctx as any)._workspaceWatcher
    if (watcher) await watcher.stop()
  },
}
