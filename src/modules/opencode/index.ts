// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Optional OpenCode sidecar (MIT). Not vendored. LLM keys stay in OpenCode's
// own auth (isolated under data/opencode by default). EYAS hydrates and
// captures memory; the TUI is a PTY streamed to xterm.js.

import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createProcessRunner } from '@modules/studio/cli-runner.js'
import { load as loadSettings, save as saveSettings, normalizeOpencodeSettings } from './settings-store.js'
import { createPtyManager, type PtyManager } from './pty-manager.js'
import { unixPtyFactory, isUnixPtyAvailable } from './unix-pty.js'
import { createOpencodeRunner, type OpencodeRunner } from './opencode-runner.js'
import { createDeveloperAgent, type DeveloperAgent } from './developer-agent.js'
import { createTerminalWsHandler, type TerminalWsHandler } from './terminal-ws.js'
import { saveEyasMemory } from './memory-bridge.js'

export interface OpencodeModuleApi {
  pty: PtyManager
  runner: OpencodeRunner
  agent: DeveloperAgent
  wsHandler: TerminalWsHandler
}

function pluginToken(): string {
  const env = process.env.EYAS_OPENCODE_PLUGIN_TOKEN?.trim()
  if (env && env.length >= 16) return env
  return randomBytes(24).toString('hex')
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
    const dataDir = join(process.cwd(), 'data', 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const runner = createProcessRunner()
    const settings = () => loadSettings(ctx.db)
    const token = pluginToken()
    const eyasBase = ctx.config.baseUrl?.replace(/\/+$/, '') || `http://127.0.0.1:${ctx.config.server.port}`

    const ocRunner = createOpencodeRunner({
      runner,
      getSettings: settings,
      logger: ctx.logger,
      dataDir,
      eyasBaseUrl: eyasBase,
      pluginToken: token,
    })

    const pty = createPtyManager({
      spawn: isUnixPtyAvailable() ? unixPtyFactory() : () => {
        throw new Error('POSIX PTY is not available on this platform')
      },
      logger: ctx.logger,
      maxSessions: normalizeOpencodeSettings(settings()).maxPtySessions,
      fallbackCwd: join(dataDir, 'workspaces'),
      capture: ({ conversationId, text, sessionId }) => {
        saveEyasMemory({
          content: text,
          conversationId,
          kind: 'stdout',
          meta: { ptySessionId: sessionId },
        })
      },
    })

    const agent = createDeveloperAgent({
      getClient: async () => {
        const { client } = await ocRunner.ensureServer()
        return client
      },
      getMemory: () => ctx.memory as unknown as import('./memory-bridge.js').MemoryServiceLike,
      logger: ctx.logger,
    })

    const wsHandler = createTerminalWsHandler({ pty, logger: ctx.logger })

    const api: OpencodeModuleApi = { pty, runner: ocRunner, agent, wsHandler }
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
      getMemory: () => ctx.memory as unknown as import('./memory-bridge.js').MemoryServiceLike,
      pluginToken: token,
      dataDir,
      resolveTuiCommand: () => {
        const s = settings()
        const file = s.cliPath?.trim() || process.env.EYAS_OPENCODE_BIN?.trim() || 'opencode'
        const serverUrl = ocRunner.serverUrl()
        const args = ['--hostname', '127.0.0.1']
        if (serverUrl) {
          try {
            const u = new URL(serverUrl)
            args.push('--port', u.port || '4096')
          } catch {
            /* headless TUI still works */
          }
        }
        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          EYAS_OPENCODE_EYAS_URL: eyasBase,
          EYAS_OPENCODE_PLUGIN_TOKEN: token,
          TERM: 'xterm-256color',
        }
        if (s.isolatedConfig) env.XDG_CONFIG_HOME = join(dataDir, 'xdg')
        return { file, args, env }
      },
    })

    ctx.logger.info('OpenCode module started')
  },

  async onStop(ctx: ModuleContext) {
    const api = (ctx as unknown as { opencode?: OpencodeModuleApi }).opencode
    api?.pty.destroyAll()
    await api?.runner.stop()
  },
}
