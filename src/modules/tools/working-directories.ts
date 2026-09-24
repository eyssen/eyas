// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { resolveHome } from '@core/instance.js'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import {
  currentHomeDir,
  getPathPolicy,
  WORKSPACES_ROOT_LABEL,
  type PathClassification,
  type PathPolicy,
} from '@shared/memory-sovereignty/path-policy.js'
import type { ToolContext } from './types.js'

const SENSITIVE_BASENAME_RE =
  /^(master\.key|\.env(\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i

const SENSITIVE_PATH_RE =
  /(^|[\\/])(\.ssh|data[\\/]sqlite)([\\/]|$)|master\.key|\.env(\.[A-Za-z0-9_-]+)?(?=$|[\\/])/i

export const NO_WORKING_DIR =
  'no working directory configured — set Folders on this conversation or the project'

export interface NamedWorkingDirectory {
  name: string
  path: string
}

export function workspaceBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function parseNamedWorkingDirectories(raw: unknown): NamedWorkingDirectory[] {
  if (raw == null) return []
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      return parseNamedWorkingDirectories(JSON.parse(trimmed))
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  const out: NamedWorkingDirectory[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const path = item.trim()
      if (!path) continue
      out.push({ name: workspaceBasename(path), path })
      continue
    }
    if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
      const path = (item as { path: string }).path.trim()
      if (!path) continue
      const rawName = (item as { name?: unknown }).name
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      out.push({ name: name || workspaceBasename(path), path })
    }
  }
  return out
}

export function parseWorkingDirectories(raw: unknown): string[] {
  return parseNamedWorkingDirectories(raw).map((entry) => entry.path)
}

/** Project list wins when non-empty; otherwise the type list. */
export function inheritWorkingDirectories(projectDirs: unknown, typeDirs: unknown): NamedWorkingDirectory[] {
  const own = parseNamedWorkingDirectories(projectDirs)
  if (own.length > 0) return own
  return parseNamedWorkingDirectories(typeDirs)
}

export function serializeWorkingDirectories(
  entries: NamedWorkingDirectory[],
): Array<string | { name: string; path: string }> {
  return entries.map((entry) => (
    !entry.name || entry.name === workspaceBasename(entry.path)
      ? entry.path
      : { name: entry.name, path: entry.path }
  ))
}

// ── Folder validation ───────────────────────────────────────────────────
//
// The one check a folder passes before it is saved on a conversation, a
// project or a project type, and before a stored folder is used for a run
// (screenToolWorkspaceFields in the agent runner, cli-runtime resolveCliCwd
// for a CLI cwd). Built on the memory-sovereignty path policy: a model works
// in these folders with file and shell tools, and a CLI reads inside its cwd
// without asking, so none of them may be — sit inside, or CONTAIN — another
// tool's memory, a notes vault, EYAS's own home or data, or a CLI's
// credentials; and none may be the home folder or above it, from where all
// of that is one `cd` away.

/** Why a folder was refused. The web maps each to projects.folders.error.<code>. */
export const FOLDER_ERROR_CODES = [
  /** The filesystem root, the operator's home, or a folder above the home. */
  'home',
  /** Inside another CLI tool's store (FOREIGN_MEMORY_STORES) or an EYAS-owned CLI home. */
  'providerHome',
  /** Inside an Obsidian vault, an ai-memory folder or a security.foreignMemoryPaths entry. */
  'vault',
  /** Inside the EYAS data dir but not in one of its work areas (workspaces, Studio, downloads). */
  'eyasData',
  /** SSH keys, .env files, the master key or the database folder. */
  'sensitive',
  /**
   * The EYAS home itself, or a folder that contains it, the data dir, the
   * database or the workspaces root (a checkout holding data/, for one).
   */
  'containsEyasData',
  /** Contains another CLI tool's store, a tool memory folder or an EYAS-owned CLI home. */
  'containsProviderHome',
  /** Contains a notes vault (a `.obsidian` marker or Obsidian's registry), an ai-memory folder or a security.foreignMemoryPaths entry. */
  'containsVault',
  /** Not an absolute path (a null byte included). */
  'notAbsolute',
  /** Missing, or it cannot be stat'ed or resolved. */
  'notFound',
  'notDirectory',
] as const

