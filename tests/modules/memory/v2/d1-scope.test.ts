// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J1 — the D1 scope: a conversation recalls its own project, that project's
// type and global memory, never another project; a null project means global
// only (fail closed). The same rule on every reader: the L3 partition a vector
// is filed under, KNN, hydrate, memory_expand and the standing index.

import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createHashEmbedder, hashEmbed } from '@modules/memory/embeddings/hash-embedder'
import { embedLayeredBatch, floatToInt8 } from '@modules/memory/v2/l3-embed'
import { retrieve } from '@modules/memory/v2/retrieve'
import { expandMemoryId } from '@modules/memory/v2/expand'
import { assembleRecall } from '@modules/memory/v2/assemble'
import { d1Keys, ensurePartitionKey, ownerInD1, partitionKeyForOwner } from '@modules/memory/v2/d1'
import { runL3Repartition, L3_PARTITION_META_KEY } from '@modules/memory/v2/l3-repartition'
import { getMemoryMeta } from '@modules/memory/v2/schema'
import { makeD1Db, gistRow, factRow, vaultRow, rawRow, episodeRow } from './d1-fixtures'
import { silentLogger } from './helpers'

// rawRow writes its blob: a raw row opens as its own text (J4).
beforeAll(async () => { await initZstd() })

const GOLD = 'Northwind invoice correction rule: MODIFY keeps the original invoice number.'

const vec0 = makeD1Db().vec0

function keyOf(db: any, ownerId: string): number {
  return (db.all(sql`SELECT project_key AS k FROM memory_embedding WHERE owner_id = ${ownerId}`) as Array<{ k: number }>)[0].k
}

describe('partition keys (L3 is filed under the owner\'s D1 scope)', () => {
  it('files a project gist under the project, a type gist under the type, a global gist under 0', async () => {
    const { db } = makeD1Db()
    gistRow(db, 'g-p', 'Home project decision', { project: 'P', projectType: 'T' })
    gistRow(db, 'g-t', 'Type-wide convention', { projectType: 'T' })
    gistRow(db, 'g-global', 'Global owner preference')
    await embedLayeredBatch({ db, bridge: createHashEmbedder(), logger: silentLogger })
    const p = ensurePartitionKey(db, 'project', 'P')
    const t = ensurePartitionKey(db, 'project_type', 'T')
    expect(p).toBeGreaterThan(0)
    expect(t).not.toBe(p)
    expect(keyOf(db, 'g-p')).toBe(p)
    expect(keyOf(db, 'g-t')).toBe(t)
    expect(keyOf(db, 'g-global')).toBe(0)
  })

  it('a project-scope gist without tags is filed by its own scope', () => {
    const { db } = makeD1Db()
    const rid = gistRow(db, 'g-root', 'Project Q overview', { scopeType: 'project', scopeId: 'Q' })
    expect(partitionKeyForOwner(db, rid)).toBe(ensurePartitionKey(db, 'project', 'Q'))
  })

  it('d1Keys never creates a key: a scope that embedded nothing adds nothing', () => {
    const { db } = makeD1Db()
    expect(d1Keys(db, 'P', 'T')).toEqual([0])
    expect((db.all(sql`SELECT COUNT(*) AS n FROM memory_partition_key`) as Array<{ n: number }>)[0].n).toBe(0)
  })
})

describe('ownerInD1', () => {
  it('admits own project, own type and global; refuses another project and another type', () => {
    const { db } = makeD1Db()
    const own = gistRow(db, 'g-p', 'x', { project: 'P', projectType: 'T' })
    const type = gistRow(db, 'g-t', 'x', { projectType: 'T' })
    const global = gistRow(db, 'g-g', 'x')
    const other = gistRow(db, 'g-q', 'x', { project: 'Q', projectType: 'T' })
    const otherType = gistRow(db, 'g-t2', 'x', { projectType: 'T2' })
    const otherRoot = gistRow(db, 'g-qroot', 'x', { scopeType: 'project', scopeId: 'Q' })
    const scope = { projectId: 'P', projectTypeId: 'T' }
    expect(ownerInD1(db, own, scope)).toBe(true)
    expect(ownerInD1(db, type, scope)).toBe(true)
    expect(ownerInD1(db, global, scope)).toBe(true)
    expect(ownerInD1(db, other, scope)).toBe(false)
    expect(ownerInD1(db, otherType, scope)).toBe(false)
    expect(ownerInD1(db, otherRoot, scope)).toBe(false)
  })

  it('a null project admits global rows only', () => {
    const { db } = makeD1Db()
    const scope = { projectId: null, projectTypeId: null }
    expect(ownerInD1(db, gistRow(db, 'g-g', 'x'), scope)).toBe(true)
    expect(ownerInD1(db, gistRow(db, 'g-p', 'x', { project: 'P' }), scope)).toBe(false)
    expect(ownerInD1(db, gistRow(db, 'g-t', 'x', { projectType: 'T' }), scope)).toBe(false)
  })
})

