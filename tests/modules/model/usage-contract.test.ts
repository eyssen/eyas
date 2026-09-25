// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Canonical usage across the API providers (G4): inputTokens are the UNCACHED
// prompt tokens on every provider, cache reads/writes are separate, reasoning
// tokens are part of the output, and a backend that reports nothing is
// reported:false (cost unknown), never 0 tokens at $0.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { ModelUsageSchema, costSourceOf } from '@shared/chat-stream'
import { estimateCost } from '@shared/model-pricing'
import { fromOpenAIResponse, fromOpenAIUsage } from '@modules/model/submodules/openai/adapter'
import { fromGeminiResponse, fromGeminiUsage } from '@modules/model/submodules/gemini/adapter'
import { fromAnthropicResponse, fromAnthropicUsage } from '@modules/model/submodules/anthropic/adapter'
import { fromOllamaResponse, fromOllamaUsage } from '@modules/model/submodules/ollama/adapter'
import { createAnthropicCompatProvider } from '@modules/model/submodules/anthropic-compat/provider'
import { ANTHROPIC_COMPAT_CATALOG } from '@modules/model/submodules/anthropic-compat/catalog'
import type { ModelResponse, ModelUsage } from '@modules/model/types'
import { anthropicWireStub, sseResponse, thinkingThenToolUseEvents } from '../../helpers/anthropic-wire'
import { toModelUsage } from '@modules/model/usage'
import { acpRunUsage } from '@modules/model/submodules/grok-cli/acp-stream'

afterEach(() => vi.unstubAllGlobals())

function expectCanonical(usage: ModelUsage): void {
  expect(ModelUsageSchema.safeParse(usage).success).toBe(true)
}

describe('usage contract — OpenAI family', () => {
  it('prompt_tokens=1000 with cached=800 → inputTokens 200 and cacheRead 800; the cost is the hand-computed value (positive)', () => {
    const usage = fromOpenAIUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 800 },
    })
    expect(usage).toEqual({ inputTokens: 200, outputTokens: 50, cacheReadTokens: 800, promptTokensLastCall: 1000 })
    expectCanonical(usage)
    // kimi-k3 streams through the same OpenAI mapping: $3 in, $0.3 cache read, $15 out.
    expect(estimateCost('kimi', 'kimi-k3', usage)).toBeCloseTo((200 * 3 + 800 * 0.3 + 50 * 15) / 1_000_000, 12)
  })

  it('reasoning tokens stay inside outputTokens and are also exposed as reasoningTokens (positive)', () => {
    const usage = fromOpenAIUsage({ prompt_tokens: 10, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 256 } })
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 300, reasoningTokens: 256, promptTokensLastCall: 10 })
  })

  it('a cached count larger than the prompt never yields negative input (negative)', () => {
    const usage = fromOpenAIUsage({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 99 } })
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 1, cacheReadTokens: 10, promptTokensLastCall: 10 })
    expectCanonical(usage)
  })

  it('a response without usage is reported:false and its cost source is unknown, not a $0 estimate (negative)', () => {
    const response = fromOpenAIResponse({
      id: 'x', model: 'local', choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
    }, 'openai-compat')
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
    expect(costSourceOf(response.usage)).toBe('unknown')
    expectCanonical(response.usage)
  })
})

describe('usage contract — Gemini', () => {
  it('thoughtsTokenCount is included in outputTokens and exposed as reasoningTokens (positive)', () => {
    const response = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 40, thoughtsTokenCount: 200 },
    })
    expect(response.usage).toEqual({ inputTokens: 400, outputTokens: 240, cacheReadTokens: 600, reasoningTokens: 200, promptTokensLastCall: 1000 })
    expectCanonical(response.usage)
  })

  it('tool-use prompt tokens count as (uncached) input', () => {
    expect(fromGeminiUsage({ promptTokenCount: 100, toolUsePromptTokenCount: 30, candidatesTokenCount: 5 }))
      .toEqual({ inputTokens: 130, outputTokens: 5, promptTokensLastCall: 130 })
  })

  it('no usageMetadata at all is reported:false (negative)', () => {
    const usage = fromGeminiUsage(undefined)
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
    expect(costSourceOf(usage)).toBe('unknown')
  })
})

