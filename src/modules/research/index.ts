// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasDb, EyasModule, ModuleContext } from '@core/types.js'
import { sql } from 'drizzle-orm'
import { createResearchEngine } from './engine.js'
import { createMockSearchProvider } from './providers/mock-search.js'

/** Create research_reports and bring an existing table up to date. Idempotent. */
export function ensureResearchSchema(db: EyasDb): void {
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
  // 1 = the report body was assembled without model synthesis.
  try {
    db.run(sql`ALTER TABLE research_reports ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0`)
  } catch {
    /* column exists */
  }
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_research_status ON research_reports(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_research_created ON research_reports(created_at)`)
}

export const researchModule: EyasModule = {
  id: 'research',
  name: 'Research',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Deep research workflow — web search, source evaluation, and structured report generation',
  dependencies: ['model'],
  optional: ['secrets'],

  async onRegister(ctx: ModuleContext) {
    ensureResearchSchema(ctx.db)

    ctx.logger.info('Research module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Resolve search provider — try Brave first, fall back to mock
    let searchProvider
    try {
      const apiKey = await ctx.secrets?.get?.('brave-search-api-key', 'global')
      if (apiKey) {
        const { createBraveSearchProvider } = await import('./providers/brave-search.js')
        searchProvider = createBraveSearchProvider({ apiKey: apiKey as string })
        ctx.logger.info('Research: using Brave Search provider')
      }
    } catch {
      // No secrets or no key
    }

    if (!searchProvider) {
      searchProvider = createMockSearchProvider()
      ctx.logger.info('Research: using mock search provider (no Brave API key configured)')
    }

    const engine = createResearchEngine({
      db: ctx.db,
      bus: ctx.bus,
      // Read per call: never a gateway captured by value, never an unpinned call.
      getAux: () => ctx.auxiliaryModel,
      searchProvider,
      logger: ctx.logger,
    })

    ;(ctx as any).research = engine

    // Register routes
    const { createResearchRoutes } = await import('./routes.js')
    createResearchRoutes(ctx.http, engine)

    ctx.logger.info('Research module started')
  },

  async onStop() {},
}
