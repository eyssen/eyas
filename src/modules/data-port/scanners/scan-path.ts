// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
  type Dirent,
  type Stats,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { generateId } from '@shared/crypto'
import {
  HEAD_CHARS,
  LARGE_CONTAINER_WARN_BYTES,
  LARGE_TEXT_WARN_BYTES,
  PROGRESS_EVERY_DIRS,
  PROGRESS_EVERY_FILES,
  SNIFF_BYTES,
  STREAM_CHUNK_BYTES,
} from '../constants.js'
import { failureReason } from '../errors.js'
import { adapterFor, classifyFile, detectProfile } from '../adapters/registry.js'
import { compareRelPathBytes } from '../skill-package.js'
import {
  DIRECTORY_CLASSES,
  type CandidateWarning,
  type DirectoryClass,
  type ScanCandidate,
  type ScanDirRow,
  type ScanResult,
  type ScanWarning,
  type SourceProfile,
} from '../types.js'
import { looksLikeSecrets, previewOf, rootMarkerPrefix, titleFromPathAndContent } from './heuristics.js'
import { classifyDirectory, countTree, nameClass, type TreeCount } from './directory-classes.js'

/** Directories whose files the owner wants to see first in progress reports; never an inclusion rule. */
const PRIORITY_NAME_RE = /^(ai-memory|skills|memory|agents|semantic|procedural)$/i
const PRIORITY_PATH_RE = /(ai-memory|\/skills\/|\/memory\/)/i
const toPosix = (p: string): string => p.replace(/\\/g, '/')

export type WalkEntry =
  /**
   * `skillRoot`: the nearest directory (this file's own included) whose listing
   * holds `skill.md`; the walker knows it from the listing, so listing order
   * never matters.
   */
  | {
      type: 'file'
      path: string
      realPath: string
      size: number
      mtime: string
      birthtime: string
      viaSymlink: boolean
      skillRoot: string | null
      inVault: boolean
      /**
       * The file claims a size but has no blocks allocated locally, so its
       * bytes are not on this machine (A-66). Reading it makes a cloud provider
       * fetch it — measured at 9.7 GB pulled from one home-directory scan.
       */
      dataless: boolean
    }
  | { type: 'file-alias'; realPath: string; path: string }
  | { type: 'directory'; path: string; realPath: string; parent: string | null; depth: number; fileCount: number }
  | {
      type: 'directory-skipped'
      path: string
      realPath: string
      parent: string
      depth: number
      cls: DirectoryClass
      files: number
      dirs: number
      unreadable: number
    }
  | { type: 'directory-unreadable'; path: string; error: string }
  /** `firstPath`: the path this real directory was first reached at — the path its rows carry. */
  | { type: 'directory-alias'; realPath: string; path: string; firstPath: string; cycle: boolean }
  | { type: 'symlink-unfollowed'; path: string }
  | { type: 'symlink-broken'; path: string; target: string }
  /**
   * Every directory under `root` (a directory whose listing holds `skill.md`)
   * has been processed: the package is complete.
   */
  | { type: 'skill-package-done'; root: string }
  /** Running counters, so the driver reports real numbers (never zeros). */
  | { type: 'tick'; dirsVisited: number; filesSeen: number }

export interface WalkSummary {
  dirsVisited: number
  filesSeen: number
  dirsSkipped: Record<DirectoryClass, number>
  filesInSkippedDirs: number
  symlinksFollowed: number
  symlinkAliases: number
  symlinkCycles: number
  unreadable: number
  /**
   * A-84. `blocksSignalProven` is false when no file in this scan ever showed
   * bytes AND blocks together, so `st_blocks` was never demonstrated to work
   * here; `datalessUnverified` counts the files that looked like placeholders
   * while that was still true and were therefore classified normally.
   */
  blocksSignalProven: boolean
  datalessUnverified: number
  vaultRoots: string[]
  dirAliases: Map<string, string[]>
  fileAliases: Map<string, string[]>
}

const zeroClasses = (): Record<DirectoryClass, number> =>
  Object.fromEntries(DIRECTORY_CLASSES.map((c) => [c, 0])) as Record<DirectoryClass, number>

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}

/**
 * The real file behind an entry, as the de-dupe key. `realpathSync` resolves the
 * whole chain and fails with EACCES on a link whose target the process cannot
 * open — the target then falls back to its own path, and without the readlink
 * step the link would fall back to a DIFFERENT path and the one file would be
 * listed twice. `readlinkSync` needs no permission on the target.
 */
function realFileKey(full: string, viaSymlink: boolean): string {
  const real = safeRealpath(full)
  if (real) return real
  if (!viaSymlink) return full
  const target = safeReadlink(full)
  return target ? resolve(dirname(full), target) : full
}

function safeReadlink(p: string): string {
  try {
    return readlinkSync(p)
  } catch {
    return ''
  }
}

/**
 * A file whose bytes are not on this machine (A-66).
 *
 * `st_blocks` is what the filesystem has actually allocated. A cloud
 * placeholder reports the full logical size with ZERO blocks — verified on this
 * machine against a real OneDrive folder, where every placeholder read
 * `size > 0, blocks: 0` while ordinary local files read `blocks ≈ size / 512`.
 * Node exposes no `st_flags`, so the macOS dataless flag itself is out of reach;
 * this is the portable proxy for it.
 *
 * A compressed file whose data lives in an extended attribute also reports zero
 * blocks. Reading one would have been cheap, so the cost of that overlap is a
 * row listed rather than read — visible, with its reason, and never a dropped
 * file.
 */
function isDataless(st: Stats): boolean {
  return st.size > 0 && typeof st.blocks === 'number' && st.blocks === 0
}

/**
 * The opposite demonstration, and the one that CALIBRATES the signal (A-84):
 * a file with bytes in it AND blocks allocated to it proves this platform
 * populates `st_blocks` at all.
 *
 * It is needed because `blocks === 0` means "no local bytes" only where the
 * field is populated. `Stats.blocks` is verified here on macOS and is documented
 * for Linux; how it behaves on Windows — a shipped install target this repo's CI
 * never exercises — is not verified from this tree. If some platform reported 0
 * for everything, every non-empty file would read as a placeholder and an import
 * there would file almost nothing.
 *
 * So the signal is proven before it is trusted — and proven OUT OF TREE, because
 * the question is about the PLATFORM, not about the files being scanned.
 * Calibrating on the scanned tree looked reasonable and was wrong: a scan
 * pointed straight at a cloud folder has nothing but placeholders in it, never
 * calibrates, and then READS every one of them — six downloads in the measured
 * case, which is A-66's hazard returning on the platform where the signal works.
 * That gesture is one the docs explicitly invite in all six languages.
 *
 * A directory cannot serve either: measured on APFS, a directory with entries
 * reports `size 160, blocks 0`, so calibrating on one would disable the feature
 * on the very platform it works.
 */
function provesBlocksArePopulated(st: Stats): boolean {
  return st.size > 0 && typeof st.blocks === 'number' && st.blocks > 0
}

/**
 * How many files the IN-TREE fallback may examine before concluding the signal
 * is simply not available here. A platform that has not shown one populated
 * `blocks` in this many files is not going to, and on such a platform the probe
 * would otherwise run in every directory for the whole scan.
 */
const CALIBRATION_PROBE_LIMIT = 512

