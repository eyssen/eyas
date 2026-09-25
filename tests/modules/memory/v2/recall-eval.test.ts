// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Synthetic recall eval: R@5 per language through the real retrieve() path —
// L0 rows written by the ingest (blob + FTS), one task gist per document, L3
// vectors through embedLayeredBatch and sqlite-vec, gated fusion, hydrate and
// rerank — on the hu/de/en fixture (80 labelled pairs, 300 distractors).
//
// Every document shares one age, importance and trust tier, so relevance is
// the only signal. A rerank that reorders by anything else (J4's recency and
// trust terms have their own tests) shows up here as a lost floor.
//
// Two lanes. The e5 lane (data/models present) holds the per-language R@5
// floor on the fixture's paraphrase queries. The stem-hash lane runs wherever
// sqlite-vec loads (CI included) and checks that each gold document comes back
// for its own text. A temp in-memory database, fixtures only, no remote call.

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables, allocateRid } from '@modules/memory/v2/schema'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { embedLayeredBatch } from '@modules/memory/v2/l3-embed'
import { retrieve } from '@modules/memory/v2/retrieve'
import { createHashEmbedder } from '@modules/memory/embeddings/hash-embedder'
import { tryCreateE5Embedder } from '@modules/memory/embeddings/local-embedder'
import type { EmbeddingProvider } from '@modules/memory/embeddings/types'
import { pairs, distractors, type RecallLang } from '../fixtures/recall-hu-de-en'
import { silentLogger, testIngestConfig } from './helpers'

const MODELS = resolve('data/models')
const hasModels = existsSync(MODELS) && readdirSync(MODELS).length > 0
const vecOk = probeSqliteCapabilities(getRawFromDrizzle(createMemoryDb())).vec0

/** The limit assembleMemory asks retrieve() for; R@5 is read from its head. */
const ASSEMBLE_LIMIT = 12
const K = 5
const LANGS: RecallLang[] = ['hu', 'de', 'en']
/** One instant for every row: age must not separate gold from distractor. */
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0)

const docId = (i: number) => `doc-${String(i).padStart(3, '0')}`

function insertTaskGist(db: any, conversationId: string, text: string): void {
  const id = `g-${conversationId}`
  const rid = allocateRid(db, 'gist', id, T0)
  db.run(sql`INSERT INTO memory_gist (
    rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, tombstoned,
    scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score, gist_source,
    is_current, decay_score, presence_tier, multi_project, times_retrieved
  ) VALUES (
    ${rid}, ${id}, ${`h-${id}`}, 'inst-eval', ${T0}, 0, 1, ${T0}, 0,
    'task', ${conversationId}, 0, ${text}, '{}', 0, 'owner', 20, 0.5, 'heuristic',
    1, 1.0, 'hot', 0, 0
  )`)
}

/** Which document a hit id points at: `rw:<raw id>` via its conversation, `gs:g-<conversation>`. */
function hitDoc(db: any, hitId: string): string | null {
  if (hitId.startsWith('gs:g-')) return hitId.slice('gs:g-'.length)
  if (hitId.startsWith('rw:')) {
    const row = (db.all(sql`SELECT conversation_id AS c FROM memory_raw WHERE id = ${hitId.slice(3)}`) as Array<{ c: string }>)[0]
    return row?.c ?? null
  }
  return null
}

async function seedCorpus(bridge: EmbeddingProvider): Promise<{ db: any; raw: any }> {
  const db = createMemoryDb()
  const raw = getRawFromDrizzle(db)
  const caps = probeSqliteCapabilities(raw)
  createMemoryV2Tables(db, caps)
  const ingest = createMemoryIngest({
    db, caps, config: () => testIngestConfig, instanceId: 'inst-eval', logger: silentLogger,
  })
  const docs = [...pairs.map((p) => p.d), ...distractors]
  docs.forEach((text, i) => {
    const conversationId = docId(i)
    ingest.enqueue({
      id: `raw-${conversationId}`,
      sourceType: 'user_message',
      actor: 'owner-1',
      conversationId,
      projectId: null,
      projectTypeId: null,
      occurredAtMs: T0,
      content: text,
      trustTier: 'owner',
    })
    ingest.flushConversation(conversationId, 'manual')
    insertTaskGist(db, conversationId, text)
  })
  // embedLayeredBatch embeds what is still missing; loop until nothing is.
  for (let round = 0; round < 20; round++) {
    const done = await embedLayeredBatch({ db, rawDb: raw, bridge, logger: silentLogger }, 128)
    if (done.gists + done.facts + done.entities === 0) break
  }
  return { db, raw }
}

interface LaneResult {
  /** R@5 against the labelled gold, per language. */
  recall: Record<RecallLang, number>
  /** R@5 against the NEXT pair's gold — a metric sanity check, must stay near 0. */
  shifted: Record<RecallLang, number>
}