export type FolderErrorCode = (typeof FOLDER_ERROR_CODES)[number]

const MAX_FOLDER_PATH = 4096
const MAX_FOLDER_NAME = 256

/** One folder as a request carries it: a bare path or a named entry. */
export const WorkingDirectoryInputSchema = z.union([
  z.string().trim().min(1).max(MAX_FOLDER_PATH),
  z.object({
    name: z.string().trim().max(MAX_FOLDER_NAME).optional(),
    path: z.string().trim().min(1).max(MAX_FOLDER_PATH),
  }),
])

export type WorkingDirectoryInput = z.infer<typeof WorkingDirectoryInputSchema>

/**
 * The `workingDirectories` field of a folder save body: a list (empty or
 * null clears it). Anything else — a string, an object, a blank path — is
 * refused before any folder is looked at.
 */
export const WorkingDirectoriesBodySchema = z.array(WorkingDirectoryInputSchema).nullable().optional()

export interface ValidateWorkingDirectoriesOpts {
  /** Default: the process-wide policy (getPathPolicy()). */
  policy?: PathPolicy
  /** The operator's home for the `home` rule. Default: currentHomeDir(). */
  homeDir?: string
  /** The EYAS home (instance home) for the `containsEyasData` rule. Default: core/instance resolveHome(). */
  eyasHome?: string
}

export type ValidateWorkingDirectoriesResult =
  | { ok: true; paths: string[]; entries: NamedWorkingDirectory[] }
  | {
      ok: false
      code: FolderErrorCode
      error: string
      path: string
      /** For a contains* refusal: the protected place found inside the folder. */
      found?: string
    }

const caseFolding = process.platform === 'darwin' || process.platform === 'win32'

/** Comparable form of an absolute path: forward slashes, no trailing slash, case-folded where the filesystem folds case. */
function comparable(p: string): string {
  let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  return caseFolding ? s.toLowerCase() : s
}

/** A path as written (resolved) and after realpath of its nearest existing ancestor. */
function pathForms(p: string): string[] {
  const lexical = resolve(p)
  let real = lexical
  try {
    real = realpathBestEffort(lexical)
  } catch {
    /* the lexical form alone */
  }
  return [...new Set([comparable(lexical), comparable(real)])]
}

/** True when `target` is `path` itself or lies inside it (by any of their forms). */
function isAtOrAbove(path: string, target: string): boolean {
  const targets = pathForms(target)
  return pathForms(path).some((form) =>
    targets.some((t) => t === form || t.startsWith(form.endsWith('/') ? form : `${form}/`)))
}

/** True for the filesystem root, the home itself, or any folder the home lies inside. */
function isHomeOrAbove(path: string, homeDir: string): boolean {
  if (pathForms(path).some((form) => form === '/' || /^[a-z]:\/?$/i.test(form))) return true
  return isAtOrAbove(path, homeDir)
}

/** The folder code for a path-policy verdict. */
function codeForVerdict(verdict: PathClassification): FolderErrorCode | null {
  switch (verdict.kind) {
    case 'ok':
      return null
    case 'provider-home':
      return 'providerHome'
    case 'eyas-data':
      return 'eyasData'
    case 'foreign-memory':
      if (verdict.rule === 'foreign-store' || verdict.rule === 'foreign-store-other-home') {
        // A note app's own config (Obsidian's vault registry) counts as the vault it points at.
        return verdict.category === 'note-app' ? 'vault' : 'providerHome'
      }
      if (verdict.rule === 'memory-segment') return verdict.ruleId === 'tool-memory' ? 'providerHome' : 'vault'
      return 'vault'
  }
}

/** The contains* code for a protected place found below a folder. */
const CONTAINS_CODE: Partial<Record<FolderErrorCode, FolderErrorCode>> = {
  eyasData: 'containsEyasData',
  providerHome: 'containsProviderHome',
  vault: 'containsVault',
}

