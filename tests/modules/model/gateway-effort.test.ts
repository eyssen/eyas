// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E2 — the gateway is the one place effort is resolved: per attempt, after
// routing, failover and the egress slot, against the model that attempt goes
// to. Providers receive request.effortPlan; callers get response.effortOutcome.

import { describe, it, expect, vi } from 'vitest'
import { createModelGateway, type ModelGatewayOptions } from '@modules/model/gateway'
import { createEgressSlot } from '@modules/model/egress'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'
import { readbackOutcome } from '@modules/model/reasoning/outcome.js'
import type { AIProvider, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'

const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })

/** Every test provider serves Anthropic model ids, so the overlay's anthropic rows apply. */
const anthropicCapability: ModelGatewayOptions['getReasoningCapability'] = (_providerId, modelId) => registry.get('anthropic', modelId)

function response(providerId: string, model = 'm'): ModelResponse {
  return {
    id: `resp-${providerId}`,
    provider: providerId,
    model,
    content: [{ type: 'text', text: `ok from ${providerId}` }],
    stopReason: 'end',
    usage: { inputTokens: 1, outputTokens: 1 },
  }
}

const rateLimit = () => Object.assign(new Error('rate limit exceeded'), { status: 429 })

/** Records each request; script steps throw or succeed; `respond` shapes the response. */
function recordingProvider(id: string, opts: { script?: Array<Error | 'ok'>; respond?: (r: ModelRequest) => ModelResponse } = {}) {
  const received: ModelRequest[] = []
  let calls = 0
  const respond = opts.respond ?? ((r: ModelRequest) => response(id, r.model))
  const provider: AIProvider = {
    id,
    name: id,
    async listModels() { return [] },
    async complete(r) {
      received.push(r)
      const step = opts.script?.[calls++] ?? 'ok'
      if (step instanceof Error) throw step
      return respond(r)
    },
    async *stream(r): AsyncIterable<StreamEvent> {
      received.push(r)
      const step = opts.script?.[calls++] ?? 'ok'
      if (step instanceof Error) throw step
      yield { type: 'text', text: `ok from ${id}` }
      yield { type: 'done', response: respond(r) }
    },
  }
  return { provider, received }
}

function gatewayWith(options: ModelGatewayOptions = {}, ...providers: AIProvider[]) {
  const gateway = createModelGateway(undefined, { getReasoningCapability: anthropicCapability, sleep: async () => {}, ...options })
  for (const p of providers) gateway.registerProvider(p)
  return gateway
}

