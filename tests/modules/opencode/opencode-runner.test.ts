// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import pino from 'pino'
import { createOpencodeRunner } from '@modules/opencode/opencode-runner'
import { buildOpencodeEnv, buildTuiCommand, OPENCODE_ISOLATION_FLAGS, writeOpencodeManagedFiles } from '@modules/opencode/isolation'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store'
import { createPluginTokenRegistry, makeSessionProof } from '@modules/opencode/plugin-tokens'
import type { OpencodeClient, OpencodeClientOptions } from '@modules/opencode/opencode-client'
import type { OpencodeSettings } from '@modules/opencode/types'
import type { CliRunner } from '@modules/studio/cli-runner'

const logger = pino({ level: 'silent' })

/** A host environment full of things the sidecar must not inherit. */
const HOSTILE_ENV: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/operator',
  LANG: 'en_US.UTF-8',
  XDG_CONFIG_HOME: '/Users/operator/.config',
  XDG_DATA_HOME: '/Users/operator/.local/share',
  XDG_STATE_HOME: '/Users/operator/.local/state',
  XDG_CACHE_HOME: '/Users/operator/.cache',
  OPENAI_API_KEY: 'sk-host-openai',
  ANTHROPIC_API_KEY: 'sk-host-anthropic',
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  OPENCODE_CONFIG: '/Users/operator/.config/opencode/opencode.json',
  OPENCODE_PERMISSION: '{"bash":"allow"}',
  OPENCODE_SERVER_PASSWORD: 'host-password',
  npm_config_cache: '/Users/operator/.npm',
  EYAS_OPENCODE_PLUGIN_TOKEN: 'eyas-oc-static-operator-key',
  EYAS_OPENCODE_KEY_FD: '9',
}

function fakeCliRunner(): CliRunner {
  return {
    async which(bin) { return bin === 'opencode' ? '/opt/bin/opencode' : null },
    async run() { return { code: 0, stdout: 'opencode 1.18.29', stderr: '' } },
  }
}

/** A spawned child; `keyPipe: false` has no fd-3 pipe. `written` is what EYAS wrote into fd 3. */
function fakeChild(opts: { keyPipe?: boolean } = {}): ChildProcess & { written: string[]; keyEnded: boolean } {
  const child = new EventEmitter() as unknown as ChildProcess & { written: string[]; keyEnded: boolean }
  const fd3 = Object.assign(new EventEmitter(), {
    end(chunk: string) {
      child.written.push(chunk)
      child.keyEnded = true
    },
  })
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdio: [null, null, null, opts.keyPipe === false ? null : fd3],
    written: [],
    keyEnded: false,
    kill: () => true,
  })
  return child
}

function fakeClient(url: string, options: OpencodeClientOptions): OpencodeClient & { options: OpencodeClientOptions } {
  const client = {
    baseUrl: url,
    directory: null,
    options,
    forDirectory: () => client,
    health: async () => ({ healthy: true, version: '1.18.29' }),
    createSession: async () => ({ id: 'ses_1' }),
    prompt: async () => ({ text: '' }),
    listProviders: async () => ({ providers: [], defaults: {} }),
    abort: async () => undefined,
    diff: async () => [],
    replyPermission: async () => undefined,
    deleteSession: async () => undefined,
    subscribeEvents: async () => undefined,
  }
  return client
}

const baseSettings: OpencodeSettings = normalizeOpencodeSettings({})

