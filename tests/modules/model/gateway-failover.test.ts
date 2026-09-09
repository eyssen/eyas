// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D10: failover lives INSIDE the gateway, so every caller (chat, agent runner,
// scheduler) gets it without re-implementing retry. The rules are deliberately
// narrow — one same-provider retry on a transient error, and a cross-provider
// hop only for auto-routed calls (metadata.tier present) whose tier declares a
// registered fallback. A provider-pinned call must never be silently answered
// by a different provider, and a stream that already delivered a chunk can
// never be retried without duplicating output.

import { describe, it, expect, vi } from 'vitest'
import { createModelGateway } from '@modules/model/gateway'
import type { AIProvider, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'

function response(providerId: string): ModelResponse {
  return {
    id: `resp-${providerId}`,
    provider: providerId,
    model: 'm',
    content: [{ type: 'text', text: `ok from ${providerId}` }],
    stopReason: 'end',
    usage: { inputTokens: 1, outputTokens: 1 },
  }
}

/** Provider whose behaviour per attempt is scripted: an Error throws, else succeeds. */
function scriptedProvider(id: string, script: Array<Error | 'ok'>): AIProvider & { calls: number } {
  const provider = {
    id,
    name: id,
    calls: 0,
    async listModels() { return [] },
    async complete(_req: ModelRequest): Promise<ModelResponse> {
      const step = script[provider.calls] ?? 'ok'
      provider.calls++
      if (step instanceof Error) throw step
      return response(id)
    },
    async *stream(_req: ModelRequest): AsyncIterable<StreamEvent> {
      const step = script[provider.calls] ?? 'ok'
      provider.calls++
      if (step instanceof Error) throw step
      yield { type: 'text', text: `ok from ${id}` }
      yield { type: 'done', response: response(id) }
    },
  }
  return provider
}

const rateLimit = () => Object.assign(new Error('rate limit exceeded'), { status: 429 })
const authError = () => Object.assign(new Error('invalid api key'), { status: 401 })

const req = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  provider: 'p1',
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
  ...extra,
})

