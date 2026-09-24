// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// J5 — the contains-secrets flag travels L0 → facts / gists → L3. A vault note
// or an episodic row tagged contains-secrets keeps its L0 row, the facts and
// gists derived from it and their vectors out of every recall path
// (retrieve, memory_expand, the standing index, L3, the layered legacy search)
// unless the owner opened memory.recall.includeSecrets. The rows of clean
// content stay recallable: a filter mistake would hide them, so every case
// checks both directions. Fictive content and credentials throughout.

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createWikilinkService } from '@shared/wikilinks'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createArchiveMemoryService } from '@modules/memory/tiers/archive-memory'
import { createMemoryService } from '@modules/memory/memory-service'
import { buildMemoryIndex } from '@modules/memory/memory-index'
import { createHashEmbedder } from '@modules/memory/embeddings/hash-embedder'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { runExtraction } from '@modules/memory/v2/extractor'
import { migrateImportedIntoL0, vaultConversationId, vaultNoteHoldsSecrets } from '@modules/memory/v2/migrate-imported'
import { retrieve } from '@modules/memory/v2/retrieve'
import { expandMemoryId } from '@modules/memory/v2/expand'
import { embedLayeredBatch } from '@modules/memory/v2/l3-embed'
import { arbitrate, type ArbitrationScope } from '@modules/memory/v2/arbitrate'
import { markSecrets, SECRETS_TAG, SECRETS_TAG_TYPE } from '@modules/memory/v2/d1'
import { runSecretsBackfill, SECRETS_BACKFILL_META_KEY } from '@modules/memory/v2/secrets-backfill'
import { getMemoryMeta } from '@modules/memory/v2/schema'
import type { ExtractionCandidate } from '@modules/memory/v2/extract/deterministic'
import type { VaultFrontmatter } from '@modules/memory/types'
import { makeD1Db, gistRow } from './d1-fixtures'
import { makeV2Db, makeUnit, silentLogger, testIngestConfig } from './helpers'
import { seedRawRow } from './extract-helpers'

const SECRET_PATH = 'semantic/zephyr-access.md'
const CLEAN_PATH = 'semantic/zephyr-routine.md'
const SECRET_BODY = 'Zephyr staging password: quasar-7731-lumen\nThe zephyr staging maintenance window uses the quasar credential.\n'
const CLEAN_BODY = 'Zephyr staging maintenance runs the release checklist before every zephyr deploy window.\n'
const SECRET_EPISODE = 'Harbor gateway key: tidal-9921-orca\nThe harbor gateway maintenance uses the tidal key.'
const CLEAN_EPISODE = 'Harbor gateway maintenance happens on Tuesdays for the harbor team.'
const QUERY = 'zephyr staging maintenance window'

beforeAll(async () => { await initZstd() })

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fm = (over: Partial<VaultFrontmatter> = {}): VaultFrontmatter => ({
  title: 'Note', tags: [], tier: 'semantic', links: [], created: '2026-09-01', updated: '2026-09-01', ...over,
})

interface World {
  db: any
  raw: any
  vec0: boolean
  ingest: MemoryIngest
  vault: ReturnType<typeof createVaultService>
  indexer: ReturnType<typeof createVaultIndexer>
}

/** Legacy + v2 tables, an L0 ingest whose flush runs extraction (as wire.ts does), a temp vault. */
function makeWorld(): World {
  const { db, raw, vec0 } = makeD1Db()
  const ingest = createMemoryIngest({
    db, caps: probeSqliteCapabilities(raw), config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger,
  })
  ingest.onFlushed((conversationId, reason) => {
    runExtraction(db, conversationId, reason, { logger: silentLogger, config: () => ({ engine: 'legacy', extractInLegacy: true }) })
  })
  const root = mkdtempSync(join(tmpdir(), 'eyas-secrets-recall-'))
  roots.push(root)
  const vault = createVaultService(root)
  const wikilinks = createWikilinkService(db)
  wikilinks.init()
  const indexer = createVaultIndexer(db, vault, wikilinks)
  return { db, raw, vec0, ingest, vault, indexer }
}

