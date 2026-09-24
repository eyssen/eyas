// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { participantHasPeerReview, rememberGodRuns, visibleGodTab } from '../../src/web/src/pages/conversations/god-mode-tab'

describe('visibleGodTab', () => {
  it('is visible when God Mode is on even with no runs', () => {
    expect(visibleGodTab(true, 0)).toBe(true)
  })

  it('is visible when the conversation has historical runs and God Mode is off', () => {
    expect(visibleGodTab(false, 1)).toBe(true)
    expect(visibleGodTab(false, 3)).toBe(true)
  })

  it('is hidden when God Mode is off and there are no runs', () => {
    expect(visibleGodTab(false, 0)).toBe(false)
  })

  it('stays visible when God Mode is on and runs already exist', () => {
    expect(visibleGodTab(true, 2)).toBe(true)
  })
})

describe('participantHasPeerReview', () => {
  const empty = {
    voteFor: null as string | null,
    reviewSummary: null as string | null,
    scores: null as unknown,
    uniqueInsights: [] as string[],
    risks: [] as string[],
  }

  it('is false when the worker left no review payload', () => {
    expect(participantHasPeerReview(empty)).toBe(false)
  })

  it('is true when they voted, scored, or commented', () => {
    expect(participantHasPeerReview({ ...empty, voteFor: 'a' })).toBe(true)
    expect(participantHasPeerReview({ ...empty, reviewSummary: 'prefer A' })).toBe(true)
    expect(participantHasPeerReview({ ...empty, uniqueInsights: ['note'] })).toBe(true)
    expect(participantHasPeerReview({ ...empty, risks: ['leak'] })).toBe(true)
    expect(participantHasPeerReview({ ...empty, scores: { quality: 4, completeness: 4, risk: 2 } })).toBe(true)
  })
})

describe('rememberGodRuns', () => {
  it('latches true once a run has been seen', () => {
    expect(rememberGodRuns(false, 0)).toBe(false)
    expect(rememberGodRuns(false, 1)).toBe(true)
    expect(rememberGodRuns(true, 0)).toBe(true)
    expect(rememberGodRuns(true, 2)).toBe(true)
  })

  it('keeps the tab visible after God Mode is turned off mid-run', () => {
    const seen = rememberGodRuns(false, 1)
    expect(visibleGodTab(false, seen ? 1 : 0)).toBe(true)
  })
})
