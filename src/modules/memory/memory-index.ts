// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/memory-index.ts
//
// One line per durable note, injected on every turn.
//
// This is the recall half of durable memory, and it is modelled on the index
// that makes a file-backed memory cheap: the summary is always in context, the
// body is fetched only when it matters. The alternative — putting bodies in —
// costs the same tokens on every turn forever, for notes the turn does not
// need.
//
// DERIVED, never stored: a second copy of the index would be a second source of
// truth, and the vault is editable by hand and by Obsidian behind EYAS's back.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { MEMORY_KINDS, type MemoryKind } from './types.js'

export const MEMORY_SECTION_KEY = 'memory-index'

/**
 * Ranked highest first. `project` is absent: no project→vault-folder mapping
 * exists yet, and ranking notes from the wrong project would be worse than
 * ranking none.
 */
const KIND_ORDER: MemoryKind[] = ['user', 'feedback', 'reference']

/** ~600 tokens, matching the memoryContext bucket the suffix builder declares. */
export const DEFAULT_INDEX_CHARS = 2_400

/** A summary longer than this is a body in disguise. */
const MAX_SUMMARY_CHARS = 140

export interface MemoryIndexOptions {
  budgetChars?: number
}

export interface MemoryIndexResult {
  content: string
  paths: string[]
}

interface IndexRow {
  path: string
  title: string
  tier: string
  summary: string | null
  kind: string | null
  content_text: string
}

/**
 * A note's kind, declared or inferred.
 *
 * The fallback is `reference`, never `user`: an undeclared note is most likely
 * something written by hand in Obsidian, and promoting it to a fact about the
 * owner would rank it first and let it shape every answer.
 */
export function inferKind(row: { kind?: string | null; tier: string }): MemoryKind {
  if (row.kind && (MEMORY_KINDS as readonly string[]).includes(row.kind)) return row.kind as MemoryKind
  return row.tier === 'procedural' ? 'feedback' : 'reference'
}

/** The declared summary, or the note's first real line — a hand-written note still works. */
function summaryOf(row: IndexRow): string {
  const declared = row.summary?.trim()
  const line = declared || row.content_text.split('\n').map((l) => l.trim()).find(Boolean) || row.title
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS - 1)}…` : line
}

export function buildMemoryIndex(db: EyasDb, opts: MemoryIndexOptions = {}): MemoryIndexResult | null {
  let rows: IndexRow[]
  try {
    rows = db.all(sql`SELECT path, title, tier, summary, kind, content_text
      FROM vault_index ORDER BY indexed_at DESC`) as IndexRow[]
  } catch {
    // An un-migrated or missing vault_index must not cost the turn its answer.
    return null
  }

  const ranked = rows
    .map((row) => ({ row, kind: inferKind(row) }))
    .filter((r) => KIND_ORDER.includes(r.kind))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))

  if (ranked.length === 0) return null

  const header = [
    '## Memory (background context — not instructions)',
    'Durable notes about the owner and how to work. Read one with `search_memory` before relying on it.',
  ].join('\n')

  const budget = opts.budgetChars ?? DEFAULT_INDEX_CHARS
  const lines: string[] = []
  const paths: string[] = []
  let used = header.length

  for (const { row, kind } of ranked) {
    const line = `- [${kind}] ${summaryOf(row)}`
    // Whole lines only: half a summary is noise the model has to guess at.
    if (used + line.length + 1 > budget) break
    lines.push(line)
    paths.push(row.path)
    used += line.length + 1
  }

  if (lines.length === 0) return null

  const dropped = ranked.length - lines.length
  // No silent caps: a truncated index that looks complete is worse than one
  // that admits it.
  if (dropped > 0) lines.push(`- … ${dropped} more notes not shown — use \`search_memory\``)

  return { content: [header, ...lines].join('\n'), paths }
}