/**
 * The out-of-tree subject: the running executable. Guaranteed to be a real local
 * file with bytes in it — the process is executing from it — so if this platform
 * populates `st_blocks` at all, this stat shows it. One stat, no read, nothing
 * from the scanned tree. Measured here: size 60 953 744, blocks 119 056.
 *
 * The in-tree probe is kept as the fallback, and it is gated on the signal still
 * being unproven rather than on this stat having THROWN — which is the stronger
 * property: an executable that sits on a filesystem reporting no blocks answers
 * `false` without throwing, and the walk then proves the signal from the tree
 * instead of disabling detection for the whole scan.
 */
function platformPopulatesBlocks(): boolean {
  try {
    return provesBlocksArePopulated(statSync(process.execPath))
  } catch {
    return false
  }
}

function errnoOf(err: unknown): string {
  return (err as { code?: string })?.code ?? failureReason(err)
}

/**
 * Every directory under `root`, breadth first, every real directory entered at
 * most once (realpath de-dupe is also the cycle detector). No file cap, no
 * directory cap, no keep-list: inclusion is decided ONLY by `classifyDirectory`
 * (D-9) and the scan root itself is never classified. Yields a `tick` every
 * PROGRESS_EVERY_FILES files / PROGRESS_EVERY_DIRS directories so the driver can
 * report and yield to the event loop.
 */
export function* walkTree(
  root: string,
  opts: { followSymlinks?: boolean } = {},
): Generator<WalkEntry, WalkSummary> {
  const followSymlinks = opts.followSymlinks !== false
  const rootResolved = resolve(root)
  const realRoot = safeRealpath(rootResolved) ?? rootResolved
  /** real directory → the path it was first reached at (the de-dupe set and the alias source in one). */
  const visitedDirs = new Map<string, string>()
  const seenFiles = new Set<string>()
  /** real class directory → its count, so a second path to it is free (and not double-counted). */
  const countedClassDirs = new Map<string, TreeCount>()
  const summary: WalkSummary = {
    dirsVisited: 0,
    filesSeen: 0,
    dirsSkipped: zeroClasses(),
    filesInSkippedDirs: 0,
    symlinksFollowed: 0,
    symlinkAliases: 0,
    symlinkCycles: 0,
    unreadable: 0,
    blocksSignalProven: false,
    datalessUnverified: 0,
    vaultRoots: [],
    dirAliases: new Map(),
    fileAliases: new Map(),
  }
  /** realDir → its real ancestor chain, for cycle detection. */
  const ancestors = new Map<string, string[]>([[realRoot, []]])
  /**
   * Skill packages: `skillRoots` on a queue item are the ancestor directories
   * (outermost first) whose listing holds `skill.md`; the nearest is the last.
   * `pendingUnder` counts queued-but-unprocessed directories under each root
   * (the root itself included) — when it reaches 0 the package is complete and
   * `skill-package-done` is yielded, so the scanner can emit the SKILL.md row
   * with every asset attached, whatever order readdir listed them in.
   */
  interface Queued {
    dir: string
    parent: string | null
    depth: number
    skillRoots: string[]
  }
  const pendingUnder = new Map<string, number>()
  /** Files the in-tree FALLBACK has examined; bounded so a bad platform stops paying. */
  let calibrationProbes = 0
  // A-85: settled before the walk begins, out of tree, so a root that holds
  // nothing but placeholders is still recognised.
  summary.blocksSignalProven = platformPopulatesBlocks()
  const priority: Queued[] = [{ dir: rootResolved, parent: null, depth: 0, skillRoots: [] }]
  const normal: Queued[] = []
  let sinceTick = 0
  let dirsSinceTick = 0
  const tick = (): Extract<WalkEntry, { type: 'tick' }> => ({
    type: 'tick',
    dirsVisited: summary.dirsVisited,
    filesSeen: summary.filesSeen,
  })
  /**
   * A directory under these roots is finished (processed, aliased, unreadable or
   * skipped): count it down, yield the roots that complete.
   */
  function* finishUnder(roots: readonly string[]): Generator<WalkEntry> {
    for (const r of roots) {
      const left = (pendingUnder.get(r) ?? 1) - 1
      if (left > 0) {
        pendingUnder.set(r, left)
      } else {
        pendingUnder.delete(r)
        yield { type: 'skill-package-done', root: r }
      }
    }
  }

  while (priority.length || normal.length) {
    const item = priority.shift() ?? normal.shift()!
    const { dir, parent, depth } = item
    summary.dirsVisited++
    const realParent = parent ? safeRealpath(parent) : null
    const realDir = safeRealpath(dir)
    if (!realDir) {
      summary.unreadable++
      yield { type: 'directory-unreadable', path: dir, error: 'ENOENT' }
      yield* finishUnder(item.skillRoots)
      continue
    }
    if (visitedDirs.has(realDir)) {
      // `ancestors` holds the STRICT ancestors, so the parent itself is never in
      // the chain: `alpha/self -> alpha` — the commonest cycle shape — has to be
      // tested for separately or it reports as a plain alias.
      const chain = (realParent && ancestors.get(realParent)) || []
      const cycle = realDir === realRoot || realDir === realParent || chain.includes(realDir)
      if (cycle) summary.symlinkCycles++
      summary.dirAliases.set(realDir, [...(summary.dirAliases.get(realDir) ?? []), dir])
      yield { type: 'directory-alias', realPath: realDir, path: dir, firstPath: visitedDirs.get(realDir)!, cycle }
      yield* finishUnder(item.skillRoots)
      continue
    }
    visitedDirs.set(realDir, dir)
    if (realParent) ancestors.set(realDir, [...(ancestors.get(realParent) ?? []), realParent])

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      summary.unreadable++
      yield { type: 'directory-unreadable', path: dir, error: errnoOf(err) }
      yield* finishUnder(item.skillRoots)
      continue
    }
    const names = entries.map((e) => String(e.name))
    if (names.includes('.obsidian')) summary.vaultRoots.push(dir)
    const dirHasSkill = names.some((n) => n.toLowerCase() === 'skill.md')
    const skillRoots = dirHasSkill ? [...item.skillRoots, dir] : item.skillRoots
    // This directory itself; children are added to the count as they are queued.
    if (dirHasSkill) pendingUnder.set(dir, 1)
    const skillRoot = skillRoots.length ? skillRoots[skillRoots.length - 1]! : null
    const inVault = summary.vaultRoots.some((v) => dir === v || dir.startsWith(v + sep))

    /*
     * The in-tree FALLBACK (A-84), reached only when the out-of-tree stat above
     * failed. It calibrates BEFORE classifying anything in this directory, so
     * that whether a placeholder is recognised never depends on where it happens
     * to sort in its own listing. It gives up after a bounded number of files,
     * so a platform that never populates `blocks` does not pay for the probe in
     * every directory of the scan.
     */
    if (!summary.blocksSignalProven && calibrationProbes < CALIBRATION_PROBE_LIMIT) {
      for (const entry of entries) {
        if (summary.blocksSignalProven || calibrationProbes >= CALIBRATION_PROBE_LIMIT) break
        if (!entry.isFile()) continue
        calibrationProbes++
        try {
          if (provesBlocksArePopulated(statSync(join(dir, String(entry.name))))) {
            summary.blocksSignalProven = true
          }
        } catch {
          /* unreadable here is the main loop's business, not the calibration's */
        }
      }
    }

    let directFiles = 0
    const dirsPri: Queued[] = []
    const dirsNorm: Queued[] = []
    /**
     * Children of a directory that belongs to an OPEN skill package. They jump
     * the whole queue, so a package's own subtree is finished before the walk
     * moves sideways and `skill-package-done` arrives while the scanner still
     * holds only this package. Breadth first everywhere else, this makes the
     * number of packages open at once bounded by package NESTING DEPTH instead
     * of by how many packages happen to be siblings (I1).
     */
    const dirsInPackage: Queued[] = []
    for (const entry of entries) {
      const name = String(entry.name)
      const full = join(dir, name)
      let isDir = false
      let isFile = false
      let viaSymlink = false
      let st: Stats | undefined
      try {
        const lst = lstatSync(full)
        if (lst.isSymbolicLink()) {
          if (!followSymlinks) {
            yield { type: 'symlink-unfollowed', path: full }
            continue
          }
          viaSymlink = true
          try {
            st = statSync(full)
          } catch {
            summary.unreadable++
            yield { type: 'symlink-broken', path: full, target: safeReadlink(full) }
            continue
          }
          summary.symlinksFollowed++
        } else {
          st = lst
        }
        isDir = st.isDirectory()
        isFile = st.isFile()
      } catch (err) {
        summary.unreadable++
        yield { type: 'directory-unreadable', path: full, error: errnoOf(err) }
        continue
      }

      if (isDir) {
        const realChild = safeRealpath(full) ?? full
        let childNames: string[]
        try {
          childNames = readdirSync(realChild).map((n) => String(n))
        } catch (err) {
          summary.unreadable++
          yield { type: 'directory-unreadable', path: full, error: errnoOf(err) }
          continue
        }
        const cls = classifyDirectory(name, realChild, childNames, names, dir)
        if (cls) {
          // Each PATH to a class directory is its own row, but the tree behind
          // them is one tree: counted once, then served from the cache, so a
          // `node_modules` reached twice neither pays the walk twice nor adds
          // its files to `filesInSkippedDirs` twice.
          let counted = countedClassDirs.get(realChild)
          if (!counted) {
            // Cooperative count: every tick of countTree is forwarded so the
            // driver can yield mid-count (P-9).
            const counter = countTree(realChild)
            let cn = counter.next()
            while (!cn.done) {
              yield tick()
              cn = counter.next()
            }
            counted = cn.value
            countedClassDirs.set(realChild, counted)
            summary.filesInSkippedDirs += counted.files
          }
          summary.dirsSkipped[cls]++
          yield {
            type: 'directory-skipped',
            path: full,
            realPath: realChild,
            parent: dir,
            depth: depth + 1,
            cls,
            ...counted,
          }
          // A class directory is never queued, so it never counts toward a skill root.
          continue
        }
        const queued: Queued = { dir: full, parent: dir, depth: depth + 1, skillRoots }
        for (const r of skillRoots) pendingUnder.set(r, (pendingUnder.get(r) ?? 0) + 1)
        if (skillRoots.length) dirsInPackage.push(queued)
        else if (PRIORITY_NAME_RE.test(name) || PRIORITY_PATH_RE.test(toPosix(full))) dirsPri.push(queued)
        else dirsNorm.push(queued)
        continue
      }
      if (!isFile || !st) continue
      summary.filesSeen++
      directFiles++
      const key = realFileKey(full, viaSymlink)
      if (seenFiles.has(key)) {
        summary.symlinkAliases++
        summary.fileAliases.set(key, [...(summary.fileAliases.get(key) ?? []), full])
        yield { type: 'file-alias', realPath: key, path: full }
      } else {
        seenFiles.add(key)
        // A-84: one file with bytes and blocks proves the signal for the whole
        // scan; until something has, a zero-blocks file is not called a
        // placeholder, because on a platform that reports 0 for everything that
        // guess would swallow the entire import. Uncalibrated means classify
        // normally — the behaviour this feature had before the signal existed.
        if (provesBlocksArePopulated(st)) summary.blocksSignalProven = true
        const looksDataless = isDataless(st)
        if (looksDataless && !summary.blocksSignalProven) summary.datalessUnverified++
        yield {
          type: 'file',
          path: full,
          realPath: key,
          size: st.size,
          mtime: st.mtime.toISOString(),
          birthtime: st.birthtime.toISOString(),
          viaSymlink,
          skillRoot,
          inVault,
          dataless: looksDataless && summary.blocksSignalProven,
        }
      }
      if (++sinceTick >= PROGRESS_EVERY_FILES) {
        sinceTick = 0
        yield tick()
      }
    }
    yield { type: 'directory', path: dir, realPath: realDir, parent, depth, fileCount: directFiles }
    priority.unshift(...dirsInPackage)
    priority.push(...dirsPri)
    normal.push(...dirsNorm)
    // This directory is processed and its children are queued: count it down for
    // every skill root above it.
    yield* finishUnder(skillRoots)
    if (++dirsSinceTick >= PROGRESS_EVERY_DIRS) {
      dirsSinceTick = 0
      yield tick()
    }
  }
  return summary
}

