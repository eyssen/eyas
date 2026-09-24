// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A4 — one isolated-options builder for every Claude Code process EYAS starts:
// chat, background and isolated queries, `auth status`, and the discovery
// probe (which adds only `tools: []`). The init check is the tripwire half of
// the same contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const h = vi.hoisted(() => ({ calls: [] as any[], tmpExisted: [] as boolean[], failAfterInit: false }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.calls.push(args.options)
    h.tmpExisted.push(existsSync(args.options.env.CLAUDE_CODE_TMPDIR))
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      if (h.failAfterInit) throw new Error('the CLI exited')
      yield { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import {
  CLAUDE_ISOLATION_ENV,
  buildClaudeIsolationEnv,
  buildClaudeIsolationOptions,
  checkClaudeInit,
  initMissingViolation,
} from '@modules/model/submodules/claude-code/isolation-options.js'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'
import { CLI_QUERY_TMP_PREFIX, RUN_SCRATCH_DIR, resolveWorkspacesRoot } from '@modules/model/cli-runtime/workspaces.js'

const HOSTILE_ENV = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/op',
  ANTHROPIC_API_KEY: 'sk-ant-x',
  CLAUDECODE: '1',
  CLAUDE_CODE_SIMPLE: '1',
  CLAUDE_CONFIG_DIR: '/elsewhere',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
  OPENAI_API_KEY: 'sk-o',
  EYAS_MASTER_KEY: 'secret',
}

async function drain(gen: AsyncIterable<unknown>) { for await (const _ of gen) { /* consume */ } }

const TMP = '/work/_runs/clitmp-test'