describe('ModelGateway failover — complete()', () => {
  it('retries the same provider once after a retryable error and returns the second result', async () => {
    const sleep = vi.fn(async () => {})
    const p1 = scriptedProvider('p1', [rateLimit(), 'ok'])
    const gateway = createModelGateway(undefined, { sleep })
    gateway.registerProvider(p1)

    const res = await gateway.complete(req())

    expect(res.provider).toBe('p1')
    expect(p1.calls).toBe(2)
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('falls over to the tier fallback provider after two failures', async () => {
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const p1 = scriptedProvider('p1', [rateLimit(), rateLimit()])
    const p2 = scriptedProvider('p2', ['ok'])
    const getTierFallback = vi.fn(() => ({ providerId: 'p2', modelId: 'm2' }))
    const gateway = createModelGateway({ onError, onSuccess }, { sleep: async () => {}, getTierFallback })
    gateway.registerProvider(p1)
    gateway.registerProvider(p2)

    const res = await gateway.complete(req({ metadata: { tier: 'standard' } }))

    expect(res.provider).toBe('p2')
    expect(p1.calls).toBe(2)
    expect(p2.calls).toBe(1)
    expect(getTierFallback).toHaveBeenCalledWith('standard')
    // onError fires per failed attempt so the reauth healer sees every failure.
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls.every(([id]) => id === 'p1')).toBe(true)
    expect(onSuccess).toHaveBeenCalledWith('p2')
  })

  it('rewrites provider AND model for the fallback attempt', async () => {
    const seen: Array<{ provider?: string; model?: string }> = []
    const p1 = scriptedProvider('p1', [rateLimit(), rateLimit()])
    const p2: AIProvider = {
      id: 'p2', name: 'p2',
      async listModels() { return [] },
      async complete(r) { seen.push({ provider: r.provider, model: r.model }); return response('p2') },
      async *stream() { yield { type: 'done', response: response('p2') } },
    }
    const gateway = createModelGateway(undefined, {
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'p2', modelId: 'm2' }),
    })
    gateway.registerProvider(p1)
    gateway.registerProvider(p2)

    await gateway.complete(req({ metadata: { tier: 'complex' } }))

    expect(seen).toEqual([{ provider: 'p2', model: 'm2' }])
  })

  it('never crosses providers when the request carries no tier', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), rateLimit()])
    const p2 = scriptedProvider('p2', ['ok'])
    const getTierFallback = vi.fn(() => ({ providerId: 'p2', modelId: 'm2' }))
    const gateway = createModelGateway(undefined, { sleep: async () => {}, getTierFallback })
    gateway.registerProvider(p1)
    gateway.registerProvider(p2)

    await expect(gateway.complete(req())).rejects.toThrow('rate limit')
    expect(p1.calls).toBe(2)
    expect(p2.calls).toBe(0)
    expect(getTierFallback).not.toHaveBeenCalled()
  })

  it('does not fail over to an unregistered fallback provider', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), rateLimit()])
    const gateway = createModelGateway(undefined, {
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'ghost', modelId: 'm2' }),
    })
    gateway.registerProvider(p1)

    await expect(gateway.complete(req({ metadata: { tier: 'standard' } }))).rejects.toThrow('rate limit')
    expect(p1.calls).toBe(2)
  })

  it('rethrows a terminal error immediately without retrying', async () => {
    const sleep = vi.fn(async () => {})
    const p1 = scriptedProvider('p1', [authError(), 'ok'])
    const gateway = createModelGateway(undefined, { sleep, getTierFallback: () => ({ providerId: 'p2', modelId: 'm2' }) })
    gateway.registerProvider(p1)

    await expect(gateway.complete(req({ metadata: { tier: 'standard' } }))).rejects.toThrow('invalid api key')
    expect(p1.calls).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  // claude-code implements complete() by draining its own stream — the full
  // agentic loop, tool side effects included. A retry would re-execute them and
  // double the cost, and unlike stream() there is no per-event signal telling
  // how far the run got.
  it('does not retry a tools-bearing completion', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), 'ok'])
    const gateway = createModelGateway(undefined, {
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'p2', modelId: 'm2' }),
    })
    gateway.registerProvider(p1)
    gateway.registerProvider(scriptedProvider('p2', ['ok']))

    const request = req({
      metadata: { tier: 'standard' },
      tools: [{ name: 'shell', description: 'runs commands', inputSchema: {} }],
    })
    await expect(gateway.complete(request)).rejects.toThrow('rate limit')
    expect(p1.calls).toBe(1)
  })

  it('still retries a completion that declared an empty tool list', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), 'ok'])
    const gateway = createModelGateway(undefined, { sleep: async () => {} })
    gateway.registerProvider(p1)

    await expect(gateway.complete(req({ tools: [] }))).resolves.toMatchObject({ provider: 'p1' })
    expect(p1.calls).toBe(2)
  })

  it('does not retry a call the caller already cancelled', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), 'ok'])
    const gateway = createModelGateway(undefined, { sleep: async () => {} })
    gateway.registerProvider(p1)
    const controller = new AbortController()
    controller.abort()

    await expect(gateway.complete(req({ signal: controller.signal }))).rejects.toThrow('rate limit')
    expect(p1.calls).toBe(1)
  })

  it('gives up after the fallback provider also fails', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), rateLimit()])
    const p2 = scriptedProvider('p2', [rateLimit(), 'ok'])
    const gateway = createModelGateway(undefined, {
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'p2', modelId: 'm2' }),
    })
    gateway.registerProvider(p1)
    gateway.registerProvider(p2)

    await expect(gateway.complete(req({ metadata: { tier: 'standard' } }))).rejects.toThrow('rate limit')
    expect(p1.calls).toBe(2)
    expect(p2.calls).toBe(1)
  })
})

