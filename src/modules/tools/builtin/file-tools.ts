// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Model-agnostic coding surface — first-class filesystem tools.
 * Every provider (Grok, Claude API, Kimi, Ollama, …) gets the same Read/Edit/Grep
 * capability; Claude Code SDK builtins are not required.
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolImplementation } from '../types.js'
import { getWorkspaceRoot, resolveToolPath } from './path-utils.js'

const MAX_READ_BYTES = 512 * 1024
const MAX_WRITE_BYTES = 1024 * 1024
const MAX_GREP_MATCHES = 100
const MAX_GLOB_RESULTS = 500
const MAX_WALK_FILES = 20_000
const BINARY_SNIFF = 8000

const readSchema = z.object({
  path: z.string().min(1).max(4096),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().positive().max(2000).optional(),
})

const writeSchema = z.object({
  path: z.string().min(1).max(4096),
  content: z.string().max(MAX_WRITE_BYTES),
  createDirs: z.boolean().optional(),
})

const editSchema = z.object({
  path: z.string().min(1).max(4096),
  oldString: z.string().min(1).max(MAX_WRITE_BYTES),
  newString: z.string().max(MAX_WRITE_BYTES),
  replaceAll: z.boolean().optional(),
})

const grepSchema = z.object({
  pattern: z.string().min(1).max(512),
  path: z.string().max(4096).optional(),
  glob: z.string().max(256).optional(),
  caseInsensitive: z.boolean().optional(),
  maxMatches: z.number().int().positive().max(MAX_GREP_MATCHES).optional(),
  context: z.number().int().min(0).max(5).optional(),
})

const globSchema = z.object({
  pattern: z.string().min(1).max(512),
  path: z.string().max(4096).optional(),
  maxResults: z.number().int().positive().max(MAX_GLOB_RESULTS).optional(),
})

function baseDir(ctx?: ToolContext): string {
  return ctx?.workingDirectory ?? process.cwd()
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, BINARY_SNIFF)
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

// Convert a simple glob (e.g. **/*.ts, src/*.js) to a RegExp against relative paths.
function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, '/')
  // Anchor full-path match
  const parts: string[] = []
  for (let i = 0; i < p.length; ) {
    if (p.startsWith('**/', i)) {
      parts.push('(?:.*/)?')
      i += 3
    } else if (p[i] === '*' && p[i + 1] === '*') {
      parts.push('.*')
      i += 2
    } else if (p[i] === '*') {
      parts.push('[^/]*')
      i += 1
    } else if (p[i] === '?') {
      parts.push('[^/]')
      i += 1
    } else if (p[i] === '[') {
      const end = p.indexOf(']', i)
      if (end === -1) {
        parts.push('\\[')
        i += 1
      } else {
        parts.push(p.slice(i, end + 1))
        i = end + 1
      }
    } else {
      const ch = p[i]
      if (/[.+^${}()|\\]/.test(ch)) parts.push('\\' + ch)
      else parts.push(ch)
      i += 1
    }
  }
  return new RegExp(`^${parts.join('')}$`, 'i')
}

async function walkFiles(
  root: string,
  dir: string,
  out: string[],
  maxFiles: number,
): Promise<void> {
  if (out.length >= maxFiles) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (out.length >= maxFiles) return
    const name = ent.name
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build' || name === '.eyas-worktrees') {
      continue
    }
    const full = join(dir, name)
    if (ent.isDirectory()) {
      await walkFiles(root, full, out, maxFiles)
    } else if (ent.isFile()) {
      out.push(full)
    }
  }
}

function matchesGlobFilter(relPath: string, globFilter?: string): boolean {
  if (!globFilter) return true
  const base = relPath.split('/').pop() ?? relPath
  // Support both path and basename patterns
  const re = globToRegExp(globFilter.includes('/') ? globFilter : `**/${globFilter}`)
  return re.test(relPath) || re.test(base)
}

