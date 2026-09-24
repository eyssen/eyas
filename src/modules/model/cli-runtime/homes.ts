// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// EYAS-owned homes for the CLI providers: `<dataDir>/cli-homes/<provider>`.
// A CLI child runs with HOME (and its own config dir) pointed here instead of
// at the operator's home, so it loads no host config, rules, memory or MCP
// servers and writes its session store where EYAS can purge it. The homes hold
// the credentials of the EYAS sign-in, hence mode 0700.
//
// Nothing here ever reads a host file: managed files are compared with what
// already sits in the EYAS home, and nothing outside the homes is touched.
//
// Symlinks: the CLI runs with HOME = its EYAS home, so its own shell and file
// tools can plant links there (config.toml → a host file, sessions → a host
// folder). Every operation here therefore walks the path below the home with
// lstat and refuses any symlink, writes through a temp file + rename in the
// verified folder (rename replaces a link, it never follows one), and removes
// only entries of a verified, real store folder inside the homes folder.

import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { resolveInstance } from '@core/instance.js'

const HOME_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** How long a session-store entry may linger before the boot sweeper removes it. */
export const SESSION_STORE_MAX_AGE_MS = 60 * 60 * 1000

export interface CliHomeOptions {
  /** Parent of every CLI home (default InstancePaths.cliHomesDir). */
  homesDir?: string
}

function homesDirOf(opts?: CliHomeOptions): string {
  return opts?.homesDir ?? resolveInstance({ ensureDirs: false }).cliHomesDir
}

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

/** lstat without following a link; null when the entry does not exist. */
function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch (err) {
    if (errCode(err) === 'ENOENT' || errCode(err) === 'ENOTDIR') return null
    throw err
  }
}

/** Throws unless `path` is a real directory (not a symlink to one). */
function assertRealDir(path: string, what: string): void {
  const st = lstatOrNull(path)
  if (!st) throw new Error(`${what} does not exist: ${path}`)
  if (st.isSymbolicLink()) throw new Error(`${what} is a symbolic link: ${path}`)
  if (!st.isDirectory()) throw new Error(`${what} is not a directory: ${path}`)
}

function ensurePrivateDir(dir: string): void {
  // Never chmod through a link: a planted link would re-mode its target.
  if (lstatOrNull(dir)?.isSymbolicLink()) throw new Error(`CLI home folder is a symbolic link: ${dir}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  assertRealDir(dir, 'CLI home folder')
  // mkdir's mode is filtered by the umask and ignored for an existing folder.
  chmodSync(dir, 0o700)
}

/** The EYAS-owned home of one CLI provider, created 0700 on first use. */
export function cliHome(id: string, opts?: CliHomeOptions): string {
  if (!HOME_ID_RE.test(id)) throw new Error(`invalid CLI home id: ${JSON.stringify(id)}`)
  const parent = homesDirOf(opts)
  ensurePrivateDir(parent)
  const home = join(parent, id)
  ensurePrivateDir(home)
  return home
}

/**
 * Walk `segments` below `base` (a verified real directory), refusing any
 * symlink and anything that is not a directory. Missing folders are created
 * 0700 when `create` is set; otherwise the walk stops and returns null.
 */
function walkRealDirs(base: string, segments: readonly string[], create: boolean): string | null {
  let current = base
  for (const seg of segments) {
    const next = join(current, seg)
    const st = lstatOrNull(next)
    if (!st) {
      if (!create) return null
      mkdirSync(next, { mode: 0o700 })
      assertRealDir(next, 'CLI home folder')
    } else if (st.isSymbolicLink()) {
      throw new Error(`CLI home path contains a symbolic link: ${next}`)
    } else if (!st.isDirectory()) {
      throw new Error(`CLI home path is not a directory: ${next}`)
    }
    current = next
  }
  return current
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** A file EYAS owns inside a CLI home (config.toml, requirements.toml, …). */
export interface ManagedFile {
  /** Path relative to the home. */
  path: string
  content: string
  /** File mode (default 0600). */
  mode?: number
}

export interface WriteManagedFilesResult {
  written: string[]
  unchanged: string[]
}

/**
 * Read a file without following a final symlink (O_NOFOLLOW where the OS has
 * it), so a link swapped in after the lstat check is refused, not read.
 */
function readNoFollow(path: string): Buffer {
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    return readFileSync(fd)
  } finally {
    closeSync(fd)
  }
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Write the managed files into `home`, touching only those whose content
 * differs (compared by content hash), so a second call with the same input
 * writes nothing. Paths must stay inside the home.
 */
export function writeManagedFiles(home: string, files: readonly ManagedFile[]): WriteManagedFilesResult {
  const result: WriteManagedFilesResult = { written: [], unchanged: [] }
  assertRealDir(home, 'CLI home')
  for (const file of files) {
    if (!file.path || isAbsolute(file.path)) throw new Error(`managed file path must be relative: ${file.path}`)
    const target = join(home, normalize(file.path))
    if (!isInside(target, home)) throw new Error(`managed file escapes the CLI home: ${file.path}`)
    const segments = relative(home, target).split(sep).filter(Boolean)
    const dir = walkRealDirs(home, segments.slice(0, -1), true) as string
    const existing = lstatOrNull(target)
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
      // Never read, write or chmod through it: it may point at a host file.
      throw new Error(`managed file is not a regular file: ${target}`)
    }
    const wanted = sha256(file.content)
    const current = existing ? sha256(readNoFollow(target)) : null
    if (current === wanted) {
      result.unchanged.push(target)
      continue
    }
    const mode = file.mode ?? 0o600
    // Temp file + rename inside the verified folder: a link planted at the
    // target in the meantime is replaced, never followed. 'wx' refuses to
    // open an existing temp name (or a link placed there).
    const temp = join(dir, `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
    try {
      writeFileSync(temp, file.content, { mode, flag: 'wx' })
      chmodSync(temp, mode)
      renameSync(temp, target)
    } catch (err) {
      try {
        unlinkSync(temp)
      } catch {
        // Already renamed or never created.
      }
      throw err
    }
    result.written.push(target)
  }
  return result
}

