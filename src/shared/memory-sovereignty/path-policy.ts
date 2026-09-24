// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Memory-sovereignty path policy: the one answer to "may a model tool touch
// this path?". Pure and module-free — the security gate installs the
// configured instance, and every channel (EYAS tools, the Claude Code hook,
// ACP fs servicing, the MCP client, folder validation, the kernel sandbox
// profiles) asks the same object through getPathPolicy().
//
// Three things are out of bounds for a model:
//   foreign-memory  another tool's memory or state (FOREIGN_MEMORY_STORES, the
//                   same dot-folders under any user's home, Obsidian vaults
//                   found by registry or `.obsidian` marker, ai-memory and
//                   `.<tool>/…/memory` folders, security.foreignMemoryPaths)
//   eyas-data       EYAS's own data folder (vault, database, keys, …) except
//                   the absolute work-area roots, the database wherever it
//                   lives, and another conversation's workspace
//   provider-home   the EYAS-owned homes of the CLI providers (credentials)
// What the caller does with a verdict (deny, never escalate) is its business;
// this file only classifies.
//
// Every path is judged twice — as written and after realpath (the nearest
// existing ancestor for a path that does not exist yet) — and the stricter
// verdict wins, so neither a symlink into a vault nor a new file under a
// symlinked folder gets through.
//
// A search is judged by what it can reach, not only by its folder: a CLI's
// own Grep/Glob/list or a recursive shell command whose folder CONTAINS a
// protected place (and whose globs may reach it) is refused, since the CLI
// cannot be told to leave that place out (search-scope.ts). The places known
// by name are always checked; nested vaults and memory folders known only by
// their shape are found by a bounded scan of the folder.

import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { resolveInstance, type InstancePaths } from '@core/instance.js'
import { realpathBestEffort } from '../fs-realpath.js'
import {
  AI_MEMORY_SEGMENT,
  FOREIGN_MEMORY_STORES,
  FOREIGN_STORES_VERSION,
  MEMORY_DIR_NAMES,
  OBSIDIAN_MARKER,
  SEGMENT_RULES,
  TOOL_DOT_DIRS,
  type ForeignMemoryStore,
  type ForeignStoreCategory,
  type SegmentRule,
} from './foreign-stores.js'
import { expandHome, extractShellPathCandidates, literalGlobPrefix, pathCandidatesFromArgv } from './shell-paths.js'
import {
  compileSearchGlobs,
  embeddedShellScripts,
  literalGlobSegments,
  nativeSearchKind,
  searchScopesOf,
  splitIncludeGlobs,
  type SearchScope,
} from './search-scope.js'

export type PathKind = 'foreign-memory' | 'eyas-data' | 'provider-home' | 'ok'

export type PathRule =
  /** A FOREIGN_MEMORY_STORES entry in this user's home (or its XDG location). */
  | 'foreign-store'
  /** The same home dot-folder under another user's home. */
  | 'foreign-store-other-home'
  /** An ai-memory, `.obsidian` or `.<tool>/…/memory` segment. */
  | 'memory-segment'
  /** Inside an Obsidian vault (registry or `.obsidian` marker). */
  | 'obsidian-vault'
  /** Inside a security.foreignMemoryPaths entry. */
  | 'owner-path'
  | 'provider-home'
  | 'eyas-data'
  | 'eyas-database'
  | 'other-workspace'

export interface PathClassification {
  kind: PathKind
  /** Short English name of what was hit ('' when ok). Never a secret. */
  label: string
  rule?: PathRule
  /** FOREIGN_MEMORY_STORES id or SEGMENT_RULES id behind a foreign verdict. */
  ruleId?: string
  category?: ForeignStoreCategory
}

export interface PathViolation extends PathClassification {
  kind: Exclude<PathKind, 'ok'>
  /** Input field the path came from (`file_path`, `command`, `pattern`, …). */
  field: string
  /** The resolved path that was judged (for a search: the protected place it would reach). */
  path: string
  /**
   * Set when a search was refused for what lies BELOW its folder: the folder
   * searched. The folder itself is not protected — it contains `path`.
   */
  searchRoot?: string
}

export interface ClassifyContext {
  /**
   * The caller's working directories. When known, a workspace under the
   * workspaces root that none of them is in belongs to another conversation.
   * Undefined = unknown (no cross-workspace verdict).
   */
  workingDirectories?: readonly string[]
}

export interface EvaluateContext extends ClassifyContext {
  /** Base for relative paths when the input names none (default: first working directory). */
  cwd?: string
  /**
   * The HOME the tool runs under, when it is not the operator's: a CLI EYAS
   * runs in its own home (<dataDir>/cli-homes/<provider>) resolves `~`,
   * `$HOME` and `${HOME}` there. The input is then judged under both
   * expansions and the stricter verdict wins, so `~/../../vault` cannot reach
   * EYAS's data through the child's home while the operator-home reading of
   * the same text stays guarded too.
   */
  homeDir?: string
}

export interface KernelDenyListOptions {
  /** Paths (with everything under them) that must stay usable, e.g. the CLI's own EYAS-owned home. */
  exclude?: readonly string[]
  /**
   * The session's working directories: kept usable, and the reference for
   * listing SIBLING workspaces. Without them no workspace is listed.
   */
  workingDirectories?: readonly string[]
}

