// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createWizardService } from './wizard-service.js'
import { createWorkspaceLoader } from './workspace-loader.js'
import { createWorkspaceWatcher } from './workspace-watcher.js'
import { createPromptAssembler } from './assembler.js'
import { createActiveVoiceAdapter } from './active-voice-adapter.js'
import { createWorkspaceWriter } from './workspace-writer.js'
import { createProjectContextLoader } from './project-context-loader.js'
import { createSoulPipeline } from './soul-pipeline.js'
import {
  resolveTeamContextImpl,
  resolveMemoryContextImpl,
  resolveCodeSearchContextImpl,
  resolveWorkingDirectoriesContextImpl,
  resolveConversationTagsImpl,
} from './context-resolvers.js'
import { refreshMasterSeedsFromKnownDefaults } from './seed-migration.js'
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'
import { DEFAULT_PERSONALITY } from './master-prompt.js'
import { resolveSkillSectionLines } from './skills-section.js'
import { resolveToolInventory } from './tools-section.js'
import { formatNow } from '@shared/clock.js'
import type { MemoryRecall } from '@modules/memory/v2/assemble.js'
import { resolveDeliveryProfile } from './delivery-profile.js'
import { resolveModelContextWindow } from '@modules/model/model-window.js'
import { findModelOwner } from '@modules/model/binding.js'

export const promptWizardModule: EyasModule = {
  id: 'prompt-wizard',
  name: 'Prompt Wizard',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Prompt template management with inheritance chain — master, project-type, project, conversation',
  dependencies: ['tools'],
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
      resolveProjectPrompt: async (projectId) => {
        const board = (ctx as any).board
        if (!board?.projects?.get) return null
        return board.projects.get(projectId)?.prompt ?? null
      },
      resolveTypePrompt: async (typeId) => {
        const board = (ctx as any).board
        if (!board?.projectTypes?.get) return null
        return board.projectTypes.get(typeId)?.prompt ?? null
      },
    })

    // Pull resolveActiveVoice lazily from communication module (started after
    // prompt-wizard) and never let it throw — see active-voice-adapter.ts.
    const resolveActiveVoiceAdapter = createActiveVoiceAdapter(
      () => (ctx as any).activeVoiceResolver,
      ctx.logger,
    )

    const assembler = createPromptAssembler({
      workspaceLoader: loader,
      projectContextLoader,
      // D-7 / P-19 — the gate and the fail-soft live in skills-section.ts so
      // they are testable without booting this module.
      resolveSkillsFor: async (_agentId) => resolveSkillSectionLines((ctx as any).skills),
      // The inventory names the tools this run is offered, not the registry.
      resolveToolsFor: async (agentId, conversationId) => resolveToolInventory({
        toolRegistry: (ctx as any).tools?.registry,
        agents: (ctx as any).agents?.registry,
        // One column, not conversations.get(): that loads every message.
        orchestrationOf: (id) => {
          const rows = ctx.db.all(sql`SELECT orchestration FROM conversations WHERE id = ${id}`) as Array<{ orchestration: string | null }>
          return rows[0]?.orchestration ?? null
        },
      }, agentId, conversationId ?? null),
      resolveAgentsFor: async (_agentId) => {
        const agents = (ctx as any).agents
        if (!agents?.list) return []
        try {
          const { createAgentDirectory } = await import('@modules/agent/agent-directory.js')
          return createAgentDirectory(agents).toInventoryItems()
        } catch {
          return []
        }
      },
      resolveTeamContext: (convId) => resolveTeamContextImpl(ctx, convId),
      resolveMemoryContext: (convId, agentId) => resolveMemoryContextImpl(ctx, convId, agentId),
      resolveCodeSearchContext: (convId) => resolveCodeSearchContextImpl(ctx, convId),
      resolveWorkingDirectoriesContext: (convId) => resolveWorkingDirectoriesContextImpl(ctx, convId),
      resolveConversationTags: (convId) => resolveConversationTagsImpl(ctx, convId),
      resolveActiveVoice: resolveActiveVoiceAdapter,
      resolveRuntime: () => ({
        channel: 'unknown',
        os: process.platform,
        version: (ctx.config as any)?.version ?? '1.0.0',
        ownerName: (ctx.config as any)?.ownerName ?? 'User',
      }),
      // One clock, one zone: i18n.timezone, else the server's own zone. It is
      // read into the per-message turn block, not the system prompt, so the
      // prompt prefix and suffix stay stable between turns.
      resolveClock: () => formatNow(ctx.config?.i18n?.timezone),
      // The recall service, read per call: the memory module publishes it in
      // its own onStart, which may run after this one.
      resolveRecall: async (input) => {
        const recall = (ctx as any).memoryRecall as MemoryRecall | undefined
        return recall ? recall(input) : null
      },
      // The model the prompt is for: window, tool support, tool names. Every
      // input is read per call — providers, the catalog and the bridge health
      // all change after this module starts.
      resolveDeliveryProfile: (target) => resolveDeliveryProfile({
        modelWindow: (t) => ctx.modelWindow?.(t) ?? resolveModelContextWindow(t),
        getProvider: (id) => ctx.model?.getProvider(id),
        // The model binding's install default (model/binding.ts, one ladder).
        resolveDefault: () => ctx.modelBinding?.resolveDefault() ?? null,
        // A model-only target (an agent that pins just a model) is bound to
        // the provider the gateway will route that model to.
        lookupModelOwner: (modelId) => (ctx.providerConfig
          ? findModelOwner({ providerConfig: ctx.providerConfig, isRegistered: (id) => !!ctx.model?.getProvider(id) }, modelId)
          : null),
        bridgeHealth: () => ctx.cliMcpBridge,
      }, target),
      resolveMemoryRecallChars: () => {
        const chars = (ctx.config as any)?.memory?.index?.budgetChars
        return typeof chars === 'number' ? chars : undefined
      },
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
