// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G2 — Claude Code emits the normalized stream: live text/thinking without a
// second copy, tool rows with input/output/duration, EYAS's own refusals as
// denied / approval_required / skipped outcomes (never a green row for a call
// that did not run), compaction as a notice, and nothing from inside a tool
// call. The fake query() replays a script; a script step may be a function
// that plays the runtime's part mid-turn (asking canUseTool, running the
// PreToolUse hook, failing).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StreamEvent } from '@modules/model/types.js'
import { toolLedgerKey } from '@shared/arg-hash.js'
import { TOOL_RESULT_CONTENT_CAP_BYTES } from '@modules/model/tool-result-content.js'
import { assertStreamContract } from '../stream-contract/harness.js'

type Step = Record<string, unknown> | ((options: any) => Promise<void>)

const h = vi.hoisted(() => ({ captured: { options: undefined as any }, script: [] as Step[] }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      for (const step of h.script) {
        if (typeof step === 'function') await step(args.options)
        else yield step
      }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

// ─── Script helpers ─────────────────────────────────────────────────────

const ev = (event: Record<string, unknown>, parent: string | null = null) => ({ type: 'stream_event', parent_tool_use_id: parent, event })
const msgStart = (id: string, usage: Record<string, number> = { input_tokens: 10 }) =>
  ev({ type: 'message_start', message: { id, model: 'claude-sonnet-4-6', usage } })
const textDelta = (text: string, parent: string | null = null) => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, parent)
const thinkingDelta = (thinking: string) => ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } })
const assistant = (id: string | undefined, content: unknown[], parent: string | null = null) => ({
  type: 'assistant', parent_tool_use_id: parent, message: { ...(id ? { id } : {}), content },
})
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })
const toolResult = (id: string, content: unknown, isError = false, parent: string | null = null) => ({
  type: 'user', parent_tool_use_id: parent, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
})
const success = (result = 'ok') => ({ type: 'result', subtype: 'success', result, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })

/** The runtime asks canUseTool about one call, as it does before running it. */
const ask = (toolUseID: string, name: string, input: Record<string, unknown>) => async (options: any) => {
  await options.canUseTool(name, input, { toolUseID, signal: new AbortController().signal })
}

/** The runtime runs every PreToolUse hook on one call. */
const preToolUse = (toolUseId: string, name: string, input: Record<string, unknown>) => async (options: any) => {
  for (const matcher of options.hooks?.PreToolUse ?? []) {
    for (const hook of matcher.hooks) {
      await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: toolUseId, session_id: 's', transcript_path: '', cwd: '' }, toolUseId, { signal: new AbortController().signal })
    }
  }
}

// ─── Provider helpers ───────────────────────────────────────────────────

type Gate = { decision: 'allow' | 'deny' | 'escalate' | 'judge_error'; reason: string; riskTier: string }

