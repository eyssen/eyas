// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { openRawSqlite } from '@core/db/connection'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { isBun } from '@shared/platform'
import { createMemoryV2Tables, allocateRid } from '@modules/memory/v2/schema'
import { embedLayeredBatch, floatToInt8 } from '@modules/memory/v2/l3-embed'
import { createHashEmbedder, hashEmbed } from '@modules/memory/embeddings/hash-embedder'
import { d1PartitionKeys, retrieve } from '@modules/memory/v2/retrieve'
import { silentLogger } from './helpers'

function drizzleOf(raw: unknown): any {
  const { drizzle } = isBun
    ? require('drizzle-orm/bun-sqlite')
    : require('drizzle-orm/better-sqlite3')
  return drizzle(raw)
}

const GOLD = 'Werth helyesbito szamla dontes: MODIFY uses corrected_invoice_id.'

function insertGist(db: any, id: string, text: string): void {
  const now = Date.now()
  const rid = allocateRid(db, 'gist', id, now)
  db.run(sql`INSERT INTO memory_gist (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
    scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score, gist_source,
    is_current, decay_score, presence_tier, multi_project, times_retrieved
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst', ${now}, 0, 1, ${now}, 0,
    'task', 'c1', 0, ${text}, '{}', 0, 'owner', 10, 0.9, 'heuristic',
    1, 1.0, 'hot', 0, 0
  )`)
}

function insertFact(db: any, id: string, subject: string, objectText: string, projectKey = 0): number {
  const now = Date.now()
  const rid = allocateRid(db, 'fact', id, now)
  db.run(sql`INSERT INTO memory_fact (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, subject, predicate, object_text, trust_tier
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst', ${now}, ${now}, ${subject}, 'states', ${objectText}, 'owner'
  )`)
  const blob = floatToInt8(hashEmbed(`${subject} states ${objectText}`))
  db.run(sql`INSERT INTO memory_embedding (
    rid, id, owner_type, owner_id, owner_rid, model_id, dimensions, vector, project_key, live_in_index, created_at
  ) VALUES (
    ${rid}, ${`emb-${id}`}, 'fact', ${id}, ${rid}, 'stem5-fnv-384', 384, ${blob}, ${projectKey}, 1, ${now}
  )`)
  return rid
}

describe('d1PartitionKeys', () => {
  it('always includes global 0 and looks up project ∪ project_type keys', () => {
    const db = createMemoryDb()
    probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
    expect(d1PartitionKeys(db, null, null)).toEqual([0])
    db.run(sql`INSERT INTO memory_partition_key (scope_type, scope_id) VALUES ('project', 'p1')`)
    db.run(sql`INSERT INTO memory_partition_key (scope_type, scope_id) VALUES ('project_type', 't1')`)
    const keys = d1PartitionKeys(db, 'p1', 't1')
    expect(keys[0]).toBe(0)
    expect(keys).toContain(1)
    expect(keys).toContain(2)
    expect(d1PartitionKeys(db, 'missing', null)).toEqual([0])
  })
})

const vecOk = probeSqliteCapabilities(getRawFromDrizzle(createMemoryDb())).vec0