/**
 * Read a file EYAS co-owns with the CLI inside its home (a config the CLI
 * also writes, merged key by key), with the same guards as a write: the path
 * stays inside the home, no folder on the way and not the file itself may be
 * a symlink, and the final open does not follow one. Null when it does not
 * exist yet.
 */
export function readManagedFile(home: string, path: string): string | null {
  assertRealDir(home, 'CLI home')
  if (!path || isAbsolute(path)) throw new Error(`managed file path must be relative: ${path}`)
  const target = join(home, normalize(path))
  if (!isInside(target, home)) throw new Error(`managed file escapes the CLI home: ${path}`)
  const segments = relative(home, target).split(sep).filter(Boolean)
  if (walkRealDirs(home, segments.slice(0, -1), false) === null) return null
  const existing = lstatOrNull(target)
  if (!existing) return null
  if (existing.isSymbolicLink() || !existing.isFile()) {
    throw new Error(`managed file is not a regular file: ${target}`)
  }
  return readNoFollow(target).toString('utf-8')
}

/** The target of a home-relative path, refused when it escapes the home. */
function homeTarget(home: string, path: string): { target: string; segments: string[] } {
  if (!path || isAbsolute(path)) throw new Error(`CLI home file path must be relative: ${path}`)
  const target = join(home, normalize(path))
  if (!isInside(target, home)) throw new Error(`CLI home file escapes the CLI home: ${path}`)
  return { target, segments: relative(home, target).split(sep).filter(Boolean) }
}

/**
 * True when `path` (relative to the home) is a non-empty regular file reached
 * without a symlink anywhere on the way — a credential file the CLI wrote
 * into its EYAS home, say. Only metadata is looked at: the file is never
 * opened or read. False when the home, a folder or the file is missing, or
 * when anything on the path is a link.
 */
export function homeFileExists(home: string, path: string): boolean {
  const { target, segments } = homeTarget(home, path)
  const homeStat = lstatOrNull(home)
  if (!homeStat || homeStat.isSymbolicLink() || !homeStat.isDirectory()) return false
  try {
    if (walkRealDirs(home, segments.slice(0, -1), false) === null) return false
  } catch {
    // A link or a file where a folder belongs: nothing EYAS put there.
    return false
  }
  const st = lstatOrNull(target)
  return !!st && st.isFile() && !st.isSymbolicLink() && st.size > 0
}

