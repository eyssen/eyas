// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Every SQL statement touching data_port_candidates / data_port_scan_dirs.
// Dynamic WHERE via sql.join, LIMIT/OFFSET via sql.raw(String(int)) after
// clamping (memory-service.ts precedent). Never string-concatenate user input.

import { sql, type SQL } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { CANDIDATE_PAGE_MAX, SCAN_RETENTION } from './constants.js'
import { isNestedTransactionError } from './ledger.js'
import {
  reasonPrefix,
  type CandidateCounts,
  type CandidateFilter,
  type DirectoryClass,
  type PublicCandidate,
  type ScanCandidate,
  type ScanDirRow,
} from './types.js'

/** A row as it comes back from the table: the scan's emission order and its folder are facts of the store. */
export type StoredCandidate = ScanCandidate & { seq: number; folder: string; importable: boolean }

/** POSIX dirname of a scan-relative path; `.` at the root. Backslashes are normalised first. */
export function folderOf(relativePath: string): string {
  const p = relativePath.replace(/\\/g, '/')
  const at = p.lastIndexOf('/')
  return at < 0 ? '.' : p.slice(0, at)
}

const INSERT_CHUNK = 200 // × 35 columns = 7 000 params < 32 766 (better-sqlite3)
const IN_CHUNK = 500
const ITERATE_BATCH_MAX = 5_000
const b = (v: boolean) => (v ? 1 : 0)
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))

/**
 * One `BEGIN IMMEDIATE` around a batch of writes, unless the caller already
 * opened one — the scan sink batches inside its own transaction (P-9), and
 * nesting is not an error there, it is the normal case.
 *
 * Only the caller's own transaction is a reason to carry on un-begun. Every
 * other `BEGIN IMMEDIATE` failure — SQLITE_BUSY above all, which fails exactly
 * the same way — fails closed before a row is written, rather than running the
 * batch un-transacted on a locked database. `isNestedTransactionError` walks
 * the cause chain, which is the only place drizzle leaves the driver's phrase.
 */
function withTransaction(db: EyasDb, fn: () => void): void {
  let began = false
  try {
    db.run(sql.raw('BEGIN IMMEDIATE'))
    began = true
  } catch (err) {
    if (!isNestedTransactionError(err)) throw err
  }
  try {
    fn()
    if (began) db.run(sql.raw('COMMIT'))
  } catch (err) {
    if (began) {
      try { db.run(sql.raw('ROLLBACK')) } catch { /* already gone */ }
    }
    throw err
  }
}

/** Appends `rows` at `startSeq` and answers the next free seq, so a streaming scan can carry on. */
export function insertCandidates(db: EyasDb, scanId: string, rows: ScanCandidate[], startSeq: number): number {
  let seq = startSeq
  withTransaction(db, () => {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK)
      const values = chunk.map((c) => {
        const folder = folderOf(c.relativePath)
        return sql`(${scanId}, ${c.id}, ${seq++}, ${c.relativePath}, ${c.classifiedPath ?? null}, ${folder}, ${folder === '.' ? 0 : folder.split('/').length},
          ${c.kind}, ${c.target}, ${b(c.target !== 'none')}, ${c.title}, ${c.preview}, ${c.bytes}, ${c.confidence}, ${c.reason}, ${c.reasonCode}, ${reasonPrefix(c.reasonCode)},
          ${b(c.selectedByDefault)}, ${`${c.relativePath} ${c.title}`.toLowerCase()}, ${c.scope ?? null}, ${c.unit ?? null}, ${c.turns ?? null}, ${c.sessionId ?? null}, ${c.sessionDate ?? null},
          ${c.adapterId ?? null}, ${c.sourcePath ?? null}, ${c.sha256 ?? null}, ${c.mtime ?? null}, ${c.birthtime ?? null},
          ${JSON.stringify(c.tags ?? [])}, ${JSON.stringify(c.warnings ?? [])}, ${j(c.directory)}, ${j(c.paths)}, ${j(c.assets)}, ${j(c.notBundled)})`
      })
      db.run(sql`INSERT INTO data_port_candidates (scan_id, id, seq, relative_path, classified_path, folder, depth, kind, target, importable, title, preview, bytes, confidence,
        reason, reason_code, reason_prefix, selected_by_default, search_text, scope, unit, turns, session_id, session_date, adapter_id, source_path, sha256, mtime, birthtime,
        tags_json, warnings_json, directory_json, paths_json, assets_json, not_bundled_json) VALUES ${sql.join(values, sql`, `)}`)
    }
  })
  return seq
}

