// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PROMOTION_RULES,
} from '../../../../src/modules/memory/consolidator/types.js'
import {
  clusterEpisodicByFingerprint,
  findSemanticTombstoneCandidates,
  fingerprintEpisodic,
  isClusterEligibleForSemantic,
  isWorkingEligibleForEpisodic,
  parseImportance,
} from '../../../../src/modules/memory/consolidator/promotion-rules.js'
import type {
  WorkingMemoryBlock,
  EpisodicMemory,
} from '../../../../src/modules/memory/types.js'

const HOUR = 3_600_000
const DAY = 86_400_000

function makeBlock(partial: Partial<WorkingMemoryBlock> = {}): WorkingMemoryBlock {
  const now = Date.now()
  return {
    key: 'k',
    content: 'hello',
    maxTokens: 500,
    accessCount: 0,
    createdAt: new Date(now - 10 * HOUR).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HOUR).toISOString(),
    ...partial,
  }
}

function makeEpisodic(partial: Partial<EpisodicMemory> = {}): EpisodicMemory {
  const now = new Date().toISOString()
  return {
    id: Math.random().toString(36).slice(2),
    content: 'some fact',
    sourceType: 'extraction',
    sourceId: null,
    salience: 1.0,
    accessCount: 0,
    conversationCount: 1,
    validFrom: now,
    validUntil: null,
    tags: [],
    embeddingHash: null,
    agentId: null,
    createdAt: now,
    lastAccessedAt: now,
    ...partial,
  }
}

describe('parseImportance', () => {
  it('returns 0 when content is not JSON', () => {
    expect(parseImportance('plain text')).toBe(0)
  })

  it('returns 0 when JSON has no importance field', () => {
    expect(parseImportance(JSON.stringify({ text: 'hi' }))).toBe(0)
  })

  it('reads a numeric importance from JSON', () => {
    expect(parseImportance(JSON.stringify({ importance: 8 }))).toBe(8)
  })

  it('ignores non-numeric importance values', () => {
    expect(parseImportance(JSON.stringify({ importance: 'high' }))).toBe(0)
  })
})

describe('isWorkingEligibleForEpisodic', () => {
  const now = Date.now()

  it('rejects fresh blocks even if accessed many times', () => {
    const b = makeBlock({
      createdAt: new Date(now - 2 * HOUR).toISOString(),
      accessCount: 99,
    })
    expect(isWorkingEligibleForEpisodic(b, DEFAULT_PROMOTION_RULES, now)).toBe(false)
  })

  it('accepts old blocks with sufficient access count', () => {
    const b = makeBlock({
      createdAt: new Date(now - 10 * HOUR).toISOString(),
      accessCount: 2,
    })
    expect(isWorkingEligibleForEpisodic(b, DEFAULT_PROMOTION_RULES, now)).toBe(true)
  })

  it('accepts old blocks with high importance and 0 access', () => {
    const b = makeBlock({
      createdAt: new Date(now - 10 * HOUR).toISOString(),
      accessCount: 0,
      content: JSON.stringify({ importance: 8 }),
    })
    expect(isWorkingEligibleForEpisodic(b, DEFAULT_PROMOTION_RULES, now)).toBe(true)
  })

  it('rejects old blocks with neither access nor importance', () => {
    const b = makeBlock({
      createdAt: new Date(now - 20 * HOUR).toISOString(),
      accessCount: 1,
      content: 'just a note',
    })
    expect(isWorkingEligibleForEpisodic(b, DEFAULT_PROMOTION_RULES, now)).toBe(false)
  })
})

describe('fingerprintEpisodic', () => {
  it('normalises whitespace and case', () => {
    expect(fingerprintEpisodic('  Hello  World\n')).toBe('__shared__::hello world')
  })

  it('matches fingerprints that differ only in casing', () => {
    expect(fingerprintEpisodic('Odoo Runs')).toBe(fingerprintEpisodic('ODOO runs'))
  })

  it('separates fingerprints by agentId', () => {
    expect(fingerprintEpisodic('same text', 'agent-a')).not.toBe(fingerprintEpisodic('same text', 'agent-b'))
    expect(fingerprintEpisodic('same text', 'agent-a')).not.toBe(fingerprintEpisodic('same text', null))
  })
})

describe('clusterEpisodicByFingerprint + isClusterEligibleForSemantic', () => {
  const now = Date.now()

  it('clusters memories sharing a fingerprint', () => {
    const memories = [
      makeEpisodic({ content: 'User uses K8s' }),
      makeEpisodic({ content: 'user uses k8s' }),
      makeEpisodic({ content: 'User  uses K8s' }),
      makeEpisodic({ content: 'Totally different' }),
    ]
    const clusters = clusterEpisodicByFingerprint(memories)
    const big = clusters.find((c) => c.members.length === 3)
    expect(big).toBeDefined()
    expect(clusters).toHaveLength(2)
  })

  it('eligible when cluster has >= 3 members and was accessed recently', () => {
    const recent = new Date(now - 1 * DAY).toISOString()
    const memories = [
      makeEpisodic({ content: 'same', lastAccessedAt: recent }),
      makeEpisodic({ content: 'same', lastAccessedAt: recent }),
      makeEpisodic({ content: 'same', lastAccessedAt: recent }),
    ]
    const [cluster] = clusterEpisodicByFingerprint(memories)
    expect(isClusterEligibleForSemantic(cluster, DEFAULT_PROMOTION_RULES, now)).toBe(true)
  })

  it('rejects single-member clusters', () => {
    const memories = [makeEpisodic({ content: 'alone' })]
    const [cluster] = clusterEpisodicByFingerprint(memories)
    expect(isClusterEligibleForSemantic(cluster, DEFAULT_PROMOTION_RULES, now)).toBe(false)
  })

  it('rejects stale clusters (all members last-accessed > 30 days ago)', () => {
    const stale = new Date(now - 60 * DAY).toISOString()
    const memories = [
      makeEpisodic({ content: 'same', lastAccessedAt: stale, createdAt: stale }),
      makeEpisodic({ content: 'same', lastAccessedAt: stale, createdAt: stale }),
      makeEpisodic({ content: 'same', lastAccessedAt: stale, createdAt: stale }),
    ]
    const [cluster] = clusterEpisodicByFingerprint(memories)
    expect(isClusterEligibleForSemantic(cluster, DEFAULT_PROMOTION_RULES, now)).toBe(false)
  })
})

describe('findSemanticTombstoneCandidates', () => {
  const now = Date.now()

  it('marks entries untouched beyond the tombstone window', () => {
    const old = new Date(now - 200 * DAY).toISOString()
    const fresh = new Date(now - 10 * DAY).toISOString()
    const rows = [
      { path: 'old.md', indexedAt: old, lastAccessedAt: null },
      { path: 'fresh.md', indexedAt: fresh, lastAccessedAt: fresh },
    ]
    const out = findSemanticTombstoneCandidates(rows, DEFAULT_PROMOTION_RULES, now)
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('old.md')
  })

  it('uses lastAccessedAt when present', () => {
    const oldIndex = new Date(now - 200 * DAY).toISOString()
    const recentAccess = new Date(now - 5 * DAY).toISOString()
    const rows = [{ path: 'touched.md', indexedAt: oldIndex, lastAccessedAt: recentAccess }]
    const out = findSemanticTombstoneCandidates(rows, DEFAULT_PROMOTION_RULES, now)
    expect(out).toHaveLength(0)
  })
})
