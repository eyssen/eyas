// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F3 — reasoning continuity across a tool loop on the Anthropic API and on
// Anthropic-compatible endpoints. The REAL SDK runs against a stubbed fetch,
// so SSE parsing (thinking_delta / signature_delta) and request serialization
// are the SDK's own. A thinking block is captured with its signature, kept in
// API order, and replayed byte-unchanged to the provider that produced it —
// and to no other.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import { consumeAnthropicStream, toAnthropicMessages, fromAnthropicResponse } from '@modules/model/submodules/anthropic/adapter'
import type { ContentBlock, ModelMessage, ModelResponse, StreamEvent, ThinkingBlock } from '@modules/model/types'
import {
  anthropicWireStub,
  jsonResponse,
  sseResponse,
  thinkingThenToolUseEvents,
  textAnswerEvents,
  TEST_SIGNATURE,
} from '../../../helpers/anthropic-wire'

const COMPAT = ANTHROPIC_COMPAT_CATALOG[0]!

async function collect(stream: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; response: ModelResponse }> {
  const events: StreamEvent[] = []
  let response: ModelResponse | undefined
  for await (const e of stream) {
    events.push(e)
    if (e.type === 'done') response = e.response
  }
  return { events, response: response! }
}

/** The tool loop's continuation: the assistant turn replayed, then the tool result. */
function continuation(assistant: ContentBlock[]): ModelMessage[] {
  return [
    { role: 'user', content: 'Weather in Paris?' },
    { role: 'assistant', content: assistant },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'toolu_1', content: '{"sky":"clear"}' }] },
  ]
}

afterEach(() => vi.unstubAllGlobals())

