// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeV2Db, silentLogger } from './helpers'
import { createHashEmbedder } from '@modules/memory/embeddings/hash-embedder'
import { embedLayeredBatch, floatToInt8, wipeForeignModelEmbeddings } from '@modules/memory/v2/l3-embed'
import { allocateRid } from '@modules/memory/v2/schema'
import { makeD1Db, gistRow } from './d1-fixtures'
import { capLiveIndex } from '@modules/memory/v2/live-cap'

let db: any
beforeEach(() => { db = makeV2Db().db })

function gist(text: string, id = 'gist-1'): void {
  const now = Date.now()
  const rid = allocateRid(db, 'gist', id, now)
  db.run(sql`INSERT INTO memory_gist (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
    scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score, gist_source,
    is_current, decay_score, presence_tier, multi_project, times_retrieved
  ) VALUES (
    ${rid}, ${id}, 'h', 'inst', ${now}, 0, 1, ${now}, 0,
    'task', 'c1', 0, ${text}, '{}', 0, 'owner', 10, 0.7, 'heuristic',
    1, 1.0, 'hot', 0, 0
  )`)
}

describe('embedLayeredBatch', () => {
  it('writes a 384-d int8 vector for a current gist and is idempotent', async () => {
    gist('Never commit or push automatically.')
    const bridge = createHashEmbedder()
    const first = await embedLayeredBatch({ db, bridge, logger: silentLogger })
    expect(first.gists).toBe(1)
    const rows = db.all(sql`SELECT owner_type, model_id, dimensions FROM memory_embedding`) as Array<{
      owner_type: string; model_id: string; dimensions: number
    }>
    expect(rows).toEqual([{ owner_type: 'gist', model_id: 'stem5-fnv-384', dimensions: 384 }])
    const again = await embedLayeredBatch({ db, bridge, logger: silentLogger })
    expect(again.gists).toBe(0)
    expect((db.all(sql`SELECT COUNT(*) AS n FROM memory_embedding`) as Array<{ n: number }>)[0].n).toBe(1)
  })

  it('quantises a unit vector into int8 without clipping the peak to zero', () => {
    const buf = floatToInt8([1, 0, 0])
    expect(buf[0]).toBe(127)
    expect(buf[1]).toBe(0)
  })
})

describe('wipeForeignModelEmbeddings', () => {
  function world() {
    const { db, raw, vec0 } = makeD1Db()
    const now = Date.now()
    const iso = new Date(now).toISOString()
    db.run(sql`INSERT INTO vault_index (path, title, tier, content_text, embedding_hash, file_hash, indexed_at)
      VALUES ('semantic/a.md', 'A', 'semantic', 'alpha', 'vault-hash', 'f', ${iso})`)
    db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, embedding_hash, created_at)
      VALUES ('ep-1', 'an episode', 'conversation', ${iso}, 'epi-hash', ${iso})`)
    return { db, raw, vec0 }
  }

  it('leaves the legacy vault/episodic index alone (no embedding_hash reset)', async () => {
    const { db, raw } = world()
    gistRow(db, 'g-old', 'A gist embedded by an older model')
    await embedLayeredBatch({ db, rawDb: raw, bridge: { ...createHashEmbedder(), modelId: () => 'old-model' }, logger: silentLogger })
    expect(wipeForeignModelEmbeddings(db, raw, 'stem5-fnv-384')).toBe(1)
    expect((db.all(sql`SELECT embedding_hash AS h FROM vault_index`) as Array<{ h: string | null }>)[0]!.h).toBe('vault-hash')
    expect((db.all(sql`SELECT embedding_hash AS h FROM episodic_memories`) as Array<{ h: string | null }>)[0]!.h).toBe('epi-hash')
  })

  it('drops only the foreign model rows; the kept model keeps its row and its vec0 entry', async () => {
    const { db, raw, vec0 } = world()
    gistRow(db, 'g-keep', 'Invoices are approved by the finance lead')
    await embedLayeredBatch({ db, rawDb: raw, bridge: createHashEmbedder(), logger: silentLogger })
    gistRow(db, 'g-old', 'The warehouse moves to the north site')
    await embedLayeredBatch({ db, rawDb: raw, bridge: { ...createHashEmbedder(), modelId: () => 'old-model' }, logger: silentLogger })
    const keepRid = (db.all(sql`SELECT rid FROM memory_embedding WHERE owner_id = 'g-keep' AND model_id = 'stem5-fnv-384'`) as Array<{ rid: number }>)[0]!.rid

    expect(wipeForeignModelEmbeddings(db, raw, 'stem5-fnv-384')).toBe(2)
    expect(db.all(sql`SELECT DISTINCT model_id AS m FROM memory_embedding`)).toEqual([{ m: 'stem5-fnv-384' }])
    if (vec0) {
      expect((raw.prepare('SELECT COUNT(*) AS n FROM memory_embedding_vec WHERE rowid = ?').get(keepRid) as { n: number }).n).toBe(1)
      expect((raw.prepare('SELECT COUNT(*) AS n FROM memory_embedding_vec').get() as { n: number }).n).toBe(1)
    }
    expect(wipeForeignModelEmbeddings(db, raw, 'stem5-fnv-384')).toBe(0)
  })
})

describe('capLiveIndex (runs after every L3 drain)', () => {
  it('under the cap nothing is demoted; over it the oldest vectors leave the live set', async () => {
    const { db, raw } = makeD1Db()
    gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    gistRow(db, 'g-2', 'The warehouse moves to the north site')
    gistRow(db, 'g-3', 'Releases ship on Fridays')
    await embedLayeredBatch({ db, rawDb: raw, bridge: createHashEmbedder(), logger: silentLogger })
    expect(capLiveIndex(db, raw, 3)).toEqual({ demoted: 0 })
    expect((db.all(sql`SELECT COUNT(*) AS n FROM memory_embedding WHERE live_in_index = 1`) as Array<{ n: number }>)[0]!.n).toBe(3)
    db.run(sql`UPDATE memory_embedding SET created_at = 1 WHERE owner_id = 'g-1'`)
    expect(capLiveIndex(db, raw, 2)).toEqual({ demoted: 1 })
    expect(db.all(sql`SELECT owner_id FROM memory_embedding WHERE live_in_index = 0`)).toEqual([{ owner_id: 'g-1' }])
  })
})