describe('expand is locked to D1 on every branch', () => {
  it('refuses a project-Q gist or fact from project P, opens P\'s own and global ones', () => {
    const { db } = makeD1Db()
    gistRow(db, 'g-q', 'Q secret plan', { project: 'Q', projectType: 'T' })
    factRow(db, 'f-q', 'Q', 'uses a private supplier', { project: 'Q', projectType: 'T' })
    gistRow(db, 'g-p', 'P plan', { project: 'P', projectType: 'T' })
    factRow(db, 'f-g', 'Owner', 'writes in Hungarian')
    const fromP = { projectId: 'P', projectTypeId: 'T' }
    expect(expandMemoryId(db, 'gs:g-q', fromP)).toBeNull()
    expect(expandMemoryId(db, 'ft:f-q', fromP)).toBeNull()
    expect(expandMemoryId(db, 'gs:g-p', fromP)?.content).toBe('P plan')
    expect(expandMemoryId(db, 'ft:f-g', fromP)?.content).toBe('Owner states writes in Hungarian')
  })

  it('with a null project, every project-tagged gs/ft/vt/rw/ep id returns null; global ones open', () => {
    const { db } = makeD1Db()
    gistRow(db, 'g-p', 'P plan', { project: 'P' })
    factRow(db, 'f-p', 'P', 'ships on Fridays', { project: 'P' })
    vaultRow(db, 'projects/p/note.md', 'P vault note', 'P')
    rawRow(db, 'r-p', 'P')
    episodeRow(db, 'e-p', 'P episode', 'P')
    gistRow(db, 'g-g', 'Global plan')
    vaultRow(db, 'semantic/global.md', 'Global vault note')
    rawRow(db, 'r-g', null)
    episodeRow(db, 'e-g', 'Global episode', null)
    const none = { projectId: null, projectTypeId: null }
    for (const id of ['gs:g-p', 'ft:f-p', 'vt:projects/p/note.md', 'rw:r-p', 'ep:e-p']) {
      expect(expandMemoryId(db, id, none), id).toBeNull()
    }
    for (const id of ['gs:g-g', 'vt:semantic/global.md', 'rw:r-g', 'ep:e-g']) {
      expect(expandMemoryId(db, id, none), id).not.toBeNull()
    }
  })

  it('opens a type note only for a project of that type', () => {
    const { db } = makeD1Db()
    vaultRow(db, 'types/t/rule.md', 'Type T rule', null, 'T')
    expect(expandMemoryId(db, 'vt:types/t/rule.md', { projectId: 'P' })).not.toBeNull() // type looked up: T
    expect(expandMemoryId(db, 'vt:types/t/rule.md', { projectId: 'R' })).toBeNull() // type T2
    expect(expandMemoryId(db, 'vt:types/t/rule.md', { projectId: null })).toBeNull()
  })
})

