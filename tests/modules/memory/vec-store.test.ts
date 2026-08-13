// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createVecStore } from '../../../src/modules/memory/embeddings/vec-store.js'
import { createEmbeddingService } from '../../../src/modules/memory/embeddings/embedding-service.js'

const rawFromDrizzle = getRawFromDrizzle

describe('VecStore + sqlite-vec integration', () => {
  it('loads extension and performs KNN search', async () => {
    const db = createMemoryDb()
    createMemoryTables(db)
    const rawDb = rawFromDrizzle(db)
    if (!rawDb) return  // driver doesn't expose raw handle — skip

    const store = createVecStore({ db, rawDb })
    if (!store.ready() && !store.ensureDimension(4)) {
      // sqlite-vec binary missing on this platform — skip rather than fail
      return
    }

    store.ensureDimension(4)
    store.upsertEpisodic('a', [1, 0, 0, 0])
    store.upsertEpisodic('b', [0.9, 0.1, 0, 0])
    store.upsertEpisodic('c', [0, 1, 0, 0])

    const hits = store.searchEpisodic([1, 0, 0, 0], 3)
    expect(hits.length).toBe(3)
    expect(hits[0].id).toBe('a')  // nearest = self
    expect(hits[1].id).toBe('b')  // next-closest
  })

  it('EmbeddingService backfills via bridge', async () => {
    const db = createMemoryDb()
    createMemoryTables(db)
    const rawDb = rawFromDrizzle(db)
    if (!rawDb) return

    const store = createVecStore({ db, rawDb })

    // Fake bridge that returns deterministic 4-dim vectors
    const bridge = {
      canEmbed: () => true,
      dimensions: () => 4,
      embed: async (texts: string[]) =>
        texts.map(t => [t.length % 4, (t.length * 2) % 4, 1, 0]),
    }

    const svc = createEmbeddingService({ db, vecStore: store, bridge })

    // Seed episodic rows without embeddings
    const { sql } = await import('drizzle-orm')
    db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, created_at)
      VALUES ('m1', 'hello', 'user', '2026-04-19', '2026-04-19T00:00:00Z')`)
    db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, created_at)
      VALUES ('m2', 'world', 'user', '2026-04-19', '2026-04-19T00:00:00Z')`)

    const result = await svc.backfill(10)
    if (!store.ready()) return  // extension missing — skip assertions

    expect(result.episodic).toBe(2)

    const hits = await svc.searchEpisodic('hello', 5)
    expect(hits.length).toBeGreaterThan(0)
  })
})
