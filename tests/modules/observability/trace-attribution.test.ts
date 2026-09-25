// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 (R5) — trace-collector used to hardcode conversation_id/agent_session_id
// to NULL on every insert, even though request.metadata carried the real ids.
// It also priced EVERY call (including local Ollama/LM Studio inference) off a
// hardcoded $3/$15 Anthropic-shaped table, silently overbilling the global
// routing budget. Both are fixed via the shared @shared/model-pricing module
// and reading request.metadata directly. Uses a REAL in-memory DB (not a
// mocked db.run) so the assertions exercise the actual SQL insert + read path.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createObservabilityTables } from '@modules/observability/schema'
import { createTraceCollector, wrapGatewayWithTracing } from '@modules/observability/trace-collector'
import type { ModelGateway, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import type { ModuleContext } from '@core/types'
import { createAuxiliaryModelService } from '@modules/model/auxiliary'
import type { BindingProviderConfig } from '@modules/model/binding'
import { readSpendTotals } from '@modules/model/routing/spending'

function makeResponse(overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    id: 'resp-1',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'hi' }],
    stopReason: 'end',
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    ...overrides,
  }
}

function gatewayReturning(response: ModelResponse): ModelGateway {
  return {
    registerProvider: () => {}, unregisterProvider: () => {}, getProvider: () => undefined,
    listProviders: () => [], listAllModels: async () => [],
    complete: async () => response,
    stream: async function* (): AsyncIterable<StreamEvent> { yield { type: 'done', response } },
    embed: (async () => ({ provider: 'x', model: 'x', embeddings: [], dimensions: 0 })) as any,
  }
}

function makeCtx(db: any, pricing?: Record<string, { input: number; output: number }>): ModuleContext {
  return {
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    bus: { emit: () => {}, on: () => ({ subject: '', id: '', unsubscribe: () => {} }) },
    config: pricing ? { model: { pricing } } : undefined,
  } as unknown as ModuleContext
}

function setup(pricing?: Record<string, { input: number; output: number }>) {
  const db = createMemoryDb()
  createObservabilityTables(db)
  const collector = createTraceCollector(db)
  return { db, collector, ctx: makeCtx(db, pricing) }
}

describe('trace-collector attribution + pricing (F2 T9)', () => {
  it('a request carrying metadata writes conversation_id + agent_session_id (runId) onto the ai_traces row', async () => {
    const { db, collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse())
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    const request: ModelRequest = {
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'conv-1', runId: 'run-1' },
    }
    await wrapped.complete(request)

    const row = collector.query({}).traces[0]
    expect(row.conversationId).toBe('conv-1')
    expect(row.agentSessionId).toBe('run-1')
  })

  it('a request with NO metadata leaves both attribution columns NULL', async () => {
    const { collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse())
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const row = collector.query({}).traces[0]
    expect(row.conversationId).toBeNull()
    expect(row.agentSessionId).toBeNull()
  })

  it('a request with a conversationId but no runId (unsupervised interactive turn) attributes the conversation only', async () => {
    const { collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse())
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-2' } })

    const row = collector.query({}).traces[0]
    expect(row.conversationId).toBe('conv-2')
    expect(row.agentSessionId).toBeNull()
  })

  it('attributes the stream() path identically to complete()', async () => {
    const { collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse())
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    const events: StreamEvent[] = []
    for await (const e of wrapped.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-3', runId: 'run-3' } })) {
      events.push(e)
    }

    const row = collector.query({}).traces[0]
    expect(row.conversationId).toBe('conv-3')
    expect(row.agentSessionId).toBe('run-3')
  })

  it('an ollama-priced call records cost_usd 0 in ai_traces (fixes the local-model overbilling)', async () => {
    const { collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse({ provider: 'ollama', model: 'llama3' }))
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const row = collector.query({}).traces[0]
    expect(row.provider).toBe('ollama')
    expect(row.costUsd).toBe(0)
  })

  it('a cloud (anthropic) call is priced non-zero from the shared default table', async () => {
    const { collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse({ provider: 'anthropic', model: 'claude-sonnet-4-6' }))
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const row = collector.query({}).traces[0]
    expect(row.costUsd).toBeGreaterThan(0)
  })

  it('prefers usage.costUsd (CLI-authoritative) over the table estimate', async () => {
    const { collector, ctx } = setup()
    const gateway = gatewayReturning(makeResponse({
      provider: 'claude-code',
      model: 'claude-code-sonnet',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, costUsd: 0.0123 },
    }))
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const row = collector.query({}).traces[0]
    expect(row.costUsd).toBe(0.0123)
  })

  it('honors a config.model.pricing override when estimating', async () => {
    const { collector, ctx } = setup({ 'anthropic/claude-sonnet-4-6': { input: 1, output: 1 } })
    const gateway = gatewayReturning(makeResponse({ usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 } }))
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const row = collector.query({}).traces[0]
    expect(row.costUsd).toBeCloseTo(2, 6) // 1 (input) + 1 (output), not the default 3 + 15
  })
})

