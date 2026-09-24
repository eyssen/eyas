// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D2 — the egress slot inside the raw gateway. The installed filter runs on
// EVERY attempt right after provider resolution, so the first try, the
// same-provider retry and the tier-fallback hop are each filtered for the
// provider they actually reach, always from the raw attempt (never twice).
// embed() goes through the same slot. An empty slot is a byte-identical
// passthrough, and the filter's output — spread-preserving by contract —
// is exactly what the provider receives.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createModelGateway } from '@modules/model/gateway'
import { createEgressSlot, type EgressFilter } from '@modules/model/egress'
import type { AIProvider, EmbedRequest, EmbedResponse, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import type { ModuleContext } from '@core/types'

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

/** Records every request object it receives; each script step throws or succeeds. */
function recordingProvider(id: string, script: Array<Error | 'ok'> = [], extra: Partial<AIProvider> = {}) {
  const received: ModelRequest[] = []
  const embedded: EmbedRequest[] = []
  let calls = 0
  const provider: AIProvider = {
    id,
    name: id,
    async listModels() { return [] },
    async complete(r) {
      received.push(r)
      const step = script[calls++] ?? 'ok'
      if (step instanceof Error) throw step
      return response(id)
    },
    async *stream(r): AsyncIterable<StreamEvent> {
      received.push(r)
      const step = script[calls++] ?? 'ok'
      if (step instanceof Error) throw step
      yield { type: 'text', text: `ok from ${id}` }
      yield { type: 'done', response: response(id) }
    },
    async embed(r): Promise<EmbedResponse> {
      embedded.push(r)
      return { provider: id, model: 'e', embeddings: r.texts.map(() => [0.1]), dimensions: 1 }
    },
    ...extra,
  }
  return { provider, received, embedded }
}

const rateLimit = () => Object.assign(new Error('rate limit exceeded'), { status: 429 })

const req = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  provider: 'p1',
  model: 'm',
  messages: [{ role: 'user', content: 'secret alice@example.com' }],
  ...extra,
})

/** Masks the user text with the provider id, so every hop's output is distinguishable. */
function tagFilter(): EgressFilter & { seen: Array<{ req: ModelRequest; providerId: string }>; embeds: Array<{ req: EmbedRequest; providerId: string }> } {
  const seen: Array<{ req: ModelRequest; providerId: string }> = []
  const embeds: Array<{ req: EmbedRequest; providerId: string }> = []
  return {
    seen,
    embeds,
    request(r, provider) {
      seen.push({ req: r, providerId: provider.id })
      return {
        ...r,
        messages: r.messages.map((m) => ({ ...m, content: typeof m.content === 'string' ? `[${provider.id}]${m.content.replace('alice@example.com', '[EMAIL]')}` : m.content })),
      }
    },
    embed(r, provider) {
      embeds.push({ req: r, providerId: provider.id })
      return { ...r, texts: r.texts.map((t) => t.replace('alice@example.com', '[EMAIL]')) }
    },
  }
}

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

describe('egress slot', () => {
  it('starts empty, installs one filter and uninstalls it', () => {
    const slot = createEgressSlot()
    expect(slot.current()).toBeUndefined()
    const filter = tagFilter()
    const uninstall = slot.install(filter)
    expect(slot.current()).toBe(filter)
    uninstall()
    expect(slot.current()).toBeUndefined()
    // A second uninstall is harmless.
    uninstall()
    expect(slot.current()).toBeUndefined()
  })

  it('refuses a second install while one filter is in place (one mechanism, no chain)', () => {
    const slot = createEgressSlot()
    const first = tagFilter()
    slot.install(first)
    expect(() => slot.install(tagFilter())).toThrow(/already installed/)
    expect(slot.current()).toBe(first)
  })

  it('a stale uninstall cannot remove a filter installed after it', () => {
    const slot = createEgressSlot()
    const uninstallFirst = slot.install(tagFilter())
    uninstallFirst()
    const second = tagFilter()
    slot.install(second)
    uninstallFirst()
    expect(slot.current()).toBe(second)
  })
})

