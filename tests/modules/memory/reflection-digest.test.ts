// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Dream-engine (Cap 6) groundwork: a nightly reflection digest persisted as five
// buckets, plus a morning-briefing renderer. The digest is one-per-day (a re-run
// replaces it), survives restarts, and the briefing skips empty buckets so a
// quiet night reads as "nothing notable" rather than five empty headers.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import {
  createReflectionDigestTables,
  createReflectionDigestService,
  buildMorningBriefing,
  type DigestBucket,
} from '@modules/memory/reflection-digest.js'

function fresh() {
  const db = createMemoryDb()
  createReflectionDigestTables(db)
  const make = () => createReflectionDigestService(db, { now: () => new Date('2026-06-23T06:00:00.000Z') })
  return { db, svc: make(), restart: make }
}

const buckets = (over: Partial<Record<string, string[]>> = {}): DigestBucket[] => [
  { key: 'accomplishments', title: 'Accomplishments', items: over.accomplishments ?? ['shipped Cap 5'] },
  { key: 'blockers', title: 'Blockers', items: over.blockers ?? [] },
  { key: 'learnings', title: 'Learnings', items: over.learnings ?? [] },
  { key: 'suggestions', title: 'Suggestions', items: over.suggestions ?? [] },
  { key: 'external', title: 'External', items: over.external ?? [] },
]

describe('reflection digest store', () => {
  it('records a digest and returns it from latest()', () => {
    const { svc } = fresh()
    svc.record({ date: '2026-06-22', buckets: buckets() })
    const latest = svc.latest()
    expect(latest?.date).toBe('2026-06-22')
    expect(latest?.buckets.find((b) => b.key === 'accomplishments')?.items).toEqual(['shipped Cap 5'])
  })

  it('keeps one digest per date (a re-run replaces it)', () => {
    const { svc } = fresh()
    svc.record({ date: '2026-06-22', buckets: buckets({ accomplishments: ['v1'] }) })
    svc.record({ date: '2026-06-22', buckets: buckets({ accomplishments: ['v2'] }) })
    expect(svc.list()).toHaveLength(1)
    expect(svc.getByDate('2026-06-22')?.buckets[0].items).toEqual(['v2'])
  })

  it('lists digests most-recent-first', () => {
    const { svc } = fresh()
    svc.record({ date: '2026-06-20', buckets: buckets() })
    svc.record({ date: '2026-06-22', buckets: buckets() })
    svc.record({ date: '2026-06-21', buckets: buckets() })
    expect(svc.list().map((d) => d.date)).toEqual(['2026-06-22', '2026-06-21', '2026-06-20'])
  })

  it('survives a restart (new service instance, same DB)', () => {
    const h = fresh()
    h.svc.record({ date: '2026-06-22', buckets: buckets() })
    expect(h.restart().latest()?.date).toBe('2026-06-22')
  })
})

describe('buildMorningBriefing', () => {
  it('renders non-empty buckets and skips empty ones', () => {
    const out = buildMorningBriefing({
      id: 'd1',
      date: '2026-06-22',
      buckets: buckets({ accomplishments: ['shipped Cap 5'], blockers: ['VIES API down'] }),
      createdAt: '2026-06-23T06:00:00.000Z',
    })
    expect(out).toContain('Accomplishments')
    expect(out).toContain('shipped Cap 5')
    expect(out).toContain('Blockers')
    expect(out).toContain('VIES API down')
    expect(out).not.toContain('Learnings') // empty → skipped
  })

  it('reads as "nothing notable" when every bucket is empty', () => {
    const out = buildMorningBriefing({
      id: 'd1',
      date: '2026-06-22',
      buckets: buckets({ accomplishments: [] }),
      createdAt: '2026-06-23T06:00:00.000Z',
    })
    expect(out.toLowerCase()).toContain('nothing notable')
  })
})