describe('buildClaudeIsolationOptions', () => {
  it('returns the fixed isolation contract', () => {
    const o = buildClaudeIsolationOptions({ cwd: '/work/c1', executable: '/opt/bin/claude', tmpDir: TMP, envSource: HOSTILE_ENV })
    expect(o).toMatchObject({
      cwd: '/work/c1',
      pathToClaudeCodeExecutable: '/opt/bin/claude',
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      enableFileCheckpointing: false,
    })
    expect(o.env).toMatchObject({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'eyas',
      // The CLI's temp root is the query's own folder, not /tmp/claude-<uid>.
      CLAUDE_CODE_TMPDIR: TMP,
    })
    // Host login keeps working: HOME and the auth key pass the allowlist.
    expect(o.env.HOME).toBe('/home/op')
    expect(o.env.ANTHROPIC_API_KEY).toBe('sk-ant-x')
    expect(o.env.PATH).toBe('/usr/bin:/bin')
  })

  it('is an allowlist, never a process.env spread: inherited CLI switches and unrelated secrets are dropped', () => {
    const { env } = buildClaudeIsolationOptions({ cwd: '/work/c1', executable: '/opt/bin/claude', tmpDir: TMP, envSource: { ...HOSTILE_ENV, CLAUDE_TMPDIR: '/tmp/host' } })
    for (const key of ['CLAUDE_TMPDIR', 'CLAUDECODE', 'CLAUDE_CODE_SIMPLE', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_ENTRYPOINT', 'OPENAI_API_KEY', 'EYAS_MASTER_KEY']) {
      expect(env).not.toHaveProperty(key)
    }
    // An inherited kill switch set to '0' cannot switch auto-memory back on.
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
  })

  it('never carries a resume, continue or session id', () => {
    const o: Record<string, unknown> = { ...buildClaudeIsolationOptions({ cwd: '/work/c1', executable: '/opt/bin/claude', tmpDir: TMP }) }
    for (const key of ['resume', 'continue', 'sessionId', 'forkSession', 'resumeSessionAt']) expect(o).not.toHaveProperty(key)
  })

  it('refuses a relative or empty cwd, a missing executable, and a relative or missing temp folder', () => {
    expect(() => buildClaudeIsolationOptions({ cwd: 'relative', executable: '/opt/bin/claude', tmpDir: TMP })).toThrow(/absolute/)
    expect(() => buildClaudeIsolationOptions({ cwd: '', executable: '/opt/bin/claude', tmpDir: TMP })).toThrow(/absolute/)
    expect(() => buildClaudeIsolationOptions({ cwd: '/work', executable: '', tmpDir: TMP })).toThrow(/runtime/)
    expect(() => buildClaudeIsolationOptions({ cwd: '/work', executable: '/opt/bin/claude', tmpDir: 'tmp' })).toThrow(/temp folder/)
    expect(() => buildClaudeIsolationOptions({ cwd: '/work', executable: '/opt/bin/claude', tmpDir: '' })).toThrow(/temp folder/)
  })

  it('auth status and queries share one env builder', () => {
    expect(buildClaudeIsolationEnv(HOSTILE_ENV, { tmpDir: TMP })).toEqual(
      buildClaudeIsolationOptions({ cwd: '/w', executable: '/b', tmpDir: TMP, envSource: HOSTILE_ENV }).env,
    )
    // `auth status` starts no session: it gets no temp root of its own.
    expect(buildClaudeIsolationEnv(HOSTILE_ENV)).not.toHaveProperty('CLAUDE_CODE_TMPDIR')
    for (const [k, v] of Object.entries(CLAUDE_ISOLATION_ENV)) expect(buildClaudeIsolationEnv(HOSTILE_ENV)[k]).toBe(v)
  })
})

describe('the chat path and the discovery probe start from the same options', () => {
  beforeEach(() => { h.calls = []; h.tmpExisted = []; h.failAfterInit = false })

  it('every query carries the builder output unchanged; the probe differs only by tools: []', async () => {
    const provider = createClaudeCodeProvider({
      runtime: TEST_CLAUDE_RUNTIME,
      toolExecutor: { execute: vi.fn() } as any,
      toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
      getGovernance: () => ({ securityGate: { validateToolCall: () => ({ decision: 'allow', reason: 'ok', riskTier: 'green' }) } }) as any,
    })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' }, isolated: true } as any))

    for (const options of h.calls) {
      const expected = buildClaudeIsolationOptions({ cwd: options.cwd, executable: TEST_CLAUDE_RUNTIME.path, tmpDir: options.env.CLAUDE_CODE_TMPDIR })
      for (const [key, value] of Object.entries(expected)) expect(options[key]).toEqual(value)
    }

    // What F5's discovery probe will send: the same builder plus tools: [].
    const cwd = h.calls[0].cwd
    const probe = { ...buildClaudeIsolationOptions({ cwd, executable: TEST_CLAUDE_RUNTIME.path, tmpDir: TMP }), tools: [] }
    const chat = buildClaudeIsolationOptions({ cwd, executable: TEST_CLAUDE_RUNTIME.path, tmpDir: TMP })
    const { tools, ...probeRest } = probe
    expect(tools).toEqual([])
    expect(probeRest).toEqual(chat)
  })

  it('(+) each query gets its own temp root in the run scratch area, there while the CLI runs and gone when the query ends', async () => {
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' }, isolated: true } as any))
    const dirs = h.calls.map((o) => o.env.CLAUDE_CODE_TMPDIR as string)
    expect(new Set(dirs).size).toBe(2)
    for (const dir of dirs) expect(dir.startsWith(join(resolveWorkspacesRoot(), RUN_SCRATCH_DIR, CLI_QUERY_TMP_PREFIX))).toBe(true)
    expect(h.tmpExisted).toEqual([true, true])
    for (const dir of dirs) expect(existsSync(dir), dir).toBe(false)
  })

  it('(−) a query whose CLI fails mid-run still removes its temp root', async () => {
    h.failAfterInit = true
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await expect(drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))).rejects.toThrow(/exited/)
    expect(h.calls).toHaveLength(1)
    expect(h.tmpExisted).toEqual([true])
    expect(existsSync(h.calls[0].env.CLAUDE_CODE_TMPDIR)).toBe(false)
  })
})

