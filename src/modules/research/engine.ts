// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import { z } from 'zod'
import type { AuxNoneReason, AuxResult } from '@modules/model/auxiliary.js'
import type { EyasDb } from '@core/types.js'
import type { EyasBus } from '@core/types.js'
import type { SearchProvider } from './providers/types.js'
import type {
  ResearchOptions,
  ResearchReport,
  ResearchDepth,
  ResearchAux,
  SearchResult,
} from './types.js'
import { generateId } from '@shared/crypto.js'
import { evaluateSources, extractContent } from './source-evaluator.js'
import { synthesizeSections, crossReference } from './report-generator.js'
import { parseJsonArray } from './model-io.js'
import { sql } from 'drizzle-orm'

export interface ResearchEngineConfig {
  db: EyasDb
  bus: EyasBus
  /**
   * The auxiliary model service, read on every call (module order is not
   * guaranteed, so a by-value capture could stay undefined). Every model step
   * is an isolated one-shot with purpose 'research'.
   */
  getAux: () => ResearchAux | undefined
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

/** The service had no model to call at all (as opposed to a call that failed). */
function isNoModel(reason: string): reason is AuxNoneReason {
  return reason === 'no_eligible_provider' || reason === 'tier_not_configured' || reason === 'budget_stop'
}

const QueriesSchema = z.array(z.unknown())

/**
 * One workflow's view of the aux service. It records whether any step had no
 * model, and once that happened it answers the remaining steps with the same
 * reason instead of asking again, so a degraded report makes no further calls.
 * It never throws: a throwing service reads as a failed call.
 */
function createRunAux(getAux: ResearchEngineConfig['getAux'], logger: Logger, id: string) {
  let noModel: AuxNoneReason | null = null
  const aux: ResearchAux = {
    async complete(request) {
      if (noModel) return { ok: false, reason: noModel }
      let result: AuxResult
      try {
        const service = getAux()
        result = service ? await service.complete(request) : { ok: false, reason: 'no_eligible_provider' }
      } catch (err) {
        result = { ok: false, reason: 'error', error: { kind: 'other', message: err instanceof Error ? err.message : String(err) } }
      }
      if (!result.ok) {
        if (isNoModel(result.reason)) noModel = result.reason
        else logger.warn({ id, reason: result.reason, error: result.error?.message }, 'Research: model step failed, using its fallback')
      }
      return result
    },
  }
  return { aux, hadNoModel: () => noModel !== null }
}

export function createResearchEngine(config: ResearchEngineConfig): ResearchEngine {
  const { db, bus, getAux, searchProvider, logger } = config

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
      degraded: Number(row.degraded ?? 0) === 1,
      error: row.error ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    }
  }

  function updateStatus(id: string, status: string) {
    db.run(sql`UPDATE research_reports SET status = ${status} WHERE id = ${id}`)
    bus.emit('research.progress', { id, status })
  }

  async function expandQueries(aux: ResearchAux, query: string, depth: ResearchDepth): Promise<string[]> {
    const count = depth === 'deep' ? 5 : 3

    const result = await aux.complete({
      purpose: 'research',
      system: `You expand a research topic into web search queries. Generate ${count} related search queries, each exploring a different angle or aspect of the topic.

Respond with a JSON array of strings, each a search query. Respond ONLY with the JSON array.`,
      user: `Research topic: ${query}`,
      maxTokens: 512,
      temperature: 0.7,
    })
    // Without a usable answer the original query is searched alone.
    if (!result.ok) return [query]
    const queries = (parseJsonArray(result.text, QueriesSchema) ?? [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.trim())
    return [query, ...queries.slice(0, count)]
  }

  async function runWorkflow(id: string, query: string, depth: ResearchDepth): Promise<void> {
    const { aux, hadNoModel } = createRunAux(getAux, logger, id)
    try {
      // Step 1: Query expansion
      logger.info({ id, step: 1 }, 'Research: expanding queries')
      updateStatus(id, 'searching')
      const queries = await expandQueries(aux, query, depth)
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
      const topCount = depth === 'deep' ? 8 : 5
      const evaluated = await evaluateSources(aux, query, allResults, topCount)
      const relevant = evaluated.filter((s) => s.relevance >= 0.5)
      logger.info({ id, relevant: relevant.length, total: evaluated.length }, 'Research: sources evaluated')

      // Step 4: Content extraction (top sources). Only a model synthesis reads
      // page content, so a run that already has no model skips the fetches.
      logger.info({ id, step: 4 }, 'Research: extracting content')
      const topSources = relevant
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, topCount)

      if (!hadNoModel()) {
        for (const source of topSources) {
          source.extractedContent = await extractContent(source.url)
        }
      }

      // Step 5: Information synthesis
      logger.info({ id, step: 5 }, 'Research: synthesizing information')
      updateStatus(id, 'synthesizing')
      const synthesis = await synthesizeSections(aux, query, topSources)
      let sections = synthesis.sections

      // Step 6: Cross-reference check — only a model synthesis is reviewed.
      const degraded = hadNoModel() || !synthesis.synthesized
      if (!degraded) {
        logger.info({ id, step: 6 }, 'Research: cross-referencing')
        sections = await crossReference(aux, query, sections, topSources)
      } else {
        logger.warn({ id }, 'Research: no model synthesis, the report lists the top sources')
      }

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
        degraded = ${degraded ? 1 : 0},
        completed_at = ${now}
        WHERE id = ${id}`)

      bus.emit('research.complete', { id, query })
      logger.info({ id, degraded }, 'Research: workflow complete')
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
