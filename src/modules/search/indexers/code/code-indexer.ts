// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdir, stat as fsStat, readFile } from 'fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'path'
import { generateId } from '@shared/crypto'
import { chunkCodeFallback, chunkCodeAST } from './ast-chunker.js'
import { getLanguageForExtension } from './language-map.js'
import type { Chunk, ContentIndexer, FileToIndex, SearchSource } from '@modules/search/types'

const DEFAULT_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'vendor', '.venv', 'coverage', '.cache', '.tox',
])

/** Extra excludes when config.family === 'odoo' (large noisy trees). */
const ODOO_DEFAULT_EXCLUDE = new Set(['i18n', 'static', 'doc', 'docs', 'fonts'])
const ODOO_DEFAULT_EXCLUDE_PATTERNS = ['*_demo.xml', '*_demo_*.xml']

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go', '.rs', '.java', '.rb', '.php', '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.swift', '.kt', '.scala',
  '.sh', '.sql', '.xml', '.json', '.yaml', '.yml', '.toml',
  '.html', '.css', '.vue', '.svelte',
])

const DEFAULT_MAX_FILE_SIZE = 256 * 1024
const DEFAULT_MAX_FILES = 10_000
const ODOO_MAX_FILES = 50_000

/** Markup / data files: one chunk per file. AST/regex adds nothing useful. */
const WHOLE_FILE_EXTENSIONS = new Set([
  '.xml', '.json', '.yaml', '.yml', '.html', '.css', '.sql', '.toml', '.sh',
])

