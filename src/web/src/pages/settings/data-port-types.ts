// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The wire the data-port API answers with, as the wizard sees it. These mirror
// `src/modules/data-port/types.ts` and `candidates-store.ts`; the web app is a
// separate package with its own build, so it carries its own declarations
// rather than importing server modules. Anything that leaves the API is here —
// never `sourcePath` and never `content`, which the server strips.

/**
 * Profile ids come from the server (one per adapter), so the UI must not carry
 * a closed union that goes stale whenever an adapter is added.
 */
export type SourceProfile = string

export const CANDIDATE_TARGETS = [
  'episodic',
  'vault.semantic',
  'vault.procedural',
  'skill',
  'agent',
  'workspace.agents',
  'workspace.soul',
  'workspace.identity',
  'workspace.tools',
  'workspace.memory',
  'prompt.project-type',
  'none',
] as const
export type CandidateTarget = (typeof CANDIDATE_TARGETS)[number]

/** The two destinations any rule file may be redirected to. */
export const RULE_TARGETS: CandidateTarget[] = ['workspace.agents', 'prompt.project-type']

/**
 * A rule row's options: its own suggested target first, then the two rule
 * destinations. Without the row's own target a `workspace.tools` rule would
 * select nothing — the control would paint blank and lie about where the file
 * is actually going.
 */
export function ruleTargetOptions(target: CandidateTarget): CandidateTarget[] {
  return [target, ...RULE_TARGETS.filter((t) => t !== target)]
}

export const CANDIDATE_KINDS = [
  'memory',
  'index',
  'session',
  'skill',
  'rule',
  'identity',
  'persona',
  'knowledge',
  'code',
  'noise',
  'unknown',
] as const
export type CandidateKind = (typeof CANDIDATE_KINDS)[number]

/**
 * Display order for the kind strip and the grouped review sections. `code` is
 * new in R11 (source files are listed and importable, just not ticked);
 * `unknown` is legacy-only — P-2 stopped emitting it, but a migrated
 * `format = 1` scan can still carry it, so it keeps its place and its label.
 */
export const KIND_ORDER = [
  'memory',
  'index',
  'session',
  'skill',
  'rule',
  'identity',
  'persona',
  'knowledge',
  'code',
  'unknown',
  'noise',
] as const

/** D-9: the only directory classes the walker does not enter. Each is one counted row. */
export const DIRECTORY_CLASSES = [
  'node_modules',
  'vcs',
  'cache',
  'pycache',
  'venv',
  'build-output',
  'browser-profile',
  'trash',
  'os-cache',
  /** A cloud provider's sync root: placeholders, not files the owner has (A-66). */
  'cloud-storage',
  'package-cache',
  'photos-library',
  'tool-ephemera',
] as const
export type DirectoryClass = (typeof DIRECTORY_CLASSES)[number]

/** Tags a candidate may carry that the wizard shows as badges. */
export const CANDIDATE_TAG_LABELS = ['legacy', 'third-party', 'contains-secrets', 'subagent'] as const

/** Informational marks on a row; never affect `selectedByDefault`. */
export const CANDIDATE_WARNINGS = ['large-file', 'secrets-scan-head-only', 'symlink-cycle'] as const
export type CandidateWarning = (typeof CANDIDATE_WARNINGS)[number]

export const SCAN_WARNING_CODES = [
  'instructions-applied',
  'home-root-mapped',
  'directories-skipped',
  'large-files',
  'rows-passed-over',
  'symlink-cycles',
  'unreadable',
  'scan-failed',
  /** The retention sweep that trims old scans failed; the scan itself is fine (A-53). */
  'retention-sweep-failed',
] as const
export type ScanWarningCode = (typeof SCAN_WARNING_CODES)[number]

/**
 * A pre-R11 server answered a plain string; `code: 'legacy'` carries one
 * through with the text in `params.message`.
 */
export interface ScanWarning {
  code: ScanWarningCode | 'legacy' | string
  params?: Record<string, string | number>
  /** English, for logs; the UI translates `settings.dataPort.scanWarning.<code>`. */
  message: string
}

