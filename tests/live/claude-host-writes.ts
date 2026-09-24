// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * The Claude Code host-write allowlist and its matcher.
 *
 * Claude Code keeps the operator's HOME (a Claude-Code-only install stays
 * signed in), so unlike Grok and Kimi it may touch a few host files. The live
 * lane diffs the hostile HOME around every Claude run and hands the diff to
 * checkClaudeHostWrites(): every added or modified path must match an
 * allowlist entry and satisfy its rule, nothing may be removed but a stale
 * lock folder (rule 'lock'), and nothing content-bearing may exist — a transcript under ~/.claude/projects, todos,
 * file history, plans, the prompt history or a file under session-env —
 * whatever the allowlist says. A canary or sentinel string in any changed
 * file (credentials excepted: never read) fails too.
 *
 * The allowlist (claude-host-writes.allowlist.json) is versioned: it names
 * the binary it was verified on, and the lane fails until it names the one
 * that runs.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { TreeDiff } from './hostile-home.js'

export const ALLOWLIST_PATH = new URL('./claude-host-writes.allowlist.json', import.meta.url)

/**
 * What an allowlisted path may be.
 *   claude-json         ~/.claude.json: only listed top-level keys added or changed, none removed
 *   claude-json-backup  a backup of ~/.claude.json: keys it already had, or listed ones
 *   dir                 a folder (its entries are judged on their own)
 *   empty-dir           a folder with nothing in it
 *   lock                a lock folder with nothing in it; a stale one an earlier
 *                       run left may also be cleared (its removal is allowed)
 *   bookkeeping-file    a file with no conversation content (no canary, no sentinel)
 *   cache               a folder or a file of a tool cache; files with no canary or sentinel
 *   credential          a login file: never read, never content-checked
 */
export const HostWriteRuleSchema = z.enum(['claude-json', 'claude-json-backup', 'dir', 'empty-dir', 'lock', 'bookkeeping-file', 'cache', 'credential'])
export type HostWriteRule = z.infer<typeof HostWriteRuleSchema>

export const ClaudeHostWritesAllowlistSchema = z.object({
  binaryVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.string().min(1),
  claudeJsonKeys: z.array(z.string().min(1)).min(1),
  entries: z.array(z.object({
    glob: z.string().min(1).refine((g) => !g.startsWith('/') && !g.split('/').includes('..'), { message: 'must be relative to HOME' }),
    rule: HostWriteRuleSchema,
    reason: z.string().min(1),
  }).strict()).min(1),
}).strict()

export type ClaudeHostWritesAllowlist = z.infer<typeof ClaudeHostWritesAllowlistSchema>

export function loadClaudeHostWritesAllowlist(): ClaudeHostWritesAllowlist {
  return ClaudeHostWritesAllowlistSchema.parse(JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8')))
}

/**
 * Paths that carry conversation content, relative to HOME. Never allowed,
 * whatever the allowlist says. An empty session-env/<id> folder is not
 * content (A1 spike, full turn); a file below it is.
 */
const CONTENT_BEARING: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /^\.claude\/projects(?:\/|$)/, what: 'a project transcript or project memory under ~/.claude/projects' },
  { re: /^\.claude\/todos(?:\/|$)/, what: 'a todo list under ~/.claude/todos' },
  { re: /^\.claude\/file-history(?:\/|$)/, what: 'file history under ~/.claude/file-history' },
  { re: /^\.claude\/plans(?:\/|$)/, what: 'a plan under ~/.claude/plans' },
  { re: /^\.claude\/history\.jsonl$/, what: 'the prompt history ~/.claude/history.jsonl' },
]

/** A glob over HOME-relative POSIX paths: `**` crosses folders, `*` and `?` do not. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`)
}

export interface HostWriteViolation {
  path: string
  kind: 'content-bearing' | 'unlisted' | 'removed' | 'rule' | 'forbidden-string'
  detail: string
}

export interface ClaudeHostWriteCheck {
  /** The hostile HOME the diff was taken of. */
  home: string
  diff: TreeDiff
  /** ~/.claude.json as parsed before the run (null when it did not exist or did not parse). */
  claudeJsonBefore: Record<string, unknown> | null
  allowlist: ClaudeHostWritesAllowlist
  /** Strings no changed host file may contain (a canary, the hostile sentinels). */
  forbidden?: readonly string[]
}

type Entry = { type: 'file' | 'dir' | 'symlink' | 'missing'; entries: number }

