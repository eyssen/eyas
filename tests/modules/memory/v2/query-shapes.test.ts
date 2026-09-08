// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Port of the Phase 0 spike's fts-knn-shapes/shapes.sql (USE / DO NOT USE)
// and cte-check.ts. Identity assertions only: at 5 000 rows latency means
// nothing, the 200 k numbers live in the spike report (§3.2, §3.3) and the
// nightly bench. What this guards is that a SQLite / sqlite-vec upgrade
// cannot silently change which shape is correct.

import { describe, it, expect } from 'vitest'
import { buildShapesFixture, SMALL_PROJECT, MID_PROJECT, LARGE_PROJECT } from './shapes-fixture'

const fixture = buildShapesFixture(5_000)
const { raw, caps, queryVector: qv } = fixture

type KnnRow = { rowid: number; distance: number }
type FtsRow = { rowid: number; score: number }
const knn = (sql: string, ...params: unknown[]): KnnRow[] => raw.prepare(sql).all(...params) as KnnRow[]
const fts = (sql: string, ...params: unknown[]): FtsRow[] => raw.prepare(sql).all(...params) as FtsRow[]
const ids = (rows: Array<{ rowid: number }>): number[] => rows.map((r) => r.rowid).sort((a, b) => a - b)
const dists = (rows: KnnRow[]): number[] => rows.map((r) => r.distance).sort((a, b) => a - b)

const TAG_FILTER = `(SELECT memory_rid FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact')`

describe.skipIf(!caps.vec0)('filtered KNN shapes (skipped when sqlite-vec is not loadable on this box)', () => {
  for (const project of [SMALL_PROJECT, MID_PROJECT, LARGE_PROJECT]) {
    it(`p${project}: rowid IN == temp table == PARTITION KEY == metadata column (top-50)`, () => {
      const tag = `p${project}`
      const a = knn(`SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 50 AND rowid IN ${TAG_FILTER}`, qv, tag)
      raw.exec('CREATE TEMP TABLE IF NOT EXISTS qs_cand (id INTEGER PRIMARY KEY)')
      raw.exec('DELETE FROM temp.qs_cand')
      raw.prepare(`INSERT INTO temp.qs_cand(id) SELECT memory_rid FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact'`).run(tag)
      const b = knn(`SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 50 AND rowid IN (SELECT id FROM temp.qs_cand)`, qv)
      const c = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ?`, qv, project)
      const d = knn(`SELECT rowid, distance FROM qs_vec_meta WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ?`, qv, project)
      expect(a.length).toBe(Math.min(50, fixture.projectRows(project)))
      expect(a.length).toBeGreaterThan(0)
      expect(ids(b)).toEqual(ids(a))
      expect(ids(c)).toEqual(ids(a))
      expect(ids(d)).toEqual(ids(a))
      expect(dists(c)).toEqual(dists(a))
      expect(dists(d)).toEqual(dists(a))
    })
  }

  it('D1 set (global ∪ project): vec0 returns k rows PER partition; a bare outer LIMIT errors; the MATERIALIZED CTE is the shape', () => {
    const perPartition = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key IN (0, ?)`, qv, MID_PROJECT)
    expect(perPartition.length).toBe(50 + Math.min(50, fixture.projectRows(MID_PROJECT)))

    expect(() => knn(`SELECT rowid, distance FROM (SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key IN (0, ?)) ORDER BY distance LIMIT 50`, qv, MID_PROJECT))
      .toThrow(/LIMIT|k =/)

    const materialized = knn(`WITH c AS MATERIALIZED (SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key IN (0, ?)) SELECT rowid, distance FROM c ORDER BY distance LIMIT 50`, qv, MID_PROJECT)
    expect(materialized.length).toBe(50)
    const top50 = [...perPartition].sort((x, y) => x.distance - y.distance).slice(0, 50)
    expect(ids(materialized)).toEqual(ids(top50))
    for (let i = 1; i < materialized.length; i++) expect(materialized[i].distance).toBeGreaterThanOrEqual(materialized[i - 1].distance)
  })

  it('PARTITION KEY combines with an independent rowid filter (project partition ∩ even rowid)', () => {
    // Deliberately NOT the project's own tag: for a given project every row tagged 'p{N}' is
    // exactly the set with project_key = N (fixture invariant), so `rowid IN <that project's
    // own tag>` is a no-op superset-equal condition alongside `project_key = N` and cannot show
    // the two predicates are actually being ANDed together rather than one being ignored. Parity
    // is a predicate independent of project membership, so it exercises that combination for
    // real. SMALL_PROJECT (not LARGE_PROJECT) is used here on purpose: its partition (14 rows,
    // measured) is well under k = 50, so `only` is the complete population rather than a top-50
    // truncation — only then is `combined` (a stricter AND on the same base predicate) guaranteed
    // by construction to be a literal subset of `only`, not merely one empirically.
    const EVEN_ROWID_FILTER = `(SELECT rid FROM memory_item WHERE rid % 2 = 0)`
    const only = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ?`, qv, SMALL_PROJECT)
    const combined = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ? AND rowid IN ${EVEN_ROWID_FILTER}`, qv, SMALL_PROJECT)
    expect(combined.length).toBeGreaterThan(0)
    expect(combined.length).toBeLessThan(only.length)
    const onlyIds = new Set(ids(only))
    for (const row of combined) {
      expect(onlyIds.has(row.rowid)).toBe(true)
      expect(row.rowid % 2).toBe(0)
    }
  })

  it('over-fetch-then-filter is banned because it loses recall (spike: 2–30 % at 200 k)', () => {
    const tag = `p${SMALL_PROJECT}`
    const exact = knn(`SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 50 AND rowid IN ${TAG_FILTER}`, qv, tag)
    const overfetch = knn(`SELECT v.rowid, v.distance FROM (SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 500) v JOIN memory_tag t ON t.memory_rid = v.rowid AND t.memory_type = 'fact' AND t.tag_type = 'project' AND t.tag_value = ? ORDER BY v.distance LIMIT 50`, qv, tag)
    expect(exact.length).toBeGreaterThan(0)
    expect(overfetch.length).toBeLessThan(exact.length)
    // Threshold is statistical: the plan's own spike evidence saw recall as high as 43 % in one
    // configuration (within 7 points of this 0.5 bar), while a pre-flight run on this fixture
    // measured 0.071 at 5 000 rows / seed 1234 (project p1, 0.3 % selectivity). If this starts
    // failing, it more likely means the corpus/seed/row-count changed than that the ban is wrong —
    // re-measure before adjusting the threshold.
    expect(overfetch.length / exact.length).toBeLessThan(0.5)
  })

  it('binds int8 vectors only through vec_int8(): a bare 384-byte blob is rejected as float32', () => {
    expect(() => raw.prepare(`SELECT rowid FROM qs_vec_plain WHERE embedding MATCH ? AND k = 1`).all(qv)).toThrow()
  })
})

