// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTraceCollector, memoryTiersOf, wrapGatewayWithTracing } from '@modules/observability/trace-collector'
import { createObservabilityTables } from '@modules/observability/schema'
import { createContextTables } from '@modules/observability/context-schema'
import { createMemoryDb } from '../../helpers/test-db'
import type { ModelGateway, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import type { ModuleContext, EyasDb } from '@core/types'
import type { TraceCollector } from '@modules/observability/trace-collector'

// ─── Mock DB ──────────────────────────────────────

function createMockDb(): EyasDb & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = []
  return {
    rows,
    run: vi.fn((query: any) => {
      // Capture INSERT calls
      const queryStr = typeof query === 'string' ? query : query?.queryChunks?.join('') ?? ''
      if (typeof queryStr === 'string' && queryStr.includes('INSERT')) {
        // Store a row for later querying
      }
    }),
    all: vi.fn(() => rows),
    get: vi.fn(() => rows[0] ?? null),
  } as unknown as EyasDb & { rows: Record<string, unknown>[] }
}

// ─── Mock Gateway ────────────────────────────────

function createMockGateway(): ModelGateway {
  const mockResponse: ModelResponse = {
    id: 'resp-123',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    content: [{ type: 'text', text: 'Hello world' }],
    stopReason: 'end',
    usage: { inputTokens: 100, outputTokens: 50 },
  }

  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    listProviders: vi.fn(() => []),
    listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => mockResponse),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      yield { type: 'text', text: 'Hello' }
      yield { type: 'done', response: mockResponse }
    }),
    embed: vi.fn(),
  } as unknown as ModelGateway
}

function createMockCtx(db: EyasDb): ModuleContext {
  return {
    db,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    bus: { emit: vi.fn(), on: vi.fn() },
  } as unknown as ModuleContext
}

// ─── Tests ────────────────────────────────────────

describe('TraceCollector', () => {
  let db: ReturnType<typeof createMockDb>
  let collector: TraceCollector

  beforeEach(() => {
    db = createMockDb()
    collector = createTraceCollector(db)
  })

  it('should insert a trace and return it with an id', () => {
    const trace = collector.insert({
      requestId: 'req-1',
      conversationId: null,
      agentSessionId: null,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      memoryTiersUsed: null,
      contextTokens: 100,
      systemPromptTokens: 20,
      toolDefinitions: null,
      toolCalls: null,
      toolCallCount: 0,
      outputTokens: 50,
      costUsd: 0.001,
      latencyMs: 500,
      qualityScoreAuto: null,
      qualityScoreUser: null,
      evaluatorModel: null,
      error: null,
      compositionId: null,
    })

    expect(trace.id).toBeDefined()
    expect(trace.id.length).toBeGreaterThan(0)
    expect(trace.model).toBe('claude-sonnet-4-20250514')
    expect(trace.contextTokens).toBe(100)
    expect(trace.costUsd).toBe(0.001)
    expect(db.run).toHaveBeenCalled()
  })

  it('should update user feedback', () => {
    collector.updateFeedback('trace-1', 'good')
    expect(db.run).toHaveBeenCalled()
  })

  it('has no automatic scorer write path (C12: the unwired auto-scorer was removed)', () => {
    expect('updateAutoScore' in collector).toBe(false)
  })
})