describe('retrieve (FTS) is locked to D1', () => {
  it('a projectless query no longer sees another project\'s vault notes', async () => {
    const { db } = makeD1Db()
    vaultRow(db, 'projects/q/northwind.md', `${GOLD} (Q copy)`, 'Q')
    vaultRow(db, 'semantic/northwind.md', GOLD)
    const hits = await retrieve({ db, logger: silentLogger }, { query: GOLD, projectId: null, language: 'en' })
    const ids = hits.map((h) => h.id)
    expect(ids).toContain('vt:semantic/northwind.md')
    expect(ids).not.toContain('vt:projects/q/northwind.md')
  })

  it('a project query sees its own and its type\'s notes, not another type\'s', async () => {
    const { db } = makeD1Db()
    vaultRow(db, 'projects/p/northwind.md', `${GOLD} (P copy)`, 'P')
    vaultRow(db, 'types/t/northwind.md', `${GOLD} (type T)`, null, 'T')
    vaultRow(db, 'types/t2/northwind.md', `${GOLD} (type T2)`, null, 'T2')
    vaultRow(db, 'projects/q/northwind.md', `${GOLD} (Q copy)`, 'Q')
    const ids = (await retrieve({ db, logger: silentLogger }, { query: GOLD, projectId: 'P', language: 'en' })).map((h) => h.id)
    expect(ids).toContain('vt:projects/p/northwind.md')
    expect(ids).toContain('vt:types/t/northwind.md')
    expect(ids).not.toContain('vt:types/t2/northwind.md')
    expect(ids).not.toContain('vt:projects/q/northwind.md')
  })
})

describe.skipIf(!vec0)('KNN on sqlite-vec is locked to D1', () => {
  it('from P returns P and global gists, never Q; from no project, global only', async () => {
    const { db, raw } = makeD1Db()
    gistRow(db, 'g-p', `${GOLD} P`, { project: 'P', projectType: 'T' })
    gistRow(db, 'g-g', `${GOLD} global`)
    gistRow(db, 'g-q', `${GOLD} Q`, { project: 'Q', projectType: 'T' })
    await embedLayeredBatch({ db, rawDb: raw, bridge: createHashEmbedder(), logger: silentLogger })
    const bridge = createHashEmbedder()
    const fromP = (await retrieve({ db, rawDb: raw, bridge, logger: silentLogger }, { query: GOLD, projectId: 'P', language: 'en' })).map((h) => h.id)
    expect(fromP).toContain('gs:g-p')
    expect(fromP).toContain('gs:g-g')
    expect(fromP).not.toContain('gs:g-q')
    const fromNone = (await retrieve({ db, rawDb: raw, bridge, logger: silentLogger }, { query: GOLD, projectId: null, language: 'en' })).map((h) => h.id)
    expect(fromNone).toContain('gs:g-g')
    expect(fromNone).not.toContain('gs:g-p')
    expect(fromNone).not.toContain('gs:g-q')
  })

  it('hydrate refuses a Q gist even while its legacy vector still sits in the global partition', async () => {
    const { db, raw } = makeD1Db()
    const rid = gistRow(db, 'g-q', `${GOLD} Q`, { project: 'Q' })
    legacyVector(db, raw, 'g-q', rid, `${GOLD} Q`, 0)
    const ids = (await retrieve({ db, rawDb: raw, bridge: createHashEmbedder(), logger: silentLogger }, { query: GOLD, projectId: 'P', language: 'en' })).map((h) => h.id)
    expect(ids).not.toContain('gs:g-q')
  })
})

/** A vector written the pre-D1 way: memory_embedding + vec0 row under `key`. */
function legacyVector(db: any, raw: any, ownerId: string, ownerRid: number, text: string, key: number): number {
  const blob = floatToInt8(hashEmbed(text))
  const now = Date.now()
  const id = `emb-${ownerId}`
  db.run(sql`INSERT INTO memory_item (item_type, id, created_at) VALUES ('embedding', ${id}, ${now})`)
  const rid = (db.all(sql`SELECT rid FROM memory_item WHERE id = ${id}`) as Array<{ rid: number }>)[0].rid
  db.run(sql`INSERT INTO memory_embedding (rid, id, owner_type, owner_id, owner_rid, model_id, dimensions, vector, project_key, live_in_index, created_at)
    VALUES (${rid}, ${id}, 'gist', ${ownerId}, ${ownerRid}, 'stem5-fnv-384', 384, ${blob}, ${key}, 1, ${now})`)
  if (raw) {
    try {
      raw.prepare('INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))').run(rid, key, blob)
    } catch { /* vec0 absent */ }
  }
  return rid
}

