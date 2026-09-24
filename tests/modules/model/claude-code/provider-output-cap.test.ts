// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// MISSED-M-1 — an isolated Claude Code completion honours
// ModelRequest.maxTokens. The runtime takes no output limit from EYAS (an
// isolated query only gets tools [] and maxTurns 1), so the provider counts
// the streamed answer: once it passes maxTokens × 4 characters the query is
// aborted and the call ends as done with stopReason 'max_tokens' and the
// answer clipped to the cap — never a throw, even when the SDK throws on its
// way out. A query with tools is not capped by maxTokens. Driven against a
// scripted Agent SDK query().

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelRequest, StreamEvent } from '@modules/model/types.js'
import type { CliSandboxDeps } from '@modules/model/cli-runtime/sandbox/index.js'

type Msg = Record<string, unknown>

const h = vi.hoisted(() => ({
  steps: [] as Array<Record<string, unknown>>,
  /** The query's AbortController signal, as the SDK got it. */
  signal: undefined as AbortSignal | undefined,
  /** How many scripted messages the provider pulled. */
  pulled: 0,
  /** The SDK's return() rejects, as a query torn down mid-stream may. */
  throwOnReturn: false,
  /** The order the query was stopped in: 'close' (Query.close()) and 'abort' (its AbortController). */
  stops: [] as string[],
}))

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
  return {
    query: (args: any) => {
      h.signal = args.options.abortController.signal
      h.signal!.addEventListener('abort', () => h.stops.push('abort'), { once: true })
      const messages: Msg[] = [fakeClaudeInit(args.options), ...h.steps]
      let i = 0
      const iterator: AsyncIterator<Msg> = {
        async next() {
          if (h.signal?.aborted) throw new Error('Claude Code process aborted by user')
          if (i >= messages.length) return { done: true, value: undefined }
          h.pulled++
          return { done: false, value: messages[i++]! }
        },
        async return() {
          if (h.throwOnReturn) throw new Error('Claude Code process aborted by user')
          return { done: true, value: undefined }
        },
      }
      return { [Symbol.asyncIterator]: () => iterator, close: () => { h.stops.push('close') } }
    },
    tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
    createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
  }
})

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { resetCliSandboxForTests } from '@modules/model/cli-runtime/sandbox/index.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'
import { checkStreamContract } from '../stream-contract/harness.js'

/** No kernel sandbox on this "host": no detection runs, the query still runs. */
const NO_SANDBOX: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'linux', which: () => null } }

let workspaces: string

beforeEach(() => {
  h.steps = []
  h.signal = undefined
  h.pulled = 0
  h.throwOnReturn = false
  h.stops = []
  workspaces = mkdtempSync(join(tmpdir(), 'eyas-cc-output-cap-'))
  vi.stubEnv('EYAS_WORKSPACES_DIR', workspaces)
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetCliSandboxForTests()
  rmSync(workspaces, { recursive: true, force: true })
})

const streamEvent = (event: Msg): Msg => ({ type: 'stream_event', parent_tool_use_id: null, event })
const messageStart = (id: string): Msg => streamEvent({ type: 'message_start', message: { id, model: 'claude-test', usage: { input_tokens: 10 } } })
const textDelta = (text: string): Msg => streamEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
const thinkingDelta = (thinking: string): Msg => streamEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking } })
const assistantText = (id: string, text: string): Msg => ({ type: 'assistant', parent_tool_use_id: null, message: { id, content: [{ type: 'text', text }] } })
const success = (result: string): Msg => ({ type: 'result', subtype: 'success', result, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 50 } })

/** An answer that runs past a 3-token cap (12 characters) in its second delta, then keeps talking. */
const LONG_ANSWER: Msg[] = [
  messageStart('m1'),
  textDelta('Hello, '),
  textDelta('world and much more'),
  thinkingDelta('THOUGHT-AFTER-CAP'),
  textDelta('TEXT-AFTER-CAP'),
  success('Hello, world and much moreTEXT-AFTER-CAP'),
]

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: 'user', content: 'title this' }],
  ...extra,
})

function provider() {
  return createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME, sandbox: NO_SANDBOX })
}

async function collect(stream: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; error?: unknown }> {
  const events: StreamEvent[] = []
  try {
    for await (const event of stream) events.push(event)
  } catch (error) {
    return { events, error }
  }
  return { events }
}

