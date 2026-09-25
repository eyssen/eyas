// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G8 — a Claude Code query is stopped only when the CLI goes quiet, never by
// a fixed whole-turn clock. While a tool is in flight (a bridged
// run_specialist may run 15 minutes without a single SDK message) the tool
// budget applies; with no tool in flight, the idle budget. A query the
// watchdog stops fails with a TimeoutError that classifies as 'timeout' —
// not with the SDK's "aborted by user" ('aborted'), which stays reserved for
// the operator's Stop. Driven with fake timers against a scripted SDK that,
// like the real one, throws when its AbortController fires.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyModelError } from '@shared/classify-model-error.js'
import type { ModelRequest, StreamEvent } from '@modules/model/types.js'
import type { CliSandboxDeps } from '@modules/model/cli-runtime/sandbox/index.js'

type Step = { msg: Record<string, unknown> } | { sleepMs: number }

const h = vi.hoisted(() => ({ steps: [] as Array<{ msg: Record<string, unknown> } | { sleepMs: number }>, queries: 0 }))

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  // Loaded before any fake timer is installed.
  const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
  /** A pause the SDK's AbortController ends the way the real SDK does: with a throw. */
  const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new Error('Claude Code process aborted by user'))
    if (signal.aborted) return aborted()
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      aborted()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return {
    query: (args: any) => (async function* () {
      h.queries++
      const signal: AbortSignal = args.options.abortController.signal
      yield fakeClaudeInit(args.options)
      for (const step of h.steps) {
        if ('sleepMs' in step) await pause(step.sleepMs, signal)
        else yield step.msg
      }
    })(),
    tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
    createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
  }
})

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { resetCliSandboxForTests } from '@modules/model/cli-runtime/sandbox/index.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const MIN = 60_000

/** No kernel sandbox on this "host": no detection runs, the query still runs. */
const NO_SANDBOX: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'linux', which: () => null } }

let workspaces: string

beforeEach(() => {
  h.steps = []
  h.queries = 0
  workspaces = mkdtempSync(join(tmpdir(), 'eyas-cc-watchdog-'))
  vi.stubEnv('EYAS_WORKSPACES_DIR', workspaces)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  resetCliSandboxForTests()
  rmSync(workspaces, { recursive: true, force: true })
})

const assistantToolUse = (id: string, name: string): Step => ({
  msg: {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { id: `msg-${id}`, content: [{ type: 'tool_use', id, name, input: { task: 'research' } }] },
  },
})
const toolResult = (id: string, text: string): Step => ({
  msg: {
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  },
})
const assistantText = (id: string, text: string): Step => ({
  msg: { type: 'assistant', parent_tool_use_id: null, message: { id, content: [{ type: 'text', text }] } },
})
const success = (text: string): Step => ({
  msg: { type: 'result', subtype: 'success', result: text, stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } },
})

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: 'user', content: 'research this' }],
  ...extra,
})

/** Drain the stream while the fake clock runs forward far enough for every scripted pause. */
async function run(stream: AsyncIterable<StreamEvent>, advanceMs: number): Promise<{ events: StreamEvent[]; error?: unknown }> {
  const events: StreamEvent[] = []
  const drained = (async () => {
    try {
      for await (const event of stream) events.push(event)
      return { events }
    } catch (error) {
      return { events, error }
    }
  })()
  await vi.advanceTimersByTimeAsync(advanceMs)
  return drained
}

function provider(turnTimeouts?: () => { idleMs?: number; toolMs?: number }) {
  return createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME, sandbox: NO_SANDBOX, ...(turnTimeouts ? { turnTimeouts } : {}) })
}