async function drain(stream: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

function doneOf(events: StreamEvent[]): ModelResponse {
  const done = events.find((e) => e.type === 'done')
  if (!done || done.type !== 'done') throw new Error('no done event')
  return done.response
}

describe('gateway effort — the plan follows the answering model', () => {
  it('the provider receives an effortPlan resolved for ITS model', async () => {
    const p = recordingProvider('p1')
    const gateway = gatewayWith({}, p.provider)
    await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'xhigh', source: 'conversation' } })
    const plan = p.received[0].effortPlan!
    expect(plan.level).toBe('xhigh')
    expect(plan.thinking).toBe('on')
    expect(plan.capability.overlayRowId).toBe('anthropic-opus-4-7-4-8')
  })

  it('a failover hop re-resolves for the fallback model: xhigh on the primary, high on a high-only fallback', async () => {
    const primary = recordingProvider('primary', { script: [rateLimit(), rateLimit()] })
    const fallback = recordingProvider('fallback')
    const gateway = gatewayWith({
      getTierFallback: () => ({ providerId: 'fallback', modelId: 'claude-opus-4-6' }),
    }, primary.provider, fallback.provider)

    const result = await gateway.complete({
      provider: 'primary', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }],
      effort: { level: 'xhigh', source: 'conversation' }, metadata: { tier: 'complex' },
    })

    expect(primary.received.map((r) => r.effortPlan?.level)).toEqual(['xhigh', 'xhigh'])
    expect(fallback.received.map((r) => r.effortPlan?.level)).toEqual(['high'])
    // The intent itself travels unchanged; only the plan is per attempt.
    expect(fallback.received[0].effort).toEqual({ level: 'xhigh', source: 'conversation' })
    expect(result.effortOutcome).toEqual({ requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'unsupported' })
  })

  it('the stream path re-resolves on a hop the same way', async () => {
    const primary = recordingProvider('primary', { script: [rateLimit(), rateLimit()] })
    const fallback = recordingProvider('fallback')
    const gateway = gatewayWith({
      getTierFallback: () => ({ providerId: 'fallback', modelId: 'claude-opus-4-6' }),
    }, primary.provider, fallback.provider)
    const events = await drain(gateway.stream({
      provider: 'primary', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }],
      effort: { level: 'xhigh', source: 'agent' }, metadata: { tier: 'complex' },
    }))
    expect(fallback.received[0].effortPlan?.level).toBe('high')
    expect(doneOf(events).effortOutcome).toMatchObject({ requested: 'xhigh', effective: 'high', source: 'agent', clamped: true })
  })

  it('a caller-supplied effortPlan is discarded and replaced by the gateway\'s', async () => {
    const p = recordingProvider('p1')
    const gateway = gatewayWith({}, p.provider)
    const forged = { level: 'max', thinking: 'on', samplingLocked: false } as unknown as ModelRequest['effortPlan']
    const request: ModelRequest = { provider: 'p1', model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }], effortPlan: forged }
    await gateway.complete(request)
    await drain(gateway.stream(request))
    for (const r of p.received) {
      expect(r.effortPlan).not.toBe(forged)
      expect(r.effortPlan?.level).toBe('auto')
    }
    // The caller's object is not rewritten.
    expect(request.effortPlan).toBe(forged)
  })

  it('complete() and the stream\'s done response both carry the outcome', async () => {
    const p = recordingProvider('p1')
    const gateway = gatewayWith({}, p.provider)
    const request: ModelRequest = { provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'high', source: 'agent' } }
    const expected = { requested: 'high', effective: 'high', source: 'agent', clamped: false }
    expect((await gateway.complete(request)).effortOutcome).toEqual(expected)
    expect(doneOf(await drain(gateway.stream(request))).effortOutcome).toEqual(expected)
  })

  it('a provider readback confirmed through readbackOutcome() becomes the effective level', async () => {
    const p = recordingProvider('p1', { respond: (r) => ({ ...response('p1'), effortOutcome: readbackOutcome(r.effortPlan, 'medium') }) })
    const gateway = gatewayWith({}, p.provider)
    const request: ModelRequest = { provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'high', source: 'conversation' } }
    const expected = { requested: 'high', effective: 'medium', source: 'conversation', clamped: true, reason: 'runtime-readback', confirmed: true }
    expect((await gateway.complete(request)).effortOutcome).toEqual(expected)
    expect(doneOf(await drain(gateway.stream(request))).effortOutcome).toEqual(expected)
  })

  it('a provider outcome that is not a confirmed readback is ignored', async () => {
    const p = recordingProvider('p1', {
      respond: () => ({ ...response('p1'), effortOutcome: { requested: 'max', effective: 'max', source: 'request', clamped: false } }),
    })
    const gateway = gatewayWith({}, p.provider)
    const result = await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'low', source: 'conversation' } })
    expect(result.effortOutcome).toEqual({ requested: 'low', effective: 'low', source: 'conversation', clamped: false })
  })
})