export const JOB_PHASES = ['queued', 'read', 'apply', 'index', 'done', 'error', 'resuming', 'cancelled'] as const
export type JobPhase = (typeof JOB_PHASES)[number]

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rolled_back'
export type ProposalStatus = 'pending' | 'approved' | 'rejected'
export type ScanStatus = 'running' | 'done' | 'failed' | 'cancelled'

/** One row as it leaves the API: never the server path, never the body. */
export interface PublicCandidate {
  id: string
  relativePath: string
  /** Scan emission order — the runner's keyset, and this row's stable place in a page. */
  seq: number
  /** The row's directory, scan-relative; `.` for a file at the root. */
  folder: string
  /** `target !== 'none'`: what the selection resolver gates on before anything else. */
  importable: boolean
  kind: CandidateKind | string
  target: CandidateTarget
  title: string
  preview: string
  /** stat size for every row, read or not; 0 for a directory row. */
  bytes: number
  confidence: number
  reason: string
  /** Kebab-case machine reason the UI translates; `reason` stays for logs. */
  reasonCode: string
  selectedByDefault: boolean
  classifiedPath?: string
  scope?: string
  adapterId?: SourceProfile
  unit?: string | null
  sha256?: string
  mtime?: string
  birthtime?: string
  assets?: Array<{ relPath: string; bytes: number; sha256: string; binary: boolean; containsSecrets?: boolean }>
  notBundled?: Array<{ relPath: string; bytes: number; reason: string }>
  /** Every path the same content was found at (symlink aliases, identical copies). */
  paths?: string[]
  sessionId?: string | null
  sessionDate?: string | null
  /** Present only on `directory-skipped:*` rows. */
  directory?: { class: DirectoryClass | string; files: number; dirs: number; unreadable: number }
  warnings?: Array<CandidateWarning | string>
  tags?: string[]
  turns?: number | null
}

export interface ScanStats {
  filesScanned: number
  filesSkipped: number
  totalBytes: number
  dirsVisited: number
  dirsSkipped: Record<string, number>
  filesInSkippedDirs: number
  symlinksFollowed: number
  symlinkAliases: number
  symlinkCycles: number
  unreadable: number
  largeFiles: number
  /** A-84: files that looked dematerialised before this platform proved `st_blocks` works. */
  datalessUnverified?: number
  scanMs: number
}

/** The three numbers every count bucket answers with. */
export interface CountBucket {
  total: number
  importable: number
  selectedByDefault: number
}

/**
 * `byFolder` is capped at `COUNT_FOLDER_LIMIT` and `folders` accounts for
 * everything below the cut (A-23), so a whole-home scan's counts stay a few
 * kilobytes. It is a summary, never a directory listing: the browsable tree
 * comes from `GET /tree?parent=`, which pages by parent.
 */
export interface FolderCountSummary {
  distinct: number
  shown: number
  limit: number
  other: CountBucket
}

/** Task 8's `COUNT_FOLDER_LIMIT` — the cap `folders.limit` reports back. */
export const COUNT_FOLDER_LIMIT = 100

export interface CandidateCounts extends CountBucket {
  byKind: Array<{ key: string } & CountBucket>
  byReason: Array<{ key: string; total: number }>
  byFolder: Array<{ key: string } & CountBucket>
  /** Absent on a scan counted by a pre-A-23 server. */
  folders?: FolderCountSummary
}

export interface ScanProgress {
  dirsVisited: number
  filesSeen: number
  candidates: number
  bytes: number
  elapsedMs: number
  currentDir: string
}

/** What `POST /import/scan` (202) and `GET /import/scans/:id` answer — never the rows. */
export interface ScanSummary {
  scanId: string
  status: ScanStatus
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  instructions: string | null
  stats: ScanStats & { candidateCount: number; directoriesMapped: number }
  /** Non-null only while the scan is running. */
  progress: ScanProgress | null
  counts: CandidateCounts
  warnings: Array<ScanWarning | string>
}

export interface ScanDirRow {
  path: string
  parent: string | null
  name: string
  depth: number
  /** Non-null on a directory the walker listed as one row and did not enter. */
  skippedClass: DirectoryClass | string | null
  fileCount: number
  aliasOf: string | null
}