/** Directory rows are re-emitted when a later alias or count corrects one, so the write is idempotent. */
export function insertDirs(db: EyasDb, scanId: string, rows: ScanDirRow[]): void {
  withTransaction(db, () => {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const values = rows.slice(i, i + INSERT_CHUNK).map((d) =>
        sql`(${scanId}, ${d.path}, ${d.parent}, ${d.name}, ${d.depth}, ${d.skippedClass}, ${d.fileCount}, ${d.aliasOf})`)
      db.run(sql`INSERT OR REPLACE INTO data_port_scan_dirs (scan_id, path, parent, name, depth, skipped_class, file_count, alias_of) VALUES ${sql.join(values, sql`, `)}`)
    }
  })
}

/** LIKE wildcards in owner-supplied text are literals, not patterns. Every LIKE below carries `ESCAPE '\'`. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

const folderClause = (f: string): SQL =>
  f === '.' ? sql`1 = 1` : sql`(folder = ${f} OR folder LIKE ${escapeLike(f) + '/%'} ESCAPE '\\')`

const reasonClause = (r: string): SQL => (r.includes(':') ? sql`reason_code = ${r}` : sql`reason_prefix = ${r}`)

/**
 * The one place a `CandidateFilter` becomes SQL — so a count, a page, a
 * directory aggregate and the runner's keyset walk can never disagree about
 * what the filter means.
 *
 * How the list-valued fields combine, because the two readings differ and a
 * caller cannot tell from the type: `kind` and `reason` are OR within
 * themselves (`kind: ['memory', 'code']` = either), while `tag` is AND
 * (`tag: ['legacy', 'contains-secrets']` = a row carrying BOTH). Every field
 * is ANDed against every other. A tag is matched as its JSON-quoted form, so
 * `tag: ['session']` does not match a row tagged `session-part:1/of`.
 */
export function whereFor(scanId: string, filter: CandidateFilter, extra: { idsIn?: string[]; seqAfter?: number } = {}): SQL {
  const parts: SQL[] = [sql`scan_id = ${scanId}`]
  if (filter.kind?.length) parts.push(sql`kind IN (${sql.join(filter.kind.map((k) => sql`${k}`), sql`, `)})`)
  if (filter.excludeKinds?.length) parts.push(sql`kind NOT IN (${sql.join(filter.excludeKinds.map((k) => sql`${k}`), sql`, `)})`)
  if (filter.reason?.length) parts.push(sql`(${sql.join(filter.reason.map(reasonClause), sql` OR `)})`)
  if (filter.excludeReasons?.length) parts.push(sql`NOT (${sql.join(filter.excludeReasons.map(reasonClause), sql` OR `)})`)
  if (filter.folder !== undefined) parts.push(filter.subtree === false ? sql`folder = ${filter.folder}` : folderClause(filter.folder))
  if (filter.excludeFolders?.length) for (const f of filter.excludeFolders) parts.push(sql`NOT ${folderClause(f)}`)
  if (filter.selected !== undefined) parts.push(sql`selected_by_default = ${b(filter.selected)}`)
  if (filter.importable !== undefined) parts.push(sql`importable = ${b(filter.importable)}`)
  if (filter.tag?.length) for (const t of filter.tag) parts.push(sql`tags_json LIKE ${'%' + escapeLike(JSON.stringify(t)) + '%'} ESCAPE '\\'`)
  if (filter.q) parts.push(sql`search_text LIKE ${'%' + escapeLike(filter.q.toLowerCase()) + '%'} ESCAPE '\\'`)
  // An explicit empty id list selects nothing — never `id IN ()` (a syntax error) and never everything.
  if (extra.idsIn) parts.push(extra.idsIn.length ? sql`id IN (${sql.join(extra.idsIn.map((i) => sql`${i}`), sql`, `)})` : sql`1 = 0`)
  if (extra.seqAfter !== undefined) parts.push(sql`seq > ${extra.seqAfter}`)
  return sql.join(parts, sql` AND `)
}