describe('opencode runner isolation', () => {
  let root: string
  let home: string
  let workspaces: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-oc-runner-'))
    home = join(root, 'cli-homes', 'opencode')
    workspaces = join(root, 'workspaces')
    // cliHome() creates the home 0700; the runner receives it ready-made.
    mkdirSync(home, { recursive: true, mode: 0o700 })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function startWith(settings: OpencodeSettings, tokens = createPluginTokenRegistry(), childOpts: { keyPipe?: boolean } = {}) {
    const spawned: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = []
    const children: Array<ReturnType<typeof fakeChild>> = []
    const clients: Array<ReturnType<typeof fakeClient>> = []
    const runner = createOpencodeRunner({
      runner: fakeCliRunner(),
      getSettings: () => settings,
      logger,
      home,
      workspacesRoot: workspaces,
      eyasBaseUrl: 'http://127.0.0.1:3100',
      pluginTokens: tokens,
      sourceEnv: HOSTILE_ENV,
      pickPort: async () => 45123,
      spawnProcess: (command, args, options) => {
        spawned.push({ command, args, options })
        const child = fakeChild(childOpts)
        children.push(child)
        return child
      },
      createClient: (url, options) => {
        const c = fakeClient(url, options)
        clients.push(c)
        return c
      },
    })
    await runner.ensureServer()
    return { runner, spawned, clients, children, tokens }
  }

  it('spawns serve with XDG config/data/state/cache, HOME and npm cache under the EYAS home, plus the disable flags', async () => {
    const { spawned } = await startWith(baseSettings)
    expect(spawned).toHaveLength(1)
    const { command, args, options } = spawned[0]!
    expect(command).toBe('/opt/bin/opencode')
    expect(args).toEqual(['serve', '--hostname', '127.0.0.1', '--port', '45123'])
    expect(options.cwd).toBe(workspaces)
    const env = options.env as Record<string, string>
    expect(env.HOME).toBe(home)
    expect(env.XDG_CONFIG_HOME).toBe(join(home, 'config'))
    expect(env.XDG_DATA_HOME).toBe(join(home, 'data'))
    expect(env.XDG_STATE_HOME).toBe(join(home, 'state'))
    expect(env.XDG_CACHE_HOME).toBe(join(home, 'cache'))
    expect(env.npm_config_cache).toBe(join(home, 'cache', 'npm'))
    for (const [flag, value] of Object.entries(OPENCODE_ISOLATION_FLAGS)) expect(env[flag], flag).toBe(value)
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1')
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1')
    const permission = JSON.parse(env.OPENCODE_PERMISSION!) as Record<string, string>
    for (const key of ['read', 'edit', 'bash', 'glob', 'grep', 'list', 'webfetch', 'external_directory', 'task']) {
      expect(permission[key], key).toBe('ask')
    }
    expect(env.GIT_CEILING_DIRECTORIES).toBe(workspaces)
    expect(env.EYAS_OPENCODE_EYAS_URL).toBe('http://127.0.0.1:3100')
    // The key rides on fd 3; the environment only says so.
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe', 'pipe'])
    expect(env.EYAS_OPENCODE_KEY_FD).toBe('3')
    expect(env).not.toHaveProperty('EYAS_OPENCODE_PLUGIN_TOKEN')
  })

  it('(+) each serve start gets its own plugin key on fd 3 — never in its environment or arguments — live while the server runs', async () => {
    const { spawned, runner, tokens, children } = await startWith(baseSettings)
    expect(children[0]!.written).toHaveLength(1)
    expect(children[0]!.keyEnded).toBe(true)
    const key = children[0]!.written[0]!
    expect(Buffer.from(key, 'base64url')).toHaveLength(32)
    expect(JSON.stringify(spawned[0]!.options.env)).not.toContain(key)
    expect(spawned[0]!.args.join(' ')).not.toContain(key)
    expect(runner.serveTokenId()).not.toBeNull()
    expect(tokens.check(makeSessionProof(key, 'ses_1'))).toEqual({ tokenId: runner.serveTokenId(), sessionId: 'ses_1' })
    expect(tokens.check(makeSessionProof(HOSTILE_ENV.EYAS_OPENCODE_PLUGIN_TOKEN!, 'ses_1'))).toBeNull()
  })

  it('(−) the key dies with its server; a restart gets a new one and the old fails', async () => {
    const { runner, tokens, children } = await startWith(baseSettings)
    const first = children[0]!.written[0]!
    children[0]!.emit('exit', 0)
    expect(tokens.check(makeSessionProof(first, 'ses_1'))).toBeNull()
    expect(runner.serveTokenId()).toBeNull()
    await runner.ensureServer()
    const second = children[1]!.written[0]!
    expect(second).not.toBe(first)
    expect(tokens.check(makeSessionProof(first, 'ses_1'))).toBeNull()
    expect(tokens.check(makeSessionProof(second, 'ses_1'))?.tokenId).toBe(runner.serveTokenId())
    expect(tokens.size()).toBe(1)
  })

  it('(−) stop() revokes the running server\'s key', async () => {
    const { runner, tokens, children } = await startWith(baseSettings)
    const key = children[0]!.written[0]!
    const stopping = runner.stop()
    children[0]!.emit('exit', 0)
    await stopping
    expect(tokens.check(makeSessionProof(key, 'ses_1'))).toBeNull()
    expect(runner.serveTokenId()).toBeNull()
    expect(tokens.size()).toBe(0)
  })

  it('(−) a server whose fd-3 pipe is missing gets no key: nothing live, no binding, no key anywhere else', async () => {
    const { spawned, runner, tokens, children } = await startWith(baseSettings, createPluginTokenRegistry(), { keyPipe: false })
    expect(children[0]!.written).toEqual([])
    expect(runner.serveTokenId()).toBeNull()
    expect(tokens.size()).toBe(0)
    expect(spawned[0]!.options.env).not.toHaveProperty('EYAS_OPENCODE_PLUGIN_TOKEN')
  })

  it('does not pass host XDG folders, provider keys or Claude Code switches to the child', async () => {
    const { spawned } = await startWith(baseSettings)
    const env = spawned[0]!.options.env as Record<string, string>
    expect(env.XDG_DATA_HOME).not.toBe(HOSTILE_ENV.XDG_DATA_HOME)
    expect(env.XDG_CONFIG_HOME).not.toBe(HOSTILE_ENV.XDG_CONFIG_HOME)
    expect(env.HOME).not.toBe(HOSTILE_ENV.HOME)
    expect(env).not.toHaveProperty('OPENAI_API_KEY')
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(env).not.toHaveProperty('CLAUDECODE')
    expect(env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT')
    expect(env).not.toHaveProperty('OPENCODE_CONFIG')
    expect(JSON.parse(env.OPENCODE_PERMISSION!).bash).toBe('ask')
    expect(env.OPENCODE_SERVER_PASSWORD).not.toBe('host-password')
    expect(env.npm_config_cache).not.toBe(HOSTILE_ENV.npm_config_cache)
    // Base variables still pass.
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('protects the spawned server with a fresh password only its client holds (the runner hands it to nobody)', async () => {
    const { spawned, clients, runner } = await startWith(baseSettings)
    const env = spawned[0]!.options.env as Record<string, string>
    expect(env.OPENCODE_SERVER_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(clients[0]!.options.password).toBe(env.OPENCODE_SERVER_PASSWORD)
    expect(runner).not.toHaveProperty('serverPassword')
  })

  it('always writes the managed opencode.json and plugin inside the home, the plugin under config/opencode where its import resolves', async () => {
    await startWith(baseSettings)
    const configFile = join(home, 'config', 'opencode', 'opencode.json')
    const pluginFile = join(home, 'config', 'opencode', 'eyas', 'eyas-memory.ts')
    expect(existsSync(pluginFile)).toBe(true)
    const config = JSON.parse(readFileSync(configFile, 'utf8')) as { plugin: string[] }
    expect(config.plugin).toEqual([`file://${pluginFile}`])
    for (const dir of ['data', 'state', 'cache']) {
      expect(statSync(join(home, dir)).mode & 0o777, dir).toBe(0o700)
    }
    // Idempotent: a second write changes nothing.
    expect(writeOpencodeManagedFiles(home).written).toEqual([])
  })

  it('ignores a legacy isolatedConfig:false — the spawned server is isolated anyway', async () => {
    const legacy = normalizeOpencodeSettings({ isolatedConfig: false } as unknown as Partial<OpencodeSettings>)
    expect(legacy).not.toHaveProperty('isolatedConfig')
    const { spawned } = await startWith({ ...legacy, isolatedConfig: false } as unknown as OpencodeSettings)
    const env = spawned[0]!.options.env as Record<string, string>
    expect(env.XDG_DATA_HOME).toBe(join(home, 'data'))
    expect(env.XDG_CONFIG_HOME).toBe(join(home, 'config'))
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1')
  })

  it('attaches to an external server without spawning or writing anything — and without a plugin key', async () => {
    const { spawned, clients, runner, tokens } = await startWith({ ...baseSettings, attachUrl: 'http://127.0.0.1:4096/' })
    expect(spawned).toHaveLength(0)
    expect(runner.serveTokenId()).toBeNull()
    expect(tokens.size()).toBe(0)
    expect(clients[0]!.baseUrl).toBe('http://127.0.0.1:4096')
    expect(clients[0]!.options.password).toBeUndefined()
    expect(existsSync(join(home, 'config', 'opencode', 'opencode.json'))).toBe(false)
  })

  it('(−) the plugin copy an earlier version left at <home>/plugins is removed; a folder or link there is left alone', async () => {
    mkdirSync(join(home, 'plugins'), { recursive: true })
    writeFileSync(join(home, 'plugins', 'eyas-memory.ts'), '// old copy')
    writeOpencodeManagedFiles(home)
    expect(existsSync(join(home, 'plugins'))).toBe(false)
    mkdirSync(join(home, 'plugins', 'eyas-memory.ts'), { recursive: true })
    writeOpencodeManagedFiles(home)
    expect(existsSync(join(home, 'plugins', 'eyas-memory.ts'))).toBe(true)
  })

  it('buildOpencodeEnv without a password drops any inherited one', () => {
    const env = buildOpencodeEnv({
      home,
      eyasBaseUrl: 'http://x',
      pluginKeyOnFd: true,
      workspacesRoot: workspaces,
      source: HOSTILE_ENV,
    })
    expect(env).not.toHaveProperty('OPENCODE_SERVER_PASSWORD')
    expect(env.HOME).toBe(home)
    expect(env.EYAS_OPENCODE_KEY_FD).toBe('3')
  })

  it('(−) buildOpencodeEnv without a key on fd 3 passes no marker and no key, not even inherited ones', () => {
    const env = buildOpencodeEnv({ home, eyasBaseUrl: 'http://x', workspacesRoot: workspaces, source: HOSTILE_ENV })
    expect(env).not.toHaveProperty('EYAS_OPENCODE_PLUGIN_TOKEN')
    expect(env).not.toHaveProperty('EYAS_OPENCODE_KEY_FD')
  })

  it('(+) an OpenCode terminal runs its own server: its own loopback port and password, the isolated home and environment', async () => {
    const cmd = await buildTuiCommand({ file: '/opt/bin/opencode', home, eyasBaseUrl: 'http://x', workspacesRoot: workspaces, pickPort: async () => 45123, source: HOSTILE_ENV })
    expect(cmd.file).toBe('/opt/bin/opencode')
    expect(cmd.args).toEqual(['--hostname', '127.0.0.1', '--port', '45123'])
    expect(cmd.env.OPENCODE_SERVER_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(cmd.env.HOME).toBe(home)
    expect(cmd.env.TERM).toBe('xterm-256color')
    expect(cmd.env).not.toHaveProperty('OPENAI_API_KEY')
    // Its key comes on fd 3 from the PTY manager: no marker or key from the caller's environment.
    expect(cmd.env).not.toHaveProperty('EYAS_OPENCODE_KEY_FD')
    expect(cmd.env).not.toHaveProperty('EYAS_OPENCODE_PLUGIN_TOKEN')
    expect(existsSync(join(home, 'config', 'opencode', 'opencode.json'))).toBe(true)
  })

  it('(−) a terminal never gets the headless server\'s password, nor another terminal\'s: a shell its model runs inherits no way into EYAS tasks\' sessions', async () => {
    const { spawned } = await startWith(baseSettings)
    const servePassword = (spawned[0]!.options.env as Record<string, string>).OPENCODE_SERVER_PASSWORD
    const a = await buildTuiCommand({ file: 'opencode', home, eyasBaseUrl: 'http://x', workspacesRoot: workspaces, pickPort: async () => 45124 })
    const b = await buildTuiCommand({ file: 'opencode', home, eyasBaseUrl: 'http://x', workspacesRoot: workspaces, pickPort: async () => 45125 })
    expect(servePassword).toMatch(/^[0-9a-f]{48}$/)
    for (const cmd of [a, b]) {
      expect(Object.values(cmd.env)).not.toContain(servePassword)
      expect(cmd.args.join(' ')).not.toContain(servePassword)
    }
    expect(a.env.OPENCODE_SERVER_PASSWORD).not.toBe(b.env.OPENCODE_SERVER_PASSWORD)
  })
})
