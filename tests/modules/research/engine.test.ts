import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createResearchEngine, type ResearchEngine } from '@modules/research/engine'
import { createMockSearchProvider } from '@modules/research/providers/mock-search'
import type { ModelGateway, ModelResponse, ContentBlock } from '@modules/model/types'
import type { EyasBus } from '@core/types'
import { createLocalBus } from '@core/bus/local-bus'
import { createTestDb } from '../../helpers/test-db'
import pino from 'pino'

const testDb = createTestDb('research-engine')

function setupResearchTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS research_reports (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    depth TEXT NOT NULL DEFAULT 'shallow',
    status TEXT NOT NULL DEFAULT 'pending',
    sections TEXT,
    sources TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`)
}

function createMockModel(): ModelGateway {
  let callCount = 0

  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn() as any,
    listProviders: vi.fn(() => []),
    listAllModels: vi.fn(async () => []),

    async complete(): Promise<ModelResponse> {
      callCount++
      let text: string

      if (callCount === 1) {
        // Step 1: Query expansion
        text = JSON.stringify(['TypeScript advanced patterns', 'TypeScript type system', 'TypeScript generics'])
      } else if (callCount === 2) {
        // Step 3: Source evaluation
        text = JSON.stringify([
          { index: 0, relevance: 0.9 },
          { index: 1, relevance: 0.8 },
          { index: 2, relevance: 0.7 },
          { index: 3, relevance: 0.6 },
          { index: 4, relevance: 0.3 },
        ])
      } else if (callCount === 3) {
        // Step 5: Synthesis
        text = JSON.stringify([
          { title: 'Overview', content: 'TypeScript is a typed superset of JavaScript [1].' },
          { title: 'Key Features', content: 'Generics and conditional types are powerful [2].' },
          { title: 'Best Practices', content: 'Use strict mode for better type safety [3].' },
        ])
      } else {
        // Step 6: Cross-reference (return unchanged)
        text = JSON.stringify([
          { title: 'Overview', content: 'TypeScript is a typed superset of JavaScript [1].' },
          { title: 'Key Features', content: 'Generics and conditional types are powerful [2].' },
          { title: 'Best Practices', content: 'Use strict mode for better type safety [3].' },
        ])
      }

      return {
        id: `resp-${callCount}`,
        provider: 'mock',
        model: 'mock-model',
        content: [{ type: 'text', text }] as ContentBlock[],
        stopReason: 'end',
        usage: { inputTokens: 100, outputTokens: 50 },
      }
    },

    async *stream() {
      throw new Error('Not implemented')
    },
    embed: vi.fn(),
  } as unknown as ModelGateway
}

describe('ResearchEngine', () => {
  let db: any
  let bus: EyasBus
  let engine: ResearchEngine
  let model: ModelGateway

  beforeEach(() => {
    db = testDb.open()
    setupResearchTable(db)
    bus = createLocalBus()
    model = createMockModel()

    engine = createResearchEngine({
      db,
      bus,
      model,
      searchProvider: createMockSearchProvider(),
      logger: pino({ level: 'silent' }),
    })
  })

  afterEach(() => testDb.cleanup())

  it('starts a research workflow and returns an ID', async () => {
    const id = await engine.start({ query: 'TypeScript best practices' })
    expect(id).toBeTruthy()
    expect(typeof id).toBe('string')
  })

  it('creates a pending report in the database', async () => {
    const id = await engine.start({ query: 'TypeScript best practices' })
    // Give async workflow a tick to begin
    await new Promise((r) => setTimeout(r, 50))
    const report = engine.get(id)
    expect(report).toBeDefined()
    expect(report!.query).toBe('TypeScript best practices')
  })

  it('completes the full 8-step workflow', async () => {
    const id = await engine.start({ query: 'TypeScript best practices', depth: 'shallow' })

    // Wait for async workflow to complete
    let report = engine.get(id)
    const start = Date.now()
    while (report && report.status !== 'complete' && report.status !== 'error') {
      if (Date.now() - start > 5000) break
      await new Promise((r) => setTimeout(r, 100))
      report = engine.get(id)
    }

    expect(report).toBeDefined()
    expect(report!.status).toBe('complete')
    expect(report!.sections.length).toBeGreaterThan(0)
    expect(report!.sources.length).toBeGreaterThan(0)
    expect(report!.completedAt).toBeTruthy()
  })

  it('filters out low-relevance sources', async () => {
    const id = await engine.start({ query: 'TypeScript best practices' })

    let report = engine.get(id)
    const start = Date.now()
    while (report && report.status !== 'complete' && report.status !== 'error') {
      if (Date.now() - start > 5000) break
      await new Promise((r) => setTimeout(r, 100))
      report = engine.get(id)
    }

    expect(report!.status).toBe('complete')
    // All remaining sources should have relevance >= 0.5
    for (const source of report!.sources) {
      expect(source.relevance).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('lists all reports', async () => {
    await engine.start({ query: 'First query' })
    await engine.start({ query: 'Second query' })
    // Wait a tick
    await new Promise((r) => setTimeout(r, 50))

    const reports = engine.list()
    expect(reports.length).toBe(2)
  })

  it('emits bus events during workflow', async () => {
    const events: string[] = []
    bus.on('research.progress', async (data: any) => {
      events.push(data.status)
    })
    bus.on('research.complete', async () => {
      events.push('complete-event')
    })

    const id = await engine.start({ query: 'TypeScript best practices' })

    let report = engine.get(id)
    const start = Date.now()
    while (report && report.status !== 'complete' && report.status !== 'error') {
      if (Date.now() - start > 5000) break
      await new Promise((r) => setTimeout(r, 100))
      report = engine.get(id)
    }

    expect(events).toContain('searching')
    expect(events).toContain('evaluating')
    expect(events).toContain('synthesizing')
    expect(events).toContain('complete-event')
  })

  it('handles model errors gracefully', async () => {
    const failingModel: ModelGateway = {
      ...model,
      async complete() {
        throw new Error('Model unavailable')
      },
    }

    const failEngine = createResearchEngine({
      db,
      bus,
      model: failingModel,
      searchProvider: createMockSearchProvider(),
      logger: pino({ level: 'silent' }),
    })

    const id = await failEngine.start({ query: 'will fail' })

    let report = failEngine.get(id)
    const start = Date.now()
    while (report && report.status !== 'error' && report.status !== 'complete') {
      if (Date.now() - start > 5000) break
      await new Promise((r) => setTimeout(r, 100))
      report = failEngine.get(id)
    }

    expect(report!.status).toBe('error')
    expect(report!.error).toContain('Model unavailable')
  })

  it('supports deep research depth', async () => {
    const id = await engine.start({ query: 'TypeScript best practices', depth: 'deep' })
    const report = engine.get(id)
    expect(report).toBeDefined()
    expect(report!.depth).toBe('deep')
  })
})