/** What the provider received minus the gateway's own effortPlan (E2 adds it to every attempt). */
function withoutPlan(r: ModelRequest): ModelRequest {
  const { effortPlan: _plan, ...rest } = r
  return rest
}

/** Every caller field reached the provider by reference, and the caller's object gained nothing. */
function expectPassedThrough(sent: ModelRequest, request: ModelRequest): void {
  expect(sent).not.toBe(request)
  for (const [key, value] of Object.entries(request)) expect((sent as any)[key]).toBe(value)
  expect(Object.keys(withoutPlan(sent)).sort()).toEqual(Object.keys(request).sort())
  expect(sent.effortPlan).toBeDefined()
  expect('effortPlan' in request).toBe(false)
}

describe('gateway egress — passthrough', () => {
  it('without a slot the provider receives the caller\'s fields unchanged, plus the gateway\'s effort plan', async () => {
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway()
    gateway.registerProvider(p1.provider)
    const request = req()
    await gateway.complete(request)
    expectPassedThrough(p1.received[0], request)
  })

  it('an empty slot is a byte-identical passthrough of the caller\'s fields for complete, stream and embed', async () => {
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: createEgressSlot() })
    gateway.registerProvider(p1.provider)
    const request = req()
    const snapshot = JSON.stringify(request)

    await gateway.complete(request)
    await drain(gateway.stream(request))
    const embedReq: EmbedRequest = { provider: 'p1', texts: ['alice@example.com'] }
    await gateway.embed(embedReq)

    expectPassedThrough(p1.received[0], request)
    expectPassedThrough(p1.received[1], request)
    expect(JSON.stringify(withoutPlan(p1.received[0]))).toBe(snapshot)
    expect(JSON.stringify(request)).toBe(snapshot)
    expect(p1.embedded[0]).toBe(embedReq)
  })

  it('a filter that returns its input unchanged hands the caller\'s fields to the provider untouched', async () => {
    const slot = createEgressSlot()
    slot.install({ request: (r) => r, embed: (r) => r })
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)
    const request = req()
    await gateway.complete(request)
    expectPassedThrough(p1.received[0], request)
  })
})

