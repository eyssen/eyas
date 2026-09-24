// tests/modules/data-port/candidates-store.test.ts — migration describe (Task 8 appends the store cases)
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import type { ScanCandidate } from '@modules/data-port/types'
import {
  COUNT_FOLDER_LIMIT, candidateCounts, countCandidates, folderOf, getCandidate, getCandidatesByIds,
  insertCandidates, insertDirs, iterateCandidates, listCandidates, listDirs, pruneScans,
} from '@modules/data-port/candidates-store'
import { isBun } from '@shared/platform'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const columns = (db: any, table: string): string[] =>
  (db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map((c) => c.name)
const indexes = (db: any): string[] =>
  (db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index'`) as Array<{ name: string }>).map((r) => r.name)

describe('data-port schema migration (R11)', () => {
  it('creates the candidate and directory tables with every index, twice without error', () => {
    const db = createMemoryDb()
    createDataPortTables(db)
    createDataPortTables(db)
    expect(columns(db, 'data_port_candidates')).toEqual(expect.arrayContaining([
      'scan_id', 'id', 'seq', 'relative_path', 'folder', 'kind', 'target', 'importable', 'reason_code',
      'reason_prefix', 'selected_by_default', 'bytes', 'search_text', 'tags_json', 'warnings_json',
      'directory_json', 'source_path', 'adapter_id', 'unit', 'sha256', 'paths_json', 'assets_json',
    ]))
    expect(columns(db, 'data_port_scan_dirs')).toEqual(expect.arrayContaining([
      'scan_id', 'path', 'parent', 'name', 'depth', 'skipped_class', 'file_count', 'alias_of',
    ]))
    for (const name of [
      'idx_dpc_scan_seq', 'idx_dpc_scan_path', 'idx_dpc_scan_kind', 'idx_dpc_scan_reason', 'idx_dpc_scan_folder',
      'idx_dpc_scan_selected', 'idx_dpc_scan_source', 'idx_dpd_parent', 'idx_data_port_applied_sha',
      'idx_data_port_applied_kind_ref',
    ]) expect(indexes(db)).toContain(name)
  })

  it('adds the new columns to tables an older install already has', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE data_port_scans (id TEXT PRIMARY KEY, source_profile TEXT NOT NULL, detected_profile TEXT NOT NULL,
      root_path TEXT NOT NULL, candidates_json TEXT NOT NULL, stats_json TEXT NOT NULL, warnings_json TEXT NOT NULL, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE data_port_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, source_profile TEXT NOT NULL, scan_id TEXT NOT NULL,
      selection_json TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0, stats_json TEXT NOT NULL,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT)`)
    db.run(sql`CREATE TABLE data_port_applied (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
      source_path TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`INSERT INTO data_port_scans VALUES ('s1','auto','generic-md','/alpha','[{"id":"c1"}]','{}','[]','2026-01-01')`)
    createDataPortTables(db)
    expect(columns(db, 'data_port_scans')).toEqual(expect.arrayContaining(['status', 'progress_json', 'scan_ms', 'finished_at', 'format', 'candidate_count', 'counts_json']))
    expect(columns(db, 'data_port_jobs')).toEqual(expect.arrayContaining(['selection_mode', 'selection_total', 'cursor_seq', 'started_at', 'import_ms', 'resumed_count', 'elapsed_ms']))
    expect(columns(db, 'data_port_applied')).toEqual(expect.arrayContaining(['sha256', 'adapter', 'paths_json']))
    const row = (db.all(sql`SELECT format, status, candidate_count FROM data_port_scans WHERE id = 's1'`) as any[])[0]
    expect(row).toEqual({ format: 1, status: 'done', candidate_count: 0 })
  })
})

const synth = (n: number): ScanCandidate[] => Array.from({ length: n }, (_, i) => {
  const kind = (['memory', 'session', 'code', 'knowledge', 'noise', 'rule', 'skill'] as const)[i % 7]
  const target = kind === 'noise' ? 'none' : kind === 'session' ? 'episodic' : 'vault.semantic'
  return {
    id: `c${i}`, relativePath: `notes/${['alpha', 'bravo', 'charlie'][i % 3]}/d${i % 11}/n${i}.md`, kind, target, title: `note ${i}`, preview: '', bytes: i,
    confidence: 0.5, reason: 'r', reasonCode: i % 13 === 0 ? 'directory-skipped:node_modules' : 'memory-note', selectedByDefault: i % 5 !== 0 && target !== 'none',
    sourcePath: `/srv/${i}`, unit: i % 3 === 0 ? `u${i}` : null, tags: i % 17 === 0 ? ['contains-secrets'] : [],
  } as ScanCandidate
})

describe('candidates store', () => {
  it('derives folders', () => {
    expect(folderOf('a.md')).toBe('.'); expect(folderOf('x/a.md')).toBe('x'); expect(folderOf('.alpha/projects/slug/deep/f.jsonl')).toBe('.alpha/projects/slug/deep')
  })
  /*
   * A-87. This asserted a 2 s wall clock, which is a stopwatch on a machine the
   * test does not control: under five concurrent runs it failed 13 times out of
   * 15, taking 2.5–2.8 s for work that takes ~1 s idle. A flaky assertion gets
   * disabled rather than investigated, and then the regression hides in the
   * noise it taught everyone to ignore.
   *
   * What it was ever protecting is that the insert stays BATCHED — one statement
   * per `INSERT_CHUNK` inside one transaction, not one per row. That is a count,
   * and a count is the same on every machine: 30 000 rows in chunks of 200 is
   * 150 statements. A per-row regression would be 30 000, and would be caught
   * here whatever the machine was doing at the time.
   */
  it('inserts 30 000 rows in batches, not one statement per row, and pages them stably', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    const realRun = db.run.bind(db)
    let inserts = 0
    ;(db as { run: (q: unknown) => unknown }).run = (q: unknown) => {
      const text = String((q as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks?.[0]?.value ?? '')
      if (text.includes('INSERT INTO data_port_candidates')) inserts++
      return realRun(q as never)
    }
    insertCandidates(db, 's1', synth(30_000), 0)
    ;(db as { run: unknown }).run = realRun
    // ceil(30 000 / INSERT_CHUNK), with INSERT_CHUNK = 200.
    expect(inserts).toBe(150)
    expect(countCandidates(db, 's1', {})).toBe(30_000)
    const page = listCandidates(db, 's1', {}, { offset: 29_900, limit: 200, order: 'path' })
    expect(page.items).toHaveLength(100); expect(page.total).toBe(30_000)
    const a = listCandidates(db, 's1', {}, { offset: 100, limit: 50, order: 'path' }).items.map((c) => c.id)
    const b = listCandidates(db, 's1', {}, { offset: 100, limit: 50, order: 'path' }).items.map((c) => c.id)
    expect(a).toEqual(b)
    // Whole-scan union: a page that repeats or drops a row cannot hide behind
    // two identical calls, which an unstable plan would also satisfy.
    for (const order of ['path', 'seq'] as const) {
      const all: string[] = []
      for (let offset = 0; offset < 30_000; offset += 500) all.push(...listCandidates(db, 's1', {}, { offset, limit: 500, order }).items.map((c) => c.id))
      expect(all).toHaveLength(30_000)
      expect(new Set(all).size).toBe(30_000)
    }
    expect(page.items[0]).toMatchObject({ seq: expect.any(Number), folder: expect.any(String), importable: expect.any(Boolean) })
    expect('sourcePath' in page.items[0]!).toBe(false)
  })
  it('iterates by keyset, every id once, seq strictly increasing', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(1234), 0)
    const seen: number[] = []
    let batches = 0
    for (const batch of iterateCandidates(db, 's1', {}, 500)) { batches++; for (const r of batch) seen.push(r.seq!) }
    expect(batches).toBe(3); expect(seen).toHaveLength(1234); expect(seen).toEqual([...seen].sort((x, y) => x - y)); expect(new Set(seen).size).toBe(1234)
    expect([...iterateCandidates(db, 's1', {}, 500, 1200)].flat().map((r) => r.seq)).toEqual([1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217, 1218, 1219, 1220, 1221, 1222, 1223, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1231, 1232, 1233])
  })
  it('filters like a JS filter does', () => {
    const rows = synth(3000); const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', rows, 0)
    const js = (f: (c: ScanCandidate) => boolean) => rows.filter(f).length
    expect(countCandidates(db, 's1', { kind: ['memory', 'code'] })).toBe(js((c) => c.kind === 'memory' || c.kind === 'code'))
    expect(countCandidates(db, 's1', { folder: 'notes/alpha' })).toBe(js((c) => c.relativePath.startsWith('notes/alpha/')))
    expect(countCandidates(db, 's1', { folder: 'notes/alpha/d3', subtree: false })).toBe(js((c) => folderOf(c.relativePath) === 'notes/alpha/d3'))
    expect(countCandidates(db, 's1', { selected: true })).toBe(js((c) => c.selectedByDefault))
    expect(countCandidates(db, 's1', { importable: true })).toBe(js((c) => c.target !== 'none'))
    expect(countCandidates(db, 's1', { reason: ['directory-skipped'] })).toBe(js((c) => c.reasonCode.startsWith('directory-skipped')))
    expect(countCandidates(db, 's1', { tag: ['contains-secrets'] })).toBe(js((c) => c.tags?.includes('contains-secrets') ?? false))
    expect(countCandidates(db, 's1', { q: 'note 12' })).toBe(js((c) => c.title.includes('note 12')))
    expect(countCandidates(db, 's1', { q: '100%_x' })).toBe(0)
    expect(countCandidates(db, 's1', { excludeFolders: ['notes/alpha', 'notes/bravo'] })).toBe(js((c) => c.relativePath.startsWith('notes/charlie/')))
  })
  it('counts by kind, reason and folder consistently', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(700), 0)
    const c = candidateCounts(db, 's1', {})
    expect(c.byKind.reduce((a, b) => a + b.total, 0)).toBe(c.total)
    expect(c.byReason.reduce((a, b) => a + b.total, 0)).toBe(c.total)
    expect(c.byFolder.reduce((a, b) => a + b.total, 0)).toBe(c.total)
    expect(c.selectedByDefault).toBeLessThanOrEqual(c.importable)
  })
  it('lists directory children with subtree aggregates', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(300), 0)
    insertDirs(db, 's1', [
      { path: '.', parent: null, name: '.', depth: 0, skippedClass: null, fileCount: 0, aliasOf: null },
      { path: 'notes', parent: '.', name: 'notes', depth: 1, skippedClass: null, fileCount: 0, aliasOf: null },
      { path: 'notes/alpha', parent: 'notes', name: 'alpha', depth: 2, skippedClass: null, fileCount: 100, aliasOf: null },
      { path: 'notes/bravo', parent: 'notes', name: 'bravo', depth: 2, skippedClass: null, fileCount: 100, aliasOf: null },
      { path: 'notes/charlie', parent: 'notes', name: 'charlie', depth: 2, skippedClass: null, fileCount: 100, aliasOf: null },
      { path: 'notes/node_modules', parent: 'notes', name: 'node_modules', depth: 2, skippedClass: 'node_modules', fileCount: 42, aliasOf: null },
    ])
    const kids = listDirs(db, 's1', 'notes', {})
    expect(kids.map((k) => k.name)).toEqual(['alpha', 'bravo', 'charlie', 'node_modules'])
    expect(kids[0]!.subtree.total).toBe(100)
    expect(kids[3]).toMatchObject({ skippedClass: 'node_modules', fileCount: 42 })
    expect(kids[0]!.byKind.memory).toBeGreaterThan(0)
  })
  it('gets by id in the caller order, chunked', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(1200), 0)
    const ids = ['c1100', 'c7', 'c999', 'nope']
    expect(getCandidatesByIds(db, 's1', ids).map((c) => c.id)).toEqual(['c1100', 'c7', 'c999'])
    // Across IN_CHUNK (500): three passes, still complete and still in caller order.
    const many = Array.from({ length: 1200 }, (_, i) => `c${1199 - i}`)
    expect(getCandidatesByIds(db, 's1', many).map((c) => c.id)).toEqual(many)
    expect(getCandidatesByIds(db, 's1', [])).toEqual([])
    expect(getCandidate(db, 's1', 'c7')?.sourcePath).toBe('/srv/7')
    expect(getCandidate(db, 'other', 'c7')).toBeNull()
  })
  it('prunes candidate rows of old scans but never their header rows', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    for (let i = 0; i < 4; i++) {
      db.run(sql`INSERT INTO data_port_scans (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json, created_at, format)
        VALUES (${'s' + i}, 'auto', 'generic-md', '/x', '[]', '{}', '[]', ${`2026-0${i + 1}-01T00:00:00.000Z`}, 2)`)
      insertCandidates(db, 's' + i, synth(5), 0)
    }
    pruneScans(db, { keepNewest: 2, keepDays: 0 })
    expect(countCandidates(db, 's0', {})).toBe(0); expect(countCandidates(db, 's3', {})).toBe(5)
    expect((db.all(sql`SELECT count(*) AS n FROM data_port_scans`) as any[])[0].n).toBe(4)
  })
  it('never prunes a scan a pending or running job still reads', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    const now = new Date().toISOString()
    for (let i = 0; i < 4; i++) {
      db.run(sql`INSERT INTO data_port_scans (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json, created_at, format)
        VALUES (${'s' + i}, 'auto', 'generic-md', '/x', '[]', '{}', '[]', ${`2026-0${i + 1}-01T00:00:00.000Z`}, 2)`)
      insertCandidates(db, 's' + i, synth(5), 0)
      insertDirs(db, 's' + i, [{ path: '.', parent: null, name: '.', depth: 0, skippedClass: null, fileCount: 5, aliasOf: null }])
    }
    db.run(sql`INSERT INTO data_port_jobs (id, status, source_profile, scan_id, selection_json, stats_json, created_at, updated_at)
      VALUES ('j1', 'running', 'auto', 's1', '[]', '{}', ${now}, ${now})`)
    expect(pruneScans(db, { keepNewest: 2, keepDays: 0 })).toBe(1)
    expect(countCandidates(db, 's0', {})).toBe(0)
    expect(countCandidates(db, 's1', {})).toBe(5)   // protected by the running job
    expect(countCandidates(db, 's2', {})).toBe(5); expect(countCandidates(db, 's3', {})).toBe(5)
    expect((db.all(sql`SELECT count(*) AS n FROM data_port_scan_dirs WHERE scan_id = 's0'`) as any[])[0].n).toBe(0)
    expect((db.all(sql`SELECT candidate_count FROM data_port_scans WHERE id = 's0'`) as any[])[0].candidate_count).toBe(0)
    expect(pruneScans(db, { keepNewest: 2, keepDays: 0 })).toBe(0)  // idempotent
  })
})

