// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIProvider, ModelRequest } from '@modules/model/types'
import { effortPlanFor, PLAIN_EFFORT_CAPABILITY } from '../../helpers/effort-plan'

// Mock the OpenAI SDK so the exact chat.completions.create params are visible
// without any network call.
const { createSpy } = vi.hoisted(() => ({ createSpy: vi.fn() }))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createSpy } }
    models = { list: vi.fn() }
    embeddings = { create: vi.fn() }
    baseURL = 'https://api.openai.com/v1'
    constructor(_opts: unknown) {}
  },
}))

// Import AFTER the mock is registered.
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createCompatProvider } from '@modules/model/submodules/openai-compat/provider'
import { OPENAI_COMPAT_CATALOG } from '@modules/model/submodules/openai-compat/catalog'
import { createOpenRouterProvider } from '@modules/model/submodules/openrouter/provider'
import { createKimiProvider } from '@modules/model/submodules/kimi/provider'
import { createLMStudioProvider } from '@modules/model/submodules/lmstudio/provider'

const request: ModelRequest = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }

const okResponse = {
  id: 'chatcmpl-1',
  model: 'gpt-4o',
  choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
}

async function completeParams(provider: AIProvider): Promise<Record<string, unknown>> {
  createSpy.mockReset()
  createSpy.mockResolvedValue(okResponse)
  await provider.complete(request)
  expect(createSpy).toHaveBeenCalledTimes(1)
  return createSpy.mock.calls[0][0]
}

async function streamParams(provider: AIProvider): Promise<Record<string, unknown>> {
  createSpy.mockReset()
  createSpy.mockResolvedValue((async function* () {
    yield { id: 'c1', model: 'gpt-4o', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }
    yield { choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } }
  })())
  for await (const _ of provider.stream!(request)) { /* drain */ }
  expect(createSpy).toHaveBeenCalledTimes(1)
  return createSpy.mock.calls[0][0]
}

describe('OpenAI stored-completions opt-out (store:false)', () => {
  beforeEach(() => createSpy.mockReset())

  it('native OpenAI complete() sends store:false', async () => {
    const params = await completeParams(createOpenAIProvider({ apiKey: 'x' }))
    expect(params.store).toBe(false)
  })

  it('native OpenAI stream() sends store:false', async () => {
    const params = await streamParams(createOpenAIProvider({ apiKey: 'x' }))
    expect(params.store).toBe(false)
    expect(params.stream).toBe(true)
  })

  it('store:false sits alongside the reasoning-effort mapping for o-series models', async () => {
    createSpy.mockResolvedValue(okResponse)
    await createOpenAIProvider({ apiKey: 'x' }).complete({ ...request, model: 'o3-mini', effortPlan: effortPlanFor('high', PLAIN_EFFORT_CAPABILITY) })
    const [params] = createSpy.mock.calls[0]
    expect(params.store).toBe(false)
    expect(params.reasoning_effort).toBe('high')
  })

  const others: Array<[string, () => AIProvider]> = [
    ['openai-compat', () => createCompatProvider(OPENAI_COMPAT_CATALOG[0]!, 'k')],
    ['openrouter', () => createOpenRouterProvider('k')],
    ['kimi', () => createKimiProvider('k')],
    ['lmstudio', () => createLMStudioProvider()],
    // The 'openai' id pointed at a custom endpoint is a compat backend too.
    ['openai with a custom baseURL', () => createOpenAIProvider({ apiKey: 'x', baseURL: 'https://proxy.example.test/v1' })],
    // Another id on the shared provider is never treated as native OpenAI.
    ['another provider id without a baseURL', () => createOpenAIProvider({ apiKey: 'x', providerId: 'custom' })],
  ]

  for (const [label, make] of others) {
    it(`${label}: complete() carries no store key`, async () => {
      const params = await completeParams(make())
      expect('store' in params).toBe(false)
    })

    it(`${label}: stream() carries no store key`, async () => {
      const params = await streamParams(make())
      expect('store' in params).toBe(false)
    })
  }
})