/** Drains the generator — tests and the synchronous upload path. */
export function collectWalk(
  root: string,
  opts: { followSymlinks?: boolean } = {},
): { entries: WalkEntry[]; summary: WalkSummary } {
  const entries: WalkEntry[] = []
  const gen = walkTree(root, opts)
  let next = gen.next()
  while (!next.done) {
    if (next.value.type !== 'tick') entries.push(next.value)
    next = gen.next()
  }
  return { entries, summary: next.value }
}

/** Files a skill package never ships as an asset: compiled artefacts and OS state. */
const SKILL_ASSET_JUNK = /^\.ds_store$|\.pyc$/

/** Container formats an adapter expands into units. */
const CONTAINER_EXT = /\.(json|jsonl|sqlite)$/i

/** Chunks between two yields of the streamed hash: 16 × STREAM_CHUNK_BYTES = 16 MiB of reading before the loop gets a turn. */
const HASH_CHUNKS_PER_TICK = 16

/** The two spellings of a skill package's document; the walker matches them case-insensitively. */
const SKILL_DOC_NAMES = ['SKILL.md', 'skill.md'] as const

/**
 * The bytes of one file, or the reason the process could not read them. A file
 * the walker can `lstat` but cannot open — mode `0o000`, an EPERM under a
 * protected directory, an ENOENT race between the listing and the read — is a
 * row with the `unreadable` reason, never an exception that ends the scan (C1).
 */
type HashedFile =
  | { ok: true; raw: Buffer | null; head: Buffer; sha256: string }
  | { ok: false; error: string }

interface SkillAsset {
  relPath: string
  bytes: number
  sha256: string
  binary: boolean
  /** The secrets predicate matched — a flag on the bundled file, never a refusal (R11.4). */
  containsSecrets?: boolean
}

/**
 * Byte-wise, through the SAME comparator `sortAssetsByPath` (skill-package.ts)
 * uses at apply time, so the scanner's list, the package digest and the applied
 * skill agree by construction rather than by two copies staying in step. Never
 * `localeCompare`, whose result depends on the host locale (A6).
 */
const byPathBytes = (a: { relPath: string }, b: { relPath: string }): number =>
  compareRelPathBytes(a.relPath, b.relPath)