describe('candidates store — fix round 1', () => {
  it('joins a transaction the caller already owns instead of throwing', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    // What P-9's scan sink does: one BEGIN IMMEDIATE, several flushes inside it.
    db.run(sql.raw('BEGIN IMMEDIATE'))
    let seq = insertCandidates(db, 's1', synth(3), 0)
    seq = insertCandidates(db, 's1', synth(2).map((c) => ({ ...c, id: `x${c.id}` })), seq)
    insertDirs(db, 's1', [{ path: '.', parent: null, name: '.', depth: 0, skippedClass: null, fileCount: 5, aliasOf: null }])
    db.run(sql.raw('COMMIT'))
    expect(seq).toBe(5)
    expect(countCandidates(db, 's1', {})).toBe(5)
    // The caller still owns the transaction: nothing was committed early, and
    // rolling one back must lose the rows written inside it.
    db.run(sql.raw('BEGIN IMMEDIATE'))
    insertCandidates(db, 's2', synth(4), 0)
    db.run(sql.raw('ROLLBACK'))
    expect(countCandidates(db, 's2', {})).toBe(0)
  })

  it('walks the cause chain: drizzle hides the driver phrase from err.message', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    db.run(sql.raw('BEGIN IMMEDIATE'))
    let caught: unknown
    try { db.run(sql.raw('BEGIN IMMEDIATE')) } catch (err) { caught = err }
    db.run(sql.raw('ROLLBACK'))
    // The regression this guards: a check against `.message` alone is false here.
    expect(/within a transaction/i.test(String((caught as Error).message))).toBe(false)
    expect(/within a transaction/i.test(String(((caught as Error).cause as Error | undefined)?.message ?? ''))).toBe(true)
  })

  it('fails closed on a locked database rather than reading SQLITE_BUSY as nesting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-dp-'))
    const file = join(dir, 'scan.sqlite')
    const open = () => {
      if (isBun) {
        const { Database } = require('bun:sqlite')
        const { drizzle } = require('drizzle-orm/bun-sqlite')
        const raw = new Database(file); raw.run('PRAGMA busy_timeout = 0')
        return { db: drizzle(raw), close: () => raw.close() }
      }
      const BetterSqlite3 = require('better-sqlite3')
      const { drizzle } = require('drizzle-orm/better-sqlite3')
      const raw = new BetterSqlite3(file); raw.pragma('busy_timeout = 0')
      return { db: drizzle(raw), close: () => raw.close() }
    }
    const holder = open(); const writer = open()
    try {
      createDataPortTables(holder.db)
      holder.db.run(sql.raw('BEGIN IMMEDIATE'))          // another connection owns the write lock
      // Not our transaction, so this must propagate — never carry on un-transacted.
      expect(() => insertCandidates(writer.db, 's1', synth(3), 0)).toThrow()
      expect(countCandidates(writer.db, 's1', {})).toBe(0)
      holder.db.run(sql.raw('ROLLBACK'))
      // Lock released: the very same call now succeeds, so the throw was the lock.
      expect(insertCandidates(writer.db, 's1', synth(3), 0)).toBe(3)
      expect(countCandidates(writer.db, 's1', {})).toBe(3)
    } finally {
      holder.close(); writer.close(); rmSync(dir, { recursive: true, force: true })
    }
  })

  it('caps byFolder and accounts for every row it does not list', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    // One file per folder: the shape where an uncapped byFolder would return the whole scan.
    insertCandidates(db, 's1', Array.from({ length: 1000 }, (_, i) => ({
      id: `c${i}`, relativePath: `home/d${i}/f${i}.md`, kind: 'memory', target: 'vault.semantic', title: `n${i}`, preview: '',
      bytes: 1, confidence: 0.5, reason: 'r', reasonCode: 'memory-note', selectedByDefault: i % 2 === 0,
    }) as ScanCandidate), 0)
    const c = candidateCounts(db, 's1', {})
    expect(c.total).toBe(1000)
    expect(c.byFolder).toHaveLength(COUNT_FOLDER_LIMIT)
    expect(c.folders).toMatchObject({ distinct: 1000, shown: COUNT_FOLDER_LIMIT, limit: COUNT_FOLDER_LIMIT })
    // Nothing is misrepresented: the listed rows plus the remainder are the whole.
    expect(c.byFolder.reduce((a, f) => a + f.total, 0) + c.folders.other.total).toBe(c.total)
    expect(c.byFolder.reduce((a, f) => a + f.importable, 0) + c.folders.other.importable).toBe(c.importable)
    expect(c.byFolder.reduce((a, f) => a + f.selectedByDefault, 0) + c.folders.other.selectedByDefault).toBe(c.selectedByDefault)
    expect(JSON.stringify(c).length).toBeLessThan(60_000)
    // Under the cap there is no remainder at all.
    const few = candidateCounts(db, 's1', { folder: 'home/d7' })
    expect(few.folders).toMatchObject({ distinct: 1, shown: 1 })
    expect(few.folders.other).toEqual({ total: 0, importable: 0, selectedByDefault: 0 })
  })

  it('aggregates a child subtree whatever the caller asked about subtree', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    const at = (id: string, rel: string): ScanCandidate => ({
      id, relativePath: rel, kind: 'memory', target: 'vault.semantic', title: id, preview: '', bytes: 1,
      confidence: 0.5, reason: 'r', reasonCode: 'memory-note', selectedByDefault: true,
    } as ScanCandidate)
    insertCandidates(db, 's1', [
      ...Array.from({ length: 15 }, (_, i) => at(`a${i}`, `notes/alpha/deep/x${i}.md`)),
      ...Array.from({ length: 3 }, (_, i) => at(`b${i}`, `notes/bravo/y${i}.md`)),
      at('own', 'notes/own.md'),
    ], 0)
    insertDirs(db, 's1', [
      { path: 'notes', parent: '.', name: 'notes', depth: 1, skippedClass: null, fileCount: 1, aliasOf: null },
      { path: 'notes/alpha', parent: 'notes', name: 'alpha', depth: 2, skippedClass: null, fileCount: 0, aliasOf: null },
      { path: 'notes/bravo', parent: 'notes', name: 'bravo', depth: 2, skippedClass: null, fileCount: 3, aliasOf: null },
      { path: 'notes/alpha/deep', parent: 'notes/alpha', name: 'deep', depth: 3, skippedClass: null, fileCount: 15, aliasOf: null },
    ])
    const totals = (f: Parameters<typeof listDirs>[3]) => listDirs(db, 's1', 'notes', f).map((k) => [k.name, k.subtree.total])
    expect(totals({})).toEqual([['alpha', 15], ['bravo', 3]])
    // The regression: `subtree: false` used to narrow the WHERE to `folder = 'notes'`
    // and report every child as 0. The parent argument alone decides the scope.
    expect(totals({ subtree: false })).toEqual([['alpha', 15], ['bravo', 3]])
    expect(totals({ subtree: true })).toEqual([['alpha', 15], ['bravo', 3]])
    // A caller's stray `folder` is overridden too, but its other fields still apply.
    expect(totals({ folder: 'somewhere/else' })).toEqual([['alpha', 15], ['bravo', 3]])
    expect(totals({ kind: ['session'] })).toEqual([['alpha', 0], ['bravo', 0]])
    expect(listDirs(db, 's1', 'notes', {}).map((k) => k.hasChildren)).toEqual([true, false])
  })
})
