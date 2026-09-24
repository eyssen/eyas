import { describe, it, expect } from 'vitest'
import {
  toOpenAIMessages,
  toOpenAITools,
  fromOpenAIResponse,
  mergeReasoningDetails,
} from '@modules/model/submodules/openai/adapter'
import type { ModelMessage, ThinkingBlock, ToolDefinition } from '@modules/model/types'

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

  describe('stop reason (shared normalizeStopReason)', () => {
    const toolCall = { id: 'c1', type: 'function', function: { name: 'memory_search', arguments: '{}' } }
    const respond = (finish_reason: string, tool_calls?: unknown[]) => fromOpenAIResponse({
      id: 'x', model: 'm',
      choices: [{ message: { role: 'assistant', content: tool_calls ? null : 'hi', ...(tool_calls ? { tool_calls } : {}) }, finish_reason }],
    } as any, 'openai-compat')

    it("maps finish_reason 'stop' WITH tool_calls (compat backends) to tool_use", () => {
      expect(respond('stop', [toolCall]).stopReason).toBe('tool_use')
    })
    it("maps 'stop' without tool_calls to end", () => expect(respond('stop').stopReason).toBe('end'))
    it("maps 'tool_calls' to tool_use", () => expect(respond('tool_calls', [toolCall]).stopReason).toBe('tool_use'))
    it("keeps 'length' as max_tokens even with a (truncated) tool call", () => {
      expect(respond('length', [toolCall]).stopReason).toBe('max_tokens')
    })
    it("maps 'content_filter' to refusal", () => expect(respond('content_filter').stopReason).toBe('refusal'))
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

    it('splits cached prompt tokens out of the input (canonical: input is uncached), omits them when absent', () => {
      const withCache = fromOpenAIResponse({
        id: 'chatcmpl-cache',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } },
      } as any, 'openai')
      // prompt_tokens includes the cached share: 10 − 4 uncached.
      expect(withCache.usage).toEqual({ inputTokens: 6, outputTokens: 5, cacheReadTokens: 4, promptTokensLastCall: 10 })

      const withoutCache = fromOpenAIResponse({
        id: 'chatcmpl-nocache',
        model: 'gpt-4o',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as any, 'openai')
      expect(withoutCache.usage).toEqual({ inputTokens: 10, outputTokens: 5, promptTokensLastCall: 10 })
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

    it('gives a tool call the backend sent without an id a unique synthesized id (H2)', () => {
      const raw = (id?: string) => ({
        id: 'x', model: 'local',
        choices: [{
          message: { role: 'assistant', content: null, tool_calls: [{ ...(id ? { id } : {}), type: 'function', function: { name: 'search', arguments: '{}' } }] },
          finish_reason: 'tool_calls',
        }],
      })
      const a = (fromOpenAIResponse(raw() as any, 'lmstudio').content[0] as { id: string }).id
      const b = (fromOpenAIResponse(raw('') as any, 'lmstudio').content[0] as { id: string }).id
      expect(a).toMatch(/^call_[0-9a-f-]{36}$/)
      expect(b).toMatch(/^call_[0-9a-f-]{36}$/)
      expect(a).not.toBe(b)
      // A backend id is never replaced.
      expect((fromOpenAIResponse(raw('call_backend') as any, 'lmstudio').content[0] as { id: string }).id).toBe('call_backend')
    })
  })
})

// F3 — a thinking block is Anthropic-dialect reasoning bound to the provider
// that produced it. After a failover it must never reach the OpenAI wire,
// not even as text. (F7's same-origin replay for the OpenAI dialects is below.)
describe('OpenAI adapter — thinking blocks never leak into the payload (negative)', () => {
  const thinking = {
    type: 'thinking' as const, thinking: 'SECRET-REASONING', signature: 'SIG-XYZ',
    origin: 'anthropic' as const, providerId: 'anthropic', modelId: 'claude-opus-4-8',
  }

  it('drops the block from an assistant tool turn and from a text turn', () => {
    const result = toOpenAIMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking, { type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'c1', name: 'fn', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'r' }] },
      { role: 'assistant', content: [thinking, { type: 'text', text: 'Done.' }] },
    ])
    const wire = JSON.stringify(result)
    expect(wire).not.toContain('SECRET-REASONING')
    expect(wire).not.toContain('SIG-XYZ')
    expect(result[1]).toMatchObject({ role: 'assistant', content: 'Let me check.' })
    expect(result[3]).toEqual({ role: 'assistant', content: 'Done.' })
  })

  it('an assistant turn that carried only reasoning is not sent as an empty message', () => {
    const result = toOpenAIMessages([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [thinking] },
      { role: 'user', content: 'again' },
    ])
    expect(result).toEqual([{ role: 'user', content: 'q' }, { role: 'user', content: 'again' }])
  })
})

