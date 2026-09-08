// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Logger } from 'pino'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { createOpencodeHttpClient, type OpencodeClient } from './opencode-client.js'
import { resolveOpencodeCli } from './doctor.js'
import { EYAS_MEMORY_PLUGIN_SOURCE } from './plugin-source.js'
import type { OpencodeSettings } from './types.js'

const START_TIMEOUT_MS = 20_000
const HEALTH_POLL_MS = 250

export interface OpencodeRunner {
  ensureServer(): Promise<{ url: string; client: OpencodeClient }>
  client(): OpencodeClient | null
  serverUrl(): string | null
  serverVersion(): string | null
  stop(): Promise<void>
}

export function createOpencodeRunner(deps: {
  runner: CliRunner
  getSettings: () => OpencodeSettings
  logger: Logger
  dataDir: string
  eyasBaseUrl: string
  pluginToken: string
}): OpencodeRunner {
  let child: ChildProcess | null = null
  let url: string | null = null
  let version: string | null = null
  let http: OpencodeClient | null = null
  let starting: Promise<{ url: string; client: OpencodeClient }> | null = null

  function writeIsolatedConfig(): string {
    const home = join(deps.dataDir, 'xdg')
    const cfgDir = join(home, 'opencode')
    const pluginDir = join(deps.dataDir, 'plugins')
    mkdirSync(cfgDir, { recursive: true })
    mkdirSync(pluginDir, { recursive: true })
    const pluginPath = join(pluginDir, 'eyas-memory.ts')
    writeFileSync(pluginPath, EYAS_MEMORY_PLUGIN_SOURCE, 'utf8')
    const pluginUrl = `file://${pluginPath}`
    writeFileSync(
      join(cfgDir, 'opencode.json'),
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugin: [pluginUrl] }, null, 2),
      'utf8',
    )
    return home
  }

  async function pickPort(): Promise<number> {
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {}, open() {}, close() {}, error() {} },
    })
    const port = server.port
    server.stop(true)
    return port
  }

  async function waitHealthy(client: OpencodeClient, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let last = 'starting'
    while (Date.now() < deadline) {
      try {
        const health = await client.health()
        if (health.healthy) return health.version
        last = `unhealthy ${health.version}`
      } catch (err) {
        last = err instanceof Error ? err.message : String(err)
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_MS))
    }
    throw new Error(`OpenCode server did not become healthy: ${last}`)
  }

  async function startFresh(): Promise<{ url: string; client: OpencodeClient }> {
    const settings = deps.getSettings()
    if (settings.attachUrl && settings.attachUrl.trim()) {
      const attached = settings.attachUrl.replace(/\/+$/, '')
      const client = createOpencodeHttpClient(attached)
      const ver = await waitHealthy(client, START_TIMEOUT_MS)
      url = attached
      version = ver
      http = client
      return { url: attached, client }
    }

    const cli = await resolveOpencodeCli(deps.runner, settings)
    if (!cli.path) {
      throw new Error('OpenCode CLI is not installed. Call opencode_status for the remedy.')
    }
    const port = await pickPort()
    const listen = `http://127.0.0.1:${port}`
    const xdg = settings.isolatedConfig ? writeIsolatedConfig() : ''
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      EYAS_OPENCODE_EYAS_URL: deps.eyasBaseUrl,
      EYAS_OPENCODE_PLUGIN_TOKEN: deps.pluginToken,
    }
    if (xdg) env.XDG_CONFIG_HOME = xdg

    child = spawn(cli.command, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (d) => {
      deps.logger.debug({ src: 'opencode' }, String(d).trimEnd())
    })
    child.stderr?.on('data', (d) => {
      deps.logger.debug({ src: 'opencode' }, String(d).trimEnd())
    })
    child.on('exit', (code) => {
      deps.logger.info({ code }, 'OpenCode serve exited')
      if (url === listen) {
        url = null
        http = null
        version = null
        child = null
      }
    })

    const client = createOpencodeHttpClient(listen)
    try {
      const ver = await waitHealthy(client, START_TIMEOUT_MS)
      url = listen
      version = ver
      http = client
      return { url: listen, client }
    } catch (err) {
      try { child.kill('SIGTERM') } catch { /* gone */ }
      child = null
      throw err
    }
  }

  return {
    async ensureServer() {
      if (http && url) return { url, client: http }
      if (starting) return starting
      starting = startFresh().finally(() => { starting = null })
      return starting
    },
    client: () => http,
    serverUrl: () => url,
    serverVersion: () => version,
    async stop() {
      const proc = child
      child = null
      url = null
      http = null
      version = null
      if (!proc) return
      try { proc.kill('SIGTERM') } catch { /* gone */ }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try { proc.kill('SIGKILL') } catch { /* gone */ }
          resolve()
        }, 1500)
        proc.once('exit', () => {
          clearTimeout(t)
          resolve()
        })
      })
    },
  }
}