describe('Anthropic API — thinking capture and replay (positive)', () => {
  it('a streamed thinking + tool_use turn keeps [thinking{signature}, tool_use] in API order', async () => {
    const wire = anthropicWireStub([() => sseResponse(thinkingThenToolUseEvents())])
    vi.stubGlobal('fetch', wire.fetch)
    const { events, response } = await collect(createAnthropicProvider('key').stream({
      model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'Weather in Paris?' }],
    }))

    expect(response.stopReason).toBe('tool_use')
    expect(response.content).toEqual([
      {
        type: 'thinking', thinking: 'The user wants the weather; call the tool.', signature: TEST_SIGNATURE,
        origin: 'anthropic', providerId: 'anthropic', modelId: 'claude-opus-4-8',
      },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } },
    ])
    // The reasoning still streams to the UI as it arrives.
    expect(events.filter((e) => e.type === 'thinking').map((e: any) => e.text).join('')).toBe('The user wants the weather; call the tool.')
  })

  it('the signature goes back byte-identical, before the tool_use, in the next request of the loop', async () => {
    const wire = anthropicWireStub([
      () => sseResponse(thinkingThenToolUseEvents()),
      () => sseResponse(textAnswerEvents()),
    ])
    vi.stubGlobal('fetch', wire.fetch)
    const provider = createAnthropicProvider('key')
    const first = await collect(provider.stream({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'Weather in Paris?' }] }))
    await collect(provider.stream({ model: 'claude-opus-4-8', messages: continuation(first.response.content) }))

    const replayed = wire.bodies()[1].messages[1]
    expect(replayed.role).toBe('assistant')
    expect(replayed.content).toEqual([
      { type: 'thinking', thinking: 'The user wants the weather; call the tool.', signature: TEST_SIGNATURE },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } },
    ])
    // Byte level: the exact signature string is on the wire (JSON-encoded as received).
    expect(wire.rawBodies[1]).toContain(`"signature":${JSON.stringify(TEST_SIGNATURE)}`)
  })

  it('a redacted_thinking block round-trips as redacted_thinking with its data unchanged', async () => {
    const data = 'EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpP=='
    const wire = anthropicWireStub([
      () => sseResponse([
        { type: 'message_start', message: { id: 'msg_r', type: 'message', role: 'assistant', model: 'claude-opus-4-8', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":"Paris"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 9 } },
      ]),
      () => sseResponse(textAnswerEvents()),
    ])
    vi.stubGlobal('fetch', wire.fetch)
    const provider = createAnthropicProvider('key')
    const first = await collect(provider.stream({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'Weather in Paris?' }] }))
    expect(first.response.content[0]).toEqual({
      type: 'thinking', thinking: '', redactedData: data, origin: 'anthropic', providerId: 'anthropic', modelId: 'claude-opus-4-8',
    })
    // Nothing of a redacted block reaches the UI.
    expect(first.events.some((e) => e.type === 'thinking')).toBe(false)

    await collect(provider.stream({ model: 'claude-opus-4-8', messages: continuation(first.response.content) }))
    expect(wire.bodies()[1].messages[1].content[0]).toEqual({ type: 'redacted_thinking', data })
  })

  it('non-streamed responses keep thinking and redacted_thinking and replay them byte-unchanged', async () => {
    const rawBlocks = [
      { type: 'thinking', thinking: 'Look it up.', signature: TEST_SIGNATURE },
      { type: 'redacted_thinking', data: 'RkFLRS1SRURBQ1RFRA==' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } },
    ]
    const wire = anthropicWireStub([
      () => jsonResponse({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-4-8-20260101', content: rawBlocks,
        stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 },
      }),
      () => jsonResponse({
        id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-4-8-20260101', content: [{ type: 'text', text: 'Sunny.' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 30, output_tokens: 3 },
      }),
    ])
    vi.stubGlobal('fetch', wire.fetch)
    const provider = createAnthropicProvider('key')
    const first = await provider.complete({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'Weather in Paris?' }] })
    expect(first.content.map((b) => b.type)).toEqual(['thinking', 'thinking', 'tool_use'])
    // Bound to the EYAS model id asked for, not the dated id the API reported.
    expect((first.content[0] as ThinkingBlock).modelId).toBe('claude-opus-4-8')

    await provider.complete({ model: 'claude-opus-4-8', messages: continuation(first.content) })
    expect(JSON.stringify(wire.bodies()[1].messages[1].content)).toBe(JSON.stringify(rawBlocks))
  })

  it('anthropic-compat produces the same events and blocks, bound to its own provider id', async () => {
    const wire = anthropicWireStub([
      () => sseResponse(thinkingThenToolUseEvents({ model: 'claude-opus-4-8' })),
      () => sseResponse(thinkingThenToolUseEvents({ model: 'claude-opus-4-8' })),
    ])
    vi.stubGlobal('fetch', wire.fetch)
    const api = await collect(createAnthropicProvider('key').stream({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'x' }] }))
    const compat = await collect(createAnthropicCompatProvider(COMPAT, 'key').stream({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'x' }] }))

    const streamed = (events: StreamEvent[]) => events.filter((e) => e.type !== 'done')
    expect(streamed(compat.events)).toEqual(streamed(api.events))
    const rebind = (blocks: ContentBlock[]) => blocks.map((b) => (b.type === 'thinking' ? { ...b, providerId: COMPAT.id } : b))
    expect(compat.response.content).toEqual(rebind(api.response.content))
    expect(compat.response.provider).toBe(COMPAT.id)
    expect(compat.response.usage).toEqual(api.response.usage)
    expect(compat.response.stopReason).toBe(api.response.stopReason)
  })

  it('anthropic-compat replays its own signed block before the tool_use', async () => {
    const wire = anthropicWireStub([
      () => sseResponse(thinkingThenToolUseEvents({ model: COMPAT.defaultModel })),
      () => sseResponse(textAnswerEvents('ok', COMPAT.defaultModel)),
    ])
    vi.stubGlobal('fetch', wire.fetch)
    const provider = createAnthropicCompatProvider(COMPAT, 'key')
    const first = await collect(provider.stream({ messages: [{ role: 'user', content: 'Weather in Paris?' }] }))
    await collect(provider.stream({ messages: continuation(first.response.content) }))
    expect(wire.bodies()[1].messages[1].content.map((b: any) => b.type)).toEqual(['thinking', 'tool_use'])
    expect(wire.bodies()[1].messages[1].content[0].signature).toBe(TEST_SIGNATURE)
  })
})