describe('gateway egress — complete()', () => {
  it('the provider receives the filter\'s return value, and the caller\'s request is untouched', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)
    const request = req()

    await gateway.complete(request)

    expect(filter.seen).toHaveLength(1)
    expect(filter.seen[0].providerId).toBe('p1')
    expect(filter.seen[0].req).toBe(request)
    expect(p1.received[0].messages[0].content).toBe('[p1]secret [EMAIL]')
    expect(request.messages[0].content).toBe('secret alice@example.com')
  })

  it('filters the first attempt, the same-provider retry and the tier-fallback hop, each for its own provider', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    // A local primary fails retryably twice; the remote tier fallback answers.
    const local = recordingProvider('local', [rateLimit(), rateLimit()])
    const remote = recordingProvider('remote')
    const gateway = createModelGateway(undefined, {
      egress: slot,
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'remote', modelId: 'rm' }),
    })
    gateway.registerProvider(local.provider)
    gateway.registerProvider(remote.provider)

    const res = await gateway.complete(req({ provider: 'local', metadata: { tier: 'standard' } }))

    expect(res.provider).toBe('remote')
    expect(filter.seen.map((s) => s.providerId)).toEqual(['local', 'local', 'remote'])
    expect(local.received.map((r) => r.messages[0].content)).toEqual(['[local]secret [EMAIL]', '[local]secret [EMAIL]'])
    // The fallback provider receives the filter's output for ITSELF.
    expect(remote.received).toHaveLength(1)
    expect(remote.received[0].messages[0].content).toBe('[remote]secret [EMAIL]')
    expect(remote.received[0]).toMatchObject({ provider: 'remote', model: 'rm' })
  })

  it('always hands the filter the raw attempt, never its own earlier output (no double filtering)', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const local = recordingProvider('local', [rateLimit(), rateLimit()])
    const remote = recordingProvider('remote')
    const gateway = createModelGateway(undefined, {
      egress: slot,
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'remote', modelId: 'rm' }),
    })
    gateway.registerProvider(local.provider)
    gateway.registerProvider(remote.provider)

    await gateway.complete(req({ provider: 'local', metadata: { tier: 'standard' } }))

    for (const { req: seen } of filter.seen) {
      expect(seen.messages[0].content).toBe('secret alice@example.com')
    }
    // Negative: no provider ever got a doubly tagged text.
    for (const r of [...local.received, ...remote.received]) {
      expect(String(r.messages[0].content)).not.toMatch(/^\[\w+\]\[\w+\]/)
    }
  })

  it('fields the filter does not touch survive by reference (metadata, tools, the effort intent), and the effort plan is the gateway\'s', async () => {
    const slot = createEgressSlot()
    slot.install(tagFilter())
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)
    const metadata = { conversationId: 'c1', compositionId: 'comp-1' }
    const tools = [{ name: 'memory_search', description: 'search memory', inputSchema: {} }]
    const signal = new AbortController().signal
    const effort = { level: 'high' as const, source: 'conversation' as const }
    const callerPlan = { level: 'max', thinking: 'on' } as unknown as ModelRequest['effortPlan']
    const request = req({ metadata, tools, signal, system: 'sys', maxTokens: 99, effort, effortPlan: callerPlan })

    // A tools-bearing call: complete() makes exactly one attempt.
    await gateway.complete(request)

    const sent = p1.received[0]
    expect(sent).not.toBe(request)
    expect(sent.metadata).toBe(metadata)
    expect(sent.tools).toBe(tools)
    expect(sent.signal).toBe(signal)
    expect(sent.effort).toBe(effort)
    // The caller's plan never reaches the provider: the gateway resolves its own.
    expect(sent.effortPlan).not.toBe(callerPlan)
    expect(sent.effortPlan?.level).toBe('auto')
    expect(sent.system).toBe('sys')
    expect(sent.maxTokens).toBe(99)
  })

  it('an unpinned request is filtered for the provider the default binding resolved', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const p1 = recordingProvider('p1')
    const p2 = recordingProvider('p2')
    const gateway = createModelGateway(undefined, { egress: slot, getDefault: () => ({ providerId: 'p2', modelId: 'm2' }) })
    gateway.registerProvider(p1.provider)
    gateway.registerProvider(p2.provider)

    await gateway.complete({ messages: [{ role: 'user', content: 'alice@example.com' }] })

    expect(filter.seen.map((s) => s.providerId)).toEqual(['p2'])
    expect(p2.received[0].messages[0].content).toBe('[p2][EMAIL]')
    expect(p1.received).toHaveLength(0)
  })

  it('a filter that throws fails the call closed: the provider is never called with the raw request', async () => {
    const slot = createEgressSlot()
    slot.install({ request: () => { throw new Error('filter broke') }, embed: (r) => r })
    const onError = vi.fn()
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway({ onError }, { egress: slot, sleep: async () => {} })
    gateway.registerProvider(p1.provider)

    await expect(gateway.complete(req())).rejects.toThrow('filter broke')
    expect(p1.received).toHaveLength(0)
    // Not a provider failure: the reauth healer is not told about it.
    expect(onError).not.toHaveBeenCalled()
  })

  it('a filter that returns nothing fails closed instead of sending the raw request', async () => {
    const slot = createEgressSlot()
    slot.install({ request: () => undefined as unknown as ModelRequest, embed: (r) => r })
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)

    await expect(gateway.complete(req())).rejects.toThrow(/Egress filter returned no request/)
    expect(p1.received).toHaveLength(0)
  })
})