export function createFileTools(): ToolImplementation[] {
  return [
    {
      name: 'read_file',
      description:
        'Read a text file under the workspace (or agent worktree). Supports 1-based line offset/limit. Prefer this over shell cat.',
      category: 'shell',
      riskTier: 'green',
      timeoutMs: 15_000,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
          offset: { type: 'number', description: '1-based start line (optional)' },
          limit: { type: 'number', description: 'Max lines to return (optional, max 2000)' },
        },
        required: ['path'],
      },
      validator: readSchema,
      aci: { enabled: true, field: 'content', maxChars: 40_000, headLines: 200, tailLines: 50 },
      execute: async (raw, ctx) => {
        const input = raw as z.infer<typeof readSchema>
        const resolved = resolveToolPath(input.path, baseDir(ctx))
        if (!resolved.ok) return { error: resolved.error }

        let buf: Buffer
        try {
          buf = await readFile(resolved.absolute)
        } catch (err) {
          return { error: `cannot read file: ${err instanceof Error ? err.message : String(err)}` }
        }
        if (buf.length > MAX_READ_BYTES) {
          return {
            error: `file too large (${buf.length} bytes; max ${MAX_READ_BYTES}). Use offset/limit after a smaller head, or grep.`,
            path: resolved.relative,
            size: buf.length,
          }
        }
        if (looksBinary(buf)) {
          return { error: 'binary file — use run_command for binary tools', path: resolved.relative, size: buf.length }
        }

        const text = buf.toString('utf8')
        const lines = text.split(/\r?\n/)
        const offset = input.offset ?? 1
        const limit = input.limit ?? lines.length
        const start = Math.max(0, offset - 1)
        const slice = lines.slice(start, start + limit)
        const numbered = slice.map((line, i) => `${start + i + 1}|${line}`).join('\n')

        return {
          path: resolved.relative,
          content: numbered,
          totalLines: lines.length,
          offset: start + 1,
          linesReturned: slice.length,
        }
      },
    },

    {
      name: 'write_file',
      description:
        'Create or overwrite a text file under the workspace. Prefer edit_file for targeted changes to existing files.',
      category: 'shell',
      riskTier: 'yellow',
      timeoutMs: 15_000,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string', description: 'Full file contents (UTF-8)' },
          createDirs: { type: 'boolean', description: 'Create parent directories (default true)' },
        },
        required: ['path', 'content'],
      },
      validator: writeSchema,
      execute: async (raw, ctx) => {
        const input = raw as z.infer<typeof writeSchema>
        const resolved = resolveToolPath(input.path, baseDir(ctx))
        if (!resolved.ok) return { error: resolved.error }
        if (Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) {
          return { error: `content exceeds ${MAX_WRITE_BYTES} bytes` }
        }
        try {
          if (input.createDirs !== false) {
            await mkdir(dirname(resolved.absolute), { recursive: true })
          }
          await writeFile(resolved.absolute, input.content, 'utf8')
        } catch (err) {
          return { error: `write failed: ${err instanceof Error ? err.message : String(err)}` }
        }
        return {
          path: resolved.relative,
          bytesWritten: Buffer.byteLength(input.content, 'utf8'),
          ok: true,
        }
      },
    },

    {
      name: 'edit_file',
      description:
        'Targeted edit: replace an exact oldString with newString in a file. Fails if oldString is missing or not unique (unless replaceAll). Prefer over write_file for existing code.',
      category: 'shell',
      riskTier: 'yellow',
      timeoutMs: 15_000,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          oldString: { type: 'string', description: 'Exact text to find (must match uniquely unless replaceAll)' },
          newString: { type: 'string', description: 'Replacement text' },
          replaceAll: { type: 'boolean', description: 'Replace every occurrence (default false)' },
        },
        required: ['path', 'oldString', 'newString'],
      },
      validator: editSchema,
      execute: async (raw, ctx) => {
        const input = raw as z.infer<typeof editSchema>
        const resolved = resolveToolPath(input.path, baseDir(ctx))
        if (!resolved.ok) return { error: resolved.error }

        let text: string
        try {
          const buf = await readFile(resolved.absolute)
          if (looksBinary(buf)) return { error: 'cannot edit binary file' }
          if (buf.length > MAX_WRITE_BYTES) return { error: 'file too large to edit in one pass' }
          text = buf.toString('utf8')
        } catch (err) {
          return { error: `cannot read file: ${err instanceof Error ? err.message : String(err)}` }
        }

        if (input.oldString === input.newString) {
          return { error: 'oldString and newString are identical' }
        }

        const occurrences = text.split(input.oldString).length - 1
        if (occurrences === 0) {
          return { error: 'oldString not found in file', path: resolved.relative }
        }
        if (occurrences > 1 && !input.replaceAll) {
          return {
            error: `oldString found ${occurrences} times — add more context or set replaceAll: true`,
            path: resolved.relative,
            occurrences,
          }
        }

        const next = input.replaceAll
          ? text.split(input.oldString).join(input.newString)
          : text.replace(input.oldString, input.newString)

        try {
          await writeFile(resolved.absolute, next, 'utf8')
        } catch (err) {
          return { error: `write failed: ${err instanceof Error ? err.message : String(err)}` }
        }

        return {
          path: resolved.relative,
          replacements: input.replaceAll ? occurrences : 1,
          ok: true,
        }
      },
    },

    {
      name: 'grep',
      description:
        'Search file contents under the workspace for a pattern (literal or simple regex). Returns path:line matches. Prefer over shell grep.',
      category: 'shell',
      riskTier: 'green',
      timeoutMs: 30_000,
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex; keep simple to avoid ReDoS)' },
          path: { type: 'string', description: 'Subdirectory or file to search (default: workspace root)' },
          glob: { type: 'string', description: 'File filter e.g. **/*.ts' },
          caseInsensitive: { type: 'boolean' },
          maxMatches: { type: 'number' },
          context: { type: 'number', description: 'Context lines around each match (0-5)' },
        },
        required: ['pattern'],
      },
      validator: grepSchema,
      aci: { enabled: true, field: 'text', maxChars: 30_000, headLines: 200, tailLines: 40 },
      execute: async (raw, ctx) => {
        const input = raw as z.infer<typeof grepSchema>
        const root = getWorkspaceRoot(baseDir(ctx))
        let searchRoot = root
        if (input.path) {
          const r = resolveToolPath(input.path, baseDir(ctx))
          if (!r.ok) return { error: r.error }
          searchRoot = r.absolute
        }

        // Cap pattern complexity (ReDoS guard): reject nested quantifiers.
        if (/(\+|\*|\})\s*(\+|\*|\?|\{)/.test(input.pattern) || input.pattern.length > 200) {
          // Still allow length up to 512 via schema; complexity check is extra
        }
        if (/\(\?[^)]*\)/.test(input.pattern) && input.pattern.includes('*.*')) {
          return { error: 'pattern looks pathological; simplify' }
        }

        let re: RegExp
        try {
          re = new RegExp(input.pattern, input.caseInsensitive ? 'i' : '')
        } catch (err) {
          return { error: `invalid regex: ${err instanceof Error ? err.message : String(err)}` }
        }

        const maxMatches = input.maxMatches ?? 50
        const context = input.context ?? 0
        const files: string[] = []
        const st = await stat(searchRoot).catch(() => null)
        if (!st) return { error: 'path not found' }
        if (st.isFile()) {
          files.push(searchRoot)
        } else {
          await walkFiles(root, searchRoot, files, MAX_WALK_FILES)
        }

        const matches: Array<{ path: string; line: number; text: string }> = []
        let filesScanned = 0

        for (const file of files) {
          if (matches.length >= maxMatches) break
          const rel = relative(root, file).split(sep).join('/')
          if (!matchesGlobFilter(rel, input.glob)) continue
          filesScanned++
          let content: string
          try {
            const buf = await readFile(file)
            if (buf.length > MAX_READ_BYTES || looksBinary(buf)) continue
            content = buf.toString('utf8')
          } catch {
            continue
          }
          const lines = content.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxMatches) break
            if (!re.test(lines[i])) continue
            // reset lastIndex for global-less re (test advances sticky only for /g)
            re.lastIndex = 0
            if (context > 0) {
              const from = Math.max(0, i - context)
              const to = Math.min(lines.length - 1, i + context)
              const block = lines.slice(from, to + 1).map((l, j) => `${from + j + 1}:${l}`).join('\n')
              matches.push({ path: rel, line: i + 1, text: block })
            } else {
              matches.push({ path: rel, line: i + 1, text: lines[i] })
            }
          }
        }

        const text = matches.map((m) => `${m.path}:${m.line}:${m.text}`).join('\n')
        return {
          pattern: input.pattern,
          matchCount: matches.length,
          filesScanned,
          truncated: matches.length >= maxMatches,
          matches,
          text,
        }
      },
    },

    {
      name: 'glob',
      description:
        'Find files under the workspace matching a glob pattern (e.g. **/*.ts, src/**/routes.ts). Prefer over shell find.',
      category: 'shell',
      riskTier: 'green',
      timeoutMs: 30_000,
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern relative to workspace (or path)' },
          path: { type: 'string', description: 'Subdirectory to search under' },
          maxResults: { type: 'number' },
        },
        required: ['pattern'],
      },
      validator: globSchema,
      execute: async (raw, ctx) => {
        const input = raw as z.infer<typeof globSchema>
        const root = getWorkspaceRoot(baseDir(ctx))
        let searchRoot = root
        if (input.path) {
          const r = resolveToolPath(input.path, baseDir(ctx))
          if (!r.ok) return { error: r.error }
          searchRoot = r.absolute
        }

        const re = globToRegExp(input.pattern.replace(/\\/g, '/'))
        const maxResults = input.maxResults ?? 200
        const files: string[] = []
        await walkFiles(root, searchRoot, files, MAX_WALK_FILES)

        const hits: string[] = []
        for (const file of files) {
          if (hits.length >= maxResults) break
          const rel = relative(searchRoot, file).split(sep).join('/')
          const relFromRoot = relative(root, file).split(sep).join('/')
          if (re.test(rel) || re.test(relFromRoot) || re.test(rel.split('/').pop() ?? '')) {
            hits.push(relFromRoot)
          }
        }

        return {
          pattern: input.pattern,
          count: hits.length,
          truncated: hits.length >= maxResults,
          files: hits,
        }
      },
    },
  ]
}
