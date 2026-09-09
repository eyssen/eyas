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
