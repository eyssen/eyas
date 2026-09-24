// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The real OpenAI SDK against a fake global fetch: provider tests see the
// exact JSON body the SDK puts on the wire (untyped fields such as `thinking`
// or `reasoning` included) and answer with a JSON completion or an SSE
// stream. No network, no key. The SDK captures fetch when the client is
// constructed, so install the stub BEFORE creating the provider.

import { vi } from 'vitest'

export interface OpenAIWire {
  /** Every chat/completions request body sent so far, parsed. */
  bodies: Array<Record<string, any>>
  /** The next responses are this non-streamed completion. */
  respondWith(json: unknown): void
  /** The next responses are this stream of chunks (sent as SSE, then [DONE]). */
  respondWithStream(chunks: unknown[]): void
  /** Other endpoints (e.g. GET /models) answer with this JSON, keyed by a URL substring. */
  route(urlPart: string, json: unknown): void
  restore(): void
}

export function installOpenAIWire(): OpenAIWire {
  const bodies: Array<Record<string, any>> = []
  const routes = new Map<string, unknown>()
  let next: { kind: 'json'; json: unknown } | { kind: 'sse'; chunks: unknown[] } = { kind: 'json', json: {} }

  const fake = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: string })?.url ?? input)
    for (const [part, json] of routes) {
      if (url.includes(part)) return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body))
    if (next.kind === 'json') {
      return new Response(JSON.stringify(next.json), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const sse = next.chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
  vi.stubGlobal('fetch', fake)

  return {
    bodies,
    respondWith(json) { next = { kind: 'json', json } },
    respondWithStream(chunks) { next = { kind: 'sse', chunks } },
    route(urlPart, json) { routes.set(urlPart, json) },
    restore() { vi.unstubAllGlobals() },
  }
}

/** A plain chat completion answering `content` (for request-side tests). */
export function okCompletion(model = 'm', content = 'ok'): Record<string, unknown> {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }
}