const COLS = sql`scan_id, id, seq, relative_path, classified_path, folder, kind, target, importable, title, preview, bytes, confidence, reason, reason_code, selected_by_default, scope, unit, turns, session_id, session_date, adapter_id, source_path, sha256, mtime, birthtime, tags_json, warnings_json, directory_json, paths_json, assets_json, not_bundled_json`

export function rowToStored(r: any): StoredCandidate {
  const parse = (s: string | null) => (s ? JSON.parse(s) : undefined)
  return {
    id: r.id, seq: r.seq, relativePath: r.relative_path, ...(r.classified_path ? { classifiedPath: r.classified_path } : {}), folder: r.folder, kind: r.kind, target: r.target,
    importable: r.importable === 1, title: r.title, preview: r.preview, bytes: r.bytes, confidence: r.confidence, reason: r.reason, reasonCode: r.reason_code,
    selectedByDefault: r.selected_by_default === 1, ...(r.scope ? { scope: r.scope } : {}), unit: r.unit ?? null, turns: r.turns ?? null,
    sessionId: r.session_id ?? null, sessionDate: r.session_date ?? null, ...(r.adapter_id ? { adapterId: r.adapter_id } : {}),
    ...(r.source_path ? { sourcePath: r.source_path } : {}), ...(r.sha256 ? { sha256: r.sha256 } : {}), ...(r.mtime ? { mtime: r.mtime } : {}), ...(r.birthtime ? { birthtime: r.birthtime } : {}),
    tags: parse(r.tags_json) ?? [], warnings: parse(r.warnings_json) ?? [], ...(r.directory_json ? { directory: parse(r.directory_json) } : {}),
    ...(r.paths_json ? { paths: parse(r.paths_json) } : {}), ...(r.assets_json ? { assets: parse(r.assets_json) } : {}), ...(r.not_bundled_json ? { notBundled: parse(r.not_bundled_json) } : {}),
  }
}

/** What leaves the API: never the server path, never the body. */
export function toPublicCandidate(c: StoredCandidate): PublicCandidate {
  const { sourcePath: _sourcePath, content: _content, ...rest } = c
  return rest
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : lo)))