function episode(db: any, id: string, content: string, tags: string[]): void {
  db.run(sql`INSERT INTO episodic_memories (id, content, source_type, valid_from, created_at, tags)
    VALUES (${id}, ${content}, 'import', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', ${JSON.stringify(tags)})`)
}

/** Two vault notes and two episodic rows — one of each tagged contains-secrets unless `tagged` is false — migrated into L0 and extracted. */
async function seedScene(w: World, tagged = true): Promise<void> {
  w.vault.write(SECRET_PATH, fm({ title: 'Zephyr access', tags: tagged ? [SECRETS_TAG] : [] }), SECRET_BODY)
  w.vault.write(CLEAN_PATH, fm({ title: 'Zephyr routine' }), CLEAN_BODY)
  w.indexer.indexAll()
  episode(w.db, 'ep-secret', SECRET_EPISODE, tagged ? [SECRETS_TAG] : [])
  episode(w.db, 'ep-clean', CLEAN_EPISODE, [])
  await migrateImportedIntoL0({ db: w.db, ingest: w.ingest, vault: w.vault, logger: silentLogger })
}

function isMarked(db: any, rid: number): boolean {
  return (db.all(sql`SELECT 1 AS ok FROM memory_tag WHERE memory_rid = ${rid}
    AND tag_type = ${SECRETS_TAG_TYPE} AND tag_value = ${SECRETS_TAG}`) as unknown[]).length > 0
}

interface Derived {
  raw: Array<{ id: string; rid: number }>
  facts: Array<{ id: string; rid: number }>
  gist: { id: string; rid: number }
}

/** The L0 rows of one pseudo-conversation, the live facts derived from them, and its current task gist. */
function derived(db: any, conversationId: string): Derived {
  const raw = db.all(sql`SELECT id, rid FROM memory_raw WHERE conversation_id = ${conversationId}`) as Derived['raw']
  const facts = db.all(sql`SELECT DISTINCT f.id, f.rid FROM memory_fact f
    JOIN memory_fact_source s ON s.fact_id = f.id
    JOIN memory_raw r ON r.id = s.episode_id
    WHERE r.conversation_id = ${conversationId} AND f.tombstoned = 0 AND f.valid_until IS NULL`) as Derived['facts']
  const gist = (db.all(sql`SELECT id, rid FROM memory_gist
    WHERE scope_type = 'task' AND scope_id = ${conversationId} AND is_current = 1`) as Array<Derived['gist']>)[0]
  expect(raw.length, `raw rows of ${conversationId}`).toBeGreaterThan(0)
  expect(facts.length, `facts of ${conversationId}`).toBeGreaterThan(0)
  expect(gist, `gist of ${conversationId}`).toBeDefined()
  return { raw, facts, gist }
}

const secretNote = (db: any) => derived(db, vaultConversationId(SECRET_PATH))
const cleanNote = (db: any) => derived(db, vaultConversationId(CLEAN_PATH))
const secretEpisode = (db: any) => derived(db, 'legacy-episodic:ep-secret')
const cleanEpisode = (db: any) => derived(db, 'legacy-episodic:ep-clean')

/** Every recall id (rw:/ft:/gs:) of a derived set. */
function idsOf(d: Derived): string[] {
  return [...d.raw.map((r) => `rw:${r.id}`), ...d.facts.map((f) => `ft:${f.id}`), `gs:${d.gist.id}`]
}

function everyRow(d: Derived): number[] {
  return [...d.raw.map((r) => r.rid), ...d.facts.map((f) => f.rid), d.gist.rid]
}

describe('write-time propagation: L0 → facts → gists', () => {
  it('marks the L0 row, every fact and the gist of a tagged note or episodic row, and nothing of clean ones', async () => {
    const w = makeWorld()
    await seedScene(w)
    for (const rid of [...everyRow(secretNote(w.db)), ...everyRow(secretEpisode(w.db))]) expect(isMarked(w.db, rid), `rid ${rid}`).toBe(true)
    for (const rid of [...everyRow(cleanNote(w.db)), ...everyRow(cleanEpisode(w.db))]) expect(isMarked(w.db, rid), `rid ${rid}`).toBe(false)
  })
})

