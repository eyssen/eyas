// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'
import type { ResearchEngine } from '@modules/research/engine.js'

/**
 * `getEngine` resolves `ctx.research`. The research module publishes its
 * engine in onStart, which runs after tools.onStart — binding the instance at
 * registration would capture `undefined` for good.
 */
export function createResearchTools(getEngine: () => ResearchEngine | undefined): ToolImplementation[] {
  return [
    {
      name: 'research',
      description: 'Start a deep research workflow on a topic. Performs web search, evaluates sources, and generates a structured report with citations.',
      category: 'research',
      // Network egress — the same exfiltration surface that makes WebFetch and
      // WebSearch yellow. Judge-reviewed rather than deterministically allowed.
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The research topic or question' },
          depth: {
            type: 'string',
            enum: ['shallow', 'deep'],
            description: 'Research depth — shallow (3 queries, 5 sources) or deep (5 queries, 10 sources). Default: shallow',
          },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const engine = getEngine()
        if (!engine) return { error: 'Research module not ready yet — try again shortly' }

        const query = input.query as string
        const depth = (input.depth as 'shallow' | 'deep') ?? 'shallow'
        const id = await engine.start({ query, depth })

        // Poll for completion (with timeout)
        const maxWait = depth === 'deep' ? 120_000 : 60_000
        const start = Date.now()
        let report = engine.get(id)

        while (report && report.status !== 'complete' && report.status !== 'error') {
          if (Date.now() - start > maxWait) break
          await new Promise((r) => setTimeout(r, 1000))
          report = engine.get(id)
        }

        if (!report) return { error: 'Report not found' }
        if (report.status === 'error') return { error: report.error ?? 'Research failed' }
        if (report.status !== 'complete') return { id, status: report.status, message: 'Research still in progress' }

        return {
          id: report.id,
          query: report.query,
          sections: report.sections,
          sources: report.sources,
        }
      },
    },
  ]
}
