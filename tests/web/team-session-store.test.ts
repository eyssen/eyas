// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { useTeamSessionStore } from '../../src/web/src/stores/team-session-store'

const sampleProposal = {
  phases: [{ name: 'Build', agents: ['a1'], parallel: false }],
  estimatedTokens: 100,
  estimatedCostUsd: 0.1,
  reasoning: 'because',
  agentGaps: [],
}

describe('team-session-store handleEvent — team:proposed', () => {
  beforeEach(() => {
    useTeamSessionStore.getState().reset()
  })

  it('renders the proposal (sets session/proposal/status) on a well-formed event', () => {
    useTeamSessionStore.getState().handleEvent({
      type: 'team:proposed',
      session: { id: 's1', parentConversationId: 'c1' },
      proposal: sampleProposal,
    })
    const s = useTeamSessionStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.parentConversationId).toBe('c1')
    expect(s.proposal).toEqual(sampleProposal)
    expect(s.status).toBe('proposing')
  })

  it('does not throw and leaves state untouched when session is missing', () => {
    expect(() =>
      useTeamSessionStore.getState().handleEvent({ type: 'team:proposed', proposal: sampleProposal }),
    ).not.toThrow()
    expect(useTeamSessionStore.getState().sessionId).toBeNull()
    expect(useTeamSessionStore.getState().status).toBeNull()
  })

  it('does not throw and leaves state untouched when proposal is missing', () => {
    expect(() =>
      useTeamSessionStore.getState().handleEvent({ type: 'team:proposed', session: { id: 's1' } }),
    ).not.toThrow()
    expect(useTeamSessionStore.getState().sessionId).toBeNull()
  })

  it('ignores unrelated / envelope-shaped messages without throwing', () => {
    // Callers unwrap the WS envelope, but a raw frame must stay a harmless
    // no-op rather than a TypeError.
    expect(() =>
      useTeamSessionStore.getState().handleEvent({ event: 'chat', data: { foo: 'bar' }, topic: 'chat:c1' }),
    ).not.toThrow()
    expect(useTeamSessionStore.getState().sessionId).toBeNull()
  })
})

describe('team-session-store rehydrate', () => {
  beforeEach(() => {
    useTeamSessionStore.getState().reset()
  })

  it('sets sessionId/parentConversationId/status without faking a proposal', () => {
    useTeamSessionStore.getState().rehydrate('s1', 'c1', 'running')
    const s = useTeamSessionStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.parentConversationId).toBe('c1')
    expect(s.status).toBe('running')
    expect(s.proposal).toBeNull()
    expect(s.agentStates).toEqual([])
  })

  it('defaults parentConversationId and status to null when omitted', () => {
    useTeamSessionStore.getState().rehydrate('s1')
    const s = useTeamSessionStore.getState()
    expect(s.sessionId).toBe('s1')
    expect(s.parentConversationId).toBeNull()
    expect(s.status).toBeNull()
  })

  it('reset clears a rehydrated session', () => {
    useTeamSessionStore.getState().rehydrate('s1', 'c1', 'completed')
    useTeamSessionStore.getState().reset()
    expect(useTeamSessionStore.getState().sessionId).toBeNull()
  })
})

describe('team-session-store team_approved', () => {
  beforeEach(() => {
    useTeamSessionStore.getState().reset()
  })

  it('opens the dashboard on approval — it is the only surface rendering memory', () => {
    expect(useTeamSessionStore.getState().isExpanded).toBe(false)
    useTeamSessionStore.getState().handleEvent({ type: 'team_approved' })
    const s = useTeamSessionStore.getState()
    expect(s.status).toBe('running')
    expect(s.isExpanded).toBe(true)
  })

  it('leaves the dashboard collapsed for a proposal (the card lives elsewhere)', () => {
    useTeamSessionStore.getState().handleEvent({
      type: 'team:proposed',
      session: { id: 's1', parentConversationId: 'c1' },
      proposal: sampleProposal,
    })
    expect(useTeamSessionStore.getState().isExpanded).toBe(false)
  })

  it('reset re-collapses the dashboard on conversation switch', () => {
    useTeamSessionStore.getState().handleEvent({ type: 'team_approved' })
    useTeamSessionStore.getState().reset()
    expect(useTeamSessionStore.getState().isExpanded).toBe(false)
  })
})

describe('team-session-store hydrateMemory', () => {
  const raw = (id: string, key: string, value: string) => ({
    id,
    key,
    value,
    category: 'finding' as const,
    layer: 'agent' as const,
    authorAgentId: 'a1',
    createdAt: `2026-07-28T10:0${id.slice(-1)}:00Z`,
  })

  beforeEach(() => {
    useTeamSessionStore.getState().reset()
  })

  it('maps REST entries, parsing the stored JSON value', () => {
    useTeamSessionStore.getState().hydrateMemory([
      raw('m1', 'finding.a', JSON.stringify({ detail: 'nested' })),
      raw('m2', 'finding.b', JSON.stringify(42)),
    ])
    const entries = useTeamSessionStore.getState().memoryEntries
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ id: 'm1', key: 'finding.a', category: 'finding', layer: 'agent', authorAgentId: 'a1' })
    expect(entries[0].value).toEqual({ detail: 'nested' })
    expect(entries[1].value).toBe(42)
  })

  it('falls back to the raw string when the value is not JSON', () => {
    useTeamSessionStore.getState().hydrateMemory([raw('m1', 'note', 'plain text')])
    expect(useTeamSessionStore.getState().memoryEntries[0].value).toBe('plain text')
  })

  it('REPLACES the existing entries rather than appending', () => {
    useTeamSessionStore.getState().hydrateMemory([raw('m1', 'first', '"one"')])
    useTeamSessionStore.getState().hydrateMemory([raw('m2', 'second', '"two"')])
    const entries = useTeamSessionStore.getState().memoryEntries
    expect(entries.map(e => e.id)).toEqual(['m2'])
  })

  it('clears the panel when the replay is empty', () => {
    useTeamSessionStore.getState().hydrateMemory([raw('m1', 'first', '"one"')])
    useTeamSessionStore.getState().hydrateMemory([])
    expect(useTeamSessionStore.getState().memoryEntries).toEqual([])
  })

  it('live memory_written events append on top of the hydrated replay', () => {
    useTeamSessionStore.getState().hydrateMemory([raw('m1', 'first', '"one"')])
    useTeamSessionStore.getState().handleEvent({
      type: 'memory_written',
      entry: raw('m2', 'second', JSON.stringify({ live: true })),
    })
    const entries = useTeamSessionStore.getState().memoryEntries
    expect(entries.map(e => e.id)).toEqual(['m1', 'm2'])
    expect(entries[1].value).toEqual({ live: true })
  })

  it('reset clears hydrated memory', () => {
    useTeamSessionStore.getState().hydrateMemory([raw('m1', 'first', '"one"')])
    useTeamSessionStore.getState().reset()
    expect(useTeamSessionStore.getState().memoryEntries).toEqual([])
  })
})