describe('checkClaudeInit', () => {
  let dir: string
  beforeEach(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-cc-init-'))) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const init = (over: Record<string, unknown> = {}) => ({
    type: 'system', subtype: 'init', cwd: dir, claude_code_version: '2.1.280', permissionMode: 'default',
    mcp_servers: [{ name: 'eyas', status: 'connected' }], plugins: [], ...over,
  })

  it('passes the configured servers, no plugins, default mode and the resolved cwd', () => {
    const v = checkClaudeInit(init(), { cwd: dir, mcpServers: ['eyas'] })
    expect(v.ok).toBe(true)
    expect(v.snapshot).toMatchObject({ providerId: 'claude-code', version: '2.1.280', cwd: dir, mcpServers: ['eyas'], plugins: [], permissionMode: 'default' })
  })

  it('compares the cwd realpathed (the CLI reports its physical cwd)', () => {
    const real = join(dir, 'real')
    mkdirSync(real)
    const link = join(dir, 'link')
    symlinkSync(real, link)
    expect(checkClaudeInit(init({ cwd: real }), { cwd: link, mcpServers: ['eyas'] }).ok).toBe(true)
  })

  it('an MCP server EYAS did not pass is a violation — and any server at all on an isolated call', () => {
    const extra = checkClaudeInit(init({ mcp_servers: [{ name: 'eyas', status: 'connected' }, { name: 'mcpvault', status: 'connected' }] }), { cwd: dir, mcpServers: ['eyas'] })
    expect(extra.ok).toBe(false)
    if (!extra.ok) expect(extra.violations).toEqual([expect.objectContaining({ check: 'mcpServers', detail: expect.stringContaining('mcpvault') })])

    const isolated = checkClaudeInit(init(), { cwd: dir, mcpServers: [] })
    expect(isolated.ok).toBe(false)
    if (!isolated.ok) expect(isolated.violations.map((x) => x.check)).toEqual(['mcpServers'])
  })

  it('plugins, a non-default permission mode and another cwd are violations', () => {
    const v = checkClaudeInit(
      init({ plugins: [{ name: 'host-plugin', path: '/x' }], permissionMode: 'bypassPermissions', cwd: '/somewhere/else' }),
      { cwd: dir, mcpServers: ['eyas'] },
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.violations.map((x) => x.check).sort()).toEqual(['cwd', 'permissionMode', 'plugins'])
  })

  it('accepts the builtin plugins the live lane proved inert (2.1.281 lists agents-md and telemetry)', () => {
    const v = checkClaudeInit(init({
      plugins: [
        { name: 'agents-md', path: 'builtin', source: 'agents-md@builtin' },
        { name: 'telemetry', path: 'builtin', source: 'telemetry@builtin' },
      ],
    }), { cwd: dir, mcpServers: ['eyas'] })
    expect(v.ok).toBe(true)
    expect(v.snapshot.plugins).toEqual(['agents-md', 'telemetry'])
  })

  it('a proven name from another source, or a builtin nobody proved, is still a violation', () => {
    const impostor = checkClaudeInit(init({ plugins: [{ name: 'telemetry', path: '/x', source: 'telemetry@some-marketplace' }] }), { cwd: dir, mcpServers: ['eyas'] })
    expect(impostor.ok).toBe(false)
    if (!impostor.ok) expect(impostor.violations).toEqual([expect.objectContaining({ check: 'plugins', detail: expect.stringContaining('telemetry@some-marketplace') })])

    const unproven = checkClaudeInit(init({ plugins: [{ name: 'mermaid', path: 'builtin', source: 'mermaid@builtin' }] }), { cwd: dir, mcpServers: ['eyas'] })
    expect(unproven.ok).toBe(false)
    if (!unproven.ok) expect(unproven.violations.map((x) => x.check)).toEqual(['plugins'])

    const noSource = checkClaudeInit(init({ plugins: [{ name: 'agents-md', path: 'builtin' }] }), { cwd: dir, mcpServers: ['eyas'] })
    expect(noSource.ok).toBe(false)
  })

  it('fails closed on fields the CLI did not report or reshaped', () => {
    const v = checkClaudeInit({ type: 'system', subtype: 'init', mcp_servers: 'eyas', plugins: [{ nope: 1 }] }, { cwd: dir, mcpServers: ['eyas'] })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.violations.map((x) => x.check).sort()).toEqual(['cwd', 'mcpServers', 'permissionMode', 'plugins'])
    expect(checkClaudeInit(null, { cwd: dir, mcpServers: [] }).ok).toBe(false)
  })

  it('names the message that arrived before init', () => {
    expect(initMissingViolation('assistant')).toEqual({ check: 'initMissing', detail: expect.stringContaining("'assistant'") })
  })
})
