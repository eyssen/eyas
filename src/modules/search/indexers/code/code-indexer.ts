// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdir, stat as fsStat, readFile } from 'fs/promises'
import { extname, join, relative, resolve, sep } from 'path'
import { generateId } from '@shared/crypto'
import { chunkCodeFallback, chunkCodeAST } from './ast-chunker.js'
import { getLanguageForExtension } from './language-map.js'
import type { Chunk, ContentIndexer, SearchSource } from '@modules/search/types'

const DEFAULT_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'vendor', '.venv', 'coverage', '.cache', '.tox',
])

/** Extra excludes when config.family === 'odoo' (large noisy trees). */
const ODOO_DEFAULT_EXCLUDE = new Set(['i18n', 'static', 'doc', 'docs', 'fonts'])

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

    if (results.length % 200 === 0) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  return results
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
      const paths = source.config.paths ?? []
      const userExclude = source.config.exclude ?? []
      const includePatterns = source.config.include ?? []
      const isOdoo = source.config.family === 'odoo'

      const excludeDirs = new Set([
        ...DEFAULT_EXCLUDE,
        ...(isOdoo ? ODOO_DEFAULT_EXCLUDE : []),
      ])
      // Dir-name style excludes go into excludeDirs; globs stay as patterns
      const excludePatterns: string[] = []
      for (const e of userExclude) {
        if (!e.includes('/') && !e.includes('*')) excludeDirs.add(e)
        else excludePatterns.push(e)
      }

      const maxFiles = source.config.maxFiles
        ?? (isOdoo ? ODOO_MAX_FILES : DEFAULT_MAX_FILES)
      const maxFileSize = source.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE
      const rootLabel =
        (typeof source.config.label === 'string' && source.config.label) ||
        source.name

      const chunks: Chunk[] = []
      let filesProcessed = 0

      for (const rootPath of paths) {
        const sanitized = sanitizeRootPath(rootPath)
        if (!sanitized) continue
        const files = await collectFiles(
          sanitized,
          sanitized,
          excludeDirs,
          excludePatterns,
          includePatterns,
          maxFiles,
          maxFileSize,
        )

        for (const filePath of files) {
          if (++filesProcessed % 10 === 0) {
            await new Promise((r) => setTimeout(r, 1))
          }
          let content: string
          let mtime = ''
          try {
            const st = await fsStat(filePath)
            mtime = st.mtime.toISOString()
            const buf = await readFile(filePath)
            if (buf.includes(0)) continue
            content = buf.toString('utf8')
          } catch {
            continue
          }

          const ext = extname(filePath).toLowerCase()
          const language = getLanguageForExtension(ext) ?? ext.slice(1)
          const relPath = relative(sanitized, filePath).split(sep).join('/')
          const moduleName = inferModule(relPath)

          const codeChunks =
            (await chunkCodeAST(content, relPath, language)) ??
            chunkCodeFallback(content, relPath, language)

          const baseMeta = {
            filePath: relPath,
            language,
            rootLabel,
            module: moduleName,
            mtime,
          }

          if (codeChunks.length === 0) {
            chunks.push({
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
            })
          } else {
            for (const c of codeChunks) {
              chunks.push({
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
              })
            }
          }
        }
      }

      return chunks
    },
  }
}
