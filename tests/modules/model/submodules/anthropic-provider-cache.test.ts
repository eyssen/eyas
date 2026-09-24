// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I13 — prompt caching on the Anthropic API provider, checked on the wire the
// REAL @anthropic-ai/sdk serializes (a stubbed fetch, no module mock):
//   - a breakpoint on the turn-stable system prompt;
//   - a breakpoint at the end of the history before the current turn, never
//     on the turn's own messages and never on a thinking block;
//   - top-level automatic caching on a request that offers tools only;
//   - the cache usage the API reports reaches ModelUsage;
//   - Anthropic-compatible endpoints get no cache_control at all.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import type { ModelMessage, ModelRequest, ModelResponse, StreamEvent, ToolDefinition } from '@modules/model/types'
import { anthropicWireStub, jsonResponse, sseResponse, textAnswerEvents, thinkingThenToolUseEvents, TEST_SIGNATURE } from '../../../helpers/anthropic-wire'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6'
const SYSTEM = 'You are EYAS. Stable identity and rules for every turn of this conversation.'
const EPHEMERAL = { type: 'ephemeral' }

const TOOLS: ToolDefinition[] = [
  { name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } },
]

/** A turn's user message as the runner sends it: the turn block rides on it. */
const TURN_MESSAGE = '<turn-context>Now: 2026-09-23 10:00</turn-context>\n\nAnd tomorrow?'

/** Two finished turns, then the current one (string content, as the chat route rebuilds history). */
const HISTORY: ModelMessage[] = [
  { role: 'user', content: 'Weather in Paris?' },
  { role: 'assistant', content: 'It is sunny in Paris.' },
  { role: 'user', content: TURN_MESSAGE },
]

/** The same turn after one tool iteration: the model called a tool and got its result. */
const TOOL_LOOP: ModelMessage[] = [
  ...HISTORY,
  { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }] },
  { role: 'user', content: [{ type: 'tool_result', toolUseId: 'toolu_1', content: 'Rain tomorrow.' }] },
]

const ask = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  model: MODEL,
  system: SYSTEM,
  messages: [{ role: 'user', content: 'hi' }],
  ...extra,
})

/** A non-streamed Message with the cache counts the API reports. */
const okMessage = (usage: Record<string, number> = { input_tokens: 5, output_tokens: 2 }) => () => jsonResponse({
  id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'end_turn', stop_sequence: null, usage,
})

async function drain(stream: AsyncIterable<StreamEvent>): Promise<ModelResponse | null> {
  let done: ModelResponse | null = null
  for await (const event of stream) if (event.type === 'done') done = event.response
  return done
}

/** Every message block of a sent body that carries a cache breakpoint, as [messageIndex, block]. */
function markedBlocks(body: any): Array<[number, any]> {
  const marked: Array<[number, any]> = []
  body.messages.forEach((message: any, index: number) => {
    if (!Array.isArray(message.content)) return
    for (const block of message.content) if (block.cache_control) marked.push([index, block])
  })
  return marked
}

const countMarkers = (raw: string) => raw.split('"cache_control"').length - 1

afterEach(() => vi.unstubAllGlobals())

// ─── System prompt + top-level automatic caching ─────────────────────────────

describe('Anthropic API prompt caching — breakpoints (positive)', () => {
  it('complete(): the system prompt goes as one text block with a 5-minute breakpoint, byte-identical text', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask())
    const [body] = w.bodies()
    expect(body.system).toEqual([{ type: 'text', text: SYSTEM, cache_control: EPHEMERAL }])
  })

  it('complete() with tools: top-level automatic caching as well', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask({ tools: TOOLS }))
    const [body] = w.bodies()
    expect(body.cache_control).toEqual(EPHEMERAL)
    expect(body.system[0].cache_control).toEqual(EPHEMERAL)
  })

  it('stream() with tools: the same system breakpoint and top-level automatic caching', async () => {
    const w = anthropicWireStub([() => sseResponse(textAnswerEvents('ok', MODEL))])
    vi.stubGlobal('fetch', w.fetch)
    await drain(createAnthropicProvider('k').stream(ask({ tools: TOOLS })))
    const [body] = w.bodies()
    expect(body.stream).toBe(true)
    expect(body.cache_control).toEqual(EPHEMERAL)
    expect(body.system).toEqual([{ type: 'text', text: SYSTEM, cache_control: EPHEMERAL }])
  })

  it('a later turn: the breakpoint ends the history before the turn, not on the turn message', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask({ messages: HISTORY }))
    const [body] = w.bodies()
    // The previous answer becomes the one text block it stands for, marked.
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'It is sunny in Paris.', cache_control: EPHEMERAL }] })
    expect(markedBlocks(body).map(([index]) => index)).toEqual([1])
    // The turn message (with its turn block) and the earlier messages are sent unchanged.
    expect(body.messages[0]).toEqual({ role: 'user', content: 'Weather in Paris?' })
    expect(body.messages[2]).toEqual({ role: 'user', content: TURN_MESSAGE })
  })

  it('a tool iteration: the history breakpoint stays before the user message that started the turn', async () => {
    const w = anthropicWireStub([() => sseResponse(textAnswerEvents('Rain.', MODEL))])
    vi.stubGlobal('fetch', w.fetch)
    await drain(createAnthropicProvider('k').stream(ask({ messages: TOOL_LOOP, tools: TOOLS })))
    const [body] = w.bodies()
    expect(markedBlocks(body).map(([index]) => index)).toEqual([1])
    // The tool round trip is left to the automatic breakpoint.
    expect(body.messages[3].content[0]).not.toHaveProperty('cache_control')
    expect(body.messages[4].content[0]).not.toHaveProperty('cache_control')
    expect(body.cache_control).toEqual(EPHEMERAL)
  })

  it('at most three of the four breakpoints the API allows (system, history, automatic)', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask({ messages: TOOL_LOOP, tools: TOOLS }))
    expect(countMarkers(w.rawBodies[0]!)).toBe(3)
  })
})

