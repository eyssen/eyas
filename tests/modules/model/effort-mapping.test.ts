// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  getSessionInfo: async () => null,
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { applyAnthropicThinking } from '@modules/model/submodules/anthropic/adapter.js'
import { applyOpenAIReasoningEffort } from '@modules/model/submodules/openai/adapter.js'

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const base = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

describe('claude-code provider — effort mapping', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('passes request.effort and switches thinking to adaptive', async () => {
    const provider = createClaudeCodeProvider()
    await drain(provider.stream({ ...base, effort: 'max', thinking: { enabled: true, budgetTokens: 25000 } } as any))
    expect(h.captured.options.effort).toBe('max')
    expect(h.captured.options.thinking).toEqual({ type: 'adaptive' })
  })

  it('keeps legacy budget thinking when no effort is set', async () => {
    const provider = createClaudeCodeProvider()
    await drain(provider.stream({ ...base, thinking: { enabled: true, budgetTokens: 25000 } } as any))
    expect(h.captured.options.effort).toBeUndefined()
    expect(h.captured.options.thinking).toEqual({ type: 'enabled', budgetTokens: 25000 })
  })

  it('thinking disabled stays disabled regardless of effort', async () => {
    const provider = createClaudeCodeProvider()
    await drain(provider.stream({ ...base, effort: 'low' } as any))
    expect(h.captured.options.thinking).toEqual({ type: 'disabled' })
    expect(h.captured.options.effort).toBe('low')
  })

  it('maps per-agent effort into SDK agent definitions', async () => {
    const provider = createClaudeCodeProvider({
      toolExecutor: { execute: vi.fn() } as any,
      toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
      getGovernance: () => ({
        securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) },
        agentRegistry: { list: () => [{ id: 'dev', name: 'Dev', goal: 'g', systemPrompt: 'p', effort: 'high' }] },
      }) as any,
    })
    await drain(provider.stream(base as any))
    expect(h.captured.options.agents?.dev?.effort).toBe('high')
  })
})

describe('anthropic adapter — effort mapping', () => {
  it('adaptive-thinking models get output_config.effort + adaptive thinking', () => {
    const params: Record<string, any> = { max_tokens: 4096 }
    applyAnthropicThinking(params, 'claude-fable-5', { enabled: true }, 'max')
    expect(params.thinking).toEqual({ type: 'adaptive' })
    expect(params.output_config).toEqual({ effort: 'max' })
  })

  it('adaptive models get output_config.effort even with thinking off', () => {
    const params: Record<string, any> = {}
    applyAnthropicThinking(params, 'claude-opus-4-6', undefined, 'low')
    expect(params.thinking).toBeUndefined()
    expect(params.output_config).toEqual({ effort: 'low' })
  })

  it('budget models translate effort into a thinking budget instead', () => {
    const params: Record<string, any> = { max_tokens: 4096 }
    applyAnthropicThinking(params, 'claude-3-haiku-20240307', { enabled: true }, 'max')
    expect(params.output_config).toBeUndefined()
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 100000 })
  })

  it('explicit budgetTokens beats the effort-derived budget', () => {
    const params: Record<string, any> = { max_tokens: 200000 }
    applyAnthropicThinking(params, 'claude-3-haiku-20240307', { enabled: true, budgetTokens: 7000 }, 'max')
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 7000 })
  })

  it('no effort keeps the existing behavior byte-for-byte', () => {
    const params: Record<string, any> = { max_tokens: 4096 }
    applyAnthropicThinking(params, 'claude-fable-5', { enabled: true, budgetTokens: 9999 })
    expect(params.thinking).toEqual({ type: 'adaptive' })
    expect(params.output_config).toBeUndefined()
  })
})

describe('openai adapter — reasoning effort', () => {
  it('sets reasoning_effort for o-series models, mapping max→high', () => {
    const params: Record<string, any> = {}
    applyOpenAIReasoningEffort(params, 'o3-mini', 'max')
    expect(params.reasoning_effort).toBe('high')
    applyOpenAIReasoningEffort(params, 'o3-mini', 'low')
    expect(params.reasoning_effort).toBe('low')
  })

  it('never sets reasoning_effort for non-reasoning models or without effort', () => {
    const params: Record<string, any> = {}
    applyOpenAIReasoningEffort(params, 'gpt-4o', 'high')
    expect(params.reasoning_effort).toBeUndefined()
    applyOpenAIReasoningEffort(params, 'o3-mini', undefined)
    expect(params.reasoning_effort).toBeUndefined()
  })
})
