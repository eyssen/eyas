import { describe, it, expect, vi } from 'vitest'
import {
  toGeminiContents,
  toGeminiTools,
  fromGeminiResponse,
  mapGeminiFinishReason,
  GeminiAdapter,
} from '@modules/model/submodules/gemini/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

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

    it('converts tool_use to functionCall part', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } }],
      }]
      const result = toGeminiContents(messages)
      expect(result[0].parts[0]).toEqual({
        functionCall: { name: 'search', args: { q: 'weather' } },
      })
    })

    it('converts tool_result to functionResponse part', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: '72°F' }],
      }]
      const result = toGeminiContents(messages)
      expect(result[0].parts[0]).toEqual({
        functionResponse: { name: 't1', response: { result: '72°F' } },
      })
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

  describe('mapGeminiFinishReason', () => {
    it('maps STOP to end', () => expect(mapGeminiFinishReason('STOP')).toBe('end'))
    it('maps MAX_TOKENS to max_tokens', () => expect(mapGeminiFinishReason('MAX_TOKENS')).toBe('max_tokens'))
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

    it('surfaces cached content tokens when present (F2 T9), omits them when absent', () => {
      const base = {
        responseId: 'resp-cache',
        candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
        modelVersion: 'gemini-2.0-flash',
      }
      const withCache = fromGeminiResponse({ ...base, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, cachedContentTokenCount: 7 } } as any)
      expect(withCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 7 })

      const withoutCache = fromGeminiResponse({ ...base, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } as any)
      expect(withoutCache.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
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
        type: 'tool_use', id: 'gemini-tool-0', name: 'search', input: { q: 'hi' },
      })
    })
  })
})

describe('GeminiAdapter (v2)', () => {
  it('joins prefix + suffix + reminders into systemInstruction with separators', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    })
    const adapter = new GeminiAdapter({ models: { generateContent } } as never)
    await adapter.send({
      systemPrompt: { prefix: 'PREFIX', suffix: 'SUFFIX', reminders: ['REM'], cacheBoundaryHint: 0, prefixHash: 'x', tokenEstimate: { prefix: 1, suffix: 1, reminders: 1 }, sections: [] },
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'gemini-2.0-flash',
    })
    const arg = generateContent.mock.calls[0][0]
    expect(arg.config.systemInstruction).toBe('PREFIX\n\n---\n\nSUFFIX\n\n---\n\nREM')
  })
})
