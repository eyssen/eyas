import { describe, it, expect } from 'vitest'
import {
  toGeminiContents,
  toGeminiTools,
  fromGeminiResponse,
} from '@modules/model/submodules/gemini/adapter'
import type { ModelMessage, ToolDefinition, ToolUseBlock } from '@modules/model/types'

const SYNTHESIZED = /^gemini-call-[0-9a-f-]{36}$/

function rawResponse(parts: unknown[], finishReason = 'STOP') {
  return {
    responseId: 'resp-x',
    candidates: [{ content: { role: 'model', parts }, finishReason }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    modelVersion: 'gemini-3-pro',
  }
}

describe('Gemini adapter', () => {
  describe('toGeminiContents', () => {
    it('converts user text message', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
      const result = toGeminiContents(messages)
      expect(result).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }])
    })

    it('converts assistant to model role', () => {
      const messages: ModelMessage[] = [{ role: 'assistant', content: 'hi' }]
      const result = toGeminiContents(messages)
      expect(result[0].role).toBe('model')
    })

    it('converts tool_use to a functionCall part that replays Gemini\'s call id', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } }],
      }]
      const result = toGeminiContents(messages)
      expect(result[0].parts[0]).toEqual({
        functionCall: { id: 't1', name: 'search', args: { q: 'weather' } },
      })
    })

    it('answers a call with functionResponse named after the FUNCTION, carrying the call id', () => {
      const messages: ModelMessage[] = [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'fc-9', name: 'memory_search', input: { query: 'x' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'fc-9', content: 'found' }] },
      ]
      const result = toGeminiContents(messages)
      expect(result[1]).toEqual({
        role: 'user',
        parts: [{ functionResponse: { id: 'fc-9', name: 'memory_search', response: { result: 'found' } } }],
      })
      expect(result[1].parts[0].functionResponse.name).not.toBe('fc-9')
    })

    it('reports a failed tool as an error response', () => {
      const messages: ModelMessage[] = [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'fc-1', name: 'read_file', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'fc-1', content: 'ENOENT', isError: true }] },
      ]
      expect(toGeminiContents(messages)[1].parts[0].functionResponse.response).toEqual({ error: 'ENOENT' })
    })

    it('never sends an EYAS-synthesized id to Gemini (Gemini 2.x issued none)', () => {
      const [block] = fromGeminiResponse(rawResponse([{ functionCall: { name: 'search', args: {} } }])).content as ToolUseBlock[]
      expect(block.id).toMatch(SYNTHESIZED)
      const result = toGeminiContents([
        { role: 'assistant', content: [block] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: block.id, content: 'ok' }] },
      ])
      expect(result[0].parts[0]).toEqual({ functionCall: { name: 'search', args: {} } })
      expect(result[1].parts[0]).toEqual({ functionResponse: { name: 'search', response: { result: 'ok' } } })
    })

    it('keeps the id as the name only for an orphan result whose call is not in the history', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: '72°F' }],
      }]
      const result = toGeminiContents(messages)
      expect(result[0].parts[0]).toEqual({
        functionResponse: { id: 't1', name: 't1', response: { result: '72°F' } },
      })
    })

    it('replays the thoughtSignature complete → history → next request', () => {
      const response = fromGeminiResponse(rawResponse([
        { functionCall: { id: 'fc-1', name: 'memory_search', args: { query: 'q' } }, thoughtSignature: 'c2lnLTE=' },
        { functionCall: { id: 'fc-2', name: 'memory_search', args: { query: 'r' } } },
      ]))
      const next = toGeminiContents([
        { role: 'user', content: 'find it' },
        { role: 'assistant', content: response.content },
        { role: 'user', content: [
          { type: 'tool_result', toolUseId: 'fc-1', content: 'a' },
          { type: 'tool_result', toolUseId: 'fc-2', content: 'b' },
        ] },
      ])
      expect(next[1].parts[0]).toEqual({
        functionCall: { id: 'fc-1', name: 'memory_search', args: { query: 'q' } },
        thoughtSignature: 'c2lnLTE=',
      })
      // Only the part Gemini signed carries a signature.
      expect(next[1].parts[1]).toEqual({ functionCall: { id: 'fc-2', name: 'memory_search', args: { query: 'r' } } })
      expect(next[2].parts.map((p: any) => p.functionResponse.id)).toEqual(['fc-1', 'fc-2'])
    })
  })

  describe('toGeminiTools', () => {
    it('wraps in functionDeclarations', () => {
      const tools: ToolDefinition[] = [{
        name: 'search', description: 'Search', inputSchema: { type: 'object', properties: {} },
      }]
      const result = toGeminiTools(tools)
      expect(result).toEqual([{
        functionDeclarations: [{
          name: 'search', description: 'Search', parameters: { type: 'object', properties: {} },
        }],
      }])
    })
  })

  describe('stop reason (shared normalizeStopReason)', () => {
    const call = { functionCall: { id: 'fc-1', name: 'memory_search', args: {} } }
    it('maps a function-call turn that finished with STOP to tool_use', () => {
      expect(fromGeminiResponse(rawResponse([call])).stopReason).toBe('tool_use')
    })
    it('maps a text-only STOP to end', () => {
      expect(fromGeminiResponse(rawResponse([{ text: 'hi' }])).stopReason).toBe('end')
    })
    it('keeps MAX_TOKENS even when a (truncated) call is present', () => {
      expect(fromGeminiResponse(rawResponse([call], 'MAX_TOKENS')).stopReason).toBe('max_tokens')
    })
    it('maps a SAFETY stop to refusal', () => {
      expect(fromGeminiResponse(rawResponse([{ text: '' }], 'SAFETY')).stopReason).toBe('refusal')
    })
  })

  describe('fromGeminiResponse', () => {
    it('converts a text response', () => {
      const raw = {
        responseId: 'resp-123',
        candidates: [{
          content: { role: 'model', parts: [{ text: 'Hello!' }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        modelVersion: 'gemini-2.0-flash',
      }
      const result = fromGeminiResponse(raw as any)
      expect(result.id).toBe('resp-123')
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
      expect(result.stopReason).toBe('end')
    })

    it('splits cached content tokens out of the input (canonical: input is uncached), omits them when absent', () => {
      const base = {
        responseId: 'resp-cache',
        candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
        modelVersion: 'gemini-2.0-flash',
      }
      const withCache = fromGeminiResponse({ ...base, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, cachedContentTokenCount: 7 } } as any)
      // promptTokenCount includes the cached content: 10 − 7 uncached.
      expect(withCache.usage).toEqual({ inputTokens: 3, outputTokens: 5, cacheReadTokens: 7, promptTokensLastCall: 10 })

      const withoutCache = fromGeminiResponse({ ...base, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } as any)
      expect(withoutCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, promptTokensLastCall: 10 })
    })

    it('converts function calls', () => {
      const raw = {
        responseId: 'resp-456',
        candidates: [{
          content: {
            role: 'model',
            parts: [{ functionCall: { name: 'search', args: { q: 'hi' } } }],
          },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15 },
        modelVersion: 'gemini-2.0-flash',
      }
      const result = fromGeminiResponse(raw as any)
      expect(result.content[0]).toEqual({
        type: 'tool_use', id: expect.stringMatching(SYNTHESIZED), name: 'search', input: { q: 'hi' },
      })
      expect(result.stopReason).toBe('tool_use')
    })

    it('uses the id Gemini gives each call and captures its thoughtSignature', () => {
      const result = fromGeminiResponse(rawResponse([
        { functionCall: { id: 'fc-7', name: 'search', args: {} }, thoughtSignature: 'U0lH' },
      ]))
      expect(result.content[0]).toEqual({ type: 'tool_use', id: 'fc-7', name: 'search', input: {}, signature: 'U0lH' })
    })

    it('gives a part without a thoughtSignature no signature field', () => {
      const [block] = fromGeminiResponse(rawResponse([{ functionCall: { id: 'fc-8', name: 'search', args: {} } }])).content
      expect(block).not.toHaveProperty('signature')
    })

    it('synthesizes a unique id per call when Gemini sends none', () => {
      const parts = [{ functionCall: { name: 'a', args: {} } }, { functionCall: { name: 'b', args: {} } }]
      const first = fromGeminiResponse(rawResponse(parts)).content as ToolUseBlock[]
      const second = fromGeminiResponse(rawResponse(parts)).content as ToolUseBlock[]
      const ids = [...first, ...second].map((b) => b.id)
      expect(new Set(ids).size).toBe(4)
    })
  })
})

// F3 — Anthropic-dialect reasoning never reaches the Gemini wire (Gemini
// replays its own reasoning as the part-level thoughtSignature).
describe('Gemini adapter — thinking blocks never leak into the payload (negative)', () => {
  const thinking = {
    type: 'thinking' as const, thinking: 'SECRET-REASONING', signature: 'SIG-XYZ',
    origin: 'anthropic' as const, providerId: 'anthropic', modelId: 'claude-opus-4-8',
  }

  it('drops the block and keeps the rest of the turn, with Gemini\'s own thoughtSignature intact', () => {
    const contents = toGeminiContents([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking, { type: 'tool_use', id: 'fn-1', name: 'fn', input: {}, signature: 'GEMINI-SIG' }] },
    ])
    const wire = JSON.stringify(contents)
    expect(wire).not.toContain('SECRET-REASONING')
    expect(wire).not.toContain('SIG-XYZ')
    expect(contents[1].parts).toHaveLength(1)
    expect(contents[1].parts[0].thoughtSignature).toBe('GEMINI-SIG')
  })

  it('a turn that carried only reasoning is dropped instead of being sent with no parts', () => {
    const contents = toGeminiContents([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking] },
      { role: 'user', content: 'again' },
    ])
    expect(contents).toHaveLength(2)
    expect(contents.every((c: any) => c.parts.length > 0)).toBe(true)
  })
})
