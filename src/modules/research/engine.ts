// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { ModelGateway } from '@modules/model/types.js'
import type { EyasDb } from '@core/types.js'
import type { EyasBus } from '@core/types.js'
import type { SearchProvider } from './providers/types.js'
import type {
  ResearchOptions,
  ResearchReport,
  ResearchDepth,
  EvaluatedSource,
  ReportSection,
  SearchResult,
} from './types.js'
import { generateId } from '@shared/crypto.js'
import { evaluateSources, extractContent } from './source-evaluator.js'
import { synthesizeSections, crossReference } from './report-generator.js'
import { sql } from 'drizzle-orm'

export interface ResearchEngineConfig {
  db: EyasDb
  bus: EyasBus
  model: ModelGateway
  searchProvider: SearchProvider
  logger: Logger
}

export interface ResearchEngine {
  /** Start a new research workflow (runs async, returns report ID immediately) */
  start(options: ResearchOptions): Promise<string>
  /** Get a report by ID */
  get(id: string): ResearchReport | undefined
  /** List all reports */
  list(): ResearchReport[]
}

export function createResearchEngine(config: ResearchEngineConfig): ResearchEngine {
  const { db, bus, model, searchProvider, logger } = config

  function getReport(id: string): ResearchReport | undefined {
    const rows = (db as any).all(sql`SELECT * FROM research_reports WHERE id = ${id}`) as any[]
    if (!rows.length) return undefined
    return rowToReport(rows[0])
  }

  function listReports(): ResearchReport[] {
    const rows = (db as any).all(
      sql`SELECT * FROM research_reports ORDER BY created_at DESC`,
    ) as any[]
    return rows.map(rowToReport)
  }

  function rowToReport(row: any): ResearchReport {
    return {
      id: row.id,
      query: row.query,
      depth: row.depth as ResearchDepth,
      status: row.status as ResearchReport['status'],
      sections: row.sections ? JSON.parse(row.sections) : [],
      sources: row.sources ? JSON.parse(row.sources) : [],
      error: row.error ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    }
  }

  function updateStatus(id: string, status: string) {
    db.run(sql`UPDATE research_reports SET status = ${status} WHERE id = ${id}`)
    bus.emit('research.progress', { id, status })
  }

  async function expandQueries(query: string, depth: ResearchDepth): Promise<string[]> {
    const count = depth === 'deep' ? 5 : 3

    const response = await model.complete({
      messages: [
        {
          role: 'user',
          content: `Generate ${count} related search queries for the following research topic. Each query should explore a different angle or aspect.

Topic: "${query}"

Respond with a JSON array of strings, each a search query. Respond ONLY with the JSON array.`,
        },
      ],
      maxTokens: 512,
      temperature: 0.7,
    })

    const text =
      typeof response.content[0] === 'object' && response.content[0].type === 'text'
        ? response.content[0].text
        : ''

    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON array')
      const queries = JSON.parse(jsonMatch[0]) as string[]
      return [query, ...queries.slice(0, count)]
    } catch {
      // Fallback: just use original query
      return [query]
    }
  }

  async function runWorkflow(id: string, query: string, depth: ResearchDepth): Promise<void> {
    try {
      // Step 1: Query expansion
      logger.info({ id, step: 1 }, 'Research: expanding queries')
      updateStatus(id, 'searching')
      const queries = await expandQueries(query, depth)
      logger.info({ id, queries: queries.length }, 'Research: queries expanded')

      // Step 2: Web search
      logger.info({ id, step: 2 }, 'Research: executing web searches')
      const allResults: SearchResult[] = []
      const seenUrls = new Set<string>()
      const limit = depth === 'deep' ? 10 : 5

      for (const q of queries) {
        const results = await searchProvider.search(q, { limit })
        for (const r of results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url)
            allResults.push(r)
          }
        }
      }
      logger.info({ id, results: allResults.length }, 'Research: search complete')

      // Step 3: Source evaluation
      logger.info({ id, step: 3 }, 'Research: evaluating sources')
      updateStatus(id, 'evaluating')
      const evaluated = await evaluateSources(model, query, allResults)
      const relevant = evaluated.filter((s) => s.relevance >= 0.5)
      logger.info({ id, relevant: relevant.length, total: evaluated.length }, 'Research: sources evaluated')

      // Step 4: Content extraction (top sources)
      logger.info({ id, step: 4 }, 'Research: extracting content')
      const topSources = relevant
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, depth === 'deep' ? 8 : 5)

      for (const source of topSources) {
        source.extractedContent = await extractContent(source.url)
      }

      // Step 5: Information synthesis
      logger.info({ id, step: 5 }, 'Research: synthesizing information')
      updateStatus(id, 'synthesizing')
      let sections = await synthesizeSections(model, query, topSources)

      // Step 6: Cross-reference check
      logger.info({ id, step: 6 }, 'Research: cross-referencing')
      sections = await crossReference(model, query, sections, topSources)

      // Step 7: Report generation (sections are already generated)
      logger.info({ id, step: 7 }, 'Research: generating report')
      const finalSources = topSources.map((s) => ({
        title: s.title,
        url: s.url,
        relevance: s.relevance,
      }))

      // Step 8: Storage
      logger.info({ id, step: 8 }, 'Research: saving report')
      const now = new Date().toISOString()
      db.run(sql`UPDATE research_reports SET
        status = 'complete',
        sections = ${JSON.stringify(sections)},
        sources = ${JSON.stringify(finalSources)},
        completed_at = ${now}
        WHERE id = ${id}`)

      bus.emit('research.complete', { id, query })
      logger.info({ id }, 'Research: workflow complete')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ id, error: message }, 'Research: workflow failed')
      db.run(sql`UPDATE research_reports SET status = 'error', error = ${message} WHERE id = ${id}`)
      bus.emit('research.error', { id, error: message })
    }
  }

  return {
    start(options: ResearchOptions): Promise<string> {
      const id = generateId()
      const depth = options.depth ?? 'shallow'
      const now = new Date().toISOString()

      db.run(sql`INSERT INTO research_reports (id, query, depth, status, created_at)
        VALUES (${id}, ${options.query}, ${depth}, 'pending', ${now})`)

      // Run async — don't await
      runWorkflow(id, options.query, depth).catch((err) => {
        logger.error({ id, error: err }, 'Research workflow unhandled error')
      })

      return Promise.resolve(id)
    },

    get: getReport,
    list: listReports,
  }
}