// F7 — same-origin reasoning continuity on the OpenAI wire family: Kimi takes
// its reasoning_content back and OpenRouter its reasoning_details, only from
// the same provider and model; the openai dialect never sends reasoning back.
describe('OpenAI adapter — reasoning replay per dialect', () => {
  const kimiBlock: ThinkingBlock = { type: 'thinking', thinking: 'K-REASONING', origin: 'openai-reasoning-content', providerId: 'kimi', modelId: 'kimi-k3' }
  const details = [{ type: 'reasoning.text', text: 'OR-REASONING', signature: 'SIG', format: 'anthropic-claude-v1', index: 0 }, { type: 'reasoning.encrypted', data: 'ENC', index: 1 }]
  const orBlock: ThinkingBlock = { type: 'thinking', thinking: 'OR-REASONING', origin: 'openrouter-reasoning-details', providerId: 'openrouter', modelId: 'anthropic/claude-opus-4.6', raw: details }
  const loop = (block: ThinkingBlock): ModelMessage[] => [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: [block, { type: 'tool_use', id: 'c1', name: 'fn', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'r' }] },
  ]

  it('kimi replays reasoning_content on the assistant tool_calls turn (positive)', () => {
    const result = toOpenAIMessages(loop(kimiBlock), undefined, { dialect: 'kimi', providerId: 'kimi', modelId: 'kimi-k3' })
    expect(result[1]).toMatchObject({ role: 'assistant', content: null, reasoning_content: 'K-REASONING' })
    expect(result[1].tool_calls).toHaveLength(1)
  })

  it('openrouter replays reasoning_details deep-equal and never as reasoning_content (positive)', () => {
    const result = toOpenAIMessages(loop(orBlock), undefined, { dialect: 'openrouter', providerId: 'openrouter', modelId: 'anthropic/claude-opus-4.6' })
    expect(result[1].reasoning_details).toEqual(details)
    expect(result[1]).not.toHaveProperty('reasoning_content')
  })

  it('never replays another provider\'s, another model\'s or another dialect\'s reasoning (negative)', () => {
    const otherModel = toOpenAIMessages(loop(kimiBlock), undefined, { dialect: 'kimi', providerId: 'kimi', modelId: 'kimi-k2.6' })
    const otherProvider = toOpenAIMessages(loop(kimiBlock), undefined, { dialect: 'kimi', providerId: 'kimi-eu', modelId: 'kimi-k3' })
    const otherDialect = toOpenAIMessages(loop(orBlock), undefined, { dialect: 'kimi', providerId: 'openrouter', modelId: 'anthropic/claude-opus-4.6' })
    for (const result of [otherModel, otherProvider, otherDialect]) {
      const wire = JSON.stringify(result)
      expect(wire).not.toContain('REASONING')
      expect(result[1]).not.toHaveProperty('reasoning_content')
      expect(result[1]).not.toHaveProperty('reasoning_details')
    }
  })

  it('the openai dialect never sends reasoning_content back, even its own (negative)', () => {
    const own: ThinkingBlock = { ...kimiBlock, providerId: 'deepseek', modelId: 'deepseek-reasoner' }
    const result = toOpenAIMessages(loop(own), undefined, { dialect: 'openai', providerId: 'deepseek', modelId: 'deepseek-reasoner' })
    expect(JSON.stringify(result)).not.toContain('K-REASONING')
    expect(result[1]).not.toHaveProperty('reasoning_content')
  })

  it('fromOpenAIResponse turns reasoning_content into a ThinkingBlock before the answer, bound to the EYAS model', () => {
    const response = fromOpenAIResponse({
      id: 'x', model: 'kimi-k3-0901',
      choices: [{ message: { role: 'assistant', content: 'Hi', reasoning_content: 'Because.' }, finish_reason: 'stop' }],
    }, 'kimi', { dialect: 'kimi', model: 'kimi-k3' })
    expect(response.content).toEqual([
      { type: 'thinking', thinking: 'Because.', origin: 'openai-reasoning-content', providerId: 'kimi', modelId: 'kimi-k3' },
      { type: 'text', text: 'Hi' },
    ])
  })

  it('fromOpenAIResponse keeps reasoning_details only for the openrouter dialect', () => {
    const raw = { id: 'x', model: 'm', choices: [{ message: { role: 'assistant', content: 'A', reasoning: 'R', reasoning_details: details }, finish_reason: 'stop' }] }
    const openrouter = fromOpenAIResponse(raw, 'openrouter', { dialect: 'openrouter', model: 'm' }).content[0] as ThinkingBlock
    expect(openrouter.raw).toEqual(details)
    expect(openrouter.thinking).toBe('R')
    const plain = fromOpenAIResponse(raw, 'groq').content[0] as ThinkingBlock
    expect(plain.origin).toBe('openai-reasoning-content')
    expect(plain.raw).toBeUndefined()
  })

  it('mergeReasoningDetails joins streamed pieces per index and type, and keeps the latest other fields', () => {
    const acc: Record<string, unknown>[] = []
    mergeReasoningDetails(acc, [{ type: 'reasoning.text', text: 'a', index: 0, signature: null }])
    mergeReasoningDetails(acc, [{ type: 'reasoning.text', text: 'b', index: 0, signature: 'S' }, { type: 'reasoning.encrypted', data: 'E1', index: 1 }])
    mergeReasoningDetails(acc, [{ type: 'reasoning.encrypted', data: 'E2', index: 1 }, 'not-an-entry'])
    expect(acc).toEqual([
      { type: 'reasoning.text', text: 'ab', index: 0, signature: 'S' },
      { type: 'reasoning.encrypted', data: 'E1E2', index: 1 },
    ])
  })
})
