// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The legacy vault/episodic index re-embeds when ITS embedder changes —
// keyed on memory_meta 'legacy_embed_model', never on the L3 model.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { resetLegacyIndexOnModelSwap, LEGACY_EMBED_MODEL_META_KEY } from '@modules/memory/embeddings/legacy-model-swap'
import { getMemoryMeta } from '@modules/memory/v2/schema'
import { makeD1Db, gistRow } from '../v2/d1-fixtures'
import { silentLogger } from '../v2/helpers'

function world() {
  const { db, raw, vec0 } = makeD1Db()
  const iso = new Date().toISOString()
  db.run(sql`INSERT INTO vault_index (path, title, tier, content_text, embedding_hash, file_hash, indexed_at)
    VALUES ('semantic/a.md', 'A', 'semantic', 'alpha', 'vault-hash', 'f', ${iso})`)
  db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, embedding_hash, created_at)
    VALUES ('ep-1', 'an episode', 'conversation', ${iso}, 'epi-hash', ${iso})`)
  db.run(sql`CREATE TABLE IF NOT EXISTS vec_meta (id INTEGER PRIMARY KEY CHECK (id = 1), dimension INTEGER NOT NULL, provider TEXT, model TEXT, created_at TEXT NOT NULL)`)
  db.run(sql`INSERT INTO vec_meta (id, dimension, created_at) VALUES (1, 384, ${iso})`)
  return { db, raw, vec0 }
}

const hashes = (db: any) => ({
  vault: (db.all(sql`SELECT embedding_hash AS h FROM vault_index`) as Array<{ h: string | null }>)[0]!.h,
  episodic: (db.all(sql`SELECT embedding_hash AS h FROM episodic_memories`) as Array<{ h: string | null }>)[0]!.h,
})

describe('resetLegacyIndexOnModelSwap', () => {
  it('the first start only records the embedder; nothing is re-embedded', () => {
    const { db } = world()
    expect(resetLegacyIndexOnModelSwap(db, 'multilingual-e5-small@q8/e5-prefix', silentLogger)).toEqual({ reset: false, previous: null })
    expect(getMemoryMeta(db, LEGACY_EMBED_MODEL_META_KEY)).toBe('multilingual-e5-small@q8/e5-prefix')
    expect(hashes(db)).toEqual({ vault: 'vault-hash', episodic: 'epi-hash' })
  })

  it('the same embedder on a later start changes nothing', () => {
    const { db } = world()
    resetLegacyIndexOnModelSwap(db, 'gateway:acme/embed-1')
    expect(resetLegacyIndexOnModelSwap(db, 'gateway:acme/embed-1')).toEqual({ reset: false, previous: 'gateway:acme/embed-1' })
    expect(hashes(db)).toEqual({ vault: 'vault-hash', episodic: 'epi-hash' })
    expect(db.all(sql`SELECT dimension FROM vec_meta`)).toEqual([{ dimension: 384 }])
  })

  it('a changed embedder empties the legacy index so it is re-embedded at the new dimension', () => {
    const { db, vec0 } = world()
    if (vec0) {
      db.run(sql.raw('CREATE VIRTUAL TABLE IF NOT EXISTS vault_vec USING vec0(path TEXT PRIMARY KEY, embedding float[384])'))
      db.run(sql.raw('CREATE VIRTUAL TABLE IF NOT EXISTS episodic_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[384])'))
    }
    resetLegacyIndexOnModelSwap(db, 'stem5-fnv-384')
    expect(resetLegacyIndexOnModelSwap(db, 'gateway:acme/embed-1')).toEqual({ reset: true, previous: 'stem5-fnv-384' })
    expect(hashes(db)).toEqual({ vault: null, episodic: null })
    expect(db.all(sql`SELECT dimension FROM vec_meta`)).toEqual([])
    const tables = (db.all(sql`SELECT name FROM sqlite_master WHERE name IN ('vault_vec', 'episodic_vec')`) as Array<{ name: string }>)
    expect(tables).toEqual([])
    expect(getMemoryMeta(db, LEGACY_EMBED_MODEL_META_KEY)).toBe('gateway:acme/embed-1')
  })

  it('never touches recall\'s L3 vectors', () => {
    const { db } = world()
    const rid = gistRow(db, 'g-1', 'Invoices are approved by the finance lead')
    db.run(sql`INSERT INTO memory_item (id, item_type, created_at) VALUES ('emb-1', 'embedding', 1)`)
    const embRid = (db.all(sql`SELECT rid FROM memory_item WHERE id = 'emb-1'`) as Array<{ rid: number }>)[0]!.rid
    db.run(sql`INSERT INTO memory_embedding (rid, id, owner_type, owner_id, owner_rid, model_id, dimensions, vector, project_key, live_in_index, created_at)
      VALUES (${embRid}, 'emb-1', 'gist', 'g-1', ${rid}, 'stem5-fnv-384', 384, ${Buffer.alloc(384)}, 0, 1, 1)`)
    resetLegacyIndexOnModelSwap(db, 'stem5-fnv-384')
    resetLegacyIndexOnModelSwap(db, 'gateway:acme/embed-1')
    expect(db.all(sql`SELECT owner_id FROM memory_embedding`)).toEqual([{ owner_id: 'g-1' }])
  })
})
