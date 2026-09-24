// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelRequest, ModelResponse, StreamEvent, ToolUseBlock } from '@modules/model/types'

// Mock the Gemini SDK: the provider's requests are inspected and its streams
// scripted without any network call.
const { generateContent, generateContentStream } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent, generateContentStream, list: vi.fn() }
    constructor(_opts: unknown) {}
  },
}))

// Import AFTER the mock is registered.
import { createGeminiProvider } from '@modules/model/submodules/gemini/provider'

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { model: 'gemini-3-pro', messages: [{ role: 'user', content: 'find it' }], ...overrides }
}

function chunks(...items: unknown[]) {
  return (async function* () { for (const item of items) yield item })()
}

async function drain(stream: AsyncIterable<StreamEvent>) {
  const events: StreamEvent[] = []
  for await (const e of stream) events.push(e)
  const done = events.find((e) => e.type === 'done') as { type: 'done'; response: ModelResponse }
  return { events, response: done.response }
}

/** A Gemini 2.x-style streamed turn: text, then one call without an id, finishing STOP. */
function callTurnWithoutIds() {
  return chunks(
    { responseId: 'r1', modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'Looking' }] } }] },
    {
      candidates: [{ content: { parts: [{ functionCall: { name: 'memory_search', args: { query: 'q' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    },
  )
}

describe('Gemini provider — stream()', () => {
  beforeEach(() => {
    generateContentStream.mockReset()
  })

  it('opens each tool row with the id the final tool_use block carries', async () => {
    generateContentStream.mockResolvedValueOnce(callTurnWithoutIds())
    const provider = createGeminiProvider('k')
    const { events, response } = await drain(provider.stream(request({ tools: [{ name: 'memory_search', description: 'd', inputSchema: {} }] })))

    const starts = events.filter((e) => e.type === 'tool_use_start') as Array<{ id: string; name: string }>
    expect(starts).toHaveLength(1)
    const block = response.content.find((b) => b.type === 'tool_use') as ToolUseBlock
    expect(starts[0]).toMatchObject({ id: block.id, name: 'memory_search' })
    // The row settles on the runner's tool_result, never before the call ran.
    expect(events.some((e) => (e as { type: string }).type === 'tool_use_end')).toBe(false)
  })

  it('stops a STOP-finished function-call turn for tool_use, text block first', async () => {
    generateContentStream.mockResolvedValueOnce(callTurnWithoutIds())
    const { response } = await drain(createGeminiProvider('k').stream(request()))
    expect(response.stopReason).toBe('tool_use')
    expect(response.content.map((b) => b.type)).toEqual(['text', 'tool_use'])
  })

  it('never reuses an id across two consecutive streams', async () => {
    generateContentStream.mockResolvedValueOnce(callTurnWithoutIds()).mockResolvedValueOnce(callTurnWithoutIds())
    const provider = createGeminiProvider('k')
    const first = await drain(provider.stream(request()))
    const second = await drain(provider.stream(request()))
    const idOf = (r: ModelResponse) => (r.content.find((b) => b.type === 'tool_use') as ToolUseBlock).id
    expect(idOf(first.response)).not.toBe(idOf(second.response))
  })

  it("keeps Gemini's call id and thoughtSignature and replays both on the next request", async () => {
    generateContentStream.mockResolvedValueOnce(chunks({
      candidates: [{
        content: { parts: [{ functionCall: { id: 'fc-1', name: 'memory_search', args: { query: 'q' } }, thoughtSignature: 'U0lHLTE=' }] },
        finishReason: 'STOP',
      }],
    }))
    const provider = createGeminiProvider('k')
    const { response } = await drain(provider.stream(request()))
    expect(response.content).toEqual([
      { type: 'tool_use', id: 'fc-1', name: 'memory_search', input: { query: 'q' }, signature: 'U0lHLTE=' },
    ])

    generateContentStream.mockResolvedValueOnce(chunks({ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] }))
    await drain(provider.stream(request({
      messages: [
        { role: 'user', content: 'find it' },
        { role: 'assistant', content: response.content },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'fc-1', content: 'found' }] },
      ],
    })))
    const contents = generateContentStream.mock.calls[1][0].contents
    expect(contents[1].parts[0]).toEqual({
      functionCall: { id: 'fc-1', name: 'memory_search', args: { query: 'q' } },
      thoughtSignature: 'U0lHLTE=',
    })
    expect(contents[2].parts[0]).toEqual({ functionResponse: { id: 'fc-1', name: 'memory_search', response: { result: 'found' } } })
  })

  it('ends a text-only turn with end and opens no tool row', async () => {
    generateContentStream.mockResolvedValueOnce(chunks({ candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] }))
    const { events, response } = await drain(createGeminiProvider('k').stream(request()))
    expect(response.stopReason).toBe('end')
    expect(events.some((e) => e.type === 'tool_use_start')).toBe(false)
  })

  it('keeps max_tokens when a call was cut off', async () => {
    generateContentStream.mockResolvedValueOnce(chunks({
      candidates: [{ content: { parts: [{ functionCall: { id: 'fc-1', name: 'memory_search', args: {} } }] }, finishReason: 'MAX_TOKENS' }],
    }))
    const { response } = await drain(createGeminiProvider('k').stream(request()))
    expect(response.stopReason).toBe('max_tokens')
  })

  it.each(['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT'])('maps the safety-class finish %s to refusal (positive)', async (finishReason) => {
    generateContentStream.mockResolvedValueOnce(chunks(
      { candidates: [{ content: { parts: [{ text: 'Part' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason }] },
    ))
    const { response } = await drain(createGeminiProvider('k').stream(request()))
    expect(response.stopReason).toBe('refusal')
  })

  it('a prompt the backend blocked (no candidate, promptFeedback.blockReason) stops for refusal (positive)', async () => {
    generateContentStream.mockResolvedValueOnce(chunks({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }))
    const { response } = await drain(createGeminiProvider('k').stream(request()))
    expect(response.stopReason).toBe('refusal')
    expect(response.content).toEqual([])
  })

  it('an unspecified blockReason or a plain OTHER finish is not a refusal (negative)', async () => {
    generateContentStream.mockResolvedValueOnce(chunks({ promptFeedback: { blockReason: 'BLOCKED_REASON_UNSPECIFIED' } }))
    expect((await drain(createGeminiProvider('k').stream(request()))).response.stopReason).toBe('end')
    generateContentStream.mockResolvedValueOnce(chunks({ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'OTHER' }] }))
    expect((await drain(createGeminiProvider('k').stream(request()))).response.stopReason).toBe('end')
  })
})

describe('Gemini provider — complete()', () => {
  beforeEach(() => {
    generateContent.mockReset()
  })

  it('returns tool_use for a function-call response that finished with STOP', async () => {
    generateContent.mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ functionCall: { id: 'fc-3', name: 'memory_search', args: {} } }] }, finishReason: 'STOP' }],
    })
    const response = await createGeminiProvider('k').complete(request())
    expect(response.stopReason).toBe('tool_use')
    expect(response.content[0]).toMatchObject({ type: 'tool_use', id: 'fc-3' })
  })

  it("returns 'refusal' for a SAFETY finish and for a blocked prompt (positive)", async () => {
    generateContent.mockResolvedValueOnce({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] })
    expect((await createGeminiProvider('k').complete(request())).stopReason).toBe('refusal')
    generateContent.mockResolvedValueOnce({ promptFeedback: { blockReason: 'SAFETY' } })
    expect((await createGeminiProvider('k').complete(request())).stopReason).toBe('refusal')
  })
})
