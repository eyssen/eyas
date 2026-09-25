import { describe, it, expect } from 'vitest'
import { createModelGateway } from '@modules/model/gateway'
import type { AIProvider, ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'

function healthyProvider(id: string, models: ModelInfo[]): AIProvider {
  return {
    id,
    name: id,
    async listModels() { return models },
    async complete(req: ModelRequest): Promise<ModelResponse> {
      return { id: 'r', provider: id, model: req.model || models[0].id, content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *stream(): AsyncIterable<StreamEvent> { yield { type: 'text', text: '' } },
  }
}

function unreachableProvider(id: string): AIProvider {
  return {
    id,
    name: id,
    async listModels(): Promise<ModelInfo[]> { throw new Error('fetch failed') },
    async complete(): Promise<ModelResponse> { throw new Error('unreachable') },
    async *stream(): AsyncIterable<StreamEvent> { throw new Error('unreachable') },
  }
}

const anthropicModel: ModelInfo = {
  id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic',
  contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsTools: true, supportsImages: true, supportsStreaming: true,
}

describe('gateway resolveProvider — one unreachable provider must not poison others', () => {
  it('resolves a healthy model id even when another provider listModels() throws', async () => {
    const gateway = createModelGateway()
    // ollama registered while reachable, then went down (listModels throws now).
    gateway.registerProvider(unreachableProvider('ollama'))
    gateway.registerProvider(healthyProvider('anthropic', [anthropicModel]))

    // Model-only request (no explicit provider) triggers the cache build.
    const res = await gateway.complete({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.provider).toBe('anthropic')
  })

  it('listAllModels() skips the failing provider instead of throwing', async () => {
    const gateway = createModelGateway()
    gateway.registerProvider(unreachableProvider('ollama'))
    gateway.registerProvider(healthyProvider('anthropic', [anthropicModel]))

    const all = await gateway.listAllModels()
    expect(all.map(m => m.id)).toEqual(['claude-sonnet-4-6'])
  })
})