/** A row for a file the import passes over — the file stays visible, with its reason. */
/**
 * A file whose bytes are not on this machine (A-66/A-71): IMPORTABLE and
 * unticked, never noise. One builder for both sites — inside a skill package and
 * outside one — because A-71's disposition must not depend on where the file
 * happens to sit (A-73).
 *
 * Built from `stat` alone. Nothing here reads the file, which is the whole point.
 */
function notDownloadedRow(
  rel: string,
  bytes: number,
  extra: Partial<ScanCandidate> = {},
): ScanCandidate {
  const reason = 'Stored in the cloud, not on this machine — importable, not downloaded'
  return {
    id: generateId(),
    relativePath: rel,
    kind: 'knowledge',
    target: 'vault.semantic',
    title: rel.split('/').pop() ?? rel,
    preview: reason,
    bytes,
    // Unread, so this is what the NAME is worth and no more.
    confidence: 0.5,
    reason,
    reasonCode: 'not-downloaded',
    selectedByDefault: false,
    ...extra,
  }
}

function noiseRow(
  rel: string,
  bytes: number,
  reason: string,
  reasonCode: string,
  title?: string,
  extra: Partial<ScanCandidate> = {},
): ScanCandidate {
  return {
    id: generateId(),
    relativePath: rel,
    kind: 'noise',
    target: 'none',
    title: title ?? rel.split('/').pop() ?? rel,
    preview: reason,
    bytes,
    confidence: 0.9,
    reason,
    reasonCode,
    selectedByDefault: false,
    ...extra,
  }
}

/** `paths` = every path the content was found at; starts with the row's own path. Shared with the collector and the tests. */
export function addPathTo(row: ScanCandidate, path: string): void {
  if (path === row.relativePath && !row.paths) return
  const paths = row.paths ?? [row.relativePath]
  if (!paths.includes(path)) paths.push(path)
  row.paths = paths
}

export type ScanEvent =
  | { type: 'dir'; row: ScanDirRow }
  | { type: 'candidate'; candidate: ScanCandidate }
  /** A row already yielded gains an alias path (file alias or content duplicate). Applied by id — the row may be flushed already. */
  | { type: 'candidate-patch'; id: string; addPath: string }
  /** Every row at or under `realRel` is also reachable at `aliasRel` (a symlinked directory). Emitted after the walk, before `done`. */
  | { type: 'dir-alias'; realRel: string; aliasRel: string }
  | {
      type: 'progress'
      dirsVisited: number
      filesSeen: number
      candidates: number
      bytes: number
      currentDir: string
    }
  | { type: 'done'; result: Omit<ScanResult, 'candidates' | 'dirs'> }

/**
 * sha256 of a file read through an fd in STREAM_CHUNK_BYTES chunks, yielding
 * every HASH_CHUNKS_PER_TICK chunks; the head is returned for classification.
 */
