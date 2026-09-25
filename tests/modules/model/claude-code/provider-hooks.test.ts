// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B4 — the provider registers the memory-policy PreToolUse hook through
// mergeHooks' sovereignty slot on every query that has tools (first matcher,
// before F5's effort readback; G6 removed the orchestration observers), and
// hands the turn's folders (resolveCliRoots: the cwd plus every stored folder
// that validates) to the hook, the permission bridge and the bridged EYAS
// tools alike.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'

const h = vi.hoisted(() => ({
  options: undefined as any,
  slots: undefined as any,
  tools: [] as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }>,
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, _description: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => {
    const t = { name, handler }
    h.tools.push(t)
    return t
  },
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

// Record the slots the provider hands to the single hooks writer.
vi.mock('@modules/model/submodules/claude-code/hooks.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('@modules/model/submodules/claude-code/hooks.js')>()
  return {
    ...real,
    applyHooks: (options: Record<string, unknown>, slots: any) => {
      h.slots = slots
      return real.applyHooks(options, slots)
    },
  }
})

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { mergeHooks } from '@modules/model/submodules/claude-code/hooks.js'
import { createPathPolicy, installPathPolicy, resetPathPolicyForTests, workAreaRootsOf } from '@shared/memory-sovereignty/path-policy.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-cc-provider-hooks-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function mk(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

const executor = {
  execute: vi.fn(async () => ({ success: true, output: { ok: true } })),
  renderForModel: () => ({ text: '{"ok":true}', isError: false }),
}
const toolDeps = {
  runtime: TEST_CLAUDE_RUNTIME,
  toolExecutor: executor as any,
  // browser_upload: a bridged EYAS tool that takes a workspace path (read_file
  // is host-native and never bridged — tools/cli-exposure.ts).
  toolRegistry: { list: () => [{ name: 'browser_upload', description: 'upload', category: 'browser', inputSchema: { properties: { path: {} } } }] } as any,
}

function makeGate() {
  return {
    validateToolCall: vi.fn((_tool: string, _input: Record<string, unknown>, _ctx?: unknown) => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' })),
    checkMemoryPath: vi.fn((_tool: string, input: Record<string, unknown>, _ctx?: unknown) =>
      input.file_path === '/deny/me' || input.path === '/deny/me' ? { decision: 'deny', reason: 'Memory outside EYAS (test store)' } : null),
  }
}

async function drain(gen: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of gen) { /* consume */ }
}

async function callHook(matcher: HookCallbackMatcher, toolName: string, toolInput: Record<string, unknown>, cliCwd = '/somewhere/else'): Promise<any> {
  const input = { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, tool_use_id: 'tu', session_id: 's', transcript_path: '', cwd: cliCwd }
  return matcher.hooks[0](input as any, 'tu', { signal: new AbortController().signal })
}

beforeEach(() => {
  h.options = undefined
  h.slots = undefined
  h.tools = []
  executor.execute.mockClear()
})

afterEach(() => {
  resetPathPolicyForTests()
})

describe('claude-code provider — the memory-policy hook through mergeHooks', () => {
  it('is PreToolUse[0] with no orchestration observers after it, and asks the gate\'s audited check', async () => {
    const gate = makeGate()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => ({ securityGate: gate }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1', origin: 'interactive' } } as any))

    const pre = h.options.hooks.PreToolUse as HookCallbackMatcher[]
    // The policy hook first, F5's effort readback after it — nothing else.
    expect(pre).toHaveLength(2)
    expect(pre[0]).toBe(h.slots.sovereignty.hooks.PreToolUse[0])
    expect(pre[1]).toBe(h.slots.readback.hooks.PreToolUse[0])
    // G6: the agent runner emits the run tree — no observer hooks, no hook
    // lifecycle messages in the stream.
    expect(h.slots.orchestration).toBeUndefined()
    expect(h.options.includeHookEvents).toBeUndefined()

    const denied = await callHook(pre[0], 'Read', { file_path: '/deny/me' })
    expect(denied.hookSpecificOutput).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Memory outside EYAS (test store)' })
    expect(await callHook(pre[0], 'Read', { file_path: '/fine' })).toEqual({ continue: true })
    // The bridged-tool prefix is stripped before the gate sees the name.
    await callHook(pre[0], 'mcp__eyas__read_file', { path: '/deny/me' })
    expect(gate.checkMemoryPath).toHaveBeenLastCalledWith('read_file', { path: '/deny/me' }, expect.objectContaining({ conversationId: 'c1' }))
    // Deterministic only — the hook never runs the full gate (the judge).
    expect(gate.validateToolCall).not.toHaveBeenCalled()
  })

  it('F5\'s readback matcher is kept after it, and never decides anything', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => ({ securityGate: makeGate() }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))
    const merged = mergeHooks(h.slots)
    const pre = merged.hooks!.PreToolUse!
    expect(pre[0]).toBe(h.slots.sovereignty.hooks.PreToolUse[0])
    expect(pre[pre.length - 1]).toBe(h.slots.readback.hooks.PreToolUse[0])
    expect(merged.hooks!.Stop).toEqual(h.slots.readback.hooks.Stop)
    // Even on a call the policy refuses, the readback only answers `continue`.
    expect(await callHook(pre[1], 'Read', { file_path: '/deny/me' })).toEqual({ continue: true })
  })

  it.each([
    ['EYAS tools bridged', { ...toolDeps }, {}],
    ['no bridge (the CLI\'s own default tools)', { runtime: TEST_CLAUDE_RUNTIME }, {}],
    ['solo mode', { ...toolDeps }, { orchestration: 'solo' }],
  ])('is on every query with tools — %s', async (_label, deps, extra) => {
    const gate = makeGate()
    const provider = createClaudeCodeProvider({ ...(deps as any), getGovernance: () => ({ securityGate: gate }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' }, ...extra } as any))
    const pre = h.options.hooks.PreToolUse as HookCallbackMatcher[]
    expect(pre).toHaveLength(2)
    expect(pre[0]).toBe(h.slots.sovereignty.hooks.PreToolUse[0])
    expect((await callHook(pre[0], 'Read', { file_path: '/deny/me' })).hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('without a gate it still runs, answering from the process-wide path policy', async () => {
    const home = mk(tmp, 'nogate-home')
    const dataDir = mk(tmp, 'nogate-data')
    const ws = mk(tmp, 'nogate-ws')
    installPathPolicy(createPathPolicy({
      homeDir: home, env: {}, dataDir, workspacesRoot: ws,
      workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: ws }), providerHomes: [],
    }))
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } } as any))
    expect(h.options.permissionMode).toBe('default')
    const pre = h.options.hooks.PreToolUse as HookCallbackMatcher[]
    expect(pre).toHaveLength(2)
    expect(pre[0]).toBe(h.slots.sovereignty.hooks.PreToolUse[0])
    const denied = await callHook(pre[0], 'Glob', { pattern: '~/.grok/**' })
    expect(denied.hookSpecificOutput.permissionDecisionReason).toMatch(/^Memory outside EYAS \(Grok CLI/)
    expect(await callHook(pre[0], 'Bash', { command: 'git status' })).toEqual({ continue: true })
  })

  it('is absent only when the query has no tools at all (tools: []); the readback Stop matcher stays', async () => {
    const gate = makeGate()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => ({ securityGate: gate }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'extract' }], isolated: true, metadata: { conversationId: 'c1' } } as any))
    expect(h.options.tools).toEqual([])
    expect(h.slots.sovereignty).toBeUndefined()

    const plain = createClaudeCodeProvider({ ...toolDeps })
    await drain(plain.stream({ messages: [{ role: 'user', content: 'extract' }], isolated: true } as any))
    expect(h.options.tools).toEqual([])
    // Only F5's readback: no policy matcher, nothing that could refuse a call.
    expect(h.options.hooks.PreToolUse).toEqual(h.slots.readback.hooks.PreToolUse)
    expect(h.options.hooks.Stop).toEqual(h.slots.readback.hooks.Stop)
    expect(Object.keys(h.options.hooks).sort()).toEqual(['PreToolUse', 'Stop'])
  })
})