describe('recall leaves secret-derived rows out by default', () => {
  it('retrieve (FTS) never returns the raw row of a tagged note; the clean note still comes back; includeSecrets shows it', async () => {
    const w = makeWorld()
    await seedScene(w)
    const hidden = (await retrieve({ db: w.db, logger: silentLogger }, { query: QUERY, projectId: null, language: 'en' })).map((h) => h.id)
    for (const id of idsOf(secretNote(w.db))) expect(hidden).not.toContain(id)
    expect(hidden).not.toContain(`vt:${SECRET_PATH}`)
    expect(hidden.some((id) => cleanNote(w.db).raw.some((r) => id === `rw:${r.id}`)) || hidden.includes(`vt:${CLEAN_PATH}`)).toBe(true)

    const shown = (await retrieve({ db: w.db, logger: silentLogger }, { query: QUERY, projectId: null, language: 'en', includeSecrets: true })).map((h) => h.id)
    expect(shown).toContain(`vt:${SECRET_PATH}`)
    // A note comes back once, as the note: never also as its L0 row (J4).
    expect(shown.some((id) => secretNote(w.db).raw.some((r) => id === `rw:${r.id}`))).toBe(false)
  })

  it('memory_expand refuses every rw:/ft:/gs: id derived from a tagged note or episode; includeSecrets opens them', async () => {
    const w = makeWorld()
    await seedScene(w)
    const none = { projectId: null, projectTypeId: null }
    for (const id of [...idsOf(secretNote(w.db)), ...idsOf(secretEpisode(w.db))]) {
      expect(expandMemoryId(w.db, id, none), id).toBeNull()
      expect(expandMemoryId(w.db, id, { ...none, includeSecrets: true }), id).not.toBeNull()
    }
    for (const id of [...idsOf(cleanNote(w.db)), ...idsOf(cleanEpisode(w.db))]) {
      expect(expandMemoryId(w.db, id, none), id).not.toBeNull()
    }
  })

  it('a fact derived from a tagged note is recallable once includeSecrets is on', async () => {
    const w = makeWorld()
    await seedScene(w)
    const fact = secretNote(w.db).facts[0]
    expect(expandMemoryId(w.db, `ft:${fact.id}`, { projectId: null })).toBeNull()
    expect(expandMemoryId(w.db, `ft:${fact.id}`, { projectId: null, includeSecrets: true })?.content).toMatch(/zephyr|quasar/i)
  })

  it('a clean raw row of a task whose gist is secret-derived opens as its own text, without the gist', () => {
    const { db } = makeV2Db()
    seedRawRow(db, { id: 'r-clean', conversationId: 'c-mixed', content: 'plain line', blob: true })
    const gistRid = gistRow(db, 'g-mixed', 'Harbor gateway key is tidal-9921-orca', { conv: 'c-mixed' })
    markSecrets(db, gistRid, 'gist')
    const hidden = expandMemoryId(db, 'rw:r-clean', { projectId: null })!
    expect(hidden.content).toBe('plain line')
    expect(JSON.stringify(hidden)).not.toContain('tidal-9921-orca')
    const shown = expandMemoryId(db, 'rw:r-clean', { projectId: null, includeSecrets: true })!
    expect(shown.content).toBe('plain line')
    expect(shown.metadata.taskGist).toContain('tidal-9921-orca')
  })

  it('an entity expansion lists only facts that are not secret-derived', () => {
    const { db } = makeD1Db()
    db.run(sql`INSERT INTO memory_item (item_type, id, created_at) VALUES ('entity', 'e-harbor', 1)`)
    const erid = (db.all(sql`SELECT rid FROM memory_item WHERE id = 'e-harbor'`) as Array<{ rid: number }>)[0].rid
    db.run(sql`INSERT INTO memory_entity (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, canonical_name, entity_type)
      VALUES (${erid}, 'e-harbor', 'h', 'inst', 1, 1, 'Harbor', 'proper')`)
    const add = (id: string, object: string): number => {
      db.run(sql`INSERT INTO memory_item (item_type, id, created_at) VALUES ('fact', ${id}, 2)`)
      const rid = (db.all(sql`SELECT rid FROM memory_item WHERE id = ${id}`) as Array<{ rid: number }>)[0].rid
      db.run(sql`INSERT INTO memory_fact (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, subject, predicate, object_text, trust_tier, entity_id)
        VALUES (${rid}, ${id}, ${`h-${id}`}, 'inst', 2, 2, 'Harbor', 'is', ${object}, 'owner', 'e-harbor')`)
      return rid
    }
    add('f-open', 'maintained on Tuesdays')
    markSecrets(db, add('f-key', 'unlocked by tidal-9921-orca'), 'fact')
    const hidden = expandMemoryId(db, 'en:e-harbor', { projectId: null })!
    expect(hidden.content).toContain('maintained on Tuesdays')
    expect(hidden.content).not.toContain('tidal-9921-orca')
    expect(expandMemoryId(db, 'en:e-harbor', { projectId: null, includeSecrets: true })!.content).toContain('tidal-9921-orca')
  })

  it('the standing index leaves out the gist of a tagged episode and keeps the clean one', async () => {
    const w = makeWorld()
    await seedScene(w)
    const secretGist = `gs:${secretEpisode(w.db).gist.id}`
    const cleanGist = `gs:${cleanEpisode(w.db).gist.id}`
    const hidden = buildMemoryIndex(w.db, { projectId: null, conversationId: 'c-now' })!
    expect(hidden.ids).not.toContain(secretGist)
    expect(hidden.ids).toContain(cleanGist)
    expect(hidden.content).not.toContain('tidal-9921-orca')
    const shown = buildMemoryIndex(w.db, { projectId: null, conversationId: 'c-now', includeSecrets: true })!
    expect(shown.ids).toContain(secretGist)
  })

  it('L3 never embeds a secret-derived gist or fact by default; includeSecrets embeds them', async () => {
    const w = makeWorld()
    await seedScene(w)
    const embedded = () => new Set((w.db.all(sql`SELECT owner_id FROM memory_embedding`) as Array<{ owner_id: string }>).map((r) => r.owner_id))
    const bridge = createHashEmbedder()
    while (true) {
      const b = await embedLayeredBatch({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger })
      if (b.gists + b.facts === 0) break
    }
    const secretOwners = [secretNote(w.db), secretEpisode(w.db)].flatMap((d) => [d.gist.id, ...d.facts.map((f) => f.id)])
    const cleanOwners = [cleanNote(w.db), cleanEpisode(w.db)].flatMap((d) => [d.gist.id, ...d.facts.map((f) => f.id)])
    for (const id of secretOwners) expect(embedded().has(id), id).toBe(false)
    for (const id of cleanOwners) expect(embedded().has(id), id).toBe(true)

    await embedLayeredBatch({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger, includeSecrets: true })
    for (const id of secretOwners) expect(embedded().has(id), id).toBe(true)
  })

  it('the layered legacy search (memory_search fallback, GET /memory/search) drops secret-derived rw:/gs:/ft: hits', async () => {
    const w = makeWorld()
    await seedScene(w)
    const service = createMemoryService({
      working: createWorkingMemoryService(w.db, { ttlHours: 24, maxTokensPerBlock: 500 }),
      episodic: createEpisodicMemoryService(w.db),
      archive: createArchiveMemoryService(w.db),
      vault: w.vault,
      indexer: w.indexer,
      db: w.db,
    })
    // Search results carry the bare id (the rw:/gs:/ft: prefix is stripped).
    const bare = (ids: string[]) => ids.map((id) => id.slice(3))
    const secretIds = bare([...idsOf(secretNote(w.db)), ...idsOf(secretEpisode(w.db))])
    const cleanIds = bare([...idsOf(cleanNote(w.db)), ...idsOf(cleanEpisode(w.db))])
    const query = 'zephyr staging password quasar'
    const hidden = await service.search({ query, limit: 50 })
    for (const id of secretIds) expect(hidden.map((r) => r.id)).not.toContain(id)
    expect(hidden.some((r) => cleanIds.includes(r.id))).toBe(true)
    expect(hidden.map((r) => r.content).join('\n')).not.toContain('quasar-7731-lumen')
    const shown = await service.search({ query, limit: 50, includeSecrets: true })
    expect(shown.some((r) => secretIds.includes(r.id))).toBe(true)
    expect(shown.map((r) => r.content).join('\n')).toContain('quasar-7731-lumen')
  })
})