describe.skipIf(!caps.fts5)('FTS5 filter shapes (skipped without FTS5)', () => {
  const tag = `p${MID_PROJECT}`

  it('A (naive rowid IN), B (+rowid IN), C (subselect + JOIN) and E (CROSS JOIN) return identical rows and scores', () => {
    const A = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? AND rowid IN ${TAG_FILTER} ORDER BY score, rowid LIMIT 50`, 'szamla', tag)
    const B = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? AND +rowid IN ${TAG_FILTER} ORDER BY score, rowid LIMIT 50`, 'szamla', tag)
    const C = fts(`SELECT x.rowid, x.score FROM (SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ?) x JOIN memory_tag t ON t.memory_rid = x.rowid AND t.tag_type = 'project' AND t.tag_value = ? AND t.memory_type = 'fact' ORDER BY x.score, x.rowid LIMIT 50`, 'szamla', tag)
    const E = fts(`SELECT memory_raw_fts.rowid AS rowid, bm25(memory_raw_fts) AS score FROM memory_tag t CROSS JOIN memory_raw_fts ON memory_raw_fts.rowid = t.memory_rid WHERE t.tag_type = 'project' AND t.tag_value = ? AND t.memory_type = 'fact' AND memory_raw_fts MATCH ? ORDER BY score, rowid LIMIT 50`, tag, 'szamla')
    expect(A.length).toBeGreaterThan(0)
    expect(B).toEqual(A)
    expect(C).toEqual(A)
    expect(E).toEqual(A)
  })

  it('the filter is a strict subset of the unfiltered top-50 space and diacritics are folded both ways', () => {
    const unfiltered = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? ORDER BY score, rowid LIMIT 50`, 'szamla')
    expect(unfiltered.length).toBe(50)
    const folded = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? ORDER BY score, rowid LIMIT 50`, 'számla')
    expect(folded).toEqual(unfiltered)
    const filtered = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? AND +rowid IN ${TAG_FILTER} ORDER BY score, rowid LIMIT 50`, 'szamla', tag)
    const projectIds = new Set(ids(raw.prepare(`SELECT memory_rid AS rowid FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact'`).all(tag) as Array<{ rowid: number }>))
    // Guard against a silently-vacuous loop: this must actually assert something.
    expect(filtered.length).toBeGreaterThan(0)
    for (const row of filtered) expect(projectIds.has(row.rowid)).toBe(true)
  })
})