function* hashStreamed(path: string, headBytes: number): Generator<'tick', { sha256: string; head: Buffer }> {
  const fd = openSync(path, 'r')
  try {
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(STREAM_CHUNK_BYTES)
    let head: Buffer = Buffer.alloc(0)
    let n: number
    let chunks = 0
    while ((n = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      const slice = chunk.subarray(0, n)
      hash.update(slice)
      if (head.length < headBytes) head = Buffer.concat([head, slice.subarray(0, headBytes - head.length)])
      if (++chunks % HASH_CHUNKS_PER_TICK === 0) yield 'tick'
    }
    return { sha256: hash.digest('hex'), head }
  } finally {
    closeSync(fd)
  }
}

/**
 * A skill is its SKILL.md AND the files bundled with it (A11.4): two packages
 * whose documents match but whose scripts differ are two packages.
 */
function skillIdentity(docSha: string, assets: readonly SkillAsset[]): string {
  if (!assets.length) return docSha
  const digest = createHash('sha256').update(docSha)
  for (const a of assets) digest.update(`\n${a.relPath}\n${a.sha256}`)
  return digest.digest('hex')
}

interface PackageBuffer {
  /** The SKILL.md row, held until `skill-package-done`; null when the document became no skill. */
  doc: ScanCandidate | null
  docRealKey: string
  /** The document's name as the package spells it (`SKILL.md` / `skill.md`), so an orphan row names a path that exists. */
  docName: string
  /** Why the document is not a skill row (empty, binary, classified otherwise) — the orphan rows say it. */
  docOutcome: string | null
  assets: SkillAsset[]
  notBundled: Array<{ relPath: string; bytes: number; reason: string; notDownloaded?: boolean }>
}

/**
 * The scan as an event stream (P-18). Nothing is collected: rows leave as they
 * are decided, duplicates are settled inline against an identity map, a skill
 * package is buffered only until the walker leaves it, and alias paths reach
 * rows that are already gone as patch events. The generator holds ids, digests,
 * paths and at most one package's asset descriptors — never rows.
 */
export function* scanDirectoryEvents(opts: {
  rootPath: string
  sourceProfile: SourceProfile
  /** Uploads never follow symlinks: an archive can point anywhere on the host. */
  followSymlinks?: boolean
  /** The header row's id when the service drives the scan in the background (Task 9); fresh otherwise. */
  scanId?: string
}): Generator<ScanEvent> {
  const started = performance.now()
  const root = resolve(opts.rootPath)
  if (!existsSync(root)) {
    throw new Error(`Path does not exist: ${root}`)
  }
  if (!statSync(root).isDirectory()) {
    throw new Error(`Path is not a directory: ${root}`)
  }
  const followSymlinks = opts.followSymlinks !== false
  // A scan rooted inside an assistant tree keeps no marker segment in its
  // relative paths, so every rule that recognises durable content by where it
  // lives would stop matching. The candidate keeps its root-relative path; the
  // classifier is shown the path a scan of the parent would have produced (C1).
  const markerPrefix = rootMarkerPrefix(root)
  const marked = (rel: string): string => (markerPrefix ? `${markerPrefix}/${rel}` : rel)
  const marks = (rel: string): Partial<ScanCandidate> => (markerPrefix ? { classifiedPath: marked(rel) } : {})
  /**
   * The root-relative path, whether the absolute path is spelled with the root
   * as given or as resolved — on macOS a realpath turns `/var/…` into
   * `/private/var/…`, and a package reached through a symlink is named that way.
   */
  const realRoot = safeRealpath(root) ?? root
  const relOf = (full: string): string => {
    const asGiven = toPosix(relative(root, full))
    const r = asGiven.startsWith('..') ? toPosix(relative(realRoot, full)) : asGiven
    return r === '' ? '.' : r
  }
  const underRoot = (p: string): boolean =>
    p === root || p.startsWith(root + sep) || p === realRoot || p.startsWith(realRoot + sep)
  /** The real directory of a package — one key for a package however it was reached. */
  const pkgKeyCache = new Map<string, string>()
  const pkgKey = (dir: string): string => {
    const hit = pkgKeyCache.get(dir)
    if (hit) return hit
    const key = safeRealpath(dir) ?? dir
    pkgKeyCache.set(dir, key)
    return key
  }

  // Profile: decided from the root's own two levels up front (cheap), per-row
  // `adapterId` is the provenance (R11.6). A root the process can stat but not
  // list — any TCC-protected directory on macOS — reaches the walker, which
  // lists it as an `unreadable` row, rather than throwing a raw errno out of the
  // first `next()` (M-new-1).
  const listDir = (dir: string): Dirent[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
  }
  /**
   * Every provider marker is a path SEGMENT — `.claude/`, `/.cursor/`,
   * `.github/instructions/` — so a bare listing name matches none of them and
   * every tree would detect as `generic-md`. The probe therefore hands
   * `detectProfile` real relative paths: the root's entries and, one level down,
   * the children of each of its directories, with a trailing separator on a
   * directory so a marker written with one still matches (A-43).
   */
  const probe: string[] = []
  for (const entry of listDir(root)) {
    const name = String(entry.name)
    probe.push(marked(name))
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    probe.push(marked(`${name}/`))
    // The probe follows a link only where the walk itself would (A-44). An
    // uploaded archive is scanned with `followSymlinks: false`; without this
    // condition a top-level link pointing at a directory outside the extracted
    // tree still had its children listed, so an attacker-controlled archive
    // could steer the detected profile LABEL even though no byte from outside
    // ever reaches a row.
    if (entry.isSymbolicLink() && !followSymlinks) continue
    for (const child of listDir(join(root, name))) {
      const rel = `${name}/${String(child.name)}`
      probe.push(marked(rel))
      if (child.isDirectory() || child.isSymbolicLink()) probe.push(marked(`${rel}/`))
    }
  }
  if (existsSync(join(root, '.obsidian')) || basename(root).toLowerCase().includes('obsidian')) {
    probe.push('.obsidian/app.json')
  }
  const detected = opts.sourceProfile === 'auto' ? detectProfile(probe) : opts.sourceProfile

  // ── identity, never rows (P-18) ─────────────────────────────────────────
  const firstByIdentity = new Map<string, { id: string; relativePath: string; realKey: string }>()
  const rowIdsByRealFile = new Map<string, string[]>()
  const bufferedDocs = new Map<string, ScanCandidate>()
  /** Real file → the id of the buffered document it is, so an alias reaches a row that has not been emitted yet. */
  const bufferedByRealFile = new Map<string, string>()
  const packages = new Map<string, PackageBuffer>()
  const dirAliasPairs: Array<[string, string]> = []
  const packageOf = (rootDir: string): PackageBuffer => {
    let p = packages.get(rootDir)
    if (!p) {
      p = { doc: null, docRealKey: '', docName: SKILL_DOC_NAMES[0], docOutcome: null, assets: [], notBundled: [] }
      packages.set(rootDir, p)
    }
    return p
  }
  const stats = { filesSkipped: 0, totalBytes: 0, largeFiles: 0 }
  let emittedCount = 0
  let counters = { dirsVisited: 0, filesSeen: 0 }
  let currentDir = root
  const progress = (): ScanEvent => ({
    type: 'progress',
    dirsVisited: counters.dirsVisited,
    filesSeen: counters.filesSeen,
    candidates: emittedCount,
    bytes: stats.totalBytes,
    currentDir: relOf(currentDir),
  })
  const emit = (row: ScanCandidate, realKey?: string): ScanEvent => {
    emittedCount++
    // Appended in place: rebuilding the array here is quadratic in the number of
    // units one container expands to (M4).
    if (realKey) {
      const ids = rowIdsByRealFile.get(realKey)
      if (ids) ids.push(row.id)
      else rowIdsByRealFile.set(realKey, [row.id])
    }
    return { type: 'candidate', candidate: row }
  }
  const skipRow = (
    rel: string,
    bytes: number,
    reason: string,
    code: string,
    title?: string,
    extra: Partial<ScanCandidate> = {},
    realKey?: string,
  ): ScanEvent => {
    stats.filesSkipped++
    return emit(noiseRow(rel, bytes, reason, code, title, extra), realKey)
  }
  /** An alias path for a row: patched in place while the row is still buffered, an event once it has been yielded. */
  function* addPath(id: string, path: string): Generator<ScanEvent> {
    const buffered = bufferedDocs.get(id)
    if (buffered) {
      addPathTo(buffered, path)
      return
    }
    yield { type: 'candidate-patch', id, addPath: path }
  }
  /** Identical bytes at two real files: one candidate, the other a visible duplicate row (inline, the moment the row is complete). */
  function* placed(row: ScanCandidate, identity: string, realKey: string): Generator<ScanEvent> {
    const first = firstByIdentity.get(identity)
    if (!first) {
      firstByIdentity.set(identity, { id: row.id, relativePath: row.relativePath, realKey })
      yield emit(row, realKey)
      return
    }
    // Several units of one container share the file and its hash — not duplicates.
    if (first.realKey === realKey) {
      yield emit(row, realKey)
      return
    }
    yield* addPath(first.id, row.relativePath)
    // A later alias of THIS real file must reach the survivor, which is the row
    // that carries every path — not the row that just lost the comparison (M1).
    const ids = rowIdsByRealFile.get(realKey) ?? []
    if (!ids.includes(first.id)) ids.push(first.id)
    rowIdsByRealFile.set(realKey, ids)
    yield skipRow(row.relativePath, row.bytes, `Duplicate content of ${first.relativePath}`, 'duplicate-content', row.title, {
      sourcePath: row.sourcePath,
      sha256: row.sha256,
      adapterId: row.adapterId,
      mtime: row.mtime,
      birthtime: row.birthtime,
      // Which unit of the container this row is: without it a duplicated
      // container yields N rows nothing can tell apart (M3).
      ...(row.unit ? { unit: row.unit } : {}),
      ...(row.classifiedPath ? { classifiedPath: row.classifiedPath } : {}),
    })
  }
  /** Bytes for classification: containers and small text whole; large text streamed, with a progress event between chunk groups. */
  function* hashed(full: string, large: boolean, isContainer: boolean): Generator<ScanEvent, HashedFile> {
    if (isContainer || !large) {
      try {
        const raw = readFileSync(full)
        return { ok: true, raw, head: raw, sha256: createHash('sha256').update(raw).digest('hex') }
      } catch (err) {
        return { ok: false, error: errnoOf(err) }
      }
    }
    const h = hashStreamed(full, HEAD_CHARS * 4)
    try {
      let n = h.next()
      while (!n.done) {
        yield progress()
        n = h.next()
      }
      return { ok: true, raw: null, ...n.value }
    } catch (err) {
      // `openSync` refused, or a read failed part way through: the fd is closed
      // by `hashStreamed`'s own `finally` and the file becomes a row.
      return { ok: false, error: errnoOf(err) }
    }
  }
  /**
   * The nearest ancestor of `dir` (itself included) whose listing holds a skill
   * document, searched no higher than the scan root. Cached per scan, and asked
   * only about a file reached through a symlink, so an ordinary walk pays nothing.
   */
  const skillDirCache = new Map<string, string | null>()
  const nearestSkillDir = (dir: string): string | null => {
    if (!underRoot(dir)) return null
    const cached = skillDirCache.get(dir)
    if (cached !== undefined) return cached
    let found: string | null = null
    if (SKILL_DOC_NAMES.some((n) => existsSync(join(dir, n)))) found = dir
    else {
      const parent = dirname(dir)
      found = parent === dir ? null : nearestSkillDir(parent)
    }
    skillDirCache.set(dir, found)
    return found
  }

  const gen = walkTree(root, { followSymlinks })
  let next = gen.next()
  while (!next.done) {
    const e = next.value
    switch (e.type) {
      case 'tick':
        counters = { dirsVisited: e.dirsVisited, filesSeen: e.filesSeen }
        yield progress()
        break
      case 'directory':
        currentDir = e.path
        yield {
          type: 'dir',
          row: {
            path: relOf(e.path),
            parent: e.parent ? relOf(e.parent) : null,
            name: basename(e.path),
            depth: e.depth,
            skippedClass: null,
            fileCount: e.fileCount,
            aliasOf: null,
          },
        }
        break
      case 'directory-alias': {
        const firstRel = relOf(e.firstPath)
        const aliasRel = relOf(e.path)
        yield {
          type: 'dir',
          row: {
            path: aliasRel,
            parent: relOf(dirname(e.path)),
            name: basename(e.path),
            depth: aliasRel.split('/').length,
            skippedClass: null,
            fileCount: 0,
            aliasOf: firstRel,
          },
        }
        dirAliasPairs.push([firstRel, aliasRel])
        break
      }
      case 'directory-skipped': {
        const rel = relOf(e.path)
        yield {
          type: 'dir',
          row: {
            path: rel,
            parent: relOf(e.parent),
            name: basename(e.path),
            depth: e.depth,
            skippedClass: e.cls,
            fileCount: e.files,
            aliasOf: null,
          },
        }
        yield skipRow(
          rel,
          0,
          `${e.cls}: ${e.files} files in ${e.dirs} folders — not descended`,
          `directory-skipped:${e.cls}`,
          basename(e.path),
          {
            directory: { class: e.cls, files: e.files, dirs: e.dirs, unreadable: e.unreadable },
            sourcePath: e.path,
            ...marks(rel),
          },
        )
        break
      }
      case 'directory-unreadable':
        yield skipRow(relOf(e.path), 0, `Unreadable (${e.error})`, 'unreadable', undefined, {
          sourcePath: e.path,
          ...marks(relOf(e.path)),
        })
        break
      case 'symlink-broken':
        yield skipRow(relOf(e.path), 0, `Broken symlink → ${e.target}`, 'unreadable', undefined, {
          sourcePath: e.path,
          ...marks(relOf(e.path)),
        })
        break
      case 'symlink-unfollowed':
        yield skipRow(
          relOf(e.path),
          0,
          'Symlink inside an upload — not followed',
          'symlink-upload',
          undefined,
          marks(relOf(e.path)),
        )
        break
      case 'file-alias': {
        const buffered = bufferedByRealFile.get(e.realPath)
        const ids = rowIdsByRealFile.get(e.realPath) ?? []
        for (const id of buffered ? [buffered, ...ids] : ids) yield* addPath(id, relOf(e.path))
        break
      }
      case 'file':
        yield* fileRows(e)
        break
      case 'skill-package-done':
        yield* closePackage(pkgKey(e.root))
        break
    }
    next = gen.next()
  }
  const summary = next.value
  // Never reached after a complete walk; a guard, not a pass.
  for (const rootDir of [...packages.keys()]) yield* closePackage(rootDir)
  // Directory aliases: every row at or under the first path is also at the alias
  // path. Rows may be flushed already — the consumer applies it.
  for (const [realRel, aliasRel] of dirAliasPairs) yield { type: 'dir-alias', realRel, aliasRel }

  const dirsSkippedTotal = Object.values(summary.dirsSkipped).reduce((a, b) => a + b, 0)
  const scanMs = Math.round(performance.now() - started)
  const warnings: ScanWarning[] = []
  if (resolve(root) === resolve(homedir())) {
    warnings.push({
      code: 'home-root-mapped',
      params: { dirsVisited: summary.dirsVisited, skipped: dirsSkippedTotal },
      message: `Every folder under the home directory was mapped; ${dirsSkippedTotal} folders of excluded classes are listed as rows`,
    })
  }
  if (dirsSkippedTotal > 0) {
    const detail = Object.entries(summary.dirsSkipped)
      .filter(([, n]) => n > 0)
      .map(([c, n]) => `${n} ${c}`)
      .join(', ')
    warnings.push({
      code: 'directories-skipped',
      params: { count: dirsSkippedTotal, detail },
      message: `${dirsSkippedTotal} folders were listed as one row each and not entered: ${detail}`,
    })
  }
  if (stats.largeFiles > 0) {
    warnings.push({
      code: 'large-files',
      params: { count: stats.largeFiles },
      message: `${stats.largeFiles} files are larger than usual — imported whole, marked`,
    })
  }
  if (stats.filesSkipped > 0) {
    warnings.push({
      code: 'rows-passed-over',
      params: { count: stats.filesSkipped },
      message: `${stats.filesSkipped} files are listed as not importable (binary, duplicate, app state, unreadable) — each with its reason`,
    })
  }
  if (summary.symlinkCycles > 0) {
    warnings.push({
      code: 'symlink-cycles',
      params: { count: summary.symlinkCycles },
      message: `${summary.symlinkCycles} symlink loops were detected and not re-entered`,
    })
  }
  if (summary.unreadable > 0) {
    warnings.push({
      code: 'unreadable',
      params: { count: summary.unreadable },
      message: `${summary.unreadable} folders or files could not be read`,
    })
  }

  yield {
    type: 'done',
    result: {
      scanId: opts.scanId ?? generateId(),
      sourceProfile: opts.sourceProfile,
      detectedProfile: detected,
      rootPath: root,
      instructions: null,
      stats: {
        filesScanned: summary.filesSeen,
        filesSkipped: stats.filesSkipped,
        totalBytes: stats.totalBytes,
        dirsVisited: summary.dirsVisited,
        dirsSkipped: summary.dirsSkipped,
        filesInSkippedDirs: summary.filesInSkippedDirs,
        symlinksFollowed: summary.symlinksFollowed,
        symlinkAliases: summary.symlinkAliases,
        symlinkCycles: summary.symlinkCycles,
        unreadable: summary.unreadable,
        largeFiles: stats.largeFiles,
        ...(summary.datalessUnverified > 0 ? { datalessUnverified: summary.datalessUnverified } : {}),
        scanMs,
      },
      warnings,
    },
  }

  // ── a skill package is complete: its document leaves the buffer with every asset attached ──
  function* closePackage(rootDir: string): Generator<ScanEvent> {
    const pkg = packages.get(rootDir)
    packages.delete(rootDir)
    if (!pkg) return
    const docRel = relOf(join(rootDir, pkg.docName))
    function* orphans(why: string): Generator<ScanEvent> {
      for (const a of pkg!.assets) {
        const assetFull = join(rootDir, ...a.relPath.split('/'))
        const assetRel = relOf(assetFull)
        yield skipRow(
          assetRel,
          a.bytes,
          `Bundled with ${docRel}, which did not become a skill: ${why}`,
          'orphan-asset',
          undefined,
          { sha256: a.sha256, sourcePath: assetFull, ...marks(assetRel) },
          safeRealpath(assetFull) ?? undefined,
        )
      }
    }
    const doc = pkg.doc
    if (!doc) {
      yield* orphans(pkg.docOutcome ?? 'it was not listed')
      return
    }
    bufferedDocs.delete(doc.id)
    bufferedByRealFile.delete(pkg.docRealKey)
    const assets = [...pkg.assets].sort(byPathBytes)
    if (assets.length) {
      doc.assets = assets
      doc.reason = `${doc.reason} (+${assets.length} bundled files)`
      if (assets.some((a) => a.containsSecrets)) {
        doc.tags = [...new Set([...(doc.tags ?? []), 'contains-secrets'])]
      }
    }
    if (pkg.notBundled.length) {
      doc.notBundled = [...pkg.notBundled].sort(byPathBytes)
      doc.reason = `${doc.reason} (${pkg.notBundled.length} not bundled)`
    }
    const identity = skillIdentity(doc.sha256!, assets)
    const first = firstByIdentity.get(identity)
    yield* placed(doc, identity, pkg.docRealKey)
    if (first && first.realKey !== pkg.docRealKey) yield* orphans(`Duplicate content of ${first.relativePath}`)
  }

  // ── per-file rows ─────────────────────────────────────────────────────
  function* fileRows(e: Extract<WalkEntry, { type: 'file' }>): Generator<ScanEvent> {
    const full = e.path
    const rel = relOf(full)
    const name = basename(full)
    // The walker names the package of the path the file was REACHED at. A
    // symlink reached shallower than the package would otherwise pull the
    // document — or an asset — out of it and leave no skill row at all, so
    // membership is decided on the REAL path when the two differ (I2).
    const realDir = dirname(e.realPath)
    /** The package directory as this file reaches it — the walker's answer, or the real one for an alias into a package. */
    const skillBase = e.skillRoot ?? (e.realPath === full ? null : nearestSkillDir(realDir))
    /** The path package membership is measured from: the reached one inside a package, the real one for an alias into it. */
    const memberPath = e.skillRoot === null && skillBase !== null ? e.realPath : full
    const memberName = basename(memberPath)
    // One buffer per REAL package directory, so a package reached by two names
    // is one package and `skill-package-done` finds the buffer the alias filled.
    const pkgRoot = skillBase ? pkgKey(skillBase) : null
    const pkg = pkgRoot ? packageOf(pkgRoot) : null
    const isDoc = pkg !== null && memberName.toLowerCase() === 'skill.md' && dirname(memberPath) === skillBase
    // A package member reached through a symlink is classified by the path it
    // really lives at, or the document would arrive as a plain note and take the
    // whole package down with it. The row keeps its own path; `classifiedPath`
    // carries what the classifier saw, so apply time reads it the same way.
    const classifyRel = marked(memberPath === full ? rel : relOf(memberPath))
    const shared = (extra: Partial<ScanCandidate> = {}): Partial<ScanCandidate> => ({
      // The REAL member path for a file reached through an alias into a package:
      // the asset descriptors are relative to the real package directory, and
      // apply resolves them against `dirname(sourcePath)`. Reached-path bases
      // would make every bundled file miss (N1). The alias stays in `paths`.
      sourcePath: memberPath,
      mtime: e.mtime,
      birthtime: e.birthtime,
      ...(classifyRel === rel ? {} : { classifiedPath: classifyRel }),
      ...extra,
    })
    /** A SKILL.md that becomes something other than a skill row: the package's assets become orphans, and they say why. */
    const docIs = (why: string): void => {
      if (isDoc && pkg) pkg.docOutcome = why
    }
    if (isDoc && pkg) pkg.docName = memberName

    if (e.size <= 0) {
      docIs('Empty file')
      yield skipRow(rel, 0, 'Empty file', 'empty', undefined, shared(), e.realPath)
      return
    }

    // Package assets: every file under a skill root except the root's own
    // SKILL.md and the compiled artefacts a package never ships. Hashed,
    // sniffed, flagged for secrets, never dropped for size or secrets, never a
    // row of their own — they ride on the document at `skill-package-done`. A
    // binary asset (an image, a font) IS part of the package and is copied
    // verbatim at apply, so the name gate below does not apply inside a package.
    if (pkg && skillBase && !isDoc && !SKILL_ASSET_JUNK.test(memberName.toLowerCase())) {
      // A-66, and the reason the file-level check below is not enough on its
      // own: this branch READS, and it runs first. A bundled file whose bytes
      // are not on the machine would be fetched here — the very download the
      // check exists to prevent, one level down.
      //
      // A-73: it gets its OWN row, emitted right here, and is ALSO named on the
      // package. Recording it only on the package was a disappearance: the
      // package's `notBundled` list reaches the owner through the document row,
      // and on the two paths where the document never becomes the skill row —
      // an unreadable SKILL.md, a duplicate package — `orphans()` walks
      // `pkg.assets` and this file is not in it, so it had no row anywhere and
      // was not even counted. Emitting during the walk covers all three paths by
      // construction. It is still built from `stat` alone, so nothing is fetched.
      //
      // The row is the same shape a placeholder gets OUTSIDE a package: whether
      // a file can be ticked must not depend on which directory it sits in.
      if (e.dataless) {
        pkg.notBundled.push({
          relPath: toPosix(relative(skillBase, memberPath)),
          bytes: e.size,
          reason: 'stored in the cloud, not on this machine',
          // A-74: a FLAG, not a phrase to parse. The renderer must not have to
          // read prose to tell a clipped copy from a file that was never here.
          notDownloaded: true,
        })
        yield emit(notDownloadedRow(rel, e.size, shared()), e.realPath)
        return
      }
      // Counted like any other large file; nothing is refused for its size.
      const largeAsset = e.size > LARGE_TEXT_WARN_BYTES
      const asset = yield* hashed(full, largeAsset, false)
      if (!asset.ok) {
        yield skipRow(rel, e.size, `Unreadable (${asset.error})`, 'unreadable', undefined, shared(), e.realPath)
        return
      }
      stats.totalBytes += e.size
      if (largeAsset) stats.largeFiles++
      const binary = asset.head.subarray(0, SNIFF_BYTES).includes(0)
      const flagged = !binary && looksLikeSecrets(rel, asset.head.toString('utf-8'))
      pkg.assets.push({
        relPath: toPosix(relative(skillBase, memberPath)),
        bytes: e.size,
        sha256: asset.sha256,
        binary,
        ...(flagged ? { containsSecrets: true } : {}),
      })
      return
    }

    const cls = nameClass(name)
    // Rows the NAME already settles: listed from stat, NEVER read (R11.2/R11.3).
    // Everything else — `.obsidian/**` included — is text and is read.
    if (cls === 'binary' || cls === 'derived-db' || cls === 'app-state') {
      const code = cls === 'app-state' ? 'app-state' : cls === 'derived-db' ? 'derived-index' : 'binary'
      const reason =
        code === 'app-state'
          ? 'Application state — not a note'
          : code === 'derived-index'
            ? 'Derived index / database file — not importable text'
            : 'Binary file — no text to import'
      docIs(reason)
      yield skipRow(rel, e.size, reason, code, undefined, shared(), e.realPath)
      return
    }

    /*
     * A-66 / I-3. The bytes are not on this machine, so reading even the head
     * would make the provider fetch the whole file — a scan of a home directory
     * pulled 9.7 GB that way.
     *
     * IMPORTABLE, and unticked: the same shape source code and config rows have
     * under A-57. Nothing is refused — tick it and the importer reads it, which
     * downloads the file because the owner asked for it. A NOISE row would have
     * been the wrong disposition on a wave whose promise is that nothing is left
     * out: the zero-blocks signal is a macOS-verified proxy, and on a filesystem
     * where a compressed or network-hosted local file also reports no blocks,
     * an unticked row costs a click while a noise row would cost the file.
     *
     * It sits BELOW the name-decided classes on purpose: a placeholder image is
     * still a binary, and those branches never read either.
     */
    if (e.dataless) {
      const row = notDownloadedRow(rel, e.size, shared())
      docIs(row.reason)
      yield emit(row, e.realPath)
      return
    }

    const isContainer = CONTAINER_EXT.test(rel)
    const threshold = isContainer ? LARGE_CONTAINER_WARN_BYTES : LARGE_TEXT_WARN_BYTES
    const large = e.size > threshold

    // Bytes: containers whole (the adapter's expand takes a Buffer); text under
    // the threshold whole; larger text streamed with a head for classification.
    const bytes = yield* hashed(full, large, isContainer)
    if (!bytes.ok) {
      // The one file the process cannot open must not end the walk: it is a row
      // with its errno, and the scan carries on (C1).
      docIs(`Unreadable (${bytes.error})`)
      yield skipRow(rel, e.size, `Unreadable (${bytes.error})`, 'unreadable', undefined, shared(), e.realPath)
      return
    }
    stats.totalBytes += e.size
    if (large) stats.largeFiles++
    const { raw, head, sha256 } = bytes
    const warnings: CandidateWarning[] = large ? ['large-file'] : []
    if (!raw) warnings.push('secrets-scan-head-only')
    const binary = head.subarray(0, SNIFF_BYTES).includes(0)
    if (binary) {
      docIs('Binary file — no text to import')
      yield skipRow(rel, e.size, 'Binary file — no text to import', 'binary', undefined, shared({ sha256 }), e.realPath)
      return
    }
    const headText = head.subarray(0, HEAD_CHARS * 4).toString('utf-8').slice(0, HEAD_CHARS)
    const { hint, adapterId } = classifyFile(classifyRel, headText, detected, { inVault: e.inVault })
    const base = shared({ sha256, adapterId, ...(warnings.length ? { warnings } : {}) })

    if (hint.kind === 'noise') {
      docIs(hint.reason)
      yield skipRow(rel, e.size, hint.reason, hint.reasonCode, titleFromPathAndContent(rel, headText), base, e.realPath)
      return
    }

    const units = raw ? adapterFor(adapterId).expand?.(classifyRel, raw, full, { withContent: false }) : undefined
    const expanded = units && units.length ? units : null
    // A key inside one conversation flags THAT unit, not the whole export
    // (A-16): for a file that expands, the rendered unit decides, and only the
    // path-shaped verdict (`credentials.json`, `id_rsa`) stays on the file.
    // Everything else is scanned over the bytes in hand — the whole file when it
    // was read whole, its head when it was streamed (warned above, recomputed at
    // apply time, A-8).
    const fileTags = new Set<string>(hint.tags ?? [])
    if (expanded) {
      fileTags.delete('contains-secrets')
      if (looksLikeSecrets(rel, '')) fileTags.add('contains-secrets')
    } else if (raw && !isContainer && looksLikeSecrets(rel, raw.toString('utf-8'))) {
      fileTags.add('contains-secrets')
    }

    if (expanded) {
      for (const u of expanded) {
        const tags = new Set([...fileTags, ...(u.tags ?? [])])
        if (u.hint.kind === 'noise') {
          yield skipRow(rel, u.bytes, u.hint.reason, u.hint.reasonCode, u.title, { ...base, unit: u.unit }, e.realPath)
          continue
        }
        if (u.content && looksLikeSecrets(rel, u.content)) tags.add('contains-secrets')
        const row: ScanCandidate = {
          id: generateId(),
          relativePath: rel,
          kind: u.hint.kind,
          target: u.hint.target,
          title: u.title,
          preview: u.preview,
          bytes: u.bytes,
          confidence: u.hint.confidence,
          reason: u.hint.reason,
          reasonCode: u.hint.reasonCode,
          selectedByDefault: u.hint.selectedByDefault && u.hint.target !== 'none',
          ...(u.hint.scope ? { scope: u.hint.scope } : {}),
          unit: u.unit,
          turns: u.turns ?? null,
          sessionId: u.sessionId ?? null,
          sessionDate: u.sessionDate ?? null,
          ...(tags.size ? { tags: [...tags] } : {}),
          ...base,
        }
        yield* placed(row, sha256, e.realPath)
      }
      return
    }
    const row: ScanCandidate = {
      id: generateId(),
      relativePath: rel,
      kind: hint.kind,
      target: hint.target,
      title: titleFromPathAndContent(rel, headText),
      preview: previewOf(headText),
      bytes: e.size,
      confidence: hint.confidence,
      reason: hint.reason,
      reasonCode: hint.reasonCode,
      selectedByDefault: hint.selectedByDefault && hint.target !== 'none',
      // The scope the source declared (Cursor globs, Copilot applyTo) travels to
      // the proposal title, so an approver sees what the rules apply to (I8).
      ...(hint.scope ? { scope: hint.scope } : {}),
      unit: null,
      ...(fileTags.size ? { tags: [...fileTags] } : {}),
      ...base,
    }
    if (isDoc && hint.kind === 'skill') {
      // Held until `skill-package-done`: emitted then with its assets, tags and
      // identity (whatever order readdir listed the package in).
      pkg!.doc = row
      pkg!.docRealKey = e.realPath
      bufferedDocs.set(row.id, row)
      bufferedByRealFile.set(e.realPath, row.id)
      return
    }
    if (isDoc) docIs(`it was listed as ${hint.kind}, not a skill`)
    yield* placed(row, sha256, e.realPath)
  }
}

/**
 * Collects the stream and applies its patches; yields to the event loop on every
 * progress event so a home walk never freezes the server. The `dir-alias` loop
 * over the collected rows is the collect path only (uploads, tests) — the table
 * path applies it in SQL (Task 9).
 */
export async function scanDirectory(opts: {
  rootPath: string
  sourceProfile: SourceProfile
  /** Uploads never follow symlinks: an archive can point anywhere on the host. */
  followSymlinks?: boolean
  onProgress?: (p: { dirs: number; files: number; rows: number; elapsedMs: number }) => void
}): Promise<ScanResult> {
  const started = Date.now()
  const candidates: ScanCandidate[] = []
  const byId = new Map<string, ScanCandidate>()
  const dirs: ScanDirRow[] = []
  for (const ev of scanDirectoryEvents(opts)) {
    if (ev.type === 'candidate') {
      candidates.push(ev.candidate)
      byId.set(ev.candidate.id, ev.candidate)
    } else if (ev.type === 'candidate-patch') {
      const row = byId.get(ev.id)
      if (row) addPathTo(row, ev.addPath)
    } else if (ev.type === 'dir-alias') {
      for (const row of candidates) {
        const under =
          ev.realRel === '.' || row.relativePath === ev.realRel || row.relativePath.startsWith(`${ev.realRel}/`)
        if (under) {
          addPathTo(
            row,
            ev.realRel === '.'
              ? `${ev.aliasRel}/${row.relativePath}`
              : `${ev.aliasRel}${row.relativePath.slice(ev.realRel.length)}`,
          )
        }
      }
    } else if (ev.type === 'dir') {
      dirs.push(ev.row)
    } else if (ev.type === 'progress') {
      opts.onProgress?.({ dirs: ev.dirsVisited, files: ev.filesSeen, rows: ev.candidates, elapsedMs: Date.now() - started })
      await new Promise<void>((r) => setImmediate(r))
    } else {
      return { ...ev.result, candidates, dirs }
    }
  }
  throw new Error('scan ended without a done event')
}
