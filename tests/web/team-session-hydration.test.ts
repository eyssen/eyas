// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  pickHydratableSession,
  buildProposalFromSession,
  type PersistedTeamSession,
} from '../../src/web/src/pages/conversations/team-session-hydration'

const session = (over: Partial<PersistedTeamSession> = {}): PersistedTeamSession => ({
  id: 's1',
  parentConversationId: 'c1',
  status: 'running',
  config: JSON.stringify({ phases: [{ name: 'Build', agents: ['a1'], parallel: false }] }),
  reasoning: 'because',
  estimatedTokens: 1000,
  ...over,
})

describe('pickHydratableSession', () => {
  it('returns null for an empty or missing list', () => {
    expect(pickHydratableSession([])).toBeNull()
    expect(pickHydratableSession(undefined)).toBeNull()
    expect(pickHydratableSession(null)).toBeNull()
  })

  it('prefers the newest live session over a newer terminal one', () => {
    // The route returns newest-first.
    const picked = pickHydratableSession([
      session({ id: 'newest', status: 'completed' }),
      session({ id: 'live', status: 'paused' }),
      session({ id: 'oldest', status: 'failed' }),
    ])
    expect(picked?.id).toBe('live')
  })

  it('falls back to the newest session when all are terminal', () => {
    const picked = pickHydratableSession([
      session({ id: 'newest', status: 'completed' }),
      session({ id: 'older', status: 'failed' }),
    ])
    expect(picked?.id).toBe('newest')
  })

  it('picks a proposing session so the card comes back after a reload', () => {
    const picked = pickHydratableSession([session({ id: 'p', status: 'proposing' })])
    expect(picked?.id).toBe('p')
  })

  it('does not re-attach a rejected session the conversation was detached from', () => {
    // reject() nulls conversations.team_session_id — the user dismissed it, so
    // a reload must not bring the session back.
    expect(pickHydratableSession([session({ id: 'rejected', status: 'failed' })], null)).toBeNull()
    expect(pickHydratableSession([session({ id: 'rejected', status: 'failed' })])).toBeNull()
    expect(
      pickHydratableSession([session({ id: 'rejected', status: 'failed' })], 'some-other-session'),
    ).toBeNull()
  })

  it('still attaches a failed session the conversation is stamped with', () => {
    // A run that failed on its own keeps the stamp — its rails are worth seeing.
    const picked = pickHydratableSession([session({ id: 'crashed', status: 'failed' })], 'crashed')
    expect(picked?.id).toBe('crashed')
  })

  it('prefers a live session even when the stamp names a rejected newer one', () => {
    const picked = pickHydratableSession(
      [session({ id: 'rejected', status: 'failed' }), session({ id: 'live', status: 'running' })],
      'rejected',
    )
    expect(picked?.id).toBe('live')
  })
})

describe('buildProposalFromSession', () => {
  it('rebuilds a renderable proposal from the persisted config', () => {
    const proposal = buildProposalFromSession(session({ estimatedTokens: 200_000 }))
    expect(proposal).toEqual({
      phases: [{ name: 'Build', agents: ['a1'], parallel: false }],
      estimatedTokens: 200_000,
      estimatedCostUsd: 200_000 * 0.000003,
      reasoning: 'because',
      agentGaps: [],
    })
  })

  it('defaults reasoning to an empty string when the row has none', () => {
    expect(buildProposalFromSession(session({ reasoning: null }))?.reasoning).toBe('')
  })

  it('returns null on unparseable config', () => {
    expect(buildProposalFromSession(session({ config: 'not json' }))).toBeNull()
  })

  it('returns null when the config carries no phases array', () => {
    expect(buildProposalFromSession(session({ config: JSON.stringify({ agents: [] }) }))).toBeNull()
    expect(buildProposalFromSession(session({ config: JSON.stringify({ phases: 'nope' }) }))).toBeNull()
  })

  it('returns null when a phases ELEMENT is malformed', () => {
    const withPhases = (phases: unknown) =>
      buildProposalFromSession(session({ config: JSON.stringify({ phases }) }))
    expect(withPhases([1, 2, 3])).toBeNull()
    expect(withPhases(['Build'])).toBeNull()
    expect(withPhases([null])).toBeNull()
    expect(withPhases([[{ name: 'Build', agents: [] }]])).toBeNull()
    expect(withPhases([{ agents: ['a1'], parallel: false }])).toBeNull() // no name
    expect(withPhases([{ name: 'Build', parallel: false }])).toBeNull() // no agents
    expect(withPhases([{ name: 'Build', agents: [{ id: 'a1' }] }])).toBeNull() // agents not strings
    // One bad element poisons the whole rebuild — a partly rendered card is worse.
    expect(withPhases([{ name: 'Build', agents: ['a1'], parallel: false }, 7])).toBeNull()
  })

  it('coerces a missing parallel flag rather than rejecting the phase', () => {
    // `parallel` is display-only, so an older config row still renders.
    const proposal = buildProposalFromSession(
      session({ config: JSON.stringify({ phases: [{ name: 'Build', agents: ['a1'] }] }) }),
    )
    expect(proposal?.phases).toEqual([{ name: 'Build', agents: ['a1'], parallel: false }])
  })
})
