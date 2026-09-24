// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createOrphanGc } from '../../../../src/modules/memory/consolidator/orphan-gc.js'
import type {
  ConsolidatorMemoryPort,
} from '../../../../src/modules/memory/consolidator/types.js'
import type {
  EpisodicMemory,
  WorkingMemoryBlock,
} from '../../../../src/modules/memory/types.js'

const DAY = 86_400_000

function makeEpisodic(partial: Partial<EpisodicMemory> = {}): EpisodicMemory {
  const now = new Date().toISOString()
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    content: 'content',
    sourceType: 'conversation',
    sourceId: 'conv-1',
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

/** Build a fake ConsolidatorMemoryPort backed by an in-memory array. */
function makeMemoryPort(initial: EpisodicMemory[] = []): {
  port: ConsolidatorMemoryPort
  store: EpisodicMemory[]
} {
  const store = [...initial]
  const port: ConsolidatorMemoryPort = {
    working: {
      listAll(): WorkingMemoryBlock[] {
        return []
      },
      delete() { /* unused here */ },
    },
    episodic: {
      list() {
        return store.slice()
      },
      create() {
        throw new Error('not used in orphan-gc tests')
      },
      invalidate() { /* unused */ },
      delete(id: string) {
        const idx = store.findIndex((m) => m.id === id)
        if (idx >= 0) store.splice(idx, 1)
      },
    },
  }
  return { port, store }
}

describe('createOrphanGc', () => {
  const now = Date.now()

  it('deletes orphans older than retention AND with unreachable sourceId', () => {
    const oldOrphan = makeEpisodic({
      id: 'old-orphan',
      createdAt: new Date(now - 30 * DAY).toISOString(),
      sourceId: 'conv-gone',
    })
    const { port, store } = makeMemoryPort([oldOrphan])
    const gc = createOrphanGc(port, () => false, { retentionDays: 14 })

    const deleted = gc.run(now)

    expect(deleted).toBe(1)
    expect(store).toHaveLength(0)
  })

  it('preserves fresh orphans', () => {
    const fresh = makeEpisodic({
      id: 'fresh',
      createdAt: new Date(now - 2 * DAY).toISOString(),
      sourceId: 'conv-gone',
    })
    const { port, store } = makeMemoryPort([fresh])
    const gc = createOrphanGc(port, () => false, { retentionDays: 14 })

    expect(gc.run(now)).toBe(0)
    expect(store).toHaveLength(1)
  })

  it('preserves old but reachable memories', () => {
    const oldReachable = makeEpisodic({
      id: 'old-but-live',
      createdAt: new Date(now - 30 * DAY).toISOString(),
      sourceId: 'conv-live',
    })
    const { port, store } = makeMemoryPort([oldReachable])
    const gc = createOrphanGc(port, () => true, { retentionDays: 14 })

    expect(gc.run(now)).toBe(0)
    expect(store).toHaveLength(1)
  })

  it('preserves unanchored rows (sourceId is null)', () => {
    const unanchored = makeEpisodic({
      id: 'user-note',
      createdAt: new Date(now - 365 * DAY).toISOString(),
      sourceId: null,
    })
    const { port, store } = makeMemoryPort([unanchored])
    const gc = createOrphanGc(port, () => false, { retentionDays: 14 })

    expect(gc.run(now)).toBe(0)
    expect(store).toHaveLength(1)
  })

  it('deletes multiple orphans in a single run and ignores reachable ones in the same batch', () => {
    const toKill = makeEpisodic({
      id: 'k1',
      createdAt: new Date(now - 30 * DAY).toISOString(),
      sourceId: 'gone-1',
    })
    const toKill2 = makeEpisodic({
      id: 'k2',
      createdAt: new Date(now - 60 * DAY).toISOString(),
      sourceId: 'gone-2',
    })
    const toKeep = makeEpisodic({
      id: 'live',
      createdAt: new Date(now - 30 * DAY).toISOString(),
      sourceId: 'still-here',
    })
    const { port, store } = makeMemoryPort([toKill, toKill2, toKeep])

    const reachable = new Set(['still-here'])
    const gc = createOrphanGc(port, (m) => reachable.has(m.sourceId ?? ''), {
      retentionDays: 14,
    })

    expect(gc.run(now)).toBe(2)
    expect(store.map((m) => m.id)).toEqual(['live'])
  })
})
