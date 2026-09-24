// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Deterministic corpus for the read-path SQL shapes (port of the Phase 0
// spike's fts-knn-shapes/common.ts + build.ts). Same seed → same vectors,
// same project assignment, same FTS bodies, at any row count.

import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables, EMBEDDING_DIMENSIONS } from '@modules/memory/v2/schema'

export const N_PROJECTS = 40
/** Selectivity ramps from 0.3 % (p1) to 2 % (p40); the rest (~54 %) is global (partition 0). */
export const PROJECT_WEIGHTS = Array.from({ length: N_PROJECTS }, (_, i) => 0.003 + (0.017 * i) / (N_PROJECTS - 1))
export const SMALL_PROJECT = 1
export const MID_PROJECT = 20
export const LARGE_PROJECT = 40

export const HU_WORDS = 'számla vevő szállító projekt feladat árajánlat készlet raktár beszerzés jóváhagyás kiegyenlítés ügyfél telefonszám adószám átutalás előleg határidő módosítás értesítés visszaigazolás könyvelés szerződés hibajegy verzió frissítés telepítés konténer memória keresés beágyazás címke összefoglaló döntés kérdés válasz tegnap holnap fizetés kedvezmény'.split(' ')
export const EN_WORDS = 'invoice customer vendor project task quotation stock warehouse purchase approval payment client phone tax transfer deposit deadline change notification confirmation accounting contract ticket version update install container memory search embedding tag summary decision question answer yesterday tomorrow discount migration cluster pipeline'.split(' ')

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gaussian-ish unit vector (sum of four uniforms), scaled so max |x| = 127. */
export function makeInt8Vector(r: () => number): Int8Array {
  const f = new Float32Array(EMBEDDING_DIMENSIONS)
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    const g = r() + r() + r() + r() - 2
    f[i] = g
    norm += g * g
  }
  norm = Math.sqrt(norm)
  let maxAbs = 0
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    f[i] /= norm
    if (Math.abs(f[i]) > maxAbs) maxAbs = Math.abs(f[i])
  }
  const i8 = new Int8Array(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) i8[i] = Math.round((f[i] / maxAbs) * 127)
  return i8
}

/** 0 = global, 1..40 = project. */
export function pickProject(r: () => number): number {
  let x = r()
  for (let i = 0; i < N_PROJECTS; i++) {
    x -= PROJECT_WEIGHTS[i]
    if (x < 0) return i + 1
  }
  return 0
}

export interface ShapesFixture {
  db: any
  raw: any
  caps: SqliteCapabilities
  rows: number
  /** Query vector, as the Buffer production binds through vec_int8(?). */
  queryVector: Buffer
  projectRows(project: number): number
}

export function buildShapesFixture(rows: number, seed = 1234): ShapesFixture {
  const db = createMemoryDb()
  const raw = getRawFromDrizzle(db)
  const caps = probeSqliteCapabilities(raw)
  createMemoryV2Tables(db, caps)
  if (caps.vec0) {
    raw.exec(`CREATE VIRTUAL TABLE qs_vec_plain USING vec0(embedding int8[${EMBEDDING_DIMENSIONS}])`)
    raw.exec(`CREATE VIRTUAL TABLE qs_vec_meta USING vec0(embedding int8[${EMBEDDING_DIMENSIONS}], project_key INTEGER)`)
  }
  const insItem = raw.prepare(`INSERT INTO memory_item (item_type, id, created_at) VALUES ('fact', ?, ?) RETURNING rid`)
  const insPart = caps.vec0 ? raw.prepare(`INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))`) : null
  const insPlain = caps.vec0 ? raw.prepare(`INSERT INTO qs_vec_plain(rowid, embedding) VALUES (?, vec_int8(?))`) : null
  const insMeta = caps.vec0 ? raw.prepare(`INSERT INTO qs_vec_meta(rowid, embedding, project_key) VALUES (?, vec_int8(?), ?)`) : null
  const insTag = raw.prepare(`INSERT INTO memory_tag(memory_rid, memory_type, tag_type, tag_value) VALUES (?, 'fact', 'project', ?)`)
  const insFts = caps.fts5 ? raw.prepare(`INSERT INTO memory_raw_fts(rowid, body) VALUES (?, ?)`) : null

  const r = mulberry32(seed)
  raw.exec('BEGIN')
  try {
    for (let i = 1; i <= rows; i++) {
      const rid = (insItem.get(`shape-${seed}-${i}`, i) as { rid: number }).rid
      const vector = Buffer.from(makeInt8Vector(r).buffer)
      const project = pickProject(r)
      if (insPart && insPlain && insMeta) {
        insPart.run(rid, project, vector)
        insPlain.run(rid, vector)
        insMeta.run(rid, vector, project)
      }
      if (project > 0) insTag.run(rid, `p${project}`)
      // Half Hungarian (diacritics on purpose), half English, plus one rare token.
      const words = r() < 0.5 ? HU_WORDS : EN_WORDS
      const len = 6 + Math.floor(r() * 14)
      const parts: string[] = []
      for (let k = 0; k < len; k++) parts.push(words[Math.floor(r() * words.length)])
      parts.push(`ref${Math.floor(r() * 500)}`)
      if (insFts) insFts.run(rid, parts.join(' '))
    }
    raw.exec('COMMIT')
  } catch (err) {
    raw.exec('ROLLBACK')
    throw err
  }

  const queryVector = Buffer.from(makeInt8Vector(mulberry32(777)).buffer)
  const countStmt = raw.prepare(`SELECT COUNT(*) AS c FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact'`)
  return {
    db,
    raw,
    caps,
    rows,
    queryVector,
    projectRows: (project) => (countStmt.get(`p${project}`) as { c: number }).c,
  }
}
