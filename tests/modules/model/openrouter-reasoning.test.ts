// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F7 — OpenRouter's unified reasoning parameter and reasoning continuity, on
// the real OpenAI SDK against a fake fetch (the body is exactly the wire).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpenRouterProvider, openRouterReasoning, OPENROUTER_EFFORT_LEVELS } from '@modules/model/submodules/openrouter/provider'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry'
import type { ModelInfo, ModelMessage } from '@modules/model/types'
import { effortPlanFor } from '../../helpers/effort-plan'
import { installOpenAIWire, okCompletion, type OpenAIWire } from '../../helpers/openai-wire'

let wire: OpenAIWire
beforeEach(() => { wire = installOpenAIWire() })
afterEach(() => wire.restore())

/** A registry whose discovery is what one OpenRouter listing reported. */
function registryFrom(models: ModelInfo[]) {
  const byId = new Map(models.map((m) => [m.id, m]))
  return createReasoningRegistry({
    overlay: loadBundledOverlay(),
    getDiscovered: (_provider, modelId) => (byId.get(modelId)?.metadata as any)?.reasoning ?? null,
  })
}

const LISTING = {
  data: [
    { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', context_length: 1000000, top_provider: { max_completion_tokens: 128000 }, supported_parameters: ['tools', 'reasoning', 'include_reasoning', 'temperature'] },
    { id: 'deepseek/deepseek-r2', name: 'DeepSeek R2', context_length: 128000, supported_parameters: ['reasoning', 'include_reasoning'] },
    { id: 'openai/gpt-5.5', name: 'GPT-5.5', context_length: 400000, supported_parameters: ['tools', 'temperature'] },
    { id: 'meta-llama/llama-4', name: 'Llama 4', context_length: 131072 },
    { name: 'no id: skipped' },
  ],
}

describe('OpenRouter discovery — supported_parameters → discovered reasoning', () => {
  it("parses 'reasoning' into the unified effort ladder, its absence into no control, no list into nothing", async () => {
    wire.route('/models', LISTING)
    const models = await createOpenRouterProvider('test-key').fetchModels!()
    expect(models.map((m) => m.id)).toEqual(['anthropic/claude-opus-4.6', 'deepseek/deepseek-r2', 'openai/gpt-5.5', 'meta-llama/llama-4'])
    const reasoningOf = (id: string) => (models.find((m) => m.id === id)!.metadata as any)?.reasoning
    expect(reasoningOf('deepseek/deepseek-r2')).toMatchObject({ source: 'catalog-api', param: 'effort', levels: [...OPENROUTER_EFFORT_LEVELS] })
    expect(reasoningOf('openai/gpt-5.5')).toMatchObject({ source: 'catalog-api', param: 'none', levels: [] })
    expect(reasoningOf('meta-llama/llama-4')).toBeUndefined()
    expect(models[0].maxOutputTokens).toBe(128000)
  })

  it('an upstream family row narrows the generic ladder (clampPolicy server); an unknown upstream keeps it', async () => {
    wire.route('/models', LISTING)
    const registry = registryFrom(await createOpenRouterProvider('test-key').fetchModels!())
    const claude = registry.get('openrouter', 'anthropic/claude-opus-4.6')
    expect(claude.levels).toEqual(['none', 'low', 'medium', 'high', 'max'])
    expect(claude.overlayRowId).toBe('openrouter-claude-4-6')
    expect(registry.get('openrouter', 'deepseek/deepseek-r2').levels).toEqual([...OPENROUTER_EFFORT_LEVELS])
    // The listing says GPT-5.5 takes no reasoning parameter here: no control, whatever the family row says.
    expect(registry.get('openrouter', 'openai/gpt-5.5').kind).toBe('none')
  })

  it('refuses a listing of the wrong shape (negative)', async () => {
    wire.route('/models', { models: [] })
    await expect(createOpenRouterProvider('test-key').fetchModels!()).rejects.toThrow(/unexpected shape/)
  })

  it('openRouterReasoning never offers none from the listing alone (negative)', () => {
    const d = openRouterReasoning(['reasoning'], '2026-09-23T00:00:00.000Z')!
    expect(d.levels).not.toContain('none')
  })
})

describe('OpenRouter provider — reasoning on the wire', () => {
  const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
  const planOf = (model: string, level: Parameters<typeof effortPlanFor>[0], reg = registry) => effortPlanFor(level, reg.get('openrouter', model))

  it("'high' sends reasoning.effort and never a top-level reasoning_effort (positive)", async () => {
    wire.respondWith(okCompletion())
    const provider = createOpenRouterProvider('test-key')
    await provider.complete({ model: 'anthropic/claude-opus-4.6', messages: [{ role: 'user', content: 'hi' }], effortPlan: planOf('anthropic/claude-opus-4.6', 'high') })
    expect(wire.bodies[0].reasoning).toEqual({ effort: 'high' })
    expect(wire.bodies[0]).not.toHaveProperty('reasoning_effort')
  })

  it("'none' asks OpenRouter to switch reasoning off where the upstream family can; clamps where it cannot", async () => {
    wire.respondWith(okCompletion())
    const provider = createOpenRouterProvider('test-key')
    await provider.complete({ model: 'anthropic/claude-sonnet-4.6', messages: [{ role: 'user', content: 'hi' }], effortPlan: planOf('anthropic/claude-sonnet-4.6', 'none') })
    await provider.complete({ model: 'google/gemini-3.1-pro-preview', messages: [{ role: 'user', content: 'hi' }], effortPlan: planOf('google/gemini-3.1-pro-preview', 'xhigh') })
    expect(wire.bodies[0].reasoning).toEqual({ effort: 'none' })
    expect(wire.bodies[1].reasoning).toEqual({ effort: 'high' })
  })

  it('reasoning_details round-trip deep-equal across a tool loop (positive)', async () => {
    const details = [
      { type: 'reasoning.text', text: 'I should call the tool.', signature: 'sig-abc', format: 'anthropic-claude-v1', index: 0 },
      { type: 'reasoning.encrypted', data: 'opaque==', format: 'anthropic-claude-v1', index: 1 },
    ]
    wire.respondWith({
      id: 'gen-1', object: 'chat.completion', model: 'anthropic/claude-opus-4.6',
      choices: [{ index: 0, finish_reason: 'tool_calls', message: {
        role: 'assistant', content: null, reasoning: 'I should call the tool.', reasoning_details: details,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'memory_search', arguments: '{"query":"q"}' } }],
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = createOpenRouterProvider('test-key')
    const model = 'anthropic/claude-opus-4.6'
    const first = await provider.complete({ model, messages: [{ role: 'user', content: 'find q' }], effortPlan: planOf(model, 'high') })
    expect(first.stopReason).toBe('tool_use')

    wire.respondWith(okCompletion(model, 'found'))
    const messages: ModelMessage[] = [
      { role: 'user', content: 'find q' },
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_1', content: 'result' }] },
    ]
    await provider.complete({ model, messages, effortPlan: planOf(model, 'high') })
    const assistant = wire.bodies[1].messages.find((m: any) => m.role === 'assistant')
    expect(assistant.reasoning_details).toEqual(details)
    expect(assistant).not.toHaveProperty('reasoning_content')
    expect(assistant.tool_calls[0].id).toBe('call_1')
  })

  it('a model OpenRouter lists without reasoning gets no reasoning object (negative)', async () => {
    wire.route('/models', LISTING)
    const discovered = registryFrom(await createOpenRouterProvider('test-key').fetchModels!())
    wire.respondWith(okCompletion())
    const provider = createOpenRouterProvider('test-key')
    await provider.complete({ model: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }], effortPlan: planOf('openai/gpt-5.5', 'high', discovered) })
    expect(wire.bodies[0]).not.toHaveProperty('reasoning')
    expect(wire.bodies[0]).not.toHaveProperty('reasoning_effort')
  })

  it('an unknown model (nothing discovered, no family row) gets no reasoning object (negative)', async () => {
    wire.respondWith(okCompletion())
    await createOpenRouterProvider('test-key').complete({ model: 'meta-llama/llama-4', messages: [{ role: 'user', content: 'hi' }], effortPlan: planOf('meta-llama/llama-4', 'high') })
    expect(wire.bodies[0]).not.toHaveProperty('reasoning')
  })
})