// ─── Background calls in the budget (C9) ──────────
// The auxiliary service resolves ctx.model on every call, so its calls pass
// through the tracing wrapper: each one leaves a priced ai_traces row with its
// purpose and route, and the routing budget's spend sum (readSpendTotals, the
// decision engine's getSpending source) counts it.
describe('background calls are traced and count against the budget (C9)', () => {
  function providerConfig(enabled: boolean): BindingProviderConfig {
    const row = { id: 'anthropic', enabled, settings: {}, isDefault: false, defaultModel: 'claude-sonnet-4-6', updatedAt: '' }
    return {
      getProvider: (id) => (id === 'anthropic' ? row : null),
      getDefault: () => null,
      listProviders: () => [row],
      listEnabledModels: () => [],
    }
  }

  function setupAux(enabled: boolean) {
    const { db, collector, ctx } = setup()
    const inner: ModelGateway = {
      ...gatewayReturning(makeResponse({ provider: 'anthropic', model: 'claude-sonnet-4-6' })),
      listProviders: () => [{ id: 'anthropic' }] as unknown as ReturnType<ModelGateway['listProviders']>,
    }
    const traced = wrapGatewayWithTracing(inner, collector, ctx)
    const aux = createAuxiliaryModelService({
      getGateway: () => traced,
      getTiers: () => [],
      getProviderConfig: () => providerConfig(enabled),
    })
    return { db, collector, aux }
  }

  it('an aux call records a priced trace with its purpose and route, summed into the budget spend (positive)', async () => {
    const { db, collector, aux } = setupAux(true)

    const result = await aux.complete({ purpose: 'capture', system: 'Extract facts.', user: 'hello' })
    expect(result.ok).toBe(true)

    const traces = collector.query({}).traces
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ provider: 'anthropic', purpose: 'capture', auxRoute: 'api', purposeGroup: 'memory' })
    expect(traces[0].costUsd).toBeGreaterThan(0)

    const spend = readSpendTotals(db)
    expect(spend.daily).toBeCloseTo(traces[0].costUsd, 9)
    expect(spend.weekly).toBeCloseTo(traces[0].costUsd, 9)
    expect(spend.monthly).toBeCloseTo(traces[0].costUsd, 9)
    expect(collector.getStats().totalCost).toBeCloseTo(traces[0].costUsd, 9)
  })

  it('a conversation turn and a background call both count (positive)', async () => {
    const { db, collector, aux } = setupAux(true)
    expect((await aux.complete({ purpose: 'research', system: 'Summarize.', user: 'hello' })).ok).toBe(true)
    const turn = wrapGatewayWithTracing(gatewayReturning(makeResponse()), collector, makeCtx(db))
    await turn.complete({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1' } })

    const traces = collector.query({}).traces
    const total = traces.reduce((sum, t) => sum + t.costUsd, 0)
    expect(traces.map((t) => t.purposeGroup ?? 'turn').sort()).toEqual(['research', 'turn'])
    expect(readSpendTotals(db).daily).toBeCloseTo(total, 9)
  })

  it('no eligible model: no call, no trace, no spend (negative)', async () => {
    const { db, collector, aux } = setupAux(false)
    const result = await aux.complete({ purpose: 'capture', system: 'Extract facts.', user: 'hello' })
    expect(result).toEqual({ ok: false, reason: 'no_eligible_provider' })
    expect(collector.query({}).total).toBe(0)
    expect(readSpendTotals(db)).toEqual({ daily: 0, weekly: 0, monthly: 0 })
  })
})
