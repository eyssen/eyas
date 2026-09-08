// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdirSync, readFileSync, statSync } from 'fs'
import { extname, resolve } from 'path'
import { generateId } from '@shared/crypto'
import { chunkMarkdown } from '../docs/file-reader.js'
import { parsePdf } from './parsers/pdf-parser.js'
import { parseDocx } from './parsers/docx-parser.js'
import { parseXlsx, parseCsv } from './parsers/xlsx-parser.js'
import type { ContentIndexer, Chunk, SearchSource } from '../../types.js'
import type { DocChunk } from '../docs/file-reader.js'

const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.txt', '.rst',
  '.pdf',
  '.docx',
  '.xlsx', '.xls',
  '.csv', '.tsv',
])

/**
 * Walk a directory recursively, yielding all files with supported extensions.
 * Skips hidden entries. Entries come from readdirSync, not user input.
 */
function walkDir(dir: string): { filePath: string; ext: string }[] {
  const results: { filePath: string; ext: string }[] = []
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rootDir = resolve(dir)

  function walk(current: string) {
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }

    for (const entry of entries) {
      // Skip hidden entries and entries with path separators (traversal guard)
      if (entry.startsWith('.') || entry.includes('/') || entry.includes('\\')) continue

      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      const fullPath = resolve(current, entry)
      if (!fullPath.startsWith(rootDir + '/') && fullPath !== rootDir) continue

      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (stat.isFile()) {
        const ext = extname(entry).toLowerCase()
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push({ filePath: fullPath, ext })
        }
      }
    }
  }

  walk(rootDir)
  return results
}

function docChunkToChunk(dc: DocChunk, sourceId: string): Chunk {
  return {
    id: generateId(),
    sourceId,
    collection: 'files',
    content: dc.content,
    metadata: {
      filePath: dc.filePath,
      title: dc.title || undefined,
      section: dc.section || undefined,
    },
  }
}

export function createFileIndexer(): ContentIndexer {
  return {
    name: 'files',

    supports(source: SearchSource): boolean {
      return source.type === 'files'
    },

    async index(source: SearchSource): Promise<Chunk[]> {
      const chunks: Chunk[] = []
      const paths = source.config.paths ?? []

      for (const dir of paths) {
        const files = walkDir(dir)

        for (const { filePath, ext } of files) {
          try {
            if (ext === '.md' || ext === '.txt' || ext === '.rst') {
              const content = readFileSync(filePath, 'utf-8')
              const docChunks = chunkMarkdown(content, filePath)
              for (const dc of docChunks) chunks.push(docChunkToChunk(dc, source.id))
            } else if (ext === '.pdf') {
              const buffer = readFileSync(filePath)
              const docChunks = await parsePdf(buffer, filePath)
              for (const dc of docChunks) chunks.push(docChunkToChunk(dc, source.id))
            } else if (ext === '.docx') {
              const buffer = readFileSync(filePath)
              const docChunks = await parseDocx(buffer, filePath)
              for (const dc of docChunks) chunks.push(docChunkToChunk(dc, source.id))
            } else if (ext === '.xlsx' || ext === '.xls') {
              const buffer = readFileSync(filePath)
              const docChunks = await parseXlsx(buffer, filePath)
              for (const dc of docChunks) chunks.push(docChunkToChunk(dc, source.id))
            } else if (ext === '.csv' || ext === '.tsv') {
              const content = readFileSync(filePath, 'utf-8')
              const docChunks = parseCsv(content, filePath)
              for (const dc of docChunks) chunks.push(docChunkToChunk(dc, source.id))
            }
            // other extensions: skip (already filtered by walkDir)
          } catch {
            // Skip unreadable / unparseable files
          }
        }
      }

      return chunks
    },
  }
}