describe.skipIf(!makeD1Db().vec0)('KNN on sqlite-vec', () => {
  it('a vector of a secret-derived owner never comes back unless includeSecrets', async () => {
    const w = makeWorld()
    await seedScene(w)
    const bridge = createHashEmbedder()
    // Vectors exist for every owner (as after an install that had includeSecrets on).
    await embedLayeredBatch({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger, includeSecrets: true })
    const secret = secretNote(w.db)
    const secretOwnerIds = [`gs:${secret.gist.id}`, ...secret.facts.map((f) => `ft:${f.id}`)]
    const query = 'Zephyr staging password quasar-7731-lumen'
    const hidden = (await retrieve({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger }, { query, projectId: null, language: 'en' })).map((h) => h.id)
    for (const id of secretOwnerIds) expect(hidden).not.toContain(id)
    const shown = (await retrieve({ db: w.db, rawDb: w.raw, bridge, logger: silentLogger }, { query, projectId: null, language: 'en', includeSecrets: true })).map((h) => h.id)
    expect(shown.some((id) => secretOwnerIds.includes(id))).toBe(true)
  })
})

describe('secrets backfill (rows written before the marker existed)', () => {
  /** L0 and derived rows written untagged, then the note and the episode tagged afterwards. */
  async function legacyScene(): Promise<World> {
    const w = makeWorld()
    await seedScene(w, false)
    for (const rid of everyRow(secretNote(w.db))) expect(isMarked(w.db, rid)).toBe(false)
    w.db.run(sql`UPDATE vault_index SET tags = ${JSON.stringify([SECRETS_TAG])} WHERE path = ${SECRET_PATH}`)
    w.db.run(sql`UPDATE episodic_memories SET tags = ${JSON.stringify(['imported', SECRETS_TAG])} WHERE id = 'ep-secret'`)
    return w
  }

  it('marks the L0 rows, facts and gists of tagged sources and nothing else', async () => {
    const w = await legacyScene()
    const result = runSecretsBackfill({ db: w.db, logger: silentLogger })
    expect(result.skipped).toBe(false)
    expect(result.sources).toBe(2)
    expect(result.raw).toBeGreaterThanOrEqual(2)
    expect(result.facts).toBeGreaterThanOrEqual(2)
    expect(result.gists).toBeGreaterThanOrEqual(2)
    for (const rid of [...everyRow(secretNote(w.db)), ...everyRow(secretEpisode(w.db))]) expect(isMarked(w.db, rid), `rid ${rid}`).toBe(true)
    for (const rid of [...everyRow(cleanNote(w.db)), ...everyRow(cleanEpisode(w.db))]) expect(isMarked(w.db, rid), `rid ${rid}`).toBe(false)
    for (const id of idsOf(secretEpisode(w.db))) expect(expandMemoryId(w.db, id, { projectId: null }), id).toBeNull()
  })

  it('is idempotent: a second start with the same tagged set does nothing', async () => {
    const w = await legacyScene()
    runSecretsBackfill({ db: w.db })
    const marks = () => (w.db.all(sql`SELECT COUNT(*) AS n FROM memory_tag WHERE tag_type = ${SECRETS_TAG_TYPE}`) as Array<{ n: number }>)[0].n
    const before = marks()
    const print = getMemoryMeta(w.db, SECRETS_BACKFILL_META_KEY)
    expect(print).toMatch(/^[0-9a-f]{64}$/)
    expect(runSecretsBackfill({ db: w.db })).toEqual({ skipped: true, sources: 2, raw: 0, facts: 0, gists: 0 })
    expect(marks()).toBe(before)
    expect(getMemoryMeta(w.db, SECRETS_BACKFILL_META_KEY)).toBe(print)
  })

  it('runs again when a further source is tagged later', async () => {
    const w = await legacyScene()
    runSecretsBackfill({ db: w.db })
    for (const rid of everyRow(cleanEpisode(w.db))) expect(isMarked(w.db, rid)).toBe(false)
    w.db.run(sql`UPDATE episodic_memories SET tags = ${JSON.stringify([SECRETS_TAG])} WHERE id = 'ep-clean'`)
    const again = runSecretsBackfill({ db: w.db })
    expect(again.skipped).toBe(false)
    expect(again.sources).toBe(3)
    for (const rid of everyRow(cleanEpisode(w.db))) expect(isMarked(w.db, rid)).toBe(true)
  })

  it('ignores a tags column that only mentions the tag inside another value', () => {
    const { db } = makeD1Db()
    episode(db, 'ep-lookalike', 'Lookalike episode text', ['not-contains-secrets"'])
    db.run(sql`UPDATE episodic_memories SET tags = '["see \"contains-secrets\" docs"]' WHERE id = 'ep-lookalike'`)
    expect(runSecretsBackfill({ db }).sources).toBe(0)
  })

  it('carries the marker up a gist-of-gists tree, and leaves an unrelated gist alone', () => {
    const { db } = makeD1Db()
    const child = gistRow(db, 'g-child', 'child')
    const parent = gistRow(db, 'g-parent', 'parent', { scopeType: 'topic', scopeId: 'harbor' })
    const root = gistRow(db, 'g-root', 'root', { scopeType: 'era', scopeId: '2026' })
    const other = gistRow(db, 'g-other', 'other')
    markSecrets(db, child, 'gist')
    db.run(sql`INSERT INTO memory_gist_source (gist_id, child_type, child_id) VALUES ('g-parent', 'gist', 'g-child'), ('g-root', 'gist', 'g-parent')`)
    const result = runSecretsBackfill({ db })
    expect(result.gists).toBe(2)
    expect(isMarked(db, parent)).toBe(true)
    expect(isMarked(db, root)).toBe(true)
    expect(isMarked(db, other)).toBe(false)
  })
})