describe('gateway effort — defaults and unknowns', () => {
  it('an auto-routed call (metadata.tier) without an intent gets the tier\'s default, clamped to the model', async () => {
    const p = recordingProvider('p1')
    const getTierEffort = vi.fn(() => 'minimal' as const)
    const gateway = gatewayWith({ getTierEffort }, p.provider)
    const result = await gateway.complete({ provider: 'p1', model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }], metadata: { tier: 'quick' } })
    expect(getTierEffort).toHaveBeenCalledWith('quick')
    // Opus 4.6 has no 'minimal': the nearest supported rung above off.
    expect(p.received[0].effortPlan?.level).toBe('low')
    expect(result.effortOutcome).toEqual({ requested: 'minimal', effective: 'low', source: 'tier', clamped: true, reason: 'unsupported' })
  })

  it('an intent wins over the tier default (negative: the tier is not even consulted)', async () => {
    const p = recordingProvider('p1')
    const getTierEffort = vi.fn(() => 'low' as const)
    const gateway = gatewayWith({ getTierEffort }, p.provider)
    await gateway.complete({ provider: 'p1', model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }], metadata: { tier: 'quick' }, effort: { level: 'max', source: 'deep' } })
    expect(getTierEffort).not.toHaveBeenCalled()
    expect(p.received[0].effortPlan?.level).toBe('max')
  })

  it('a pinned request without an intent (no tier) → auto: the model\'s own default', async () => {
    const p = recordingProvider('p1')
    const getTierEffort = vi.fn(() => 'low' as const)
    const gateway = gatewayWith({ getTierEffort }, p.provider)
    const result = await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] })
    expect(getTierEffort).not.toHaveBeenCalled()
    expect(p.received[0].effortPlan).toMatchObject({ level: 'auto', thinking: 'omit' })
    expect(result.effortOutcome).toEqual({ requested: 'auto', effective: 'auto', source: 'model', clamped: false })
  })

  it('an unknown model → auto (no-control): no guessed reasoning parameter', async () => {
    const p = recordingProvider('p1')
    const gateway = gatewayWith({}, p.provider)
    const result = await gateway.complete({ provider: 'p1', model: 'some-unknown-model', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'high', source: 'conversation' } })
    expect(p.received[0].effortPlan?.level).toBe('auto')
    expect(result.effortOutcome).toMatchObject({ requested: 'high', effective: 'auto', clamped: true, reason: 'no-control' })
  })

  it('a request naming no model (provider-only pin) → auto (model-unknown)', async () => {
    const p = recordingProvider('p1')
    const capability = vi.fn(anthropicCapability)
    const gateway = gatewayWith({ getReasoningCapability: capability }, p.provider)
    const result = await gateway.complete({ provider: 'p1', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'high', source: 'conversation' } })
    expect(capability).not.toHaveBeenCalled()
    expect(result.effortOutcome).toMatchObject({ effective: 'auto', reason: 'model-unknown' })
  })

  it('a gateway without a capability hook treats every model as unknown', async () => {
    const p = recordingProvider('p1')
    const gateway = createModelGateway()
    gateway.registerProvider(p.provider)
    await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'high', source: 'request' } })
    expect(p.received[0].effortPlan?.level).toBe('auto')
  })

  it('a failing capability lookup degrades to auto with a warning, never a failed call', async () => {
    const p = recordingProvider('p1')
    const warn = vi.fn()
    const gateway = gatewayWith({ getReasoningCapability: () => { throw new Error('db gone') }, logger: { warn } }, p.provider)
    const result = await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'high', source: 'request' } })
    expect(result.effortOutcome?.effective).toBe('auto')
    expect(warn).toHaveBeenCalled()
  })

  it('an invalid intent is ignored with a warning (the tier default then applies)', async () => {
    const p = recordingProvider('p1')
    const warn = vi.fn()
    const gateway = gatewayWith({ getTierEffort: () => 'low', logger: { warn } }, p.provider)
    const bogus = { level: 'turbo', source: 'conversation' } as unknown as ModelRequest['effort']
    const result = await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }], effort: bogus, metadata: { tier: 'quick' } })
    expect(warn).toHaveBeenCalled()
    expect(result.effortOutcome).toMatchObject({ requested: 'low', source: 'tier' })
  })

  it('clamping is logged at debug level', async () => {
    const p = recordingProvider('p1')
    const debug = vi.fn()
    const gateway = gatewayWith({ logger: { warn: vi.fn(), debug } }, p.provider)
    await gateway.complete({ provider: 'p1', model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'xhigh', source: 'request' } })
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ requested: 'xhigh', effective: 'high' }), expect.any(String))
  })

  it('the model\'s output cap bounds the budget; a non-streaming call is bounded harder', async () => {
    const p = recordingProvider('p1')
    const gateway = gatewayWith({ getMaxOutputTokens: () => 64_000 }, p.provider)
    const request: ModelRequest = { provider: 'p1', model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'hi' }], effort: { level: 'max', source: 'deep' } }
    await drain(gateway.stream(request))
    await gateway.complete(request)
    expect(p.received[0].effortPlan?.budgetTokens).toBe(59_904)
    expect(p.received[1].effortPlan?.maxTokensFloor).toBeLessThanOrEqual(21_333)
  })
})

describe('gateway effort — the egress slot', () => {
  it('the filter sees the raw attempt; the plan is spread onto its output and survives', async () => {
    const slot = createEgressSlot()
    const seen: ModelRequest[] = []
    slot.install({
      request(r) { seen.push(r); return { ...r, messages: r.messages.map((m) => ({ ...m, content: '[masked]' })) } },
      embed(r) { return r },
    })
    const p = recordingProvider('p1')
    const gateway = gatewayWith({ egress: slot }, p.provider)
    await gateway.complete({ provider: 'p1', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'secret' }], effort: { level: 'high', source: 'conversation' } })
    expect('effortPlan' in seen[0]).toBe(false)
    expect(p.received[0].messages[0].content).toBe('[masked]')
    expect(p.received[0].effortPlan?.level).toBe('high')
    expect(p.received[0].effort).toEqual({ level: 'high', source: 'conversation' })
  })
})