function provider(opts: { gate?: Gate; createApproval?: () => number | void; checkMemoryPath?: (...a: any[]) => unknown; logger?: any } = {}) {
  const gate = opts.gate ?? { decision: 'allow', reason: 'ok', riskTier: 'green' }
  return createClaudeCodeProvider({
    runtime: TEST_CLAUDE_RUNTIME,
    logger: opts.logger ?? { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    getGovernance: () => ({
      securityGate: {
        validateToolCall: () => gate,
        ...(opts.checkMemoryPath ? { checkMemoryPath: opts.checkMemoryPath } : {}),
        autonomyPolicy: {
          categoryForTool: () => 'shell',
          resolve: () => ({ level: 3, locked: false, maxLevel: 3 }),
          createApproval: opts.createApproval ?? (() => 42),
        },
      },
    }) as any,
  })
}

async function run(p: ReturnType<typeof provider>, metadata: Record<string, unknown> = { conversationId: 'c1', origin: 'interactive' }) {
  const events: StreamEvent[] = []
  let thrown: unknown
  try {
    for await (const e of p.stream({ messages: [{ role: 'user', content: 'hi' }], metadata } as any)) events.push(e)
  } catch (err) {
    thrown = err
  }
  return { events, thrown }
}

const of = <T extends StreamEvent['type']>(events: StreamEvent[], type: T) =>
  events.filter((e): e is Extract<StreamEvent, { type: T }> => e.type === type)

beforeEach(() => {
  h.captured.options = undefined
  h.script = []
})

// ─── Live text / thinking ───────────────────────────────────────────────

describe('claude-code stream — live text and thinking', () => {
  it('yields text and thinking deltas once each and does not re-emit the complete assistant message', async () => {
    h.script = [
      msgStart('m1'),
      thinkingDelta('pondering'),
      textDelta('Hel'),
      textDelta('lo'),
      assistant('m1', [{ type: 'thinking', thinking: 'pondering' }]),
      assistant('m1', [{ type: 'text', text: 'Hello' }]),
      success('Hello'),
    ]
    const { events, thrown } = await run(provider())
    expect(thrown).toBeUndefined()
    expect(of(events, 'thinking').map((e) => e.text)).toEqual(['pondering'])
    expect(of(events, 'text').map((e) => e.text)).toEqual(['Hel', 'lo'])
    expect(of(events, 'done')[0]!.response.content).toEqual([{ type: 'text', text: 'Hello' }])
    assertStreamContract(events)
  })

  it('still emits an assistant message that was not streamed (fallback)', async () => {
    h.script = [
      assistant('never-streamed', [{ type: 'thinking', thinking: 'quiet' }, { type: 'text', text: 'Whole answer' }]),
      success('Whole answer'),
    ]
    const { events } = await run(provider())
    expect(of(events, 'thinking').map((e) => e.text)).toEqual(['quiet'])
    expect(of(events, 'text').map((e) => e.text)).toEqual(['Whole answer'])
  })

  it('marks every main-thread model call as a step and keeps the last call’s prompt size', async () => {
    h.script = [
      msgStart('m1', { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }),
      msgStart('m2', { input_tokens: 9, cache_read_input_tokens: 200 }),
      success(),
    ]
    const { events } = await run(provider())
    expect(of(events, 'step').map((e) => e.n)).toEqual([1, 2])
    expect(of(events, 'done')[0]!.response.usage.promptTokensLastCall).toBe(209)
  })

  it('never lets content from inside a tool call reach the stream', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    h.script = [
      msgStart('m1'),
      textDelta('SUB-DELTA', 'toolu_parent'),
      assistant('sub', [{ type: 'text', text: 'SUB-TEXT' }, toolUse('toolu_sub', 'Bash', { command: 'ls' })], 'toolu_parent'),
      toolResult('toolu_sub', 'SUB-RESULT', false, 'toolu_parent'),
      ev({ type: 'message_start', message: { id: 'sub-2', usage: { input_tokens: 1 } } }, 'toolu_parent'),
      success('main'),
    ]
    const { events } = await run(provider({ logger }))
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('SUB-')
    expect(of(events, 'tool_use_start')).toHaveLength(0)
    expect(of(events, 'step')).toHaveLength(1)
    expect(logger.debug).toHaveBeenCalledWith(expect.objectContaining({ parentToolUseId: 'toolu_parent' }), expect.stringContaining('inside a tool call'))
  })
})

// ─── Tool rows ──────────────────────────────────────────────────────────

