// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type SourceProfile =
  | 'auto'
  | 'claude-code'
  | 'grok-cli'
  | 'cursor'
  | 'codex'
  | 'gemini-cli'
  | 'windsurf'
  | 'copilot'
  | 'obsidian'
  | 'chat-export'
  | 'eyas-export'
  | 'generic-md'

/**
 * Every kind a scanned row may carry. Kept as a value, not only a type, so the
 * six locale files can be checked against it: the wizard renders each as
 * `settings.dataPort.wizard.kind.<kind>`.
 */
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
  /**
   * A cloud provider's sync root (A-66). Its contents are PLACEHOLDERS, not
   * files the owner has: reading one makes the provider download it. Mapping a
   * whole home directory pulled 9.7 GB through a File Provider before this
   * class existed. Listed as one counted row like any other class, so nothing
   * is hidden and a scan pointed straight at the folder still walks it.
   */
  'cloud-storage',
  /**
   * Language/package manager caches (`.cargo`, `.bun`, `.pub-cache`, …).
   * Mapped as one counted row; a scan pointed at the folder still walks it.
   */
  'package-cache',
  /** Apple Photos library bundle — Spotlight text inside is not owner memory. */
  'photos-library',
  /**
   * Tool scratch: session-stats, marketplace caches, editor extension trees,
   * previous EYAS memory snapshots. Counted, not entered.
   */
  'tool-ephemera',
] as const
export type DirectoryClass = (typeof DIRECTORY_CLASSES)[number]

/** Tags a candidate may carry that the wizard shows as badges (the applied item keeps them as tags). */
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
  /**
   * The retention sweep that trims old scans failed (A-53). Fail-soft by
   * design — trading the scan the owner asked for against a tidy-up would be
   * the wrong bargain — but a log line is not enough: a sweep that fails
   * silently fails on EVERY scan, and the table keeps growing by hundreds of
   * thousands of rows per scan of a whole home directory.
   */
  'retention-sweep-failed',
] as const
export type ScanWarningCode = (typeof SCAN_WARNING_CODES)[number]

export interface ScanWarning {
  code: ScanWarningCode | 'legacy'
  params?: Record<string, string | number>
  /** English, for logs; the UI translates `settings.dataPort.scanWarning.<code>`. */
  message: string
}

export const JOB_PHASES = [
  'queued',
  'read',
  'apply',
  'index',
  'done',
  'error',
  'resuming',
  'cancelled',
] as const
export type JobPhase = (typeof JOB_PHASES)[number]

/**
 * Every target a candidate may be sent to. Kept as a value, not only a type, so
 * the API's schema is built from this list instead of a hand-copied duplicate —
 * a target added here cannot be silently rejected at the route.
 */
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

/**
 * The whole fixed vocabulary of reason codes — the scanner's, the adapters' and
 * the runner's alike. Every outcome that is not a clean apply is counted under
 * one of these, and the UI translates each as
 * `settings.dataPort.reason.<code>`, so a code invented at a call site would
 * reach the operator untranslated. Kept as a value, not only a type, so the
 * locale files can be checked against it instead of against a hand-copied list.
 */
export const REASON_CODES = [
  // Scanner: what a file is
  'memory-note',
  'memory-index',
  'session-summary',
  'transcript',
  'session-artifact',
  'skill',
  'skill-package',
  'slash-command',
  'rules-file',
  'cursor-rule',
  'persona',
  'identity',
  'tools-policy',
  'config',
  'source-code',
  'data-file',
  'derived-index',
  'app-state',
  // Scanner: a directory mapped as one row, never descended (D-9). Emitted as
  // `directory-skipped:<class>`; the locale key is the bare prefix.
  'directory-skipped',
  // Scanner: why a file was passed over (no text content) or labelled
  'not-durable',
  'unrecognised',
  'binary',
  'empty',
  'unreadable',
  'outside-root',
  'symlink-upload',
  'duplicate-content',
  'orphan-asset',
  'invalid-json',
  'unknown-json',
  'needs-bun',
  /**
   * A dematerialised file: it reports a size but has no blocks allocated
   * locally, so the bytes live in the cloud and reading them would fetch them
   * (A-66). Listed with everything the scan knows from `stat`, never read.
   */
  'not-downloaded',
  // Runner and apply
  'not-importable',
  'missing-unit',
  'unsupported-target',
  'service-unavailable',
  'not-a-persona',
  'no-agent',
  'unchanged',
  'error',
  // Runner: a single text file the engine cannot hold as one string (P-17) — a
  // truthful reason, never a silent error.
  'exceeds-string-limit',
] as const

export type ReasonCode = (typeof REASON_CODES)[number]