/** A directory with its subtree aggregates under the current filter. */
export interface DirNode extends ScanDirRow {
  subtree: CountBucket
  byKind: Record<string, number>
  byReason: Record<string, number>
  hasChildren: boolean
}

export interface CandidateFilter {
  kind?: Array<CandidateKind | string>
  /** Exact code, or a bare prefix such as `directory-skipped` matching every classed code. */
  reason?: string[]
  folder?: string
  /** `true` = subtree (default), `false` = the folder's direct children only. */
  subtree?: boolean
  selected?: boolean
  importable?: boolean
  q?: string
  /**
   * AND within itself, unlike `kind` and `reason`, which are OR within
   * themselves. Every field is ANDed against every other, and a tag matches
   * whole — `tag: ['session']` does not match a row tagged `session-part:1/of`.
   */
  tag?: string[]
  excludeKinds?: Array<CandidateKind | string>
  excludeReasons?: string[]
  excludeFolders?: string[]
}

/** One page of `GET /import/scans/:id/candidates`. */
export interface CandidatePage {
  items: PublicCandidate[]
  total: number
  offset: number
  limit: number
}

/** `GET /import/scans/:id/tree?parent=` — children of one folder, plus its own file counts. */
export interface TreePage {
  parent: string
  dirs: DirNode[]
  files: CandidateCounts
}

/** `POST /import/scans/:id/selection/count` — the resolved selection, server-side. */
export interface SelectionCountResult {
  selected: number
  byKind: Record<string, number>
  byFolder: Record<string, number>
}

/** `GET /import/scans/:id/candidates/:cid/preview` (P-11). */
export interface CandidatePreview {
  candidate: PublicCandidate
  /** Absent for a binary row and for a directory row. */
  head?: string
  truncated?: boolean
  encoding?: 'utf-8' | 'binary'
  /** First entries of a `directory-skipped` row. */
  children?: string[]
  frontmatter?: Record<string, unknown>
}

/**
 * P-10. Ordered: the LAST matching group wins, `folder` matches the folder and
 * everything under it at any depth, `.` matches the whole scan.
 */
export interface SelectionWire {
  base: 'default' | 'all' | 'none'
  groups: Array<{ kind?: CandidateKind | string; folder?: string; selected: boolean }>
  rows: Array<{ candidateId: string; selected?: boolean; target?: CandidateTarget }>
}

/** The pre-R11 id list. Still accepted by the API and normalised into a wire. */
export interface ImportJobSelection {
  candidateId: string
  target?: CandidateTarget
}

export interface ImportJobStats {
  /** Rows the resolved selection holds — known before the first item is read. */
  total: number
  processed: number
  applied: number
  skipped: number
  unchanged: number
  proposals: number
  errors: number
  aiEnriched: number
  aiFallback: number
  byKind: Record<string, number>
  /** Reason code → how many items ended that way; the UI translates each. */
  skippedReasons: Record<string, number>
  elapsedMs: number
  /** Items applied by an earlier run of the same job, skipped on resume. */
  resumed: number
}

export interface ImportJob {
  id: string
  status: JobStatus | string
  sourceProfile: SourceProfile
  scanId: string
  instructions: string | null
  phase: JobPhase | string
  progress: number
  stats: ImportJobStats
  error: string | null
  /** How the selection reached the job: an id list, or the folder/kind wire (P-10). */
  selectionMode: 'ids' | 'wire'
  selectionTotal: number
  /** Keyset cursor into the scan's emission order; a restart resumes from here (P-8). */
  cursorSeq: number
  startedAt: string | null
  importMs: number | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export interface WorkspaceProposal {
  id: string
  jobId: string
  agentId: string
  workspaceFile: string
  title: string
  proposedBody: string
  existingBody: string | null
  status: ProposalStatus | string
  /** Null for a project-type prompt (the `-` sentinel owns no agent). */
  agentName?: string | null
  createdAt?: string
  resolvedAt?: string | null
}

/** The rollback endpoint reports what it removed, counted per kind. */
export interface RollbackResult {
  removed?: Record<string, number>
  skipped?: string[]
}