export interface PathPolicyOptions {
  /** The operator's home (os.homedir()). */
  homeDir: string
  env?: Readonly<Record<string, string | undefined>>
  /** Absolute EYAS data dir. */
  dataDir: string
  /** The database file; protected wherever it lives. */
  databasePath?: string
  /** security.foreignMemoryPaths — absolute (a leading ~ is expanded). */
  extraForeignPaths?: readonly string[]
  /** Absolute folders EYAS hands to models (workspaces root, studio, browser downloads). */
  workAreaRoots: readonly string[]
  /** Absolute root of the per-conversation workspaces (InstancePaths.workspacesDir). */
  workspacesRoot: string
  /** EYAS-owned CLI homes (InstancePaths.cliHomesDir or single provider homes). */
  providerHomes?: readonly string[]
  platform?: NodeJS.Platform
  /** Obsidian vault registries to read (default: derived from the store table). */
  obsidianRegistryPaths?: readonly string[]
}

export interface PathPolicyDescription {
  version: string
  dataDir: string
  databasePath: string | null
  workspacesRoot: string
  workAreaRoots: string[]
  providerHomes: string[]
  foreignStores: Array<{ id: string; label: string; category: ForeignStoreCategory; paths: string[]; present: boolean; unverified: boolean }>
  foreignMemoryPaths: Array<{ path: string; present: boolean }>
  /** security.foreignMemoryPaths entries that are not absolute paths (ignored). */
  ignoredForeignMemoryPaths: string[]
  detectedVaults: Array<{ path: string; source: 'registry' | 'marker' }>
  segmentRules: SegmentRule[]
}

export interface PathPolicy {
  /** Verdict for one absolute path. A relative path gets the segment rules only. */
  classify(absPath: string, ctx?: ClassifyContext): PathClassification
  /** First protected path a tool call's input names, or null. Every tool, every path-bearing field. */
  evaluateToolInput(toolName: string, input: unknown, ctx?: EvaluateContext): PathViolation | null
  /** Concrete, glob-free paths a kernel sandbox should deny (existing ones only). */
  kernelDenyList(opts?: KernelDenyListOptions): string[]
  /** True when a folder walk (grep/glob) must not descend into `absPath`. */
  isProtectedDir(absPath: string, ctx?: ClassifyContext): boolean
  /**
   * The first protected place strictly BELOW a folder — one the policy knows
   * by name (the data dir, the database, a CLI home, another tool's store, a
   * security.foreignMemoryPaths entry, a detected vault, another
   * conversation's workspace) or one the bounded scan finds by its shape (a
   * `.obsidian` marker, a memory folder, a symlink into a protected place).
   * The same reach a search of the whole folder is judged by, so a folder
   * that passes can be searched. Null when nothing protected lies below it —
   * or when the folder itself is protected (classify answers that).
   */
  protectedWithin(absDir: string, ctx?: ClassifyContext): PathViolation | null
  /** What the policy protects, for the UI. */
  describe(): PathPolicyDescription
}

/**
 * Sub-folder of the workspaces root that holds per-run scratch folders; each
 * `_runs/<runId>` is its own workspace. Mirrors RUN_SCRATCH_DIR in
 * modules/model/cli-runtime/workspaces.ts (kept in step by a test).
 */
export const RUN_SCRATCH_SEGMENT = '_runs'

/**
 * Label of the 'other-workspace' verdict for the workspaces root itself (and
 * its `_runs` folder) rather than one workspace in it — folder validation
 * refuses that folder, since as a working directory it would own them all.
 */
export const WORKSPACES_ROOT_LABEL = 'workspaces root'

