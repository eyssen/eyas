// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A stubbed `fetch` for the REAL @anthropic-ai/sdk: tests exercise the SDK's
// own SSE parsing and request serialization instead of vi.mock-ing it away.
// The SDK captures the global fetch when a client is constructed, so install
// the stub (vi.stubGlobal) BEFORE creating the provider under test.

/** One Messages API stream event, serialized the way the API sends it. */
export function sseFrame(event: Record<string, unknown>): string {
  return `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`
}

/** A 200 text/event-stream response carrying `events` in order. */
export function sseResponse(events: Array<Record<string, unknown>>): Response {
  return new Response(events.map(sseFrame).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** A 200 application/json response (a non-streamed Message). */
export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export interface AnthropicWireStub {
  /** Pass to vi.stubGlobal('fetch', …). */
  fetch: (input: unknown, init?: { body?: unknown }) => Promise<Response>
  /** The raw request bodies sent, in order (exact bytes). */
  rawBodies: string[]
  /** The request bodies sent, parsed. */
  bodies(): any[]
}

/**
 * A fetch that answers each call with the next response factory in `replies`
 * (a fresh Response per call) and records every request body verbatim.
 */
export function anthropicWireStub(replies: Array<() => Response>): AnthropicWireStub {
  const rawBodies: string[] = []
  let call = 0
  return {
    rawBodies,
    bodies: () => rawBodies.map((b) => JSON.parse(b)),
    fetch: async (_input, init) => {
      rawBodies.push(typeof init?.body === 'string' ? init.body : '')
      const next = replies[call++]
      if (!next) throw new Error(`anthropic wire stub: no reply for call ${call}`)
      return next()
    },
  }
}

/** A signature with the characters a base64 token carries, to prove byte-identical replay. */
export const TEST_SIGNATURE = 'EqQBCkYIBxgCKkBv+/Zz9wQ3mPq0=='

/**
 * One streamed assistant turn: a signed thinking block (thinking_delta +
 * signature_delta) followed by a tool call, exactly as the Messages API
 * streams it, with cache usage at message_start.
 */
export function thinkingThenToolUseEvents(opts: { model?: string; signature?: string; thinking?: string } = {}): Array<Record<string, unknown>> {
  const signature = opts.signature ?? TEST_SIGNATURE
  const thinking = opts.thinking ?? 'The user wants the weather; call the tool.'
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_1', type: 'message', role: 'assistant', model: opts.model ?? 'claude-opus-4-8',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thinking.slice(0, 10) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thinking.slice(10) } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"Paris"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 42 } },
    { type: 'message_stop' },
  ]
}

/** A plain streamed text answer that ends the turn. */
export function textAnswerEvents(text = 'It is sunny.', model = 'claude-opus-4-8'): Array<Record<string, unknown>> {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_2', type: 'message', role: 'assistant', model,
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 30, output_tokens: 1 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]
}
