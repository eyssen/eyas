// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — Claude Code's kernel file sandbox: every query with tools carries the
// SDK sandbox option (the memory-sovereignty deny list for reads and writes,
// the turn's folders writable). 'required' lets no command leave it and fails
// if it cannot start; 'auto' lets a command ask to leave, which then waits on
// a human (the permission bridge's requireHuman). Without a sandbox, 'auto'
// runs with a one-time notice and 'required' refuses before the CLI starts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const h = vi.hoisted(() => ({
  captured: { options: undefined as any },
  queries: 0,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.queries++
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { resetCliSandboxForTests, type CliSandboxDeps } from '@modules/model/cli-runtime/sandbox/index.js'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import type { ModelRequest, StreamEvent } from '@modules/model/types.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture'

const AVAILABLE_AUTO: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'darwin' } }
const AVAILABLE_REQUIRED: CliSandboxDeps = { mode: () => 'required', host: { platform: 'darwin' } }
const NONE_AUTO: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'linux', which: () => null } }
const NONE_REQUIRED: CliSandboxDeps = { mode: () => 'required', host: { platform: 'linux', which: () => null } }

let fx: SovereigntyFixture

beforeEach(() => {
  h.captured.options = undefined
  h.queries = 0
  fx = createSovereigntyFixture()
  fx.stubInstanceEnv()
  installPathPolicy(fx.policy)
  mkdirSync(fx.ownWorkspace, { recursive: true })
})

afterEach(() => {
  resetCliSandboxForTests()
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
  fx.cleanup()
})

const validateToolCall = vi.fn(async (_name: string, _input: Record<string, unknown>, _ctx?: Record<string, unknown>) => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }))

function provider(sandbox: CliSandboxDeps) {
  validateToolCall.mockClear()
  return createClaudeCodeProvider({
    runtime: TEST_CLAUDE_RUNTIME,
    sandbox,
    getGovernance: () => ({ securityGate: { validateToolCall } }) as any,
  })
}

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: 'user', content: 'hi' }],
  metadata: { conversationId: 'conv-1', origin: 'interactive' },
  ...extra,
})

async function collect(stream: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; error?: unknown }> {
  const events: StreamEvent[] = []
  try {
    for await (const e of stream) events.push(e)
    return { events }
  } catch (error) {
    return { events, error }
  }
}

const denies = (list: string[], path: string) => list.some((d) => d === `/${path}` || `/${path}`.startsWith(`${d}/`))