describe('one-shot repartition of legacy key-0 vectors', () => {
  it('moves each vector to its owner\'s partition, is idempotent, and records it once', () => {
    const { db, raw, vec0: hasVec } = makeD1Db()
    const pRid = gistRow(db, 'g-p', 'P plan', { project: 'P' })
    const gRid = gistRow(db, 'g-g', 'Global plan')
    legacyVector(db, hasVec ? raw : null, 'g-p', pRid, 'P plan', 0)
    legacyVector(db, hasVec ? raw : null, 'g-g', gRid, 'Global plan', 0)

    const first = runL3Repartition({ db, rawDb: hasVec ? raw : undefined, logger: silentLogger }, 1)
    expect(first).toEqual({ rows: 2, moved: 1, failed: 0, skipped: false })
    expect(keyOf(db, 'g-p')).toBe(ensurePartitionKey(db, 'project', 'P'))
    expect(keyOf(db, 'g-g')).toBe(0)
    expect(getMemoryMeta(db, L3_PARTITION_META_KEY)).toBe('1')
    if (hasVec) {
      const vecKey = (raw.prepare('SELECT project_key AS k FROM memory_embedding_vec WHERE rowid = (SELECT rid FROM memory_embedding WHERE owner_id = ?)').all('g-p') as Array<{ k: number }>)[0]?.k
      expect(vecKey).toBe(ensurePartitionKey(db, 'project', 'P'))
    }

    expect(runL3Repartition({ db, rawDb: hasVec ? raw : undefined, logger: silentLogger })).toEqual({ rows: 0, moved: 0, failed: 0, skipped: true })
  })

  it('keeps the old key and retries at the next start when a vec0 row cannot be rewritten', () => {
    const { db, raw, vec0: hasVec } = makeD1Db()
    if (!hasVec) return // the failure path needs a vec0 table to fail on
    const pRid = gistRow(db, 'g-p', 'P plan', { project: 'P' })
    legacyVector(db, raw, 'g-p', pRid, 'P plan', 0)
    const failing = {
      prepare: (s: string) => (s.startsWith('INSERT') ? { run: () => { throw new Error('disk I/O error') } } : raw.prepare(s)),
    }
    const out = runL3Repartition({ db, rawDb: failing, logger: silentLogger })
    expect(out).toMatchObject({ moved: 0, failed: 1, skipped: false })
    expect(keyOf(db, 'g-p')).toBe(0)
    expect(getMemoryMeta(db, L3_PARTITION_META_KEY)).toBeNull()
    // Next start, with a healthy connection: done.
    expect(runL3Repartition({ db, rawDb: raw, logger: silentLogger })).toMatchObject({ moved: 1, failed: 0 })
    expect(keyOf(db, 'g-p')).toBe(ensurePartitionKey(db, 'project', 'P'))
  })
})

describe('assembleRecall carries the index ids unchanged', () => {
  it('logs gs: ids for index gists (never vt:gist:…) and does not repeat an index hit in Retrieved', async () => {
    const { db } = makeD1Db()
    gistRow(db, 'g-p', `${GOLD} home`, { project: 'P', conv: 'c-sibling' })
    gistRow(db, 'g-q', `${GOLD} elsewhere`, { project: 'Q', conv: 'c-q' })
    vaultRow(db, 'semantic/northwind.md', GOLD)
    const out = (await assembleRecall({ db, logger: silentLogger }, {
      query: GOLD, conversationId: 'c-self', scope: { projectId: 'P', projectTypeId: 'T' },
      budgetChars: 8_000, profile: { drillDown: true },
    }))!
    expect(out.ids).toContain('gs:g-p')
    expect(out.ids).toContain('vt:semantic/northwind.md')
    expect(out.ids.some((id) => id.startsWith('vt:gist:'))).toBe(false)
    expect(out.ids).not.toContain('gs:g-q')
    expect(out.content).not.toContain('elsewhere')
    expect(out.ids.filter((id) => id === 'vt:semantic/northwind.md')).toHaveLength(1)
    const logged = db.all(sql`SELECT memory_type, memory_id FROM memory_access_log WHERE memory_id = 'g-p'`) as Array<{ memory_type: string }>
    expect(logged[0]?.memory_type).toBe('gs')
  })
})
