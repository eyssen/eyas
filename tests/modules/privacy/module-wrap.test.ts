import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { privacyModule } from '@modules/privacy/index'

function makeGateway(tag: string) {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => ({ id: tag, provider: 'mock', model: 'mock', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } })),
    stream: vi.fn(async function* () {}) as any,
    embed: vi.fn(),
  }
}

describe('Privacy module — onStart wraps ctx.model', () => {
  it('replaces ctx.model with the scanning wrapper', async () => {
    const raw = makeGateway('raw')
    const ctx = {
      model: raw, http: new Hono(), bus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
    } as any
    await privacyModule.onStart(ctx)
    expect(ctx.model).not.toBe(raw)
    await expect(ctx.model.complete({
      messages: [{ role: 'user', content: 'card: 4111 1111 1111 1111' }],
    })).rejects.toThrow(/Privacy policy blocked/)
    expect(raw.complete).not.toHaveBeenCalled()
  }, 15_000)
})