const doneOf = (events: StreamEvent[]) => events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done')
const streamedText = (events: readonly StreamEvent[]) => events.map((e) => (e.type === 'text' ? e.text : '')).join('')

describe('claude-code provider — the output cap of an isolated completion', () => {
  it('an answer past maxTokens × 4 characters aborts the query and ends as done{max_tokens} with the clipped answer', async () => {
    h.steps = LONG_ANSWER
    const { events, error } = await collect(provider().stream(request({ isolated: true, maxTokens: 3 })))

    expect(error).toBeUndefined()
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('max_tokens')
    expect(done.response.content).toEqual([{ type: 'text', text: 'Hello, world' }])
    expect(streamedText(events)).toBe('Hello, world')
    // The query was stopped at the cap — closed first, the SDK's documented
    // way, so a control request still in flight is dropped rather than
    // answered on an aborted pipe — and nothing after it was read or passed on.
    expect(h.stops).toEqual(['close', 'abort'])
    // init, message_start and the two deltas — the delta that passed the cap is the last.
    expect(h.pulled).toBe(4)
    expect(JSON.stringify(events)).not.toMatch(/AFTER-CAP/)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(checkStreamContract(events).violations).toEqual([])
  })

  it('an SDK that throws on its way out still leaves a done{max_tokens}, never an error', async () => {
    h.steps = LONG_ANSWER
    h.throwOnReturn = true
    const { events, error } = await collect(provider().stream(request({ isolated: true, maxTokens: 3 })))

    expect(error).toBeUndefined()
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('max_tokens')
    expect(done.response.content).toEqual([{ type: 'text', text: 'Hello, world' }])
  })

  it('an unstreamed assistant message is held to the cap the same way', async () => {
    h.steps = [assistantText('a1', 'x'.repeat(40)), success('x'.repeat(40))]
    const { events, error } = await collect(provider().stream(request({ isolated: true, maxTokens: 3 })))

    expect(error).toBeUndefined()
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('max_tokens')
    expect(done.response.content).toEqual([{ type: 'text', text: 'x'.repeat(12) }])
    expect(h.signal?.aborted).toBe(true)
  })

  it('an answer the runtime reports only in its result is clipped to the cap', async () => {
    h.steps = [success('y'.repeat(40))]
    const { events, error } = await collect(provider().stream(request({ isolated: true, maxTokens: 3 })))

    expect(error).toBeUndefined()
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('max_tokens')
    expect(done.response.content).toEqual([{ type: 'text', text: 'y'.repeat(12) }])
    // Usage the runtime reported stays reported.
    expect(done.response.usage).toMatchObject({ reported: true, outputTokens: 50 })
  })

  it('the same answer within maxTokens ends as done{end} with all of it (negative)', async () => {
    h.steps = [messageStart('m1'), textDelta('Hello, '), textDelta('world and much more'), success('Hello, world and much more')]
    const { events, error } = await collect(provider().stream(request({ isolated: true, maxTokens: 100 })))

    expect(error).toBeUndefined()
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('end')
    expect(done.response.content).toEqual([{ type: 'text', text: 'Hello, world and much more' }])
    expect(h.stops).toEqual([])
  })

  it('a query with tools is not capped by maxTokens: the whole answer, no abort (negative)', async () => {
    h.steps = [messageStart('m1'), textDelta('Hello, '), textDelta('world and much more'), success('Hello, world and much more')]
    const { events, error } = await collect(provider().stream(request({ maxTokens: 3 })))

    expect(error).toBeUndefined()
    const done = doneOf(events)!
    expect(done.response.stopReason).toBe('end')
    expect(done.response.content).toEqual([{ type: 'text', text: 'Hello, world and much more' }])
    expect(h.signal?.aborted).toBe(false)
  })

  it('an isolated completion without maxTokens is not capped (negative)', async () => {
    h.steps = [messageStart('m1'), textDelta('Hello, '), textDelta('world and much more'), success('Hello, world and much more')]
    const { events, error } = await collect(provider().stream(request({ isolated: true })))

    expect(error).toBeUndefined()
    expect(doneOf(events)!.response.stopReason).toBe('end')
    expect(h.signal?.aborted).toBe(false)
  })
})