describe('wrapGatewayWithTracing', () => {
  let db: ReturnType<typeof createMockDb>
  let gateway: ReturnType<typeof createMockGateway>
  let ctx: ModuleContext
  let wrapped: ModelGateway

  beforeEach(() => {
    db = createMockDb()
    gateway = createMockGateway()
    ctx = createMockCtx(db)
    const collector = createTraceCollector(db)
    wrapped = wrapGatewayWithTracing(gateway, collector, ctx)
  })

  it('should call the underlying complete() and record a trace', async () => {
    const request: ModelRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    }

    const response = await wrapped.complete(request)

    // Should return the original response
    expect(response.id).toBe('resp-123')
    expect(response.model).toBe('claude-sonnet-4-20250514')
    expect(response.usage.inputTokens).toBe(100)

    // Should have called gateway.complete
    expect(gateway.complete).toHaveBeenCalledWith(request)

    // Should have inserted a trace (db.run called for INSERT)
    expect(db.run).toHaveBeenCalled()
  })

  it('should trace stream() calls and record on completion', async () => {
    const request: ModelRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    }

    const events: StreamEvent[] = []
    for await (const event of wrapped.stream(request)) {
      events.push(event)
    }

    // Should have yielded events
    expect(events.length).toBe(2)
    expect(events[0].type).toBe('text')
    expect(events[1].type).toBe('done')

    // Should have called gateway.stream
    expect(gateway.stream).toHaveBeenCalledWith(request)

    // Should have inserted a trace
    expect(db.run).toHaveBeenCalled()
  })

  it('should record error traces when complete() throws', async () => {
    ;(gateway.complete as any).mockRejectedValueOnce(new Error('API timeout'))

    const request: ModelRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
    }

    await expect(wrapped.complete(request)).rejects.toThrow('API timeout')

    // Should still record a trace with the error
    expect(db.run).toHaveBeenCalled()
  })

  it('should pass through gateway methods unchanged', () => {
    wrapped.registerProvider({} as any)
    expect(gateway.registerProvider).toHaveBeenCalled()

    wrapped.listProviders()
    expect(gateway.listProviders).toHaveBeenCalled()
  })

  it('should include tool definitions in trace when tools are provided', async () => {
    const request: ModelRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        { name: 'search', description: 'Search the web', inputSchema: {} },
        { name: 'calculate', description: 'Do math', inputSchema: {} },
      ],
    }

    await wrapped.complete(request)

    // Verify db.run was called (INSERT with tool definitions)
    expect(db.run).toHaveBeenCalled()
  })
})

// ─── Composition correlation (Task 10) ─────────────
// Uses a REAL in-memory DB (not the mocked db.run above) so the assertion
// exercises the actual INSERT + read path, same rationale as
// trace-attribution.test.ts.
describe('wrapGatewayWithTracing — composition correlation (Task 10)', () => {
  it('stores the composition id from request metadata on the trace', async () => {
    const db = createMemoryDb()
    createObservabilityTables(db)
    const collector = createTraceCollector(db)
    const ctx = createMockCtx(db)
    const gateway = createMockGateway()
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    const baseRequest: ModelRequest = { messages: [{ role: 'user', content: 'hi' }] }
    await wrapped.complete({ ...baseRequest, metadata: { conversationId: 'c1', compositionId: 'comp-1' } })

    const row = (db.all(sql`SELECT composition_id FROM ai_traces`) as any[])[0]
    expect(row.composition_id).toBe('comp-1')
  })

  it('leaves composition_id NULL when the request carries no compositionId', async () => {
    const db = createMemoryDb()
    createObservabilityTables(db)
    const collector = createTraceCollector(db)
    const ctx = createMockCtx(db)
    const gateway = createMockGateway()
    const wrapped = wrapGatewayWithTracing(gateway, collector, ctx)

    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })

    const row = (db.all(sql`SELECT composition_id FROM ai_traces`) as any[])[0]
    expect(row.composition_id).toBeNull()
  })
})