describe('arbitration inherits the marker from ANY source', () => {
  const candidate = (facts: ExtractionCandidate['facts']): ExtractionCandidate => ({
    gist: 'Harbor gateway work.', importance: 0.4, entities: [], topics: ['harbo'], facts,
    language: 'en', gistSource: 'heuristic', heuristicGist: 'Harbor gateway work.',
  })
  const scopeOf = (ids: string[]): ArbitrationScope => ({
    conversationId: 'c1', projectId: null, projectTypeId: null, sourceRawIds: ids, sourceTrustTiers: ids.map(() => 'owner'),
  })
  const rowOf = (db: any, table: 'memory_fact' | 'memory_gist', id: string): number =>
    (db.all(sql.raw(`SELECT rid FROM ${table} WHERE id = '${id}'`)) as Array<{ rid: number }>)[0].rid

  it('a fact from a marked source is marked, a fact from a clean source is not, and the batch gist is marked', () => {
    const { db } = makeV2Db()
    const clean = seedRawRow(db, { conversationId: 'c1' })
    const secret = seedRawRow(db, { conversationId: 'c1' })
    markSecrets(db, secret.rid, 'raw')
    const r = arbitrate(db, candidate([
      { subject: 'gateway key', predicate: 'is', object: 'tidal-9921-orca', sourceRawIds: [secret.id] },
      { subject: 'gateway day', predicate: 'is', object: 'Tuesday', sourceRawIds: [clean.id] },
    ]), scopeOf([clean.id, secret.id]), 'run-1')
    const facts = db.all(sql`SELECT id, rid, object_text FROM memory_fact`) as Array<{ id: string; rid: number; object_text: string }>
    expect(isMarked(db, facts.find((f) => f.object_text === 'tidal-9921-orca')!.rid)).toBe(true)
    expect(isMarked(db, facts.find((f) => f.object_text === 'Tuesday')!.rid)).toBe(false)
    expect(isMarked(db, rowOf(db, 'memory_gist', r.gistId!))).toBe(true)
  })

  it('a gist of clean sources only is not marked', () => {
    const { db } = makeV2Db()
    const a = seedRawRow(db, { conversationId: 'c1' })
    const r = arbitrate(db, candidate([]), scopeOf([a.id]), 'run-1')
    expect(isMarked(db, rowOf(db, 'memory_gist', r.gistId!))).toBe(false)
  })

  it('linking a new marked source to an existing clean fact (content-hash dedup) marks that fact', () => {
    const { db } = makeV2Db()
    const first = seedRawRow(db, { conversationId: 'c1' })
    const later = seedRawRow(db, { conversationId: 'c1' })
    markSecrets(db, later.rid, 'raw')
    const fact = { subject: 'gateway key', predicate: 'is', object: 'tidal-9921-orca' }
    arbitrate(db, candidate([{ ...fact, sourceRawIds: [first.id] }]), scopeOf([first.id]), 'run-1')
    const [row] = db.all(sql`SELECT id, rid FROM memory_fact`) as Array<{ id: string; rid: number }>
    expect(isMarked(db, row.rid)).toBe(false)
    const r = arbitrate(db, candidate([{ ...fact, sourceRawIds: [later.id] }]), scopeOf([later.id]), 'run-2')
    expect(r.factsLinked).toBe(1)
    expect(isMarked(db, row.rid)).toBe(true)
  })
})

