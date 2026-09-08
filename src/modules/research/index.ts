// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types.js'
import { sql } from 'drizzle-orm'
import { createResearchEngine, type ResearchEngine } from './engine.js'
import { createMockSearchProvider } from './providers/mock-search.js'

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
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS research_reports (
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
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_research_status ON research_reports(status)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_research_created ON research_reports(created_at)`)

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
      model: ctx.model,
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