// ─── Resolved model (F2) ───────────────────────────
// The trace keeps the EYAS id in `model` (pricing, labels) and, separately,
// the concrete model the backend reported answering.
describe('wrapGatewayWithTracing — resolved model (F2)', () => {
  function tracedGateway(response: ModelResponse) {
    const db = createMemoryDb()
    createObservabilityTables(db)
    const collector = createTraceCollector(db)
    const gateway: ModelGateway = {
      ...createMockGateway(),
      complete: async () => response,
      stream: async function* (): AsyncIterable<StreamEvent> { yield { type: 'done', response } },
    }
    return { db, collector, wrapped: wrapGatewayWithTracing(gateway, collector, createMockCtx(db)) }
  }
  const answered = (over: Partial<ModelResponse> = {}): ModelResponse => ({
    id: 'r', provider: 'openrouter', model: 'openrouter/auto', content: [{ type: 'text', text: 'ok' }],
    stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 }, ...over,
  })

  it('stores resolved_model from response.resolvedModelId on complete() and stream() (positive)', async () => {
    const { db, collector, wrapped } = tracedGateway(answered({ resolvedModelId: 'anthropic/claude-sonnet-4.6' }))
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })
    for await (const _ of wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    const rows = db.all(sql`SELECT model, resolved_model FROM ai_traces`) as any[]
    expect(rows).toEqual([
      { model: 'openrouter/auto', resolved_model: 'anthropic/claude-sonnet-4.6' },
      { model: 'openrouter/auto', resolved_model: 'anthropic/claude-sonnet-4.6' },
    ])
    expect(collector.query({}).traces.every((t) => t.resolvedModel === 'anthropic/claude-sonnet-4.6')).toBe(true)
  })

  it('is NULL when the provider reports no model, and when the call fails (negative)', async () => {
    const { db, collector, wrapped } = tracedGateway(answered())
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect((db.all(sql`SELECT resolved_model FROM ai_traces`) as any[])[0].resolved_model).toBeNull()
    expect(collector.query({}).traces[0].resolvedModel).toBeNull()

    const failing = tracedGateway(answered())
    const broken = wrapGatewayWithTracing({ ...createMockGateway(), complete: async () => { throw new Error('down') } }, failing.collector, createMockCtx(failing.db))
    await expect(broken.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('down')
    expect((failing.db.all(sql`SELECT resolved_model FROM ai_traces`) as any[])[0].resolved_model).toBeNull()
  })

  it('the column is added to a database created before it (additive ALTER, idempotent)', () => {
    const db = createMemoryDb()
    createObservabilityTables(db)
    createObservabilityTables(db)
    const cols = (db.all(sql`PRAGMA table_info(ai_traces)`) as any[]).map((c) => c.name)
    expect(cols.filter((c) => c === 'resolved_model')).toHaveLength(1)
  })
})

// ─── Effort (E2) ───────────────────────────────────
// Each trace records the reasoning effort the call asked for, the one it ran
// with, and where the request came from — from response.effortOutcome.
describe('wrapGatewayWithTracing — effort columns (E2)', () => {
  function tracedGateway(response: ModelResponse) {
    const db = createMemoryDb()
    createObservabilityTables(db)
    const collector = createTraceCollector(db)
    const gateway: ModelGateway = {
      ...createMockGateway(),
      complete: async () => response,
      stream: async function* (): AsyncIterable<StreamEvent> { yield { type: 'done', response } },
    }
    return { db, collector, wrapped: wrapGatewayWithTracing(gateway, collector, createMockCtx(db)) }
  }
  const answered = (over: Partial<ModelResponse> = {}): ModelResponse => ({
    id: 'r', provider: 'anthropic', model: 'claude-opus-4-6', content: [{ type: 'text', text: 'ok' }],
    stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 }, ...over,
  })

  it('writes effort_requested / effort_effective / effort_source from the outcome on complete() and stream()', async () => {
    const { db, collector, wrapped } = tracedGateway(answered({
      effortOutcome: { requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'unsupported' },
    }))
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })
    for await (const _ of wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    const rows = db.all(sql`SELECT effort_requested, effort_effective, effort_source FROM ai_traces`) as any[]
    expect(rows).toEqual([
      { effort_requested: 'xhigh', effort_effective: 'high', effort_source: 'conversation' },
      { effort_requested: 'xhigh', effort_effective: 'high', effort_source: 'conversation' },
    ])
    expect(collector.query({}).traces.every((t) => t.effortEffective === 'high' && t.effortRequested === 'xhigh' && t.effortSource === 'conversation')).toBe(true)
  })

  it('is NULL when the response carries no outcome, and when the call fails (negative)', async () => {
    const { db, collector, wrapped } = tracedGateway(answered())
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] })
    expect((db.all(sql`SELECT effort_requested, effort_effective, effort_source FROM ai_traces`) as any[])[0])
      .toEqual({ effort_requested: null, effort_effective: null, effort_source: null })
    expect(collector.query({}).traces[0]).toMatchObject({ effortRequested: null, effortEffective: null, effortSource: null })

    const failing = tracedGateway(answered())
    const broken = wrapGatewayWithTracing({ ...createMockGateway(), complete: async () => { throw new Error('down') } }, failing.collector, createMockCtx(failing.db))
    await expect(broken.complete({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow('down')
    expect((failing.db.all(sql`SELECT effort_effective FROM ai_traces`) as any[])[0].effort_effective).toBeNull()
  })

  it('the columns are added idempotently', () => {
    const db = createMemoryDb()
    createObservabilityTables(db)
    createObservabilityTables(db)
    const cols = (db.all(sql`PRAGMA table_info(ai_traces)`) as any[]).map((c) => c.name)
    for (const col of ['effort_requested', 'effort_effective', 'effort_source']) {
      expect(cols.filter((c) => c === col)).toHaveLength(1)
    }
  })
})

