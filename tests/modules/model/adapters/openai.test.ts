import { describe, it, expect, vi } from 'vitest'
import {
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAIResponse,
  mapOpenAIFinishReason,
  OpenAIAdapter,
} from '@modules/model/submodules/openai/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

describe('OpenAI adapter', () => {
  describe('toOpenAIMessages', () => {
    it('adds system message at the start', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }]
      const result = toOpenAIMessages(messages, 'Be helpful')
      expect(result[0]).toEqual({ role: 'system', content: 'Be helpful' })
      expect(result[1]).toEqual({ role: 'user', content: 'hi' })
    })

    it('converts tool_use blocks to assistant tool_calls', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'Searching...' },
          { type: 'tool_use', id: 'c1', name: 'search', input: { q: 'weather' } },
        ],
      }]
      const result = toOpenAIMessages(messages)
      expect(result[0].role).toBe('assistant')
      expect(result[0].content).toBe('Searching...')
      expect(result[0].tool_calls).toEqual([{
        id: 'c1',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"weather"}' },
      }])
    })

    it('converts tool_result blocks to tool role messages', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'c1', content: '72°F' }],
      }]
      const result = toOpenAIMessages(messages)
      expect(result[0]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '72°F' })
    })
  })

  describe('toOpenAITools', () => {
    it('wraps in function format', () => {
      const tools: ToolDefinition[] = [{
        name: 'search', description: 'Search', inputSchema: { type: 'object' },
      }]
      const result = toOpenAITools(tools)
      expect(result).toEqual([{
        type: 'function',
        function: { name: 'search', description: 'Search', parameters: { type: 'object' } },
      }])
    })
  })

  describe('mapOpenAIFinishReason', () => {
    it('maps stop to end', () => expect(mapOpenAIFinishReason('stop')).toBe('end'))
    it('maps tool_calls to tool_use', () => expect(mapOpenAIFinishReason('tool_calls')).toBe('tool_use'))
    it('maps length to max_tokens', () => expect(mapOpenAIFinishReason('length')).toBe('max_tokens'))
  })

  describe('fromOpenAIResponse', () => {
    it('converts a text response', () => {
      const raw = {
        id: 'chatcmpl-123',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }
      const result = fromOpenAIResponse(raw as any, 'openai')
      expect(result.id).toBe('chatcmpl-123')
      expect(result.provider).toBe('openai')
      expect(result.content).toEqual([{ type: 'text', text: 'Hello!' }])
      expect(result.stopReason).toBe('end')
    })

    it('surfaces cached prompt tokens when present (F2 T9), omits them when absent', () => {
      const withCache = fromOpenAIResponse({
        id: 'chatcmpl-cache',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } },
      } as any, 'openai')
      expect(withCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 4 })

      const withoutCache = fromOpenAIResponse({
        id: 'chatcmpl-nocache',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any, 'openai')
      expect(withoutCache.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    })

    it('converts tool calls in response', () => {
      const raw = {
        id: 'chatcmpl-456',
        model: 'gpt-4o',
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"hi"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 20, completion_tokens: 15 },
      }
      const result = fromOpenAIResponse(raw as any, 'openai')
      expect(result.stopReason).toBe('tool_use')
      expect(result.content).toEqual([
        { type: 'tool_use', id: 'c1', name: 'search', input: { q: 'hi' } },
      ])
    })
  })
})

describe('OpenAIAdapter (v2)', () => {
  it('concatenates prefix + suffix into one system message; reminders as separate', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'cmpl_x',
      model: 'gpt-4o',
      choices: [{
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const adapter = new OpenAIAdapter({ chat: { completions: { create } } } as never)
    await adapter.send({
      systemPrompt: { prefix: 'PREFIX', suffix: 'SUFFIX', reminders: ['REM1', 'REM2'], cacheBoundaryHint: 0, prefixHash: 'x', tokenEstimate: { prefix: 1, suffix: 1, reminders: 1 } },
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'gpt-4o',
    })
    const arg = create.mock.calls[0][0]
    expect(arg.messages[0]).toEqual({ role: 'system', content: 'PREFIX\n\nSUFFIX' })
    expect(arg.messages[1]).toEqual({ role: 'system', content: 'REM1' })
    expect(arg.messages[2]).toEqual({ role: 'system', content: 'REM2' })
    expect(arg.messages[3]).toMatchObject({ role: 'user' })
  })

  it('omits concatenated system message when prefix and suffix are empty', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'cmpl_y',
      model: 'gpt-4o',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    const adapter = new OpenAIAdapter({ chat: { completions: { create } } } as never)
    await adapter.send({
      systemPrompt: { prefix: '', suffix: '   ', reminders: ['ONLY'], cacheBoundaryHint: 0, prefixHash: 'x', tokenEstimate: { prefix: 0, suffix: 0, reminders: 1 } },
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'gpt-4o',
    })
    const arg = create.mock.calls[0][0]
    expect(arg.messages[0]).toEqual({ role: 'system', content: 'ONLY' })
    expect(arg.messages[1]).toMatchObject({ role: 'user' })
  })
})
