// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// skills.importRoots and agent.importRoots are read again on every start, so
// a configured root is a LIVE source for EYAS's procedural memory. Another
// tool's own folders may not be one: ~/.claude, ~/.grok, ~/.codex and the
// rest of FOREIGN_MEMORY_STORES, an Obsidian vault, a
// security.foreignMemoryPaths entry, or the EYAS-owned CLI homes. What EYAS
// takes from there comes in once, through the Data port importer, and is
// EYAS's own from then on.
//
// This is the one answer to "is this import root still scanned?". The skills
// module, the agent module and `eyas doctor` all ask it, and it asks the
// shared path policy — never a list of its own.

import { isAbsolute, resolve } from 'node:path'
import { realpathBestEffort } from '../fs-realpath.js'
import { getPathPolicy, type PathPolicy } from './path-policy.js'

/** Where the operator is sent instead (UI path of the Data port import). */
export const IMPORT_ROOT_REMEDY = 'import these files once with Settings → System → Data portability → Import data'

export interface SkippedImportRoot {
  /** The root as configured (after `~` expansion). */
  root: string
  /**
   * `inside`: the root lies in a protected folder. `encloses`: a protected
   * folder lies under the root, so a recursive scan would read it.
   */
  relation: 'inside' | 'encloses'
  /** What was hit, in plain English (e.g. `Claude Code (~/.claude)`). Never a secret. */
  label: string
}

export interface ImportRootSelection {
  /** Roots that are still scanned, in configured order. */
  scan: string[]
  skipped: SkippedImportRoot[]
}

function caseFolds(): boolean {
  return process.platform === 'darwin' || process.platform === 'win32'
}

function canon(p: string, fold: boolean): string {
  let s = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  return fold ? s.toLowerCase() : s
}

/** Lexical and real forms of an absolute path, canonicalised. */
function formsOf(p: string, fold: boolean): string[] {
  const lexical = canon(resolve(p), fold)
  let real = lexical
  try {
    real = canon(realpathBestEffort(resolve(p)), fold)
  } catch {
    // Unresolvable: the lexical form alone.
  }
  return real === lexical ? [lexical] : [lexical, real]
}

function inside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/** Every folder the policy protects that a recursive scan under a root could reach. */
function protectedFolders(policy: PathPolicy): Array<{ path: string; label: string }> {
  const d = policy.describe()
  const out: Array<{ path: string; label: string }> = []
  for (const store of d.foreignStores) {
    for (const path of store.paths) out.push({ path, label: store.label })
  }
  for (const home of d.providerHomes) out.push({ path: home, label: 'EYAS-owned CLI homes' })
  for (const owner of d.foreignMemoryPaths) out.push({ path: owner.path, label: 'protected path (security.foreignMemoryPaths)' })
  for (const vault of d.detectedVaults) out.push({ path: vault.path, label: 'Obsidian vault' })
  return out
}

/**
 * Why `root` may not be a live import source, or null when it may. A root
 * inside another tool's memory, an Obsidian vault or an EYAS-owned CLI home
 * is refused, and so is a root that encloses one of them.
 */
export function classifyImportRoot(root: string, policy: PathPolicy = getPathPolicy()): SkippedImportRoot | null {
  if (typeof root !== 'string' || !root.trim() || root.includes('\0')) return null
  const abs = isAbsolute(root) ? root : resolve(root)
  const verdict = policy.classify(abs)
  if (verdict.kind === 'foreign-memory' || verdict.kind === 'provider-home') {
    return { root, relation: 'inside', label: verdict.label }
  }
  const fold = caseFolds()
  const rootForms = formsOf(abs, fold)
  for (const folder of protectedFolders(policy)) {
    const folderForms = formsOf(folder.path, fold)
    if (folderForms.some((f) => rootForms.some((r) => inside(f, r)))) {
      return { root, relation: 'encloses', label: folder.label }
    }
  }
  return null
}

/** Split configured roots into the ones still scanned and the ones skipped. */
export function selectImportRoots(roots: readonly string[], policy: PathPolicy = getPathPolicy()): ImportRootSelection {
  const scan: string[] = []
  const skipped: SkippedImportRoot[] = []
  for (const root of roots) {
    const hit = classifyImportRoot(root, policy)
    if (hit) skipped.push(hit)
    else scan.push(root)
  }
  return { scan, skipped }
}

/** One line per skipped root, for logs and `eyas doctor`. */
export function describeSkippedImportRoot(s: SkippedImportRoot): string {
  return s.relation === 'inside'
    ? `${s.root} is inside ${s.label}`
    : `${s.root} contains ${s.label}`
}