describe('claude-code provider — the turn\'s folders reach the hook, the permission bridge and the bridged tools', () => {
  it('carries metadata.workingDirectories (validated, primary first) everywhere, then the query\'s own temp root', async () => {
    const a = mk(tmp, 'project-a')
    const b = mk(tmp, 'project-b')
    const gate = makeGate()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => ({ securityGate: gate }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1', agentId: 'ag', runId: 'r1', origin: 'interactive', workingDirectories: [a, b] } } as any))

    expect(h.options.cwd).toBe(a)
    // The CLI's temp root (background command output) is the query's own folder.
    const queryTmp = h.options.env.CLAUDE_CODE_TMPDIR as string
    expect(queryTmp.startsWith(join(process.env.EYAS_WORKSPACES_DIR!, '_runs', 'clitmp-'))).toBe(true)

    // Permission bridge → gate.
    await h.options.canUseTool('Read', { file_path: join(a, 'x.md') }, { toolUseID: 't', signal: new AbortController().signal })
    expect(gate.validateToolCall).toHaveBeenCalledWith('Read', { file_path: join(a, 'x.md') }, { conversationId: 'c1', agentId: 'ag', runId: 'r1', workingDirectories: [a, b, queryTmp] })

    // Hook → gate's memory-path check, whatever cwd the CLI reports.
    await callHook(h.options.hooks.PreToolUse[0], 'Read', { file_path: join(b, 'y.md') }, '/tmp/cli-says-elsewhere')
    expect(gate.checkMemoryPath).toHaveBeenLastCalledWith('Read', { file_path: join(b, 'y.md') }, { workingDirectories: [a, b, queryTmp], conversationId: 'c1', agentId: 'ag' })

    // Bridged EYAS tools work in the same folders.
    const upload = h.tools.find((t) => t.name === 'browser_upload')!
    await upload.handler({ path: 'x.md' })
    const toolCtx = (executor.execute.mock.calls[0] as unknown[])[2] as Record<string, unknown>
    expect(toolCtx).toMatchObject({ workingDirectory: a, workingDirectories: [a, b, queryTmp], conversationId: 'c1' })
  })

  it('a stored folder that no longer validates never becomes a working directory (negative)', async () => {
    const valid = mk(tmp, 'still-here')
    const gone = join(tmp, 'deleted-project')
    const gate = makeGate()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => ({ securityGate: gate }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1', origin: 'interactive', workingDirectories: [gone, valid] } } as any))
    await h.options.canUseTool('Read', { file_path: join(valid, 'x') }, { toolUseID: 't', signal: new AbortController().signal })
    const ctx = gate.validateToolCall.mock.calls[0][2] as { workingDirectories: string[] }
    expect(ctx.workingDirectories).toEqual([valid, h.options.env.CLAUDE_CODE_TMPDIR])
  })

  it('no stored folders: the conversation workspace (the cwd) and the query\'s temp root are the only working directories', async () => {
    const gate = makeGate()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => ({ securityGate: gate }) })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-roots', origin: 'interactive' } } as any))
    expect(h.options.cwd).toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'conv-roots'))
    await callHook(h.options.hooks.PreToolUse[0], 'Read', { file_path: '/x' })
    expect(gate.checkMemoryPath).toHaveBeenLastCalledWith('Read', { file_path: '/x' }, expect.objectContaining({ workingDirectories: [h.options.cwd, h.options.env.CLAUDE_CODE_TMPDIR] }))
  })
})
