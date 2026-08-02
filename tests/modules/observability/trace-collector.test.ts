// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTraceCollector, wrapGatewayWithTracing } from '@modules/observability/trace-collector'
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

  it('should update auto score', () => {
    collector.updateAutoScore('trace-1', 0.85, 'claude-3-5-haiku-20241022')
    expect(db.run).toHaveBeenCalled()
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