// ─── Purpose and route (C9) ────────────────────────
// A background call carries its purpose and the auxiliary-ladder rung that
// chose the provider in request.metadata (auxiliary.ts); the trace stores both
// and derives the purpose group. A conversation turn carries neither.
describe('wrapGatewayWithTracing — background call purpose and route (C9)', () => {
  function traced() {
    const db = createMemoryDb()
    createObservabilityTables(db)
    const collector = createTraceCollector(db)
    const wrapped = wrapGatewayWithTracing(createMockGateway(), collector, createMockCtx(db))
    return { db, collector, wrapped }
  }
  const aux = (purpose: string, auxRoute: string): ModelRequest => ({
    messages: [{ role: 'user', content: 'hi' }],
    isolated: true,
    metadata: { origin: 'pipeline', purpose: purpose as any, auxRoute: auxRoute as any },
  })

  it('stores purpose and aux_route and derives purposeGroup on complete() and stream() (positive)', async () => {
    const { db, collector, wrapped } = traced()
    await wrapped.complete(aux('capture', 'isolated-cli'))
    for await (const _ of wrapped.stream(aux('security_judge', 'tier'))) { /* drain */ }

    const rows = db.all(sql`SELECT purpose, aux_route FROM ai_traces ORDER BY rowid`) as any[]
    expect(rows).toEqual([
      { purpose: 'capture', aux_route: 'isolated-cli' },
      { purpose: 'security_judge', aux_route: 'tier' },
    ])
    const byPurpose = Object.fromEntries(collector.query({}).traces.map((t) => [t.purpose, t]))
    expect(byPurpose.capture).toMatchObject({ purpose: 'capture', auxRoute: 'isolated-cli', purposeGroup: 'memory' })
    expect(byPurpose.security_judge).toMatchObject({ auxRoute: 'tier', purposeGroup: 'safety' })
    expect(collector.getById(byPurpose.capture.id)).toMatchObject({ purpose: 'capture', auxRoute: 'isolated-cli', purposeGroup: 'memory' })
  })

  it('a conversation turn stores NULL purpose and aux_route and has no group (negative)', async () => {
    const { db, collector, wrapped } = traced()
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1', origin: 'interactive' } })
    expect((db.all(sql`SELECT purpose, aux_route FROM ai_traces`) as any[])[0]).toEqual({ purpose: null, aux_route: null })
    expect(collector.query({}).traces[0]).toMatchObject({ purpose: null, auxRoute: null, purposeGroup: null })
  })

  it('a purpose this build does not know is stored as sent but gets no group (negative)', async () => {
    const { collector, wrapped } = traced()
    await wrapped.complete(aux('not_a_purpose', 'api'))
    await wrapped.complete(aux('constructor', 'api'))
    const traces = collector.query({}).traces
    expect(traces.map((t) => t.purpose).sort()).toEqual(['constructor', 'not_a_purpose'])
    expect(traces.every((t) => t.purposeGroup === null)).toBe(true)
  })

  it('insert() returns the derived group; the query filters by group', () => {
    const { collector } = traced()
    const base = {
      requestId: 'r', conversationId: null, agentSessionId: null, model: 'm', provider: 'p', memoryTiersUsed: null,
      contextTokens: 0, systemPromptTokens: 0, toolDefinitions: null, toolCalls: null, toolCallCount: 0,
      outputTokens: 0, costUsd: 0, latencyMs: 0, qualityScoreAuto: null, qualityScoreUser: null,
      evaluatorModel: null, error: null, compositionId: null,
    }
    expect(collector.insert({ ...base, purpose: 'title', auxRoute: 'tier' }).purposeGroup).toBe('title')
    expect(collector.insert({ ...base, purpose: 'reflection', auxRoute: 'default' }).purposeGroup).toBe('memory')
    expect(collector.insert(base).purposeGroup).toBeNull()

    const memory = collector.query({ purposeGroup: 'memory' })
    expect(memory.total).toBe(1)
    expect(memory.traces.map((t) => t.purpose)).toEqual(['reflection'])
    expect(collector.query({ purposeGroup: 'triage' })).toEqual({ traces: [], total: 0 })
    expect(collector.query({}).total).toBe(3)
  })

  it('the columns are added idempotently', () => {
    const db = createMemoryDb()
    createObservabilityTables(db)
    createObservabilityTables(db)
    const cols = (db.all(sql`PRAGMA table_info(ai_traces)`) as any[]).map((c) => c.name)
    for (const col of ['purpose', 'aux_route']) {
      expect(cols.filter((c) => c === col)).toHaveLength(1)
    }
  })
})