export function listCandidates(
  db: EyasDb,
  scanId: string,
  filter: CandidateFilter,
  page: { offset: number; limit: number; order: 'path' | 'seq' },
): { items: PublicCandidate[]; total: number } {
  const where = whereFor(scanId, filter)
  const order = page.order === 'seq' ? sql`seq ASC` : sql`relative_path ASC, seq ASC`
  const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE ${where} ORDER BY ${order} LIMIT ${sql.raw(String(clamp(page.limit, 1, CANDIDATE_PAGE_MAX)))} OFFSET ${sql.raw(String(clamp(page.offset, 0, Number.MAX_SAFE_INTEGER)))}`) as any[]
  return { items: rows.map((r) => toPublicCandidate(rowToStored(r))), total: countCandidates(db, scanId, filter) }
}

export function countCandidates(db: EyasDb, scanId: string, filter: CandidateFilter): number {
  return Number((db.all(sql`SELECT count(*) AS n FROM data_port_candidates WHERE ${whereFor(scanId, filter)}`) as any[])[0]?.n ?? 0)
}

/**
 * How many folders `byFolder` may carry. `kind` and `reason` are bounded by
 * their fixed vocabularies, but folders are open-ended: a home directory with
 * one note per folder has as many folders as candidates, and `CandidateCounts`
 * travels inside `ScanSummary`, which P-9 has the wizard poll once a second and
 * Task 9 persists in `data_port_scans.counts_json`. Counting must never
 * materialise one object per candidate, so `byFolder` is the top N by count and
 * everything below the cut is summed into `folders.other`. The browsable folder
 * tree is `listDirs`, which pages by parent and is bounded by construction.
 */
export const COUNT_FOLDER_LIMIT = 100

export interface FolderCountSummary {
  /** Distinct folders the filter holds — the true number, whatever `byFolder` shows. */
  distinct: number
  /** How many of them `byFolder` carries: `min(distinct, COUNT_FOLDER_LIMIT)`. */
  shown: number
  /** The cap that produced `shown`, so a client need not hard-code it. */
  limit: number
  /** Everything `byFolder` left out, summed — `sum(byFolder) + other` always equals the totals. */
  other: { total: number; importable: number; selectedByDefault: number }
}

/**
 * `CandidateCounts` plus the folder-cap bookkeeping. It widens the frozen type
 * rather than changing it, so anything typed `CandidateCounts` still accepts
 * this and a caller that needs the remainder can ask for it.
 */
export type StoredCandidateCounts = CandidateCounts & { folders: FolderCountSummary }

export function candidateCounts(db: EyasDb, scanId: string, filter: CandidateFilter = {}): StoredCandidateCounts {
  const where = whereFor(scanId, filter)
  const totals = (db.all(sql`SELECT count(*) AS total, coalesce(sum(importable), 0) AS importable, coalesce(sum(selected_by_default), 0) AS selected FROM data_port_candidates WHERE ${where}`) as any[])[0]
  const group = (col: SQL, limit?: number) =>
    (db.all(sql`SELECT ${col} AS key, count(*) AS total, coalesce(sum(importable), 0) AS importable, coalesce(sum(selected_by_default), 0) AS selectedByDefault
      FROM data_port_candidates WHERE ${where} GROUP BY key ORDER BY total DESC, key ASC${limit === undefined ? sql`` : sql` LIMIT ${sql.raw(String(clamp(limit, 1, 100_000)))}`}`) as any[])
      .map((r) => ({ key: String(r.key), total: Number(r.total), importable: Number(r.importable), selectedByDefault: Number(r.selectedByDefault) }))
  const total = Number(totals?.total ?? 0)
  const importable = Number(totals?.importable ?? 0)
  const selectedByDefault = Number(totals?.selected ?? 0)
  const byFolder = group(sql`folder`, COUNT_FOLDER_LIMIT)
  const distinct = Number((db.all(sql`SELECT count(DISTINCT folder) AS n FROM data_port_candidates WHERE ${where}`) as any[])[0]?.n ?? 0)
  const shownSum = byFolder.reduce(
    (a, f) => ({ total: a.total + f.total, importable: a.importable + f.importable, selectedByDefault: a.selectedByDefault + f.selectedByDefault }),
    { total: 0, importable: 0, selectedByDefault: 0 },
  )
  return {
    total,
    importable,
    selectedByDefault,
    byKind: group(sql`kind`),
    byReason: group(sql`reason_code`).map(({ key, total: n }) => ({ key, total: n })),
    byFolder,
    folders: {
      distinct,
      shown: byFolder.length,
      limit: COUNT_FOLDER_LIMIT,
      other: {
        total: total - shownSum.total,
        importable: importable - shownSum.importable,
        selectedByDefault: selectedByDefault - shownSum.selectedByDefault,
      },
    },
  }
}

export interface DirNode extends ScanDirRow {
  subtree: { total: number; importable: number; selectedByDefault: number }
  byKind: Record<string, number>
  byReason: Record<string, number>
  hasChildren: boolean
}

/** Children of `parent` with subtree aggregates under the current filter — one GROUP BY over the parent's subtree, keyed by next segment. */
export function listDirs(db: EyasDb, scanId: string, parent: string, filter: CandidateFilter): DirNode[] {
  const dirs = db.all(sql`SELECT path, parent, name, depth, skipped_class, file_count, alias_of, EXISTS(SELECT 1 FROM data_port_scan_dirs c WHERE c.scan_id = d.scan_id AND c.parent = d.path) AS has_children
    FROM data_port_scan_dirs d WHERE scan_id = ${scanId} AND parent = ${parent} ORDER BY name ASC`) as any[]
  // `length(?)` and NOT `parent.length`: `substr` and `instr` count CHARACTERS
  // while JavaScript's `String.length` counts UTF-16 code units, so a single
  // emoji anywhere in `parent` shifts the offset and the next segment is
  // extracted one character short — every child of that folder then joins to
  // nothing and the wizard's tree reports zero files under all of them. Let
  // the engine that slices do the counting.
  const start = sql`length(${parent}) + 2`
  const segment = parent === '.'
    ? sql`substr(folder, 1, instr(folder || '/', '/') - 1)`
    : sql`substr(folder, ${start}, instr(substr(folder, ${start}) || '/', '/') - 1)`
  // `parent` alone decides the scope here: the aggregate is per child SUBTREE by
  // definition, so a caller's `folder`/`subtree` must not survive into it. Left
  // in, `subtree: false` narrows the WHERE to the parent's own files and every
  // child reports zero — wrong numbers, silently, in the tree the owner selects
  // with. Every other field of the filter still applies.
  const { folder: _folder, subtree: _subtree, ...scoped } = filter
  const where = whereFor(scanId, { ...scoped, folder: parent })
  const agg = db.all(sql`SELECT ${segment} AS seg, kind, reason_prefix, count(*) AS total, sum(importable) AS importable, sum(selected_by_default) AS selected
    FROM data_port_candidates WHERE ${where} GROUP BY seg, kind, reason_prefix`) as any[]
  const bySeg = new Map<string, DirNode>()
  for (const d of dirs) {
    bySeg.set(d.name, {
      path: d.path, parent: d.parent, name: d.name, depth: d.depth, skippedClass: d.skipped_class as DirectoryClass | null,
      fileCount: d.file_count, aliasOf: d.alias_of,
      subtree: { total: 0, importable: 0, selectedByDefault: 0 }, byKind: {}, byReason: {}, hasChildren: d.has_children === 1,
    })
  }
  for (const a of agg) {
    const node = bySeg.get(a.seg)
    if (!node) continue
    node.subtree.total += Number(a.total)
    node.subtree.importable += Number(a.importable)
    node.subtree.selectedByDefault += Number(a.selected)
    node.byKind[a.kind] = (node.byKind[a.kind] ?? 0) + Number(a.total)
    node.byReason[a.reason_prefix] = (node.byReason[a.reason_prefix] ?? 0) + Number(a.total)
  }
  return [...bySeg.values()]
}

export function getCandidate(db: EyasDb, scanId: string, id: string): StoredCandidate | null {
  const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE scan_id = ${scanId} AND id = ${id}`) as any[]
  return rows.length ? rowToStored(rows[0]) : null
}

