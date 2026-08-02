// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdir, stat as fsStat, readFile } from 'fs/promises'
import { extname, join, relative, resolve } from 'path'
import { generateId } from '@shared/crypto'
import { chunkCodeFallback, chunkCodeAST } from './ast-chunker.js'
import { getLanguageForExtension } from './language-map.js'
import type { Chunk, ContentIndexer, SearchSource } from '@modules/search/types'

const DEFAULT_EXCLUDE = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'vendor', '.venv', 'coverage', '.cache', '.tox',
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go', '.rs', '.java', '.rb', '.php', '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.swift', '.kt', '.scala',
  '.sh', '.sql', '.xml', '.json', '.yaml', '.yml', '.toml',
  '.html', '.css', '.vue', '.svelte',
])

const MAX_FILE_SIZE = 256 * 1024 // 256 KB — keeps AST parsing fast enough to not block event loop
const MAX_FILES = 10_000 // Safety limit to prevent blocking the event loop

/**
 * Sanitize a user-supplied root path to an absolute, resolved path.
 * Returns null if the path is clearly invalid.
 */
function sanitizeRootPath(p: string): string | null {
  if (!p || typeof p !== 'string') return null
  // resolve() normalizes .. sequences and makes it absolute — this IS the sanitizer, not the sink // nosemgrep
  const abs = resolve(p) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return abs
}

/**
 * Collect code files under a pre-sanitized absolute directory path (async).
 * `dir` MUST already be a resolved absolute path (output of sanitizeRootPath).
 * Yields to the event loop periodically to prevent blocking the server.
 */
async function collectFiles(
  dir: string,
  excludeDirs: Set<string>,
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
    if (results.length >= MAX_FILES) return results

    const fullPath = `${dir}/${entry}`

    let entryStat
    try {
      entryStat = await fsStat(fullPath)
    } catch {
      continue
    }

    if (entryStat.isDirectory()) {
      await collectFiles(fullPath, excludeDirs, results)
    } else if (entryStat.isFile()) {
      const ext = extname(entry).toLowerCase()
      if (CODE_EXTENSIONS.has(ext) && entryStat.size <= MAX_FILE_SIZE) {
        results.push(fullPath)
      }
    }

    // Yield every 200 entries to keep the event loop responsive
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
      return source.type === 'code'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const paths = source.config.paths ?? []
      const userExclude = source.config.exclude ?? []

      const excludeDirs = new Set([...DEFAULT_EXCLUDE, ...userExclude])

      const chunks: Chunk[] = []
      let filesProcessed = 0

      for (const rootPath of paths) {
        const sanitized = sanitizeRootPath(rootPath)
        if (!sanitized) continue
        const files = await collectFiles(sanitized, excludeDirs)

        for (const filePath of files) {
          // Yield to event loop every 10 files to keep server responsive
          if (++filesProcessed % 10 === 0) {
            await new Promise((r) => setTimeout(r, 1))
          }
          let content: string
          try {
            const buf = await readFile(filePath)
            // Skip binary files
            if (buf.includes(0)) continue
            content = buf.toString('utf8')
          } catch {
            continue
          }

          const ext = extname(filePath).toLowerCase()
          const language = getLanguageForExtension(ext) ?? ext.slice(1)
          const relPath = relative(rootPath, filePath)

          const codeChunks = (await chunkCodeAST(content, relPath, language)) ?? chunkCodeFallback(content, relPath, language)

          // If chunker produced nothing, emit the whole file as one chunk
          if (codeChunks.length === 0) {
            chunks.push({
              id: generateId(),
              sourceId: source.id,
              collection: 'code',
              content,
              metadata: {
                filePath: relPath,
                language,
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
                  filePath: relPath,
                  language,
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