describe('claude-code provider — turn watchdog', () => {
  it('a scripted 12-minute bridged tool call completes: the tool budget applies while it runs', async () => {
    h.steps = [
      assistantToolUse('tu-1', 'mcp__eyas__run_specialist'),
      { sleepMs: 12 * MIN },
      toolResult('tu-1', 'specialist report'),
      assistantText('msg-2', 'done'),
      success('done'),
    ]
    const { events, error } = await run(provider().stream(request()), 13 * MIN)

    expect(error).toBeUndefined()
    const result = events.find((e) => e.type === 'tool_result')
    expect(result).toMatchObject({ type: 'tool_result', toolUseId: 'tu-1', outcome: 'success', executedBy: 'eyas' })
    const done = events.find((e) => e.type === 'done')
    expect(done && done.type === 'done' ? done.response.stopReason : undefined).toBe('end')
  })

  it('a silent 11-minute gap with no tool in flight aborts at the 10-minute idle limit, as a timeout', async () => {
    h.steps = [
      assistantText('msg-1', 'thinking out loud'),
      { sleepMs: 11 * MIN },
      success('too late'),
    ]
    const { events, error } = await run(provider().stream(request()), 12 * MIN)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('TimeoutError')
    expect((error as Error).message).toMatch(/Claude Code turn timed out: no activity for 600s/)
    // The SDK's own "aborted by user" never reaches the caller.
    expect((error as Error).message).not.toMatch(/aborted by user/)
    expect(classifyModelError(error)).toMatchObject({ kind: 'timeout', retryable: true })
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('a tool that stays silent past the tool budget is stopped too', async () => {
    h.steps = [
      assistantToolUse('tu-1', 'Bash'),
      { sleepMs: 30 * MIN },
      toolResult('tu-1', 'never'),
      success('never'),
    ]
    const { error } = await run(provider(() => ({ idleMs: 1 * MIN, toolMs: 5 * MIN })).stream(request()), 6 * MIN)

    expect((error as Error).message).toMatch(/no activity for 300s while a tool was running/)
    expect(classifyModelError(error).kind).toBe('timeout')
  })

  it('once the tool settled, the idle budget applies again', async () => {
    h.steps = [
      assistantToolUse('tu-1', 'Bash'),
      { sleepMs: 3 * MIN },
      toolResult('tu-1', 'ok'),
      { sleepMs: 2 * MIN },
      success('never'),
    ]
    const { error } = await run(provider(() => ({ idleMs: 1 * MIN, toolMs: 5 * MIN })).stream(request()), 6 * MIN)

    // 3 minutes of tool silence passed (tool budget 5); the 2 idle minutes after it did not (idle budget 1).
    expect((error as Error).message).toMatch(/no activity for 60s$/)
    expect(classifyModelError(error).kind).toBe('timeout')
  })

  it("the operator's Stop stays 'aborted', not 'timeout'", async () => {
    h.steps = [assistantText('msg-1', 'working'), { sleepMs: 5 * MIN }, success('never')]
    const controller = new AbortController()
    const stream = provider().stream(request({ signal: controller.signal }))
    const drained = (async () => {
      try {
        for await (const _event of stream) { /* drain */ }
        return { error: undefined as unknown }
      } catch (error) {
        return { error }
      }
    })()
    await vi.advanceTimersByTimeAsync(MIN)
    controller.abort()
    const { error } = await drained

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).not.toBe('TimeoutError')
    expect(classifyModelError(error).kind).toBe('aborted')
  })

  it('reads the timeouts from the lazy getter at every query (reload-safe)', async () => {
    let idleMs = 10 * MIN
    const getter = vi.fn(() => ({ idleMs, toolMs: 20 * MIN }))
    const p = provider(getter)
    h.steps = [assistantText('msg-1', 'a'), { sleepMs: 3 * MIN }, success('a')]

    // Positive: 3 silent minutes are within the configured 10.
    expect((await run(p.stream(request()), 4 * MIN)).error).toBeUndefined()

    // The operator lowers the idle limit: the next query runs on it.
    idleMs = 2 * MIN
    const second = await run(p.stream(request()), 4 * MIN)
    expect(classifyModelError(second.error).kind).toBe('timeout')
    expect((second.error as Error).message).toMatch(/no activity for 120s/)
    expect(getter).toHaveBeenCalledTimes(2)
  })

  it('a getter that throws or returns nonsense falls back to the defaults, never to an instant abort', async () => {
    h.steps = [assistantText('msg-1', 'a'), { sleepMs: 9 * MIN }, success('a')]
    const broken = provider(() => { throw new Error('config gone') })
    expect((await run(broken.stream(request()), 10 * MIN)).error).toBeUndefined()

    const nonsense = provider(() => ({ idleMs: 0, toolMs: -5 }))
    expect((await run(nonsense.stream(request()), 10 * MIN)).error).toBeUndefined()
  })
})
