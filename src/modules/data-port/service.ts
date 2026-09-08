// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { sql } from 'drizzle-orm'
import { stringify as stringifyYaml } from 'yaml'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { CheapModelPassContext } from '@modules/model/cheap-pass.js'
import {
  parseFrontmatter as parseWorkspaceFrontmatter,
  stripFrontmatter as stripWorkspaceFrontmatter,
} from '@modules/prompt-wizard/frontmatter.js'
import { SECRETS_TAG } from '@modules/memory/memory-index.js'
import {
  JOB_BATCH_SIZE,
  PROJECT_TYPE_AGENT_ID,
  SCAN_FLUSH_ROWS,
  STRING_LIMIT_BYTES,
  UPLOAD_BODY_BYTES,
} from './constants.js'
import { addPathTo, scanDirectory, scanDirectoryEvents, type ScanEvent } from './scanners/scan-path.js'
import { failureReason } from './errors.js'
import { looksLikeSecrets } from './scanners/heuristics.js'
import {
  candidateCounts,
  countCandidates,
  deleteScanRows,
  escapeLike,
  folderOf,
  getCandidate,
  getCandidatesByIds,
  insertCandidates,
  insertDirs,
  iterateCandidates,
  listCandidates,
  listDirs,
  pruneScans,
  toPublicCandidate,
  type DirNode,
  type StoredCandidate,
  type StoredCandidateCounts,
} from './candidates-store.js'
import { compileSelection, normaliseSelection } from './selection.js'
import {
  applyInstructionHints,
  inferProfileFromInstructions,
  normalizeInstructions,
} from './scanners/instructions.js'
import { adapterFor } from './adapters/registry.js'
import { parseMemoryIndex } from './memory-index-hooks.js'
import type { IndexEntry } from './memory-index-hooks.js'
import { readSourceNote, splitFrontmatter } from './source-frontmatter.js'
import { buildSkillFromPackage } from './skill-package.js'
import {
  hasLedgerRef,
  isNestedTransactionError,
  recordApplied,
  type AppliedKind,
} from './ledger.js'
import { rollbackJob, type RollbackDeps, type RollbackResult } from './rollback.js'
import { enrichMemory, normalizeMemory } from './pipeline/transform.js'
import {
  applyMemoryItem,
  applyPersonaItem,
  applySkillItem,
  applyWorkspaceProposal,
  slugFromSource,
  type ApplyDeps,
  type ApplyResult,
} from './pipeline/apply.js'
import type { ExpandedUnit, SourceNote } from './adapters/types.js'
import { DIRECTORY_CLASSES } from './types.js'
import type {
  CandidateFilter,
  CandidateTarget,
  DirectoryClass,
  ImportJob,
  ImportJobSelection,
  ImportJobStats,
  PublicCandidate,
  ReasonCode,
  ScanCandidate,
  ScanDirRow,
  ScanResult,
  ScanStats,
  ScanStatus,
  ScanSummary,
  ScanWarning,
  SelectionWire,
  SkillAsset,
  SourceProfile,
  WorkspaceProposal,
} from './types.js'

/** Targets that never write directly: the owner approves the change first. */
const WORKSPACE_TARGETS = new Set<CandidateTarget>([
  'workspace.agents',
  'workspace.soul',
  'workspace.identity',
  'workspace.tools',
  'workspace.memory',
  'prompt.project-type',
])

/** Memory targets — the only ones the deterministic normalizer runs for. */
const MEMORY_TARGETS = new Set<CandidateTarget>(['episodic', 'vault.semantic', 'vault.procedural'])

/**
 * How much of a file the preview endpoint may ever read in one answer (P-11).
 * A transport bound on one response, not a limit on what may be imported: the
 * apply path still reads every byte of the same file.
 */
const PREVIEW_MAX_BYTES = 1024 * 1024

/** Rows scanned per streaming pass of the selection resolver. */
const SELECTION_SCAN_BATCH = 5_000

/** Reason codes whose row is listed from `stat` and never read (R11.2/R11.3). */
const NEVER_READ_CODES = new Set(['binary', 'derived-index', 'app-state'])

// The helper lives in a leaf module (see `errors.ts`); re-exported here so
// every existing `import { failureReason } from './service.js'` still resolves.
export { failureReason }

/** An apply step's result kind, in the ledger's own vocabulary. */
function ledgerKind(kind: string): AppliedKind {
  return kind === 'episodic' || kind === 'skill' || kind === 'agent' ? kind : 'vault'
}

/**
 * The kebab code the UI translates (`settings.dataPort.reason.<code>`), derived
 * from the English reason an apply step returned. The reason itself stays in the
 * log; the code is what the result panel counts and shows.
 *
 * The return type is `ReasonCode`, so every branch answers from the one fixed
 * vocabulary in types.ts and a key invented here does not compile — it would
 * otherwise reach the operator untranslated. A new situation is mapped onto the
 * closest listed code, and the detail stays in the logged reason.
 */
function skipCodeFor(reason: string): ReasonCode {
  const r = reason.toLowerCase()
  if (r.startsWith('empty body')) return 'empty'
  if (r.endsWith('unavailable')) return 'service-unavailable'
  if (r.startsWith('unsupported memory target') || r.startsWith('not a workspace target')) {
    return 'unsupported-target'
  }
  if (r.includes('not a persona')) return 'not-a-persona'
  if (r.startsWith('no agent available')) return 'no-agent'
  return 'not-importable'
}

function emptyStats(): ImportJobStats {
  return {
    total: 0,
    processed: 0,
    applied: 0,
    skipped: 0,
    unchanged: 0,
    proposals: 0,
    errors: 0,
    aiEnriched: 0,
    aiFallback: 0,
    byKind: {},
    skippedReasons: {},
    elapsedMs: 0,
    resumed: 0,
  }
}

/** A scan header before a single directory has been walked (P-9). */
function emptyScanStats(): ScanStats {
  return {
    filesScanned: 0,
    filesSkipped: 0,
    totalBytes: 0,
    dirsVisited: 0,
    dirsSkipped: Object.fromEntries(DIRECTORY_CLASSES.map((c) => [c, 0])) as Record<DirectoryClass, number>,
    filesInSkippedDirs: 0,
    symlinksFollowed: 0,
    symlinkAliases: 0,
    symlinkCycles: 0,
    unreadable: 0,
    largeFiles: 0,
    scanMs: 0,
  }
}

/**
 * Cuts a byte range back to the last COMPLETE UTF-8 sequence, so a preview
 * never ends in a replacement character. A head read at an arbitrary offset
 * lands mid-character as a matter of course; dropping the partial sequence is
 * the only honest answer (P-11).
 */
function cutToUtf8Boundary(buf: Buffer): Buffer {
  if (buf.length === 0) return buf
  let i = buf.length - 1
  let continuations = 0
  while (i >= 0 && (buf[i]! & 0xc0) === 0x80 && continuations < 3) {
    i--
    continuations++
  }
  if (i < 0) return buf.subarray(0, 0)
  const lead = buf[i]!
  const needed = lead < 0x80 ? 1 : lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
  return continuations + 1 < needed ? buf.subarray(0, i) : buf
}

/**
 * The directory rows a migrated pre-R11 scan needs so its folder tree can be
 * browsed (P-12). A `format = 1` blob carried no directory list, so the chain
 * of every candidate's folder is rebuilt; none of them is a skipped class,
 * because the old scanner never recorded one.
 */
function dirsFromFolders(rootName: string, relativePaths: string[]): ScanDirRow[] {
  const seen = new Set<string>()
  const out: ScanDirRow[] = [
    { path: '.', parent: null, name: rootName, depth: 0, skippedClass: null, fileCount: 0, aliasOf: null },
  ]
  const add = (path: string): void => {
    if (path === '.' || seen.has(path)) return
    seen.add(path)
    const at = path.lastIndexOf('/')
    const parent = at < 0 ? '.' : path.slice(0, at)
    add(parent)
    out.push({
      path,
      parent,
      name: at < 0 ? path : path.slice(at + 1),
      depth: path.split('/').length,
      skippedClass: null,
      fileCount: 0,
      aliasOf: null,
    })
  }
  for (const rel of relativePaths) add(folderOf(rel))
  return out
}

/**
 * A-20 — `pruneScans` compares `created_at` as an ISO string, so a legacy row
 * written in any other shape would sort unpredictably against the retention
 * cutoff. A timestamp that parses is rewritten as ISO; one that does not is
 * left alone rather than replaced with a guess that could delete it early.
 */
function normaliseTimestamp(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return null
  const iso = new Date(at).toISOString()
  return iso === raw ? null : iso
}

function rowToJob(row: any): ImportJob {
  return {
    id: row.id,
    status: row.status,
    sourceProfile: row.source_profile,
    scanId: row.scan_id,
    instructions: row.instructions ?? null,
    phase: row.phase,
    progress: row.progress,
    stats: { ...emptyStats(), ...JSON.parse(row.stats_json || '{}') },
    error: row.error ?? null,
    // How the selection reached the job (P-10) and how far the runner got
    // through it — a restart resumes from `cursorSeq` rather than starting over.
    selectionMode: row.selection_mode === 'wire' ? 'wire' : 'ids',
    selectionTotal: Number(row.selection_total ?? 0),
    cursorSeq: Number(row.cursor_seq ?? -1),
    startedAt: row.started_at ?? null,
    importMs: row.import_ms === null || row.import_ms === undefined ? null : Number(row.import_ms),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? null,
  }
}

/**
 * What `GET /scans/:id/candidates/:cid/preview` answers (P-11). The absolute
 * path is read off the stored row and never travels: `candidate` is the public
 * shape, and `head` is a UTF-8-safe cut of the file's first bytes — verbatim,
 * secrets included, because D-7 is a rule about RECALL, not about the owner
 * looking at their own file before importing it.
 */
export interface CandidatePreview {
  candidate: PublicCandidate
  /**
   * `utf-8` — `head` holds the file's first bytes. `binary` — a row listed from
   * stat and never read. `directory` — a `directory-skipped:*` row, whose
   * `children` are its first entries. `unreadable` — the file is gone or
   * refused. `none` — a row with no file behind it at all. `not-downloaded` —
   * the bytes are not on this machine and inspecting must not fetch them (A-79).
   */
  encoding: 'utf-8' | 'binary' | 'directory' | 'unreadable' | 'none' | 'not-downloaded'
  head: string | null
  /** Bytes of `head` after the UTF-8 cut; `size` is the file on disk. */
  bytes: number
  size: number
  truncated: boolean
  frontmatter?: Record<string, unknown>
  children?: string[]
  error?: string
}

/** What `POST /scans/:id/selection/count` answers — resolved server-side, never as ids. */
export interface SelectionCountResult {
  selected: number
  byKind: Record<string, number>
  /**
   * Subtree-inclusive, unlike `CandidateCounts.byFolder`, which counts a
   * folder's OWN rows: a count asked for `notes` here includes everything
   * beneath it, because that is the gesture the wizard's tree makes.
   */
  byFolder: Record<string, number>
}

/**
 * The wizard asks for a selection count on every gesture, so a walk still in
 * flight is abandoned when a newer one arrives. That is a race the client
 * caused by asking again — not a server fault — so the route answers 409 and
 * observability does not count it as an error.
 */
export class SelectionCountSuperseded extends Error {
  constructor() {
    super('Superseded by a newer selection count')
    this.name = 'SelectionCountSuperseded'
  }
}

/**
 * The one reason `cancelScan` refuses: an import is reading these rows. It is a
 * conflict the owner can resolve by waiting; anything ELSE that throws out of
 * `cancelScan` is a real failure and must not be dressed up as one, or a locked
 * database reads to the operator as "a job is using this scan".
 */
export class ScanInUse extends Error {
  constructor() {
    super('Scan is in use by a running import')
    this.name = 'ScanInUse'
  }
}

/**
 * `agentName` is resolved through the caller's lookup, never joined in SQL: the
 * project-type sentinel is not an agent id (A15.7), so it must never reach
 * `agent_definitions` — it answers `null`, as does an agent that has been deleted.
 */