/** `directory-skipped:node_modules` → `directory-skipped`; a plain code is itself. */
export function reasonPrefix(code: string): string {
  const at = code.indexOf(':')
  return at < 0 ? code : code.slice(0, at)
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'rolled_back'
export type ProposalStatus = 'pending' | 'approved' | 'rejected'

export interface ScanCandidate {
  id: string
  relativePath: string
  /**
   * The marker-preserving relative path the adapter classified and expanded
   * (root basename or absolute-derived). A scan rooted inside an assistant tree
   * hands the classifier a path the row itself does not have — `.grok/memory/…`
   * for a scan rooted at `~/.grok/memory` — so the runner passes
   * `candidate.classifiedPath ?? candidate.relativePath` to the claiming
   * adapter's `read`/`expand`, and scan time and apply time agree on the path by
   * construction. Absent when the two are the same.
   */
  classifiedPath?: string
  /** Rule scope declared by the source (globs / applyTo); shown in the proposal title. */
  scope?: string
  kind: CandidateKind
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
  /** Full text kept server-side for the job; not always returned to client. */
  content?: string
  /** The adapter that claimed this file; it also expands and reads it. */
  adapterId?: SourceProfile
  /** Absolute path on the server; stripped from API responses. */
  sourcePath?: string
  /** Unit inside a container file (conversation id, row id); null for whole files. */
  unit?: string | null
  sha256?: string
  mtime?: string
  birthtime?: string
  /** Files bundled with a SKILL.md, relative to the skill directory. */
  assets?: Array<{
    relPath: string
    bytes: number
    sha256: string
    binary: boolean
    containsSecrets?: boolean
  }>
  /**
   * Files that belong to the package but were deliberately left out of it — an
   * escaped path. Named so the skill body can say which files it does NOT carry
   * instead of the owner finding a lone noise row and no trace in the skill
   * (A7.8).
   */
  notBundled?: Array<{ relPath: string; bytes: number; reason: string; notDownloaded?: boolean }>
  /** Every path the same content was found at (symlink aliases, identical copies). */
  paths?: string[]
  sessionId?: string | null
  sessionDate?: string | null
  /** Present only on `directory-skipped:*` rows. */
  directory?: { class: DirectoryClass; files: number; dirs: number; unreadable: number }
  warnings?: CandidateWarning[]
  /**
   * Adapter- and classifier-derived tags the applied item keeps (`legacy`,
   * `third-party`, `contains-secrets`, `subagent`, `claude-project:<slug>` …).
   */
  tags?: string[]
  turns?: number | null
  /** Set by the candidate store on read: scan emission order and the row's folder. */
  seq?: number
  folder?: string
  importable?: boolean
}

export interface ScanStats {
  filesScanned: number
  filesSkipped: number
  totalBytes: number
  dirsVisited: number
  dirsSkipped: Record<DirectoryClass, number>
  filesInSkippedDirs: number
  symlinksFollowed: number
  symlinkAliases: number
  symlinkCycles: number
  unreadable: number
  largeFiles: number
  /**
   * A-84. Files that looked like cloud placeholders while this platform had not
   * yet demonstrated that `st_blocks` is populated, and were therefore
   * classified normally. Non-zero means placeholder detection was inactive for
   * that many files — the safe direction, and the operator is told why.
   */
  datalessUnverified?: number
  scanMs: number
}

/** Scanner-internal shape (what `scanDirectory` collects). The API answers with `ScanSummary`. */
export interface ScanResult {
  scanId: string
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  /** Optional free-text guidance from the user about what to look for. */
  instructions: string | null
  candidates: ScanCandidate[]
  dirs: ScanDirRow[]
  stats: ScanStats
  warnings: ScanWarning[]
}

export interface ScanDirRow {
  path: string
  parent: string | null
  name: string
  depth: number
  skippedClass: DirectoryClass | null
  fileCount: number
  aliasOf: string | null
}

export type ScanStatus = 'running' | 'done' | 'failed' | 'cancelled'

/** The three numbers every count in this module reports for a group of rows. */
export interface CountBucket {
  total: number
  importable: number
  selectedByDefault: number
}

export interface CandidateCounts extends CountBucket {
  byKind: Array<{ key: string } & CountBucket>
  byReason: Array<{ key: string; total: number }>
  /** A folder's OWN rows, not its subtree — `SelectionCountResult.byFolder` is the subtree one. */
  byFolder: Array<{ key: string } & CountBucket>
}

export interface ScanSummary {
  scanId: string
  status: ScanStatus
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  instructions: string | null
  stats: ScanStats & { candidateCount: number; directoriesMapped: number }
  progress: {
    dirsVisited: number
    filesSeen: number
    candidates: number
    bytes: number
    elapsedMs: number
    currentDir: string
  } | null
  counts: CandidateCounts
  warnings: ScanWarning[]
}

/** What leaves the API: never the server path, never the body. */
export type PublicCandidate = Omit<ScanCandidate, 'sourcePath' | 'content'> & {
  seq: number
  folder: string
  importable: boolean
}

export interface CandidateFilter {
  kind?: CandidateKind[]
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
   * themselves: `tag: ['legacy', 'contains-secrets']` matches a row carrying
   * BOTH. Every field of the filter is ANDed against every other, and a tag is
   * matched whole — `tag: ['session']` does not match a row tagged
   * `session-part:1/of` (A-23).
   */
  tag?: string[]
  excludeKinds?: CandidateKind[]
  excludeReasons?: string[]
  excludeFolders?: string[]
}

export interface SelectionWire {
  base: 'default' | 'all' | 'none'
  /** Ordered; the LAST matching group wins. `folder` is scan-relative at any depth, `.` = root. */
  groups: Array<{ kind?: CandidateKind; folder?: string; selected: boolean }>
  rows: Array<{ candidateId: string; selected?: boolean; target?: CandidateTarget }>
}

export interface ImportJobSelection {
  candidateId: string
  /** Override target if user changed it in the wizard. */
  target?: CandidateTarget
}

export interface ImportJobStats {
  /** Rows the resolved selection holds — known before the first item is read. */
  total: number
  processed: number
  applied: number
  skipped: number
  /** Re-imported files whose content hash already matched the ledger. */
  unchanged: number
  proposals: number
  errors: number
  aiEnriched: number
  aiFallback: number
  byKind: Record<string, number>
  /**
   * Reason code → how many items ended that way. Every outcome that is not a
   * clean apply is counted here — a skip, an `unchanged` re-import and an
   * `error` alike — always from the fixed code vocabulary the UI translates,
   * never a free-text key.
   */
  skippedReasons: Record<string, number>
  /** Wall time of the run so far; the wizard reports it when the job finishes. */
  elapsedMs: number
  /**
   * Items this job wrote whose ledger rows a failed flush could not commit —
   * present only when it happened, which takes a database that refuses a write
   * mid-run. They are on disk and outside the ledger, so the undo cannot reach
   * them and nothing adopts them unless this same job runs again. Rendering it
   * needs a six-language string, which is Task 16's to add (A-45); until then
   * the number is on the job row and in the failure log.
   */
  unledgered?: number
  /**
   * How many times this job has been resumed after an interruption — the
   * job row's `resumed_count`, not a count of items. A job that has never
   * been interrupted reports 0, and the wizard says "Resumed after restart"
   * only above that.
   */
  resumed: number
}

export interface ImportJob {
  id: string
  status: JobStatus
  sourceProfile: SourceProfile
  scanId: string
  /** Optional free-text guidance carried from the wizard into AI classify/transform. */
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
  status: ProposalStatus
  /**
   * Display name of the agent whose workspace the section would land in. `null`
   * when the row targets a project-type prompt (the `-` sentinel owns no agent)
   * or when the agent has since been deleted.
   */
  agentName: string | null
  createdAt: string
  resolvedAt: string | null
}

export type ImportedNoteKind = 'user' | 'feedback' | 'domain' | 'project' | 'reference'

export interface MemoryTransformResult {
  skip?: boolean
  /** Vault frontmatter kind. Undeclared notes must be `reference`, never `user`. */
  kind: ImportedNoteKind
  title: string
  /** Verbatim source body. Never produced by a model. */
  body: string
  tags: string[]
  links: string[]
  aliases: string[]
  salience: number
  summary_one_line: string
  /** YYYY-MM-DD, or null when neither the file nor the filesystem says so. */
  created: string | null
  updated: string | null
  /** Provenance written to frontmatter `source:` — the original frontmatter travels inside it. */
  source: Record<string, unknown>
}

/**
 * One file bundled with a SKILL.md. `content` is a Buffer for anything that is
 * not text; `binary` marks it explicitly when the reader already knows.
 */
export interface SkillAsset {
  relPath: string
  content: string | Buffer
  /** POSIX mode of the source file, so an executable script stays executable. */
  mode?: number
  binary?: boolean
  /**
   * sha256 of the file as read, when the scanner already computed one. Apply
   * folds it into the package digest instead of re-hashing the bytes; absent,
   * the content in hand is hashed.
   */
  sha256?: string
  /**
   * The secrets heuristic matched this file. A flag, never a refusal (D-7): the
   * bytes are bundled verbatim and the package carries the tag.
   */
  containsSecrets?: boolean
}

export interface SkillTransformResult {
  name: string
  description: string
  trigger_patterns: string[]
  capabilities: string[]
  /** SKILL.md body, verbatim. Bundled files are appended at apply time. */
  content: string
  skill_type: 'knowledge' | 'tool' | 'integration'
  assets: SkillAsset[]
  /** Files of the package left out because their path escaped it; named in the body (A7.8). */
  notBundled?: Array<{ relPath: string; bytes: number; reason: string; notDownloaded?: boolean }>
  /** Any file of the package looked like a secret; the applied skill keeps the tag. */
  containsSecrets?: boolean
  sourcePath: string
  /**
   * sha256 of the SKILL.md file as read. Only the digest of the source travels;
   * apply uses its first bytes to give the package a stable, collision-free
   * asset directory. Optional so a caller that assembled a package by hand — a
   * test, a future adapter — need not compute one.
   */
  rawSha256?: string
}
