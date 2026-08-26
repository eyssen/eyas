// Part of eYssen. See LICENSE file for full copyright and licensing details.

import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  lstatSync,
} from 'node:fs'
import { join, relative, resolve, sep, basename } from 'node:path'
import { generateId } from '@shared/crypto'
import { MAX_CHUNK_CHARS, MAX_FILE_BYTES, MAX_SCAN_FILES } from '../constants.js'
import type { ScanCandidate, ScanResult, SourceProfile } from '../types.js'
import {
  classifyPath,
  detectProfileFromPaths,
  previewOf,
  titleFromPathAndContent,
} from './heuristics.js'

/** Dot-directories that commonly hold AI memory / skills / rules. */
const ALLOWED_DOT_DIRS = new Set([
  '.claude',
  '.grok',
  '.agents',
  '.cursor',
  '.codex',
  '.obsidian',
  '.cursorrules',
])

/** Always skip these directory names (anywhere). */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'vendor',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  'target',
  '.next',
  '.turbo',
  'Library',
  'Applications',
  'Movies',
  'Music',
  'Pictures',
  'Downloads', // huge; user can point here explicitly if needed
])

/**
 * Known AI cache/session dump dirs — never useful for import.
 * Applied even when scan root *is* ~/.claude.
 */
const SKIP_UNDER_AI_DOT = new Set([
  'projects',
  'file-history',
  'paste-cache',
  'security',
  'cache',
  'backups',
  'debug',
  'chrome',
  'ide',
  'ops-archive',
  'downloads',
  'bin',
  'bundled',
  'completions',
  'marketplace-cache',
  'marketplaces',
  'plugins',
  'sessions',
  'session-stats',
  'shell-snapshots',
  'statsig',
  'todos',
  'telemetry',
  'stats',
  'logs',
  'tasks',
])

/** Path segments that indicate high-value import content. */
const PRIORITY_NAME_RE =
  /^(ai-memory|claude-sessions|skills|memory|agents|semantic|procedural|99_Meta|SKILL\.md|MEMORY\.md|CLAUDE\.md|AGENTS\.md)$/i

const PRIORITY_PATH_RE =
  /(ai-memory|claude-sessions|\/skills\/|\/memory\/|99_Meta|SKILL\.md|MEMORY\.md|CLAUDE\.md)/i

/** Primary import formats — exclude .json/.jsonl dumps. */
const TEXT_EXTS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.toml'])

/** Soft cap on directories enqueued — prevents home-directory freezes. */
const MAX_DIRS_TO_VISIT = 8_000

function isUnderRoot(root: string, candidate: string): boolean {
  const r = resolve(root)
  const c = resolve(candidate)
  return c === r || c.startsWith(r + sep)
}

function isTextyName(name: string): boolean {
  const lower = name.toLowerCase()
  if (
    lower === 'claude.md' ||
    lower === 'agents.md' ||
    lower === 'skill.md' ||
    lower === 'memory.md' ||
    lower === 'soul.md' ||
    lower === 'identity.md' ||
    lower === 'tools.md' ||
    lower === '.cursorrules'
  ) {
    return true
  }
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.jsonl') ||
    lower.endsWith('.lock') ||
    lower.includes('security_warnings') ||
    (lower.startsWith('.') && lower !== '.cursorrules')
  ) {
    return false
  }
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTS.has(lower.slice(dot))
}

export function priorityScore(relPath: string): number {
  const p = relPath.replace(/\\/g, '/').toLowerCase()
  let score = 0
  if (p.includes('ai-memory') || p.includes('claude-sessions')) score += 25
  if (p.endsWith('skill.md') || p.includes('/skills/')) score += 20
  if (p.includes('/memory/') || p.endsWith('memory.md')) score += 15
  if (p.includes('99_meta')) score += 10
  if (p.endsWith('.md')) score += 2
  return score
}

function isPriorityName(name: string): boolean {
  return PRIORITY_NAME_RE.test(name)
}