async function recallByLanguage(bridge: EmbeddingProvider, queryOf: (i: number) => string): Promise<LaneResult> {
  const { db, raw } = await seedCorpus(bridge)
  const embedded = (db.all(sql`SELECT COUNT(*) AS n FROM memory_embedding WHERE owner_type = 'gist'`) as Array<{ n: number }>)[0]!.n
  expect(embedded, 'every document gist must carry a vector').toBe(pairs.length + distractors.length)

  const zero = (): Record<RecallLang, number> => ({ hu: 0, de: 0, en: 0 })
  const hits = zero()
  const shiftedHits = zero()
  const totals = zero()
  for (let qi = 0; qi < pairs.length; qi++) {
    const pair = pairs[qi]!
    const got = await retrieve({ db, rawDb: raw, bridge, logger: silentLogger }, {
      query: queryOf(qi),
      language: pair.lang,
      excludeConversationId: 'eval-query',
      limit: ASSEMBLE_LIMIT,
    })
    const top = got.slice(0, K).map((h) => hitDoc(db, h.id))
    totals[pair.lang]++
    if (top.includes(docId(qi))) hits[pair.lang]++
    if (top.includes(docId((qi + 1) % pairs.length))) shiftedHits[pair.lang]++
  }
  const ratio = (n: Record<RecallLang, number>): Record<RecallLang, number> => ({
    hu: n.hu / totals.hu, de: n.de / totals.de, en: n.en / totals.en,
  })
  return { recall: ratio(hits), shifted: ratio(shiftedHits) }
}

function report(r: Record<RecallLang, number>): string {
  return LANGS.map((l) => `${l}=${r[l].toFixed(3)}`).join(' ')
}

beforeAll(async () => { await initZstd() })

describe('recall-eval fixture', () => {
  it('is balanced: 40 hu, 20 de, 20 en pairs and 300 distinct distractors', () => {
    const count = (l: RecallLang) => pairs.filter((p) => p.lang === l).length
    expect([count('hu'), count('de'), count('en')]).toEqual([40, 20, 20])
    expect(new Set(distractors).size).toBe(300)
    // A gold document that is also a distractor would make R@5 meaningless.
    const golds = new Set(pairs.map((p) => p.d))
    expect(distractors.some((d) => golds.has(d))).toBe(false)
  })
})

describe.skipIf(!vecOk)('recall-eval, stem-hash lane (sqlite-vec, runs in CI)', () => {
  // The stem hash is lexical and the fixture's queries are paraphrases built
  // to defeat lexical matching, so this lane asks each gold document for
  // itself instead: a pipeline check of FTS, KNN, fusion and rerank that needs
  // no model files. Measured 2026-09-23: 1.000 in every language.
  const FLOOR: Record<RecallLang, number> = { hu: 1, de: 1, en: 1 }

  it('finds every gold document from its own text in the top 5', async () => {
    const r = await recallByLanguage(createHashEmbedder(), (i) => pairs[i]!.d)
    for (const lang of LANGS) expect(r.recall[lang], `stem-hash self R@5 ${report(r.recall)}`).toBeGreaterThanOrEqual(FLOOR[lang])
    // Negative: the neighbouring pair's gold is not what came back.
    for (const lang of LANGS) expect(r.shifted[lang], `shifted ${report(r.shifted)}`).toBeLessThanOrEqual(0.1)
  }, 120_000)

  it('paraphrase queries stay below the self-recall floor with a lexical embedder (the lane is not trivially satisfied)', async () => {
    const r = await recallByLanguage(createHashEmbedder(), (i) => pairs[i]!.q)
    expect(LANGS.some((lang) => r.recall[lang] < FLOOR[lang]), `stem-hash paraphrase R@5 ${report(r.recall)}`).toBe(true)
  }, 120_000)
})

describe.skipIf(!vecOk || !hasModels)('recall-eval, e5 lane (data/models present)', () => {
  // Measured 2026-09-23 through retrieve() with multilingual-e5-small q8:
  // hu 0.700 (28/40), de 0.700 (14/20), en 0.650 (13/20). Floors leave one
  // query of slack per language (two for hu). The same model scores 0.84
  // overall on float cosine; the gap is the vec0 search itself (L2 distance
  // over per-vector-scaled int8, see floatToInt8), not fusion or rerank.
  // Raise these floors when the KNN ranks by cosine.
  const FLOOR: Record<RecallLang, number> = { hu: 0.65, de: 0.65, en: 0.6 }

  it('keeps paraphrase R@5 at or above the per-language floor', async () => {
    const bridge = await tryCreateE5Embedder({ cacheDir: MODELS, logger: silentLogger })
    expect(bridge, 'e5 must load when data/models is present').toBeTruthy()
    if (!bridge) return
    const r = await recallByLanguage(bridge, (i) => pairs[i]!.q)
    for (const lang of LANGS) expect(r.recall[lang], `e5 R@5 ${report(r.recall)}`).toBeGreaterThanOrEqual(FLOOR[lang])
    for (const lang of LANGS) expect(r.shifted[lang], `e5 shifted ${report(r.shifted)}`).toBeLessThanOrEqual(0.1)
  }, 300_000)
})
