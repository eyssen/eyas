// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Optional OpenCode sidecar (MIT). Not vendored. Every OpenCode process EYAS
// starts — the headless server and the TUI in the terminal panel — runs in
// the EYAS-owned home <dataDir>/cli-homes/opencode (isolation.ts): its own
// config, data (the sign-in), state and cache; no host Claude Code
// instructions or skills, no other assistants' skills, no project config.
// Headless tasks ask the EYAS security gate before every tool call
// (developer-agent.ts); the TUI asks the human in the terminal. An attach
// URL points at an external server, which EYAS cannot isolate.
// Memory: a task is hydrated with the one recall block; inside OpenCode the
// EYAS memory plugin offers the same read-only memory_search / memory_expand
// tools. Each call carries a proof for its own OpenCode session, made with a
// key minted per OpenCode process and handed over on fd 3, never in the
// environment (plugin-tokens.ts); the session bindings (memory-bridge.ts)
// decide what a proven session reads.
// Tool and terminal output is recorded only with
// memory.l0.captureToolResults on. The TUI is a PTY streamed to xterm.js.

import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createProcessRunner } from '@modules/studio/cli-runner.js'
import { cliHome } from '@modules/model/cli-runtime/homes.js'
import { resolveWorkspacesRoot } from '@modules/model/cli-runtime/workspaces.js'
import { load as loadSettings, save as saveSettings, normalizeOpencodeSettings } from './settings-store.js'
import { createPtyManager, type PtyManager } from './pty-manager.js'
import { unixPtyFactory, isUnixPtyAvailable } from './unix-pty.js'
import { createOpencodeRunner, pickFreePort, type OpencodeRunner } from './opencode-runner.js'
import { createDeveloperAgent, type DeveloperAgent, type OpencodeSecurityGate } from './developer-agent.js'
import { createTerminalWsHandler, type TerminalWsHandler } from './terminal-ws.js'
import { capturePolicy } from '@modules/memory/v2/ingest-bridge.js'
import { registerDelegatedBearer } from '@modules/auth/delegated-bearer.js'
import { captureOpencodeToolEvent, capturePtyOutput, createSessionBindings } from './memory-bridge.js'
import { createPluginTokenRegistry } from './plugin-tokens.js'
import { OPENCODE_MEMORY_TOOLS } from './plugin-source.js'
import type { OpencodeToolsAccess } from './routes.js'
import { buildTuiCommand } from './isolation.js'

export interface OpencodeModuleApi {
  pty: PtyManager
  runner: OpencodeRunner
  agent: DeveloperAgent
  wsHandler: TerminalWsHandler
  /** Withdraws the plugin key from the auth middleware (module stop). */
  unregisterPluginBearer: () => void
}

