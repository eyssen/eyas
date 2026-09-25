// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { classifyPath, posix } from '../scanners/heuristics.js'
import { splitFrontmatter } from '../source-frontmatter.js'
import { jsonlTranscriptUnit } from './chat-export.js'
import { CURSOR_TRANSCRIPT_RE, cursorTranscriptFacts } from './transcript-paths.js'
import type { ProviderAdapter } from './types.js'

/** `true`, or a string form of "true"/"yes" (frontmatter often quotes booleans). */
function isAlwaysApply(v: unknown): boolean {
  if (v === true) return true
  return typeof v === 'string' && /^(true|yes)$/i.test(v.trim())
}

/** `.cursorrules` at any depth (`packages/foo/.cursorrules` is a rule too). */
const isCursorRulesFile = (p: string) => p === '.cursorrules' || p.endsWith('/.cursorrules')

/**
 * `CURSOR_TRANSCRIPT_RE` is `…/agent-transcripts/<file>.jsonl`, with or without
 * a per-session directory and with or without a `subagents/` level. It is
 * anchored on a path SEGMENT, not on a leading slash: `expand` is asked of the
 * adapter that claimed the file (G3) and may be handed a path whose leading
 * segments a rooted scan cut off, and a pattern that insisted on a slash in
 * front would render nothing for a file it had just claimed (IMP-1).
 */
const TRANSCRIPT_REASON = 'Cursor agent transcript (JSONL)'

/** Same anchored leading-block pattern as `splitFrontmatter`, kept local — never import its
 *  internals, and never call a different YAML engine here (amendment G2). */
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

function stripQuotes(v: string): string {
  const t = v.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

/**
 * A Cursor rule's `globs: **\/*.py` (unquoted, unbracketed) is invalid YAML — `*` at the
 * start of a scalar is an alias indicator — so `splitFrontmatter` fails to parse it and
 * returns an empty `data` with `hadFrontmatter: false`. Rather than lose `scope`/`alwaysApply`
 * silently, read those two lines directly out of the still-present frontmatter block.
 */
function fallbackFrontmatterFields(head: string): { globs?: string; alwaysApply?: string } | null {
  const cleaned = head.replace(/^﻿/, '')
  if (!cleaned.startsWith('---')) return null
  const m = FRONTMATTER_BLOCK_RE.exec(cleaned)
  if (!m) return null
  const block = m[1]
  const out: { globs?: string; alwaysApply?: string } = {}
  const globsLine = /^globs:\s*(.+)$/m.exec(block)
  if (globsLine) out.globs = stripQuotes(globsLine[1])
  const alwaysLine = /^alwaysApply:\s*(.+)$/m.exec(block)
  if (alwaysLine) out.alwaysApply = stripQuotes(alwaysLine[1])
  return out
}

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  rootHints: ['~/.cursor', '<repo>/.cursor/rules', '<repo>/.cursorrules'],
  detect: (paths) => {
    const l = paths.map(posix)
    return l.some((p) => isCursorRulesFile(p) || p.startsWith('.cursor/') || p.includes('/.cursor/')) ? 0.85 : 0
  },
  classify: (rel, head) => {
    const p = posix(rel)
    const inCursor = isCursorRulesFile(p) || p.startsWith('.cursor/') || p.includes('/.cursor/')
    if (!inCursor) return null
    if (p.endsWith('.mdc') || isCursorRulesFile(p)) {
      const { data, hadFrontmatter, parseError } = splitFrontmatter(head)
      let globs = Array.isArray(data.globs)
        ? data.globs.map(String).join(', ')
        : typeof data.globs === 'string'
          ? data.globs
          : ''
      let alwaysRaw: unknown = data.alwaysApply
      // `globs: **/*.py` is invalid YAML, so the block either did not read as
      // frontmatter at all or read only through the shared line-based fallback,
      // which does not know Cursor's two keys. Both cases need this reader.
      if (!hadFrontmatter || parseError) {
        const fallback = fallbackFrontmatterFields(head)
        if (fallback?.globs && !globs) globs = fallback.globs
        if (fallback?.alwaysApply !== undefined && alwaysRaw === undefined) alwaysRaw = fallback.alwaysApply
      }
      const always = isAlwaysApply(alwaysRaw)
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.9,
        reason: always ? 'Cursor rule (alwaysApply)' : globs ? `Cursor rule scoped by globs: ${globs}` : 'Cursor rule',
        reasonCode: 'cursor-rule',
        selectedByDefault: true,
        ...(globs ? { scope: globs } : {}),
      }
    }
    if (CURSOR_TRANSCRIPT_RE.test(p)) {
      return {
        kind: 'session',
        target: 'episodic',
        confidence: 0.8,
        reason: TRANSCRIPT_REASON,
        reasonCode: 'transcript',
        selectedByDefault: true,
      }
    }
    return classifyPath(rel, head, 'cursor')
  },
  /**
   * Transcripts only; every other file stays a whole-file unit. A sub-agent
   * transcript is a session of its own and says which session ran it (P-5).
   */
  expand: (rel, raw, _sourcePath, opts) => {
    const p = posix(rel)
    const facts = cursorTranscriptFacts(p)
    if (!facts) return []
    const units = jsonlTranscriptUnit(rel, raw, TRANSCRIPT_REASON, opts)
    return units.map((unit) => ({
      ...unit,
      tags: [
        ...(unit.tags ?? []),
        ...(facts.project ? [`cursor-project:${facts.project}`] : []),
        ...(facts.subagent ? ['subagent', ...(facts.parentSession ? [`parent-session:${facts.parentSession}`] : [])] : []),
      ],
      data: { ...unit.data, project: facts.project, parentSession: facts.parentSession, subagent: facts.subagent },
    }))
  },
}