describe('ModelGateway failover — stream()', () => {
  async function collect(iter: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; thrown: unknown }> {
    const events: StreamEvent[] = []
    let thrown: unknown
    try {
      for await (const ev of iter) events.push(ev)
    } catch (err) { thrown = err }
    return { events, thrown }
  }

  it('retries when the stream fails before yielding anything', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), 'ok'])
    const gateway = createModelGateway(undefined, { sleep: async () => {} })
    gateway.registerProvider(p1)

    const { events, thrown } = await collect(gateway.stream(req()))

    expect(thrown).toBeUndefined()
    expect(p1.calls).toBe(2)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('rethrows without retrying once a chunk has been yielded', async () => {
    let calls = 0
    const flaky: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { return response('p1') },
      async *stream() {
        calls++
        yield { type: 'text', text: 'partial' }
        throw rateLimit()
      },
    }
    const gateway = createModelGateway(undefined, {
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'p2', modelId: 'm2' }),
    })
    gateway.registerProvider(flaky)
    gateway.registerProvider(scriptedProvider('p2', ['ok']))

    const { events, thrown } = await collect(gateway.stream(req({ metadata: { tier: 'standard' } })))

    expect(calls).toBe(1)
    expect(thrown).toBeInstanceOf(Error)
    expect(events).toHaveLength(1)
  })

  // grok-cli reports a failure BOTH ways: it yields an error frame and then
  // throws (D9). The frame is not answer content, so it must not block the
  // retry, and it must not reach the consumer twice — once as a frame and
  // again as the thrown error the caller renders.
  it('retries a provider that yields an error frame before throwing, without leaking the frame', async () => {
    let calls = 0
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { return response('p1') },
      async *stream(): AsyncIterable<StreamEvent> {
        calls++
        if (calls === 1) {
          yield { type: 'error', error: rateLimit() }
          throw rateLimit()
        }
        yield { type: 'done', response: response('p1') }
      },
    }
    const gateway = createModelGateway(undefined, { sleep: async () => {} })
    gateway.registerProvider(provider)

    const { events, thrown } = await collect(gateway.stream(req()))

    expect(thrown).toBeUndefined()
    expect(calls).toBe(2)
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('drops the error frame when it gives up — the throw is the transport', async () => {
    const err = authError()
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { return response('p1') },
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: 'error', error: err }
        throw err
      },
    }
    const gateway = createModelGateway(undefined, { sleep: async () => {} })
    gateway.registerProvider(provider)

    const { events, thrown } = await collect(gateway.stream(req()))

    expect(thrown).toBe(err)
    expect(events).toHaveLength(0)
  })

  // LM Studio reports an HTTP failure as an error frame and ends the stream
  // normally. Nothing throws, so the frame is the only signal — swallowing it
  // would turn a failed call into a silent empty answer.
  it('forwards an error frame from a provider that ends without throwing, and reports it as a failure', async () => {
    const failure = new Error('LM Studio stream error: 500')
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { return response('p1') },
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: 'error', error: failure }
      },
    }
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const gateway = createModelGateway({ onError, onSuccess }, { sleep: async () => {} })
    gateway.registerProvider(provider)

    const { events, thrown } = await collect(gateway.stream(req()))

    expect(thrown).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('error')
    // Health must not be cleared by a call that failed — it only reported the
    // failure as a frame instead of throwing.
    expect(onError).toHaveBeenCalledWith('p1', failure)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('reports success normally when a mid-stream error frame is followed by real content', async () => {
    const onError = vi.fn()
    const onSuccess = vi.fn()
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { return response('p1') },
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: 'error', error: new Error('recoverable hiccup') }
        yield { type: 'done', response: response('p1') }
      },
    }
    const gateway = createModelGateway({ onError, onSuccess }, { sleep: async () => {} })
    gateway.registerProvider(provider)

    const { events } = await collect(gateway.stream(req()))

    expect(events.map((e) => e.type)).toEqual(['error', 'done'])
    expect(onSuccess).toHaveBeenCalledWith('p1')
    expect(onError).not.toHaveBeenCalled()
  })

  it('falls over cross-provider for an auto-routed stream that never yielded', async () => {
    const p1 = scriptedProvider('p1', [rateLimit(), rateLimit()])
    const p2 = scriptedProvider('p2', ['ok'])
    const gateway = createModelGateway(undefined, {
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'p2', modelId: 'm2' }),
    })
    gateway.registerProvider(p1)
    gateway.registerProvider(p2)

    const { events, thrown } = await collect(gateway.stream(req({ metadata: { tier: 'standard' } })))

    expect(thrown).toBeUndefined()
    expect(p2.calls).toBe(1)
    const done = events.find((e) => e.type === 'done')
    expect(done && done.type === 'done' && done.response.provider).toBe('p2')
  })
})