export const opencodeModule: EyasModule = {
  id: 'opencode',
  name: 'OpenCode',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Embedded OpenCode coding engine (MIT sidecar) with an interactive web terminal.',
  dependencies: ['permissions', 'auth', 'tools', 'memory'],
  frontend: {
    pages: [{ id: 'opencode', path: '/opencode', title: 'OpenCode', icon: 'terminal', order: 46 }],
  },

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS opencode_settings (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)

    try {
      ctx.permissions.registerSubject('OpenCode', {
        actions: ['read', 'create', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create'],
          agent: ['create'],
          guest: [],
        },
      })
    } catch {
      /* already registered */
    }

    ctx.logger.info('OpenCode module registered')
  },

  async onStart(ctx: ModuleContext) {
    // EYAS-owned home under the instance data dir (never process.cwd()), and
    // the shared workspaces root for every folder EYAS hands to a CLI.
    const home = cliHome('opencode')
    const workspacesRoot = resolveWorkspacesRoot()
    const runner = createProcessRunner()
    const settings = () => loadSettings(ctx.db)
    const eyasBase = ctx.config.baseUrl?.replace(/\/+$/, '') || `http://127.0.0.1:${ctx.config.server.port}`
    // One key per OpenCode process EYAS starts, revoked when it goes; a
    // plugin call is a one-time proof for one session made with it. The
    // bindings say what each EYAS-created session may read.
    const pluginTokens = createPluginTokenRegistry()
    const sessions = createSessionBindings()
    const unregisterPluginBearer = registerDelegatedBearer(
      OPENCODE_MEMORY_TOOLS.map((t) => t.path),
      (bearer) => pluginTokens.check(bearer) !== null,
    )

    const ocRunner = createOpencodeRunner({
      runner,
      getSettings: settings,
      logger: ctx.logger,
      home,
      workspacesRoot,
      eyasBaseUrl: eyasBase,
      pluginTokens,
    })

    const pty = createPtyManager({
      spawn: isUnixPtyAvailable() ? unixPtyFactory() : () => {
        throw new Error('POSIX PTY is not available on this platform')
      },
      logger: ctx.logger,
      maxSessions: normalizeOpencodeSettings(settings()).maxPtySessions,
      fallbackCwd: workspacesRoot,
      pluginTokens,
      // Terminal output is tool output: recorded only when the owner opted in.
      captureEnabled: () => capturePolicy().toolResults,
      capture: (chunk) => {
        capturePtyOutput(chunk, { db: ctx.db })
      },
    })

    const agent = createDeveloperAgent({
      getClient: async () => {
        const { client } = await ocRunner.ensureServer()
        return client
      },
      // The one recall service, resolved per task: the memory module may
      // start after us. memory.index.budgetChars is the block's size at the
      // 100k baseline window; the task scales it to the window OpenCode
      // lists for its model, as every other prompt path does.
      getRecall: () => (ctx as unknown as { memoryRecall?: import('@modules/memory/v2/assemble.js').MemoryRecall }).memoryRecall,
      recallBudgetChars: () => {
        const memoryConfig = ctx.config.memory as { index?: { budgetChars?: unknown } } | undefined
        const chars = memoryConfig?.index?.budgetChars
        return typeof chars === 'number' ? chars : undefined
      },
      // Resolved per task: the privacy module may start after us. The prompt
      // and the recalled memory are masked before they reach OpenCode.
      getPrivacy: () => ctx.privacy,
      // Resolved per task: the security-gate module may register after us.
      getSecurityGate: () => (ctx as unknown as { securityGate?: OpencodeSecurityGate }).securityGate,
      // The sidecar's HOME (isolation.ts): the gate expands `~`/`$HOME` there too.
      home,
      sessions,
      getServeTokenId: () => ocRunner.serveTokenId(),
      captureToolEvent: (event, binding) => {
        captureOpencodeToolEvent(event, binding, { db: ctx.db })
      },
      logger: ctx.logger,
    })

    const wsHandler = createTerminalWsHandler({ pty, logger: ctx.logger })

    const api: OpencodeModuleApi = { pty, runner: ocRunner, agent, wsHandler, unregisterPluginBearer }
    ;(ctx as unknown as { opencode: OpencodeModuleApi }).opencode = api

    const registry = (ctx as unknown as { tools?: { registry?: { has?: (n: string) => boolean; register: (t: unknown) => void } } }).tools?.registry
    if (registry) {
      const { createOpencodeTools } = await import('./tools.js')
      for (const tool of createOpencodeTools({
        getRunner: () => runner,
        getSettings: settings,
        getDoctorExtras: () => ({
          serverUrl: ocRunner.serverUrl(),
          serverVersion: ocRunner.serverVersion(),
        }),
        getAgent: () => agent,
      })) {
        try {
          if (!registry.has?.(tool.name)) registry.register(tool)
        } catch (err) {
          ctx.logger.warn({ err, tool: tool.name }, 'OpenCode tool registration skipped')
        }
      }
    }

    const { createOpencodeRoutes } = await import('./routes.js')
    createOpencodeRoutes(ctx.http, {
      runner,
      load: settings,
      save: (s) => saveSettings(ctx.db, s),
      pty,
      opencode: ocRunner,
      // The registered memory tools and the one executor: its renderForModel
      // masks their answers for OpenCode's (remote) model.
      getTools: () => (ctx as unknown as { tools?: OpencodeToolsAccess }).tools,
      pluginTokens,
      sessions,
      logger: ctx.logger,
      // The TUI runs its own OpenCode server: its own port and password,
      // never the headless server's (isolation.ts buildTuiCommand).
      resolveTuiCommand: () => buildTuiCommand({
        file: settings().cliPath?.trim() || process.env.EYAS_OPENCODE_BIN?.trim() || 'opencode',
        home,
        eyasBaseUrl: eyasBase,
        workspacesRoot,
        pickPort: pickFreePort,
      }),
    })

    ctx.logger.info('OpenCode module started')
  },

  async onStop(ctx: ModuleContext) {
    const api = (ctx as unknown as { opencode?: OpencodeModuleApi }).opencode
    api?.unregisterPluginBearer()
    api?.pty.destroyAll()
    await api?.runner.stop()
  },
}