/** Answers in the caller's order; an id the scan does not hold is dropped, never a hole. */
export function getCandidatesByIds(db: EyasDb, scanId: string, ids: string[]): StoredCandidate[] {
  const found = new Map<string, StoredCandidate>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE ${whereFor(scanId, {}, { idsIn: ids.slice(i, i + IN_CHUNK) })}`) as any[]
    for (const r of rows) found.set(r.id, rowToStored(r))
  }
  return ids.map((id) => found.get(id)).filter((c): c is StoredCandidate => Boolean(c))
}

/** Keyset paging on seq — never OFFSET; the table is immutable once the scan is done. */
export function* iterateCandidates(db: EyasDb, scanId: string, filter: CandidateFilter, batch = 500, fromSeq = -1): Generator<StoredCandidate[]> {
  let last = fromSeq
  for (;;) {
    const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE ${whereFor(scanId, filter, { seqAfter: last })} ORDER BY seq ASC LIMIT ${sql.raw(String(clamp(batch, 1, ITERATE_BATCH_MAX)))}`) as any[]
    if (!rows.length) return
    const out = rows.map(rowToStored)
    last = out[out.length - 1]!.seq
    yield out
  }
}

export function deleteScanRows(db: EyasDb, scanId: string): void {
  db.run(sql`DELETE FROM data_port_candidates WHERE scan_id = ${scanId}`)
  db.run(sql`DELETE FROM data_port_scan_dirs WHERE scan_id = ${scanId}`)
}

/** Drops candidate/dir rows of scans outside the newest N AND older than D days, never one a pending/running job references. */
export function pruneScans(db: EyasDb, retention: { keepNewest: number; keepDays: number } = SCAN_RETENTION): number {
  const cutoff = new Date(Date.now() - retention.keepDays * 86_400_000).toISOString()
  const victims = db.all(sql`SELECT id FROM data_port_scans s WHERE created_at < ${cutoff}
    AND id NOT IN (SELECT id FROM data_port_scans ORDER BY created_at DESC LIMIT ${sql.raw(String(clamp(retention.keepNewest, 0, 1000)))})
    AND NOT EXISTS (SELECT 1 FROM data_port_jobs j WHERE j.scan_id = s.id AND j.status IN ('pending', 'running'))
    AND EXISTS (SELECT 1 FROM data_port_candidates c WHERE c.scan_id = s.id)`) as Array<{ id: string }>
  for (const v of victims) {
    deleteScanRows(db, v.id)
    db.run(sql`UPDATE data_port_scans SET candidate_count = 0 WHERE id = ${v.id}`)
  }
  return victims.length
}