describe.skipIf(!vecOk)('L3 KNN on a live sqlite-vec connection', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    for (const d of tmpDirs) {
      try { rmSync(d, { recursive: true, force: true }) } catch { /* */ }
    }
    tmpDirs.length = 0
  })

  it('warns (not debug) when prepare throws', async () => {
    const db = createMemoryDb()
    const raw = getRawFromDrizzle(db)
    const caps = probeSqliteCapabilities(raw)
    createMemoryV2Tables(db, caps)
    raw.exec('DROP TABLE IF EXISTS memory_embedding_vec')
    const warn = (obj: unknown, msg?: string) => { calls.push({ obj, msg }) }
    const calls: Array<{ obj: unknown; msg?: string }> = []
    insertGist(db, 'g-gold', GOLD)
    await retrieve({
      db, rawDb: raw, bridge: createHashEmbedder(),
      logger: { ...silentLogger, warn, debug: () => { throw new Error('KNN must not swallow into debug') } },
    }, { query: GOLD, language: 'hu' })
    expect(calls.some((c) => String(c.msg ?? '').includes('L3 KNN'))).toBe(true)
  })

  it('loads sqlite-vec on a second connection (the smoke that used to be FTS-only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-knn-'))
    tmpDirs.push(dir)
    const path = join(dir, 'm.db')
    const raw1 = openRawSqlite(path)
    const caps = probeSqliteCapabilities(raw1)
    const db1 = drizzleOf(raw1)
    createMemoryV2Tables(db1, caps)
    insertGist(db1, 'g-gold', GOLD)
    await embedLayeredBatch({ db: db1, rawDb: raw1, bridge: createHashEmbedder(), logger: silentLogger })
    raw1.close()

    const raw2 = openRawSqlite(path)
    const db2 = drizzleOf(raw2)
    const hits = await retrieve({
      db: db2, rawDb: raw2, bridge: createHashEmbedder(), logger: silentLogger,
    }, { query: GOLD, language: 'hu' })
    expect(hits.some((h) => h.source === 'gist' && h.id.includes('g-gold'))).toBe(true)
    raw2.close()
  })

  it('filters live_in_index next to MATCH — a cold vec0 row is not returned', async () => {
    const db = createMemoryDb()
    const raw = getRawFromDrizzle(db)
    const caps = probeSqliteCapabilities(raw)
    createMemoryV2Tables(db, caps)
    const liveRid = insertFact(db, 'f-live', 'Werth', GOLD, 0)
    const coldRid = insertFact(db, 'f-cold', 'Werth', GOLD, 0)
    raw.prepare('INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))')
      .run(liveRid, 0, floatToInt8(hashEmbed(`Werth states ${GOLD}`)))
    raw.prepare('INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))')
      .run(coldRid, 0, floatToInt8(hashEmbed(`Werth states ${GOLD}`)))
    db.run(sql`UPDATE memory_embedding SET live_in_index = 0 WHERE rid = ${coldRid}`)
    const hits = await retrieve({
      db, rawDb: raw, bridge: createHashEmbedder(), logger: silentLogger,
    }, { query: GOLD, language: 'hu' })
    expect(hits.some((h) => h.id === 'ft:f-live')).toBe(true)
    expect(hits.some((h) => h.id === 'ft:f-cold')).toBe(false)
  })

  it('restricts KNN to the D1 partition set (global ∪ project ∪ type), not other projects', async () => {
    const db = createMemoryDb()
    const raw = getRawFromDrizzle(db)
    const caps = probeSqliteCapabilities(raw)
    createMemoryV2Tables(db, caps)
    db.run(sql`INSERT INTO memory_partition_key (scope_type, scope_id) VALUES ('project', 'p1')`)
    db.run(sql`INSERT INTO memory_partition_key (scope_type, scope_id) VALUES ('project', 'p9')`)
    const p1 = (db.all(sql`SELECT project_key AS k FROM memory_partition_key WHERE scope_id = 'p1'`) as Array<{ k: number }>)[0].k
    const p9 = (db.all(sql`SELECT project_key AS k FROM memory_partition_key WHERE scope_id = 'p9'`) as Array<{ k: number }>)[0].k
    const home = insertFact(db, 'f-home', 'Werth', GOLD, p1)
    const other = insertFact(db, 'f-other', 'Werth', GOLD, p9)
    const ins = raw.prepare('INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))')
    const blob = floatToInt8(hashEmbed(`Werth states ${GOLD}`))
    ins.run(home, p1, blob)
    ins.run(other, p9, blob)
    const hits = await retrieve({
      db, rawDb: raw, bridge: createHashEmbedder(), logger: silentLogger,
    }, { query: GOLD, language: 'hu', projectId: 'p1' })
    expect(hits.some((h) => h.id === 'ft:f-home')).toBe(true)
    expect(hits.some((h) => h.id === 'ft:f-other')).toBe(false)
  })
})
