// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J10 / K4 — the EYAS memory plugin inside OpenCode offers exactly EYAS's own
// memory_search / memory_expand (names, descriptions, arguments), has no
// write tool, reads its key once from fd 3 (never from the environment),
// sends each call with a one-time proof for the OpenCode session it runs in,
// and keeps the server password and the key marker out of every shell the
// model runs. The generated source is run here the way OpenCode loads it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'
import {
  EYAS_MEMORY_PLUGIN_SOURCE,
  OPENCODE_MEMORY_EXPAND_PATH,
  OPENCODE_MEMORY_SEARCH_PATH,
  OPENCODE_MEMORY_TOOLS,
  OPENCODE_SERVER_PASSWORD_ENV,
  OPENCODE_SHELL_HIDDEN_ENV,
} from '@modules/opencode/plugin-source'
import { createPluginTokenRegistry, OPENCODE_KEY_FD, OPENCODE_KEY_FD_ENV } from '@modules/opencode/plugin-tokens'
import { buildOpencodeEnv } from '@modules/opencode/isolation'

const eyasTools = new Map(createMemoryTools(() => undefined).map((t) => [t.name, t]))

describe('EYAS memory plugin source', () => {
  it('(+) is valid TypeScript', () => {
    const out = ts.transpileModule(EYAS_MEMORY_PLUGIN_SOURCE, {
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    expect(out.diagnostics ?? []).toEqual([])
  })

  it('(+) offers memory_search and memory_expand with EYAS\'s own descriptions and argument descriptions', () => {
    expect(OPENCODE_MEMORY_TOOLS.map((t) => t.name)).toEqual(['memory_search', 'memory_expand'])
    for (const { name } of OPENCODE_MEMORY_TOOLS) {
      const def = eyasTools.get(name)!
      expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain(`${name}: tool({`)
      expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain(`description: ${JSON.stringify(def.description)}`)
      const props = (def.inputSchema as { properties: Record<string, { description: string }> }).properties
      for (const [arg, prop] of Object.entries(props)) {
        expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain(`${JSON.stringify(arg)}: `)
        expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain(`.describe(${JSON.stringify(prop.description)})`)
      }
    }
    // Required stays required; limit stays optional and numeric.
    expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain('"query": tool.schema.string().describe(')
    expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain('"limit": tool.schema.number().optional().describe(')
    expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain('"id": tool.schema.string().describe(')
  })

  it('(+) each call posts only the tool\'s declared arguments to its route', () => {
    expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain(`callEyas(${JSON.stringify(OPENCODE_MEMORY_SEARCH_PATH)}, pick(args, ["query","limit"]), context)`)
    expect(EYAS_MEMORY_PLUGIN_SOURCE).toContain(`callEyas(${JSON.stringify(OPENCODE_MEMORY_EXPAND_PATH)}, pick(args, ["id"]), context)`)
  })

  it('(−) reads no key from its environment, and has no write tool nor any retired tool', () => {
    expect(EYAS_MEMORY_PLUGIN_SOURCE).not.toContain('EYAS_OPENCODE_PLUGIN_TOKEN')
    for (const retired of ['eyas_query_memory', 'eyas_save_memory', 'save_memory', 'search_memory', '/memory/save', '/memory/query']) {
      expect(EYAS_MEMORY_PLUGIN_SOURCE).not.toContain(retired)
    }
  })
})

// ── The generated plugin, run as OpenCode loads it ────────────────────────────

interface FakeFd3 {
  kind: 'socket' | 'file' | 'none'
  content: string
  reads: number
  closed: boolean
}

/**
 * Load the generated plugin: transpiled, with a stand-in for
 * `@opencode-ai/plugin`'s `tool` (the definition itself and a permissive
 * `tool.schema`), the real node:crypto, and an fs whose descriptor 3 is `fd3`.
 */
function loadPlugin(fd3: FakeFd3): { EyasMemoryPlugin: () => Promise<Record<string, any>> } {
  const js = ts.transpileModule(EYAS_MEMORY_PLUGIN_SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const chain: any = new Proxy(() => chain, { get: () => chain, apply: () => chain })
  const tool = Object.assign((def: unknown) => def, { schema: chain })
  const fs = {
    fstatSync(fd: number) {
      if (fd !== OPENCODE_KEY_FD || fd3.kind === 'none' || fd3.closed) throw Object.assign(new Error('EBADF'), { code: 'EBADF' })
      return { isSocket: () => fd3.kind === 'socket', isFIFO: () => false }
    },
    readFileSync(fd: number) {
      if (fd !== OPENCODE_KEY_FD || fd3.closed) throw new Error('EBADF')
      fd3.reads += 1
      const out = fd3.content
      fd3.content = ''
      return out
    },
    closeSync(fd: number) {
      if (fd === OPENCODE_KEY_FD) fd3.closed = true
    },
  }
  const mod: { exports: Record<string, any> } = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'require', 'module', js)(mod.exports, (id: string) => {
    if (id === '@opencode-ai/plugin') return { tool }
    if (id === 'node:crypto') return nodeCrypto
    if (id === 'node:fs') return fs
    throw new Error(`unexpected import ${id}`)
  }, mod)
  return mod.exports as { EyasMemoryPlugin: () => Promise<Record<string, any>> }
}

const EYAS_URL = 'http://127.0.0.1:3100'
let restore: Array<() => void> = []

function setEnv(name: string, value: string | undefined): void {
  const before = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  restore.push(() => {
    if (before === undefined) delete process.env[name]
    else process.env[name] = before
  })
}

describe('the generated plugin inside OpenCode', () => {
  let calls: Array<{ url: string; authorization: string; body: any }>

  beforeEach(() => {
    calls = []
    setEnv('EYAS_OPENCODE_EYAS_URL', EYAS_URL)
    setEnv(OPENCODE_KEY_FD_ENV, String(OPENCODE_KEY_FD))
    const fetchStub = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, authorization: init.headers.Authorization ?? '', body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ text: 'EYAS answer', isError: false }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const undo of restore.reverse()) undo()
    restore = []
  })

  it('(+) reads its key once from fd 3 at load, closes fd 3, and its call redeems in EYAS for exactly its own session', async () => {
    const tokens = createPluginTokenRegistry()
    const minted = tokens.mint('serve', 'x')
    const fd3: FakeFd3 = { kind: 'socket', content: `${minted.key}\n`, reads: 0, closed: false }
    const hooks = await loadPlugin(fd3).EyasMemoryPlugin()
    expect(fd3.reads).toBe(1)
    expect(fd3.closed).toBe(true)

    const text = await hooks.tool.memory_search.execute({ query: 'ledger', limit: 5 }, { sessionID: 'ses_A', callID: 'call_1' })
    expect(text).toBe('EYAS answer')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${EYAS_URL}${OPENCODE_MEMORY_SEARCH_PATH}`)
    expect(calls[0]!.body).toEqual({ query: 'ledger', limit: 5 })
    const bearer = calls[0]!.authorization.replace(/^Bearer /, '')
    expect(bearer).not.toContain(minted.key)
    expect(tokens.redeem(bearer)).toEqual({ tokenId: minted.tokenId, sessionId: 'ses_A' })

    // A second call (another session of the same process) gets its own proof; fd 3 is not read again.
    await hooks.tool.memory_expand.execute({ id: 'gs:1' }, { sessionID: 'ses_B' })
    expect(fd3.reads).toBe(1)
    expect(tokens.redeem(calls[1]!.authorization.replace(/^Bearer /, ''))).toEqual({ tokenId: minted.tokenId, sessionId: 'ses_B' })
  })

  it('(−) a session id the model puts into the arguments never reaches EYAS; the proof names the tool\'s own session', async () => {
    const tokens = createPluginTokenRegistry()
    const minted = tokens.mint('serve', 'x')
    const hooks = await loadPlugin({ kind: 'socket', content: minted.key, reads: 0, closed: false }).EyasMemoryPlugin()
    await hooks.tool.memory_search.execute({ query: 'ledger', sessionId: 'ses_B', conversationId: 'conv-q' }, { sessionID: 'ses_A' })
    expect(calls[0]!.body).toEqual({ query: 'ledger' })
    expect(tokens.check(calls[0]!.authorization.replace(/^Bearer /, ''))).toEqual({ tokenId: minted.tokenId, sessionId: 'ses_A' })
  })

  it('(−) without the fd-3 marker it reads nothing — not even a key-shaped environment variable — and answers "not available"', async () => {
    setEnv(OPENCODE_KEY_FD_ENV, undefined)
    setEnv('EYAS_OPENCODE_PLUGIN_TOKEN', 'eyas-oc-static-operator-key')
    const fd3: FakeFd3 = { kind: 'socket', content: 'someone-elses-data', reads: 0, closed: false }
    const hooks = await loadPlugin(fd3).EyasMemoryPlugin()
    expect(fd3.reads).toBe(0)
    expect(fd3.closed).toBe(false)
    expect(await hooks.tool.memory_search.execute({ query: 'q' }, { sessionID: 'ses_A' })).toMatch(/not available/)
    expect(calls).toHaveLength(0)
  })

  it('(−) an fd 3 that is not a socket or pipe is neither read nor closed', async () => {
    const fd3: FakeFd3 = { kind: 'file', content: 'a file', reads: 0, closed: false }
    const hooks = await loadPlugin(fd3).EyasMemoryPlugin()
    expect(fd3.reads).toBe(0)
    expect(fd3.closed).toBe(false)
    expect(await hooks.tool.memory_search.execute({ query: 'q' }, { sessionID: 'ses_A' })).toMatch(/not available/)
  })

  it('(−) a call without an OpenCode session is not sent', async () => {
    const tokens = createPluginTokenRegistry()
    const hooks = await loadPlugin({ kind: 'socket', content: tokens.mint('serve', 'x').key, reads: 0, closed: false }).EyasMemoryPlugin()
    expect(await hooks.tool.memory_search.execute({ query: 'q' }, {})).toMatch(/needs the OpenCode session/)
    expect(calls).toHaveLength(0)
  })
})

describe('the model\'s shell never sees the memory key or the server password', () => {
  // What an EYAS-started `opencode serve` runs with (opencode-runner.ts).
  const serveEnv = buildOpencodeEnv({
    home: '/data/cli-homes/opencode',
    eyasBaseUrl: EYAS_URL,
    pluginKeyOnFd: true,
    serverPassword: 'serve-password',
    source: { PATH: '/usr/bin:/bin', HOME: '/home/op', EYAS_OPENCODE_PLUGIN_TOKEN: 'eyas-oc-inherited' },
  })

  afterEach(() => {
    for (const undo of restore.reverse()) undo()
    restore = []
  })

  it('(+) the process environment holds no key at all — only the fd-3 marker', () => {
    expect(serveEnv[OPENCODE_KEY_FD_ENV]).toBe(String(OPENCODE_KEY_FD))
    expect(serveEnv).not.toHaveProperty('EYAS_OPENCODE_PLUGIN_TOKEN')
    const key = createPluginTokenRegistry().mint('serve', 'x').key
    expect(JSON.stringify(serveEnv)).not.toContain(key)
  })

  it('(+) the shell.env hook blanks the password and the marker; OpenCode\'s shell env ({...process.env, ...hook.env}) holds neither', async () => {
    expect(OPENCODE_SHELL_HIDDEN_ENV).toEqual([OPENCODE_SERVER_PASSWORD_ENV, OPENCODE_KEY_FD_ENV])
    setEnv(OPENCODE_KEY_FD_ENV, undefined)
    const hooks = await loadPlugin({ kind: 'none', content: '', reads: 0, closed: false }).EyasMemoryPlugin()
    const output: { env: Record<string, string> } = { env: {} }
    await hooks['shell.env']({ cwd: '/w', sessionID: 'ses_A', callID: 'call_1' }, output)
    const shellEnv = { ...serveEnv, ...output.env }
    expect(shellEnv[OPENCODE_SERVER_PASSWORD_ENV]).toBe('')
    expect(shellEnv[OPENCODE_KEY_FD_ENV]).toBe('')
    expect(JSON.stringify(shellEnv)).not.toContain('serve-password')
  })

  it('(−) without the hook the shell would carry the password; the hook changes nothing else and keeps other plugins\' values', async () => {
    expect(serveEnv[OPENCODE_SERVER_PASSWORD_ENV]).toBe('serve-password')
    setEnv(OPENCODE_KEY_FD_ENV, undefined)
    const hooks = await loadPlugin({ kind: 'none', content: '', reads: 0, closed: false }).EyasMemoryPlugin()
    const output: { env: Record<string, string> } = { env: { FROM_ANOTHER_PLUGIN: '1' } }
    await hooks['shell.env']({ cwd: '/w' }, output)
    expect(output.env).toEqual({ FROM_ANOTHER_PLUGIN: '1', [OPENCODE_SERVER_PASSWORD_ENV]: '', [OPENCODE_KEY_FD_ENV]: '' })
    const shellEnv = { ...serveEnv, ...output.env }
    expect(shellEnv.PATH).toBe(serveEnv.PATH)
    expect(shellEnv.EYAS_OPENCODE_EYAS_URL).toBe(EYAS_URL)
    expect(Object.keys(hooks.tool)).toEqual(['memory_search', 'memory_expand'])
  })
})