describe('claude-code stream — tool rows', () => {
  it('opens a row with the canonical name, the runtime’s name and the full input, and settles it with content, duration and success', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_1', 'Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' })]),
      ask('toolu_1', 'Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' }),
      toolResult('toolu_1', [{ type: 'text', text: 'edited' }, { type: 'image', source: {} }]),
      success(),
    ]
    const { events } = await run(provider())
    expect(of(events, 'tool_use_start')).toEqual([{
      type: 'tool_use_start', id: 'toolu_1', name: 'edit_file', rawName: 'Edit',
      input: { path: '/w/a.ts', old_string: 'a', new_string: 'b' },
    }])
    const [result] = of(events, 'tool_result')
    expect(result).toMatchObject({ toolUseId: 'toolu_1', content: 'edited\n[image]', isError: false, outcome: 'success', executedBy: 'provider' })
    expect(result!.durationMs).toBeGreaterThanOrEqual(0)
    expect(of(events, 'approval_required')).toHaveLength(0)
    assertStreamContract(events)
  })

  it('a bridged EYAS tool is executed by eyas; a failed native call settles as error', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_e', 'mcp__eyas__memory_search', { query: 'x' }), toolUse('toolu_b', 'Bash', { command: 'false' })]),
      toolResult('toolu_e', 'nothing found'),
      toolResult('toolu_b', 'exit 1', true),
      success(),
    ]
    const { events } = await run(provider())
    expect(of(events, 'tool_use_start').map((e) => [e.name, e.rawName])).toEqual([['memory_search', 'mcp__eyas__memory_search'], ['run_command', 'Bash']])
    expect(of(events, 'tool_result').map((e) => [e.toolUseId, e.outcome, e.executedBy])).toEqual([
      ['toolu_e', 'success', 'eyas'],
      ['toolu_b', 'error', 'provider'],
    ])
  })

  it('caps a huge tool output at 64 KiB', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_big', 'Read', { file_path: '/w/big.log' })]),
      toolResult('toolu_big', 'x'.repeat(TOOL_RESULT_CONTENT_CAP_BYTES * 2)),
      success(),
    ]
    const { events } = await run(provider())
    const [result] = of(events, 'tool_result')
    expect(result!.content.length).toBeLessThan(TOOL_RESULT_CONTENT_CAP_BYTES + 200)
    expect(result!.content).toContain('truncated')
  })

  it('a result for a call with no open row is dropped (no orphan tool_result)', async () => {
    h.script = [toolResult('toolu_unknown', 'stray'), success()]
    const { events } = await run(provider())
    expect(of(events, 'tool_result')).toHaveLength(0)
    assertStreamContract(events)
  })
})

// ─── EYAS refusals ──────────────────────────────────────────────────────