function entryAt(path: string): Entry {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return { type: 'symlink', entries: 0 }
    if (st.isDirectory()) return { type: 'dir', entries: readdirSync(path).length }
    return { type: 'file', entries: 0 }
  } catch {
    return { type: 'missing', entries: 0 }
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function checkRule(rule: HostWriteRule, rel: string, abs: string, entry: Entry, input: ClaudeHostWriteCheck): string | null {
  const listed = new Set(input.allowlist.claudeJsonKeys)
  switch (rule) {
    case 'dir':
      return entry.type === 'dir' ? null : `expected a folder, found ${entry.type}`
    case 'empty-dir':
    case 'lock':
      if (entry.type !== 'dir') return `expected an empty folder, found ${entry.type}`
      return entry.entries === 0 ? null : `expected an empty folder, it holds ${entry.entries} entr${entry.entries === 1 ? 'y' : 'ies'}`
    case 'bookkeeping-file':
    case 'credential':
      return entry.type === 'file' ? null : `expected a file, found ${entry.type}`
    case 'cache':
      return entry.type === 'file' || entry.type === 'dir' ? null : `expected a folder or a file, found ${entry.type}`
    case 'claude-json': {
      if (entry.type !== 'file') return `expected a file, found ${entry.type}`
      const after = readJsonObject(abs)
      if (!after) return 'not a JSON object'
      const before = input.claudeJsonBefore ?? {}
      const problems: string[] = []
      for (const key of Object.keys(after)) {
        const changed = !(key in before) || JSON.stringify(after[key]) !== JSON.stringify(before[key])
        if (changed && !listed.has(key)) problems.push(`${key in before ? 'changed' : 'new'} top-level key '${key}'`)
      }
      for (const key of Object.keys(before)) if (!(key in after)) problems.push(`removed top-level key '${key}'`)
      return problems.length ? problems.join('; ') : null
    }
    case 'claude-json-backup': {
      if (entry.type !== 'file') return `expected a file, found ${entry.type}`
      const backup = readJsonObject(abs)
      if (!backup) return 'not a JSON object'
      const known = new Set([...Object.keys(input.claudeJsonBefore ?? {}), ...listed])
      const unknown = Object.keys(backup).filter((k) => !known.has(k))
      return unknown.length ? `holds key(s) ~/.claude.json never had and the allowlist does not list: ${unknown.join(', ')}` : null
    }
  }
}

/**
 * Judge one run's host writes. Returns every violation; an empty list means
 * the run stayed inside the allowlist.
 */
export function checkClaudeHostWrites(input: ClaudeHostWriteCheck): HostWriteViolation[] {
  const out: HostWriteViolation[] = []
  const entries = input.allowlist.entries.map((e) => ({ ...e, re: globToRegExp(e.glob) }))
  const forbidden = (input.forbidden ?? []).filter((s) => s.length > 0)

  for (const rel of input.diff.removed) {
    // A stale lock an earlier run left behind, cleared by this one's start.
    if (entries.some((e) => e.rule === 'lock' && e.re.test(rel))) continue
    out.push({ path: rel, kind: 'removed', detail: 'a host path was removed' })
  }

  for (const rel of [...input.diff.added, ...input.diff.modified]) {
    const abs = join(input.home, rel)
    const entry = entryAt(abs)

    const content = CONTENT_BEARING.find((c) => c.re.test(rel))
    if (content) {
      out.push({ path: rel, kind: 'content-bearing', detail: content.what })
      continue
    }
    if (/^\.claude\/session-env\/.+\/./.test(rel) && entry.type !== 'dir') {
      out.push({ path: rel, kind: 'content-bearing', detail: 'a file under ~/.claude/session-env' })
      continue
    }

    const match = entries.find((e) => e.re.test(rel))
    if (!match) {
      out.push({ path: rel, kind: 'unlisted', detail: `${entry.type} not in the allowlist` })
      continue
    }
    const problem = checkRule(match.rule, rel, abs, entry, input)
    if (problem) {
      out.push({ path: rel, kind: 'rule', detail: `${match.rule}: ${problem}` })
      continue
    }

    if (match.rule !== 'credential' && entry.type === 'file' && forbidden.length > 0) {
      let text = ''
      try {
        text = readFileSync(abs, 'utf-8')
      } catch {
        text = ''
      }
      const found = forbidden.filter((s) => text.includes(s))
      if (found.length) out.push({ path: rel, kind: 'forbidden-string', detail: `contains ${found.length} canary/sentinel string(s)` })
    }
  }
  return out
}