function shouldSkipDir(name: string): boolean {
  if (SKIP_DIR_NAMES.has(name)) return true
  if (SKIP_UNDER_AI_DOT.has(name)) return true
  if (name.startsWith('.')) {
    if (name === '.cursorrules') return false
    if (!ALLOWED_DOT_DIRS.has(name)) return true
  }
  if (name === '.obsidian' || name === '.trash') return true
  return false
}

/**
 * Walk a directory tree, following symlinks once (realpath de-dupe).
 *
 * Performance notes:
 * - Two queues (priority / normal) — O(1) dequeue, no full-queue sort.
 * - Set-based de-dupe for realpaths (not array.includes).
 * - Soft cap on directories visited so scanning $HOME cannot freeze the server.
 */
export function walkFiles(root: string, maxFiles: number): string[] {
  const rootResolved = resolve(root)
  const visitedDirs = new Set<string>()
  const seenFiles = new Set<string>()
  const collected: string[] = []

  // Priority dirs first (ai-memory, skills, …), then the rest.
  const priorityQueue: string[] = [rootResolved]
  const normalQueue: string[] = []
  let dirsVisited = 0

  const takeNext = (): string | undefined => priorityQueue.shift() ?? normalQueue.shift()

  while ((priorityQueue.length > 0 || normalQueue.length > 0) && collected.length < maxFiles) {
    if (dirsVisited >= MAX_DIRS_TO_VISIT) break
    const dir = takeNext()
    if (!dir) break
    dirsVisited++

    let realDir: string
    try {
      realDir = realpathSync(dir)
    } catch {
      continue
    }
    if (visitedDirs.has(realDir)) continue
    visitedDirs.add(realDir)

    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    // Partition: priority-named entries first (single pass, no full score sort)
    const dirsPri: string[] = []
    const dirsNorm: string[] = []
    const filesLocal: string[] = []

    for (const e of entries) {
      if (e.name === '.' || e.name === '..' || e.name === '.DS_Store') continue
      const full = join(dir, e.name)

      let isDir = false
      let isFileLike = false
      try {
        const lst = lstatSync(full)
        if (lst.isSymbolicLink()) {
          try {
            const st = statSync(full)
            isDir = st.isDirectory()
            isFileLike = st.isFile()
          } catch {
            continue
          }
        } else {
          isDir = lst.isDirectory()
          isFileLike = lst.isFile()
        }
      } catch {
        continue
      }

      if (isDir) {
        if (shouldSkipDir(e.name)) continue
        // Only follow symlink-dirs if the link itself is under root
        if (!isUnderRoot(rootResolved, full)) continue
        if (isPriorityName(e.name) || PRIORITY_PATH_RE.test(full)) {
          dirsPri.push(full)
        } else {
          dirsNorm.push(full)
        }
        continue
      }

      if (!isFileLike) continue
      if (!isTextyName(e.name)) continue
      filesLocal.push(full)
    }

    // Enqueue dirs: priority first
    for (const d of dirsPri) priorityQueue.push(d)
    for (const d of dirsNorm) normalQueue.push(d)

    // Collect files (priority-named first within this folder)
    filesLocal.sort((a, b) => {
      const an = isPriorityName(basename(a)) ? 1 : 0
      const bn = isPriorityName(basename(b)) ? 1 : 0
      return bn - an
    })

    for (const full of filesLocal) {
      if (collected.length >= maxFiles) break
      let key = full
      try {
        key = realpathSync(full)
      } catch {
        /* keep full */
      }
      if (seenFiles.has(key)) continue
      seenFiles.add(key)
      collected.push(full)
    }
  }

  // Final order: high-value first for UI / classification
  collected.sort((a, b) => {
    const sa = priorityScore(relative(rootResolved, a))
    const sb = priorityScore(relative(rootResolved, b))
    return sb - sa
  })

  return collected
}

