// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname, resolve, normalize } from 'path'

export interface DocChunk {
  content: string
  title: string
  section: string
  filePath: string
}

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst'])
const WORDS_PER_CHUNK = 500

/**
 * Split markdown content into semantic chunks.
 * Strategy:
 *   1. If H2 headings present → split by H2, use H1 as title.
 *   2. If only H1 present (no H2) → single chunk with H1 as title.
 *   3. If no headings → fixed 500-word chunks.
 */
export function chunkMarkdown(content: string, filePath: string): DocChunk[] {
  const lines = content.split('\n')

  // Extract H1 title
  const h1Line = lines.find(l => /^# /.test(l))
  const title = h1Line ? h1Line.replace(/^# /, '').trim() : ''

  // Check for H2 headings
  const h2Indices: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      h2Indices.push(i)
    }
  }

  if (h2Indices.length > 0) {
    const chunks: DocChunk[] = []

    // Content before first H2 (intro, typically H1 + preamble)
    const introPart = lines.slice(0, h2Indices[0]).join('\n').trim()
    if (introPart) {
      chunks.push({ content: introPart, title, section: '', filePath })
    }

    // Each H2 section
    for (let i = 0; i < h2Indices.length; i++) {
      const startLine = h2Indices[i]
      const endLine = i + 1 < h2Indices.length ? h2Indices[i + 1] : lines.length
      const sectionLines = lines.slice(startLine, endLine)
      const section = sectionLines[0].replace(/^## /, '').trim()
      const sectionContent = sectionLines.join('\n').trim()
      if (sectionContent) {
        chunks.push({ content: sectionContent, title, section, filePath })
      }
    }

    return chunks
  }

  // No H2 — try H1 only (return as single chunk)
  if (title) {
    return [{ content: content.trim(), title, section: '', filePath }]
  }

  // No headings — fixed word chunks
  const words = content.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return []

  const chunks: DocChunk[] = []
  for (let start = 0; start < words.length; start += WORDS_PER_CHUNK) {
    const slice = words.slice(start, start + WORDS_PER_CHUNK)
    chunks.push({
      content: slice.join(' '),
      title: '',
      section: '',
      filePath,
    })
  }
  return chunks
}

/**
 * Walk a directory recursively, returning all supported doc files.
 * Skips hidden directories (starting with '.').
 */
export function readDocFiles(dir: string): { content: string; filePath: string }[] {
  const results: { content: string; filePath: string }[] = []
  // Resolve root once so we can verify all paths stay within it
  const rootDir = resolve(dir) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

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

      // Resolve and confine: must stay inside rootDir (nosemgrep: path-join-resolve-traversal — entry is from readdirSync, separator-checked, and confined below)
      const fullPath = resolve(current, entry) // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
      if (!fullPath.startsWith(rootDir + '/') && fullPath !== rootDir) continue

      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (stat.isFile() && DOC_EXTENSIONS.has(extname(entry).toLowerCase())) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          results.push({ content, filePath: fullPath })
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(rootDir)
  return results
}