/** Keys whose string values are paths, in every tool's input (Claude Code, ACP rawInput, EYAS tools). */
const PATH_FIELDS: ReadonlySet<string> = new Set([
  'file_path', 'filePath', 'notebook_path', 'notebookPath', 'path', 'paths',
  'target_file', 'target_directory', 'directory', 'cwd', 'workingDir',
])
/** Keys whose values are URLs; only file: ones name a path. */
const URL_FIELDS: ReadonlySet<string> = new Set(['url', 'uri'])
/** Tools whose `pattern` is a path glob. Grep's `pattern` is a regex and never a path. */
const GLOB_TOOLS: ReadonlySet<string> = new Set(['Glob', 'glob'])
const EYAS_MCP_PREFIX = 'mcp__eyas__'
const GLOB_CHARS_RE = /[*?[]/
const MAX_INPUT_DEPTH = 4
const MAX_KERNEL_DEPTH = 6

const VAULT_CACHE_MAX = 4096
const VAULT_CACHE_TTL_MS = 30_000
const REGISTRY_RECHECK_MS = 1_000

/** Folders a search scan visits at most (breadth first) before it stops looking. */
const SEARCH_SCAN_MAX_DIRS = 2000
/** How deep below the searched folder the scan looks. */
const SEARCH_SCAN_MAX_DEPTH = 8
/** Never descended by the scan: version-control internals and package trees. */
const SEARCH_SCAN_SKIP: ReadonlySet<string> = new Set(['.git', '.hg', '.svn', '.jj', '.sl', '.bzr', 'node_modules'])
/** Protected folders one scan records at most (it stops there). */
const SEARCH_SCAN_MAX_HITS = 256
const SEARCH_SCAN_CACHE_MAX = 256
const SEARCH_SCAN_TTL_MS = 10_000

const ObsidianRegistrySchema = z.object({
  vaults: z.record(z.string(), z.object({ path: z.string().min(1) }).passthrough()).default({}),
}).passthrough()

const OK: PathClassification = Object.freeze({ kind: 'ok', label: '' }) as PathClassification

const TOOL_DOTS = new Set(TOOL_DOT_DIRS.map((d) => d.toLowerCase()))
const MEMORY_NAMES = new Set(MEMORY_DIR_NAMES.map((d) => d.toLowerCase()))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

interface StoreEntry {
  store: ForeignMemoryStore
  /** Raw absolute paths this entry covers (XDG location and fallback). */
  paths: string[]
  forms: string[]
}

interface RegistryState {
  file: string
  mtimeMs: number
  size: number
  vaults: string[]
  forms: string[]
}

/**
 * Build a policy. Everything the verdicts depend on is resolved here once;
 * only Obsidian registries (on change) and `.obsidian` markers (bounded,
 * time-limited cache) are read later.
 */
export function createPathPolicy(options: PathPolicyOptions): PathPolicy {
  const platform = options.platform ?? process.platform
  const caseInsensitive = platform === 'darwin' || platform === 'win32'
  const env = options.env ?? {}
  const homeDir = resolve(options.homeDir)

  /** Comparable form: forward slashes, no trailing slash, case-folded where the filesystem folds case. */
  const canon = (p: string): string => {
    let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
    if (/^[A-Za-z]:$/.test(s)) s += '/'
    return caseInsensitive ? s.toLowerCase() : s
  }
  const realOf = (p: string): string => {
    try {
      return realpathBestEffort(p)
    } catch {
      return p
    }
  }
  /**
   * Canonical lexical and real forms of an absolute path. The real form is
   * taken from the path as written, so a '..' after a symlink is resolved
   * where the filesystem resolves it, not by text.
   */
  const formsOf = (p: string): string[] => {
    const lexical = resolve(p)
    const lex = canon(lexical)
    const real = canon(realOf(isAbsolute(p) ? p : lexical))
    return lex === real ? [lex] : [lex, real]
  }
  const inside = (path: string, root: string): boolean =>
    path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
  const insideAny = (path: string, roots: readonly string[]): boolean => roots.some((r) => inside(path, r))
  /** `root` strictly inside `dir`. */
  const containsAny = (dir: string, roots: readonly string[]): boolean => roots.some((r) => r !== dir && inside(r, dir))

  const expandVar = (spec: string): string | null => {
    const m = /^\$([A-Z_]+)\/(.*)$/.exec(spec)
    if (!m) return spec.startsWith('~') ? expandHome(spec, homeDir) : spec
    const value = env[m[1]]?.trim()
    return value && isAbsolute(value) ? join(value, m[2]) : null
  }

  const dataDir = resolve(options.dataDir)
  const dataForms = formsOf(dataDir)
  // A work area that is the data dir or encloses it would make the whole
  // data dir model-visible; such a root is ignored.
  const workAreaRoots = [...new Set(options.workAreaRoots.map((r) => resolve(r)))]
    .filter((r) => !formsOf(r).some((f) => dataForms.some((d) => inside(d, f))))
  const workForms = workAreaRoots.flatMap(formsOf)
  const workspacesRoot = resolve(options.workspacesRoot)
  const workspacesForms = formsOf(workspacesRoot)
  const providerHomes = [...new Set((options.providerHomes ?? []).map((p) => resolve(p)))]
  const providerForms = providerHomes.map((p) => ({ path: p, forms: formsOf(p) }))
  const databasePath = options.databasePath ? resolve(options.databasePath) : null
  const databaseForms = databasePath ? formsOf(databasePath) : []

  const stores: StoreEntry[] = FOREIGN_MEMORY_STORES.map((store) => {
    const paths = [expandVar(store.path), store.fallback ? expandVar(store.fallback) : null]
      .filter((p): p is string => typeof p === 'string' && isAbsolute(p))
      .map((p) => resolve(p))
    const unique = [...new Set(paths)]
    return { store, paths: unique, forms: unique.flatMap(formsOf) }
  })

  // The same home dot-folders under any user's home (another account's
  // ~/.claude is still another tool's memory).
  const otherHomeRules = FOREIGN_MEMORY_STORES
    .filter((s) => /^~\/\.[^/]+$/.test(s.path))
    .map((s) => {
      const name = s.path.slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const tail = s.kind === 'file' ? '(?:\\.[^/]*)?$' : '(?:/|$)'
      return {
        store: s,
        re: new RegExp(`^(?:/users/[^/]+|/home/[^/]+|/root|/var/root|[a-z]:/users/[^/]+)/${name}${tail}`, 'i'),
      }
    })

  const ownerPaths: Array<{ path: string; forms: string[] }> = []
  const ignoredOwnerPaths: string[] = []
  for (const raw of options.extraForeignPaths ?? []) {
    const expanded = typeof raw === 'string' ? expandHome(raw.trim(), homeDir) : ''
    if (!expanded || !isAbsolute(expanded) || expanded.includes('\0')) {
      if (typeof raw === 'string' && raw.trim()) ignoredOwnerPaths.push(raw)
      continue
    }
    const abs = resolve(expanded)
    ownerPaths.push({ path: abs, forms: formsOf(abs) })
  }
  const ownerForms = ownerPaths.flatMap((o) => o.forms)

  // ── Obsidian vaults ────────────────────────────────────────────────────
  const registryFiles = options.obsidianRegistryPaths
    ? options.obsidianRegistryPaths.map((p) => resolve(p))
    : stores.filter((s) => s.store.registry).flatMap((s) => s.paths.map((p) => join(p, s.store.registry as string)))
  const registries = new Map<string, RegistryState>()
  let registryCheckedAt = -Infinity

  const loadRegistry = (file: string): void => {
    let st: { mtimeMs: number; size: number }
    try {
      st = statSync(file)
    } catch {
      registries.delete(file)
      return
    }
    const prev = registries.get(file)
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return
    let vaults: string[] = []
    try {
      const parsed = ObsidianRegistrySchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
      if (parsed.success) {
        vaults = Object.values(parsed.data.vaults)
          .map((v) => v.path)
          .filter((p) => isAbsolute(p) && !p.includes('\0'))
          .map((p) => resolve(p))
      }
    } catch {
      vaults = []
    }
    registries.set(file, { file, mtimeMs: st.mtimeMs, size: st.size, vaults, forms: vaults.flatMap(formsOf) })
  }
  const refreshRegistries = (): void => {
    const now = Date.now()
    if (now - registryCheckedAt < REGISTRY_RECHECK_MS) return
    registryCheckedAt = now
    for (const file of registryFiles) loadRegistry(file)
  }
  const registryVaultForms = (): string[] => {
    refreshRegistries()
    return [...registries.values()].flatMap((r) => r.forms)
  }

  // Ancestor walk for a `.obsidian` marker, cached per folder (bounded LRU
  // with a short TTL so a vault created later is found within seconds).
  const vaultCache = new Map<string, { root: string | null; at: number }>()
  const cacheGet = (key: string, now: number): string | null | undefined => {
    const hit = vaultCache.get(key)
    if (!hit) return undefined
    if (now - hit.at > VAULT_CACHE_TTL_MS) {
      vaultCache.delete(key)
      return undefined
    }
    vaultCache.delete(key)
    vaultCache.set(key, hit)
    return hit.root
  }
  const cacheSet = (key: string, root: string | null, now: number): void => {
    vaultCache.delete(key)
    vaultCache.set(key, { root, at: now })
    while (vaultCache.size > VAULT_CACHE_MAX) {
      const oldest = vaultCache.keys().next().value
      if (oldest === undefined) break
      vaultCache.delete(oldest)
    }
  }
  const markerVaultOf = (rawPath: string): string | null => {
    const now = Date.now()
    const visited: string[] = []
    let found: string | null = null
    let dir = rawPath
    for (;;) {
      const key = canon(dir)
      const cached = cacheGet(key, now)
      if (cached !== undefined) {
        found = cached
        break
      }
      visited.push(key)
      if (existsSync(join(dir, OBSIDIAN_MARKER))) {
        found = dir
        break
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    for (const key of visited) cacheSet(key, found, now)
    return found
  }

  // ── Verdicts ───────────────────────────────────────────────────────────
  const segmentVerdict = (segments: readonly string[]): PathClassification | null => {
    let dotSeen = false
    for (const seg of segments) {
      const s = seg.toLowerCase()
      if (s === AI_MEMORY_SEGMENT) {
        return { kind: 'foreign-memory', label: 'ai-memory folder', rule: 'memory-segment', ruleId: 'ai-memory' }
      }
      if (s === OBSIDIAN_MARKER) {
        return { kind: 'foreign-memory', label: 'Obsidian vault settings', rule: 'memory-segment', ruleId: 'obsidian-config' }
      }
      if (dotSeen && MEMORY_NAMES.has(s)) {
        return { kind: 'foreign-memory', label: "another tool's memory folder", rule: 'memory-segment', ruleId: 'tool-memory' }
      }
      if (TOOL_DOTS.has(s)) dotSeen = true
    }
    return null
  }

  const ownUnits = (ctx?: ClassifyContext): Set<string> | null => {
    if (!ctx?.workingDirectories) return null
    const units = new Set<string>()
    for (const wd of ctx.workingDirectories) {
      if (typeof wd !== 'string' || !isAbsolute(wd)) continue
      for (const form of formsOf(wd)) {
        for (const root of workspacesForms) {
          if (!inside(form, root)) continue
          units.add(unitOf(form, root) ?? root)
        }
      }
    }
    return units
  }

  /** `<root>/<id>` or `<root>/_runs/<id>`; null for the root or `_runs` itself. */
  const unitOf = (path: string, root: string): string | null => {
    const rest = path.slice(root.length).split('/').filter(Boolean)
    if (rest.length === 0) return null
    const scratch = caseInsensitive ? RUN_SCRATCH_SEGMENT.toLowerCase() : RUN_SCRATCH_SEGMENT
    if (rest[0] === scratch) return rest.length >= 2 ? `${root}/${rest[0]}/${rest[1]}` : null
    return `${root}/${rest[0]}`
  }

  const classifyForm = (raw: string, units: Set<string> | null): PathClassification | null => {
    const c = canon(raw)

    for (const home of providerForms) {
      if (insideAny(c, home.forms)) {
        const name = home.path.split(/[\\/]/).filter(Boolean).pop() ?? 'cli'
        return { kind: 'provider-home', label: `EYAS-owned CLI home (${name})`, rule: 'provider-home' }
      }
    }
    for (const db of databaseForms) {
      if (c === db || (c.startsWith(db) && /^-(wal|shm|journal)$/.test(c.slice(db.length)))) {
        return { kind: 'eyas-data', label: 'database', rule: 'eyas-database' }
      }
    }
    const inWorkArea = insideAny(c, workForms)
    if (!inWorkArea) {
      for (const root of dataForms) {
        if (!inside(c, root)) continue
        const first = c.slice(root.length).split('/').filter(Boolean)[0]
        return { kind: 'eyas-data', label: first ?? 'data directory', rule: 'eyas-data' }
      }
    }
    if (units) {
      for (const root of workspacesForms) {
        if (!inside(c, root)) continue
        const unit = unitOf(c, root)
        if (unit === null) {
          if (units.has(root)) break
          return { kind: 'eyas-data', label: WORKSPACES_ROOT_LABEL, rule: 'other-workspace' }
        }
        if (units.has(unit) || units.has(root)) break
        return { kind: 'eyas-data', label: "another conversation's workspace", rule: 'other-workspace' }
      }
    }

    for (const entry of stores) {
      for (const form of entry.forms) {
        const hit = entry.store.kind === 'file'
          ? c === form || (c.startsWith(`${form}.`) && !c.slice(form.length).includes('/'))
          : inside(c, form)
        if (hit) {
          return {
            kind: 'foreign-memory',
            label: `${entry.store.label} (${entry.store.path})`,
            rule: 'foreign-store',
            ruleId: entry.store.id,
            category: entry.store.category,
          }
        }
      }
    }
    for (const rule of otherHomeRules) {
      if (rule.re.test(c)) {
        return {
          kind: 'foreign-memory',
          label: `${rule.store.label} (${rule.store.path.slice(2)} in a user home)`,
          rule: 'foreign-store-other-home',
          ruleId: rule.store.id,
          category: rule.store.category,
        }
      }
    }
    if (insideAny(c, ownerForms)) {
      return { kind: 'foreign-memory', label: 'protected path (security.foreignMemoryPaths)', rule: 'owner-path' }
    }
    const segments = segmentVerdict(c.split('/').filter(Boolean))
    if (segments) return segments

    // An EYAS work area is EYAS's own folder even when some vault encloses it
    // (a vault at the top of the home); only an explicit rule above denies there.
    if (!inWorkArea) {
      if (insideAny(c, registryVaultForms()) || markerVaultOf(raw) !== null) {
        return { kind: 'foreign-memory', label: 'Obsidian vault', rule: 'obsidian-vault', ruleId: 'obsidian' }
      }
    }
    return null
  }

  /** `units` = the caller's own workspaces (null = unknown). */
  const classifyWith = (absPath: string, units: Set<string> | null): PathClassification => {
    if (typeof absPath !== 'string' || absPath.length === 0 || absPath.includes('\0')) return OK
    if (!isAbsolute(absPath)) {
      return segmentVerdict(absPath.split(/[\\/]+/).filter(Boolean)) ?? OK
    }
    const lexical = resolve(absPath)
    const first = classifyForm(lexical, units)
    if (first) return first
    // From the path as written: resolve() folds 'link/..' by text, while the
    // open() that follows goes through the link first.
    const real = realOf(absPath)
    if (real !== lexical) {
      const second = classifyForm(real, units)
      if (second) return second
    }
    return OK
  }
  const classify = (absPath: string, ctx?: ClassifyContext): PathClassification => classifyWith(absPath, ownUnits(ctx))

  // ── Searches ───────────────────────────────────────────────────────────
  const isDirectory = (p: string): boolean => {
    try {
      return statSync(p).isDirectory()
    } catch {
      return false
    }
  }

  /** Segments of a place strictly below a folder (by any of their forms), else null. */
  const relBelow = (placeForms: readonly string[], folderForms: readonly string[]): string[] | null => {
    for (const folder of folderForms) {
      const cut = folder.endsWith('/') ? folder.length : folder.length + 1
      for (const form of placeForms) {
        if (form !== folder && inside(form, folder)) return form.slice(cut).split('/').filter(Boolean)
      }
    }
    return null
  }

  const storePlaces = stores.flatMap((entry) => entry.paths.map((path) => ({ path, forms: formsOf(path) })))

  /** The protected places the policy knows by name (existing or not). */
  const knownPlaces = (): Array<{ path: string; forms: readonly string[] }> => [
    { path: dataDir, forms: dataForms },
    ...(databasePath ? [{ path: databasePath, forms: databaseForms }] : []),
    ...providerForms,
    ...storePlaces,
    ...ownerPaths,
    ...detectedVaults().map((v) => ({ path: v.path, forms: formsOf(v.path) })),
  ]

  /** Every workspace under the workspaces root (the caller's own classify as ok). */
  const workspaceUnits = (): string[] => {
    const out: string[] = []
    let names: string[] = []
    try {
      names = readdirSync(workspacesRoot)
    } catch {
      return out
    }
    for (const name of names) {
      const unit = join(workspacesRoot, name)
      if (name !== RUN_SCRATCH_SEGMENT) {
        out.push(unit)
        continue
      }
      try {
        for (const run of readdirSync(unit)) out.push(join(unit, run))
      } catch {
        // no run scratch folders
      }
    }
    return out
  }

  /** Protected folders a scan found below a folder, in the order found (breadth first). */
  interface ScanHit {
    rel: string[]
    path: string
    verdict: PathClassification
  }
  const scanCache = new Map<string, { at: number; hits: ScanHit[] }>()

  /**
   * Breadth-first walk of a searched folder for protected folders the policy
   * knows only by shape (a `.obsidian` marker, an ai-memory or tool memory
   * folder, a symlink into a protected place). Bounded in folders and depth
   * whatever a search's globs are; a place beyond the bound is judged by the
   * known places only. A protected folder is recorded and never descended.
   * One walk per folder (and caller) for SEARCH_SCAN_TTL_MS: every search of
   * that folder, whatever its globs, keeps the hits its globs may reach.
   */
  const scanBelow = (root: string, units: Set<string> | null): ScanHit[] => {
    const key = [canon(root), ...(units ? [...units].sort() : ['?'])].join('\u0000')
    const now = Date.now()
    const cached = scanCache.get(key)
    if (cached && now - cached.at <= SEARCH_SCAN_TTL_MS) return cached.hits

    const hits: ScanHit[] = []
    const rootReal = realOf(root)
    // `real`: the folder's real location, so a child that is not a link needs no realpath of its own.
    const queue: Array<{ dir: string; real: string; rel: string[] }> = [{ dir: root, real: rootReal, rel: [] }]
    let visited = 0
    scan: while (queue.length > 0 && visited < SEARCH_SCAN_MAX_DIRS) {
      const { dir, real, rel } = queue.shift() as { dir: string; real: string; rel: string[] }
      visited++
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (SEARCH_SCAN_SKIP.has(entry.name)) continue
        const isDir = entry.isDirectory()
        const isLink = !isDir && entry.isSymbolicLink()
        if (!isDir && !isLink) continue
        const childRel = [...rel, entry.name]
        const full = join(dir, entry.name)
        const childReal = isLink ? null : join(real, entry.name)
        const verdict = isLink
          ? classifyWith(full, units)
          : classifyForm(full, units) ?? (childReal !== full ? classifyForm(childReal as string, units) : null) ?? OK
        if (verdict.kind !== 'ok') {
          hits.push({ rel: childRel, path: full, verdict })
          if (hits.length >= SEARCH_SCAN_MAX_HITS) break scan
          continue
        }
        if (isDir && childRel.length < SEARCH_SCAN_MAX_DEPTH) queue.push({ dir: full, real: childReal as string, rel: childRel })
      }
    }

    scanCache.delete(key)
    scanCache.set(key, { at: now, hits })
    while (scanCache.size > SEARCH_SCAN_CACHE_MAX) {
      const oldest = scanCache.keys().next().value
      if (oldest === undefined) break
      scanCache.delete(oldest)
    }
    return hits
  }

  /**
   * What one search can reach: its folder itself, then every protected place
   * below it that the search's globs may reach. The first hit is the verdict.
   */
  const reachOf = (scope: SearchScope, units: Set<string> | null): PathViolation | null => {
    const root = resolve(scope.root)
    const own = classifyWith(root, units)
    if (own.kind !== 'ok') return { ...own, kind: own.kind, field: scope.field, path: root }
    // Only a folder is searched; a file is judged as the path it is.
    if (!isDirectory(root)) return null
    const rootForms = formsOf(root)
    const matcher = compileSearchGlobs(scope.globs, scope.anywhere, caseInsensitive)
    const places = knownPlaces()
    if (units && workspacesForms.some((w) => rootForms.some((r) => inside(w, r)))) {
      places.push(...workspaceUnits().map((path) => ({ path, forms: formsOf(path) })))
    }
    for (const place of places) {
      const rel = relBelow(place.forms, rootForms)
      if (!rel || !matcher.mayReach(rel) || !existsSync(place.path)) continue
      const verdict = classifyWith(place.path, units)
      if (verdict.kind === 'ok') continue
      return { ...verdict, kind: verdict.kind, field: scope.field, path: place.path, searchRoot: root }
    }
    const hit = scanBelow(root, units).find((h) => matcher.mayReach(h.rel))
    return hit ? { ...hit.verdict, kind: hit.verdict.kind as PathViolation['kind'], field: scope.field, path: hit.path, searchRoot: root } : null
  }

  // ── Tool inputs ────────────────────────────────────────────────────────
  const toPathUnder = (value: string, home: string): string | null => {
    const v = value.trim()
    if (!v || v.includes('\0')) return null
    if (/^file:\/\//i.test(v)) {
      try {
        return fileURLToPath(v)
      } catch {
        return null
      }
    }
    return expandHome(v, home)
  }

  /**
   * The first protected path the input names. `~`/`$HOME` are expanded
   * against the operator's home and, when the call runs under another HOME
   * (ctx.homeDir), against that one as well: either reading hitting a
   * protected path is a violation.
   */
  const evaluateToolInput = (toolName: string, input: unknown, ctx: EvaluateContext = {}): PathViolation | null => {
    const first = evaluateUnder(toolName, input, ctx, homeDir)
    if (first) return first
    const child = typeof ctx.homeDir === 'string' && isAbsolute(ctx.homeDir) && !ctx.homeDir.includes('\0')
      ? resolve(ctx.homeDir)
      : null
    if (!child || canon(child) === canon(homeDir)) return null
    return evaluateUnder(toolName, input, ctx, child)
  }

  const evaluateUnder = (toolName: string, input: unknown, ctx: EvaluateContext, home: string): PathViolation | null => {
    if (!isRecord(input)) return null
    const toPath = (value: string): string | null => toPathUnder(value, home)
    const name = typeof toolName === 'string' && toolName.startsWith(EYAS_MCP_PREFIX)
      ? toolName.slice(EYAS_MCP_PREFIX.length)
      : toolName
    const variant = typeof input.variant === 'string' ? input.variant : ''
    const isGlob = GLOB_TOOLS.has(name) || GLOB_TOOLS.has(variant)

    const inputBase = [input.cwd, input.workingDir]
      .map((v) => (typeof v === 'string' ? toPath(v) : null))
      .find((v): v is string => typeof v === 'string' && isAbsolute(v))
    const firstWd = ctx.workingDirectories?.find((d) => typeof d === 'string' && isAbsolute(d))
    const base = inputBase ?? firstWd ?? (ctx.cwd && isAbsolute(ctx.cwd) ? ctx.cwd : undefined)
    const units = ownUnits(ctx)

    const judge = (field: string, path: string): PathViolation | null => {
      const abs = isAbsolute(path) ? path : base ? resolve(base, path) : null
      const verdict = classifyWith(abs ?? path, units)
      if (verdict.kind === 'ok') return null
      return { ...verdict, kind: verdict.kind, field, path: abs ?? path }
    }

    const visit = (value: unknown, key: string, depth: number): PathViolation | null => {
      if (depth > MAX_INPUT_DEPTH) return null
      if (Array.isArray(value)) {
        if (key === 'args') {
          for (const p of pathCandidatesFromArgv(value, { homeDir: home, cwd: base })) {
            const v = judge(key, p)
            if (v) return v
          }
          return null
        }
        for (const item of value) {
          const v = visit(item, key, depth + 1)
          if (v) return v
        }
        return null
      }
      if (isRecord(value)) {
        for (const [k, v] of Object.entries(value)) {
          const hit = visit(v, k, depth + 1)
          if (hit) return hit
        }
        return null
      }
      if (typeof value !== 'string' || value.length === 0) return null
      if (PATH_FIELDS.has(key)) {
        const p = toPath(value)
        return p ? judge(key, p) : null
      }
      if (URL_FIELDS.has(key)) {
        if (!/^file:\/\//i.test(value.trim())) return null
        const p = toPath(value)
        return p ? judge(key, p) : null
      }
      if (key === 'command') {
        // The line, then the scripts it runs as one quoted word (`sh -c '…'`,
        // `eval "…"`, a here-document a shell reads): their paths count too.
        for (const script of [value, ...embeddedShellScripts(value)]) {
          for (const p of extractShellPathCandidates(script, { homeDir: home, cwd: base })) {
            const v = judge(key, p)
            if (v) return v
          }
        }
      }
      return null
    }

    for (const [key, value] of Object.entries(input)) {
      if (key === 'pattern') {
        if (!isGlob || typeof value !== 'string' || !value) continue
        const pattern = expandHome(value.trim(), home)
        const literal = pattern.split(/[\\/]+/).filter((s) => s && !GLOB_CHARS_RE.test(s))
        const bySegment = segmentVerdict(literal)
        if (bySegment) {
          return { ...bySegment, kind: bySegment.kind as PathViolation['kind'], field: key, path: pattern }
        }
        const searchRoot = typeof input.path === 'string' ? toPath(input.path) : null
        const globBase = searchRoot ? (isAbsolute(searchRoot) ? searchRoot : base ? resolve(base, searchRoot) : undefined) : base
        const prefix = literalGlobPrefix(pattern)
        const target = isAbsolute(prefix) ? prefix : globBase ? resolve(globBase, prefix || '.') : null
        if (target) {
          const hit = judge(key, target)
          if (hit) return hit
        }
        continue
      }
      const hit = visit(value, key, 1)
      if (hit) return hit
    }

    // A search: its include globs by their literal segments (like a Glob
    // pattern above), then everything it can reach below its folder.
    if (nativeSearchKind(name, input) === 'grep') {
      for (const key of ['glob', 'include']) {
        const value = input[key]
        if (typeof value !== 'string' || !value.trim()) continue
        for (const glob of splitIncludeGlobs(expandHome(value.trim(), home))) {
          const bySegment = segmentVerdict(literalGlobSegments(glob))
          if (bySegment) return { ...bySegment, kind: bySegment.kind as PathViolation['kind'], field: key, path: glob }
        }
      }
    }
    for (const scope of searchScopesOf(name, input, { base, homeDir: home })) {
      const hit = reachOf(scope, units)
      if (hit) return hit
    }
    return null
  }

  // ── Kernel deny list ───────────────────────────────────────────────────
  const detectedVaults = (): Array<{ path: string; source: 'registry' | 'marker' }> => {
    refreshRegistries()
    const out = new Map<string, 'registry' | 'marker'>()
    for (const r of registries.values()) for (const v of r.vaults) out.set(v, 'registry')
    for (const hit of vaultCache.values()) {
      if (hit.root && !out.has(hit.root)) out.set(hit.root, 'marker')
    }
    return [...out].map(([path, source]) => ({ path, source }))
  }

  const kernelDenyList = (opts: KernelDenyListOptions = {}): string[] => {
    const keepRaw = [...(opts.exclude ?? []), ...(opts.workingDirectories ?? [])]
      .filter((p): p is string => typeof p === 'string' && isAbsolute(p))
    const keeps = keepRaw.flatMap(formsOf)
    const homeForms = formsOf(homeDir)
    const denied = new Map<string, string>()

    const add = (raw: string, keepList: readonly string[]): void => {
      let p = resolve(raw)
      while (GLOB_CHARS_RE.test(p)) {
        const parent = dirname(p)
        if (parent === p) return
        p = parent
      }
      const forms = formsOf(p)
      if (forms.some((f) => insideAny(f, keepList) || containsAny(f, keepList))) return
      // Never the filesystem root, the home or a folder above it: a CLI cannot run without them.
      if (forms.some((f) => f === '/' || /^[a-z]:\/$/i.test(f) || homeForms.some((h) => inside(h, f)))) return
      denied.set(canon(p), p)
      const real = realOf(p)
      if (canon(real) !== canon(p)) denied.set(canon(real), real)
    }
    const expand = (raw: string, keepList: readonly string[], depth: number): void => {
      const forms = formsOf(raw)
      if (forms.some((f) => insideAny(f, keepList))) return
      if (!forms.some((f) => containsAny(f, keepList))) {
        add(raw, keepList)
        return
      }
      if (depth >= MAX_KERNEL_DEPTH) return
      let names: string[] = []
      try {
        names = readdirSync(raw)
      } catch {
        return
      }
      for (const name of names) expand(join(raw, name), keepList, depth + 1)
    }
    const existing = (p: string): boolean => {
      try {
        statSync(p)
        return true
      } catch (err) {
        return errorCode(err) !== 'ENOENT' && errorCode(err) !== 'ENOTDIR'
      }
    }

    const dataKeeps = [...workForms, ...keeps]
    if (existing(dataDir)) expand(dataDir, dataKeeps, 0)
    if (databasePath) {
      for (const file of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`]) {
        if (existing(file)) expand(file, keeps, 0)
      }
    }
    for (const home of providerHomes) if (existing(home)) expand(home, keeps, 0)
    if (opts.workingDirectories) {
      let names: string[] = []
      try {
        names = readdirSync(workspacesRoot)
      } catch {
        names = []
      }
      for (const name of names) {
        const unit = join(workspacesRoot, name)
        if (name !== RUN_SCRATCH_SEGMENT) {
          expand(unit, keeps, 0)
          continue
        }
        let runs: string[] = []
        try {
          runs = readdirSync(unit)
        } catch {
          runs = []
        }
        for (const run of runs) expand(join(unit, run), keeps, 0)
      }
    }
    for (const entry of stores) for (const p of entry.paths) if (existing(p)) expand(p, keeps, 0)
    for (const owner of ownerPaths) if (existing(owner.path)) expand(owner.path, keeps, 0)
    for (const vault of detectedVaults()) if (existing(vault.path)) expand(vault.path, keeps, 0)

    // Drop entries already covered by a broader one.
    const keys = [...denied.keys()].sort((a, b) => a.length - b.length)
    const kept: string[] = []
    for (const key of keys) {
      if (kept.some((k) => inside(key, k))) continue
      kept.push(key)
    }
    return kept.map((k) => denied.get(k) as string).sort()
  }

  const describe = (): PathPolicyDescription => ({
    version: FOREIGN_STORES_VERSION,
    dataDir,
    databasePath,
    workspacesRoot,
    workAreaRoots: [...workAreaRoots],
    providerHomes: [...providerHomes],
    foreignStores: stores.map((s) => ({
      id: s.store.id,
      label: s.store.label,
      category: s.store.category,
      paths: [...s.paths],
      present: s.paths.some((p) => existsSync(p)),
      unverified: s.store.unverified === true,
    })),
    foreignMemoryPaths: ownerPaths.map((o) => ({ path: o.path, present: existsSync(o.path) })),
    ignoredForeignMemoryPaths: [...ignoredOwnerPaths],
    detectedVaults: detectedVaults(),
    segmentRules: SEGMENT_RULES.map((r) => ({ ...r })),
  })

  return {
    classify,
    evaluateToolInput,
    kernelDenyList,
    isProtectedDir: (absPath, ctx) => classify(absPath, ctx).kind !== 'ok',
    protectedWithin: (absDir, ctx) => {
      if (typeof absDir !== 'string' || !isAbsolute(absDir) || absDir.includes('\0')) return null
      // Everything below the folder, at any depth — a search with no globs.
      const hit = reachOf({ field: 'path', root: absDir, globs: [], anywhere: true }, ownUnits(ctx))
      return hit?.searchRoot ? hit : null
    },
    describe,
  }
}

// ── Process-global instance ──────────────────────────────────────────────

/** The operator's home: $HOME first on POSIX (what os.homedir() documents), read now rather than at process start. */
export function currentHomeDir(): string {
  if (process.platform !== 'win32') {
    const fromEnv = process.env.HOME?.trim()
    if (fromEnv && isAbsolute(fromEnv)) return fromEnv
  }
  return homedir()
}

type InstanceLike = Pick<InstancePaths, 'dataDir' | 'databasePath' | 'workspacesDir' | 'cliHomesDir'>

/**
 * Folders EYAS itself hands to models: the workspaces root (which may lie
 * outside the data dir), Studio projects and browser downloads (the
 * download tools return their saved path; browser_upload takes it back).
 * Everything else in the data dir is EYAS-private.
 */
export function workAreaRootsOf(instance: Pick<InstancePaths, 'dataDir' | 'workspacesDir'>): string[] {
  return [
    instance.workspacesDir,
    join(instance.dataDir, 'studio'),
    join(instance.dataDir, 'browser', 'downloads'),
  ]
}

/** Policy options for an instance layout — the one derivation the gate and the lazy default share. */
export function pathPolicyOptionsFromInstance(
  instance: InstanceLike,
  extra: {
    /** Configured database.path (relative = against the process cwd); default the instance's. */
    databasePath?: string
    foreignMemoryPaths?: readonly string[]
    homeDir?: string
    env?: Readonly<Record<string, string | undefined>>
  } = {},
): PathPolicyOptions {
  return {
    homeDir: extra.homeDir ?? currentHomeDir(),
    env: extra.env ?? process.env,
    dataDir: instance.dataDir,
    databasePath: resolve(extra.databasePath ?? instance.databasePath),
    extraForeignPaths: extra.foreignMemoryPaths ?? [],
    workAreaRoots: workAreaRootsOf(instance),
    workspacesRoot: instance.workspacesDir,
    providerHomes: [instance.cliHomesDir],
  }
}

let installed: PathPolicy | null = null
let lazyDefault: PathPolicy | null = null

/** Make `policy` the process-wide one (the security gate calls this with the configured options). */
export function installPathPolicy(policy: PathPolicy): void {
  installed = policy
}

/**
 * The process-wide policy. The security gate installs the configured one on
 * register (pathPolicyOptionsFromInstance + config.database.path +
 * config.security.foreignMemoryPaths). Before that, a default built from the
 * instance layout answers — there is never "no policy"; the default knows
 * neither database.path nor security.foreignMemoryPaths.
 */
export function getPathPolicy(): PathPolicy {
  if (installed) return installed
  lazyDefault ??= createPathPolicy(pathPolicyOptionsFromInstance(resolveInstance({ ensureDirs: false })))
  return lazyDefault
}

/** Tests only: forget the installed and the lazy default policy. */
export function resetPathPolicyForTests(): void {
  installed = null
  lazyDefault = null
}
