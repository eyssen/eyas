import { describe, it, expect } from 'vitest'
import {
  toAnthropicMessages,
  toAnthropicTools,
  fromAnthropicResponse,
} from '@modules/model/submodules/anthropic/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

describe('Anthropic adapter', () => {
  describe('toAnthropicMessages', () => {
    it('converts string content', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
      const result = toAnthropicMessages(messages, 'anthropic')
      expect(result).toEqual([{ role: 'user', content: 'hello' }])
    })

    it('converts text blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      }]
      const result = toAnthropicMessages(messages, 'anthropic')
      expect(result).toEqual([{
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      }])
    })

    it('converts tool_use blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'fn', input: { a: 1 } }],
      }]
      const result = toAnthropicMessages(messages, 'anthropic')
      expect(result[0].content).toEqual([{ type: 'tool_use', id: 't1', name: 'fn', input: { a: 1 } }])
    })

    it('converts tool_result blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: 'result' }],
      }]
      const result = toAnthropicMessages(messages, 'anthropic')
      expect(result[0].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'result' }])
    })

    it('converts image blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } }],
      }]
      const result = toAnthropicMessages(messages, 'anthropic')
      expect(result[0].content).toEqual([{
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'abc' },
      }])
    })
  })

  describe('toAnthropicTools', () => {
    it('converts tool definitions', () => {
      const tools: ToolDefinition[] = [{
        name: 'search',
        description: 'Search the web',
        inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      }]
      const result = toAnthropicTools(tools)
      expect(result).toEqual([{
        name: 'search',
        description: 'Search the web',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      }])
    })
  })

  describe('stop reason (shared normalizeStopReason)', () => {
    const respond = (stop_reason: string | null, content: unknown[] = [{ type: 'text', text: 'hi' }]) => fromAnthropicResponse({
      id: 'msg', model: 'claude-sonnet-4-6', stop_reason, content, usage: { input_tokens: 1, output_tokens: 1 },
    })

    it.each([
      ['end_turn', 'end'],
      ['tool_use', 'tool_use'],
      ['max_tokens', 'max_tokens'],
      ['stop_sequence', 'stop_sequence'],
      ['refusal', 'refusal'],
      ['model_context_window_exceeded', 'max_tokens'],
    ])('maps %s to %s', (raw, expected) => {
      expect(respond(raw).stopReason).toBe(expected)
    })

    it("an unknown or missing reason is 'end', unless the content carries a call (negative)", () => {
      expect(respond('pause_turn').stopReason).toBe('end')
      expect(respond(null).stopReason).toBe('end')
      expect(respond('end_turn', [{ type: 'tool_use', id: 't1', name: 'fn', input: {} }]).stopReason).toBe('tool_use')
    })
  })

  describe('fromAnthropicResponse', () => {
    it('converts a complete response', () => {
      const raw = {
        id: 'msg_123',
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }
      const result = fromAnthropicResponse(raw as any)
      expect(result).toEqual({
        id: 'msg_123',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250514',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5, promptTokensLastCall: 10 },
      })
    })

    it('surfaces cache tokens when present (F2 T9), omits them when absent', () => {
      const withCache = fromAnthropicResponse({
        id: 'msg_cache',
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 },
      } as any)
      expect(withCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 100, cacheReadTokens: 200, promptTokensLastCall: 310 })

      const withoutCache = fromAnthropicResponse({
        id: 'msg_nocache',
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      } as any)
      expect(withoutCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, promptTokensLastCall: 10 })
    })

    it('converts tool_use blocks in response', () => {
      const raw = {
        id: 'msg_456',
        model: 'claude-sonnet-4-5-20250514',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me search.' },
          { type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } },
        ],
        usage: { input_tokens: 20, output_tokens: 15 },
      }
      const result = fromAnthropicResponse(raw as any)
      expect(result.stopReason).toBe('tool_use')
      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({ type: 'tool_use', id: 't1', name: 'search', input: { q: 'weather' } })
    })
  })
})
