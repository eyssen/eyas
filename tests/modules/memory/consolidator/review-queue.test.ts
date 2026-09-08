// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../../helpers/test-db'
import { createMemoryTables } from '../../../../src/modules/memory/schema.js'
import { createReviewQueue } from '../../../../src/modules/memory/consolidator/review-queue.js'

describe('ReviewQueue', () => {
  let db: ReturnType<typeof createMemoryDb>
  let rq: ReturnType<typeof createReviewQueue>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    rq = createReviewQueue(db)
  })

  it('persists + lists + approves skill candidates', () => {
    const inserted = rq.persistSkillCandidates([
      { id: 's1', sessionId: 'sess-a', slug: 'slug-a', rationale: 'why', toolCallCount: 7, proposedAt: 1000, status: 'pending' },
      { id: 's2', sessionId: 'sess-b', slug: 'slug-b', rationale: 'why', toolCallCount: 9, proposedAt: 2000, status: 'pending' },
    ])
    expect(inserted).toBe(2)

    const pending = rq.listSkillCandidates('pending')
    expect(pending).toHaveLength(2)

    const ok = rq.reviewSkillCandidate({ id: 's1', status: 'approved', reviewerId: 'user-1' })
    expect(ok).toBe(true)

    expect(rq.listSkillCandidates('pending')).toHaveLength(1)
    expect(rq.listSkillCandidates('approved')).toHaveLength(1)
  })

  it('rejects wiki proposals', () => {
    rq.persistWikiProposals([
      { id: 'w1', clientId: 'client-a', pagePath: 'wiki/a.md', proposedBody: 'body', summary: 'sum', proposedAt: 1, status: 'pending' },
    ])
    const ok = rq.reviewWikiProposal({ id: 'w1', status: 'rejected' })
    expect(ok).toBe(true)
    expect(rq.listWikiProposals('rejected')).toHaveLength(1)
  })

  it('ignores approve on non-existent id', () => {
    expect(rq.reviewSkillCandidate({ id: 'missing', status: 'approved' })).toBe(false)
  })
})