describe('Anthropic API prompt caching — where no breakpoint goes (negative)', () => {
  it('a request without tools gets no top-level automatic caching (complete and stream)', async () => {
    const w = anthropicWireStub([okMessage(), () => sseResponse(textAnswerEvents('ok', MODEL))])
    vi.stubGlobal('fetch', w.fetch)
    const provider = createAnthropicProvider('k')
    await provider.complete(ask())
    await drain(provider.stream(ask()))
    for (const body of w.bodies()) {
      expect(body).not.toHaveProperty('cache_control')
      expect(body.system[0].cache_control).toEqual(EPHEMERAL)
    }
  })

  it('a first turn has no history to mark: no message carries a breakpoint', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask({ messages: [{ role: 'user', content: TURN_MESSAGE }], tools: TOOLS }))
    const [body] = w.bodies()
    expect(markedBlocks(body)).toEqual([])
    expect(body.messages[0].content).toBe(TURN_MESSAGE)
  })

  it('never on a thinking block: the breakpoint walks back to the last block that can carry one', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'It is sunny.' },
          { type: 'thinking', thinking: 'done', signature: TEST_SIGNATURE, origin: 'anthropic', providerId: 'anthropic', modelId: MODEL },
        ],
      },
      { role: 'user', content: TURN_MESSAGE },
    ]
    await createAnthropicProvider('k').complete(ask({ messages }))
    const [body] = w.bodies()
    expect(body.messages[1].content[1].type).toBe('thinking')
    expect(body.messages[1].content[1]).not.toHaveProperty('cache_control')
    expect(body.messages[1].content[0]).toEqual({ type: 'text', text: 'It is sunny.', cache_control: EPHEMERAL })
  })

  it('a whitespace-only system prompt goes as a plain string, without a breakpoint', async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask({ system: '   ' }))
    const [body] = w.bodies()
    expect(body.system).toBe('   ')
  })

  it("no system prompt: no system field at all", async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    await createAnthropicProvider('k').complete(ask({ system: undefined }))
    const [body] = w.bodies()
    expect(body).not.toHaveProperty('system')
  })

  it("the caller's messages are never changed", async () => {
    const w = anthropicWireStub([okMessage()])
    vi.stubGlobal('fetch', w.fetch)
    const messages = structuredClone(TOOL_LOOP)
    await createAnthropicProvider('k').complete(ask({ messages, tools: TOOLS }))
    expect(messages).toEqual(TOOL_LOOP)
    expect(JSON.stringify(messages)).not.toContain('cache_control')
  })
})

// ─── Usage ───────────────────────────────────────────────────────────────────

describe('Anthropic API prompt caching — usage', () => {
  it('complete(): cache reads and writes reach ModelUsage, input stays the uncached part (positive)', async () => {
    vi.stubGlobal('fetch', anthropicWireStub([okMessage({ input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 })]).fetch)
    const response = await createAnthropicProvider('k').complete(ask({ tools: TOOLS }))
    expect(response.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 900, cacheCreationTokens: 40 })
  })

  it('stream(): the cache counts from message_start reach the done usage (positive)', async () => {
    vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(thinkingThenToolUseEvents({ model: MODEL }))]).fetch)
    const done = await drain(createAnthropicProvider('k').stream(ask({ tools: TOOLS })))
    expect(done?.usage).toMatchObject({ inputTokens: 12, cacheReadTokens: 300, cacheCreationTokens: 40 })
  })

  it('a response without cache activity reports no cache counts (negative)', async () => {
    vi.stubGlobal('fetch', anthropicWireStub([okMessage({ input_tokens: 5, output_tokens: 2 })]).fetch)
    const response = await createAnthropicProvider('k').complete(ask())
    expect(response.usage).not.toHaveProperty('cacheReadTokens')
    expect(response.usage).not.toHaveProperty('cacheCreationTokens')
  })
})

// ─── Anthropic-compatible endpoints ──────────────────────────────────────────

describe('Anthropic-compatible endpoints — no prompt caching (negative)', () => {
  const compat = ANTHROPIC_COMPAT_CATALOG[0]!

  it('complete() and stream() send no cache_control anywhere; the system stays a plain string', async () => {
    const w = anthropicWireStub([
      okMessage(),
      () => sseResponse(textAnswerEvents('ok', compat.defaultModel)),
    ])
    vi.stubGlobal('fetch', w.fetch)
    const provider = createAnthropicCompatProvider(compat, 'k')
    const request = ask({ model: compat.defaultModel, messages: TOOL_LOOP, tools: TOOLS })
    await provider.complete(request)
    await drain(provider.stream(request))
    expect(w.rawBodies).toHaveLength(2)
    for (const raw of w.rawBodies) {
      expect(raw).not.toContain('cache_control')
      expect(JSON.parse(raw).system).toBe(SYSTEM)
    }
  })
})