describe('Anthropic API — thinking replay boundaries (negative)', () => {
  const block = (over: Partial<ThinkingBlock> = {}): ThinkingBlock => ({
    type: 'thinking', thinking: 'why', signature: 'sig', origin: 'anthropic', providerId: 'anthropic', modelId: 'claude-opus-4-8', ...over,
  })
  const toolUse: ContentBlock = { type: 'tool_use', id: 't1', name: 'fn', input: {} }

  it('a block another provider produced is dropped (failover mid-loop)', () => {
    const out = toAnthropicMessages([{ role: 'assistant', content: [block({ providerId: COMPAT.id }), toolUse] }], 'anthropic')
    expect(out[0].content).toEqual([{ type: 'tool_use', id: 't1', name: 'fn', input: {} }])
  })

  it('a block of another dialect is dropped even for the same provider id', () => {
    const out = toAnthropicMessages([
      { role: 'assistant', content: [block({ origin: 'openai-reasoning-content' }), block({ origin: 'openrouter-reasoning-details' }), toolUse] },
    ], 'anthropic')
    expect(out[0].content.map((b: any) => b.type)).toEqual(['tool_use'])
  })

  it('an assistant turn left with nothing after the drop is sent as the placeholder, never as an empty block list', () => {
    const out = toAnthropicMessages([{ role: 'assistant', content: [block({ providerId: 'other' })] }], 'anthropic')
    expect(out[0]).toEqual({ role: 'assistant', content: '...' })
  })

  it('empty thinking is not filtered: an omitted-display block still carries its signature', () => {
    const out = toAnthropicMessages([
      { role: 'assistant', content: [block({ thinking: '' }), { type: 'text', text: '   ' }, toolUse] },
    ], 'anthropic')
    expect(out[0].content).toEqual([
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'fn', input: {} },
    ])
  })

  it('a streamed block whose text the API omitted is still captured', async () => {
    const events = thinkingThenToolUseEvents().filter((e: any) => e.delta?.type !== 'thinking_delta')
    const { response } = await collect(consumeAnthropicStream(
      (async function* () { for (const e of events) yield e })(),
      { providerId: 'anthropic', model: 'claude-opus-4-8' },
    ))
    expect(response.content[0]).toMatchObject({ type: 'thinking', thinking: '', signature: TEST_SIGNATURE })
  })

  it('the anthropic provider never sends a compat-produced block after a failover', async () => {
    const wire = anthropicWireStub([() => sseResponse(textAnswerEvents())])
    vi.stubGlobal('fetch', wire.fetch)
    await collect(createAnthropicProvider('key').stream({
      model: 'claude-opus-4-8',
      messages: continuation([block({ providerId: COMPAT.id, signature: 'compat-sig' }), { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} }]),
    }))
    expect(wire.rawBodies[0]).not.toContain('compat-sig')
    expect(wire.bodies()[0].messages[1].content.map((b: any) => b.type)).toEqual(['tool_use'])
  })

  it('a tool call whose input never finished streaming is not part of the content', async () => {
    const events = thinkingThenToolUseEvents().filter((e: any) => !(e.type === 'content_block_stop' && e.index === 1))
    const { response } = await collect(consumeAnthropicStream(
      (async function* () { for (const e of events) yield e })(),
      { providerId: 'anthropic', model: 'claude-opus-4-8' },
    ))
    expect(response.content.map((b) => b.type)).toEqual(['thinking'])
  })

  it('fromAnthropicResponse without an origin binds blocks to the anthropic provider (default)', () => {
    const out = fromAnthropicResponse({
      id: 'm', model: 'claude-opus-4-8', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'thinking', thinking: 'a', signature: 's' }, { type: 'server_tool_use', id: 'x', name: 'web_search', input: {} }],
    })
    // Unmodelled block types are left out rather than becoming empty text.
    expect(out.content).toEqual([{ type: 'thinking', thinking: 'a', signature: 's', origin: 'anthropic', providerId: 'anthropic', modelId: 'claude-opus-4-8' }])
  })
})
