// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 (R1A-14) — a model a refresh discovered is known only to model_config,
// not to its provider's static listModels(). A caller naming just the model
// (an agent's model, a specialist run) must still reach the provider that
// owns it; a disabled model or provider must still fail loudly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createModelGateway } from '@modules/model/gateway'
import { findModelOwner } from '@modules/model/binding'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse } from '@modules/model/types'

const testDb = createTestDb('gateway-model-config-resolution')
let svc: ProviderConfigService

beforeEach(() => { svc = createProviderConfigService(testDb.open()) })
afterEach(() => testDb.cleanup())

const info = (id: string, provider: string): ModelInfo => ({
  id, name: id, provider, contextWindow: 100_000, maxOutputTokens: 4_096,
  supportsTools: true, supportsImages: false, supportsStreaming: true,
})

/** A provider whose static list is only its seed; `calls` records who answered with which model. */
function provider(id: string, seed: string[], calls: Array<{ provider: string; model?: string }>): AIProvider {
  return {
    id,
    name: id,
    async listModels() { return seed.map((m) => info(m, id)) },
    async complete(req: ModelRequest): Promise<ModelResponse> {
      calls.push({ provider: id, model: req.model })
      return { id: 'r', provider: id, model: req.model ?? seed[0], content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
    },
    async *stream() { /* unused */ },
  }
}

function setup() {
  const calls: Array<{ provider: string; model?: string }> = []
  const gateway = createModelGateway(undefined, {
    // The model module's wiring (model/index.ts).
    lookupModelOwner: (modelId) => findModelOwner({ providerConfig: svc, isRegistered: (id) => !!gateway.getProvider(id) }, modelId, { exact: true }),
  })
  gateway.registerProvider(provider('grok-cli', ['grok-cli-default'], calls))
  gateway.registerProvider(provider('openai', ['gpt-4o'], calls))
  for (const id of ['grok-cli', 'openai']) {
    svc.ensureProvider(id)
    svc.updateProvider(id, { enabled: true })
  }
  svc.upsertModels('grok-cli', [info('grok-cli-default', 'grok-cli'), info('grok-cli-grok-4.6', 'grok-cli')])
  svc.upsertModels('openai', [info('gpt-4o', 'openai'), info('gpt-5.2', 'openai')])
  return { gateway, calls }
}

describe('gateway: model-only resolution through the persisted catalog', () => {
  it('a model present only in an enabled model_config row resolves to its provider (positive)', async () => {
    const { gateway, calls } = setup()
    await gateway.complete({ model: 'grok-cli-grok-4.6', messages: [{ role: 'user', content: 'hi' }] })
    await gateway.complete({ model: 'gpt-5.2', messages: [{ role: 'user', content: 'hi' }] })
    expect(calls).toEqual([
      { provider: 'grok-cli', model: 'grok-cli-grok-4.6' },
      { provider: 'openai', model: 'gpt-5.2' },
    ])
  })

  it('a listModels() hit wins over the catalog lookup', async () => {
    const { gateway, calls } = setup()
    const lookup = vi.fn(() => 'grok-cli')
    const gw = createModelGateway(undefined, { lookupModelOwner: lookup })
    gw.registerProvider(gateway.getProvider('openai')!)
    gw.registerProvider(gateway.getProvider('grok-cli')!)
    await gw.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
    expect(calls.at(-1)).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('a disabled model row still throws "No provider found" (negative)', async () => {
    const { gateway, calls } = setup()
    svc.updateModel('grok-cli:grok-cli-grok-4.6', { enabled: false })
    await expect(gateway.complete({ model: 'grok-cli-grok-4.6', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('No provider found for model: grok-cli-grok-4.6')
    expect(calls).toEqual([])
  })

  it('a disabled provider, or one not registered, still throws (negative)', async () => {
    const { gateway } = setup()
    svc.updateProvider('grok-cli', { enabled: false })
    await expect(gateway.complete({ model: 'grok-cli-grok-4.6', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('No provider found')
    svc.updateProvider('grok-cli', { enabled: true })
    gateway.unregisterProvider('grok-cli')
    await expect(gateway.complete({ model: 'grok-cli-grok-4.6', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('No provider found')
  })

  it('an unknown model and a model two providers own both throw — the gateway never guesses (negative)', async () => {
    const { gateway } = setup()
    await expect(gateway.complete({ model: 'no-such-model', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('No provider found')
    svc.upsertModels('grok-cli', [info('gpt-5.2', 'grok-cli')])
    await expect(gateway.complete({ model: 'gpt-5.2', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('No provider found')
  })

  it('a failing lookup counts as "no owner" and is logged, not thrown (negative)', async () => {
    const warn = vi.fn()
    const gw = createModelGateway(undefined, { lookupModelOwner: () => { throw new Error('db locked') }, logger: { warn } })
    gw.registerProvider(provider('openai', ['gpt-4o'], []))
    await expect(gw.complete({ model: 'gpt-5.2', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('No provider found')
    expect(warn).toHaveBeenCalled()
  })
})
