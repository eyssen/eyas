// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The research tool tells the calling agent when a report was assembled
// without model synthesis, so it does not present a source list as analysis.

import { describe, it, expect } from 'vitest'
import { createResearchTools } from '@modules/tools/builtin/research-tools'
import type { ResearchEngine } from '@modules/research/engine'
import type { ResearchReport } from '@modules/research/types'

function engineReturning(report: Partial<ResearchReport>): ResearchEngine {
  const full: ResearchReport = {
    id: 'r1',
    query: 'topic',
    depth: 'shallow',
    status: 'complete',
    sections: [{ title: 'Source A', content: 'snippet\n\nhttps://example.com/a' }],
    sources: [{ title: 'Source A', url: 'https://example.com/a', relevance: 1 }],
    degraded: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...report,
  }
  return { start: async () => full.id, get: () => full, list: () => [full] }
}

async function runTool(engine: ResearchEngine) {
  const [tool] = createResearchTools(() => engine)
  return (await tool.execute({ query: 'topic' }, {} as never)) as Record<string, unknown>
}

describe('research tool', () => {
  it('flags a report assembled without model synthesis as degraded', async () => {
    const out = await runTool(engineReturning({ degraded: true }))
    expect(out.degraded).toBe(true)
    expect(out.sections).toHaveLength(1)
  })

  it('omits the flag for a model-synthesized report', async () => {
    const out = await runTool(engineReturning({ degraded: false }))
    expect(out).not.toHaveProperty('degraded')
    expect(out.sections).toHaveLength(1)
  })
})
