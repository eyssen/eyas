// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 — the skill-candidate extractor derives a real slug from the run's tool
// sequence (was a pending-review-<id> placeholder).

import { describe, it, expect } from 'vitest'
import { createSkillCandidateExtractor } from '@modules/memory/consolidator/skill-candidate-extractor'

function portWith(sessions: any[]) {
  return { listCompletedSessions: () => sessions }
}

describe('skill-candidate extractor — slug derivation', () => {
  it('derives the slug from the tool sequence', () => {
    const ext = createSkillCandidateExtractor(portWith([
      { sessionId: 'sess-abc12345', success: true, toolCallCount: 6, endedAtTs: 0,
        toolNames: ['search_memory', 'search_memory', 'write_file', 'send_message', 'search_memory', 'write_file'] },
    ]) as any)

    const out = ext.propose(0)
    expect(out).toHaveLength(1)
    expect(out[0].slug).toBe('search-memory-write-file-send-message')
    expect(out[0].slug.startsWith('pending-review')).toBe(false)
  })

  it('falls back to a placeholder slug when no tool names are recorded', () => {
    const ext = createSkillCandidateExtractor(portWith([
      { sessionId: 'sess-deadbeef', success: true, toolCallCount: 7, endedAtTs: 0 },
    ]) as any)

    const out = ext.propose(0)
    expect(out[0].slug).toBe('pending-review-sess-dea')
  })

  it('ignores unsuccessful or too-short traces', () => {
    const ext = createSkillCandidateExtractor(portWith([
      { sessionId: 's1', success: false, toolCallCount: 9, endedAtTs: 0, toolNames: ['a', 'b'] },
      { sessionId: 's2', success: true, toolCallCount: 2, endedAtTs: 0, toolNames: ['a', 'b'] },
    ]) as any)
    expect(ext.propose(0)).toHaveLength(0)
  })
})
