// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// LM Studio (F9): its reasoning is set in LM Studio itself. EYAS sends no
// reasoning parameter for any level, and records what LM Studio reports
// (GET /api/v1/models capabilities.reasoning) for display only.

import { describe, it, expect, afterEach } from 'vitest'
import modelsFixture from '../../fixtures/lmstudio/api-v1-models.json'
import { createLMStudioProvider, lmStudioReasoningInfo } from '@modules/model/submodules/lmstudio/provider'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { resolveEffortPlan, type EffortPlan } from '@modules/model/reasoning/resolve'
import { EFFORT_SETTINGS, type EffortSetting } from '@modules/model/reasoning/ladder'
import { parseModelConfigMetadata } from '@modules/model/provider-config-service'
import { installOpenAIWire, okCompletion, type OpenAIWire } from '../../helpers/openai-wire.js'
import { effortPlanFor, PLAIN_EFFORT_CAPABILITY } from '../../helpers/effort-plan.js'

const BASE = 'http://localhost:1234'
const REASONING_KEYS = ['reasoning', 'reasoning_effort', 'thinking', 'max_completion_tokens']

/** The plan the gateway resolves for LM Studio (bundled overlay, nothing discovered). */
function gatewayPlan(level: EffortSetting, model: string): EffortPlan {
  const registry = createReasoningRegistry({ getDiscovered: () => null })
  return resolveEffortPlan({
    intent: { level, source: 'request' },
    capability: registry.get('lmstudio', model),
    maxOutputTokens: 4096,
    streaming: true,
  }).plan
}

let wire: OpenAIWire | undefined
afterEach(() => {
  wire?.restore()
  wire = undefined
})

describe('LM Studio: no reasoning parameter on the wire', () => {
  it('(−) the gateway resolves every level to Auto: LM Studio has no control EYAS sends', () => {
    for (const level of EFFORT_SETTINGS) {
      const plan = gatewayPlan(level, 'qwen/qwen3-8b')
      expect(plan.level, level).toBe('auto')
      expect(plan.capability.kind, level).toBe('none')
    }
  })

  it('(−) complete() never sends reasoning / reasoning_effort for any level', async () => {
    wire = installOpenAIWire()
    wire.respondWith(okCompletion('qwen/qwen3-8b'))
    const provider = createLMStudioProvider({ baseUrl: BASE })
    for (const level of EFFORT_SETTINGS) {
      await provider.complete({ model: 'qwen/qwen3-8b', messages: [{ role: 'user', content: 'hi' }], maxTokens: 512, temperature: 0.3, effortPlan: gatewayPlan(level, 'qwen/qwen3-8b') })
    }
    expect(wire.bodies).toHaveLength(EFFORT_SETTINGS.length)
    for (const body of wire.bodies) {
      for (const key of REASONING_KEYS) expect(body, key).not.toHaveProperty(key)
      expect(body.max_tokens).toBe(512)
      expect(body.temperature).toBe(0.3)
    }
  })

  it('(−) even a plan with a reasoning control (never produced by the gateway for LM Studio) puts nothing on the wire', async () => {
    wire = installOpenAIWire()
    const provider = createLMStudioProvider({ baseUrl: BASE })
    for (const level of ['none', 'low', 'high', 'max'] as const) {
      wire.respondWith(okCompletion('openai/gpt-oss-20b'))
      await provider.complete({ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'hi' }], maxTokens: 512, effortPlan: effortPlanFor(level, PLAIN_EFFORT_CAPABILITY) })
      wire.respondWithStream([
        { id: 'c1', object: 'chat.completion.chunk', model: 'openai/gpt-oss-20b', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] },
      ])
      for await (const _ of provider.stream({ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'hi' }], maxTokens: 512, effortPlan: effortPlanFor(level, PLAIN_EFFORT_CAPABILITY) })) { /* drain */ }
    }
    expect(wire.bodies).toHaveLength(8)
    for (const body of wire.bodies) {
      for (const key of REASONING_KEYS) expect(body, key).not.toHaveProperty(key)
      expect(body.max_tokens).toBe(512)
    }
  })
})

describe('LM Studio: reasoning info from GET /api/v1/models', () => {
  it('(+) capabilities.reasoning is parsed per model, under its key, loaded instance and variants', () => {
    const info = lmStudioReasoningInfo(modelsFixture.response)
    expect(info.get('google/gemma-4-26b-a4b')).toEqual({ options: ['off', 'on'], default: 'on' })
    expect(info.get('google/gemma-4-26b-a4b@q4_k_m')).toEqual({ options: ['off', 'on'], default: 'on' })
    expect(info.get('deepseek-r1')).toEqual({ options: ['on'], default: 'on' })
    // (−) an embedding model reports no reasoning capability.
    expect(info.has('text-embedding-nomic-embed-text-v1.5-embedding')).toBe(false)
  })

  it('(−) an answer of the wrong shape, or an entry that does not parse, yields nothing for it', () => {
    expect(lmStudioReasoningInfo({ data: [] }).size).toBe(0)
    expect(lmStudioReasoningInfo(null).size).toBe(0)
    const info = lmStudioReasoningInfo({ models: [{ key: 'ok', capabilities: { reasoning: { allowed_options: ['on', 'on'], default: null } } }, { key: 42 }, 'junk'] })
    expect([...info.keys()]).toEqual(['ok'])
    expect(info.get('ok')).toEqual({ options: ['on'], default: null })
  })

  it('(+) fetchModels records it as metadata.runtimeReasoning (display only, never metadata.reasoning)', async () => {
    wire = installOpenAIWire()
    wire.route('/api/v1/models', modelsFixture.response)
    wire.route('/v1/models', { object: 'list', data: [{ id: 'google/gemma-4-26b-a4b' }, { id: 'deepseek-r1' }, { id: 'unlisted-model' }] })
    const models = await createLMStudioProvider({ baseUrl: BASE }).fetchModels!()
    expect(models.map((m) => m.id)).toEqual(['google/gemma-4-26b-a4b', 'deepseek-r1', 'unlisted-model'])
    const gemma = models[0].metadata as Record<string, unknown>
    expect(gemma.runtimeReasoning).toEqual({ options: ['off', 'on'], default: 'on' })
    expect(gemma).not.toHaveProperty('reasoning')
    expect(models[2].metadata).toBeUndefined()
    // Storable as model_config metadata.
    expect(parseModelConfigMetadata(gemma)?.runtimeReasoning).toEqual({ options: ['off', 'on'], default: 'on' })
  })

  it('(−) a server without the REST API still lists its models, without reasoning info', async () => {
    wire = installOpenAIWire()
    // Routes match by substring in order: the REST path first, answered with
    // what an older server says about an endpoint it does not have.
    wire.route('/api/v1/models', { error: 'Unexpected endpoint or method.' })
    wire.route('/v1/models', { object: 'list', data: [{ id: 'qwen/qwen3-8b' }] })
    const models = await createLMStudioProvider({ baseUrl: BASE }).fetchModels!()
    expect(models.map((m) => m.id)).toEqual(['qwen/qwen3-8b'])
    expect(models[0].metadata).toBeUndefined()
  })

  it('(−) listModels reads the OpenAI-compatible listing only', async () => {
    wire = installOpenAIWire()
    wire.route('/api/v1/models', modelsFixture.response)
    wire.route('/v1/models', { object: 'list', data: [{ id: 'google/gemma-4-26b-a4b' }] })
    const models = await createLMStudioProvider({ baseUrl: BASE }).listModels()
    expect(models[0].metadata).toBeUndefined()
  })
})