// ─── Observability parity (G12) ────────────────────
// A CLI runs tools inside its own loop and settles them with tool_result in
// the stream; an API provider hands tool_use blocks back. Both count the same
// way. Memory tiers come from the turn's recall section, and a call whose
// provider reported no usage is never priced from placeholder counts.
describe('wrapGatewayWithTracing — observability parity (G12)', () => {
  function traced(events: StreamEvent[], response?: ModelResponse) {
    const db = createMemoryDb()
    createObservabilityTables(db)
    createContextTables(db)
    const collector = createTraceCollector(db)
    const gateway: ModelGateway = {
      ...createMockGateway(),
      complete: async () => response ?? answered(),
      stream: async function* (): AsyncIterable<StreamEvent> {
        for (const e of events) yield e
      },
    }
    return { db, collector, wrapped: wrapGatewayWithTracing(gateway, collector, createMockCtx(db)) }
  }
  const answered = (over: Partial<ModelResponse> = {}): ModelResponse => ({
    id: 'r', provider: 'grok-cli', model: 'grok-cli-default', content: [{ type: 'text', text: 'ok' }],
    stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 }, ...over,
  })
  const drain = async (it: AsyncIterable<StreamEvent>) => { for await (const _ of it) { /* drain */ } }
  const row = (db: EyasDb) => (db.all(sql`SELECT tool_call_count, tool_calls, memory_tiers_used, cost_usd FROM ai_traces`) as any[])[0]
  const cliTool = (id: string, name: string, executedBy: 'provider' | 'eyas' = 'provider'): StreamEvent[] => [
    { type: 'tool_use_start', id, name },
    { type: 'tool_result', toolUseId: id, content: 'out', isError: false, durationMs: 3, outcome: 'success', executedBy },
  ]

  it('(+) a CLI stream with 3 provider-settled tool_result events records tool_call_count 3', async () => {
    const { db, wrapped } = traced([
      ...cliTool('t1', 'run_command'),
      ...cliTool('t2', 'read_file'),
      ...cliTool('t3', 'memory_search', 'eyas'),
      { type: 'text', text: 'done' },
      { type: 'done', response: answered() },
    ])
    await drain(wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const r = row(db)
    expect(r.tool_call_count).toBe(3)
    expect(JSON.parse(r.tool_calls)).toEqual([
      { name: 'run_command', id: 't1', executedBy: 'provider' },
      { name: 'read_file', id: 't2', executedBy: 'provider' },
      { name: 'memory_search', id: 't3', executedBy: 'eyas' },
    ])
  })

  it('(+) an API stream counts its tool_use blocks once, even when a tool_result repeats the id', async () => {
    const response = answered({
      provider: 'anthropic',
      content: [
        { type: 'tool_use', id: 'a1', name: 'web_search', input: {} },
        { type: 'tool_use', id: 'a2', name: 'read_file', input: {} },
      ],
    })
    const { db, wrapped } = traced([
      { type: 'tool_use_start', id: 'a1', name: 'web_search' },
      { type: 'tool_use_start', id: 'a2', name: 'read_file' },
      { type: 'tool_result', toolUseId: 'a1', content: 'x', isError: false, durationMs: 1 },
      { type: 'done', response },
    ])
    await drain(wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(row(db).tool_call_count).toBe(2)
    expect(JSON.parse(row(db).tool_calls).map((c: any) => c.id)).toEqual(['a1', 'a2'])
  })

  it('(−) a stream with no tools records 0 and NULL tool_calls; an opened but unsettled CLI tool is not counted', async () => {
    const { db, wrapped } = traced([
      { type: 'tool_use_start', id: 'p1', name: 'run_command' },
      { type: 'text', text: 'hello' },
      { type: 'done', response: answered() },
    ])
    await drain(wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(row(db)).toMatchObject({ tool_call_count: 0, tool_calls: null })
  })

  function seedRecall(db: EyasDb, compositionId: string, ids: string[]): void {
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES (${compositionId}, ${new Date().toISOString()}, 'conversation')`)
    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key, source_ref, content)
      VALUES (${compositionId}, 0, 'turn', 'turn-time', NULL, 'now')`)
    db.run(sql`INSERT INTO context_sections (composition_id, ord, zone, section_key, source_ref, content)
      VALUES (${compositionId}, 1, 'turn', 'memory-recall', ${ids.join(',')}, '<eyas-memory>…</eyas-memory>')`)
  }

  it('(+) memory_tiers_used = {vt:75, gs:5, ft:3} from the seeded composition, on stream() and complete()', async () => {
    const ids = [
      ...Array.from({ length: 74 }, (_, i) => `vt:notes/n${i}.md`),
      // A comma inside a vault path stays with its id.
      'vt:notes/a, b.md',
      ...Array.from({ length: 5 }, (_, i) => `gs:g${i}`),
      ...Array.from({ length: 3 }, (_, i) => `ft:f${i}`),
    ]
    const { db, wrapped } = traced([{ type: 'done', response: answered() }])
    seedRecall(db, 'comp-1', ids)
    const request: ModelRequest = { messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c1', compositionId: 'comp-1' } }
    await drain(wrapped.stream(request))
    await wrapped.complete(request)
    const rows = db.all(sql`SELECT memory_tiers_used FROM ai_traces`) as any[]
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(JSON.parse(r.memory_tiers_used)).toEqual({ vt: 75, gs: 5, ft: 3 })
    expect(memoryTiersOf(db, 'comp-1')).toBe(rows[0].memory_tiers_used)
  })

  it('(−) no composition → NULL; a composition without a recall section → NULL; no context tables → NULL', async () => {
    const { db, wrapped } = traced([{ type: 'done', response: answered() }])
    await drain(wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    db.run(sql`INSERT INTO context_compositions (id, created_at, entry_point) VALUES ('comp-2', ${new Date().toISOString()}, 'conversation')`)
    await drain(wrapped.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { compositionId: 'comp-2' } }))
    await drain(wrapped.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { compositionId: 'comp-missing' } }))
    expect((db.all(sql`SELECT memory_tiers_used FROM ai_traces`) as any[]).map((r) => r.memory_tiers_used)).toEqual([null, null, null])

    const bare = createMemoryDb()
    expect(memoryTiersOf(bare, 'comp-1')).toBeNull()
    expect(memoryTiersOf(bare, null)).toBeNull()
  })

  it('(+) cost stays null-safe when usage.reported is false: placeholder counts are not priced, a reported cost is kept', async () => {
    const unreported = traced([{ type: 'done', response: answered({ provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { inputTokens: 5_000, outputTokens: 5_000, reported: false } }) }])
    await drain(unreported.wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(row(unreported.db).cost_usd).toBe(0)

    const withCost = traced([{ type: 'done', response: answered({ usage: { inputTokens: 0, outputTokens: 0, reported: false, costUsd: 0.25 } }) }])
    await drain(withCost.wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(row(withCost.db).cost_usd).toBe(0.25)
  })

  it('(−) a non-finite cost or a stream with no done response records 0, never NaN or a throw', async () => {
    const nan = traced([{ type: 'done', response: answered({ usage: { inputTokens: 1, outputTokens: 1, costUsd: Number.NaN } }) }])
    await drain(nan.wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(row(nan.db).cost_usd).toBe(0)

    const none = traced([{ type: 'text', text: 'partial' }])
    await drain(none.wrapped.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(row(none.db)).toMatchObject({ cost_usd: 0, tool_call_count: 0 })
  })
})
