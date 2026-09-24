// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// GET /api/v1/observability/traces: the query is Zod-validated, and the
// optional purposeGroup filter narrows the list to the background calls of
// one purpose group (memory, learning, title, safety, planning, research,
// triage). Conversation turns have no purpose and match no group.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createObservabilityTables } from '@modules/observability/schema'
import { createTraceCollector, TRACE_PURPOSE_GROUPS, type AiTrace, type TraceCollector } from '@modules/observability/trace-collector'
import { createObservabilityRoutes } from '@modules/observability/routes'
import { AUX_POLICY } from '@modules/model/auxiliary'
import type { EyasDb, ModuleContext } from '@core/types'

let db: EyasDb
let collector: TraceCollector

function seed(over: Partial<Omit<AiTrace, 'id' | 'timestamp'>> = {}) {
  return collector.insert({
    requestId: 'req', conversationId: null, agentSessionId: null, model: 'm', provider: 'p',
    memoryTiersUsed: null, contextTokens: 0, systemPromptTokens: 0, toolDefinitions: null, toolCalls: null,
    toolCallCount: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, qualityScoreAuto: null, qualityScoreUser: null,
    evaluatorModel: null, error: null, compositionId: null,
    ...over,
  })
}

function mount(ability?: { can: (a: string, s: string) => boolean }) {
  const app = new Hono()
  if (ability) app.use('*', async (c, next) => { (c as any).set('ability', ability); await next() })
  createObservabilityRoutes(app as any, collector, { db, logger: { warn() {}, debug() {}, info() {}, error() {} } } as unknown as ModuleContext)
  return app
}

const allow = { can: () => true }

beforeEach(() => {
  db = createMemoryDb()
  createObservabilityTables(db)
  collector = createTraceCollector(db)
  seed({ requestId: 'turn', conversationId: 'conv-1' })
  seed({ requestId: 'capture', purpose: 'capture', auxRoute: 'isolated-cli' })
  seed({ requestId: 'consolidation', purpose: 'consolidation', auxRoute: 'tier' })
  seed({ requestId: 'title', purpose: 'title', auxRoute: 'tier' })
  seed({ requestId: 'judge', purpose: 'security_judge', auxRoute: 'api' })
})

describe('GET /api/v1/observability/traces — purposeGroup filter', () => {
  it('purposeGroup=memory returns only memory traces (positive)', async () => {
    const res = await mount(allow).request('/api/v1/observability/traces?purposeGroup=memory')
    expect(res.status).toBe(200)
    const body = await res.json() as { traces: AiTrace[]; total: number }
    expect(body.total).toBe(2)
    expect(body.traces.map((t) => t.requestId).sort()).toEqual(['capture', 'consolidation'])
    expect(body.traces.every((t) => t.purposeGroup === 'memory')).toBe(true)
    expect(body.traces.find((t) => t.requestId === 'capture')).toMatchObject({ purpose: 'capture', auxRoute: 'isolated-cli' })
  })

  it('every other group narrows to its own purposes; a group with no calls is empty', async () => {
    const safety = await (await mount(allow).request('/api/v1/observability/traces?purposeGroup=safety')).json() as any
    expect(safety.traces.map((t: AiTrace) => t.requestId)).toEqual(['judge'])
    const triage = await (await mount(allow).request('/api/v1/observability/traces?purposeGroup=triage')).json() as any
    expect(triage).toEqual({ traces: [], total: 0 })
  })

  it('without the filter every trace is listed, conversation turns with no purpose group', async () => {
    const body = await (await mount(allow).request('/api/v1/observability/traces')).json() as any
    expect(body.total).toBe(5)
    expect(body.traces.find((t: AiTrace) => t.requestId === 'turn')).toMatchObject({ purpose: null, auxRoute: null, purposeGroup: null })
  })

  it('an empty purposeGroup is treated as absent', async () => {
    const res = await mount(allow).request('/api/v1/observability/traces?purposeGroup=&model=')
    expect(res.status).toBe(200)
    expect((await res.json() as any).total).toBe(5)
  })

  it('an unknown purposeGroup value gets 400 from Zod (negative)', async () => {
    for (const bad of ['bogus', 'capture', 'MEMORY']) {
      const res = await mount(allow).request(`/api/v1/observability/traces?purposeGroup=${bad}`)
      expect(res.status).toBe(400)
      const body = await res.json() as any
      expect(body.error).toBe('Invalid query')
      expect(body.details[0].path).toEqual(['purposeGroup'])
    }
  })

  it('rejects a malformed page with 400 instead of passing NaN to SQL (negative)', async () => {
    expect((await mount(allow).request('/api/v1/observability/traces?limit=abc')).status).toBe(400)
    expect((await mount(allow).request('/api/v1/observability/traces?limit=0')).status).toBe(400)
    expect((await mount(allow).request('/api/v1/observability/traces?limit=100000')).status).toBe(400)
    expect((await mount(allow).request('/api/v1/observability/traces?offset=-1')).status).toBe(400)
    expect((await mount(allow).request('/api/v1/observability/traces?minCost=x')).status).toBe(400)
  })

  it('keeps the existing filters and paging working', async () => {
    const res = await mount(allow).request('/api/v1/observability/traces?conversationId=conv-1&limit=200&offset=0')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.traces.map((t: AiTrace) => t.requestId)).toEqual(['turn'])
    const paged = await (await mount(allow).request('/api/v1/observability/traces?limit=2&offset=1')).json() as any
    expect(paged.total).toBe(5)
    expect(paged.traces).toHaveLength(2)
  })

  it('stays behind read:AuditEntry (negative)', async () => {
    expect((await mount().request('/api/v1/observability/traces?purposeGroup=memory')).status).toBe(401)
    expect((await mount({ can: () => false }).request('/api/v1/observability/traces?purposeGroup=memory')).status).toBe(403)
  })

  it('accepts exactly the auxiliary purpose groups', () => {
    expect([...TRACE_PURPOSE_GROUPS]).toEqual(Object.keys(AUX_POLICY))
  })
})