describe('usage contract — Anthropic and Anthropic-compatible', () => {
  it('input_tokens is already uncached; cache reads and writes stay separate (positive)', () => {
    const usage = fromAnthropicUsage({ input_tokens: 12, output_tokens: 42, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 })
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 42, cacheReadTokens: 300, cacheCreationTokens: 40, promptTokensLastCall: 352 })
    expectCanonical(usage)
  })

  it('anthropic-compat reads the cache tokens of a streamed answer (positive)', async () => {
    const compat = ANTHROPIC_COMPAT_CATALOG[0]!
    vi.stubGlobal('fetch', anthropicWireStub([() => sseResponse(thinkingThenToolUseEvents({ model: compat.defaultModel }))]).fetch)
    let response: ModelResponse | undefined
    for await (const e of createAnthropicCompatProvider(compat, 'key').stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      if (e.type === 'done') response = e.response
    }
    expect(response!.usage).toEqual({ inputTokens: 12, outputTokens: 42, cacheReadTokens: 300, cacheCreationTokens: 40, promptTokensLastCall: 352 })
    expect(costSourceOf(response!.usage)).toBe('estimate')
  })

  it('a non-streamed response without a usage block is reported:false instead of throwing (negative)', () => {
    const response = fromAnthropicResponse({ id: 'm', model: 'compat-model', stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] })
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
    expect(costSourceOf(response.usage)).toBe('unknown')
  })
})

describe('usage contract — Ollama', () => {
  it('prompt_eval_count / eval_count map to input / output (positive)', () => {
    expect(fromOllamaUsage({ prompt_eval_count: 30, eval_count: 7 })).toEqual({ inputTokens: 30, outputTokens: 7 })
  })

  it('a final chunk without counts is reported:false (negative)', () => {
    const response = fromOllamaResponse({ model: 'llama3.2', done: true, done_reason: 'stop', message: { role: 'assistant', content: 'hi' } }, 'ollama')
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
    expect(costSourceOf(response.usage)).toBe('unknown')
  })
})

// G11 — the context-occupancy numerator. One API call's whole prompt
// (uncached + cache reads + cache writes) is what the model read; counts that
// are summed or partial never become one, or the context bar paints wrong.
describe('usage contract — the last call\'s prompt size (promptTokensLastCall)', () => {
  it('an API call reports its whole prompt, cache included (positive)', () => {
    expect(fromAnthropicUsage({ input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 }).promptTokensLastCall).toBe(352)
    expect(fromOpenAIUsage({ prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 800 } }).promptTokensLastCall).toBe(1000)
    expect(fromGeminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 600, toolUsePromptTokenCount: 20, candidatesTokenCount: 5 }).promptTokensLastCall).toBe(1020)
    expectCanonical(fromOpenAIUsage({ prompt_tokens: 1000, completion_tokens: 5 }))
  })

  it('Ollama\'s prompt_eval_count leaves out a reused prefix, so it is never a prompt size (negative)', () => {
    expect(fromOllamaUsage({ prompt_eval_count: 30, eval_count: 7 })).not.toHaveProperty('promptTokensLastCall')
  })

  it('counts not marked as one call\'s whole prompt get none — a CLI\'s summed usage included (negative)', () => {
    expect(toModelUsage({ uncachedInput: 500, output: 20, cacheRead: 4000 })).not.toHaveProperty('promptTokensLastCall')
    expect(acpRunUsage({ inputTokens: 110, outputTokens: 55, cacheReadTokens: 900 })).not.toHaveProperty('promptTokensLastCall')
  })

  it('no usage, or an empty prompt, is not a prompt size (negative)', () => {
    expect(fromAnthropicUsage(undefined)).not.toHaveProperty('promptTokensLastCall')
    expect(toModelUsage({ uncachedInput: 0, output: 3 }, { wholePrompt: true })).not.toHaveProperty('promptTokensLastCall')
  })
})