describe('claude-code stream — refused calls carry their real outcome', () => {
  it('a gate-denied call settles as denied, not success (the old green-at-request bug)', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_d', 'Bash', { command: 'rm -rf /' })]),
      ask('toolu_d', 'Bash', { command: 'rm -rf /' }),
      toolResult('toolu_d', 'Permission denied: gate denied Bash', true),
      success(),
    ]
    const { events } = await run(provider({ gate: { decision: 'deny', reason: 'destructive', riskTier: 'red' } }))
    expect(of(events, 'tool_result').map((e) => [e.toolUseId, e.outcome])).toEqual([['toolu_d', 'denied']])
    expect(of(events, 'approval_required')).toHaveLength(0)
    assertStreamContract(events)
  })

  it('an escalation announces approval_required with its approval id before the row settles as approval_required', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_a', 'Bash', { command: 'deploy' })]),
      ask('toolu_a', 'Bash', { command: 'deploy' }),
      toolResult('toolu_a', 'approval required', true),
      success(),
    ]
    const { events } = await run(provider({ gate: { decision: 'escalate', reason: 'needs a human', riskTier: 'red' }, createApproval: () => 42 }))
    const kinds = events.filter((e) => e.type === 'tool_use_start' || e.type === 'approval_required' || e.type === 'tool_result').map((e) => e.type)
    expect(kinds).toEqual(['tool_use_start', 'approval_required', 'tool_result'])
    expect(of(events, 'approval_required')[0]).toMatchObject({ toolUseId: 'toolu_a', toolName: 'run_command', approvalId: 42, reason: expect.stringContaining('needs a human') })
    expect(of(events, 'tool_result')[0]).toMatchObject({ toolUseId: 'toolu_a', outcome: 'approval_required', isError: true })
    assertStreamContract(events)
  })

  it('a verdict recorded before its row opened is announced right after the row, never before it', async () => {
    h.script = [
      ask('toolu_early', 'Bash', { command: 'deploy' }),
      assistant(undefined, [toolUse('toolu_early', 'Bash', { command: 'deploy' })]),
      toolResult('toolu_early', 'approval required', true),
      success(),
    ]
    const { events } = await run(provider({ gate: { decision: 'escalate', reason: 'needs a human', riskTier: 'red' } }))
    const kinds = events.filter((e) => e.type === 'tool_use_start' || e.type === 'approval_required' || e.type === 'tool_result').map((e) => e.type)
    expect(kinds).toEqual(['tool_use_start', 'approval_required', 'tool_result'])
  })

  it('an interrupting deny (the run parks) still announces the card and settles the row before the failure', async () => {
    const parked: number[] = []
    h.script = [
      assistant(undefined, [toolUse('toolu_p', 'Bash', { command: 'deploy' })]),
      ask('toolu_p', 'Bash', { command: 'deploy' }),
      async () => { throw Object.assign(new Error('Claude Code process aborted by user'), { name: 'AbortError' }) },
    ]
    const { events, thrown } = await run(
      provider({ gate: { decision: 'escalate', reason: 'needs a human', riskTier: 'red' }, createApproval: () => 7 }),
      { conversationId: 'c1', origin: 'interactive', onEscalatedApproval: (id: number) => parked.push(id) },
    )
    expect(parked).toEqual([7])
    expect((thrown as Error)?.name).toBe('AbortError')
    expect(of(events, 'approval_required')[0]).toMatchObject({ toolUseId: 'toolu_p', approvalId: 7 })
    expect(of(events, 'tool_result')[0]).toMatchObject({ toolUseId: 'toolu_p', outcome: 'approval_required', isError: true })
    expect(of(events, 'done')).toHaveLength(0)
  })

  it('a repeat refused by the resumed run’s ledger settles as skipped', async () => {
    const input = { command: 'git push' }
    h.script = [
      assistant(undefined, [toolUse('toolu_l', 'Bash', input)]),
      ask('toolu_l', 'Bash', input),
      toolResult('toolu_l', 'already executed', true),
      success(),
    ]
    const { events } = await run(provider(), { conversationId: 'c1', origin: 'interactive', idempotencyLedger: new Set([toolLedgerKey('Bash', input)]) })
    expect(of(events, 'tool_result').map((e) => e.outcome)).toEqual(['skipped'])
  })

  it('a call the memory-policy hook refused settles as denied', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_v', 'Read', { file_path: '/vault/note.md' })]),
      preToolUse('toolu_v', 'Read', { file_path: '/vault/note.md' }),
      toolResult('toolu_v', 'Memory outside EYAS', true),
      success(),
    ]
    const checkMemoryPath = vi.fn(() => ({ decision: 'deny', reason: 'Memory outside EYAS' }))
    const { events } = await run(provider({ checkMemoryPath }))
    expect(checkMemoryPath).toHaveBeenCalled()
    expect(of(events, 'tool_result').map((e) => [e.toolUseId, e.outcome])).toEqual([['toolu_v', 'denied']])
  })

  it('an allowed call is never marked as refused (no approval card, plain success)', async () => {
    h.script = [
      assistant(undefined, [toolUse('toolu_ok', 'Read', { file_path: '/w/a.txt' })]),
      preToolUse('toolu_ok', 'Read', { file_path: '/w/a.txt' }),
      ask('toolu_ok', 'Read', { file_path: '/w/a.txt' }),
      toolResult('toolu_ok', 'content'),
      success(),
    ]
    const { events } = await run(provider({ checkMemoryPath: () => null }))
    expect(of(events, 'approval_required')).toHaveLength(0)
    expect(of(events, 'tool_result').map((e) => e.outcome)).toEqual(['success'])
  })
})

// ─── Compaction ─────────────────────────────────────────────────────────

describe('claude-code stream — compaction', () => {
  it('compact_boundary becomes a contextCompacted notice; no summary event reaches memory', async () => {
    h.script = [
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 180_000 } },
      // The old summary-carrying shape is not a notice and not a memory write.
      { type: 'system', subtype: 'compact', summary: 'a model-authored summary' },
      success(),
    ]
    const { events } = await run(provider())
    expect(of(events, 'notice')).toEqual([{ type: 'notice', code: 'contextCompacted', params: { trigger: 'auto', preTokens: 180_000 } }])
    expect(events.some((e) => (e as { type: string }).type === 'context_compact')).toBe(false)
    expect(JSON.stringify(events)).not.toContain('model-authored summary')
    assertStreamContract(events)
  })

  it('a compact_boundary without metadata is still a notice, without params', async () => {
    h.script = [{ type: 'system', subtype: 'compact_boundary' }, success()]
    const { events } = await run(provider())
    expect(of(events, 'notice')).toEqual([{ type: 'notice', code: 'contextCompacted' }])
  })
})