function rowToProposal(row: any, agentName?: (id: string) => string | null): WorkspaceProposal {
  return {
    id: row.id,
    jobId: row.job_id,
    agentId: row.agent_id,
    workspaceFile: row.workspace_file,
    title: row.title,
    proposedBody: row.proposed_body,
    existingBody: row.existing_body ?? null,
    status: row.status,
    agentName:
      row.agent_id === PROJECT_TYPE_AGENT_ID ? null : (agentName?.(row.agent_id) ?? null),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

export interface DataPortServiceDeps {
  db: EyasDb
  modelCtx: CheapModelPassContext
  applyDepsFactory: () => ApplyDeps
  /** Display name of an agent, for proposal rows. Absent = every row reports `null`. */
  agentName?: (id: string) => string | null
  dataDir?: string
  logger?: { info: Function; warn: Function; error: Function; debug: Function }
}

export function createDataPortService(deps: DataPortServiceDeps) {
  const dataDir = deps.dataDir ?? 'data'
  const tmpRoot = join(dataDir, 'tmp', 'data-port')
  mkdirSync(tmpRoot, { recursive: true })

  // ── Scans: a header row first, then rows streamed into the table ─────
  /**
   * Scans this process is driving, so a DELETE can stop one cooperatively
   * (P-8). A scan another process started has no entry here and is purged
   * outright instead.
   */
  const running = new Map<string, { cancelled: boolean }>()

  /**
   * One selection count in flight per scan; a newer request supersedes the one
   * before it rather than queueing behind a walk of the whole table.
   */
  const counting = new Map<string, symbol>()

  /**
   * The profile the scan settles on. Instructions may name one outright, and an
   * `auto` scan then files its notes under that rather than under the word
   * "auto".
   */
  function profileWithInstructions(
    sourceProfile: SourceProfile,
    instructions: string | null,
    detected: SourceProfile,
  ): SourceProfile {
    const named = inferProfileFromInstructions(sourceProfile, instructions)
    return sourceProfile === 'auto' && named !== 'auto' ? named : detected
  }

  /**
   * The scan's own row, written before a single directory is walked (P-9), so
   * the wizard has something to poll from the moment the 202 leaves and the
   * drive has a row to report progress on. `candidates_json` is `'[]'` for
   * every scan this build writes: `format = 2` means the rows are in the table.
   */
  function insertScanHeader(input: {
    scanId: string
    sourceProfile: SourceProfile
    detectedProfile: SourceProfile
    rootPath: string
    instructions: string | null
    status: ScanStatus
    stats: ScanStats
    warnings: ScanWarning[]
  }): void {
    const now = new Date().toISOString()
    deps.db.run(sql`INSERT INTO data_port_scans
      (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json,
       instructions, created_at, status, progress_json, format, candidate_count)
      VALUES (
        ${input.scanId}, ${input.sourceProfile}, ${input.detectedProfile}, ${input.rootPath}, '[]',
        ${JSON.stringify(input.stats)}, ${JSON.stringify(input.warnings)}, ${input.instructions},
        ${now}, ${input.status}, NULL, 2, 0
      )`)
  }

  /** The walk is over: the header takes the scanner's own stats, counts and warnings. */
  function finishScan(
    scanId: string,
    result: Omit<ScanResult, 'candidates' | 'dirs'>,
    sourceProfile: SourceProfile,
    instructions: string | null,
    status: ScanStatus,
  ): void {
    const warnings = [...result.warnings]
    if (instructions) {
      warnings.unshift({
        code: 'instructions-applied',
        message: 'User instructions applied to ranking and default selection',
      })
    }
    const count = countCandidates(deps.db, scanId, {})

    // A-84. Placeholder detection keys on `st_blocks`, and this platform never
    // demonstrated that it populates the field — no file in the whole scan had
    // bytes and blocks at once. Rather than guess, the scan classified those
    // files normally, which is what it did before the signal existed. Said once,
    // with the count, so nobody has to wonder why the feature looks inactive.
    if (result.stats.datalessUnverified) {
      deps.logger?.warn?.(
        { scanId, files: result.stats.datalessUnverified, platform: process.platform },
        'data-port: cloud-placeholder detection inactive — this platform did not demonstrate that stat() reports allocated blocks, so files that looked dematerialised were classified normally',
      )
    }

    // Old scans lose their rows HERE rather than on a timer: the store grows
    // only while scans are being made, so that is when it is worth trimming.
    //
    // It runs BEFORE the header write, not after (A-53). Failing the scan for a
    // tidy-up would trade the deliverable for the chore, so it is fail-soft —
    // but a log line is not a channel the owner reads, and a sweep that fails
    // silently fails on every scan while the table keeps rows it should drop.
    // Running it first means the warning reaches `warnings_json` in the same
    // write, instead of needing a second UPDATE after the row is already
    // written. The scan being finished cannot be its own victim: `pruneScans`
    // only touches rows older than the retention cutoff.
    try {
      pruneScans(deps.db)
    } catch (err) {
      const reason = failureReason(err)
      deps.logger?.warn?.({ err: reason }, 'data-port: scan retention sweep failed')
      warnings.push({
        code: 'retention-sweep-failed',
        params: { reason },
        message: 'Old scans could not be tidied up; the scan itself is unaffected.',
      })
    }

    deps.db.run(sql`UPDATE data_port_scans SET
      status = ${status},
      detected_profile = ${profileWithInstructions(sourceProfile, instructions, result.detectedProfile)},
      stats_json = ${JSON.stringify(result.stats)},
      warnings_json = ${JSON.stringify(warnings)},
      scan_ms = ${result.stats.scanMs},
      finished_at = ${new Date().toISOString()},
      candidate_count = ${count},
      counts_json = ${JSON.stringify(candidateCounts(deps.db, scanId, {}))},
      progress_json = NULL
      WHERE id = ${scanId}`)
  }

  /**
   * Drives the event stream into the table in the background (P-9/P-18):
   * `SCAN_FLUSH_ROWS` rows per `BEGIN IMMEDIATE`, one `setImmediate` between
   * flushes so the server keeps answering, and progress written on the scan's
   * own row. Nothing is collected — a row leaves memory at the next flush, and
   * an alias path that arrives afterwards reaches it by `UPDATE`.
   *
   * Instruction hints are applied per flushed batch. They only ever promote a
   * row, so batching them changes nothing a whole-list pass would have decided.
   */
  async function driveScan(
    scanId: string,
    gen: Generator<ScanEvent>,
    sourceProfile: SourceProfile,
    instructions: string | null,
  ): Promise<void> {
    // The slot may already be there: `scanPath` claims it before the drive is
    // scheduled, so a DELETE that lands in the gap between the 202 and the
    // first tick is still observed here rather than purging rows the drive is
    // about to write again.
    let state = running.get(scanId)
    if (!state) {
      state = { cancelled: false }
      running.set(scanId, state)
    }
    const started = Date.now()
    let seq = 0
    let rows: ScanCandidate[] = []
    let dirs: ScanDirRow[] = []
    // Bytes of every row LISTED, which includes files the scan never read (a
    // binary, a skipped directory). The walker's own `bytes` counts only what
    // it read, and a progress bar that ignores whole classes of file looks
    // stalled — so this one number is the service's, and the other three on
    // the progress row are the walker's (M-9).
    let bytes = 0
    /** The last counters the walker reported, so a failed scan can say how far it got (M-2). */
    let seen = { dirsVisited: 0, filesSeen: 0 }
    /**
     * What actually reached the table. The walker's counters only arrive with a
     * progress tick — every 500 files — so a scan that dies before the first
     * one would otherwise report `filesScanned: 0` beside 500 committed rows.
     * A container expands to many rows per file, which is exactly when a flush
     * happens long before a tick does.
     */
    let rowsWritten = 0
    let dirsWritten = 0
    /**
     * Rows not yet flushed, by id: a patch for one of them is applied in
     * memory, a patch for a flushed row by `UPDATE`.
     */
    const pending = new Map<string, ScanCandidate>()
    const flush = (): void => {
      if (rows.length) {
        seq = insertCandidates(deps.db, scanId, applyInstructionHints(rows, instructions), seq)
        rowsWritten = seq
        rows = []
        pending.clear()
      }
      if (dirs.length) {
        const n = dirs.length
        insertDirs(deps.db, scanId, dirs)
        dirsWritten += n
        dirs = []
      }
    }
    // JSON1 (built into bun:sqlite and better-sqlite3): append one path to
    // `paths_json`, seeding it with the row's own path when it has none yet.
    const patchPath = (id: string, path: string): void => {
      const row = pending.get(id)
      if (row) {
        addPathTo(row, path)
        return
      }
      deps.db.run(sql`UPDATE data_port_candidates
        SET paths_json = json_insert(coalesce(paths_json, json_array(relative_path)), '$[#]', ${path})
        WHERE scan_id = ${scanId} AND id = ${id}`)
    }
    const aliasDir = (realRel: string, aliasRel: string): void => {
      if (realRel === '.') {
        deps.db.run(sql`UPDATE data_port_candidates
          SET paths_json = json_insert(coalesce(paths_json, json_array(relative_path)), '$[#]', ${aliasRel + '/'} || relative_path)
          WHERE scan_id = ${scanId}`)
        return
      }
      // `length(?)` and NOT `realRel.length`: SQLite's `substr` counts
      // CHARACTERS while JavaScript's `String.length` counts UTF-16 code
      // units, so one emoji in a folder name would make the offset one too
      // large and eat the separator — `emolink/c.md` stored as `emolinkc.md`.
      // The same function that does the slicing does the counting, so the two
      // cannot drift.
      deps.db.run(sql`UPDATE data_port_candidates
        SET paths_json = json_insert(coalesce(paths_json, json_array(relative_path)), '$[#]', ${aliasRel} || substr(relative_path, length(${realRel}) + 1))
        WHERE scan_id = ${scanId}
          AND (relative_path = ${realRel} OR relative_path LIKE ${escapeLike(realRel) + '/%'} ESCAPE '\\')`)
    }
    const purge = (): void => {
      deleteScanRows(deps.db, scanId)
      deps.db.run(sql`UPDATE data_port_scans
        SET status = 'cancelled', candidate_count = 0, counts_json = NULL, progress_json = NULL,
            finished_at = ${new Date().toISOString()}
        WHERE id = ${scanId}`)
    }
    try {
      for (const ev of gen) {
        if (state.cancelled) {
          flush()
          purge()
          return
        }
        if (ev.type === 'candidate') {
          rows.push(ev.candidate)
          pending.set(ev.candidate.id, ev.candidate)
          bytes += ev.candidate.bytes
          if (rows.length >= SCAN_FLUSH_ROWS) flush()
        } else if (ev.type === 'candidate-patch') {
          patchPath(ev.id, ev.addPath)
        } else if (ev.type === 'dir-alias') {
          flush()
          aliasDir(ev.realRel, ev.aliasRel)
        } else if (ev.type === 'dir') {
          dirs.push(ev.row)
        } else if (ev.type === 'progress') {
          flush()
          seen = { dirsVisited: ev.dirsVisited, filesSeen: ev.filesSeen }
          // The walker's own counters — files seen, folders visited — never the
          // row counter in their place: a tree of skipped classes visits far
          // more than it lists, and saying otherwise would look like a stall.
          deps.db.run(sql`UPDATE data_port_scans SET progress_json = ${JSON.stringify({
            dirsVisited: ev.dirsVisited,
            filesSeen: ev.filesSeen,
            candidates: ev.candidates,
            bytes,
            elapsedMs: Date.now() - started,
            currentDir: ev.currentDir,
          })} WHERE id = ${scanId}`)
          await new Promise<void>((r) => setImmediate(r))
        } else {
          flush()
          finishScan(scanId, ev.result, sourceProfile, instructions, 'done')
        }
      }
    } catch (err) {
      // Everything mapped so far stays listed: a walk that died half way through
      // a home directory is still a usable scan of what it reached.
      try {
        flush()
      } catch (flushErr) {
        deps.logger?.warn?.({ scanId, err: failureReason(flushErr) }, 'data-port: final scan flush failed')
      }
      const message = failureReason(err)
      deps.logger?.warn?.(
        { scanId, err: message },
        'data-port: scan failed — everything mapped so far stays listed',
      )
      const warnings: ScanWarning[] = [
        {
          code: 'scan-failed',
          params: { detail: message },
          message: `The scan stopped with an error: ${message}`,
        },
      ]
      // The stats block says how far the walk actually got rather than keeping
      // the header's zeroes beside a truthful row count (M-2).
      // Whichever is larger: what the walker last reported, or what is on disk.
      // Neither alone is honest — a tick can be stale by up to 500 files, and a
      // scan that never ticked has only the rows to speak for it.
      const partial: ScanStats = {
        ...emptyScanStats(),
        filesScanned: Math.max(seen.filesSeen, rowsWritten),
        dirsVisited: Math.max(seen.dirsVisited, dirsWritten),
        totalBytes: bytes,
        scanMs: Date.now() - started,
      }
      deps.db.run(sql`UPDATE data_port_scans SET
        status = 'failed',
        stats_json = ${JSON.stringify(partial)},
        warnings_json = ${JSON.stringify(warnings)},
        scan_ms = ${partial.scanMs},
        finished_at = ${new Date().toISOString()},
        progress_json = NULL,
        candidate_count = ${countCandidates(deps.db, scanId, {})},
        counts_json = ${JSON.stringify(candidateCounts(deps.db, scanId, {}))}
        WHERE id = ${scanId}`)
    } finally {
      running.delete(scanId)
    }
  }

  function rowToSummary(row: any): ScanSummary {
    const stats = JSON.parse(row.stats_json || '{}') as ScanStats
    const counts: StoredCandidateCounts = row.counts_json
      ? JSON.parse(row.counts_json)
      : candidateCounts(deps.db, row.id, {})
    const dirsMapped = Number(
      (deps.db.all(
        sql`SELECT count(*) AS n FROM data_port_scan_dirs WHERE scan_id = ${row.id}`,
      ) as any[])[0]?.n ?? 0,
    )
    // A pre-R11 warning list is `string[]`; the card prints such an element
    // verbatim under the `legacy` code rather than showing an empty row.
    const warnings = (JSON.parse(row.warnings_json || '[]') as Array<ScanWarning | string>).map((w) =>
      typeof w === 'string' ? { code: 'legacy' as const, params: { message: w }, message: w } : w,
    )
    return {
      scanId: row.id,
      status: (row.status ?? 'done') as ScanStatus,
      sourceProfile: row.source_profile,
      detectedProfile: row.detected_profile,
      rootPath: row.root_path,
      instructions: row.instructions ?? null,
      stats: {
        ...emptyScanStats(),
        ...stats,
        candidateCount: Number(row.candidate_count ?? 0),
        directoriesMapped: dirsMapped,
        scanMs: Number(row.scan_ms ?? stats.scanMs ?? 0),
      },
      progress: row.progress_json ? JSON.parse(row.progress_json) : null,
      counts,
      warnings,
    }
  }

  function getScan(scanId: string): ScanSummary | null {
    const rows = deps.db.all(sql`SELECT * FROM data_port_scans WHERE id = ${scanId}`) as any[]
    return rows.length ? rowToSummary(rows[0]) : null
  }

  /**
   * An upload is walked to the end before the caller is answered (P-9), so its
   * rows are inserted in one go rather than driven. The header is written first
   * all the same, so every scan row in the table has the same shape.
   */
  function storeCollectedScan(
    result: ScanResult,
    sourceProfile: SourceProfile,
    instructions: string | null,
  ): ScanSummary {
    const { candidates, dirs, ...rest } = result
    insertScanHeader({
      scanId: result.scanId,
      sourceProfile,
      detectedProfile: result.detectedProfile,
      rootPath: result.rootPath,
      instructions,
      status: 'running',
      stats: result.stats,
      warnings: [],
    })
    insertCandidates(deps.db, result.scanId, applyInstructionHints(candidates, instructions), 0)
    if (dirs.length) insertDirs(deps.db, result.scanId, dirs)
    finishScan(result.scanId, rest, sourceProfile, instructions, 'done')
    return getScan(result.scanId)!
  }

  /** `.` is the whole scan; otherwise the folder itself and everything beneath it. */
  const folderHolds = (rowFolder: string, folder: string): boolean =>
    folder === '.' || rowFolder === folder || rowFolder.startsWith(`${folder}/`)

  /**
   * How many rows a selection resolves to, counted by streaming the table —
   * never by materialising ids. The wizard asks this on every gesture, so a
   * later call supersedes one still walking rather than queueing behind it.
   */
  async function selectionCount(
    scanId: string,
    selection: SelectionWire | ImportJobSelection[],
    filter: CandidateFilter = {},
    folders: string[] = [],
  ): Promise<SelectionCountResult> {
    const sel = compileSelection(normaliseSelection(selection))
    const token = Symbol('selection-count')
    counting.set(scanId, token)
    const byKind: Record<string, number> = {}
    const byFolder: Record<string, number> = {}
    for (const f of folders) byFolder[f] = 0
    let selected = 0
    try {
      // `importable: false` can never be selected (P-10), so it is filtered out
      // in SQL instead of being fetched and rejected row by row.
      for (const batch of iterateCandidates(
        deps.db,
        scanId,
        { ...filter, importable: true },
        SELECTION_SCAN_BATCH,
      )) {
        if (counting.get(scanId) !== token) throw new SelectionCountSuperseded()
        for (const row of batch) {
          if (!sel.resolve(row)) continue
          selected++
          byKind[row.kind] = (byKind[row.kind] ?? 0) + 1
          for (const f of folders) if (folderHolds(row.folder, f)) byFolder[f]!++
        }
        await new Promise<void>((r) => setImmediate(r))
      }
    } finally {
      if (counting.get(scanId) === token) counting.delete(scanId)
    }
    return { selected, byKind, byFolder }
  }

  /**
   * The first bytes of one candidate's source file (P-11). The absolute path is
   * read off the stored row and never leaves: what comes back is the public
   * candidate plus a head cut on a UTF-8 boundary.
   */
  function preview(scanId: string, candidateId: string, bytes = 65_536): CandidatePreview | null {
    const row = getCandidate(deps.db, scanId, candidateId)
    if (!row) return null
    const candidate = toPublicCandidate(row)

    /*
     * A-79. A `not-downloaded` row says the bytes are not on this machine, and
     * the natural next gesture is to click it to see what it is. Reading it here
     * would make the provider fetch the whole file — the label made a lie by the
     * one gesture it invites, and the hazard A-66 exists to prevent arriving one
     * row at a time instead of all at once.
     *
     * Inspection never fetches. TICKING is the deliberate gesture that does, and
     * the import path is gated on the owner's selection, which is where a
     * download belongs.
     */
    if (row.reasonCode === 'not-downloaded') {
      return { candidate, encoding: 'not-downloaded', head: null, bytes: 0, size: row.bytes, truncated: false }
    }

    const path = row.sourcePath
    if (!path) {
      return { candidate, encoding: 'none', head: null, bytes: 0, size: row.bytes, truncated: false }
    }
    if (row.directory) {
      let children: string[] = []
      try {
        children = readdirSync(path).map(String).sort().slice(0, 50)
      } catch (err) {
        return {
          candidate,
          encoding: 'unreadable',
          head: null,
          bytes: 0,
          size: 0,
          truncated: false,
          error: failureReason(err),
        }
      }
      return { candidate, encoding: 'directory', head: null, bytes: 0, size: 0, truncated: false, children }
    }
    if (NEVER_READ_CODES.has(row.reasonCode)) {
      return { candidate, encoding: 'binary', head: null, bytes: 0, size: row.bytes, truncated: false }
    }
    const want = Math.min(Math.max(Math.floor(bytes) || 0, 1), PREVIEW_MAX_BYTES)
    let fd: number | null = null
    try {
      fd = openSync(path, 'r')
      const size = fstatSync(fd).size
      const buf = Buffer.allocUnsafe(want)
      const read = readSync(fd, buf, 0, want, 0)
      const cut = cutToUtf8Boundary(buf.subarray(0, read))
      const head = cut.toString('utf-8')
      const split = splitFrontmatter(head)
      return {
        candidate,
        encoding: 'utf-8',
        head,
        bytes: cut.length,
        size,
        truncated: size > cut.length,
        ...(split.hadFrontmatter ? { frontmatter: split.data } : {}),
      }
    } catch (err) {
      return {
        candidate,
        encoding: 'unreadable',
        head: null,
        bytes: 0,
        size: row.bytes,
        truncated: false,
        error: failureReason(err),
      }
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd)
        } catch {
          /* already gone */
        }
      }
    }
  }

  /**
   * One import at a time per process (P-8). The bound the runner keeps — one
   * open container and one batch of ledger rows — is process-wide, not per job:
   * two imports walking side by side would double it, so a second job posted
   * from a second tab becomes a queue entry rather than a second walker.
   */
  const queue: string[] = []
  let active: string | null = null
  /** Jobs whose runner must stop at its next batch boundary (P-8). */
  const cancelRequested = new Set<string>()

  function enqueue(id: string): void {
    if (active === id || queue.includes(id)) return
    queue.push(id)
    // The drive starts on the NEXT tick, never inside the caller. `runJob` runs
    // synchronously up to its first `await`, and that await sits inside the item
    // loop — so a direct call would make `createJob`, which answers an HTTP
    // request, walk part of the tree before it replied.
    setImmediate(() => void drain())
  }

  async function drain(): Promise<void> {
    if (active || queue.length === 0) return
    const id = queue.shift()!
    active = id
    try {
      await runJob(id)
    } catch (err) {
      // `runJob` writes its own `failed` row for anything it can attribute to a
      // job. Reaching here means the runner itself threw — including out of its
      // own recovery — and swallowing that would stop the queue for the life of
      // the process AND leave the row claiming to be running for ever. The
      // backstop closes the row so the operator sees a reason and the undo, the
      // retry and the restart sweep all become reachable again.
      const reason = failureReason(err)
      deps.logger?.error?.({ jobId: id, err: reason }, 'data-port: import runner threw')
      try {
        const stuck = getJob(id)
        if (stuck && (stuck.status === 'running' || stuck.status === 'pending')) {
          updateJob(id, {
            status: 'failed',
            phase: 'error',
            error: reason,
            finishedAt: new Date().toISOString(),
          })
        }
      } catch (markErr) {
        deps.logger?.error?.(
          { jobId: id, err: failureReason(markErr) },
          'data-port: the job row could not be closed after the runner threw — a restart will pick it up',
        )
      }
    } finally {
      active = null
      if (queue.length > 0) void drain()
    }
  }

  /**
   * The one writer of a job row. Everything the runner persists per batch —
   * counters, phase, the keyset cursor and the clock — goes through here, so a
   * flush is a single statement inside the batch transaction (P-7).
   */
  function updateJob(
    id: string,
    patch: Partial<{
      status: string
      phase: string
      progress: number
      stats: ImportJobStats
      error: string | null
      finishedAt: string | null
      /** Last candidate `seq` this job has committed; a restart resumes after it. */
      cursorSeq: number
      startedAt: string | null
      importMs: number | null
      /** Wall time across every run of this job, so a resumed import reports the total. */
      elapsedMs: number
    }>,
  ) {
    const now = new Date().toISOString()
    const rows = deps.db.all(sql`SELECT status, phase, progress, stats_json, error, finished_at,
      cursor_seq, started_at, import_ms, elapsed_ms FROM data_port_jobs WHERE id = ${id}`) as Array<{
      status: string
      phase: string
      progress: number
      stats_json: string
      error: string | null
      finished_at: string | null
      cursor_seq: number
      started_at: string | null
      import_ms: number | null
      elapsed_ms: number
    }>
    const cur = rows[0]
    if (!cur) return
    deps.db.run(sql`UPDATE data_port_jobs SET
      status = ${patch.status ?? cur.status},
      phase = ${patch.phase ?? cur.phase},
      progress = ${patch.progress ?? cur.progress},
      stats_json = ${patch.stats ? JSON.stringify(patch.stats) : cur.stats_json},
      error = ${patch.error !== undefined ? patch.error : cur.error},
      cursor_seq = ${patch.cursorSeq ?? cur.cursor_seq},
      started_at = ${patch.startedAt !== undefined ? patch.startedAt : cur.started_at},
      import_ms = ${patch.importMs !== undefined ? patch.importMs : cur.import_ms},
      elapsed_ms = ${patch.elapsedMs ?? cur.elapsed_ms},
      updated_at = ${now},
      finished_at = ${patch.finishedAt !== undefined ? patch.finishedAt : cur.finished_at}
      WHERE id = ${id}`)
  }

  function getJob(id: string): ImportJob | null {
    const rows = deps.db.all(sql`SELECT * FROM data_port_jobs WHERE id = ${id}`) as any[]
    return rows.length ? rowToJob(rows[0]) : null
  }

  /**
   * Stops a running job at its next batch boundary, or drops a queued one where
   * it stands. A job the runner has already claimed is never torn out of a
   * half-written container: the flag is read where the ledger and the cursor are
   * consistent, so the row it leaves behind is an honest account of what landed.
   */
  function cancelJob(id: string): boolean {
    const job = getJob(id)
    if (!job || (job.status !== 'pending' && job.status !== 'running')) return false
    if (active !== id) {
      // Queued here, or `running` in a row left by a process that has since died:
      // nothing is walking it, so it can be closed on the spot.
      const at = queue.indexOf(id)
      if (at >= 0) queue.splice(at, 1)
      cancelRequested.delete(id)
      updateJob(id, {
        status: 'cancelled',
        phase: 'cancelled',
        finishedAt: new Date().toISOString(),
      })
      return true
    }
    cancelRequested.add(id)
    return true
  }

  /**
   * One import job, streamed.
   *
   * The selection is never materialised: the runner walks the scan's candidate
   * table by keyset in pages (P-6, the scan's own emission order, so a
   * container's units are contiguous by construction), holds ONE source file
   * open at a time, and flushes the ledger rows of a batch together with the job
   * row — counters, phase, cursor and clock — in a single transaction (P-7). The
   * memory profile is therefore flat whether the job carries a hundred items or
   * a hundred thousand.
   *
   * A run that is interrupted resumes from `cursor_seq`: the cursor and the
   * ledger rows of a batch commit together, so an item past the cursor is either
   * unwritten or written-but-unledgered, and the second case is adopted below
   * rather than duplicated. Nothing here needs a model — enrichment is
   * metadata-only, opt-in per job, and never runs on a flagged item.
   */
  async function runJob(jobId: string): Promise<void> {
    const job = getJob(jobId)
    if (!job) return
    const rows = deps.db.all(
      sql`SELECT selection_json, selection_mode, enrich, cursor_seq, resumed_count, elapsed_ms
          FROM data_port_jobs WHERE id = ${jobId}`,
    ) as Array<{
      selection_json: string
      selection_mode?: string | null
      enrich?: number | null
      cursor_seq?: number | null
      resumed_count?: number | null
      elapsed_ms?: number | null
    }>
    const row = rows[0]
    if (!row) return
    // Stored as 0/1; anything else (an install predating the column) reads as
    // "not asked for", which is the safe default for a call to a provider.
    const enrichRequested = Number(row.enrich ?? 0) === 1
    const scan = getScan(job.scanId)
    if (!scan || scan.stats.candidateCount === 0) {
      updateJob(jobId, {
        status: 'failed',
        phase: 'error',
        error: 'Scan data expired or missing — re-scan and try again',
        finishedAt: new Date().toISOString(),
      })
      return
    }

    const wire = normaliseSelection(
      JSON.parse(row.selection_json || '[]') as SelectionWire | ImportJobSelection[],
    )
    const sel = compileSelection(wire)
    /**
     * The two selection shapes ask different questions of the same walk.
     *
     * A folder/kind gesture is resolved by the shared resolver over the
     * IMPORTABLE rows only — a noise row was never part of the gesture. An
     * explicit id list is the owner ticking rows by hand, so every id they named
     * is carried through whether it is importable or not: a row that turns out
     * to be noise must be REPORTED as skipped, not quietly dropped.
     */
    const idMode = row.selection_mode !== 'wire'
    const idSet = idMode ? new Set(wire.rows.map((r) => r.candidateId)) : null
    const isSelected = (c: StoredCandidate): boolean => (idSet ? idSet.has(c.id) : sel.resolve(c))

    let cursor = Number(row.cursor_seq ?? -1)
    /**
     * Whether this run carried on from a committed cursor rather than starting at
     * the beginning. It travels as a FIELD on every failure this run reports —
     * never as a prefix on the message, because a stored failure keeps the
     * innermost link of the error chain and a prefix is exactly what that drops.
     */
    const resumedRun = cursor >= 0
    /**
     * Counters are carried across a resume ONLY when the walk carries on from a
     * cursor. A run that starts at the beginning again — a job whose cursor was
     * never committed, or one deliberately rewound — re-visits every row, so
     * keeping the old counters would report each item twice.
     */
    const stats: ImportJobStats =
      cursor >= 0
        ? { ...emptyStats(), ...job.stats, resumed: Number(row.resumed_count ?? 0) }
        : { ...emptyStats(), resumed: Number(row.resumed_count ?? 0) }
    stats.total = job.selectionTotal || stats.total || 0
    const runStarted = Date.now()
    const elapsedBefore = Number(row.elapsed_ms ?? 0)
    const startedAt = job.startedAt ?? new Date().toISOString()
    const elapsed = (): number => elapsedBefore + (Date.now() - runStarted)
    const progressOf = (): number =>
      stats.total ? Math.min(1, 0.05 + (0.95 * stats.processed) / stats.total) : 0.05

    /**
     * Every outcome that is not a clean apply is counted by code: a skip, an
     * `unchanged` re-import and an `error` alike. The operator's result panel is
     * then a full account of the job, not only of what landed.
     */
    const countReason = (code: ReasonCode): void => {
      stats.skippedReasons[code] = (stats.skippedReasons[code] ?? 0) + 1
    }
    const skipWith = (code: ReasonCode): void => {
      stats.skipped++
      countReason(code)
    }
    const failWith = (code: ReasonCode): void => {
      stats.errors++
      countReason(code)
    }

    /**
     * Ledger rows of the batch in flight. They are held for at most
     * `JOB_BATCH_SIZE` items and written with the job row in one transaction, so
     * the cursor and the rows it accounts for can never disagree (P-7).
     */
    let pendingLedger: Array<Parameters<typeof recordApplied>[1]> = []
    /**
     * Items this run wrote whose ledger rows a failed flush could not commit.
     * They are on disk, they are outside the ledger, and the undo cannot reach
     * them — so the count belongs on the job row, not only in a log line.
     */
    let unledgered = 0
    /** `seq` the last flush committed, so a page that changed nothing writes nothing. */
    let flushedCursor = cursor
    const flush = (phase: string, finalProgress?: number): void => {
      const patch = {
        phase,
        progress: finalProgress ?? progressOf(),
        stats: { ...stats, elapsedMs: elapsed() },
        cursorSeq: cursor,
        elapsedMs: elapsed(),
      }
      const batch = pendingLedger
      pendingLedger = []
      stats.elapsedMs = patch.elapsedMs
      flushedCursor = cursor
      let began = false
      try {
        deps.db.run(sql.raw('BEGIN IMMEDIATE'))
        began = true
      } catch (err) {
        // Only the caller's own transaction is a reason to carry on un-begun;
        // a locked database (SQLITE_BUSY fails identically) must propagate.
        // One cause-walking phrase test for the module, in `ledger.ts` (A-22b).
        if (!isNestedTransactionError(err)) {
          // The batch cannot be written and cannot be held back: its items are
          // on disk already, and this is where their ledger rows were going to
          // be. Counted before the throw so the number reaches the job row —
          // the undo cannot see these items, and nothing in the product will
          // adopt them unless this same job runs again.
          unledgered += batch.length
          throw err
        }
      }
      try {
        for (const r of batch) recordApplied(deps.db, r)
        updateJob(jobId, patch)
        if (began) deps.db.run(sql.raw('COMMIT'))
      } catch (err) {
        if (began) {
          try {
            deps.db.run(sql.raw('ROLLBACK'))
          } catch {
            /* transaction already gone */
          }
        }
        // One bad row must not cost the other ninety-nine their ledger entries —
        // an item with no ledger row is an item the undo cannot reach. Retried
        // one by one, and the one that still fails is named.
        for (const r of batch) {
          try {
            recordApplied(deps.db, r)
          } catch (e) {
            deps.logger?.warn?.(
              { jobId, ref: r.ref, err: failureReason(e) },
              'data-port: ledger row could not be written',
            )
          }
        }
        updateJob(jobId, patch)
        deps.logger?.warn?.(
          { jobId, err: failureReason(err) },
          'data-port: batch flush fell back to per-row writes',
        )
      }
    }


    /**
     * ONE source file in memory at a time. It is released the moment the walk
     * reaches a row from a different file — which is safe because the scanner
     * emits every unit of a container consecutively and this walk is in that same
     * order (P-6), so a container is opened once however many units it holds.
     *
     * Declared outside the guard so every exit path — including the failure one —
     * can drop it.
     */
    let open: { path: string; raw: Buffer; sha256: string; units: ExpandedUnit[] | null } | null =
      null

    /**
     * The vault indexer, once the apply deps exist. Held here rather than read
     * off `applyDeps` so that EVERY exit path can rebuild the index — including
     * the two that run before the deps were ever built.
     */
    let indexer: ApplyDeps['indexer']
    /**
     * Rebuilding the vault index must never fail an import that already wrote
     * everything: the notes are on disk either way.
     *
     * It runs on every exit — completed, cancelled AND failed — because the undo
     * refuses a vault note the index does not name, and then marks the job
     * `rolled_back` anyway and refuses a retry. A cancelled import whose notes
     * were never indexed is therefore an import the owner can neither keep track
     * of nor take back, which is the one thing cancel exists to avoid.
     */
    const reindex = (): void => {
      try {
        indexer?.indexAll()
      } catch (err) {
        deps.logger?.warn?.({ jobId, err: failureReason(err) }, 'data-port: vault reindex failed')
      }
    }

    updateJob(jobId, {
      status: 'running',
      // `resuming` survives until the first flush of this run, so the wizard can
      // say "Resumed after restart" for exactly as long as it is true.
      phase: cursor >= 0 ? 'resuming' : 'read',
      progress: progressOf(),
      stats,
      startedAt,
    })

    // Everything from here on is inside the guard, not only the walk. The apply
    // deps, the missing-id pre-pass and the index-hook pre-pass can all throw,
    // and a throw between the `running` write above and the walk below used to
    // leave the row claiming to be running for ever with `error: null` — the
    // exact shape P-8 removed for a restart, reintroduced by a bad first tick.
    try {
      /**
       * Every scan mints fresh candidate ids, so a client posting an id list from
       * an earlier scan (a second tab, a re-scan, a retried request) sends ids that
       * no longer resolve. Dropping them silently would report the import as a
       * success having filed nothing, so each one is counted as a failed item —
       * once, at the head of the first run, never again on a resume.
       */
      if (idSet && cursor < 0) {
        const missing: string[] = []
        const ids = [...idSet]
        for (let i = 0; i < ids.length; i += 500) {
          const chunk = ids.slice(i, i + 500)
          const found = new Set(getCandidatesByIds(deps.db, job.scanId, chunk).map((c) => c.id))
          for (const id of chunk) if (!found.has(id)) missing.push(id)
        }
        for (const id of missing) {
          stats.processed++
          failWith('error')
          deps.logger?.warn?.(
            { jobId, path: `candidate not in scan: ${id}` },
            'data-port: selected candidate is not in this scan',
          )
        }
        if (missing.length > 0) {
          deps.logger?.warn?.(
            { jobId, scanId: job.scanId, ids: missing.slice(0, 20), count: missing.length },
            'data-port: selection holds candidate ids this scan does not — re-scan before importing',
          )
        }
      }

      /**
       * The model pass is opt-in, per job. The default import is deterministic and
       * model-free: nothing is sent anywhere unless the owner ticked the box, and
       * even then only when a provider is actually configured. There is no item
       * cap — enrichment is metadata-only and its cost is time (A-17).
       *
       * A gateway that answers `listProviders` with an empty list is a gateway
       * with nothing behind it — every item would log a failed call and be
       * counted as a fallback. A gateway that does not answer at all (a test
       * double) is taken at its word.
       */
      const gateway = deps.modelCtx.model as
        | (typeof deps.modelCtx.model & { listProviders?: () => unknown[] })
        | undefined
      const hasProvider = gateway?.listProviders ? gateway.listProviders().length > 0 : true
      const useAi = enrichRequested && Boolean(deps.modelCtx.model?.complete) && hasProvider
      const applyDeps = deps.applyDepsFactory()
      // Handed to the hoisted `reindex` so every exit path can rebuild the
      // index, including one that runs after this scope has been left.
      indexer = applyDeps.indexer
      const profile: SourceProfile =
        job.sourceProfile === 'auto'
          ? scan.detectedProfile && scan.detectedProfile !== 'auto'
            ? scan.detectedProfile
            : 'generic-md'
          : job.sourceProfile

      /**
       * `null` = the file is gone or unreadable. `'exceeds-string-limit'` = the
       * engine cannot hold this file as one string (P-17) — a runtime fact, not a
       * policy, and a truthful skip rather than a generic error.
       */
      const readSource = (
        path: string,
      ): typeof open | 'exceeds-string-limit' | null => {
        if (open?.path === path) return open
        open = null
        let size: number
        try {
          size = statSync(path).size
        } catch {
          return null
        }
        if (size > STRING_LIMIT_BYTES) return 'exceeds-string-limit'
        let raw: Buffer
        try {
          raw = readFileSync(path)
        } catch {
          return null
        }
        open = { path, raw, sha256: createHash('sha256').update(raw).digest('hex'), units: null }
        return open
      }

      // Pre-pass: the hooks of every selected index file become the summaries of
      // the notes they point at, so a one-line index survives as more than a list.
      // Index rows are a handful per tree, so this pass is bounded by construction.
      const hooks = new Map<string, IndexEntry>()
      const indexCounts = new Map<string, number>()
      for (const batch of iterateCandidates(deps.db, job.scanId, { kind: ['index'] }, 500)) {
        for (const candidate of batch) {
          if (!isSelected(candidate) || !candidate.sourcePath) continue
          const entry = readSource(candidate.sourcePath)
          if (!entry || entry === 'exceeds-string-limit') continue
          try {
            const parsed = parseMemoryIndex(splitFrontmatter(entry.raw.toString('utf-8')).body)
            for (const [key, value] of parsed.entries) hooks.set(key, value)
            indexCounts.set(candidate.id, parsed.count)
          } catch {
            /* an unreadable index only loses its hooks; the file itself still imports */
          }
        }
      }
      open = null

      /**
       * A frontmatter block that IS frontmatter but would not parse. The reader
       * recovers what it can line by line and says so here rather than silently
       * demoting the note — the owner's file has something in it YAML rejects,
       * and that is worth one line in the log per file it happens to.
       */
      const reportFrontmatterError = (c: ScanCandidate, note: SourceNote | null): void => {
        if (!note?.frontmatterError) return
        deps.logger?.warn?.(
          { path: c.relativePath, err: note.frontmatterError },
          'data-port: frontmatter did not parse — declared fields recovered line by line',
        )
      }

      /**
       * The source note of one candidate. A whole file goes through the adapter
       * that claimed it; a unit is read off its container's expansion and then
       * overlaid with whatever that unit declared — never overwritten with a null.
       */
      const noteFor = (
        c: ScanCandidate,
        entry: { raw: Buffer; units: ExpandedUnit[] | null },
      ): SourceNote | null => {
        const times = { mtime: c.mtime, birthtime: c.birthtime }
        const adapter = adapterFor(c.adapterId ?? profile)
        // The path the SCAN classified on, which on a rooted scan still carries
        // the marker the row itself has lost: a tree rooted at `~/.grok/memory`
        // stores `p1/sessions/x.md`, and the adapter needs `.grok/memory/p1/…` to
        // recognise it at all. Reading on any other path would give a different
        // answer at apply time than the scan gave — the summary would lose its
        // project tag and dates, and a container would expand to no units and be
        // counted `missing-unit`. `relativePath` stays the stored, displayed and
        // recorded path; only what the adapter is asked about changes.
        const classified = c.classifiedPath ?? c.relativePath
        if (!c.unit) {
          const note = adapter.read
            ? adapter.read(classified, entry.raw, null, times)
            : readSourceNote(c.relativePath, entry.raw.toString('utf-8'), times)
          reportFrontmatterError(c, note)
          return note
        }
        if (entry.units === null) {
          // The scan counted these units without collecting them; the runner needs
          // the rendered body, so it asks the same adapter for the same units with
          // the content this time.
          entry.units = adapter.expand?.(classified, entry.raw, c.sourcePath, { withContent: true }) ?? []
        }
        const unit = entry.units.find((u) => u.unit === c.unit)
        if (!unit) return null
        const base = readSourceNote(c.relativePath, unit.content, times)
        reportFrontmatterError(c, base)
        return {
          ...base,
          ...(unit.title ? { title: unit.title } : {}),
          ...(unit.data ? { data: unit.data } : {}),
          ...(unit.created ? { created: unit.created } : {}),
          ...(unit.updated ? { updated: unit.updated } : {}),
          ...(unit.sessionId ? { sessionId: unit.sessionId } : {}),
          ...(unit.sessionDate ? { sessionDate: unit.sessionDate } : {}),
        }
      }

      /**
       * The files bundled with a SKILL.md, read at apply time.
       *
       * Nothing is DROPPED here (A-14, R11.4/P-3). Under R11 a credential inside
       * a package is bundled verbatim and the package carries the tag; the old
       * bare `continue` that discarded such a file left no row, no reason code
       * and nothing a grep could find — the owner simply never got the file they
       * pointed at. Two things can still stop a file, and both come back NAMED so
       * the skill body and the operator's count can say so:
       *
       * - a relative path that resolves OUT of the package directory (the one
       *   wall that stays a wall: the importer must never read outside the tree
       *   it was pointed at), and
       * - a file that has gone or turned unreadable since the scan listed it —
       *   which `readSkillAssets` used to swallow with a log line, so a base-path
       *   mismatch silently lost every asset of every package (A-34).
       */
      const readSkillAssets = (
        c: ScanCandidate,
      ): { assets: SkillAsset[]; notBundled: Array<{ relPath: string; bytes: number; reason: string }> } => {
        const notBundled: Array<{ relPath: string; bytes: number; reason: string }> = []
        if (!c.sourcePath || !c.assets?.length) return { assets: [], notBundled }
        // The package's own directory: the scanner sets `sourcePath` to the real
        // member path even for a package reached through a symlink, so the two
        // bases agree by construction (Task 7, fix round 2).
        const dir = dirname(c.sourcePath)
        const out: SkillAsset[] = []
        for (const asset of c.assets) {
          const full = resolve(dir, asset.relPath)
          if (!full.startsWith(dir + sep)) {
            deps.logger?.warn?.(
              { path: asset.relPath, skill: c.relativePath },
              'data-port: bundled file resolves outside its package — not read',
            )
            notBundled.push({
              relPath: asset.relPath,
              bytes: asset.bytes,
              reason: 'the path resolves outside the package directory',
            })
            continue
          }
          try {
            const content = asset.binary ? readFileSync(full) : readFileSync(full, 'utf-8')
            // The scanner flagged this file from its head; the whole file is in
            // hand here, so the verdict is recomputed over every byte and the two
            // are ORed. A key past the classification head must still reach the
            // tag, or D-7's recall gate has nothing to act on (A-8).
            //
            // A binary-flagged asset is decoded the way the scanner decodes it
            // (UTF-8 with replacement characters) rather than handed an empty
            // string: passing `''` would leave only the FILENAME half of the
            // predicate standing, and a PEM key inside a file the NUL sniff
            // called binary would carry no flag at all.
            const secretScan = typeof content === 'string' ? content : content.toString('utf-8')
            const containsSecrets = Boolean(asset.containsSecrets) || looksLikeSecrets(asset.relPath, secretScan)
            if (containsSecrets) {
              deps.logger?.info?.(
                { path: asset.relPath, skill: c.relativePath },
                'data-port: bundled file looks like a credential — imported verbatim and tagged, hidden at recall',
              )
            }
            out.push({
              relPath: asset.relPath,
              // Bytes for anything that is not text, so an image or an archive
              // survives the round trip unchanged.
              content,
              // Permission bits only: an executable script stays executable.
              mode: statSync(full).mode & 0o777,
              binary: asset.binary,
              sha256: asset.sha256,
              ...(containsSecrets ? { containsSecrets: true } : {}),
            })
          } catch (err) {
            const detail = failureReason(err)
            deps.logger?.warn?.(
              { path: asset.relPath, skill: c.relativePath, err: detail },
              'data-port: bundled file unreadable at apply time — named in the skill instead of dropped',
            )
            notBundled.push({
              relPath: asset.relPath,
              bytes: asset.bytes,
              reason: 'it could not be read at import time',
            })
          }
        }
        return { assets: out, notBundled }
      }

      const record = (
        kind: AppliedKind,
        ref: string,
        c: StoredCandidate,
        sha256: string | null,
      ): void => {
        pendingLedger.push({
          jobId,
          kind,
          ref,
          sourcePath: c.sourcePath ?? null,
          sha256,
          // R11.6 — which adapter read the item, and every path its content was
          // found at, for every kind.
          adapter: c.adapterId ?? profile,
          paths: c.paths?.length ? c.paths : [c.relativePath],
        })
      }

      let sinceFlush = 0
      let cancelled = false
      pages: for (const batch of iterateCandidates(
        deps.db,
        job.scanId,
        // A gesture never selected a noise row, so the wire walk skips them in
        // SQL; an id list may name one and must still report it.
        idSet ? {} : { importable: true },
        500,
        cursor,
      )) {
        for (const candidate of batch) {
          // Moved before the work, and committed only by a flush: an item past
          // the cursor is either unwritten or written-but-unledgered, and the
          // second case is adopted below.
          cursor = candidate.seq
          if (!isSelected(candidate)) continue
          // The wire's override if it carries one, else the row's own target —
          // the same rule for a gesture and for an id list, from one resolver.
          const target = sel.target(candidate)
          stats.processed++
          const kind = candidate.kind
          try {
            if (target === 'none' || kind === 'noise') {
              skipWith('not-importable')
              continue
            }
            const entry = candidate.sourcePath ? readSource(candidate.sourcePath) : null
            if (entry === 'exceeds-string-limit') {
              // A runtime fact, not a refusal: the row says exactly why, and
              // says it in the operator's language (P-17).
              skipWith('exceeds-string-limit')
              deps.logger?.warn?.(
                { jobId, seq: candidate.seq, resumedRun, path: candidate.relativePath, bytes: candidate.bytes },
                'data-port: text file larger than the engine can hold as one string — listed, not imported',
              )
              continue
            }
            if (!entry) {
              failWith('unreadable')
              deps.logger?.warn?.(
                { jobId, seq: candidate.seq, resumedRun, path: candidate.relativePath },
                'data-port: source unreadable at apply time',
              )
              continue
            }
            const note = noteFor(candidate, entry)
            if (!note) {
              skipWith('missing-unit')
              deps.logger?.warn?.(
                { jobId, seq: candidate.seq, resumedRun, path: candidate.relativePath, unit: candidate.unit },
                'data-port: unit is no longer present in its container',
              )
              continue
            }
            // The file changed after the scan listed it. Every layer flags that, so
            // the owner can see which imported rows no longer match their source.
            const sourceChanged = Boolean(candidate.sha256 && candidate.sha256 !== entry.sha256)
            // What the SCAN decided, from the file head or from the unit it came
            // out of (A-16). The authoritative verdict over the whole body is
            // taken inside `normalizeMemory` (A-8) and ORed with this one.
            const flagged = candidate.tags?.includes(SECRETS_TAG) === true
            const adapterId = candidate.adapterId ?? profile
            let result: ApplyResult

            if (WORKSPACE_TARGETS.has(target)) {
              result = await applyWorkspaceProposal(applyDeps, {
                jobId,
                target,
                title: note.title,
                body: note.body,
                sourcePath: candidate.relativePath,
                // What the rule declares it applies to (Cursor `globs`, Copilot
                // `applyTo`), so the scope reaches the header the owner reads.
                scope: candidate.scope ?? null,
                // The leading YAML block rides along VERBATIM rather than being
                // stripped: the owner sees what the source declared before
                // approving. The source's own text, not a re-serialisation of the
                // parsed object — that would lose its comments and its quoting
                // — and not trimmed either, because R11.5 is about the bytes.
                frontmatterYaml: note.hadFrontmatter
                  ? (note.frontmatterRaw ?? stringifyYaml(note.data))
                  : null,
                sourceChanged,
                containsSecrets: flagged,
              })
            } else if (target === 'agent' || kind === 'persona') {
              result = await applyPersonaItem(applyDeps, {
                jobId,
                sourceProfile: profile,
                adapterId,
                relativePath: candidate.relativePath,
                raw: entry.raw.toString('utf-8'),
                sourceChanged,
                containsSecrets: flagged,
              })
            } else if (target === 'skill' || kind === 'skill') {
              const bundled = readSkillAssets(candidate)
              // What the package is short travels too, so the skill body names
              // the files it does NOT carry instead of leaving an agent to
              // discover them missing (A7.8). Under R11 that can only be a path
              // that escaped the package, a file whose inline copy was clipped
              // (P-15), or one that could not be read at all (P-17, A-34) — the
              // scan itself refuses nothing.
              const notBundled = [...(candidate.notBundled ?? []), ...bundled.notBundled]
              result = await applySkillItem(applyDeps, {
                jobId,
                sourceProfile: profile,
                adapterId,
                transformed: buildSkillFromPackage({
                  relativePath: candidate.relativePath,
                  raw: entry.raw.toString('utf-8'),
                  assets: bundled.assets,
                  ...(notBundled.length ? { notBundled } : {}),
                  ...(flagged ? { containsSecrets: true } : {}),
                }),
                sourceChanged,
              })
            } else if (MEMORY_TARGETS.has(target)) {
              const key = basename(candidate.relativePath).replace(/\.md$/i, '')
              const indexEntryCount = indexCounts.get(candidate.id)
              // Tags the scanner and the adapters minted for this row travel with
              // it; the secrets flag is passed as the flag it is rather than as a
              // tag string, so the full-body recompute inside `normalizeMemory`
              // owns the final answer (A-8).
              const carriedTags = (candidate.tags ?? []).filter((t) => t !== SECRETS_TAG)
              let transformed = normalizeMemory(note, {
                relativePath: candidate.relativePath,
                sourceProfile: profile,
                adapterId,
                hooks: hooks.get(key) ?? null,
                // The hash of what was READ, not what the scan saw: a file edited
                // between the two must not be recorded under the older digest.
                sha256: entry.sha256,
                mtime: candidate.mtime,
                paths: candidate.paths,
                unit: candidate.unit ?? null,
                sourceChanged,
                fileSlug: slugFromSource(candidate.relativePath, note.title, candidate.unit ?? null),
                ...(carriedTags.length ? { tags: carriedTags } : {}),
                ...(flagged ? { containsSecrets: true } : {}),
                ...(indexEntryCount === undefined ? {} : { indexEntryCount }),
                ...(deps.logger
                  ? { logger: deps.logger as unknown as { warn?: (o: unknown, m?: string) => void } }
                  : {}),
              })
              // A file that holds a credential is never handed to a model, even
              // when the owner opted into enrichment (R11.4, A-8b). The question
              // is asked of the AUTHORITATIVE tag `normalizeMemory` just set over
              // the whole body, not of the scan's head-only preview.
              const bodyFlagged = transformed.tags.includes(SECRETS_TAG)
              if (useAi && bodyFlagged) {
                stats.aiFallback++
              } else if (useAi && note.declaredKind === null && target !== 'episodic') {
                // Metadata only, and only for a note that declared no kind of
                // its own. A transcript is never handed to a model.
                const enriched = await enrichMemory(deps.modelCtx, note, transformed, {
                  path: candidate.relativePath,
                  sourceProfile: profile,
                })
                transformed = enriched.result
                if (enriched.enriched) stats.aiEnriched++
                else stats.aiFallback++
              }
              const unit =
                candidate.unit && entry.units
                  ? (entry.units.find((u) => u.unit === candidate.unit) ?? null)
                  : null
              const part = (unit?.data as { part?: { n: number; of: number } } | undefined)?.part
              result = await applyMemoryItem(applyDeps, {
                jobId,
                sourceProfile: profile,
                adapterId,
                target,
                transformed,
                relativePath: candidate.relativePath,
                unit: candidate.unit ?? null,
                sessionId: candidate.sessionId ?? note.sessionId,
                sessionDate:
                  candidate.sessionDate ?? note.sessionDate ?? candidate.birthtime ?? candidate.mtime ?? null,
                // What the row IS, kept as a tag so a transcript, a summary and
                // a session artifact stay tellable apart after the import.
                kindTag:
                  candidate.reasonCode === 'transcript' ||
                  candidate.reasonCode === 'session-summary' ||
                  candidate.reasonCode === 'session-artifact'
                    ? candidate.reasonCode
                    : null,
                ...(part ? { part } : {}),
                // A-35 — the shape the source file actually had, so the P-13
                // fallback computes ONE legacy digest instead of both.
                hadFrontmatter: note.hadFrontmatter,
                // A source that declared its own scope keeps it: the note lands
                // under that project instead of in the global semantic folder.
                scope: { projectId: note.project, projectTypeId: note.projectType },
              })
            } else {
              skipWith('unsupported-target')
              continue
            }

            if (result.status === 'applied') {
              stats.applied++
              record(ledgerKind(result.kind), result.ref, candidate, result.sha256)
              // The asset directory gets its own row: a rollback has to remove the
              // bundled files as well as the skill that names them.
              if (result.kind === 'skill' && result.assetsDir) {
                record('skill-assets', result.assetsDir, candidate, result.assetsSha256 ?? null)
              }
            } else if (result.status === 'unchanged') {
              /**
               * Adoption. A hit THIS job wrote, before an interrupted batch lost
               * the ledger rows that would have named it, is this job's own work
               * — not an earlier import's. Without this the item would be
               * invisible to the undo for ever, having been written by a job
               * that never recorded it.
               *
               * The ledger kind follows the BRANCH that produced the result, not
               * a default: a proposal comes back as a `proposal` row keyed by
               * proposal id, never as a `vault` row a rollback would try to
               * delete as a note.
               */
              const adoptedKind: AppliedKind = WORKSPACE_TARGETS.has(target)
                ? 'proposal'
                : kind === 'persona' || target === 'agent'
                  ? 'agent'
                  : target === 'episodic'
                    ? 'episodic'
                    : target === 'skill' || kind === 'skill'
                      ? 'skill'
                      : 'vault'
              const ours = result.importJobId === jobId
              const adoptItem = ours && !hasLedgerRef(deps.db, adoptedKind, result.ref)
              // Asked separately, because the two rows are written separately: a
              // flush that committed the skill and died before its asset
              // directory leaves the package on disk with nothing naming its
              // files, and adopting only alongside the skill would never fix it.
              const adoptAssets =
                ours &&
                adoptedKind === 'skill' &&
                Boolean(result.assetsDir) &&
                !hasLedgerRef(deps.db, 'skill-assets', result.assetsDir!)
              if (adoptItem || adoptAssets) {
                stats.applied++
                if (adoptItem) record(adoptedKind, result.ref, candidate, result.sha256)
                if (adoptAssets) {
                  record('skill-assets', result.assetsDir!, candidate, result.assetsSha256 ?? null)
                }
              } else {
                // A re-import that recognises earlier work is not an error, but
                // it is still an item that wrote nothing — counted as such.
                stats.unchanged++
                countReason('unchanged')
              }
            } else if (result.status === 'proposal') {
              stats.proposals++
              record('proposal', result.proposalId, candidate, result.sha256)
            } else if (result.status === 'skipped') {
              skipWith(result.reasonCode ?? skipCodeFor(result.reason))
              deps.logger?.info?.(
                { path: candidate.relativePath, reason: result.reason },
                'data-port: item skipped',
              )
            } else {
              failWith(result.reasonCode ?? 'error')
              deps.logger?.warn?.(
                { path: candidate.relativePath, err: result.error },
                'data-port item failed',
              )
            }
          } catch (err) {
            failWith('error')
            // The context — which job, which row, first run or resume — is
            // carried in fields. Wrapping the error to say it in prose would put
            // it in the OUTER link, which `failureReason` is built to drop.
            deps.logger?.warn?.(
              { jobId, seq: candidate.seq, resumedRun, err: failureReason(err), path: candidate.relativePath },
              'data-port item failed',
            )
          } finally {
            stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1
            if (++sinceFlush >= JOB_BATCH_SIZE) {
              sinceFlush = 0
              flush('apply')
              // A long import must not starve the event loop: the server keeps
              // answering while the job runs.
              await new Promise<void>((r) => setImmediate(r))
              if (stats.processed % 2000 === 0) {
                deps.logger?.info?.(
                  {
                    jobId,
                    processed: stats.processed,
                    total: stats.total,
                    rss: process.memoryUsage().rss,
                  },
                  'data-port: job progress',
                )
              }
            }
          }
          // Read only where the ledger, the counters and the cursor agree — so a
          // cancelled job leaves a row that is an honest account of what landed.
          if (cancelRequested.has(jobId) && sinceFlush === 0) {
            cancelled = true
            break pages
          }
        }
        // A page whose rows were all passed over still moved the cursor and the
        // clock; a page that ended exactly on a flush boundary has nothing to say.
        if (sinceFlush > 0 || pendingLedger.length > 0 || cursor !== flushedCursor) {
          sinceFlush = 0
          flush('apply')
          await new Promise<void>((r) => setImmediate(r))
        }
        if (cancelRequested.has(jobId)) {
          cancelled = true
          break pages
        }
      }
      open = null
      // M1 — a cancel that arrived when there was nothing left to stop did not
      // stop anything. Every selected item is in the ledger, so calling the run
      // `cancelled` would tell the owner their import was interrupted when it
      // was not — and, before the reindex below reached this path, would also
      // have cost that finished import its undo.
      if (cancelled && stats.total > 0 && stats.processed >= stats.total) cancelled = false
      if (cancelled) {
        flush('cancelled')
        // The notes this run wrote must be findable, or the undo cannot reach
        // them: rollback refuses a vault note the index does not name and then
        // marks the job rolled back anyway, so an unindexed cancel strands the
        // owner's files for ever. Stopping an hour-long import is exactly when
        // the undo matters most (I1).
        reindex()
        updateJob(jobId, {
          status: 'cancelled',
          phase: 'cancelled',
          finishedAt: new Date().toISOString(),
          importMs: elapsed(),
          elapsedMs: elapsed(),
        })
        return
      }
      // M4 — the walk ended having handled fewer items than the selection
      // promised: rows the scan held when the job was created are gone (a
      // retention purge, a cancelled scan). Counted the way an id list this scan
      // does not hold has always been counted, so the panel shows the shortfall
      // instead of a green run that quietly touched two thirds of the tree.
      const shortfall = stats.total > 0 ? stats.total - stats.processed : 0
      if (shortfall > 0) {
        stats.processed += shortfall
        stats.errors += shortfall
        stats.skippedReasons.error = (stats.skippedReasons.error ?? 0) + shortfall
        deps.logger?.warn?.(
          { jobId, scanId: job.scanId, missing: shortfall, total: stats.total, resumedRun },
          'data-port: the scan no longer holds every row this job selected — the missing rows are counted as errors, not passed over in silence',
        )
      }
      flush('index')
      reindex()
      updateJob(jobId, {
        status: 'completed',
        phase: 'done',
        progress: 1,
        stats: { ...stats, elapsedMs: elapsed() },
        finishedAt: new Date().toISOString(),
        error: null,
        importMs: elapsed(),
        elapsedMs: elapsed(),
      })
    } catch (err) {
      open = null
      // Whatever the batch in flight had already written is still recorded: an
      // item with no ledger row is an item the undo cannot reach — and the flush
      // also commits the cursor, so the stored row itself says how far this run
      // got. Nothing is prefixed onto the message to say it.
      //
      // Guarded against ITSELF (I2): the failure that reached this catch is
      // often a database that will refuse this write too, and an unguarded
      // recovery would propagate a second time and skip the `failed` write
      // below — leaving the row `running` for ever with `error: null`, which is
      // the one outcome nobody can act on.
      try {
        flush('error')
      } catch (flushErr) {
        deps.logger?.warn?.(
          { jobId, cursorSeq: flushedCursor, unledgered, err: failureReason(flushErr) },
          'data-port: the batch in flight could not be committed — its items are on disk but outside the ledger, so the undo cannot reach them until this job runs again',
        )
      }
      // Same reason as the cancel path: what this run did write has to be
      // findable, or the undo cannot take it back (I1).
      reindex()
      deps.logger?.error?.(
        {
          jobId,
          cursorSeq: cursor,
          processed: stats.processed,
          total: stats.total,
          unledgered,
          resumedRun,
          err: failureReason(err),
        },
        unledgered > 0
          ? 'data-port: import run failed and its last batch could not be committed — the items it names are on disk but outside the ledger, so the undo cannot reach them until this job runs again'
          : 'data-port: import run failed — every committed batch keeps its ledger and its cursor, so the job can be resumed or undone',
      )
      updateJob(jobId, {
        status: 'failed',
        phase: 'error',
        error: failureReason(err),
        stats: { ...stats, elapsedMs: elapsed(), ...(unledgered > 0 ? { unledgered } : {}) },
        finishedAt: new Date().toISOString(),
        importMs: elapsed(),
        elapsedMs: elapsed(),
      })
    } finally {
      cancelRequested.delete(jobId)
    }
  }

  return {
    /**
     * Starts a scan and answers at once (P-9): the header row is written with
     * `status: 'running'` and the walk begins on the NEXT tick, so a 38-file
     * tree and a whole home directory answer the same way and the wizard has
     * one code path to poll.
     */
    scanPath(sourceProfile: SourceProfile, path: string, instructions?: string | null): ScanSummary {
      const instr = normalizeInstructions(instructions)
      // Validated HERE, not by the scanner: `scanDirectoryEvents` is a
      // generator, so its own checks would not run until the first `next()` —
      // long after a 202 had promised a scan. A bad path is a 400 with no
      // header row behind it (A-27).
      const root = resolve(path)
      if (!existsSync(root)) throw new Error(`Path does not exist: ${root}`)
      if (!statSync(root).isDirectory()) throw new Error(`Path is not a directory: ${root}`)
      const scanId = generateId()
      insertScanHeader({
        scanId,
        sourceProfile,
        detectedProfile: inferProfileFromInstructions(sourceProfile, instr),
        rootPath: root,
        instructions: instr,
        status: 'running',
        stats: emptyScanStats(),
        warnings: [],
      })
      const events = scanDirectoryEvents({ rootPath: root, sourceProfile, scanId })
      // Claimed before the drive is scheduled, so a cancel arriving in between
      // is not mistaken for a cancel of a scan nobody is driving.
      running.set(scanId, { cancelled: false })
      setImmediate(() => void driveScan(scanId, events, sourceProfile, instr))
      return getScan(scanId)!
    },

    /**
     * An upload is small by construction — `UPLOAD_BODY_BYTES` is the HTTP body
     * limit, the one transport bound P-14 keeps — so it is walked to the end
     * before the caller is answered and comes back `done`.
     */
    async scanUpload(
      sourceProfile: SourceProfile,
      file: { name: string; buffer: Buffer },
      instructions?: string | null,
    ): Promise<ScanSummary> {
      const instr = normalizeInstructions(instructions)
      if (file.buffer.byteLength > UPLOAD_BODY_BYTES) {
        throw new Error(`Upload exceeds ${UPLOAD_BODY_BYTES} bytes limit`)
      }
      const scanDir = join(tmpRoot, generateId())
      mkdirSync(scanDir, { recursive: true })
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.zip')) {
        const zipPath = join(scanDir, 'upload.zip')
        writeFileSync(zipPath, file.buffer)
        const extractDir = join(scanDir, 'extracted')
        mkdirSync(extractDir, { recursive: true })
        const proc = Bun.spawn(['unzip', '-q', '-o', zipPath, '-d', extractDir], {
          stdout: 'ignore',
          stderr: 'pipe',
        })
        const code = await proc.exited
        if (code !== 0) {
          const errText = await new Response(proc.stderr).text()
          rmSync(scanDir, { recursive: true, force: true })
          throw new Error(`Failed to unzip upload: ${errText || code}`)
        }
        const result = await scanDirectory({
          rootPath: extractDir,
          sourceProfile,
          followSymlinks: false,
        })
        return storeCollectedScan(result, sourceProfile, instr)
      }

      // Single text file
      if (
        lower.endsWith('.md') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.json') ||
        lower.endsWith('.jsonl')
      ) {
        const singleDir = join(scanDir, 'single')
        mkdirSync(singleDir, { recursive: true })
        writeFileSync(join(singleDir, file.name.replace(/[/\\]/g, '_')), file.buffer)
        const result = await scanDirectory({
          rootPath: singleDir,
          sourceProfile,
          followSymlinks: false,
        })
        return storeCollectedScan(result, sourceProfile, instr)
      }

      rmSync(scanDir, { recursive: true, force: true })
      throw new Error('Unsupported upload type — use .zip or a text/markdown file')
    },

    getScan,

    /** One page of rows. `total` is the whole filtered set, so the wizard can size its list. */
    listCandidates(
      scanId: string,
      filter: CandidateFilter,
      page: { offset: number; limit: number; order: 'path' | 'seq' },
    ): { items: PublicCandidate[]; total: number } {
      return listCandidates(deps.db, scanId, filter, page)
    },

    countCandidates(scanId: string, filter: CandidateFilter): number {
      return countCandidates(deps.db, scanId, filter)
    },

    candidateCounts(scanId: string, filter: CandidateFilter = {}): StoredCandidateCounts {
      return candidateCounts(deps.db, scanId, filter)
    },

    /**
     * The browsable folder tree, one level at a time (A-23). Never built from
     * `counts.byFolder`, which is a top-100 summary and would silently hide a
     * folder the owner is looking for.
     */
    listDirs(scanId: string, parent: string, filter: CandidateFilter = {}): DirNode[] {
      return listDirs(deps.db, scanId, parent, filter)
    },

    selectionCount,
    preview,

    /**
     * Stops a scan and purges its rows, whatever state it is in. A scan this
     * process is driving is cancelled cooperatively — the drive purges at its
     * next event and the answer is `true`; anything else (finished, failed, or
     * driven by a process that has since died) is purged right here and answers
     * `false`. Either way the scan ends up `cancelled` with no rows behind it.
     */
    cancelScan(scanId: string): boolean {
      // `pruneScans` refuses to touch a scan a `pending`/`running` job
      // references, and so must the owner's own DELETE: Task 12's runner walks
      // these rows by keyset while the job runs, so purging them mid-import
      // would truncate it in silence and still report `completed`.
      const busy = deps.db.all(sql`SELECT id FROM data_port_jobs
        WHERE scan_id = ${scanId} AND status IN ('pending', 'running') LIMIT 1`) as Array<{ id: string }>
      if (busy.length) throw new ScanInUse()
      const state = running.get(scanId)
      if (state) {
        state.cancelled = true
        return true
      }
      deleteScanRows(deps.db, scanId)
      deps.db.run(sql`UPDATE data_port_scans
        SET status = 'cancelled', candidate_count = 0, counts_json = NULL, progress_json = NULL,
            finished_at = ${new Date().toISOString()}
        WHERE id = ${scanId}`)
      return false
    },

    /**
     * P-12 — every pre-R11 scan still carrying its candidates as one JSON blob
     * is read once, inserted into the table and marked `format = 2`. A blob
     * that will not parse marks the scan `failed` with a `legacy` warning
     * rather than leaving a row the wizard can open and find empty.
     */
    migrateLegacyScans(): { migrated: number; failed: number } {
      let rows: Array<{ id: string; candidates_json: string; root_path: string; created_at: string }>
      try {
        rows = deps.db.all(
          sql`SELECT id, candidates_json, root_path, created_at FROM data_port_scans
              WHERE format = 1 AND candidates_json <> '[]'`,
        ) as Array<{ id: string; candidates_json: string; root_path: string; created_at: string }>
      } catch {
        // An install predating the `format` column has nothing to migrate.
        return { migrated: 0, failed: 0 }
      }
      let migrated = 0
      let failed = 0
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.candidates_json) as ScanCandidate[]
          if (!Array.isArray(parsed)) throw new Error('stored candidate list is not an array')
          // The insert and the `format = 2` flip are two statements, so a crash
          // between them would leave half a migration; clearing first makes the
          // next start finish the job instead of colliding on the primary key
          // and marking a perfectly good scan `failed` (M-7).
          deleteScanRows(deps.db, row.id)
          insertCandidates(deps.db, row.id, parsed, 0)
          const dirs = dirsFromFolders(
            basename(row.root_path || '.') || '.',
            parsed.map((c) => c.relativePath),
          )
          if (dirs.length) insertDirs(deps.db, row.id, dirs)
          const createdAt = normaliseTimestamp(row.created_at)
          deps.db.run(sql`UPDATE data_port_scans SET
            format = 2,
            candidates_json = '[]',
            candidate_count = ${parsed.length},
            counts_json = ${JSON.stringify(candidateCounts(deps.db, row.id, {}))},
            created_at = ${createdAt ?? row.created_at}
            WHERE id = ${row.id}`)
          migrated++
        } catch (err) {
          failed++
          const message = failureReason(err)
          deps.logger?.warn?.(
            { scanId: row.id, err: message },
            'data-port: a stored scan could not be migrated — it is marked failed and must be re-scanned',
          )
          const warnings: ScanWarning[] = [
            {
              code: 'legacy',
              params: { message },
              message: 'stored candidate list could not be read — re-scan',
            },
          ]
          deps.db.run(sql`UPDATE data_port_scans SET
            status = 'failed',
            format = 2,
            candidates_json = '[]',
            candidate_count = 0,
            warnings_json = ${JSON.stringify(warnings)}
            WHERE id = ${row.id}`)
        }
      }
      return { migrated, failed }
    },

    createJob(input: {
      scanId: string
      sourceProfile: SourceProfile
      /** The P-10 wire, or the legacy id list — both are normalised and stored as a wire. */
      selection: SelectionWire | ImportJobSelection[]
      instructions?: string | null
      /**
       * Ask the model to suggest metadata for notes that declared none. Off
       * unless the owner says otherwise: an import is deterministic by default
       * and sends nothing to a provider.
       */
      enrich?: boolean
    }): ImportJob {
      const scan = getScan(input.scanId)
      if (!scan) throw new Error('Scan not found or expired')
      // Asked BEFORE the row count: a scan still walking has an empty table by
      // definition, and answering "not found" for it would send the wizard off
      // to re-scan a tree that is being walked right now. A job started against
      // it would import a fraction of the tree and report it as all of it.
      if (scan.status === 'running') throw new Error('Scan is still running')
      if (scan.stats.candidateCount === 0) throw new Error('Scan not found or expired')

      const isIdList = Array.isArray(input.selection)
      const wire = normaliseSelection(input.selection)
      // Throws RangeError over the transport limits; the route answers 400.
      const sel = compileSelection(wire)

      // An id list is counted as the caller wrote it — an id this scan does not
      // hold is still an item, reported as a failure by the run rather than
      // dropped here — while a folder/kind gesture is resolved against the
      // table in one streaming pass, never materialised as ids.
      let selectionTotal = 0
      if (isIdList) {
        selectionTotal = wire.rows.length
      } else {
        for (const batch of iterateCandidates(
          deps.db,
          input.scanId,
          { importable: true },
          SELECTION_SCAN_BATCH,
        )) {
          for (const row of batch) if (sel.resolve(row)) selectionTotal++
        }
      }
      if (selectionTotal === 0) throw new Error('No items selected')

      // Prefer job-level instructions; fall back to scan-stored instructions
      const instructions = normalizeInstructions(input.instructions) ?? scan.instructions

      const id = generateId()
      const now = new Date().toISOString()
      const stats = { ...emptyStats(), total: selectionTotal }
      deps.db.run(sql`INSERT INTO data_port_jobs
        (id, status, source_profile, scan_id, selection_json, selection_mode, selection_total, cursor_seq,
         phase, progress, stats_json, error, instructions, enrich, created_at, updated_at, finished_at)
        VALUES (
          ${id}, 'pending', ${input.sourceProfile}, ${input.scanId},
          ${JSON.stringify(wire)}, ${isIdList ? 'ids' : 'wire'}, ${selectionTotal}, -1,
          'queued', 0, ${JSON.stringify(stats)}, NULL, ${instructions},
          ${input.enrich === true ? 1 : 0}, ${now}, ${now}, NULL
        )`)

      // Queued, never started here: one import runs at a time per process, and
      // the drive begins on the next tick so the caller is answered first (P-8).
      enqueue(id)

      return getJob(id)!
    },

    cancelJob,

    /**
     * A-52 — the scan half of the restart sweep.
     *
     * A scan only ever leaves `running` from inside `driveScan`, and that runs
     * in this process. A restart therefore leaves a header claiming to be
     * walking a tree nobody is walking: the wizard polls it for ever, and
     * `createJob` answers 409 against it for ever, so one unlucky restart can
     * take away the owner's ability to start that import at all until the row is
     * edited by hand — the same stuck-forever shape P-8 removed for jobs.
     *
     * Such a scan is CLOSED, never resumed. A scan is cheap to re-run, and it has
     * no cursor of its own: the keyset cursor belongs to the job, and resuming a
     * half-walked tree would mean guessing where the walker stood. What closing
     * must NOT do is throw away what the walk got as far as COMMITTING — every
     * candidate and directory row of a committed batch stays, so the partial
     * scan is still browsable, still importable, and still comparable against a
     * re-scan. The batch in flight when the process died was never committed and
     * is simply not there, which is why `filesScanned` (the walker's last tick)
     * can exceed `candidateCount` (the rows) on a closed scan. The reason says it
     * was a restart rather than an error nobody can act on.
     *
     * Returns how many headers were closed, for the log.
     */
    closeInterruptedScans(): number {
      const stuck = deps.db.all(
        sql`SELECT id, progress_json FROM data_port_scans WHERE status IN ('running', 'pending')`,
      ) as Array<{ id: string; progress_json: string | null }>
      const closed: string[] = []
      for (const row of stuck) {
        // A scan THIS process is driving is not interrupted; it is running.
        if (running.has(row.id)) continue
        const detail = 'it was interrupted by a restart'
        const warnings: ScanWarning[] = [
          {
            code: 'scan-failed',
            params: { detail },
            message: `The scan stopped with an error: ${detail}`,
          },
        ]
        // The walker's counters died with the process, so the last progress tick
        // and the rows on disk are the only truthful sources left. `scanMs` comes
        // from that tick and NEVER from `created_at`, which would hand the owner
        // the hours the server was down as time spent scanning.
        let tick: { dirsVisited?: number; filesSeen?: number; bytes?: number; elapsedMs?: number } = {}
        try {
          tick = row.progress_json ? JSON.parse(row.progress_json) : {}
        } catch {
          tick = {}
        }
        const rowsReached = countCandidates(deps.db, row.id, {})
        const dirsMapped = Number(
          (
            deps.db.all(
              sql`SELECT count(*) AS n FROM data_port_scan_dirs WHERE scan_id = ${row.id}`,
            ) as Array<{ n: number }>
          )[0]?.n ?? 0,
        )
        // Whichever is larger: what the walker last reported, or what is on disk.
        // Neither alone is honest — a tick can be stale by up to 500 files, and a
        // scan that never ticked has only its rows to speak for it (M-2).
        const partial: ScanStats = {
          ...emptyScanStats(),
          filesScanned: Math.max(Number(tick.filesSeen ?? 0), rowsReached),
          dirsVisited: Math.max(Number(tick.dirsVisited ?? 0), dirsMapped),
          totalBytes: Number(tick.bytes ?? 0),
          scanMs: Number(tick.elapsedMs ?? 0),
        }
        deps.db.run(sql`UPDATE data_port_scans SET
          status = 'failed',
          stats_json = ${JSON.stringify(partial)},
          warnings_json = ${JSON.stringify(warnings)},
          scan_ms = ${partial.scanMs},
          finished_at = ${new Date().toISOString()},
          progress_json = NULL,
          candidate_count = ${rowsReached},
          counts_json = ${JSON.stringify(candidateCounts(deps.db, row.id, {}))}
          WHERE id = ${row.id}`)
        closed.push(row.id)
      }
      if (closed.length > 0) {
        deps.logger?.warn?.(
          { scans: closed.length, ids: closed.slice(0, 20) },
          'data-port: scans left mid-walk by a restart were closed — every row a committed batch reached is kept, and the wizard is no longer waiting on a walk nobody is doing',
        )
      }
      return closed.length
    },

    /**
     * A job only ever leaves `running` from inside `runJob`, and that runs in
     * this process. A restart mid-import leaves a row claiming to be running for
     * ever: the UI polls it, and a rollback — which refuses a running job —
     * could never be started, though the ledger is intact and the items it names
     * really are on disk.
     *
     * Under R11 such a job is RESUMED rather than failed (P-8). Its ledger rows
     * and its keyset cursor were committed together, so the walk carries on from
     * the cursor: nothing before it is read again, and anything the dead process
     * wrote past it is recognised and adopted instead of duplicated. Jobs go back
     * on the queue oldest first, and the queue runs them one at a time.
     *
     * Only a job that had STARTED is called resumed — `running`, or one whose
     * cursor has been committed at least once. A job that was still QUEUED when
     * the process died is simply queued again: the wizard must not tell the owner
     * an import was "resumed after a restart" when it had not begun.
     */
    resumeInterruptedJobs(): { resumed: number; released: number } {
      const now = new Date().toISOString()
      const stuck = deps.db.all(
        sql`SELECT id, status, cursor_seq FROM data_port_jobs
            WHERE status IN ('running', 'pending') ORDER BY created_at ASC`,
      ) as Array<{ id: string; status: string; cursor_seq: number }>
      const started = stuck
        .filter((s) => s.status === 'running' || Number(s.cursor_seq) >= 0)
        .map((s) => s.id)
      for (const id of started) {
        deps.db.run(sql`UPDATE data_port_jobs
          SET status = 'pending', phase = 'resuming', error = NULL, finished_at = NULL,
              resumed_count = resumed_count + 1, updated_at = ${now}
          WHERE id = ${id}`)
      }
      // Oldest first, so an import the owner started before a restart runs
      // before one they queued after it.
      for (const s of stuck) enqueue(s.id)
      if (started.length > 0) {
        deps.logger?.info?.(
          { jobs: started.length, ids: started.slice(0, 20) },
          'data-port: imports interrupted by a restart were re-queued and resume from their last committed batch',
        )
      }

      /**
       * An UNDO killed halfway leaves the other kind of stuck row: the claim
       * writes `phase = 'rolling_back'` while the status stays `completed`, and
       * the pass that would have put the phase back died with the process. The
       * status sweep above never sees it, and every later rollback then fails
       * the claim's `phase <> 'rolling_back'` test and answers 409 — for ever,
       * on the one operation whose whole point is that the owner can still get
       * out. Releasing the claim is safe: rollback walks the ledger, and the
       * ledger only ever names what is still there.
       */
      const claimed = deps.db.all(
        sql`SELECT id FROM data_port_jobs
            WHERE phase = 'rolling_back' AND status NOT IN ('running', 'pending')`,
      ) as Array<{ id: string }>
      if (claimed.length > 0) {
        deps.db.run(sql`UPDATE data_port_jobs
          SET phase = 'error', updated_at = ${now}
          WHERE phase = 'rolling_back' AND status NOT IN ('running', 'pending')`)
        deps.logger?.warn?.(
          { jobs: claimed.length, ids: claimed.map((r) => r.id).slice(0, 20) },
          'data-port: rollback interrupted by restart — the claim was released so it can be retried',
        )
      }

      return { resumed: started.length, released: claimed.length }
    },

    getJob,
    listJobs(limit = 20): ImportJob[] {
      const rows = deps.db.all(
        sql`SELECT * FROM data_port_jobs ORDER BY created_at DESC LIMIT ${limit}`,
      ) as any[]
      return rows.map(rowToJob)
    },

    listProposals(filter?: { status?: string; jobId?: string }): WorkspaceProposal[] {
      let rows: any[]
      if (filter?.jobId && filter?.status) {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals WHERE job_id = ${filter.jobId} AND status = ${filter.status} ORDER BY created_at DESC`,
        ) as any[]
      } else if (filter?.jobId) {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals WHERE job_id = ${filter.jobId} ORDER BY created_at DESC`,
        ) as any[]
      } else if (filter?.status) {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals WHERE status = ${filter.status} ORDER BY created_at DESC`,
        ) as any[]
      } else {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals ORDER BY created_at DESC LIMIT 100`,
        ) as any[]
      }
      // One lookup per distinct agent, so a page of proposals over the same
      // workspace costs a single registry read.
      const names = new Map<string, string | null>()
      const agentName = (id: string): string | null => {
        if (!names.has(id)) names.set(id, deps.agentName?.(id) ?? null)
        return names.get(id) ?? null
      }
      return rows.map((row) => rowToProposal(row, agentName))
    },

    getProposal(id: string): WorkspaceProposal | null {
      const rows = deps.db.all(sql`SELECT * FROM data_port_proposals WHERE id = ${id}`) as any[]
      return rows.length ? rowToProposal(rows[0], deps.agentName) : null
    },

    createProposal(input: {
      jobId: string
      agentId: string
      workspaceFile: string
      title: string
      proposedBody: string
      existingBody: string | null
    }): string {
      const id = generateId()
      const now = new Date().toISOString()
      deps.db.run(sql`INSERT INTO data_port_proposals
        (id, job_id, agent_id, workspace_file, title, proposed_body, existing_body, status, created_at, resolved_at)
        VALUES (
          ${id}, ${input.jobId}, ${input.agentId}, ${input.workspaceFile}, ${input.title},
          ${input.proposedBody}, ${input.existingBody}, 'pending', ${now}, NULL
        )`)
      return id
    },

    async approveProposal(
      id: string,
      writer: { write: (req: { agentId: string; file: string; body: string }) => Promise<void> },
      reader?: { read: (agentId: string, file: string) => string | null },
    ): Promise<WorkspaceProposal> {
      const proposal = this.getProposal(id)
      if (!proposal) throw new Error('Proposal not found')
      if (proposal.status !== 'pending') throw new Error(`Proposal already ${proposal.status}`)

      // Append to what the file holds NOW: `existing_body` on the row is the
      // snapshot taken at scan time and is display-only — appending to it would
      // erase every approval made since. The section is bracketed with markers
      // carrying the proposal id, so a rollback can remove exactly this block.
      const current =
        reader?.read(proposal.agentId, proposal.workspaceFile) ?? proposal.existingBody ?? ''
      const section =
        `<!-- eyas-import:${proposal.id} -->\n` +
        `## Imported: ${proposal.title}\n\n${proposal.proposedBody.trim()}\n` +
        `<!-- /eyas-import:${proposal.id} -->\n`
      // A file holding nothing but the writer's own generated header is empty as
      // far as the owner is concerned: separating the section from it would
      // leave a bare `---` at the top of the body once the writer re-generates
      // that header — and a rollback would have nothing to attach it to.
      const ownText = parseWorkspaceFrontmatter(current) ? stripWorkspaceFrontmatter(current) : current
      const body = ownText.trim() ? `${current.trimEnd()}\n\n---\n\n${section}` : section

      await writer.write({
        agentId: proposal.agentId,
        file: proposal.workspaceFile,
        body,
      })

      const now = new Date().toISOString()
      deps.db.run(sql`UPDATE data_port_proposals SET status = 'approved', resolved_at = ${now} WHERE id = ${id}`)
      return this.getProposal(id)!
    },

    rejectProposal(id: string): WorkspaceProposal {
      const proposal = this.getProposal(id)
      if (!proposal) throw new Error('Proposal not found')
      if (proposal.status !== 'pending') throw new Error(`Proposal already ${proposal.status}`)
      const now = new Date().toISOString()
      deps.db.run(sql`UPDATE data_port_proposals SET status = 'rejected', resolved_at = ${now} WHERE id = ${id}`)
      return this.getProposal(id)!
    },

    /**
     * Undo an import from the ledger it wrote. The services rollback is allowed
     * to touch are handed in by the caller (the module wires them from the live
     * registries); the database is always this service's own.
     */
    rollback(jobId: string, rollbackDeps: RollbackDeps): Promise<RollbackResult> {
      return rollbackJob({ ...rollbackDeps, db: deps.db }, jobId)
    },

    /** Safe path check helper for callers. */
    pathExists(path: string): boolean {
      try {
        return existsSync(resolve(path))
      } catch {
        return false
      }
    },
  }
}

export type DataPortService = ReturnType<typeof createDataPortService>