describe('gateway egress — stream()', () => {
  it('filters the retry and the tier-fallback hop of a stream, each for its own provider', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const local = recordingProvider('local', [rateLimit(), rateLimit()])
    const remote = recordingProvider('remote')
    const gateway = createModelGateway(undefined, {
      egress: slot,
      sleep: async () => {},
      getTierFallback: () => ({ providerId: 'remote', modelId: 'rm' }),
    })
    gateway.registerProvider(local.provider)
    gateway.registerProvider(remote.provider)

    const events = await drain(gateway.stream(req({ provider: 'local', metadata: { tier: 'standard' } })))

    expect(events.at(-1)).toMatchObject({ type: 'done', response: { provider: 'remote' } })
    expect(filter.seen.map((s) => s.providerId)).toEqual(['local', 'local', 'remote'])
    expect(filter.seen.every((s) => s.req.messages[0].content === 'secret alice@example.com')).toBe(true)
    expect(remote.received[0].messages[0].content).toBe('[remote]secret [EMAIL]')
  })

  it('a stream whose filter throws yields nothing and never reaches the provider', async () => {
    const slot = createEgressSlot()
    slot.install({ request: () => { throw new Error('filter broke') }, embed: (r) => r })
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)

    await expect(drain(gateway.stream(req()))).rejects.toThrow('filter broke')
    expect(p1.received).toHaveLength(0)
  })
})

describe('gateway egress — embed()', () => {
  it('an explicit provider receives the filter\'s embed output, filtered for that provider', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)
    const request: EmbedRequest = { provider: 'p1', texts: ['mail alice@example.com'] }

    await gateway.embed(request)

    expect(filter.embeds).toHaveLength(1)
    expect(filter.embeds[0].providerId).toBe('p1')
    expect(filter.embeds[0].req).toBe(request)
    expect(p1.embedded[0].texts).toEqual(['mail [EMAIL]'])
    expect(request.texts).toEqual(['mail alice@example.com'])
  })

  it('an auto-discovered embedding provider is the one the filter is told about', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const noEmbed = recordingProvider('chat-only', [], { embed: undefined })
    const embedder = recordingProvider('embedder')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(noEmbed.provider)
    gateway.registerProvider(embedder.provider)

    const res = await gateway.embed({ texts: ['alice@example.com'] })

    expect(res.provider).toBe('embedder')
    expect(filter.embeds.map((e) => e.providerId)).toEqual(['embedder'])
    expect(embedder.embedded[0].texts).toEqual(['[EMAIL]'])
  })

  it('resolution errors still surface before any filtering', async () => {
    const slot = createEgressSlot()
    const filter = tagFilter()
    slot.install(filter)
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(recordingProvider('chat-only', [], { embed: undefined }).provider)

    await expect(gateway.embed({ provider: 'missing', texts: ['x'] })).rejects.toThrow('Provider not found')
    await expect(gateway.embed({ provider: 'chat-only', texts: ['x'] })).rejects.toThrow('does not support embeddings')
    await expect(gateway.embed({ texts: ['x'] })).rejects.toThrow('No embedding-capable provider registered')
    expect(filter.embeds).toHaveLength(0)
  })

  it('a filter whose embed throws fails the call and never reaches the provider', async () => {
    const slot = createEgressSlot()
    slot.install({ request: (r) => r, embed: () => { throw new Error('embed filter broke') } })
    const p1 = recordingProvider('p1')
    const gateway = createModelGateway(undefined, { egress: slot })
    gateway.registerProvider(p1.provider)

    await expect(gateway.embed({ provider: 'p1', texts: ['x'] })).rejects.toThrow('embed filter broke')
    expect(p1.embedded).toHaveLength(0)
  })
})

describe('model module wiring', () => {
  const testDb = createTestDb('model-egress-wiring')
  afterEach(() => testDb.cleanup())

  function buildCtx(): ModuleContext {
    const db = testDb.open()
    const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger } } as any
    return {
      db,
      logger,
      http: new Hono(),
      setup: createSetupRegistry(db),
      secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
    } as unknown as ModuleContext
  }

  it('publishes ctx.modelEgress, and a filter installed there governs ctx.model — even a reference captured earlier', async () => {
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx()
    await modelModule.onRegister(ctx)
    expect(ctx.modelEgress).toBeDefined()
    expect(ctx.modelEgress!.current()).toBeUndefined()

    // Captured before any filter exists (decision-engine style).
    const captured = ctx.model
    const p1 = recordingProvider('p1')
    captured.registerProvider(p1.provider)

    ctx.modelEgress!.install(tagFilter())
    await captured.complete(req())

    expect(p1.received[0].messages[0].content).toBe('[p1]secret [EMAIL]')
  })
})