const FOLDER_ERROR_TEXT: Record<FolderErrorCode, string> = {
  home: 'is the filesystem root, the home folder or a folder above it',
  providerHome: "is inside another AI tool's own storage or an EYAS-owned CLI home",
  vault: 'is inside a notes vault or another memory store',
  eyasData: "is inside EYAS's own data folder",
  sensitive: 'touches a sensitive location',
  containsEyasData: "is or contains EYAS's own home, data folder or conversation workspaces",
  containsProviderHome: "contains another AI tool's own storage or an EYAS-owned CLI home",
  containsVault: 'contains a notes vault or another memory store',
  notAbsolute: 'is not an absolute path',
  notFound: 'does not exist or cannot be read',
  notDirectory: 'is not a directory',
}

function refuse(code: FolderErrorCode, path: string, found?: string): ValidateWorkingDirectoriesResult {
  const where = found ? ` (${found})` : ''
  return { ok: false, code, error: `folder refused: ${path} ${FOLDER_ERROR_TEXT[code]}${where}`, path, ...(found ? { found } : {}) }
}

/**
 * Validate folders before they are stored or used. Order: notAbsolute →
 * home → the path policy (providerHome / vault / eyasData) → sensitive →
 * notFound / notDirectory → what the folder CONTAINS (containsEyasData /
 * containsProviderHome / containsVault), so a protected location is refused
 * as such even when it does not exist. A folder is judged by everything a
 * model could reach below it: a CLI reads inside its cwd without asking and
 * searches it recursively, so a checkout holding EYAS's data dir or a
 * ~/Documents holding a vault is refused — it cannot be made safe by
 * skipping the protected subtree. The places the policy knows by name are
 * always found; nested vaults and memory folders known only by their shape
 * are found by the policy's bounded scan (PathPolicy.protectedWithin).
 * Accepted folders come back realpathed and de-duplicated.
 */
export function validateWorkingDirectories(
  input: readonly WorkingDirectoryInput[],
  opts: ValidateWorkingDirectoriesOpts = {},
): ValidateWorkingDirectoriesResult {
  const policy = opts.policy ?? getPathPolicy()
  const homeDir = opts.homeDir ?? currentHomeDir()
  const eyasHome = opts.eyasHome ?? resolveHome()
  const entries: NamedWorkingDirectory[] = []
  const seen = new Set<string>()
  for (const item of parseNamedWorkingDirectories(input)) {
    const path = item.path
    if (path.includes('\0') || !isAbsolute(path)) return refuse('notAbsolute', path)
    const normalized = resolve(path)
    if (isHomeOrAbove(normalized, homeDir)) return refuse('home', path)
    const code = codeForVerdict(policy.classify(normalized))
    if (code) return refuse(code, path)
    // The workspaces root itself (or its `_runs` folder) would make every
    // conversation's workspace this folder's own; a single workspace is fine.
    const scoped = policy.classify(normalized, { workingDirectories: [] })
    if (scoped.rule === 'other-workspace' && scoped.label === WORKSPACES_ROOT_LABEL) return refuse('eyasData', path)
    let real: string
    try {
      real = realpathBestEffort(normalized)
    } catch {
      return refuse('notFound', path)
    }
    if ([normalized, real].some((p) => SENSITIVE_BASENAME_RE.test(p.split(/[\\/]/).pop() ?? '') || SENSITIVE_PATH_RE.test(p))) {
      return refuse('sensitive', path)
    }
    let st
    try {
      st = statSync(real)
    } catch {
      return refuse('notFound', path)
    }
    if (!st.isDirectory()) return refuse('notDirectory', path)
    // What the folder contains. The EYAS home first (it holds the data dir
    // unless EYAS_DATA_DIR moved it, and the local config either way), then
    // everything the policy protects below the folder — judged with the
    // folder as the working directory, so its own workspace is its own.
    if (isAbsolute(eyasHome) && isAtOrAbove(real, eyasHome)) return refuse('containsEyasData', path, resolve(eyasHome))
    const below = policy.protectedWithin(normalized, { workingDirectories: [normalized] })
    if (below) {
      const code = CONTAINS_CODE[codeForVerdict(below) ?? 'eyasData'] ?? 'containsEyasData'
      return refuse(code, path, below.path)
    }
    if (seen.has(real)) continue
    seen.add(real)
    entries.push({ name: item.name || workspaceBasename(real), path: real })
  }
  return { ok: true, paths: entries.map((e) => e.path), entries }
}

