import { describe, it, expect, vi } from 'vitest'
import {
  toAnthropicMessages,
  toAnthropicTools,
  fromAnthropicResponse,
  mapAnthropicStopReason,
  AnthropicAdapter,
} from '@modules/model/submodules/anthropic/adapter'
import type { ModelMessage, ToolDefinition } from '@modules/model/types'

describe('Anthropic adapter', () => {
  describe('toAnthropicMessages', () => {
    it('converts string content', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hello' }]
      const result = toAnthropicMessages(messages)
      expect(result).toEqual([{ role: 'user', content: 'hello' }])
    })

    it('converts text blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      }]
      const result = toAnthropicMessages(messages)
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
      const result = toAnthropicMessages(messages)
      expect(result[0].content).toEqual([{ type: 'tool_use', id: 't1', name: 'fn', input: { a: 1 } }])
    })

    it('converts tool_result blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: 'result' }],
      }]
      const result = toAnthropicMessages(messages)
      expect(result[0].content).toEqual([{ type: 'tool_result', tool_use_id: 't1', content: 'result' }])
    })

    it('converts image blocks', () => {
      const messages: ModelMessage[] = [{
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } }],
      }]
      const result = toAnthropicMessages(messages)
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

  describe('mapAnthropicStopReason', () => {
    it('maps end_turn to end', () => {
      expect(mapAnthropicStopReason('end_turn')).toBe('end')
    })
    it('maps tool_use to tool_use', () => {
      expect(mapAnthropicStopReason('tool_use')).toBe('tool_use')
    })
    it('maps max_tokens to max_tokens', () => {
      expect(mapAnthropicStopReason('max_tokens')).toBe('max_tokens')
    })
    it('maps stop_sequence to stop_sequence', () => {
      expect(mapAnthropicStopReason('stop_sequence')).toBe('stop_sequence')
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
        usage: { inputTokens: 10, outputTokens: 5 },
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
      expect(withCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheCreationTokens: 100, cacheReadTokens: 200 })

      const withoutCache = fromAnthropicResponse({
        id: 'msg_nocache',
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      } as any)
      expect(withoutCache.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
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

describe('AnthropicAdapter (v2)', () => {
  it('attaches cache_control to prefix only', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'msg_x',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const adapter = new AnthropicAdapter({ messages: { create } } as never)
    await adapter.send({
      systemPrompt: { prefix: 'PREFIX', suffix: 'SUFFIX', reminders: ['REM'], cacheBoundaryHint: 0, prefixHash: 'x', tokenEstimate: { prefix: 1, suffix: 1, reminders: 1 }, sections: [] },
      messages: [{ role: 'user', content: 'hi' }],
      modelId: 'claude-sonnet-4-6',
    })
    const arg = create.mock.calls[0][0]
    expect(arg.system[0]).toMatchObject({ text: 'PREFIX', cache_control: { type: 'ephemeral' } })
    expect(arg.system[1]).toMatchObject({ text: 'SUFFIX' })
    expect(arg.system[1].cache_control).toBeUndefined()
    expect(arg.system[2]).toMatchObject({ text: 'REM' })
  })
})