/**
 * Remove one file from a CLI home (a credential on sign-out). The folders on
 * the way must be real directories; a file that is itself a symlink is
 * unlinked, never followed, so a planted link cannot make EYAS delete a host
 * file. Returns true when something was removed.
 */
export function removeHomeFile(home: string, path: string): boolean {
  assertRealDir(home, 'CLI home')
  const { target, segments } = homeTarget(home, path)
  if (walkRealDirs(home, segments.slice(0, -1), false) === null) return false
  const st = lstatOrNull(target)
  if (!st) return false
  if (st.isDirectory()) throw new Error(`CLI home file is a directory: ${target}`)
  unlinkSync(target)
  return true
}

/**
 * The verified store folder, or null when it does not exist yet. The store
 * must lie at least <provider>/<store> below the homes folder, and every path
 * component below the homes folder must be a real directory — a store (or any
 * folder above it) replaced by a symlink is refused, so a purge can never
 * reach outside the homes.
 */
function verifiedStoreDir(storeDir: string, opts?: CliHomeOptions): string | null {
  const homes = resolve(homesDirOf(opts))
  const store = resolve(storeDir)
  const rel = relative(homes, store)
  const segments = rel.split(sep).filter(Boolean)
  // At least <provider>/<store>: never the homes folder or a whole home.
  if (rel.startsWith('..') || isAbsolute(rel) || segments.length < 2) {
    throw new Error(`session store must be inside a CLI home: ${storeDir}`)
  }
  if (!lstatOrNull(homes)) return null
  let realHomes: string
  try {
    realHomes = realpathSync(homes)
  } catch (err) {
    if (errCode(err) === 'ENOENT') return null
    throw err
  }
  const walked = walkRealDirs(homes, segments, false)
  if (walked === null) return null
  // Belt and braces: the physical store is inside the physical homes folder.
  const realRel = relative(realHomes, realpathSync(walked))
  if (realRel.startsWith('..') || isAbsolute(realRel) || realRel.split(sep).filter(Boolean).length < 2) {
    throw new Error(`session store must be inside a CLI home: ${storeDir}`)
  }
  return walked
}

/**
 * Empty a provider's session store (EYAS never resumes a CLI session, so
 * nothing in it is worth keeping). The folder itself stays. Returns the
 * number of entries removed.
 */
export function purgeSessionStore(storeDir: string, opts?: CliHomeOptions): number {
  const store = verifiedStoreDir(storeDir, opts)
  if (!store) return 0
  let removed = 0
  for (const name of readdirSync(store)) {
    // Re-verified per entry: a folder on the path swapped for a link while
    // the purge runs stops it. An entry that is itself a link is unlinked,
    // never followed (rm does not follow links, at the top or inside a
    // recursive removal).
    if (verifiedStoreDir(storeDir, opts) !== store) throw new Error(`session store changed during purge: ${storeDir}`)
    rmSync(join(store, name), { recursive: true, force: true })
    removed++
  }
  return removed
}

/**
 * Remove session-store entries older than `maxAgeMs` — the boot backstop for
 * a purge a crash or kill skipped. Returns the number removed; never throws
 * for an unreadable entry.
 */
export function sweepSessionStore(
  storeDir: string,
  opts?: CliHomeOptions & { maxAgeMs?: number; now?: number },
): number {
  const store = verifiedStoreDir(storeDir, opts)
  if (!store) return 0
  const cutoff = (opts?.now ?? Date.now()) - (opts?.maxAgeMs ?? SESSION_STORE_MAX_AGE_MS)
  let names: string[]
  try {
    names = readdirSync(store)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    const entry = join(store, name)
    try {
      // lstat: a link's own age, never its target's.
      if (lstatSync(entry).mtimeMs >= cutoff) continue
      if (verifiedStoreDir(storeDir, opts) !== store) return removed
      rmSync(entry, { recursive: true, force: true })
      removed++
    } catch {
      // Vanished mid-sweep.
    }
  }
  return removed
}