/** A folder save's outcome for a route: the value to store, or the 400 body ({error, code, path}). */
export type WorkingDirectoriesBodyCheck =
  | { ok: true; stored: Array<string | { name: string; path: string }> | null }
  | { ok: false; body: { error: string; code?: FolderErrorCode; path?: string; found?: string } }

/**
 * Zod-parse and validate a save body's `workingDirectories` (undefined,
 * null and [] clear the list). Routes answer a failure with
 * `c.json(check.body, 400)`.
 */
export function checkWorkingDirectoriesBody(
  raw: unknown,
  opts: ValidateWorkingDirectoriesOpts = {},
): WorkingDirectoriesBodyCheck {
  const parsed = WorkingDirectoriesBodySchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, body: { error: 'workingDirectories must be a list of absolute folder paths' } }
  }
  const result = validateWorkingDirectories(parsed.data ?? [], opts)
  if (!result.ok) {
    return { ok: false, body: { error: result.error, code: result.code, path: result.path, ...(result.found ? { found: result.found } : {}) } }
  }
  return { ok: true, stored: result.entries.length ? serializeWorkingDirectories(result.entries) : null }
}

// ── Stored folders at run time ─────────────────────────────────────────
//
// A folder is validated when it is saved, but a stored one can be refused
// later: saved before a rule existed, inherited unchecked from a project, or
// a vault has since been created inside it. Every run screens its folders
// again (the agent runner for EYAS tools and CLI metadata, cli-runtime
// resolveCliCwd/resolveCliRoots for a CLI cwd) and leaves out the ones a
// protection rule now refuses, with a visible notice.

/**
 * The refusals that mean "a model may not work here". A folder that is only
 * missing, not a folder or not absolute is not screened out here: the file
 * tools report it, and a CLI cwd skips it.
 */
const PROTECTED_FOLDER_CODES: ReadonlySet<FolderErrorCode> = new Set<FolderErrorCode>([
  'home', 'providerHome', 'vault', 'eyasData', 'sensitive',
  'containsEyasData', 'containsProviderHome', 'containsVault',
])

/** True for a refusal that protects something (not a missing folder). */
function isProtectedFolderCode(code: string): code is FolderErrorCode {
  return PROTECTED_FOLDER_CODES.has(code as FolderErrorCode)
}

/** A stored folder a protection rule now refuses. */
export interface RefusedStoredFolder {
  /** The folder as stored. */
  path: string
  code: FolderErrorCode
  /** For a contains* refusal: the protected place inside it. */
  found?: string
}

export interface ScreenedWorkingDirectories {
  /** The stored folders still allowed, as stored, in order. */
  entries: NamedWorkingDirectory[]
  refused: RefusedStoredFolder[]
}

/**
 * Screen a stored folder list (a conversation's, a project's) before a run
 * uses it: each folder is judged on its own by validateWorkingDirectories,
 * and one a protection rule refuses is left out. The others are kept as
 * stored — a missing folder included (see PROTECTED_FOLDER_CODES).
 */
export function screenStoredWorkingDirectories(
  raw: unknown,
  opts: ValidateWorkingDirectoriesOpts = {},
): ScreenedWorkingDirectories {
  const entries: NamedWorkingDirectory[] = []
  const refused: RefusedStoredFolder[] = []
  for (const entry of parseNamedWorkingDirectories(raw)) {
    const verdict = validateWorkingDirectories([entry.path], opts)
    if (!verdict.ok && isProtectedFolderCode(verdict.code)) {
      refused.push({ path: entry.path, code: verdict.code, ...(verdict.found ? { found: verdict.found } : {}) })
      continue
    }
    entries.push(entry)
  }
  return { entries, refused }
}

