// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { makeV2Db, silentLogger } from './helpers'
import { createHashEmbedder } from '@modules/memory/embeddings/hash-embedder'
import { embedLayeredBatch, floatToInt8 } from '@modules/memory/v2/l3-embed'
import { allocateRid } from '@modules/memory/v2/schema'

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