export function scanDirectory(opts: {
  rootPath: string
  sourceProfile: SourceProfile
}): ScanResult {
  const root = resolve(opts.rootPath)
  if (!existsSync(root)) {
    throw new Error(`Path does not exist: ${root}`)
  }
  const st = statSync(root)
  if (!st.isDirectory()) {
    throw new Error(`Path is not a directory: ${root}`)
  }

  const files = walkFiles(root, MAX_SCAN_FILES)
  const relPaths = files.map((f) => relative(root, f))
  const rootBase = basename(root).toLowerCase()
  if (rootBase.includes('obsidian') || existsSync(join(root, '.obsidian'))) {
    relPaths.push('.obsidian/app.json')
  }
  const detected =
    opts.sourceProfile === 'auto' ? detectProfileFromPaths(relPaths) : opts.sourceProfile

  const candidates: ScanCandidate[] = []
  let filesSkipped = 0
  let totalBytes = 0
  const seenReal = new Set<string>()

  for (const full of files) {
    if (!isUnderRoot(root, full)) {
      filesSkipped++
      continue
    }

    let realKey = full
    try {
      realKey = realpathSync(full)
    } catch {
      /* keep */
    }
    if (seenReal.has(realKey)) {
      filesSkipped++
      continue
    }
    seenReal.add(realKey)

    let size = 0
    try {
      size = statSync(full).size
    } catch {
      filesSkipped++
      continue
    }
    if (size <= 0 || size > MAX_FILE_BYTES) {
      filesSkipped++
      continue
    }

    let content: string
    try {
      // Read at most MAX_CHUNK_CHARS + a small headroom for classification
      // (full 768KiB read of thousands of files blocked the HTTP thread).
      const buf = readFileSync(full)
      content = buf.subarray(0, Math.min(buf.length, MAX_CHUNK_CHARS + 512)).toString('utf-8')
    } catch {
      filesSkipped++
      continue
    }
    if (content.includes('\u0000')) {
      filesSkipped++
      continue
    }

    const rel = relative(root, full).replace(/\\/g, '/')
    if (rel.includes('.obsidian/')) continue

    const hint = classifyPath(rel, content)
    totalBytes += size
    if (hint.kind === 'noise' && hint.confidence >= 0.9) {
      filesSkipped++
      if (hint.reason.includes('secrets')) {
        candidates.push({
          id: generateId(),
          relativePath: rel,
          kind: 'noise',
          target: 'none',
          title: titleFromPathAndContent(rel, content),
          preview: hint.reason,
          bytes: size,
          confidence: hint.confidence,
          reason: hint.reason,
          selectedByDefault: false,
          content: undefined,
        })
      }
      continue
    }

    const clipped = content.length > MAX_CHUNK_CHARS ? content.slice(0, MAX_CHUNK_CHARS) : content
    candidates.push({
      id: generateId(),
      relativePath: rel,
      kind: hint.kind,
      target: hint.target,
      title: titleFromPathAndContent(rel, content),
      preview: previewOf(content),
      bytes: size,
      confidence: hint.confidence,
      reason: hint.reason,
      selectedByDefault: hint.selectedByDefault && hint.target !== 'none',
      content: clipped,
    })
  }

  const byKind: Record<string, number> = {}
  for (const c of candidates) {
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1
  }

  const hitFileCap = files.length >= MAX_SCAN_FILES

  return {
    scanId: generateId(),
    sourceProfile: opts.sourceProfile,
    detectedProfile: detected,
    rootPath: root,
    instructions: null,
    candidates,
    stats: {
      filesScanned: files.length,
      filesSkipped,
      totalBytes,
    },
    warnings: [
      ...(hitFileCap
        ? [
            `Scan capped at ${MAX_SCAN_FILES} files — high-value paths (ai-memory, skills, memory) are prioritized. Point the path at a smaller folder if something is still missing.`,
          ]
        : []),
      ...(candidates.filter((c) => c.kind === 'noise').length
        ? ['Some files were flagged as secrets/noise and will not be imported']
        : []),
      ...(Object.keys(byKind).length
        ? [
            `Found: ${Object.entries(byKind)
              .map(([k, n]) => `${n} ${k}`)
              .join(', ')}`,
          ]
        : []),
    ],
  }
}

// re-export for tests
export { shouldSkipDir }