export interface ScreenedToolWorkspace {
  /** The run's folder fields without the refused folders (the toolWorkspaceFields shape). */
  fields: { workingDirectory?: string; workingDirectories?: string[] }
  refused: RefusedStoredFolder[]
}

/**
 * Screen a run's folder fields (ToolContext.workingDirectory /
 * workingDirectories, as toolWorkspaceFields built them). The primary folder
 * stays the primary when it is allowed, else the first allowed one; a
 * context with only a primary keeps that shape.
 */
export function screenToolWorkspaceFields(
  ctx: { workingDirectory?: string; workingDirectories?: readonly string[] } | undefined,
  opts: ValidateWorkingDirectoriesOpts = {},
): ScreenedToolWorkspace {
  const list = parseWorkingDirectories(ctx?.workingDirectories)
  const primary = typeof ctx?.workingDirectory === 'string' && ctx.workingDirectory ? ctx.workingDirectory : undefined
  // A primary outside the list is screened too (it is the relative-path base).
  const all = primary && !list.includes(primary) ? [...list, primary] : list
  const screened = screenStoredWorkingDirectories(all, opts)
  const allowed = screened.entries.map((e) => e.path)
  const kept = list.filter((p) => allowed.includes(p))
  const keptPrimary = primary && allowed.includes(primary) ? primary : kept[0]
  const fields: ScreenedToolWorkspace['fields'] = {}
  if (keptPrimary) fields.workingDirectory = keptPrimary
  if (kept.length > 0) fields.workingDirectories = kept
  return { fields, refused: screened.refused }
}

/** Longest folder path a notice carries (NoticeParamsSchema caps a value at 500). */
const NOTICE_PATH_MAX = 480

/**
 * The chat notice for a stored folder left out of a run
 * (conversations.notice.folderRefused): the folder and the refusal code.
 */
export function folderRefusedNotice(refused: RefusedStoredFolder): { type: 'notice'; code: 'folderRefused'; params: { path: string; reason: FolderErrorCode } } {
  const path = refused.path.length > NOTICE_PATH_MAX ? `…${refused.path.slice(-(NOTICE_PATH_MAX - 1))}` : refused.path
  return { type: 'notice', code: 'folderRefused', params: { path, reason: refused.code } }
}

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

export function isPathInsideRoots(absPath: string, roots: string[]): boolean {
  if (!absPath || roots.length === 0) return false
  let resolved = resolve(absPath)
  try {
    if (existsSync(resolved)) resolved = realpathSync(resolved)
  } catch {
    return false
  }
  return roots.some((root) => {
    let rootReal = resolve(root)
    try {
      if (existsSync(rootReal)) rootReal = realpathSync(rootReal)
    } catch {
      /* keep resolved */
    }
    const rel = relative(rootReal, resolved)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

export type WorkspaceResolve =
  | { ok: true; primary: string; roots: string[] }
  | { ok: false; error: string }

/** Resolve the coding workspace from a tool context. No process.cwd() fallback. */
export function workspaceFromContext(ctx?: ToolContext): WorkspaceResolve {
  const fromList = parseWorkingDirectories(ctx?.workingDirectories)
  const roots = fromList.length > 0
    ? fromList
    : ctx?.workingDirectory
      ? [ctx.workingDirectory]
      : []
  if (roots.length === 0) return { ok: false, error: NO_WORKING_DIR }
  return { ok: true, primary: roots[0], roots }
}

export function toolWorkspaceFields(paths: unknown): {
  workingDirectory?: string
  workingDirectories?: string[]
} {
  const dirs = parseWorkingDirectories(paths)
  if (dirs.length === 0) return {}
  return { workingDirectory: dirs[0], workingDirectories: dirs }
}

export function displayRelative(absPath: string, roots: string[]): string {
  for (const root of roots) {
    const rel = relative(root, absPath)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return rel.split(sep).join('/') || '.'
    }
  }
  return absPath
}