describe('capture: the unit flag and its sources', () => {
  it('the ingest marks a unit captured with secrets, and only that one', () => {
    const { db, caps } = makeV2Db()
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    const secret = makeUnit({ content: 'Harbor gateway key: tidal-9921-orca', secrets: true })
    const clean = makeUnit({ content: 'Harbor gateway maintenance on Tuesdays' })
    ingest.enqueue(secret)
    ingest.enqueue(clean)
    ingest.flushAll('manual')
    const ridOf = (id: string) => (db.all(sql`SELECT rid FROM memory_raw WHERE id = ${id}`) as Array<{ rid: number }>)[0].rid
    expect(isMarked(db, ridOf(secret.id))).toBe(true)
    expect(isMarked(db, ridOf(clean.id))).toBe(false)
  })

  it('a vault note holds secrets by its vault_index tags or its own frontmatter; otherwise not', () => {
    const w = makeWorld()
    w.vault.write('semantic/indexed.md', fm({ tags: [SECRETS_TAG] }), 'Indexed body')
    w.vault.write('semantic/plain.md', fm(), 'Plain body')
    w.indexer.indexAll()
    expect(vaultNoteHoldsSecrets(w.db, 'semantic/indexed.md', 'Indexed body without frontmatter')).toBe(true)
    // Not indexed yet: the frontmatter alone decides.
    expect(vaultNoteHoldsSecrets(w.db, 'semantic/new.md', `---\ntags:\n  - ${SECRETS_TAG}\n---\nNew body\n`)).toBe(true)
    expect(vaultNoteHoldsSecrets(w.db, 'semantic/plain.md', '---\ntags: []\n---\nPlain body\n')).toBe(false)
    expect(vaultNoteHoldsSecrets(w.db, 'semantic/broken.md', '---\ntags: [unclosed\n---\nBroken\n')).toBe(false)
  })

  it('migrates a tagged note written straight to disk (not indexed yet) as a secrets unit', async () => {
    const w = makeWorld()
    mkdirSync(join(w.vault.getBasePath(), 'semantic'), { recursive: true })
    writeFileSync(join(w.vault.getBasePath(), SECRET_PATH), `---\ntitle: Zephyr access\ntags:\n  - ${SECRETS_TAG}\n---\n${SECRET_BODY}`)
    await migrateImportedIntoL0({ db: w.db, ingest: w.ingest, vault: w.vault, logger: silentLogger })
    for (const rid of everyRow(secretNote(w.db))) expect(isMarked(w.db, rid)).toBe(true)
  })
})