describe('claude-code provider — kernel file sandbox', () => {
  it("'required': sandboxed, fails if the sandbox cannot start, and no command may leave it", async () => {
    await collect(provider(AVAILABLE_REQUIRED).stream(request()))
    const sandbox = h.captured.options.sandbox
    expect(sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false })
  })

  it("'auto' with a sandbox: sandboxed, degrades instead of failing, commands may ask to leave", async () => {
    await collect(provider(AVAILABLE_AUTO).stream(request()))
    expect(h.captured.options.sandbox).toMatchObject({ enabled: true, failIfUnavailable: false, allowUnsandboxedCommands: true, autoAllowBashIfSandboxed: false })
  })

  it('the filesystem rules: the deny list for reads and writes, the turn folders writable, all as //absolute paths', async () => {
    fx.policy.classify(fx.vaultNote)
    await collect(provider(AVAILABLE_AUTO).stream(request()))
    const fs = h.captured.options.sandbox.filesystem
    expect(fs.denyRead).toEqual(fs.denyWrite)
    for (const p of [...fs.denyRead, ...fs.allowWrite]) expect(p.startsWith('//')).toBe(true)
    const withForms = (p: string) => [p, p.replace(/^\/var\//, '/private/var/')]
    const denied = (p: string) => withForms(p).some((f) => denies(fs.denyRead, f))
    expect(denied(fx.claudeMemory)).toBe(true)
    expect(denied(fx.vaultNote)).toBe(true)
    expect(denied(fx.eyasVaultNote)).toBe(true)
    expect(denied(fx.otherFile)).toBe(true)
    expect(denied(fx.ownFile)).toBe(false)
    expect(fs.allowWrite.some((p: string) => withForms(fx.ownWorkspace).some((f) => p === `/${f}`))).toBe(true)
    // ~/.claude stays denied as a whole; only Claude Code's own shell state
    // and binary folder are re-opened, for reading.
    expect(denied(join(fx.home, '.claude', 'shell-snapshots', 'snapshot.sh'))).toBe(true)
    expect(fs.allowRead).toEqual(expect.arrayContaining([
      `/${join(fx.home, '.claude', 'shell-snapshots')}`,
      `/${join(fx.home, '.claude', 'session-env')}`,
      '//opt/eyas-test/bin',
    ]))
    expect(fs.allowRead.some((p: string) => p === `/${join(fx.home, '.claude')}` || p === `/${fx.home}`)).toBe(false)
  })

  it('autoAllowBashIfSandboxed is false in every mode: every Bash call still reaches canUseTool', async () => {
    for (const deps of [AVAILABLE_AUTO, AVAILABLE_REQUIRED]) {
      await collect(provider(deps).stream(request()))
      expect(h.captured.options.sandbox.autoAllowBashIfSandboxed).toBe(false)
      expect(typeof h.captured.options.canUseTool).toBe('function')
    }
  })

  it("'auto' without a sandbox: no sandbox option, a one-time notice, the query runs", async () => {
    const first = await collect(provider(NONE_AUTO).stream(request()))
    expect(first.error).toBeUndefined()
    expect(h.captured.options.sandbox).toBeUndefined()
    expect(first.events[0]).toEqual({ type: 'notice', code: 'cliSandboxUnavailable', params: { provider: 'Claude Code', reason: 'no-bwrap' } })
    expect(first.events.some((e) => e.type === 'done')).toBe(true)
    const second = await collect(provider(NONE_AUTO).stream(request()))
    expect(second.events.some((e) => e.type === 'notice')).toBe(false)
  })

  it("'required' without a sandbox: refused with cliSandboxUnavailable, the CLI never starts", async () => {
    const { error } = await collect(provider(NONE_REQUIRED).stream(request()))
    expect(error).toMatchObject({ kind: 'isolation', code: 'cliSandboxUnavailable', params: { provider: 'claude-code', reason: 'no-bwrap' } })
    expect(h.queries).toBe(0)
  })

  it('negative: a query without tools (isolated) has no sandbox option and is never refused for lack of one', async () => {
    const { error } = await collect(provider(NONE_REQUIRED).stream(request({ isolated: true })))
    expect(error).toBeUndefined()
    expect(h.captured.options.tools).toEqual([])
    expect(h.captured.options).not.toHaveProperty('sandbox')
    await collect(provider(AVAILABLE_REQUIRED).stream(request({ isolated: true })))
    expect(h.captured.options).not.toHaveProperty('sandbox')
  })

  it("the permission bridge marks a Bash call that asks to leave the sandbox requireHuman in 'auto' only", async () => {
    const opts = { toolUseID: 't1', signal: new AbortController().signal }
    const leave = { command: 'npm install', dangerouslyDisableSandbox: true }

    await collect(provider(AVAILABLE_AUTO).stream(request()))
    await h.captured.options.canUseTool('Bash', leave, opts)
    expect(validateToolCall.mock.calls.at(-1)?.[2]).toMatchObject({ requireHuman: true })

    await collect(provider(AVAILABLE_REQUIRED).stream(request()))
    await h.captured.options.canUseTool('Bash', leave, opts)
    expect(validateToolCall.mock.calls.at(-1)?.[2]).not.toHaveProperty('requireHuman')

    // No sandbox applied ('auto' without one): the flag means nothing, nothing is marked.
    await collect(provider(NONE_AUTO).stream(request()))
    await h.captured.options.canUseTool('Bash', leave, opts)
    expect(validateToolCall.mock.calls.at(-1)?.[2]).not.toHaveProperty('requireHuman')
  })
})
