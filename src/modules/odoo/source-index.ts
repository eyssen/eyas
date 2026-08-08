// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Lightweight local Odoo source indexer (P3).
 * Scans configured checkout roots for models, fields, and XML IDs without
 * requiring the external odoo-indexer SQLite binary. Good enough for agent
 * grounding; operators can still register full code search sources in parallel.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export interface OdooSourceRoots {
  /** Absolute paths to Odoo (or addons) checkouts */
  roots: string[]
}

export interface OdooModelHit {
  model: string
  file: string
  line: number
  kind: 'model' | 'inherit'
  name?: string
}

export interface OdooFieldHit {
  modelHint?: string
  field: string
  fieldType?: string
  file: string
  line: number
}

export interface OdooXmlIdHit {
  xmlId: string
  file: string
  line: number
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.eyas-worktrees',
  'static', 'i18n', 'tests', // skip i18n bulk; tests still useful but noisy for models
])

// Re-include tests for model search optionally — keep tests for now by removing from skip
SKIP_DIRS.delete('tests')

async function walkPyXml(root: string, out: string[], maxFiles: number): Promise<void> {
  if (out.length >= maxFiles) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (out.length >= maxFiles) return
    if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue
    const full = join(root, ent.name)
    if (ent.isDirectory()) {
      await walkPyXml(full, out, maxFiles)
    } else if (ent.isFile() && (ent.name.endsWith('.py') || ent.name.endsWith('.xml'))) {
      out.push(full)
    }
  }
}

function lineNo(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') n++
  }
  return n
}

export async function searchOdooModels(
  roots: string[],
  query: string,
  limit = 30,
): Promise<OdooModelHit[]> {
  const q = query.toLowerCase()
  const hits: OdooModelHit[] = []
  const modelRe = /_name\s*=\s*['"]([^'"]+)['"]/g
  const inheritRe = /_inherit\s*=\s*(?:['"]([^'"]+)['"]|\[([^\]]+)\])/g

  for (const root of roots) {
    const files: string[] = []
    await walkPyXml(root, files, 15_000)
    for (const file of files) {
      if (!file.endsWith('.py')) continue
      if (hits.length >= limit) return hits
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      if (text.length > 512_000) continue
      let m: RegExpExecArray | null
      modelRe.lastIndex = 0
      while ((m = modelRe.exec(text)) !== null) {
        if (!m[1].toLowerCase().includes(q) && q.length > 0) continue
        hits.push({
          model: m[1],
          file: relative(root, file).split(sep).join('/'),
          line: lineNo(text, m.index),
          kind: 'model',
        })
        if (hits.length >= limit) return hits
      }
      inheritRe.lastIndex = 0
      while ((m = inheritRe.exec(text)) !== null) {
        const models = m[1]
          ? [m[1]]
          : (m[2] ?? '').match(/['"]([^'"]+)['"]/g)?.map((s) => s.slice(1, -1)) ?? []
        for (const model of models) {
          if (q && !model.toLowerCase().includes(q)) continue
          hits.push({
            model,
            file: relative(root, file).split(sep).join('/'),
            line: lineNo(text, m.index),
            kind: 'inherit',
          })
          if (hits.length >= limit) return hits
        }
      }
    }
  }
  return hits
}

export async function searchOdooFields(
  roots: string[],
  query: string,
  opts: { model?: string; limit?: number } = {},
): Promise<OdooFieldHit[]> {
  const q = query.toLowerCase()
  const limit = opts.limit ?? 40
  const hits: OdooFieldHit[] = []
  // fields.Char('Label') or partner_id = fields.Many2one(
  const fieldRe = /^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*fields\.([A-Za-z0-9_]+)\s*\(/gm
  const nameRe = /_name\s*=\s*['"]([^'"]+)['"]/

  for (const root of roots) {
    const files: string[] = []
    await walkPyXml(root, files, 15_000)
    for (const file of files) {
      if (!file.endsWith('.py')) continue
      if (hits.length >= limit) return hits
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      if (text.length > 512_000) continue
      const modelMatch = nameRe.exec(text)
      const modelHint = modelMatch?.[1]
      if (opts.model && modelHint && modelHint !== opts.model && !text.includes(`_inherit`)) {
        // still scan inherits
      }
      if (opts.model && modelHint && modelHint !== opts.model && !text.includes(opts.model)) {
        continue
      }
      let m: RegExpExecArray | null
      fieldRe.lastIndex = 0
      while ((m = fieldRe.exec(text)) !== null) {
        const field = m[1]
        if (q && !field.toLowerCase().includes(q)) continue
        hits.push({
          modelHint,
          field,
          fieldType: m[2],
          file: relative(root, file).split(sep).join('/'),
          line: lineNo(text, m.index),
        })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

export async function searchOdooXmlIds(
  roots: string[],
  query: string,
  limit = 30,
): Promise<OdooXmlIdHit[]> {
  const q = query.toLowerCase()
  const hits: OdooXmlIdHit[] = []
  const idRe = /\bid\s*=\s*["']([^"']+)["']/g

  for (const root of roots) {
    const files: string[] = []
    await walkPyXml(root, files, 15_000)
    for (const file of files) {
      if (!file.endsWith('.xml')) continue
      if (hits.length >= limit) return hits
      let text: string
      try {
        text = await readFile(file, 'utf8')
      } catch {
        continue
      }
      if (text.length > 512_000) continue
      let m: RegExpExecArray | null
      idRe.lastIndex = 0
      while ((m = idRe.exec(text)) !== null) {
        const xmlId = m[1]
        if (q && !xmlId.toLowerCase().includes(q)) continue
        hits.push({
          xmlId,
          file: relative(root, file).split(sep).join('/'),
          line: lineNo(text, m.index),
        })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}

export async function resolveConfiguredRoots(
  envPaths: string[] | undefined,
  configPaths: string[] | undefined,
): Promise<string[]> {
  const raw = [...(configPaths ?? []), ...(envPaths ?? [])]
  const out: string[] = []
  for (const p of raw) {
    if (!p) continue
    try {
      const s = await stat(p)
      if (s.isDirectory()) out.push(p)
    } catch {
      // skip missing
    }
  }
  // Env convenience: EYAS_ODOO_SOURCE_PATHS=path1:path2
  const env = process.env.EYAS_ODOO_SOURCE_PATHS
  if (env) {
    for (const p of env.split(/[:;]/).map((s) => s.trim()).filter(Boolean)) {
      try {
        const s = await stat(p)
        if (s.isDirectory() && !out.includes(p)) out.push(p)
      } catch {
        // skip
      }
    }
  }
  return out
}