function yieldLoop(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Sanitize a user-supplied root path to an absolute, resolved path.
 * Returns null if the path is clearly invalid.
 */
function sanitizeRootPath(p: string): string | null {
  if (!p || typeof p !== 'string') return null
  const abs = resolve(p)
  return abs
}

function matchPathPattern(relPath: string, pattern: string): boolean {
  // Dir-name match (legacy): pattern without slash/glob → any path segment
  if (!pattern.includes('/') && !pattern.includes('*')) {
    const parts = relPath.split(/[/\\]/)
    return parts.includes(pattern)
  }
  // Simple ** and * glob → regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/§§/g, '.*')
  try {
    return new RegExp(`^${escaped}$`, 'i').test(relPath) ||
      new RegExp(escaped, 'i').test(relPath)
  } catch {
    return false
  }
}

function isExcluded(relPath: string, excludePatterns: string[], excludeDirs: Set<string>): boolean {
  const parts = relPath.split(/[/\\]/)
  for (const part of parts) {
    if (excludeDirs.has(part)) return true
  }
  for (const pat of excludePatterns) {
    if (matchPathPattern(relPath, pat)) return true
  }
  // Skip .po bulk by default for odoo-ish trees
  if (relPath.endsWith('.po') || relPath.endsWith('.pot')) return true
  return false
}

function isIncluded(relPath: string, includePatterns: string[]): boolean {
  if (includePatterns.length === 0) return true
  return includePatterns.some((pat) => matchPathPattern(relPath, pat))
}

function inferModule(relPath: string): string | undefined {
  const norm = relPath.split(sep).join('/')
  const m = norm.match(/(?:^|\/)addons\/([^/]+)\//)
  if (m) return m[1]
  const parts = norm.split('/')
  if (parts.length >= 2 && (parts[1] === 'models' || parts[1] === 'views' || parts[1] === 'wizard')) {
    return parts[0]
  }
  return undefined
}

/**
 * Collect code files under a pre-sanitized absolute directory path (async).
 */
async function collectFiles(
  dir: string,
  rootPath: string,
  excludeDirs: Set<string>,
  excludePatterns: string[],
  includePatterns: string[],
  maxFiles: number,
  maxFileSize: number,
  results: string[] = [],
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return results
  }

  for (const entry of entries) {
    if (entry.includes('/') || entry.includes('\\') || entry === '..' || entry === '.') continue
    if (excludeDirs.has(entry)) continue
    if (results.length >= maxFiles) return results

    const fullPath = join(dir, entry)

    let entryStat
    try {
      entryStat = await fsStat(fullPath)
    } catch {
      continue
    }

    const relPath = relative(rootPath, fullPath)

    if (entryStat.isDirectory()) {
      if (isExcluded(relPath + '/', excludePatterns, excludeDirs)) continue
      await collectFiles(
        fullPath, rootPath, excludeDirs, excludePatterns, includePatterns,
        maxFiles, maxFileSize, results,
      )
    } else if (entryStat.isFile()) {
      if (isExcluded(relPath, excludePatterns, excludeDirs)) continue
      if (!isIncluded(relPath, includePatterns)) continue
      const ext = extname(entry).toLowerCase()
      if (CODE_EXTENSIONS.has(ext) && entryStat.size <= maxFileSize) {
        results.push(fullPath)
      }
    }

    if (results.length % 50 === 0) {
      await yieldLoop(0)
    }
  }

  return results
}

interface WalkOptions {
  excludeDirs: Set<string>
  excludePatterns: string[]
  includePatterns: string[]
  maxFiles: number
  maxFileSize: number
  multiRoot: boolean
}

function buildWalkOptions(source: SearchSource): WalkOptions {
  const userExclude = source.config.exclude ?? []
  const isOdoo = source.config.family === 'odoo'
  const excludeDirs = new Set([
    ...DEFAULT_EXCLUDE,
    ...(isOdoo ? ODOO_DEFAULT_EXCLUDE : []),
  ])
  const excludePatterns: string[] = source.config.family === 'odoo'
    ? [...ODOO_DEFAULT_EXCLUDE_PATTERNS]
    : []
  for (const e of userExclude) {
    if (!e.includes('/') && !e.includes('*')) excludeDirs.add(e)
    else excludePatterns.push(e)
  }
  return {
    excludeDirs,
    excludePatterns,
    includePatterns: source.config.include ?? [],
    maxFiles: source.config.maxFiles ?? (isOdoo ? ODOO_MAX_FILES : DEFAULT_MAX_FILES),
    maxFileSize: source.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    multiRoot: (source.config.paths ?? []).length > 1,
  }
}

function toRelPath(rootPath: string, absPath: string, multiRoot: boolean): string {
  const rel = relative(rootPath, absPath).split(sep).join('/')
  return multiRoot ? `${basename(rootPath)}/${rel}` : rel
}

/**
 * Walk configured roots and return files ready for incremental indexing.
 */
export async function collectCodeFiles(source: SearchSource): Promise<FileToIndex[]> {
  const opts = buildWalkOptions(source)
  const out: FileToIndex[] = []

  for (const rootPath of source.config.paths ?? []) {
    const sanitized = sanitizeRootPath(rootPath)
    if (!sanitized) continue
    const remaining = opts.maxFiles - out.length
    if (remaining <= 0) break
    const absFiles = await collectFiles(
      sanitized,
      sanitized,
      opts.excludeDirs,
      opts.excludePatterns,
      opts.includePatterns,
      remaining,
      opts.maxFileSize,
    )
    for (const absPath of absFiles) {
      let mtime = ''
      try {
        mtime = (await fsStat(absPath)).mtime.toISOString()
      } catch {
        continue
      }
      out.push({
        absPath,
        relPath: toRelPath(sanitized, absPath, opts.multiRoot),
        rootPath: sanitized,
        mtime,
      })
    }
    if (out.length % 100 === 0) await yieldLoop(0)
  }

  return out
}

/**
 * Chunk a single collected file. Returns [] if unreadable / binary.
 */
export async function chunkCodeFile(source: SearchSource, file: FileToIndex): Promise<Chunk[]> {
  const rootLabel =
    (typeof source.config.label === 'string' && source.config.label) ||
    source.name

  let content: string
  try {
    const buf = await readFile(file.absPath)
    if (buf.includes(0)) return []
    content = buf.toString('utf8')
  } catch {
    return []
  }

  const ext = extname(file.absPath).toLowerCase()
  const language = getLanguageForExtension(ext) ?? ext.slice(1)
  const moduleName = inferModule(file.relPath)
  const baseMeta = {
    filePath: file.relPath,
    language,
    rootLabel,
    module: moduleName,
    mtime: file.mtime,
  }

  let codeChunks: Array<{ content: string; lineStart: number; lineEnd: number; symbolName: string }>
  if (WHOLE_FILE_EXTENSIONS.has(ext)) {
    codeChunks = []
  } else {
    codeChunks =
      (await chunkCodeAST(content, file.relPath, language)) ??
      chunkCodeFallback(content, file.relPath, language)
  }

  if (codeChunks.length === 0) {
    return [{
      id: generateId(),
      sourceId: source.id,
      collection: 'code',
      content,
      metadata: {
        ...baseMeta,
        lineStart: 1,
        lineEnd: content.split('\n').length,
        symbolName: undefined,
      },
    }]
  }

  return codeChunks.map((c) => ({
    id: generateId(),
    sourceId: source.id,
    collection: 'code',
    content: c.content,
    metadata: {
      ...baseMeta,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
      symbolName: c.symbolName,
    },
  }))
}

export function createCodeIndexer(): ContentIndexer {
  return {
    name: 'code',

    supports(source: SearchSource): boolean {
      // Primary: type === 'code'. Also accept filesystem sources indexed as code
      // (legacy UI). Do not claim docs/files types even if indexer name matches.
      if (source.type === 'docs' || source.type === 'files') return false
      return source.type === 'code' || source.type === 'filesystem' || source.indexer === 'code'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const files = await collectCodeFiles(source)
      const chunks: Chunk[] = []
      for (let i = 0; i < files.length; i++) {
        if (i > 0 && i % 10 === 0) await yieldLoop(1)
        chunks.push(...await chunkCodeFile(source, files[i]))
      }
      return chunks
    },

    collectFiles: collectCodeFiles,
    indexFile: chunkCodeFile,
  }
}
