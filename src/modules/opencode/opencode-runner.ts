// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { Logger } from 'pino'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { createOpencodeHttpClient, type OpencodeClient, type OpencodeClientOptions } from './opencode-client.js'
import { resolveOpencodeCli } from './doctor.js'
import { buildOpencodeEnv, writeOpencodeManagedFiles } from './isolation.js'
import { deliverPluginKey, OPENCODE_SERVE_STDIO, type PluginTokenRegistry } from './plugin-tokens.js'
import type { OpencodeSettings } from './types.js'

const START_TIMEOUT_MS = 20_000
const HEALTH_POLL_MS = 250

export interface OpencodeRunner {
  ensureServer(): Promise<{ url: string; client: OpencodeClient }>
  client(): OpencodeClient | null
  serverUrl(): string | null
  serverVersion(): string | null
  /**
   * The id of the memory-plugin key the running spawned server holds
   * (plugin-tokens.ts): EYAS binds the sessions it creates there to it. null
   * when no server runs, for an attached external server (no key, so no EYAS
   * memory), and when the key could not be handed over on fd 3.
   */
  serveTokenId(): string | null
  stop(): Promise<void>
}

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export interface OpencodeRunnerDeps {
  runner: CliRunner
  getSettings: () => OpencodeSettings
  logger: Logger
  /** EYAS-owned OpenCode home (cliHome('opencode')). */
  home: string
  /** Workspaces root: cwd of `opencode serve` and GIT_CEILING_DIRECTORIES. */
  workspacesRoot: string
  eyasBaseUrl: string
  /**
   * Mints the memory-plugin key of each `opencode serve` start, handed over on
   * the child's fd 3 (never its environment); the key is revoked when that
   * server exits, is restarted or stopped.
   */
  pluginTokens: Pick<PluginTokenRegistry, 'mint' | 'revoke'>
  /** Test seams. */
  spawnProcess?: SpawnFn
  createClient?: (url: string, options: OpencodeClientOptions) => OpencodeClient
  pickPort?: () => Promise<number>
  sourceEnv?: NodeJS.ProcessEnv
  startTimeoutMs?: number
}

/** A free port on 127.0.0.1 (node:net, so the Node.js fallback runtime works too). */
export function pickFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolvePort(port) : reject(new Error('could not pick a free port'))))
    })
  })
}

export function createOpencodeRunner(deps: OpencodeRunnerDeps): OpencodeRunner {
  const spawnProcess: SpawnFn = deps.spawnProcess ?? ((command, args, options) => spawn(command, [...args], options))
  const makeClient = deps.createClient ?? ((url: string, options: OpencodeClientOptions) => createOpencodeHttpClient(url, options))
  const pickPort = deps.pickPort ?? pickFreePort
  const startTimeoutMs = deps.startTimeoutMs ?? START_TIMEOUT_MS

  let child: ChildProcess | null = null
  let url: string | null = null
  let version: string | null = null
  let http: OpencodeClient | null = null
  let tokenId: string | null = null
  let starting: Promise<{ url: string; client: OpencodeClient }> | null = null

  /** Retire the running server's plugin key (exit, restart, stop). */
  function revokeServeToken(): void {
    if (tokenId) deps.pluginTokens.revoke(tokenId)
    tokenId = null
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
    // A (re)start never inherits the previous server's key.
    revokeServeToken()
    if (settings.attachUrl && settings.attachUrl.trim()) {
      // An external server: its own config, sign-in and permission rules
      // apply. EYAS cannot isolate it (doctor discloses this).
      const attached = settings.attachUrl.replace(/\/+$/, '')
      const client = makeClient(attached, {})
      const ver = await waitHealthy(client, startTimeoutMs)
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
    writeOpencodeManagedFiles(deps.home)
    mkdirSync(deps.workspacesRoot, { recursive: true })
    // A fresh password per server, held only by this runner's client (never
    // handed to a TUI): without one `opencode serve` accepts any local
    // process (it warns "server is unsecured").
    const serverPassword = randomBytes(24).toString('hex')
    // This server's own memory-plugin key, alive exactly as long as it runs.
    const minted = deps.pluginTokens.mint('serve', listen)
    const env = buildOpencodeEnv({
      home: deps.home,
      eyasBaseUrl: deps.eyasBaseUrl,
      pluginKeyOnFd: true,
      serverPassword,
      workspacesRoot: deps.workspacesRoot,
      source: deps.sourceEnv,
    })

    const proc = spawnProcess(cli.command, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      env,
      // Never the EYAS install root: a request without a folder lands here.
      cwd: deps.workspacesRoot,
      // fd 3: the key socket, written and ended at once (plugin-tokens.ts).
      stdio: [...OPENCODE_SERVE_STDIO],
    })
    child = proc
    // The key goes over fd 3 only. Without that pipe the server gets none:
    // no binding, no EYAS memory tools, rather than a key anywhere else.
    const keyHanded = deliverPluginKey(proc, minted.key)
    if (!keyHanded) {
      deps.pluginTokens.revoke(minted.tokenId)
      deps.logger.warn('OpenCode serve: the memory key could not be handed over on fd 3 — EYAS memory is off for this server')
    }
    proc.stdout?.on('data', (d) => {
      deps.logger.debug({ src: 'opencode' }, String(d).trimEnd())
    })
    proc.stderr?.on('data', (d) => {
      deps.logger.debug({ src: 'opencode' }, String(d).trimEnd())
    })
    proc.on('exit', (code) => {
      deps.logger.info({ code }, 'OpenCode serve exited')
      deps.pluginTokens.revoke(minted.tokenId)
      if (tokenId === minted.tokenId) tokenId = null
      if (url === listen) {
        url = null
        http = null
        version = null
        child = null
      }
    })

    const client = makeClient(listen, { password: serverPassword })
    try {
      const ver = await waitHealthy(client, startTimeoutMs)
      url = listen
      version = ver
      http = client
      tokenId = keyHanded ? minted.tokenId : null
      return { url: listen, client }
    } catch (err) {
      try { proc.kill('SIGTERM') } catch { /* gone */ }
      deps.pluginTokens.revoke(minted.tokenId)
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
    serveTokenId: () => tokenId,
    async stop() {
      const proc = child
      child = null
      url = null
      http = null
      version = null
      revokeServeToken()
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
