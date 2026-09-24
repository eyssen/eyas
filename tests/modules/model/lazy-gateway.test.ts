import { describe, it, expect, vi } from 'vitest'
import { createLazyGateway } from '@modules/model/lazy-gateway'
import type { ModelGateway, ModelRequest } from '@modules/model/types'

function makeGateway(tag: string): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => ({ id: tag, provider: 'mock', model: 'mock', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } })),
    stream: vi.fn(async function* () {}) as any,
    embed: vi.fn(),
  } as unknown as ModelGateway
}
const req = { messages: [{ role: 'user', content: 'hi' }] } as ModelRequest

describe('createLazyGateway', () => {
  it('routes every call through the CURRENT resolve() target', async () => {
    const a = makeGateway('a'); const b = makeGateway('b')
    const ctx = { model: a }
    const lazy = createLazyGateway(() => ctx.model)
    expect((await lazy.complete(req)).id).toBe('a')
    ctx.model = b // simulates privacy/observability wrap during onStart
    expect((await lazy.complete(req)).id).toBe('b')
    expect(a.complete).toHaveBeenCalledTimes(1)
    expect(b.complete).toHaveBeenCalledTimes(1)
  })

  it('survives destructuring (agent-runner/orchestrator deps pattern)', async () => {
    const a = makeGateway('a'); const b = makeGateway('b')
    const ctx = { model: a }
    const deps = { gateway: createLazyGateway(() => ctx.model) }
    const { gateway } = deps
    ctx.model = b
    expect((await gateway.complete(req)).id).toBe('b')
  })
})
