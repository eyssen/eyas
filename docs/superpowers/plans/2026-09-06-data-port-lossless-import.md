# Data Port Lossless Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data-port importer copy 100 % of any assistant's memory, rules, skills, personas and sessions into EYAS's own layers without losing a word, with visible skips, idempotent re-runs and a rollback.

**Architecture:** A provider-adapter registry classifies and expands source files; one shared frontmatter reader turns every unit into a `SourceNote`; a deterministic normalizer maps declared metadata to EYAS kinds/tiers with the body verbatim; apply re-reads files at job time (nothing stored clipped), records every applied ref in a ledger, and rollback reverses a job. Two small recall changes make imported kinds visible (unscoped project notes global; configurable index budget).

**Tech Stack:** Bun 1.x, TypeScript 5.9 strict ESM, Hono, Drizzle + bun:sqlite, gray-matter, Zod, Vitest, React 19 + shadcn (settings card), Astro Starlight docs (six languages).

**Spec:** `docs/superpowers/specs/2026-09-06-data-port-lossless-import-design.md`

## Global Constraints

- Dev checkout only: `/Users/eyssen/GitHub/eyas` (port 3100). Never touch `/Users/eyssen/eyas` (live, port 3000) or its `data/`.
- **Never commit, branch or push.** Every task ends with green tests and a `git status` review; the owner commits.
- No version bump (`package.json`, `version.json`, HTML strings stay at `0.8.23-beta`).
- No machine-specific paths, tenant names or Odoo-specific logic in committed source. Fixtures are synthetic.
- Every new user-facing string exists in `en, hu, de, es, fr, tlh` (`src/web/src/pages/settings/locales/*.json`, flat keys). Docs changes land in all six `packages/docs/src/content/docs/<lang>/…` trees.
- Imported bodies are verbatim: no size cap, no rewriting, no sanitising, no model-authored body. `inferKind`/`safeImportedKind` never yield `user` for an undeclared note.
- One frontmatter reader (`splitFrontmatter`, leading block only). The regex `/^---[\s\S]*?---\s*/m` must not survive anywhere in `src/modules/data-port`.
- Read-only access to sources; SQLite sources opened with `readonly: true`.
- File headers: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Tests: `bun vitest run <file>`; whole suite `bun run test`; types `bun run lint` (tsc, compare error count against `git stash`-free baseline: run it once before Task 1 and record the number).

## File structure

**Create**
- `src/modules/data-port/source-frontmatter.ts` — `splitFrontmatter`, `readSourceNote`, `extractWikilinkTargets`, `extractQuotedPhrases`, `declaredKindOf`.
- `src/modules/data-port/memory-index-hooks.ts` — `isMemoryIndexBasename`, `parseMemoryIndex`.
- `src/modules/data-port/adapters/types.ts` — `SourceNote`, `ProviderAdapter`, `ExpandedUnit`, `AdapterHint`.
- `src/modules/data-port/adapters/registry.ts` — ordered adapter list, `detectProfile`, `classifyFile`, `adapterFor`, `listProfiles`.
- `src/modules/data-port/adapters/{generic,claude-code,grok-cli,obsidian,cursor,gemini-cli,windsurf,copilot,codex,chat-export,eyas-export}.ts`.
- `src/modules/data-port/skill-package.ts` — `collectSkillAssets`, `assembleSkillContent`, `deriveTriggers`, `fenceLanguage`.
- `src/modules/data-port/persona.ts` — `mapToolNames`, `personaFromMarkdown`.
- `src/modules/data-port/ledger.ts` — `recordApplied`, `listApplied`, `deleteApplied`.
- `src/modules/data-port/rollback.ts` — `rollbackJob`.
- Tests under `tests/modules/data-port/` (one file per module above) and `tests/modules/data-port/adapters/`.

**Modify**
- `src/modules/data-port/{types,constants,schema,service,routes,index}.ts`, `scanners/{heuristics,scan-path}.ts`, `pipeline/{transform,apply}.ts`.
- `src/modules/agent/persona-import.ts` (export the parser), `src/modules/agent/conversation-runner.ts` (index accessor), `src/modules/agent/index.ts` (wire accessor).
- `src/modules/memory/memory-index.ts`, `src/modules/memory/index.ts`, `src/core/config/schema.ts`, `config/default.yaml`.
- `src/web/src/pages/settings/data-port-card.tsx`, `src/web/src/pages/settings/locales/*.json`.
- `packages/docs/src/content/docs/*/admin/data-port.md`, `*/knowledge/memory.md`, `*/deploy/configuration.md`, `CHANGELOG.md`.

---

## Phase 1 — Reading sources faithfully

### Task 1: Shared frontmatter reader and `SourceNote`

**Files:**
- Create: `src/modules/data-port/adapters/types.ts`
- Create: `src/modules/data-port/source-frontmatter.ts`
- Test: `tests/modules/data-port/source-frontmatter.test.ts`

**Interfaces:**
- Produces: `splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string; hadFrontmatter: boolean }`; `readSourceNote(relativePath: string, raw: string, times?: { mtime?: string; birthtime?: string }): SourceNote`; `extractWikilinkTargets(body: string): string[]`; `extractQuotedPhrases(text: string): string[]`; `declaredKindOf(data: Record<string, unknown>): ImportedNoteKind | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/source-frontmatter.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  splitFrontmatter, readSourceNote, extractWikilinkTargets, extractQuotedPhrases, declaredKindOf,
} from '@modules/data-port/source-frontmatter'

describe('splitFrontmatter', () => {
  it('splits only a LEADING frontmatter block', () => {
    const r = splitFrontmatter('---\nname: a\ntype: feedback\n---\nBody line.\n')
    expect(r.hadFrontmatter).toBe(true)
    expect(r.data).toEqual({ name: 'a', type: 'feedback' })
    expect(r.body).toBe('Body line.')
  })
  it('leaves a body with horizontal rules untouched when there is no frontmatter', () => {
    const raw = 'Intro\n\n---\n\n- a\n- b\n\n---\n\nprose after'
    const r = splitFrontmatter(raw)
    expect(r.hadFrontmatter).toBe(false)
    expect(r.body).toBe(raw.trim())
  })
  it('keeps a table separator and a mid-body rule inside a note WITH frontmatter', () => {
    const raw = '---\ntitle: t\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\ntail'
    expect(splitFrontmatter(raw).body).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\ntail')
  })
  it('survives invalid YAML by treating the file as body', () => {
    const raw = '---\n: : bad\n---\nx'
    const r = splitFrontmatter(raw)
    expect(r.hadFrontmatter).toBe(false)
    expect(r.body).toBe(raw)
  })
})

describe('declaredKindOf', () => {
  it('reads type, metadata.type and kind; ignores unknown values', () => {
    expect(declaredKindOf({ type: 'user' })).toBe('user')
    expect(declaredKindOf({ metadata: { type: 'feedback' } })).toBe('feedback')
    expect(declaredKindOf({ kind: 'project' })).toBe('project')
    expect(declaredKindOf({ type: 'claude-session' })).toBeNull()
    expect(declaredKindOf({ node_type: 'memory' })).toBeNull()
  })
})

describe('readSourceNote', () => {
  it('maps Claude Code memory frontmatter', () => {
    const raw = '---\nname: user_profile\ndescription: Who the owner is\ntype: user\nmetadata:\n  modified: 2026-08-28T13:36:52.270Z\n---\nSenior dev. See [[company_identity]] and [[feedback_x|alias]].\n'
    const n = readSourceNote('ai-memory/user_profile.md', raw, { mtime: '2026-09-01T10:00:00.000Z', birthtime: '2026-03-01T10:00:00.000Z' })
    expect(n.declaredKind).toBe('user')
    expect(n.name).toBe('user_profile')
    expect(n.title).toBe('user_profile')
    expect(n.description).toBe('Who the owner is')
    expect(n.links).toEqual(['company_identity', 'feedback_x'])
    expect(n.created).toBe('2026-03-01')
    expect(n.updated).toBe('2026-08-28')
    expect(n.body).toBe('Senior dev. See [[company_identity]] and [[feedback_x|alias]].')
    expect(n.data).toEqual({ name: 'user_profile', description: 'Who the owner is', type: 'user', metadata: { modified: '2026-08-28T13:36:52.270Z' } })
  })
  it('prefers frontmatter title, then H1, then name, then basename', () => {
    expect(readSourceNote('x/a_b.md', '# Heading One\ntext').title).toBe('Heading One')
    expect(readSourceNote('x/a_b.md', 'text only').title).toBe('a_b')
    expect(readSourceNote('x/SKILL.md', 'text only').title).toBe('x')
  })
  it('extracts session id and date from session-note frontmatter', () => {
    const raw = '---\ndate: 2026-09-05\ntime: "11:06"\ntype: grok-session\nsession_id: "01a070d1-bacb-7790-938d-8017f41ec3ae"\n---\nlog'
    const n = readSourceNote('claude-sessions/2026-09/x_g01a070d1.md', raw)
    expect(n.sessionId).toBe('01a070d1-bacb-7790-938d-8017f41ec3ae')
    expect(n.sessionDate).toBe('2026-09-05T11:06:00.000Z')
    expect(n.declaredKind).toBeNull()
  })
})

describe('helpers', () => {
  it('extractWikilinkTargets strips alias and heading parts and dedupes', () => {
    expect(extractWikilinkTargets('[[a]] [[a|x]] [[b#h]] [[c#h|y]]')).toEqual(['a', 'b', 'c'])
  })
  it('extractQuotedPhrases reads straight, typographic and Hungarian quotes', () => {
    expect(extractQuotedPhrases('Use when: user says "ticket 123", „nézd meg a 456-os ticketet”, or ‘odoo ticket’.'))
      .toEqual(['ticket 123', 'nézd meg a 456-os ticketet', 'odoo ticket'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/source-frontmatter.test.ts`
Expected: FAIL — cannot resolve `@modules/data-port/source-frontmatter`.

- [ ] **Step 3: Write the types**

```ts
// src/modules/data-port/adapters/types.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CandidateKind, CandidateTarget, ImportedNoteKind, SourceProfile } from '../types.js'

/** One importable unit, read faithfully from a source file. */
export interface SourceNote {
  /** Everything after the leading frontmatter, trimmed of outer whitespace only. */
  body: string
  hadFrontmatter: boolean
  /** The original frontmatter object, verbatim. */
  data: Record<string, unknown>
  declaredKind: ImportedNoteKind | null
  title: string
  name: string | null
  description: string | null
  tags: string[]
  aliases: string[]
  links: string[]
  /** YYYY-MM-DD or null when nothing in the file or the fs says so. */
  created: string | null
  updated: string | null
  sessionId: string | null
  /** ISO timestamp for episodic validFrom. */
  sessionDate: string | null
}

export interface AdapterHint {
  kind: CandidateKind
  target: CandidateTarget
  confidence: number
  reason: string
  selectedByDefault: boolean
}

/** A unit inside a container file (one conversation in a JSON export, one row in a SQLite memory). */
export interface ExpandedUnit {
  unit: string
  title: string
  preview: string
  bytes: number
  hint: AdapterHint
  /** Rendered markdown for this unit; kept in memory during the scan only. */
  content: string
  sessionId?: string | null
  sessionDate?: string | null
}

export interface ProviderAdapter {
  id: SourceProfile
  /** Root hints shown in the wizard, `~`-relative, product-neutral. */
  rootHints: string[]
  /** 0..1 — how strongly a scanned path list looks like this provider. */
  detect(relPaths: string[]): number
  /** null = not mine; the registry asks the next adapter. `head` = first 4 000 chars. */
  classify(rel: string, head: string): AdapterHint | null
  /** Split a container file into units. Absent = one unit per file. */
  expand?(rel: string, raw: Buffer): ExpandedUnit[]
  /** Build the SourceNote for a unit. Absent = readSourceNote on the whole file. */
  read?(rel: string, raw: Buffer, unit: string | null, times?: { mtime?: string; birthtime?: string }): SourceNote
}
```

- [ ] **Step 4: Write the reader**

```ts
// src/modules/data-port/source-frontmatter.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import matter from 'gray-matter'
import { basename, dirname } from 'node:path'
import type { ImportedNoteKind } from './types.js'
import type { SourceNote } from './adapters/types.js'

const NOTE_KINDS = new Set<ImportedNoteKind>(['user', 'feedback', 'domain', 'project', 'reference'])

/** Leading frontmatter only. A `---` rule later in the body is body. */
export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string; hadFrontmatter: boolean } {
  if (!raw.startsWith('---')) return { data: {}, body: raw.trim(), hadFrontmatter: false }
  try {
    const parsed = matter(raw)
    const hasBlock = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.test(raw)
    if (!hasBlock) return { data: {}, body: raw.trim(), hadFrontmatter: false }
    const data = parsed.data && typeof parsed.data === 'object' ? (parsed.data as Record<string, unknown>) : {}
    return { data, body: parsed.content.trim(), hadFrontmatter: true }
  } catch {
    return { data: {}, body: raw.trim(), hadFrontmatter: false }
  }
}

export function declaredKindOf(data: Record<string, unknown>): ImportedNoteKind | null {
  const meta = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}
  for (const v of [data.kind, data.type, meta.type]) {
    if (typeof v === 'string' && NOTE_KINDS.has(v as ImportedNoteKind)) return v as ImportedNoteKind
  }
  return null
}

export function extractWikilinkTargets(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const t = m[1].trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

/** "…", „…”, ‘…’, '…' — trigger vocabulary written into a description. */
export function extractQuotedPhrases(text: string): string[] {
  const out: string[] = []
  // „…" (Hungarian opening with a straight closing quote) is common in hand-written descriptions.
  for (const m of text.matchAll(/"([^"\n]{2,80})"|„([^"”\n]{2,80})["”]|‘([^’\n]{2,80})’|'([^'\n]{2,80})'/g)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  return out
}

function isoDay(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function stringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  return []
}

function titleOf(rel: string, data: Record<string, unknown>, body: string): string {
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim()
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1?.[1]) return h1[1].trim().slice(0, 200)
  if (typeof data.name === 'string' && data.name.trim()) return data.name.trim()
  const base = basename(rel).replace(/\.(md|markdown|txt|mdc)$/i, '')
  if (base.toLowerCase() === 'skill') return basename(dirname(rel)) || base
  return base
}

function sessionDateOf(data: Record<string, unknown>): string | null {
  const day = isoDay(data.date)
  if (!day) return null
  const time = typeof data.time === 'string' && /^\d{1,2}:\d{2}$/.test(data.time.trim()) ? data.time.trim() : '00:00'
  const [h, m] = time.split(':').map(Number)
  return `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`
}

export function readSourceNote(
  relativePath: string,
  raw: string,
  times: { mtime?: string; birthtime?: string } = {},
): SourceNote {
  const { data, body, hadFrontmatter } = splitFrontmatter(raw)
  const meta = data.metadata && typeof data.metadata === 'object' ? (data.metadata as Record<string, unknown>) : {}
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : null
  const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null
  const sessionId = typeof data.session_id === 'string' ? data.session_id.trim()
    : typeof data.sessionId === 'string' ? data.sessionId.trim() : null
  return {
    body,
    hadFrontmatter,
    data,
    declaredKind: declaredKindOf(data),
    title: titleOf(relativePath, data, body),
    name,
    description,
    tags: stringList(data.tags),
    aliases: stringList(data.aliases),
    links: extractWikilinkTargets(body),
    created: isoDay(data.created) ?? isoDay(meta.created) ?? isoDay(data.date) ?? isoDay(times.birthtime) ?? isoDay(times.mtime),
    updated: isoDay(meta.modified) ?? isoDay(data.updated) ?? isoDay(data.modified) ?? isoDay(times.mtime),
    sessionId: sessionId || null,
    sessionDate: sessionDateOf(data),
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun vitest run tests/modules/data-port/source-frontmatter.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Review the diff, do not commit**

Run: `git status --short && git diff --stat`
Expected: two new source files, one new test file. Leave uncommitted.

---

### Task 2: MEMORY.md hook parser

**Files:**
- Create: `src/modules/data-port/memory-index-hooks.ts`
- Test: `tests/modules/data-port/memory-index-hooks.test.ts`

**Interfaces:**
- Produces: `isMemoryIndexBasename(relativePath: string): boolean`; `parseMemoryIndex(markdown: string): { entries: Map<string, { hooks: string[]; section: string | null }>; count: number }` keyed by the linked file's basename without `.md`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/memory-index-hooks.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { isMemoryIndexBasename, parseMemoryIndex } from '@modules/data-port/memory-index-hooks'

const INDEX = `# Memory Index
Globally shared. One line per entry.

## User
- [Senior dev at eYssen](user_profile.md) · [Grok + Claude shared setup](grok-claude-shared-setup.md)
## Feedback — Global (workflow rules)
- [Scan memory at task start](feedback_always_check_memory.md) · [No fluff](feedback_terse_output.md)
- Pod/local: [DEFAULT local](feedback_default_local_dev.md) · [pod mention ≠ write](feedback_pod_vs_local.md)
## Project — eyssen-erp
- [prefix-drop plan READY](project_prefix_plan.md)
- [second hook for same file](project_prefix_plan.md)
`

describe('memory index hooks', () => {
  it('recognises MEMORY.md by basename only', () => {
    expect(isMemoryIndexBasename('.grok/memory/MEMORY.md')).toBe(true)
    expect(isMemoryIndexBasename('ai-memory/memory.md')).toBe(true)
    expect(isMemoryIndexBasename('ai-memory/feedback_no_auto_commit.md')).toBe(false)
  })
  it('collects every hook per file with its section', () => {
    const r = parseMemoryIndex(INDEX)
    expect(r.count).toBe(8)
    expect(r.entries.get('user_profile')).toEqual({ hooks: ['Senior dev at eYssen'], section: 'User' })
    expect(r.entries.get('feedback_pod_vs_local')).toEqual({ hooks: ['pod mention ≠ write'], section: 'Feedback — Global (workflow rules)' })
    expect(r.entries.get('project_prefix_plan')).toEqual({ hooks: ['prefix-drop plan READY', 'second hook for same file'], section: 'Project — eyssen-erp' })
  })
  it('accepts wikilink-style indexes too', () => {
    const r = parseMemoryIndex('## A\n- [[alpha]] — first fact\n- [[beta|Beta note]]\n')
    expect(r.entries.get('alpha')).toEqual({ hooks: ['first fact'], section: 'A' })
    expect(r.entries.get('beta')).toEqual({ hooks: ['Beta note'], section: 'A' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/memory-index-hooks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the parser**

```ts
// src/modules/data-port/memory-index-hooks.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface IndexEntry { hooks: string[]; section: string | null }

export function isMemoryIndexBasename(relativePath: string): boolean {
  const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath
  return base.toLowerCase() === 'memory.md'
}

function keyOf(link: string): string {
  return link.trim().replace(/^\.\//, '').split('/').pop()!.replace(/\.md$/i, '')
}

/**
 * `- [hook](file.md) · [hook](other.md)` and `- [[file]] — hook` lines under `##` sections.
 * Every hook is kept; a file linked twice gets both.
 */
export function parseMemoryIndex(markdown: string): { entries: Map<string, IndexEntry>; count: number } {
  const entries = new Map<string, IndexEntry>()
  let section: string | null = null
  let count = 0
  const add = (key: string, hook: string) => {
    if (!key) return
    const e = entries.get(key) ?? { hooks: [], section }
    if (hook && !e.hooks.includes(hook)) e.hooks.push(hook)
    if (!entries.has(key)) entries.set(key, e)
    count++
  }
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    const h = line.match(/^#{2,6}\s+(.+)$/)
    if (h) { section = h[1].trim(); continue }
    for (const m of line.matchAll(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g)) add(keyOf(m[2]), m[1].trim())
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]*))?\]\]\s*(?:[—–-]\s*(.+?))?(?=\s*(?:·|\[\[|$))/g)) {
      add(keyOf(m[1]), (m[3] ?? m[2] ?? '').trim())
    }
  }
  return { entries, count }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun vitest run tests/modules/data-port/memory-index-hooks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Review the diff, do not commit**

Run: `git status --short`

---

### Task 3: Adapter registry with the generic, Claude Code, Grok and Obsidian adapters

**Files:**
- Modify: `src/modules/data-port/types.ts` (unions)
- Create: `src/modules/data-port/adapters/registry.ts`, `adapters/generic.ts`, `adapters/claude-code.ts`, `adapters/grok-cli.ts`, `adapters/obsidian.ts`, `adapters/eyas-export.ts`
- Modify: `src/modules/data-port/scanners/heuristics.ts` (delete the bullet-ratio index rule and the session/persona junk rules; keep noise/secrets/skill/rule detection as the generic base)
- Test: `tests/modules/data-port/adapters/registry.test.ts`; modify `tests/modules/data-port/heuristics.test.ts`

**Interfaces:**
- Produces: `SourceProfile` = `'auto' | 'claude-code' | 'grok-cli' | 'cursor' | 'codex' | 'gemini-cli' | 'windsurf' | 'copilot' | 'obsidian' | 'chat-export' | 'eyas-export' | 'generic-md'`; `CandidateKind` gains `'session' | 'persona' | 'index'`; `CandidateTarget` gains `'agent' | 'prompt.project-type'`.
- Produces: `detectProfile(relPaths: string[]): SourceProfile` (never `'auto'`); `classifyFile(rel: string, head: string, profile: SourceProfile): AdapterHint`; `adapterFor(profile: SourceProfile): ProviderAdapter`; `listProfiles(): SourceProfile[]`; `ADAPTERS: ProviderAdapter[]`.
- Consumes from heuristics.ts (kept, exported): `classifyPath`, `isDurableMemoryPath`, `isAssistantSkillPath`, `isAssistantWorkspacePath`, `isSessionDumpPath`, `isImportJunk`, `titleFromPathAndContent`, `previewOf`.

- [ ] **Step 1: Update the unions in `types.ts`**

Replace the `SourceProfile`, `CandidateKind`, `CandidateTarget` declarations with:

```ts
export type SourceProfile =
  | 'auto'
  | 'claude-code'
  | 'grok-cli'
  | 'cursor'
  | 'codex'
  | 'gemini-cli'
  | 'windsurf'
  | 'copilot'
  | 'obsidian'
  | 'chat-export'
  | 'eyas-export'
  | 'generic-md'

export type CandidateKind =
  | 'memory'
  | 'session'
  | 'index'
  | 'skill'
  | 'rule'
  | 'identity'
  | 'persona'
  | 'knowledge'
  | 'noise'
  | 'unknown'

export type CandidateTarget =
  | 'episodic'
  | 'vault.semantic'
  | 'vault.procedural'
  | 'skill'
  | 'agent'
  | 'workspace.agents'
  | 'workspace.soul'
  | 'workspace.identity'
  | 'workspace.tools'
  | 'workspace.memory'
  | 'prompt.project-type'
  | 'none'
```

Add to `ScanCandidate` (after `content?: string`):

```ts
  /** Absolute path on the server; stripped from API responses. */
  sourcePath?: string
  /** Unit inside a container file (conversation id, row id); null for whole files. */
  unit?: string | null
  sha256?: string
  mtime?: string
  birthtime?: string
  /** Files bundled with a SKILL.md, relative to the skill directory. */
  assets?: Array<{ relPath: string; bytes: number; sha256: string }>
  sessionId?: string | null
  sessionDate?: string | null
```

Add to `ImportJobStats`: `unchanged: number`, `aiEnriched: number`, `aiFallback: number`, `skippedReasons: Record<string, number>`.

- [ ] **Step 2: Write the failing registry tests**

```ts
// tests/modules/data-port/adapters/registry.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { detectProfile, classifyFile, listProfiles, adapterFor } from '@modules/data-port/adapters/registry'

const FM_NOTE = '---\nname: x\ndescription: d\ntype: feedback\n---\n- a\n- b\n- c\n- d\n- e\n'

describe('adapter registry', () => {
  it('lists every profile except auto, generic last', () => {
    const p = listProfiles()
    expect(p[0]).toBe('claude-code')
    expect(p[p.length - 1]).toBe('generic-md')
    expect(p).not.toContain('auto')
  })
  it('detects claude-code, grok-cli, obsidian and eyas-export from paths', () => {
    expect(detectProfile(['.claude/CLAUDE.md', 'x.md'])).toBe('claude-code')
    expect(detectProfile(['.grok/AGENTS.md', '.grok/memory/a.md'])).toBe('grok-cli')
    expect(detectProfile(['notes/a.md', '.obsidian/app.json'])).toBe('obsidian')
    expect(detectProfile(['manifest.json', 'vault/semantic/a.md'])).toBe('eyas-export')
    expect(detectProfile(['readme.md'])).toBe('generic-md')
  })
  it('never drops a bullet-heavy note as an index', () => {
    const h = classifyFile('ai-memory/feedback_odoo_means_fork.md', FM_NOTE, 'claude-code')
    expect(h.kind).toBe('memory')
    expect(h.target).toBe('vault.semantic')
    expect(h.selectedByDefault).toBe(true)
  })
  it('classifies MEMORY.md as an index unit, importable as one note', () => {
    const h = classifyFile('.grok/memory/MEMORY.md', '# Memory Index\n- [a](a.md)\n- [b](b.md)\n- [c](c.md)\n- [d](d.md)\n', 'grok-cli')
    expect(h).toMatchObject({ kind: 'index', target: 'vault.semantic', selectedByDefault: true })
  })
  it('routes session notes to episodic, unselected, and Grok project summaries selected', () => {
    const vaultSession = classifyFile('Documents/Vault/99_Meta/claude-sessions/2026-09/x.md', '---\ntype: grok-session\n---\nlog', 'obsidian')
    expect(vaultSession).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: false })
    const grokSummary = classifyFile('.grok/memory/proj-1234abcd/sessions/2026-09-05-x-01a0abcd.md', '## Session Summary\n\n- **Messages:** 1 user', 'grok-cli')
    expect(grokSummary).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: true })
  })
  it('routes .claude/agents personas to the agent target', () => {
    const h = classifyFile('.claude/agents/developer.md', '---\nname: developer\ndescription: Senior dev\ntools:\n  - Read\n---\nYou are…', 'claude-code')
    expect(h).toMatchObject({ kind: 'persona', target: 'agent', selectedByDefault: true })
  })
  it('keeps skills and rules from the base heuristics', () => {
    expect(classifyFile('.claude/skills/odoo-ticket/SKILL.md', '---\nname: odoo-ticket\n---\n# T', 'claude-code').kind).toBe('skill')
    expect(classifyFile('.claude/CLAUDE.md', '# rules', 'claude-code')).toMatchObject({ kind: 'rule', target: 'workspace.agents' })
  })
  it('flags Grok index.sqlite as noise with a reason, not silently', () => {
    const h = classifyFile('.grok/memory/proj-1/index.sqlite', '', 'grok-cli')
    expect(h.kind).toBe('noise')
    expect(h.reason).toMatch(/derived/i)
  })
  it('adapterFor falls back to generic for unknown ids', () => {
    expect(adapterFor('generic-md').id).toBe('generic-md')
    expect(adapterFor('auto').id).toBe('generic-md')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/adapters/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Trim `heuristics.ts`**

In `src/modules/data-port/scanners/heuristics.ts`:
1. Delete `INDEX_SKIP` and the body of `isMemoryIndexFile` — replace the function with:
```ts
/** Only a file literally named MEMORY.md is an index. Bullet-heavy notes are notes. */
export function isMemoryIndexFile(relativePath: string, _content: string): boolean {
  const base = posix(relativePath).split('/').pop() ?? ''
  return base === 'memory.md'
}
```
2. In `isImportJunk`, delete the two lines that return `true` for `isSessionDumpPath(relativePath)` and for the `type: claude-session|grok-session` frontmatter. Keep `isSessionDumpPath` exported.
3. In `classifyPath`, replace the line `if (isMemoryIndexFile(relativePath, content)) return INDEX_SKIP` with:
```ts
  if (isMemoryIndexFile(relativePath, content)) {
    return { kind: 'index', target: 'vault.semantic', confidence: 0.95, reason: 'One-line memory index — imported as one note; its hooks become note summaries', selectedByDefault: true }
  }
```
4. Replace every occurrence of `content.replace(/^---[\s\S]*?---\s*/m, '')` in this file (`isMemoryIndexFile` no longer has one; `previewOf` has one) with `splitFrontmatter(content).body` — add `import { splitFrontmatter } from '../source-frontmatter.js'` at the top.
5. Before the `looksLikeVaultNote` block, add the session and persona rules:
```ts
  const sessionByPath = isSessionDumpPath(relativePath) || /(^|\/)\.grok\/memory\/[^/]+\/sessions\//.test(p)
  const sessionByFm = /^---[\s\S]*?\btype:\s*(claude-session|grok-session|session)\b/i.test(content.slice(0, 600))
  if (sessionByPath || sessionByFm) {
    const grokSummary = /(^|\/)\.grok\/memory\/[^/]+\/sessions\//.test(p)
    return {
      kind: 'session',
      target: 'episodic',
      confidence: 0.85,
      reason: grokSummary ? 'Assistant session summary (structured memory)' : 'Session transcript note',
      selectedByDefault: grokSummary,
    }
  }
  if (/(^|\/)\.(claude|grok|agents)\/agents\/[^/]+\.md$/.test(p) || /(^|\/)\.github\/agents\/[^/]+\.agent\.md$/.test(p)) {
    return { kind: 'persona', target: 'agent', confidence: 0.9, reason: 'Agent persona (frontmatter + prompt body)', selectedByDefault: true }
  }
  if (base.endsWith('.sqlite') || base.endsWith('.sqlite-wal') || base.endsWith('.sqlite-shm') || base.endsWith('.pb')) {
    return { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Derived index / binary state — not importable text', selectedByDefault: false }
  }
```
   (Place the `.sqlite`/`.pb` rule *before* the generic binary list so the reason is specific; remove `.sqlite`/`.db` from that generic list.)
6. In `isDurableMemoryPath` add `p.includes('/.codex/') && p.includes('/memories')` — no: leave; Codex is handled by its adapter in Task 5.

- [ ] **Step 5: Write the adapters and the registry**

```ts
// src/modules/data-port/adapters/generic.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

/** Last in the chain: plain markdown/text, declared frontmatter honoured downstream. */
export const genericAdapter: ProviderAdapter = {
  id: 'generic-md',
  rootHints: ['~/notes'],
  detect: () => 0.01,
  classify: (rel, head) => classifyPath(rel, head, 'generic-md'),
}
```

```ts
// src/modules/data-port/adapters/claude-code.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export const claudeCodeAdapter: ProviderAdapter = {
  id: 'claude-code',
  rootHints: ['~/.claude', '~/.claude/projects/<project>/memory', '~/.claude/skills', '~/.claude/agents'],
  detect: (paths) => {
    const l = paths.map(posix)
    if (l.some((p) => p === 'claude.md' || p.startsWith('.claude/') || p.includes('/.claude/'))) return 0.9
    return 0
  },
  classify: (rel, head) => {
    const p = posix(rel)
    if (!(p.startsWith('.claude/') || p.includes('/.claude/') || p === 'claude.md')) return null
    if (/\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/.test(p)) {
      return { kind: 'session', target: 'episodic', confidence: 0.8, reason: 'Claude Code transcript (JSONL)', selectedByDefault: false }
    }
    if (/\.claude\/commands\/[^/]+\.md$/.test(p)) {
      return { kind: 'skill', target: 'skill', confidence: 0.85, reason: 'Slash command — imported as a skill', selectedByDefault: true }
    }
    if (/\.claude\/memory\/[^/]+\.md$/.test(p) || /\.claude\/projects\/[^/]+\/memory\//.test(p)) {
      return classifyPath(rel, head, 'claude-code')
    }
    return classifyPath(rel, head, 'claude-code')
  },
}
```

```ts
// src/modules/data-port/adapters/grok-cli.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export const grokCliAdapter: ProviderAdapter = {
  id: 'grok-cli',
  rootHints: ['~/.grok', '~/.grok/memory', '~/.grok/memory/<project>/sessions'],
  detect: (paths) => (paths.map(posix).some((p) => p.startsWith('.grok/') || p.includes('/.grok/')) ? 0.85 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    if (!(p.startsWith('.grok/') || p.includes('/.grok/'))) return null
    if (/\.grok\/memory\/[^/]+\/memory\.md$/.test(p)) {
      return { kind: 'index', target: 'vault.semantic', confidence: 0.9, reason: 'Per-project memory index — imported as one note', selectedByDefault: true }
    }
    return classifyPath(rel, head, 'grok-cli')
  },
}
```

```ts
// src/modules/data-port/adapters/obsidian.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

export const obsidianAdapter: ProviderAdapter = {
  id: 'obsidian',
  rootHints: ['~/Documents/<Vault>', '~/Documents/<Vault>/ai-memory'],
  detect: (paths) => (paths.some((p) => p.toLowerCase().includes('.obsidian/')) ? 0.8 : 0),
  classify: (rel, head) => classifyPath(rel, head, 'obsidian'),
}
```

```ts
// src/modules/data-port/adapters/eyas-export.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

export const eyasExportAdapter: ProviderAdapter = {
  id: 'eyas-export',
  rootHints: ['<unzipped eyas-export-v1 bundle>'],
  detect: (paths) => {
    const l = paths.map((p) => p.toLowerCase())
    return l.includes('manifest.json') && l.some((p) => p.startsWith('vault/')) ? 0.95 : 0
  },
  classify: (rel, head) => classifyPath(rel, head, 'eyas-export'),
}
```

```ts
// src/modules/data-port/adapters/registry.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { SourceProfile } from '../types.js'
import type { AdapterHint, ProviderAdapter } from './types.js'
import { claudeCodeAdapter } from './claude-code.js'
import { grokCliAdapter } from './grok-cli.js'
import { cursorAdapter } from './cursor.js'
import { codexAdapter } from './codex.js'
import { geminiCliAdapter } from './gemini-cli.js'
import { windsurfAdapter } from './windsurf.js'
import { copilotAdapter } from './copilot.js'
import { obsidianAdapter } from './obsidian.js'
import { chatExportAdapter } from './chat-export.js'
import { eyasExportAdapter } from './eyas-export.js'
import { genericAdapter } from './generic.js'

/** Specific adapters first; generic answers when nobody else does. */
export const ADAPTERS: ProviderAdapter[] = [
  claudeCodeAdapter,
  grokCliAdapter,
  cursorAdapter,
  codexAdapter,
  geminiCliAdapter,
  windsurfAdapter,
  copilotAdapter,
  obsidianAdapter,
  chatExportAdapter,
  eyasExportAdapter,
  genericAdapter,
]

export function listProfiles(): SourceProfile[] {
  return ADAPTERS.map((a) => a.id)
}

export function adapterFor(profile: SourceProfile): ProviderAdapter {
  return ADAPTERS.find((a) => a.id === profile) ?? genericAdapter
}

export function detectProfile(relPaths: string[]): SourceProfile {
  let best: ProviderAdapter = genericAdapter
  let score = 0
  for (const a of ADAPTERS) {
    const s = a.detect(relPaths)
    if (s > score) { score = s; best = a }
  }
  return best.id
}

/** The chosen profile's adapter first, then every other specific adapter, then generic. */
export function classifyFile(rel: string, head: string, profile: SourceProfile): AdapterHint {
  const chosen = adapterFor(profile)
  const order = [chosen, ...ADAPTERS.filter((a) => a !== chosen && a !== genericAdapter), genericAdapter]
  for (const a of order) {
    const h = a.classify(rel, head)
    if (h) return h
  }
  return genericAdapter.classify(rel, head)!
}
```

Until Tasks 4–6 exist, create the five missing adapter files as one-line stubs that return `null` from `classify` and `0` from `detect` so the registry compiles (each stub is replaced by its task):

```ts
// src/modules/data-port/adapters/cursor.ts  (same shape for codex, gemini-cli, windsurf, copilot, chat-export)
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { ProviderAdapter } from './types.js'
export const cursorAdapter: ProviderAdapter = { id: 'cursor', rootHints: [], detect: () => 0, classify: () => null }
```

- [ ] **Step 6: Update `heuristics.test.ts`**

Replace the test `skips MEMORY.md index files instead of importing them as one note` with:

```ts
  it('imports MEMORY.md as one index unit and never drops a bullet-heavy note', () => {
    const idx = classifyPath('.grok/memory/MEMORY.md', '# Memory\n- [a](a.md)\n- [b](b.md)\n- [c](c.md)\n- [d](d.md)\n', 'claude-code')
    expect(idx.kind).toBe('index')
    expect(idx.target).toBe('vault.semantic')
    const note = classifyPath('ai-memory/feedback_x.md', '---\ntype: feedback\n---\n- a\n- b\n- c\n- d\n- e\n', 'claude-code')
    expect(note.kind).toBe('memory')
  })
```

Replace `skips claude-sessions transcripts — they are chat logs, not durable notes` with:

```ts
  it('routes claude-sessions transcripts to episodic, unselected by default', () => {
    const h = classifyPath('99_Meta/claude-sessions/2026-08/x.md', '---\ntype: claude-session\n---\n## User\nhi', 'obsidian')
    expect(h).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: false })
  })
```

- [ ] **Step 7: Run both test files**

Run: `bun vitest run tests/modules/data-port/adapters/registry.test.ts tests/modules/data-port/heuristics.test.ts`
Expected: PASS.

- [ ] **Step 8: Type-check and review**

Run: `bun run lint 2>&1 | tail -3` (error count must not exceed the baseline recorded before Task 1) and `git status --short`.

---

### Task 4: Cursor, Gemini CLI, Windsurf and Copilot adapters

**Files:**
- Create (replace stubs): `src/modules/data-port/adapters/cursor.ts`, `gemini-cli.ts`, `windsurf.ts`, `copilot.ts`
- Test: `tests/modules/data-port/adapters/rule-providers.test.ts`

**Interfaces:**
- Consumes: `ProviderAdapter`, `AdapterHint` (Task 1), `classifyPath` (heuristics).
- Produces: four adapters registered in `ADAPTERS` (Task 3 already imports them by name: `cursorAdapter`, `geminiCliAdapter`, `windsurfAdapter`, `copilotAdapter`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/adapters/rule-providers.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { cursorAdapter } from '@modules/data-port/adapters/cursor'
import { geminiCliAdapter } from '@modules/data-port/adapters/gemini-cli'
import { windsurfAdapter } from '@modules/data-port/adapters/windsurf'
import { copilotAdapter } from '@modules/data-port/adapters/copilot'

describe('cursor adapter', () => {
  it('detects .cursor trees and .cursorrules', () => {
    expect(cursorAdapter.detect(['.cursor/rules/a.mdc'])).toBeGreaterThan(0.5)
    expect(cursorAdapter.detect(['.cursorrules'])).toBeGreaterThan(0.5)
    expect(cursorAdapter.detect(['x.md'])).toBe(0)
  })
  it('classifies .mdc rules with alwaysApply as global rules and scoped ones as rules too', () => {
    expect(cursorAdapter.classify('.cursor/rules/odoo.mdc', '---\ndescription: d\nalwaysApply: true\n---\n# r'))
      .toMatchObject({ kind: 'rule', target: 'workspace.agents', selectedByDefault: true })
    expect(cursorAdapter.classify('.cursor/rules/py.mdc', '---\nglobs: ["**/*.py"]\n---\n# r')?.reason).toMatch(/globs/)
  })
  it('classifies skills-cursor SKILL.md as skill and agent transcripts as sessions', () => {
    expect(cursorAdapter.classify('.cursor/skills-cursor/shell/SKILL.md', '# Run')?.kind).toBe('skill')
    expect(cursorAdapter.classify('.cursor/projects/p/agent-transcripts/abc/abc.jsonl', '{"role":"user"}'))
      .toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: false })
  })
  it('leaves non-cursor paths to the next adapter', () => {
    expect(cursorAdapter.classify('notes/a.md', 'x')).toBeNull()
  })
})

describe('gemini-cli adapter', () => {
  it('detects GEMINI.md and classifies it as a rule', () => {
    expect(geminiCliAdapter.detect(['.gemini/GEMINI.md'])).toBeGreaterThan(0.5)
    expect(geminiCliAdapter.classify('.gemini/GEMINI.md', '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents' })
    expect(geminiCliAdapter.classify('GEMINI.md', '# rules')).toMatchObject({ kind: 'rule' })
  })
  it('flags Antigravity state as noise with a reason', () => {
    expect(geminiCliAdapter.classify('.gemini/antigravity/implicit/x.pb', '')?.kind).toBe('noise')
  })
})

describe('windsurf adapter', () => {
  it('maps global_rules, memories and workflows', () => {
    expect(windsurfAdapter.classify('.codeium/memories/global_rules.md', '# r')).toMatchObject({ kind: 'rule', target: 'workspace.agents' })
    expect(windsurfAdapter.classify('.codeium/windsurf/memories/fact.md', 'fact')).toMatchObject({ kind: 'memory', target: 'vault.semantic' })
    expect(windsurfAdapter.classify('.codeium/windsurf/workflows/pr.md', '# wf')).toMatchObject({ kind: 'skill', target: 'skill' })
    expect(windsurfAdapter.classify('.windsurf/rules/a.md', '# r')).toMatchObject({ kind: 'rule' })
  })
})

describe('copilot adapter (documented shape)', () => {
  it('maps instructions and agents', () => {
    expect(copilotAdapter.classify('.github/copilot-instructions.md', '# r')).toMatchObject({ kind: 'rule', target: 'workspace.agents' })
    expect(copilotAdapter.classify('.github/instructions/py.instructions.md', '---\napplyTo: "**/*.py"\n---\n# r')?.reason).toMatch(/applyTo/)
    expect(copilotAdapter.classify('.github/agents/reviewer.agent.md', '---\nname: r\n---\nbody')).toMatchObject({ kind: 'persona', target: 'agent' })
    expect(copilotAdapter.rootHints.join(' ')).toMatch(/unverified/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/adapters/rule-providers.test.ts`
Expected: FAIL — stubs return null.

- [ ] **Step 3: Write the adapters**

```ts
// src/modules/data-port/adapters/cursor.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import { splitFrontmatter } from '../source-frontmatter.js'
import type { ProviderAdapter } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',
  rootHints: ['~/.cursor', '<repo>/.cursor/rules', '<repo>/.cursorrules'],
  detect: (paths) => {
    const l = paths.map(posix)
    return l.some((p) => p === '.cursorrules' || p.startsWith('.cursor/') || p.includes('/.cursor/')) ? 0.85 : 0
  },
  classify: (rel, head) => {
    const p = posix(rel)
    const inCursor = p === '.cursorrules' || p.startsWith('.cursor/') || p.includes('/.cursor/')
    if (!inCursor) return null
    if (p.endsWith('.mdc') || p === '.cursorrules') {
      const { data } = splitFrontmatter(head)
      const globs = Array.isArray(data.globs) ? data.globs.map(String).join(', ') : typeof data.globs === 'string' ? data.globs : ''
      const always = data.alwaysApply === true
      return {
        kind: 'rule',
        target: 'workspace.agents',
        confidence: 0.9,
        reason: always ? 'Cursor rule (alwaysApply)' : globs ? `Cursor rule scoped by globs: ${globs}` : 'Cursor rule',
        selectedByDefault: true,
      }
    }
    if (/\/agent-transcripts\/[^/]+\/[^/]+\.jsonl$/.test(p)) {
      return { kind: 'session', target: 'episodic', confidence: 0.8, reason: 'Cursor agent transcript (JSONL)', selectedByDefault: false }
    }
    return classifyPath(rel, head, 'cursor')
  },
}
```

```ts
// src/modules/data-port/adapters/gemini-cli.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export const geminiCliAdapter: ProviderAdapter = {
  id: 'gemini-cli',
  rootHints: ['~/.gemini', '<repo>/GEMINI.md'],
  detect: (paths) => (paths.map(posix).some((p) => p === 'gemini.md' || p.startsWith('.gemini/') || p.includes('/.gemini/')) ? 0.8 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    const base = p.split('/').pop() ?? p
    if (base === 'gemini.md') {
      return { kind: 'rule', target: 'workspace.agents', confidence: 0.9, reason: 'Gemini CLI context / memory file', selectedByDefault: true }
    }
    if (!(p.startsWith('.gemini/') || p.includes('/.gemini/'))) return null
    if (p.includes('/antigravity/')) {
      return { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Antigravity IDE state (protobuf / lock) — not importable text', selectedByDefault: false }
    }
    return classifyPath(rel, head, 'gemini-cli')
  },
}
```

```ts
// src/modules/data-port/adapters/windsurf.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { classifyPath } from '../scanners/heuristics.js'
import type { ProviderAdapter } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

export const windsurfAdapter: ProviderAdapter = {
  id: 'windsurf',
  rootHints: ['~/.codeium/windsurf', '~/.codeium/memories', '<repo>/.windsurf/rules'],
  detect: (paths) => (paths.map(posix).some((p) => p.includes('.codeium/') || p.includes('.windsurf/')) ? 0.8 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    if (!(p.includes('.codeium/') || p.includes('.windsurf/'))) return null
    if (/\.codeium\/memories\/global_rules\.md$/.test(p) || /\.windsurf\/rules\/[^/]+\.md$/.test(p)) {
      return { kind: 'rule', target: 'workspace.agents', confidence: 0.9, reason: 'Windsurf rules', selectedByDefault: true }
    }
    if (/\.codeium\/windsurf\/memories\/[^/]+\.md$/.test(p)) {
      return { kind: 'memory', target: 'vault.semantic', confidence: 0.85, reason: 'Windsurf memory', selectedByDefault: true }
    }
    if (/\.codeium\/windsurf\/workflows\/[^/]+\.md$/.test(p)) {
      return { kind: 'skill', target: 'skill', confidence: 0.85, reason: 'Windsurf workflow — imported as a skill', selectedByDefault: true }
    }
    if (/\.md$/.test(p)) return classifyPath(rel, head, 'windsurf')
    return { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Codeium state / cache — not importable text', selectedByDefault: false }
  },
}
```

```ts
// src/modules/data-port/adapters/copilot.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { splitFrontmatter } from '../source-frontmatter.js'
import type { ProviderAdapter } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** Documented shape only (no real tree was available when written) — see rootHints. */
export const copilotAdapter: ProviderAdapter = {
  id: 'copilot',
  rootHints: ['<repo>/.github/copilot-instructions.md', '<repo>/.github/instructions', '<repo>/.github/agents (unverified shape)'],
  detect: (paths) => (paths.map(posix).some((p) => p.endsWith('.github/copilot-instructions.md') || p.includes('.github/instructions/')) ? 0.75 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    if (!p.includes('.github/')) return null
    if (p.endsWith('copilot-instructions.md')) {
      return { kind: 'rule', target: 'workspace.agents', confidence: 0.9, reason: 'Copilot repository instructions', selectedByDefault: true }
    }
    if (/\.github\/instructions\/[^/]+\.instructions\.md$/.test(p)) {
      const { data } = splitFrontmatter(head)
      const applyTo = typeof data.applyTo === 'string' ? data.applyTo : ''
      return { kind: 'rule', target: 'workspace.agents', confidence: 0.85, reason: applyTo ? `Copilot instructions, applyTo: ${applyTo}` : 'Copilot instructions', selectedByDefault: true }
    }
    if (/\.github\/agents\/[^/]+\.agent\.md$/.test(p)) {
      return { kind: 'persona', target: 'agent', confidence: 0.8, reason: 'Copilot custom agent (unverified shape)', selectedByDefault: true }
    }
    return null
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun vitest run tests/modules/data-port/adapters/rule-providers.test.ts tests/modules/data-port/adapters/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Review, do not commit**

Run: `git status --short`

---

### Task 5: Codex adapter (SQLite memories + rollout JSONL)

**Files:**
- Create (replace stub): `src/modules/data-port/adapters/codex.ts`
- Test: `tests/modules/data-port/adapters/codex.test.ts`

**Interfaces:**
- Consumes: `ExpandedUnit`, `SourceNote` (Task 1).
- Produces: `codexAdapter` with `expand(rel, raw)` for `memories_*.sqlite` (one unit per `stage1_outputs` row, `unit = thread_id`) and for `rollout-*.jsonl` (one unit per file, `unit = 'rollout'`, content = rendered transcript); `read(rel, raw, unit)` returning the `SourceNote` for that unit.
- Runtime note: SQLite is opened with `bun:sqlite` `{ readonly: true }` through a dynamic import; when `bun:sqlite` is unavailable (Node fallback) the file is classified noise with reason "needs Bun".

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/adapters/codex.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { codexAdapter } from '@modules/data-port/adapters/codex'

const root = join(tmpdir(), `eyas-codex-${process.pid}`)
const dbPath = join(root, '.codex', 'memories_1.sqlite')
const rolloutPath = join(root, '.codex', 'sessions', '2026', '01', '02', 'rollout-2026-01-02T10-00-00-abc.jsonl')

beforeAll(() => {
  mkdirSync(join(root, '.codex', 'sessions', '2026', '01', '02'), { recursive: true })
  const { Database } = require('bun:sqlite')
  const db = new Database(dbPath)
  db.run(`CREATE TABLE stage1_outputs (thread_id TEXT PRIMARY KEY, source_updated_at INTEGER NOT NULL, raw_memory TEXT NOT NULL, rollout_summary TEXT NOT NULL, rollout_slug TEXT, generated_at INTEGER NOT NULL)`)
  db.run(`INSERT INTO stage1_outputs VALUES ('t1', 1767340800000, 'Owner prefers bun over npm.', 'Set up a bun project.', 'bun-setup', 1767340800000)`)
  db.close()
  writeFileSync(rolloutPath, [
    JSON.stringify({ timestamp: '2026-01-02T10:00:00.000Z', type: 'session_meta', payload: { id: 'abc', cwd: '/w', originator: 'codex_cli' } }),
    JSON.stringify({ timestamp: '2026-01-02T10:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }),
    JSON.stringify({ timestamp: '2026-01-02T10:00:02.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] } }),
  ].join('\n'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('codex adapter', () => {
  it('detects a .codex tree', () => {
    expect(codexAdapter.detect(['.codex/config.toml'])).toBeGreaterThan(0.5)
  })
  it('expands a memories sqlite into one unit per row with verbatim raw_memory', () => {
    const units = codexAdapter.expand!('.codex/memories_1.sqlite', readFileSync(dbPath))
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ unit: 't1', title: 'bun-setup', hint: { kind: 'memory', target: 'vault.semantic' } })
    expect(units[0].content).toContain('Owner prefers bun over npm.')
    expect(units[0].content).toContain('Set up a bun project.')
  })
  it('reads a sqlite unit as a SourceNote with dates from source_updated_at', () => {
    const note = codexAdapter.read!('.codex/memories_1.sqlite', readFileSync(dbPath), 't1')
    expect(note.body).toContain('Owner prefers bun over npm.')
    expect(note.created).toBe('2026-01-02')
    expect(note.declaredKind).toBeNull()
  })
  it('renders a rollout jsonl as a reversible transcript', () => {
    const units = codexAdapter.expand!('.codex/sessions/2026/01/02/rollout-2026-01-02T10-00-00-abc.jsonl', readFileSync(rolloutPath))
    expect(units).toHaveLength(1)
    expect(units[0].hint).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: false })
    expect(units[0].content).toBe('**user:** hello\n\n**assistant:** hi there')
    expect(units[0].sessionId).toBe('abc')
    expect(units[0].sessionDate).toBe('2026-01-02T10:00:00.000Z')
  })
  it('flags config and auth as noise', () => {
    expect(codexAdapter.classify('.codex/config.toml', '')?.kind).toBe('noise')
    expect(codexAdapter.classify('.codex/auth.json', '')?.kind).toBe('noise')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/adapters/codex.test.ts`
Expected: FAIL — `expand` is undefined.

- [ ] **Step 3: Write the adapter**

```ts
// src/modules/data-port/adapters/codex.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyPath } from '../scanners/heuristics.js'
import { readSourceNote } from '../source-frontmatter.js'
import type { ExpandedUnit, ProviderAdapter, SourceNote } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()

interface MemoryRow { thread_id: string; source_updated_at: number; raw_memory: string; rollout_summary: string; rollout_slug: string | null }

/** Open a copy of the buffer read-only; a sqlite file must live on disk to be queried. */
function readMemoryRows(raw: Buffer): MemoryRow[] | null {
  let Database: any
  try { Database = require('bun:sqlite').Database } catch { return null }
  const dir = mkdtempSync(join(tmpdir(), 'eyas-codex-'))
  const file = join(dir, 'memories.sqlite')
  try {
    writeFileSync(file, raw)
    const db = new Database(file, { readonly: true })
    try {
      const has = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='stage1_outputs'`).get()
      if (!has) return []
      return db.query(`SELECT thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug FROM stage1_outputs ORDER BY source_updated_at DESC`).all() as MemoryRow[]
    } finally { db.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

function memoryUnitContent(r: MemoryRow): string {
  return `${r.raw_memory.trim()}\n\n## Rollout summary\n\n${r.rollout_summary.trim()}`
}

interface RolloutRender { content: string; sessionId: string | null; sessionDate: string | null }

function renderRollout(raw: Buffer): RolloutRender {
  const turns: string[] = []
  let sessionId: string | null = null
  let sessionDate: string | null = null
  for (const line of raw.toString('utf-8').split('\n')) {
    if (!line.trim()) continue
    let o: any
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'session_meta') {
      sessionId = typeof o.payload?.id === 'string' ? o.payload.id : null
      sessionDate = typeof o.timestamp === 'string' ? o.timestamp : null
      continue
    }
    if (o.type === 'response_item' && o.payload?.type === 'message') {
      const role = String(o.payload.role ?? 'unknown')
      const parts = Array.isArray(o.payload.content) ? o.payload.content : []
      const text = parts.map((p: any) => typeof p?.text === 'string' ? p.text : '```json\n' + JSON.stringify(p) + '\n```').join('\n')
      turns.push(`**${role}:** ${text}`)
    }
  }
  return { content: turns.join('\n\n'), sessionId, sessionDate }
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  rootHints: ['~/.codex', '~/.codex/memories_*.sqlite', '~/.codex/sessions'],
  detect: (paths) => (paths.map(posix).some((p) => p.startsWith('.codex/') || p.includes('/.codex/')) ? 0.85 : 0),
  classify: (rel, head) => {
    const p = posix(rel)
    if (!(p.startsWith('.codex/') || p.includes('/.codex/'))) return null
    const base = p.split('/').pop() ?? p
    if (/^memories_\d+\.sqlite$/.test(base)) {
      return { kind: 'memory', target: 'vault.semantic', confidence: 0.85, reason: 'Codex memory database (one note per row)', selectedByDefault: true }
    }
    if (/^rollout-.*\.jsonl$/.test(base)) {
      return { kind: 'session', target: 'episodic', confidence: 0.8, reason: 'Codex session rollout (JSONL)', selectedByDefault: false }
    }
    if (base === 'config.toml' || base === 'auth.json' || base.endsWith('.sqlite') || base.endsWith('.sqlite-wal') || base.endsWith('.sqlite-shm') || base.endsWith('.lock')) {
      return { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Codex configuration / credentials / derived state', selectedByDefault: false }
    }
    return classifyPath(rel, head, 'codex')
  },
  expand: (rel, raw) => {
    const base = posix(rel).split('/').pop() ?? ''
    if (/^memories_\d+\.sqlite$/.test(base)) {
      const rows = readMemoryRows(raw)
      if (rows === null) return [{ unit: 'unavailable', title: base, preview: 'needs Bun', bytes: raw.length, content: '', hint: { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Codex memory database needs Bun (bun:sqlite) to read', selectedByDefault: false } }]
      return rows.map((r) => {
        const content = memoryUnitContent(r)
        return {
          unit: r.thread_id,
          title: r.rollout_slug || r.thread_id,
          preview: content.slice(0, 280),
          bytes: Buffer.byteLength(content),
          content,
          hint: { kind: 'memory', target: 'vault.semantic', confidence: 0.85, reason: 'Codex memory row', selectedByDefault: true },
        }
      })
    }
    if (/^rollout-.*\.jsonl$/.test(base)) {
      const r = renderRollout(raw)
      return [{
        unit: 'rollout',
        title: base.replace(/\.jsonl$/, ''),
        preview: r.content.slice(0, 280),
        bytes: Buffer.byteLength(r.content),
        content: r.content,
        sessionId: r.sessionId,
        sessionDate: r.sessionDate,
        hint: { kind: 'session', target: 'episodic', confidence: 0.8, reason: 'Codex session rollout (JSONL)', selectedByDefault: false },
      }]
    }
    return []
  },
  read: (rel, raw, unit, times) => {
    const base = posix(rel).split('/').pop() ?? ''
    if (/^memories_\d+\.sqlite$/.test(base)) {
      const row = (readMemoryRows(raw) ?? []).find((r) => r.thread_id === unit)
      if (!row) return readSourceNote(rel, '', times)
      const day = new Date(row.source_updated_at).toISOString().slice(0, 10)
      const note: SourceNote = {
        ...readSourceNote(rel, memoryUnitContent(row), times),
        title: row.rollout_slug || row.thread_id,
        created: day,
        updated: day,
      }
      note.data = { thread_id: row.thread_id, rollout_slug: row.rollout_slug, source_updated_at: row.source_updated_at }
      return note
    }
    if (/^rollout-.*\.jsonl$/.test(base)) {
      const r = renderRollout(raw)
      const note = readSourceNote(rel, r.content, times)
      return { ...note, title: base.replace(/\.jsonl$/, ''), sessionId: r.sessionId, sessionDate: r.sessionDate, created: r.sessionDate?.slice(0, 10) ?? note.created }
    }
    return readSourceNote(rel, raw.toString('utf-8'), times)
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun vitest run tests/modules/data-port/adapters/codex.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Review, do not commit**

Run: `git status --short`

---

### Task 6: Chat-export adapter (ChatGPT, Claude.ai, generic JSON/JSONL, Mem0-style)

**Files:**
- Create (replace stub): `src/modules/data-port/adapters/chat-export.ts`
- Test: `tests/modules/data-port/adapters/chat-export.test.ts`

**Interfaces:**
- Produces: `chatExportAdapter` with `expand(rel, raw)`: one `session` unit per conversation (`unit = conversation id or index`), or one `memory` unit per Mem0-style memory; `read(rel, raw, unit)`.
- Shapes are documented shapes only — the adapter's `rootHints` say "unverified"; fixtures are synthetic.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/adapters/chat-export.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { chatExportAdapter } from '@modules/data-port/adapters/chat-export'

const CHATGPT = JSON.stringify([{
  id: 'c1', title: 'Bun setup', create_time: 1767340800,
  mapping: {
    root: { id: 'root', parent: null, children: ['m1'], message: null },
    m1: { id: 'm1', parent: 'root', children: ['m2'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] }, create_time: 1767340800 } },
    m2: { id: 'm2', parent: 'm1', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi'] }, create_time: 1767340801 } },
  },
}])
const CLAUDE_AI = JSON.stringify([{ uuid: 'u1', name: 'Plan', created_at: '2026-01-02T10:00:00Z', chat_messages: [
  { sender: 'human', text: 'hello', created_at: '2026-01-02T10:00:00Z' },
  { sender: 'assistant', text: 'hi', created_at: '2026-01-02T10:00:01Z' },
] }])
const GENERIC = JSON.stringify([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }])
const JSONL = '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}\n'
const MEM0 = JSON.stringify({ memories: [{ id: 'm-1', memory: 'Likes bun', created_at: '2026-01-02T10:00:00Z' }] })

describe('chat-export adapter', () => {
  it('detects conversations.json and jsonl', () => {
    expect(chatExportAdapter.detect(['conversations.json'])).toBeGreaterThan(0.5)
    expect(chatExportAdapter.detect(['chat.jsonl'])).toBeGreaterThan(0.5)
  })
  it('renders a ChatGPT mapping tree in order', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CHATGPT))
    expect(u).toHaveLength(1)
    expect(u[0]).toMatchObject({ unit: 'c1', title: 'Bun setup', sessionId: 'c1', sessionDate: '2026-01-02T08:00:00.000Z' })
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(u[0].hint).toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: false })
  })
  it('renders a Claude.ai export', () => {
    const u = chatExportAdapter.expand!('conversations.json', Buffer.from(CLAUDE_AI))
    expect(u[0]).toMatchObject({ unit: 'u1', title: 'Plan', sessionDate: '2026-01-02T10:00:00.000Z' })
    expect(u[0].content).toBe('**user:** hello\n\n**assistant:** hi')
  })
  it('renders generic role/content JSON and JSONL as one session', () => {
    expect(chatExportAdapter.expand!('x.json', Buffer.from(GENERIC))[0].content).toBe('**user:** hello\n\n**assistant:** hi')
    expect(chatExportAdapter.expand!('x.jsonl', Buffer.from(JSONL))[0].content).toBe('**user:** hello\n\n**assistant:** hi')
  })
  it('turns Mem0-style memories into memory units', () => {
    const u = chatExportAdapter.expand!('memories.json', Buffer.from(MEM0))
    expect(u[0]).toMatchObject({ unit: 'm-1', hint: { kind: 'memory', target: 'vault.semantic', selectedByDefault: true } })
    expect(u[0].content).toBe('Likes bun')
    const note = chatExportAdapter.read!('memories.json', Buffer.from(MEM0), 'm-1')
    expect(note.body).toBe('Likes bun')
    expect(note.created).toBe('2026-01-02')
  })
  it('keeps unknown JSON as a visible noise unit, never silently', () => {
    const u = chatExportAdapter.expand!('settings.json', Buffer.from('{"theme":"dark"}'))
    expect(u).toHaveLength(1)
    expect(u[0].hint.kind).toBe('noise')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/adapters/chat-export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the adapter**

```ts
// src/modules/data-port/adapters/chat-export.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { readSourceNote } from '../source-frontmatter.js'
import type { AdapterHint, ExpandedUnit, ProviderAdapter, SourceNote } from './types.js'

const posix = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const SESSION_HINT: AdapterHint = { kind: 'session', target: 'episodic', confidence: 0.8, reason: 'Chat export conversation', selectedByDefault: false }
const MEMORY_HINT: AdapterHint = { kind: 'memory', target: 'vault.semantic', confidence: 0.85, reason: 'Exported memory item', selectedByDefault: true }
const NOISE_HINT: AdapterHint = { kind: 'noise', target: 'none', confidence: 0.8, reason: 'JSON without a recognised chat or memory shape', selectedByDefault: false }

type Turn = { role: string; text: string }

function iso(v: unknown): string | null {
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString()
  if (typeof v === 'string' && v.trim()) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
  return null
}

function render(turns: Turn[]): string {
  return turns.map((t) => `**${t.role}:** ${t.text}`).join('\n\n')
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((p: any) => typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : '```json\n' + JSON.stringify(p) + '\n```').join('\n')
  }
  if (content && typeof content === 'object') {
    const parts = (content as any).parts
    if (Array.isArray(parts)) return textOf(parts)
    return '```json\n' + JSON.stringify(content) + '\n```'
  }
  return ''
}

/** ChatGPT: walk the mapping tree from the root, following the first child at each step. */
function chatgptTurns(conv: any): Turn[] {
  const mapping = conv.mapping ?? {}
  let id = Object.keys(mapping).find((k) => !mapping[k]?.parent) ?? null
  const turns: Turn[] = []
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const node = mapping[id]
    const m = node?.message
    if (m?.author?.role && m.author.role !== 'system') {
      const text = textOf(m.content)
      if (text.trim()) turns.push({ role: m.author.role, text })
    }
    id = Array.isArray(node?.children) && node.children.length ? node.children[node.children.length - 1] : null
  }
  return turns
}

function unitsFromJson(rel: string, parsed: any): ExpandedUnit[] {
  const session = (unit: string, title: string, turns: Turn[], date: string | null): ExpandedUnit => {
    const content = render(turns)
    return { unit, title, preview: content.slice(0, 280), bytes: Buffer.byteLength(content), content, sessionId: unit, sessionDate: date, hint: SESSION_HINT }
  }
  if (Array.isArray(parsed) && parsed.length && parsed[0]?.mapping) {
    return parsed.map((c: any, i: number) => session(String(c.id ?? c.conversation_id ?? i), String(c.title ?? `conversation ${i + 1}`), chatgptTurns(c), iso(c.create_time)))
  }
  if (Array.isArray(parsed) && parsed.length && Array.isArray(parsed[0]?.chat_messages)) {
    return parsed.map((c: any, i: number) => session(
      String(c.uuid ?? i), String(c.name ?? `conversation ${i + 1}`),
      c.chat_messages.map((m: any) => ({ role: m.sender === 'human' ? 'user' : String(m.sender ?? 'unknown'), text: typeof m.text === 'string' ? m.text : textOf(m.content) })),
      iso(c.created_at),
    ))
  }
  if (Array.isArray(parsed) && parsed.length && parsed.every((m: any) => typeof m?.role === 'string')) {
    return [session(rel, rel.split('/').pop() ?? rel, parsed.map((m: any) => ({ role: m.role, text: textOf(m.content) })), null)]
  }
  const memories = Array.isArray(parsed?.memories) ? parsed.memories : Array.isArray(parsed?.results) ? parsed.results : null
  if (memories) {
    return memories.map((m: any, i: number) => {
      const content = String(m.memory ?? m.text ?? m.content ?? '').trim()
      return { unit: String(m.id ?? i), title: content.slice(0, 80) || `memory ${i + 1}`, preview: content.slice(0, 280), bytes: Buffer.byteLength(content), content, hint: MEMORY_HINT }
    })
  }
  return [{ unit: 'file', title: rel.split('/').pop() ?? rel, preview: '', bytes: 0, content: '', hint: NOISE_HINT }]
}

function parse(rel: string, raw: Buffer): any {
  const text = raw.toString('utf-8')
  if (posix(rel).endsWith('.jsonl')) {
    return text.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  }
  try { return JSON.parse(text) } catch { return null }
}

export const chatExportAdapter: ProviderAdapter = {
  id: 'chat-export',
  rootHints: ['conversations.json (ChatGPT / Claude.ai — unverified shapes)', '*.jsonl', 'memories.json'],
  detect: (paths) => (paths.map(posix).some((p) => p.endsWith('conversations.json') || p.endsWith('.jsonl')) ? 0.7 : 0),
  classify: (rel) => {
    const p = posix(rel)
    if (!(p.endsWith('.json') || p.endsWith('.jsonl'))) return null
    return { kind: 'session', target: 'episodic', confidence: 0.6, reason: 'Structured export — expanded into units', selectedByDefault: false }
  },
  expand: (rel, raw) => {
    const parsed = parse(rel, raw)
    if (parsed === null) return [{ unit: 'file', title: rel, preview: '', bytes: raw.length, content: '', hint: { ...NOISE_HINT, reason: 'Invalid JSON' } }]
    return unitsFromJson(rel, parsed)
  },
  read: (rel, raw, unit, times) => {
    const units = chatExportAdapter.expand!(rel, raw)
    const u = units.find((x) => x.unit === unit) ?? units[0]
    const base = readSourceNote(rel, u?.content ?? '', times)
    const memories = parse(rel, raw)?.memories ?? parse(rel, raw)?.results
    const m = Array.isArray(memories) ? memories.find((x: any, i: number) => String(x.id ?? i) === unit) : null
    const created = iso(m?.created_at)?.slice(0, 10) ?? u?.sessionDate?.slice(0, 10) ?? base.created
    const note: SourceNote = { ...base, title: u?.title ?? base.title, sessionId: u?.sessionId ?? null, sessionDate: u?.sessionDate ?? null, created, updated: iso(m?.updated_at)?.slice(0, 10) ?? created }
    if (m) note.data = m
    return note
  },
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun vitest run tests/modules/data-port/adapters/chat-export.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Review, do not commit**

Run: `git status --short`

---

### Task 7: Scan — full files, hashes, visible skips, units, skill packages, sessions and persona dirs

**Files:**
- Modify: `src/modules/data-port/constants.ts`, `src/modules/data-port/scanners/scan-path.ts`
- Test: modify `tests/modules/data-port/scan-walk.test.ts`; create `tests/modules/data-port/scan-units.test.ts`

**Interfaces:**
- Consumes: `classifyFile`, `detectProfile`, `adapterFor` (Task 3), `ExpandedUnit`.
- Produces: `scanDirectory({ rootPath, sourceProfile })` returns candidates with `sourcePath`, `sha256`, `mtime`, `birthtime`, `unit`, `assets`, `sessionId`, `sessionDate`; no `content` field is persisted (the service strips it); every skipped file is a `noise` candidate with a reason; `ScanResult.stats` unchanged in shape.

- [ ] **Step 1: Constants**

In `constants.ts` replace `MAX_FILE_BYTES` with `export const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4 MiB per file; larger files are listed as skipped` and add `export const HEAD_CHARS = 4_000 // classification looks at the head only; apply reads the whole file`. Keep `MAX_CHUNK_CHARS` (used only to clip text sent to the optional model pass).

- [ ] **Step 2: Write the failing tests**

```ts
// tests/modules/data-port/scan-units.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanDirectory } from '@modules/data-port/scanners/scan-path'

let root: string
beforeEach(() => {
  root = join(tmpdir(), `eyas-scan-${process.pid}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(root, '.claude', 'skills', 'deploy', 'scripts'), { recursive: true })
  mkdirSync(join(root, '.claude', 'skills', 'deploy', 'references'), { recursive: true })
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
  mkdirSync(join(root, '.grok', 'memory', 'proj-1', 'sessions'), { recursive: true })
  mkdirSync(join(root, 'ai-memory'), { recursive: true })
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Use when "deploy docs"\n---\n# Deploy\nRun scripts/deploy.sh')
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'scripts', 'deploy.sh'), '#!/bin/sh\necho hi\n')
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'references', 'notes.md'), '# Notes\nmore')
  writeFileSync(join(root, '.claude', 'skills', 'deploy', 'scripts', 'x.pyc'), Buffer.from([0, 1, 2]))
  writeFileSync(join(root, '.claude', 'agents', 'dev.md'), '---\nname: dev\ndescription: d\n---\nprompt')
  writeFileSync(join(root, '.grok', 'memory', 'proj-1', 'sessions', '2026-09-05-x-01a0abcd.md'), '## Session Summary\n\n- **Messages:** 1 user')
  writeFileSync(join(root, 'ai-memory', 'big.md'), '---\ntype: reference\n---\n' + 'x'.repeat(20_000))
  writeFileSync(join(root, 'ai-memory', 'bullets.md'), '---\ntype: feedback\n---\n- a\n- b\n- c\n- d\n- e\n')
  writeFileSync(join(root, 'ai-memory', 'huge.md'), 'y'.repeat(5 * 1024 * 1024))
  writeFileSync(join(root, 'secret.env'), 'API_KEY=abcdefghijklmnopqrstuvwxyz')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('scanDirectory', () => {
  it('reads whole files: the 20k note carries its full size and a hash, no content field', () => {
    const r = scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const big = r.candidates.find((c) => c.relativePath === 'ai-memory/big.md')!
    expect(big.bytes).toBeGreaterThan(20_000)
    expect(big.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(big.sourcePath).toBe(join(root, 'ai-memory', 'big.md'))
    expect(big.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(big.content).toBeUndefined()
  })
  it('lists every skipped file as a noise candidate with a reason', () => {
    const r = scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const huge = r.candidates.find((c) => c.relativePath === 'ai-memory/huge.md')!
    expect(huge).toMatchObject({ kind: 'noise', target: 'none', selectedByDefault: false })
    expect(huge.reason).toMatch(/too large/i)
    const secret = r.candidates.find((c) => c.relativePath === 'secret.env')!
    expect(secret.reason).toMatch(/secret/i)
    expect(r.stats.filesSkipped).toBe(r.candidates.filter((c) => c.kind === 'noise').length)
  })
  it('keeps bullet-heavy notes and bundles skill assets under the SKILL.md candidate', () => {
    const r = scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'ai-memory/bullets.md')?.kind).toBe('memory')
    const skill = r.candidates.find((c) => c.relativePath === '.claude/skills/deploy/SKILL.md')!
    expect(skill.kind).toBe('skill')
    expect(skill.assets?.map((a) => a.relPath).sort()).toEqual(['references/notes.md', 'scripts/deploy.sh'])
    expect(skill.reason).toMatch(/\+2 bundled files/)
    expect(r.candidates.some((c) => c.relativePath.endsWith('references/notes.md'))).toBe(false)
  })
  it('reaches Grok project sessions and persona files', () => {
    const r = scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath.includes('proj-1/sessions/')))
      .toMatchObject({ kind: 'session', target: 'episodic', selectedByDefault: true })
    expect(r.candidates.find((c) => c.relativePath === '.claude/agents/dev.md'))
      .toMatchObject({ kind: 'persona', target: 'agent' })
  })
  it('expands container files into units with the container path and a unit id', () => {
    writeFileSync(join(root, 'conversations.json'), JSON.stringify([{ uuid: 'u1', name: 'Plan', chat_messages: [{ sender: 'human', text: 'hi' }] }]))
    const r = scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const u = r.candidates.find((c) => c.relativePath === 'conversations.json')!
    expect(u.unit).toBe('u1')
    expect(u.kind).toBe('session')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/scan-units.test.ts`
Expected: FAIL (no `sha256`, assets missing, huge file absent).

- [ ] **Step 4: Rewrite the file loop in `scan-path.ts`**

Changes to `walkFiles`:
- `isTextyName`: set `TEXT_EXTS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.toml', '.json', '.jsonl', '.sqlite', '.mdc', '.sh', '.py', '.env'])` and delete the early `return false` for `.json`/`.jsonl` names (keep the `.lock` / `security_warnings` / dot-file exclusions); additionally accept any file inside a skill directory: in the entry loop compute `const inSkillDir = existsSync(join(dir, 'SKILL.md')) || /\/skills\/[^/]+\//.test(full.replace(/\\/g, '/'))` and use `if (!isTextyName(e.name) && !inSkillDir) continue`.
- `shouldSkipDir`: allow `sessions` when the parent chain contains `.grok/memory` — change the signature to `shouldSkipDir(name: string, fullPath: string)` and add before the `SKIP_UNDER_AI_DOT` check: `if (name === 'sessions' && /\/\.grok\/memory\//.test(fullPath.replace(/\\/g, '/') + '/')) return false`. Also allow `agents` (already not in the list) and `memory` under `.claude/projects/*` (currently `projects` is skipped under AI dots — change: skip `.claude/projects/<x>` contents EXCEPT a `memory` child: in the entry loop, when `dir` ends with `/.claude/projects/<x>` push only `memory`). Implement as: `if (/\/\.claude\/projects\/[^/]+$/.test(posixDir) && e.name !== 'memory') continue` and remove `'projects'` from `SKIP_UNDER_AI_DOT` while keeping `file-history`, `paste-cache`, … .
- Never skip `.pyc`/binaries silently: collect them; `classifyPath` marks them noise; the scan turns them into visible noise rows.

Replace the body of `scanDirectory` from `const candidates: ScanCandidate[] = []` to the end of the file loop with:

```ts
  const candidates: ScanCandidate[] = []
  let filesSkipped = 0
  let totalBytes = 0
  const seenReal = new Set<string>()
  const skillDirs = new Set(files.filter((f) => basename(f).toLowerCase() === 'skill.md').map((f) => dirname(f)))
  const assetsByDir = new Map<string, Array<{ relPath: string; bytes: number; sha256: string }>>()

  const skip = (rel: string, size: number, reason: string, title = rel.split('/').pop() ?? rel) => {
    filesSkipped++
    candidates.push({ id: generateId(), relativePath: rel, kind: 'noise', target: 'none', title, preview: reason, bytes: size, confidence: 0.9, reason, selectedByDefault: false })
  }

  for (const full of files) {
    const rel = relative(root, full).replace(/\\/g, '/')
    if (!isUnderRoot(root, full)) { skip(rel, 0, 'Outside the scan root'); continue }
    let realKey = full
    try { realKey = realpathSync(full) } catch { /* keep */ }
    if (seenReal.has(realKey)) { skip(rel, 0, 'Same file already listed under another path (symlink)'); continue }
    seenReal.add(realKey)
    let st: ReturnType<typeof statSync>
    try { st = statSync(full) } catch { skip(rel, 0, 'Unreadable'); continue }
    const size = st.size
    if (size <= 0) { skip(rel, 0, 'Empty file'); continue }
    if (size > MAX_FILE_BYTES) { skip(rel, size, `Too large (${Math.round(size / 1024)} KiB > ${MAX_FILE_BYTES / 1024} KiB)`); continue }
    if (rel.includes('.obsidian/')) continue

    // Skill package assets: bundled with their SKILL.md, not listed on their own.
    const owningSkillDir = [...skillDirs].find((d) => full.startsWith(d + sep) && basename(full).toLowerCase() !== 'skill.md')
    if (owningSkillDir) {
      const base = basename(full).toLowerCase()
      if (base === '.ds_store' || base.endsWith('.pyc') || full.includes(`${sep}__pycache__${sep}`)) continue
      const raw = readFileSync(full)
      const list = assetsByDir.get(owningSkillDir) ?? []
      list.push({ relPath: relative(owningSkillDir, full).replace(/\\/g, '/'), bytes: size, sha256: createHash('sha256').update(raw).digest('hex') })
      assetsByDir.set(owningSkillDir, list)
      totalBytes += size
      continue
    }

    let raw: Buffer
    try { raw = readFileSync(full) } catch { skip(rel, size, 'Unreadable'); continue }
    const sha256 = createHash('sha256').update(raw).digest('hex')
    const isBinary = raw.subarray(0, 8000).includes(0) && !/\.(sqlite)$/i.test(rel)
    const head = isBinary ? '' : raw.subarray(0, HEAD_CHARS * 4).toString('utf-8').slice(0, HEAD_CHARS)
    const hint = classifyFile(rel, head, detected)
    totalBytes += size
    const times = { mtime: st.mtime.toISOString(), birthtime: st.birthtime.toISOString() }

    if (hint.kind === 'noise') { skip(rel, size, hint.reason, titleFromPathAndContent(rel, head)); continue }
    if (isBinary && !/\.(sqlite)$/i.test(rel)) { skip(rel, size, 'Binary file'); continue }

    const adapter = adapterFor(detected)
    const units = adapter.expand?.(rel, raw)
    if (units && units.length) {
      for (const u of units) {
        if (u.hint.kind === 'noise') { skip(rel, u.bytes, u.hint.reason, u.title); continue }
        candidates.push({
          id: generateId(), relativePath: rel, kind: u.hint.kind, target: u.hint.target, title: u.title, preview: u.preview,
          bytes: u.bytes, confidence: u.hint.confidence, reason: u.hint.reason, selectedByDefault: u.hint.selectedByDefault && u.hint.target !== 'none',
          sourcePath: full, unit: u.unit, sha256, ...times, sessionId: u.sessionId ?? null, sessionDate: u.sessionDate ?? null,
        })
      }
      continue
    }

    const text = raw.toString('utf-8')
    candidates.push({
      id: generateId(), relativePath: rel, kind: hint.kind, target: hint.target,
      title: titleFromPathAndContent(rel, text), preview: previewOf(text), bytes: size,
      confidence: hint.confidence, reason: hint.reason, selectedByDefault: hint.selectedByDefault && hint.target !== 'none',
      sourcePath: full, unit: null, sha256, ...times,
    })
  }

  // Attach bundled assets to their SKILL.md candidates.
  for (const c of candidates) {
    if (c.kind !== 'skill' || !c.sourcePath) continue
    const list = assetsByDir.get(dirname(c.sourcePath))
    if (list?.length) {
      c.assets = list.sort((a, b) => a.relPath.localeCompare(b.relPath))
      c.reason = `${c.reason} (+${list.length} bundled files)`
    }
  }
```

Add imports: `import { createHash } from 'node:crypto'`, `dirname` from `node:path`, `HEAD_CHARS`, and `import { adapterFor, classifyFile, detectProfile } from '../adapters/registry.js'`. Replace `detectProfileFromPaths(relPaths)` with `detectProfile(relPaths)`. Keep the warnings block; change the file-cap warning to mention `filesSkipped` rows are listed.

- [ ] **Step 5: Update `scan-walk.test.ts`**

In `prioritizes ai-memory over bulk noise when capped` nothing changes. Add one test:

```ts
  it('walks .grok/memory/<project>/sessions and .claude/projects/<slug>/memory', () => {
    mkdirSync(join(root, '.grok', 'memory', 'p1', 'sessions'), { recursive: true })
    writeFileSync(join(root, '.grok', 'memory', 'p1', 'sessions', 'a.md'), '## Session Summary')
    mkdirSync(join(root, '.claude', 'projects', 'slug', 'memory'), { recursive: true })
    writeFileSync(join(root, '.claude', 'projects', 'slug', 'memory', 'n.md'), '---\ntype: user\n---\nme')
    writeFileSync(join(root, '.claude', 'projects', 'slug', 'x.jsonl'), '{"type":"user"}')
    const files = walkFiles(root, 500).map((f) => f.replace(root + '/', ''))
    expect(files).toContain('.grok/memory/p1/sessions/a.md')
    expect(files).toContain('.claude/projects/slug/memory/n.md')
    expect(files).not.toContain('.claude/projects/slug/x.jsonl')
  })
```

(`.claude/projects/<slug>/*.jsonl` transcripts are only reached when the scan root is that project dir itself — a home scan must not pull thousands of transcripts.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun vitest run tests/modules/data-port/scan-units.test.ts tests/modules/data-port/scan-walk.test.ts tests/modules/data-port/heuristics.test.ts`
Expected: PASS.

- [ ] **Step 7: Type-check and review**

Run: `bun run lint 2>&1 | tail -3 && git status --short`

---

## Phase 2 — Filing faithfully

### Task 8: Applied-items ledger

**Files:**
- Modify: `src/modules/data-port/schema.ts`
- Create: `src/modules/data-port/ledger.ts`
- Test: `tests/modules/data-port/ledger.test.ts`

**Interfaces:**
- Produces: table `data_port_applied (id, job_id, kind, ref, source_path, created_at)`; `recordApplied(db, { jobId, kind, ref, sourcePath }): string`; `listApplied(db, jobId): AppliedRow[]`; `deleteApplied(db, jobId): void`. `kind` ∈ `'vault' | 'episodic' | 'skill' | 'skill-assets' | 'agent' | 'proposal'`; `ref` = vault relative path / episodic id / skill id / asset dir / agent id / proposal id.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/data-port/ledger.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { recordApplied, listApplied, deleteApplied } from '@modules/data-port/ledger'

describe('data-port ledger', () => {
  it('records, lists in insertion order, and deletes per job', () => {
    const db = createMemoryDb()
    createDataPortTables(db)
    recordApplied(db, { jobId: 'j1', kind: 'vault', ref: 'semantic/a.md', sourcePath: '/src/a.md' })
    recordApplied(db, { jobId: 'j1', kind: 'skill', ref: 'sk1', sourcePath: '/src/SKILL.md' })
    recordApplied(db, { jobId: 'j2', kind: 'vault', ref: 'semantic/b.md', sourcePath: '/src/b.md' })
    expect(listApplied(db, 'j1').map((r) => [r.kind, r.ref])).toEqual([['vault', 'semantic/a.md'], ['skill', 'sk1']])
    deleteApplied(db, 'j1')
    expect(listApplied(db, 'j1')).toEqual([])
    expect(listApplied(db, 'j2')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/ledger.test.ts` → FAIL (module missing).

- [ ] **Step 3: Add the table and the helpers**

Append to `createDataPortTables` in `schema.ts`:

```ts
  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_applied (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    source_path TEXT,
    created_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_applied_job ON data_port_applied(job_id)`)
```

```ts
// src/modules/data-port/ledger.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'

export type AppliedKind = 'vault' | 'episodic' | 'skill' | 'skill-assets' | 'agent' | 'proposal'

export interface AppliedRow { id: string; jobId: string; kind: AppliedKind; ref: string; sourcePath: string | null; createdAt: string }

export function recordApplied(db: EyasDb, input: { jobId: string; kind: AppliedKind; ref: string; sourcePath?: string | null }): string {
  const id = generateId()
  db.run(sql`INSERT INTO data_port_applied (id, job_id, kind, ref, source_path, created_at)
    VALUES (${id}, ${input.jobId}, ${input.kind}, ${input.ref}, ${input.sourcePath ?? null}, ${new Date().toISOString()})`)
  return id
}

export function listApplied(db: EyasDb, jobId: string): AppliedRow[] {
  const rows = db.all(sql`SELECT id, job_id, kind, ref, source_path, created_at FROM data_port_applied WHERE job_id = ${jobId} ORDER BY created_at ASC, id ASC`) as any[]
  return rows.map((r) => ({ id: r.id, jobId: r.job_id, kind: r.kind, ref: r.ref, sourcePath: r.source_path ?? null, createdAt: r.created_at }))
}

export function deleteApplied(db: EyasDb, jobId: string): void {
  db.run(sql`DELETE FROM data_port_applied WHERE job_id = ${jobId}`)
}
```

- [ ] **Step 4: Run to verify it passes** — same command → PASS.
- [ ] **Step 5: Review** — `git status --short`.

---

### Task 9: Deterministic normalizer; model enrichment is metadata-only

**Files:**
- Modify: `src/modules/data-port/types.ts` (`MemoryTransformResult`), `src/modules/data-port/pipeline/transform.ts`, `src/modules/data-port/prompts/transform-memory.ts`
- Test: create `tests/modules/data-port/transform.test.ts`; delete the obsolete `memoryFallback` expectations in `tests/modules/data-port/import-prompts.test.ts` only if they fail (they test prompt text — keep).

**Interfaces:**
- Produces: `MemoryTransformResult` gains `aliases: string[]`, `created: string | null`, `updated: string | null`, `source: Record<string, unknown>`; `normalizeMemory(note: SourceNote, opts: NormalizeOptions): MemoryTransformResult`; `enrichMemory(ctx: CheapModelPassContext, note: SourceNote, base: MemoryTransformResult, opts: { path: string; sourceProfile: SourceProfile }): Promise<{ result: MemoryTransformResult; enriched: boolean }>`.
- `NormalizeOptions = { relativePath: string; sourceProfile: SourceProfile; hooks?: IndexEntry | null; sha256?: string; mtime?: string; paths?: string[]; unit?: string | null; sourceChanged?: boolean }`.
- Removed: `memoryFallback`, `transformMemory`, `transformSkill`, `skillFallback` (skills move to Task 11).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/transform.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readSourceNote } from '@modules/data-port/source-frontmatter'
import { normalizeMemory, enrichMemory, safeImportedKind } from '@modules/data-port/pipeline/transform'

const RAW = '---\nname: feedback_no_auto_commit\ndescription: "Do not commit automatically"\ntype: feedback\nmetadata:\n  modified: 2026-08-01T00:00:00.000Z\n---\nNever commit. See [[feedback_terse]].\n\n' + 'body '.repeat(2000)

describe('normalizeMemory', () => {
  const note = readSourceNote('ai-memory/feedback_no_auto_commit.md', RAW, { mtime: '2026-09-01T00:00:00.000Z', birthtime: '2026-05-01T00:00:00.000Z' })
  const r = normalizeMemory(note, { relativePath: 'ai-memory/feedback_no_auto_commit.md', sourceProfile: 'claude-code', sha256: 'abc', mtime: '2026-09-01T00:00:00.000Z', hooks: { hooks: ['No commit/push unless asked'], section: 'Feedback — Global' } })
  it('keeps the whole body verbatim', () => {
    expect(r.body).toBe(note.body)
    expect(r.body.length).toBeGreaterThan(9000)
  })
  it('maps declared type to kind and description to summary', () => {
    expect(r.kind).toBe('feedback')
    expect(r.summary_one_line).toBe('Do not commit automatically')
    expect(r.title).toBe('feedback_no_auto_commit')
    expect(r.aliases).toEqual([])
    expect(r.links).toEqual(['feedback_terse'])
    expect(r.created).toBe('2026-05-01')
    expect(r.updated).toBe('2026-08-01')
  })
  it('records provenance and the index hook and section', () => {
    expect(r.source).toMatchObject({ profile: 'claude-code', path: 'ai-memory/feedback_no_auto_commit.md', name: 'feedback_no_auto_commit', type: 'feedback', sha256: 'abc', indexHooks: ['No commit/push unless asked'], indexSection: 'Feedback — Global' })
    expect((r.source as any).frontmatter).toEqual(note.data)
    expect(r.tags).toContain('index-section:feedback-global')
  })
  it('uses the hook as summary when there is no description, then the first line', () => {
    const n1 = readSourceNote('x/a.md', '# Title\nFirst line.\nSecond.')
    expect(normalizeMemory(n1, { relativePath: 'x/a.md', sourceProfile: 'obsidian', hooks: { hooks: ['hook'], section: null } }).summary_one_line).toBe('hook')
    expect(normalizeMemory(n1, { relativePath: 'x/a.md', sourceProfile: 'obsidian' }).summary_one_line).toBe('First line.')
  })
  it('never infers user; undeclared is reference', () => {
    const n = readSourceNote('x/a.md', 'I am the owner and I like tea.')
    expect(normalizeMemory(n, { relativePath: 'x/a.md', sourceProfile: 'generic-md' }).kind).toBe('reference')
    expect(safeImportedKind('user', { declared: false })).toBe('reference')
    expect(safeImportedKind('user', { declared: true })).toBe('user')
  })
})

describe('enrichMemory', () => {
  const note = readSourceNote('x/a.md', 'Plain note without frontmatter. ' + 'text '.repeat(500))
  const base = normalizeMemory(note, { relativePath: 'x/a.md', sourceProfile: 'generic-md' })
  it('never replaces the body, even when the model returns one', async () => {
    const ctx = { model: { complete: async () => ({ content: JSON.stringify({ kind: 'feedback', body: 'SHORT REWRITE', summary_one_line: 'model summary', tags: ['t'], links: ['l'] }) }) } } as any
    const { result, enriched } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(enriched).toBe(true)
    expect(result.body).toBe(base.body)
    expect(result.kind).toBe('feedback')
    expect(result.summary_one_line).toBe('model summary')
    expect(result.tags).toContain('t')
  })
  it('does not honour skip or kind user from the model', async () => {
    const ctx = { model: { complete: async () => ({ content: JSON.stringify({ skip: true, kind: 'user', summary_one_line: 's' }) }) } } as any
    const { result } = await enrichMemory(ctx, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(result.skip).toBeFalsy()
    expect(result.kind).toBe('reference')
  })
  it('falls back to the deterministic result without a model', async () => {
    const { result, enriched } = await enrichMemory({} as any, note, base, { path: 'x/a.md', sourceProfile: 'generic-md' })
    expect(enriched).toBe(false)
    expect(result).toEqual(base)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/transform.test.ts` → FAIL.

- [ ] **Step 3: Update `MemoryTransformResult` in `types.ts`**

```ts
export interface MemoryTransformResult {
  skip?: boolean
  kind: ImportedNoteKind
  title: string
  /** Verbatim source body. Never produced by a model. */
  body: string
  tags: string[]
  links: string[]
  aliases: string[]
  salience: number
  summary_one_line: string
  created: string | null
  updated: string | null
  /** Provenance written to frontmatter `source:` — the original frontmatter travels inside it. */
  source: Record<string, unknown>
}
```

- [ ] **Step 4: Rewrite `pipeline/transform.ts`**

```ts
// src/modules/data-port/pipeline/transform.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { runCheapModelPass } from '@modules/model/cheap-pass.js'
import type { CheapModelPassContext } from '@modules/model/cheap-pass.js'
import { MAX_CHUNK_CHARS } from '../constants.js'
import { buildMemoryTransformSystemPrompt, buildMemoryTransformUserPrompt } from '../prompts/transform-memory.js'
import type { IndexEntry } from '../memory-index-hooks.js'
import type { SourceNote } from '../adapters/types.js'
import type { ImportedNoteKind, MemoryTransformResult, SourceProfile } from '../types.js'
import { extractJson } from './parse-json.js'

const NOTE_KINDS = new Set<ImportedNoteKind>(['user', 'feedback', 'domain', 'project', 'reference'])

/** `user` is accepted only when the source declared it; inference never promotes a note to a fact about the owner. */
export function safeImportedKind(raw: unknown, opts: { declared: boolean } = { declared: true }): ImportedNoteKind {
  if (typeof raw !== 'string' || !NOTE_KINDS.has(raw as ImportedNoteKind)) return 'reference'
  if (raw === 'user' && !opts.declared) return 'reference'
  return raw as ImportedNoteKind
}

export interface NormalizeOptions {
  relativePath: string
  sourceProfile: SourceProfile
  hooks?: IndexEntry | null
  sha256?: string
  mtime?: string
  paths?: string[]
  unit?: string | null
  sourceChanged?: boolean
}

function slugTag(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function firstLine(body: string): string {
  for (const l of body.split('\n')) {
    const t = l.replace(/^#+\s*/, '').trim()
    if (t) return t
  }
  return ''
}

export function normalizeMemory(note: SourceNote, opts: NormalizeOptions): MemoryTransformResult {
  const kind = note.declaredKind ?? 'reference'
  const hook = opts.hooks?.hooks[0] ?? null
  const tags = [...note.tags]
  if (opts.hooks?.section) tags.push(`index-section:${slugTag(opts.hooks.section)}`)
  if (opts.sourceChanged) tags.push('source-changed')
  return {
    skip: false,
    kind,
    title: note.title,
    body: note.body,
    tags,
    links: note.links,
    aliases: [...new Set([note.name, ...note.aliases].filter((a): a is string => Boolean(a) && a !== note.title))],
    salience: 0.7,
    summary_one_line: note.description ?? hook ?? (firstLine(note.body) || note.title),
    created: note.created,
    updated: note.updated,
    source: {
      profile: opts.sourceProfile,
      path: opts.relativePath,
      ...(opts.paths && opts.paths.length > 1 ? { paths: opts.paths } : {}),
      ...(opts.unit ? { unit: opts.unit } : {}),
      name: note.name,
      type: note.declaredKind,
      description: note.description,
      frontmatter: note.data,
      sha256: opts.sha256 ?? null,
      mtime: opts.mtime ?? null,
      indexHooks: opts.hooks?.hooks ?? [],
      indexSection: opts.hooks?.section ?? null,
    },
  }
}

/**
 * Optional metadata enrichment for notes WITHOUT a declared kind. The model may
 * suggest kind (never `user`), summary, tags and links. It never sees a way to
 * change the body, and it cannot skip a note the user selected.
 */
export async function enrichMemory(
  ctx: CheapModelPassContext,
  note: SourceNote,
  base: MemoryTransformResult,
  opts: { path: string; sourceProfile: SourceProfile },
): Promise<{ result: MemoryTransformResult; enriched: boolean }> {
  if (!ctx?.model?.complete) return { result: base, enriched: false }
  const raw = await runCheapModelPass(ctx, {
    system: buildMemoryTransformSystemPrompt(),
    user: buildMemoryTransformUserPrompt({ target: 'vault.semantic', sourceProfile: opts.sourceProfile, path: opts.path, title: note.title, content: note.body.slice(0, MAX_CHUNK_CHARS) }),
    maxTokens: 600,
    temperature: 0.2,
    fallback: '',
  })
  const parsed = extractJson<Partial<MemoryTransformResult>>(raw)
  if (!parsed || typeof parsed !== 'object') return { result: base, enriched: false }
  return {
    enriched: true,
    result: {
      ...base,
      kind: safeImportedKind(parsed.kind, { declared: false }),
      summary_one_line: typeof parsed.summary_one_line === 'string' && parsed.summary_one_line.trim() ? parsed.summary_one_line.trim() : base.summary_one_line,
      tags: [...new Set([...base.tags, ...(Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 20) : [])])],
      links: [...new Set([...base.links, ...(Array.isArray(parsed.links) ? parsed.links.map(String).slice(0, 20) : [])])],
      salience: typeof parsed.salience === 'number' ? Math.min(1, Math.max(0, parsed.salience)) : base.salience,
    },
  }
}
```

- [ ] **Step 5: Update the prompt**

In `prompts/transform-memory.ts` replace the JSON template and the "Rules for body" block so the model returns metadata only:

```ts
  return `You are EYAS Memory Classifier.

You receive one imported note WITHOUT a declared kind. Return metadata only —
the body is stored verbatim by EYAS and you cannot change it.

Write JSON only (no markdown fences):
{
  "kind": "reference",
  "summary_one_line": "one line, max 140 characters, in the note's own language",
  "tags": ["..."],
  "links": ["related-slug-candidates"],
  "salience": 0.0-1.0
}

kind:
- "reference" is the default.
- "feedback" only if this is how the owner wants to be worked with.
- "project" / "domain" only when the note is clearly scoped to one project or type AND names it.
- Never "user": an undeclared note is never promoted to a fact about the owner.
- Never invent tags or links that are not grounded in the text.`
```

Keep `buildMemoryTransformUserPrompt` unchanged. Update `tests/modules/data-port/import-prompts.test.ts` expectation `tells the memory normalizer never to promote undeclared notes to kind user` to assert the new sentence `Never "user"`.

- [ ] **Step 6: Run to verify it passes**

Run: `bun vitest run tests/modules/data-port/transform.test.ts tests/modules/data-port/import-prompts.test.ts` → PASS. (`apply-memory.test.ts` and `scan-and-apply.test.ts` break here; Tasks 10 and 14 rewrite them.)

- [ ] **Step 7: Review** — `git status --short`.

---

### Task 10: Apply memory — folder by kind, source file name, free path, unchanged, provenance, episodic

**Files:**
- Modify: `src/modules/data-port/pipeline/apply.ts`
- Test: rewrite `tests/modules/data-port/apply-memory.test.ts`

**Interfaces:**
- Consumes: `MemoryTransformResult` (Task 9), `isMemoryIndexBasename` (Task 2).
- Produces: `folderForKind(kind, scope?: { projectId?: string | null; projectTypeId?: string | null }): string`; `slugFromSource(relativePath: string, title: string, unit: string | null): string`; `freeVaultPath(vault: { exists(p: string): boolean }, folder: string, slug: string): string`; `applyMemoryItem(deps, input)` where `input = { jobId, sourceProfile, target, transformed, relativePath?, unit?, sessionId?, sessionDate?, scope? }`; `ApplyResult` gains `{ status: 'unchanged'; ref: string }`; `ApplyDeps.vault` gains `read?: (path: string) => { content: string } | null`; `ApplyDeps.episodic.create` input gains `validFrom?: string`.
- Removed: the `isMemoryIndexFile || isImportJunk` skip at the top of `applyMemoryItem` (indexes are now notes; junk never reaches apply).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/apply-memory.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { applyMemoryItem, folderForKind, slugFromSource, freeVaultPath } from '@modules/data-port/pipeline/apply'
import type { MemoryTransformResult } from '@modules/data-port/types'

const T = (over: Partial<MemoryTransformResult> = {}): MemoryTransformResult => ({
  kind: 'reference', title: 'Alpha Note', body: 'Body one.', tags: ['x'], links: ['beta'], aliases: ['alpha_note'],
  salience: 0.7, summary_one_line: 'Alpha', created: '2026-05-01', updated: '2026-08-01',
  source: { profile: 'claude-code', path: 'ai-memory/alpha_note.md', frontmatter: { type: 'reference' } }, ...over,
})

function vaultMock(existing: Record<string, string> = {}) {
  const written: Array<{ path: string; fm: Record<string, unknown>; body: string }> = []
  return {
    written,
    vault: {
      write: (path: string, fm: Record<string, unknown>, body: string) => { written.push({ path, fm, body }); existing[path] = body },
      exists: (path: string) => path in existing,
      read: (path: string) => (path in existing ? { content: existing[path] } : null),
    },
  }
}
const base = { createProposal: () => 'p', resolveDefaultAgentId: () => 'a' }

describe('folder and slug rules', () => {
  it('files feedback under procedural, others under semantic, scoped project under projects/<id>', () => {
    expect(folderForKind('feedback')).toBe('procedural')
    expect(folderForKind('user')).toBe('semantic')
    expect(folderForKind('project')).toBe('semantic')
    expect(folderForKind('project', { projectId: 'p1' })).toBe('projects/p1')
    expect(folderForKind('domain', { projectTypeId: 'odoo' })).toBe('project-types/odoo')
  })
  it('uses the source basename as the slug so wikilinks resolve', () => {
    expect(slugFromSource('ai-memory/feedback_no_auto_commit.md', 'No auto commit', null)).toBe('feedback_no_auto_commit')
    expect(slugFromSource('.codex/memories_1.sqlite', 'bun-setup', 't1')).toBe('memories_1-t1')
    expect(slugFromSource('x/Weird name (1).md', 'W', null)).toBe('Weird-name-1')
  })
  it('finds the next free path without overwriting', () => {
    const v = { exists: (p: string) => ['semantic/a.md', 'semantic/a-2.md'].includes(p) }
    expect(freeVaultPath(v, 'semantic', 'a')).toBe('semantic/a-3.md')
  })
})

describe('applyMemoryItem', () => {
  it('writes the verbatim body with kind, tier, aliases, dates and provenance', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem({ ...base, vault }, { jobId: 'j1', sourceProfile: 'claude-code', target: 'vault.semantic', transformed: T({ kind: 'feedback' }), relativePath: 'ai-memory/alpha_note.md' })
    expect(r).toEqual({ status: 'applied', kind: 'vault.procedural', ref: 'procedural/alpha_note.md' })
    expect(written[0].body).toBe('Body one.')
    expect(written[0].fm).toMatchObject({ title: 'Alpha Note', tier: 'procedural', kind: 'feedback', summary: 'Alpha', aliases: ['alpha_note'], links: ['beta'], created: '2026-05-01', updated: '2026-08-01' })
    expect(written[0].fm.tags).toEqual(expect.arrayContaining(['imported', 'source:claude-code', 'import-job:j1', 'x']))
    expect((written[0].fm.source as any).frontmatter).toEqual({ type: 'reference' })
  })
  it('reports unchanged when the same body already sits at the path', async () => {
    const { vault, written } = vaultMock({ 'semantic/alpha_note.md': 'Body one.' })
    const r = await applyMemoryItem({ ...base, vault }, { jobId: 'j1', sourceProfile: 'claude-code', target: 'vault.semantic', transformed: T(), relativePath: 'ai-memory/alpha_note.md' })
    expect(r).toEqual({ status: 'unchanged', ref: 'semantic/alpha_note.md' })
    expect(written).toHaveLength(0)
  })
  it('writes a -2 sibling with a conflict tag when the path holds a different body', async () => {
    const { vault, written } = vaultMock({ 'semantic/alpha_note.md': 'Other body.' })
    const r = await applyMemoryItem({ ...base, vault }, { jobId: 'j1', sourceProfile: 'claude-code', target: 'vault.semantic', transformed: T(), relativePath: 'ai-memory/alpha_note.md' })
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/alpha_note-2.md' })
    expect(written[0].fm.tags).toContain('conflict-with:semantic/alpha_note.md')
  })
  it('imports MEMORY.md as one note tagged index', async () => {
    const { vault, written } = vaultMock()
    const r = await applyMemoryItem({ ...base, vault }, { jobId: 'j1', sourceProfile: 'grok-cli', target: 'vault.semantic', transformed: T({ title: 'Memory Index', body: '- [a](a.md)\n- [b](b.md)' }), relativePath: '.grok/memory/MEMORY.md' })
    expect(r).toMatchObject({ status: 'applied', ref: 'semantic/memory-index-grok-cli.md' })
    expect(written[0].fm.tags).toContain('index')
  })
  it('creates an episodic row for sessions with validFrom and the session tag', async () => {
    const calls: any[] = []
    const episodic = { create: (i: any) => { calls.push(i); return { id: 'e1' } } }
    const r = await applyMemoryItem({ ...base, episodic }, { jobId: 'j1', sourceProfile: 'obsidian', target: 'episodic', transformed: T({ body: 'log body' }), relativePath: 'claude-sessions/x.md', sessionId: 'abc', sessionDate: '2026-09-05T11:06:00.000Z' })
    expect(r).toEqual({ status: 'applied', kind: 'episodic', ref: 'e1' })
    expect(calls[0]).toMatchObject({ content: 'log body', sourceType: 'system', sourceId: 'import:j1', validFrom: '2026-09-05T11:06:00.000Z' })
    expect(calls[0].tags).toEqual(expect.arrayContaining(['imported', 'source:obsidian', 'import-job:j1', 'session:abc']))
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/apply-memory.test.ts` → FAIL.

- [ ] **Step 3: Rewrite the memory half of `apply.ts`**

Replace the imports, `slugify`, `ApplyResult`, the `vault`/`episodic` dep types and `applyMemoryItem` with:

```ts
import { generateId } from '@shared/crypto'
import { basename } from 'node:path'
import { OWN_SKILLS_CATEGORY, IMPORT_TAGS } from '../constants.js'
import { isMemoryIndexBasename } from '../memory-index-hooks.js'
import { safeImportedKind } from './transform.js'
import type { CandidateTarget, ImportedNoteKind, MemoryTransformResult, SkillTransformResult, SourceProfile } from '../types.js'

export interface ApplyDeps {
  episodic?: {
    create: (input: { content: string; sourceType: 'system' | 'extraction' | 'user' | 'conversation'; sourceId?: string; tags?: string[]; validFrom?: string }) => { id: string }
  }
  vault?: {
    write: (path: string, frontmatter: Record<string, unknown>, content: string) => void
    exists: (path: string) => boolean
    read?: (path: string) => { content: string } | null
  }
  indexer?: { indexAll: () => number }
  skills?: { /* unchanged, extended in Task 11 */ create: (input: { name: string; description?: string; category?: string; triggerPatterns?: string[]; capabilities?: string[]; content: string; skillType?: 'knowledge' | 'tool' | 'integration' }) => { id: string } }
  createProposal: (input: { jobId: string; agentId: string; workspaceFile: string; title: string; proposedBody: string; existingBody: string | null }) => string
  readWorkspaceFile?: (agentId: string, file: string) => string | null
  resolveDefaultAgentId: () => string | null
  logger?: { info?: (o: unknown, m?: string) => void; warn?: (o: unknown, m?: string) => void }
}

export type ApplyResult =
  | { status: 'applied'; kind: string; ref: string }
  | { status: 'unchanged'; ref: string }
  | { status: 'proposal'; proposalId: string; workspaceFile: string }
  | { status: 'skipped'; reason: string }
  | { status: 'error'; error: string }

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || generateId().slice(0, 8)
}

function baseTags(sourceProfile: SourceProfile, jobId: string): string[] {
  return [IMPORT_TAGS.imported, `${IMPORT_TAGS.sourcePrefix}${sourceProfile}`, `${IMPORT_TAGS.jobPrefix}${jobId}`]
}

/** Same rule as the capture note-writer: feedback is procedural, scoped notes live in their folder. */
export function folderForKind(kind: ImportedNoteKind, scope: { projectId?: string | null; projectTypeId?: string | null } = {}): string {
  if (kind === 'feedback') return 'procedural'
  if (kind === 'project' && scope.projectId) return `projects/${scope.projectId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
  if (kind === 'domain' && scope.projectTypeId) return `project-types/${scope.projectTypeId.replace(/[^a-zA-Z0-9._-]/g, '-')}`
  return 'semantic'
}

/** The source file name IS the slug: every `[[old_slug]]` in every other note keeps resolving. */
export function slugFromSource(relativePath: string, title: string, unit: string | null): string {
  const base = basename(relativePath.replace(/\\/g, '/')).replace(/\.(md|markdown|txt|mdc|json|jsonl|sqlite)$/i, '')
  const stem = unit ? `${base}-${unit}` : base
  const safe = stem.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80)
  return safe || slugify(title)
}

export function freeVaultPath(vault: { exists: (p: string) => boolean }, folder: string, slug: string): string {
  let path = `${folder}/${slug}.md`
  let n = 2
  while (vault.exists(path)) { path = `${folder}/${slug}-${n}.md`; n++ }
  return path
}

export async function applyMemoryItem(
  deps: ApplyDeps,
  input: {
    jobId: string
    sourceProfile: SourceProfile
    target: CandidateTarget
    transformed: MemoryTransformResult
    relativePath?: string
    unit?: string | null
    sessionId?: string | null
    sessionDate?: string | null
    scope?: { projectId?: string | null; projectTypeId?: string | null }
  },
): Promise<ApplyResult> {
  const t = input.transformed
  if (t.skip || !t.body.trim()) return { status: 'skipped', reason: 'empty body' }
  const rel = input.relativePath ?? ''
  const isIndex = isMemoryIndexBasename(rel)
  const tags = [...new Set([...baseTags(input.sourceProfile, input.jobId), ...t.tags, ...(isIndex ? ['index'] : []), ...(input.sessionId ? [`session:${input.sessionId}`] : [])].map((x) => x.trim()).filter(Boolean))]

  try {
    if (input.target === 'episodic') {
      if (!deps.episodic) return { status: 'skipped', reason: 'episodic service unavailable' }
      const mem = deps.episodic.create({ content: t.body, sourceType: 'system', sourceId: `import:${input.jobId}`, tags, ...(input.sessionDate ? { validFrom: input.sessionDate } : {}) })
      return { status: 'applied', kind: 'episodic', ref: mem.id }
    }
    if (input.target === 'vault.semantic' || input.target === 'vault.procedural') {
      if (!deps.vault) return { status: 'skipped', reason: 'vault service unavailable' }
      const kind = safeImportedKind(t.kind)
      const folder = input.target === 'vault.procedural' ? 'procedural' : folderForKind(kind, input.scope)
      const tier = folder === 'procedural' ? 'procedural' : 'semantic'
      const slug = isIndex ? `memory-index-${input.sourceProfile}` : slugFromSource(rel, t.title, input.unit ?? null)
      const basePath = `${folder}/${slug}.md`
      if (deps.vault.exists(basePath)) {
        const existing = deps.vault.read?.(basePath)
        if (existing && existing.content.trim() === t.body.trim()) return { status: 'unchanged', ref: basePath }
      }
      const path = freeVaultPath(deps.vault, folder, slug)
      if (path !== basePath) tags.push(`conflict-with:${basePath}`)
      const today = new Date().toISOString().slice(0, 10)
      deps.vault.write(path, {
        title: t.title, tags, tier, kind,
        summary: t.summary_one_line || undefined,
        links: t.links, aliases: t.aliases.length ? t.aliases : undefined,
        created: t.created ?? today, updated: t.updated ?? today,
        source: t.source,
      }, t.body)
      deps.indexer?.indexAll()
      return { status: 'applied', kind: `vault.${tier}`, ref: path }
    }
    return { status: 'skipped', reason: `unsupported memory target: ${input.target}` }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
```

Keep `applySkillItem` and `applyWorkspaceProposal` as they are for now (Tasks 11 and 13 replace them). Remove the now-unused `isImportJunk`/`isMemoryIndexFile` imports from `apply.ts`.

- [ ] **Step 4: Run to verify it passes** — `bun vitest run tests/modules/data-port/apply-memory.test.ts` → PASS (8 tests).

- [ ] **Step 5: Review** — `git status --short`.

---

### Task 11: Skill packages — frontmatter, triggers, bundled files, on-disk copy

**Files:**
- Create: `src/modules/data-port/skill-package.ts`
- Modify: `src/modules/data-port/pipeline/apply.ts` (`applySkillItem`, `ApplyDeps.skills`), `src/modules/data-port/types.ts` (`SkillTransformResult`)
- Delete: `src/modules/data-port/prompts/transform-skill.ts` (no model pass for skills; update `tests/modules/data-port/import-prompts.test.ts` if it imports it — it does not).
- Test: `tests/modules/data-port/skill-package.test.ts`

**Interfaces:**
- Produces: `deriveTriggers(name: string, description: string, h1: string | null): string[]`; `fenceLanguage(relPath: string): string`; `assembleSkillContent(body: string, assets: Array<{ relPath: string; content: string }>, onDiskDir: string | null): string`; `buildSkillFromPackage(input: { relativePath: string; raw: string; assets: Array<{ relPath: string; content: string; mode?: number }> }): SkillTransformResult`.
- `SkillTransformResult` gains `assets: Array<{ relPath: string; content: string; mode?: number }>` and `sourcePath: string`.
- `ApplyDeps.skills` gains `findByName?: (name: string) => { id: string; content: string } | null` and `writeAssets?: (skillName: string, assets: Array<{ relPath: string; content: string; mode?: number }>) => string` (returns the absolute dir).
- `applySkillItem` returns `unchanged` when a skill of the same name has identical content; tags conflicts.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/skill-package.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { deriveTriggers, fenceLanguage, assembleSkillContent, buildSkillFromPackage } from '@modules/data-port/skill-package'
import { applySkillItem } from '@modules/data-port/pipeline/apply'

const SKILL = '---\nname: odoo-ticket\ndescription: |\n  Fetch a ticket by ID.\n  Use when: user says "ticket 123", „nézd meg a 456-os ticketet", or "odoo ticket".\n---\n# Odoo Ticket Fetcher\n\nRun `scripts/fetch_ticket.py`.\n'

describe('skill package', () => {
  it('derives triggers from quoted phrases, the name and the H1', () => {
    expect(deriveTriggers('odoo-ticket', 'Use when "ticket 123", „nézd meg a 456-os ticketet"', 'Odoo Ticket Fetcher'))
      .toEqual(['ticket 123', 'nézd meg a 456-os ticketet', 'odoo-ticket', 'odoo ticket', 'Odoo Ticket Fetcher'])
  })
  it('picks fence languages by extension', () => {
    expect(fenceLanguage('scripts/a.py')).toBe('python')
    expect(fenceLanguage('scripts/a.sh')).toBe('bash')
    expect(fenceLanguage('references/x.md')).toBe('')
    expect(fenceLanguage('data.json')).toBe('json')
  })
  it('appends every asset verbatim, markdown inline and code fenced', () => {
    const c = assembleSkillContent('# Body', [{ relPath: 'references/r.md', content: '# Ref\ntext' }, { relPath: 'scripts/a.py', content: 'print(1)' }], '/data/skills/imported/odoo-ticket')
    expect(c).toContain('# Body\n\n---\n\n## Bundled files (imported verbatim)')
    expect(c).toContain('Files are also stored at `/data/skills/imported/odoo-ticket/`')
    expect(c).toContain('### references/r.md\n\n# Ref\ntext')
    expect(c).toContain('### scripts/a.py\n\n```python\nprint(1)\n```')
  })
  it('builds a skill from SKILL.md with full frontmatter and body', () => {
    const s = buildSkillFromPackage({ relativePath: '.claude/skills/odoo-ticket/SKILL.md', raw: SKILL, assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }] })
    expect(s.name).toBe('odoo-ticket')
    expect(s.description).toBe('Fetch a ticket by ID.\nUse when: user says "ticket 123", „nézd meg a 456-os ticketet", or "odoo ticket".')
    expect(s.trigger_patterns).toEqual(['ticket 123', 'nézd meg a 456-os ticketet', 'odoo ticket', 'odoo-ticket', 'Odoo Ticket Fetcher'])
    expect(s.content.startsWith('# Odoo Ticket Fetcher')).toBe(true)
    expect(s.content).toContain('### scripts/fetch_ticket.py')
    expect(s.assets).toHaveLength(1)
    expect(s.skill_type).toBe('knowledge')
  })
  it('names a SKILL.md without frontmatter after its directory', () => {
    expect(buildSkillFromPackage({ relativePath: 'Documents/Scheduled/linkedin-daily/SKILL.md', raw: 'Daily review.', assets: [] }).name).toBe('linkedin-daily')
  })
})

describe('applySkillItem', () => {
  const built = buildSkillFromPackage({ relativePath: '.claude/skills/odoo-ticket/SKILL.md', raw: SKILL, assets: [{ relPath: 'scripts/fetch_ticket.py', content: 'x = 1' }] })
  it('creates the skill in own/<name>, writes assets, tags the job', async () => {
    const created: any[] = []
    const written: any[] = []
    const r = await applySkillItem({
      createProposal: () => 'p', resolveDefaultAgentId: () => 'a',
      skills: { create: (i) => { created.push(i); return { id: 'sk1' } }, findByName: () => null, writeAssets: (n, a) => { written.push([n, a]); return `/data/skills/imported/${n}` } },
    }, { jobId: 'j1', sourceProfile: 'claude-code', transformed: built })
    expect(r).toEqual({ status: 'applied', kind: 'skill', ref: 'sk1' })
    expect(created[0]).toMatchObject({ name: 'odoo-ticket', category: 'own/odoo-ticket', skillType: 'knowledge' })
    expect(created[0].capabilities).toEqual(expect.arrayContaining(['imported', 'source:claude-code', 'import-job:j1']))
    expect(created[0].content).toContain('/data/skills/imported/odoo-ticket/')
    expect(written[0][0]).toBe('odoo-ticket')
  })
  it('reports unchanged for an identical existing skill', async () => {
    const r = await applySkillItem({
      createProposal: () => 'p', resolveDefaultAgentId: () => 'a',
      skills: { create: () => { throw new Error('must not create') }, findByName: () => ({ id: 'sk0', content: built.content }), writeAssets: () => '' },
    }, { jobId: 'j1', sourceProfile: 'claude-code', transformed: built })
    expect(r).toEqual({ status: 'unchanged', ref: 'sk0' })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/skill-package.test.ts` → FAIL.

- [ ] **Step 3: Write `skill-package.ts`**

```ts
// src/modules/data-port/skill-package.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { basename, dirname, extname } from 'node:path'
import { extractQuotedPhrases, splitFrontmatter } from './source-frontmatter.js'
import type { SkillTransformResult } from './types.js'

const FENCES: Record<string, string> = {
  '.py': 'python', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.js': 'javascript', '.mjs': 'javascript', '.ts': 'typescript',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.sql': 'sql', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.txt': 'text', '.csv': 'text',
}

export function fenceLanguage(relPath: string): string {
  const ext = extname(relPath).toLowerCase()
  if (ext === '.md' || ext === '.markdown' || ext === '.mdc') return ''
  return FENCES[ext] ?? 'text'
}

export function deriveTriggers(name: string, description: string, h1: string | null): string[] {
  const out: string[] = []
  const push = (v: string | null | undefined) => { const s = (v ?? '').trim(); if (s && !out.includes(s)) out.push(s) }
  extractQuotedPhrases(description).forEach(push)
  push(name)
  push(name.replace(/[-_]+/g, ' '))
  push(h1)
  return out.slice(0, 24)
}

export function assembleSkillContent(body: string, assets: Array<{ relPath: string; content: string }>, onDiskDir: string | null): string {
  if (!assets.length) return body
  const parts = [body.trimEnd(), '', '---', '', '## Bundled files (imported verbatim)', '']
  if (onDiskDir) parts.push(`Files are also stored at \`${onDiskDir.replace(/\/?$/, '/')}\` so scripts can be run from there.`, '')
  for (const a of assets) {
    const lang = fenceLanguage(a.relPath)
    parts.push(`### ${a.relPath}`, '')
    if (lang === '') parts.push(a.content.trimEnd(), '')
    else parts.push('```' + lang, a.content.replace(/```/g, '``​`').trimEnd(), '```', '')
  }
  return parts.join('\n').trimEnd()
}

export function buildSkillFromPackage(input: { relativePath: string; raw: string; assets: Array<{ relPath: string; content: string; mode?: number }> }): SkillTransformResult {
  const { data, body } = splitFrontmatter(input.raw)
  const dir = basename(dirname(input.relativePath.replace(/\\/g, '/')))
  const name = (typeof data.name === 'string' && data.name.trim()) ? data.name.trim() : (dir && dir !== '.' ? dir : basename(input.relativePath).replace(/\.md$/i, ''))
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
  const declaredTriggers = Array.isArray(data.trigger_patterns) ? data.trigger_patterns.map(String) : Array.isArray(data.triggers) ? data.triggers.map(String) : []
  const capabilities = Array.isArray(data.capabilities) ? data.capabilities.map(String) : Array.isArray(data.tags) ? data.tags.map(String) : []
  return {
    name,
    description,
    trigger_patterns: [...new Set([...declaredTriggers, ...deriveTriggers(name, description, h1)])],
    capabilities,
    content: body,
    skill_type: 'knowledge',
    assets: input.assets,
    sourcePath: input.relativePath,
  }
}
```

- [ ] **Step 4: Extend `SkillTransformResult` in `types.ts`**

```ts
export interface SkillTransformResult {
  name: string
  description: string
  trigger_patterns: string[]
  capabilities: string[]
  /** SKILL.md body, verbatim. Bundled files are appended at apply time. */
  content: string
  skill_type: 'knowledge' | 'tool' | 'integration'
  assets: Array<{ relPath: string; content: string; mode?: number }>
  sourcePath: string
}
```

- [ ] **Step 5: Replace `applySkillItem` and the `skills` dep in `apply.ts`**

```ts
  skills?: {
    create: (input: { name: string; description?: string; category?: string; triggerPatterns?: string[]; capabilities?: string[]; content: string; skillType?: 'knowledge' | 'tool' | 'integration' }) => { id: string }
    findByName?: (name: string) => { id: string; content: string } | null
    /** Writes bundled files to disk; returns the absolute directory. */
    writeAssets?: (skillName: string, assets: Array<{ relPath: string; content: string; mode?: number }>) => string
  }
```

```ts
export async function applySkillItem(
  deps: ApplyDeps,
  input: { jobId: string; sourceProfile: SourceProfile; transformed: SkillTransformResult },
): Promise<ApplyResult> {
  if (!deps.skills) return { status: 'skipped', reason: 'skills service unavailable' }
  const t = input.transformed
  try {
    const safeName = t.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'skill'
    const onDisk = t.assets.length && deps.skills.writeAssets ? deps.skills.writeAssets(safeName, t.assets) : null
    const content = assembleSkillContent(t.content, t.assets, onDisk)
    const existing = deps.skills.findByName?.(t.name) ?? null
    if (existing && existing.content.trim() === content.trim()) return { status: 'unchanged', ref: existing.id }
    const skill = deps.skills.create({
      name: t.name,
      description: t.description,
      category: `${OWN_SKILLS_CATEGORY}/${safeName}`,
      triggerPatterns: t.trigger_patterns,
      capabilities: [...t.capabilities, ...baseTags(input.sourceProfile, input.jobId), ...(existing ? [`conflict-with:${existing.id}`] : [])],
      content,
      skillType: t.skill_type,
    })
    return { status: 'applied', kind: 'skill', ref: skill.id }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
```

Add `import { assembleSkillContent } from '../skill-package.js'` to `apply.ts`. Delete `prompts/transform-skill.ts`.

- [ ] **Step 6: Run to verify it passes** — `bun vitest run tests/modules/data-port/skill-package.test.ts` → PASS (7 tests).

- [ ] **Step 7: Review** — `git status --short`.

---

### Task 12: Personas — shared parser, tool-name map, agent target

**Files:**
- Modify: `src/modules/agent/persona-import.ts` (export `parsePersonaMarkdown`, `mapToolNames`; use them)
- Create: `src/modules/data-port/persona.ts`
- Modify: `src/modules/data-port/pipeline/apply.ts` (`applyPersonaItem`, `ApplyDeps.agents`)
- Test: `tests/modules/data-port/persona.test.ts`; extend `tests/modules/agent/persona-import.test.ts`

**Interfaces:**
- Produces (agent): `parsePersonaMarkdown(content: string, stem: string): ParsedPersona | null` with `ParsedPersona = { id: string; name: string; description: string; role: string; goal: string; systemPrompt: string; capabilities: string[]; tools: string[] | undefined; tier: AgentTier; agentType: AgentType; originalTools: string[]; unknownTools: string[]; frontmatter: Record<string, unknown> }`; `mapToolNames(names: string[]): { tools: string[] | undefined; unknown: string[] }`.
- Produces (data-port): `applyPersonaItem(deps, { jobId, sourceProfile, relativePath, raw })`; `ApplyDeps.agents = { get(id): { id; systemPrompt: string; source: string } | null; create(input: CreateAgentInput): { id: string } }`.
- Tool map: `Read→read_file, Write→write_file, Edit→edit_file, MultiEdit→edit_file, Bash→run_command, Glob→glob, Grep→grep, WebSearch→research, WebFetch→research, NotebookEdit→edit_file`; unknown names are dropped and reported; an empty mapped list yields `tools: undefined` (default toolset), never `[]`.
- `agentType` keyword map on `name + description`: `developer|engineer|backend|frontend → developer`; `review|qa|test → reviewer`; `critic|advocate|skeptic → critic`; `research → researcher`; `owner|plan|product → planner`; else `assistant`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/persona.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { parsePersonaMarkdown, mapToolNames } from '@modules/agent/persona-import'
import { applyPersonaItem } from '@modules/data-port/pipeline/apply'

const DEV = '---\nname: developer\ndescription: "Senior developer - writes code"\ntools:\n  - Read\n  - Write\n  - Bash\n  - Magic\n---\nYou write clean code.\n'

describe('parsePersonaMarkdown', () => {
  it('maps frontmatter, body and tools', () => {
    const p = parsePersonaMarkdown(DEV, 'developer')!
    expect(p).toMatchObject({ id: 'developer', name: 'developer', description: 'Senior developer - writes code', systemPrompt: 'You write clean code.', agentType: 'developer', tier: 'team' })
    expect(p.tools).toEqual(['read_file', 'write_file', 'run_command'])
    expect(p.originalTools).toEqual(['Read', 'Write', 'Bash', 'Magic'])
  })
  it('omits tools when nothing maps, instead of a tool-less agent', () => {
    expect(mapToolNames(['Magic'])).toEqual({ tools: undefined, unknown: ['Magic'] })
    expect(mapToolNames([])).toEqual({ tools: undefined, unknown: [] })
  })
  it('returns null without frontmatter', () => {
    expect(parsePersonaMarkdown('just text', 'x')).toBeNull()
  })
})

describe('applyPersonaItem', () => {
  it('creates a user-sourced, non-addressable specialist tagged with the job', async () => {
    const created: any[] = []
    const r = await applyPersonaItem({ createProposal: () => 'p', resolveDefaultAgentId: () => 'a', agents: { get: () => null, create: (i) => { created.push(i); return { id: i.id } } } },
      { jobId: 'j1', sourceProfile: 'claude-code', relativePath: '.claude/agents/developer.md', raw: DEV })
    expect(r).toEqual({ status: 'applied', kind: 'agent', ref: 'developer' })
    expect(created[0]).toMatchObject({ id: 'developer', source: 'user', tier: 'specialist', agentType: 'developer', systemPrompt: 'You write clean code.', tools: ['read_file', 'write_file', 'run_command'] })
    expect(created[0].tags).toEqual(expect.arrayContaining(['imported', 'source:claude-code', 'import-job:j1', 'claude-tool:Magic']))
  })
  it('reports unchanged for the same prompt and suffixes a different one', async () => {
    const deps = (existing: string) => ({ createProposal: () => 'p', resolveDefaultAgentId: () => 'a', agents: { get: (id: string) => (id === 'developer' ? { id, systemPrompt: existing, source: 'user' } : null), create: (i: any) => ({ id: i.id }) } })
    expect(await applyPersonaItem(deps('You write clean code.'), { jobId: 'j1', sourceProfile: 'claude-code', relativePath: '.claude/agents/developer.md', raw: DEV })).toEqual({ status: 'unchanged', ref: 'developer' })
    expect(await applyPersonaItem(deps('other'), { jobId: 'j1', sourceProfile: 'claude-code', relativePath: '.claude/agents/developer.md', raw: DEV })).toEqual({ status: 'applied', kind: 'agent', ref: 'developer-2' })
  })
})
```

Add to `tests/modules/agent/persona-import.test.ts`:

```ts
  it('maps Claude tool names for importRoots personas too', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'persona-'))
    writeFileSync(join(dir, 'r.md'), '---\nname: r\ndescription: reviewer\ntools:\n  - Read\n  - Grep\n---\nReview.')
    const registry = createAgentRegistry(db)
    await importPersonasFromDirectory(registry, dir)
    expect(registry.get('r')?.tools).toEqual(['read_file', 'grep'])
    rmSync(dir, { recursive: true, force: true })
  })
```

(use the file's existing `db`/imports; add `mkdtempSync`, `writeFileSync`, `rmSync`, `tmpdir`, `join` imports if absent.)

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/persona.test.ts tests/modules/agent/persona-import.test.ts` → FAIL.

- [ ] **Step 3: Refactor `persona-import.ts`**

Insert after `asAgentTier`:

```ts
const TOOL_MAP: Record<string, string> = {
  Read: 'read_file', Write: 'write_file', Edit: 'edit_file', MultiEdit: 'edit_file', NotebookEdit: 'edit_file',
  Bash: 'run_command', Glob: 'glob', Grep: 'grep', WebSearch: 'research', WebFetch: 'research',
}

/** Claude-style tool names → EYAS tool ids. Nothing mapped = default toolset (undefined), never an empty list. */
export function mapToolNames(names: string[]): { tools: string[] | undefined; unknown: string[] } {
  const tools: string[] = []
  const unknown: string[] = []
  for (const n of names) {
    const id = TOOL_MAP[n] ?? (/^[a-z_]+$/.test(n) ? n : undefined)
    if (id) { if (!tools.includes(id)) tools.push(id) } else unknown.push(n)
  }
  return { tools: tools.length ? tools : undefined, unknown }
}

function inferAgentType(text: string): AgentType {
  const t = text.toLowerCase()
  if (/\b(developer|engineer|backend|frontend|fejleszt)/.test(t)) return 'developer'
  if (/\b(review|qa|test)/.test(t)) return 'reviewer'
  if (/\b(critic|advocate|skeptic|kritik)/.test(t)) return 'critic'
  if (/\bresearch|kutat/.test(t)) return 'researcher'
  if (/\b(owner|plan|product)/.test(t)) return 'planner'
  return 'assistant'
}

export interface ParsedPersona {
  id: string; name: string; description: string; role: string; goal: string; systemPrompt: string
  capabilities: string[]; tools: string[] | undefined; tier: AgentTier; agentType: AgentType
  originalTools: string[]; unknownTools: string[]; frontmatter: Record<string, unknown>
}

export function parsePersonaMarkdown(content: string, stem: string): ParsedPersona | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return null
  let frontmatter: Record<string, unknown> | null
  try { frontmatter = parseYaml(match[1]) as Record<string, unknown> | null } catch { return null }
  if (!frontmatter || typeof frontmatter !== 'object') return null
  const body = match[2].trim()
  const id = String(frontmatter.id ?? frontmatter.name ?? stem).trim()
  if (!id) return null
  const name = String(frontmatter.name ?? id).trim() || id
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''
  const originalTools = stringList(frontmatter.tools)
  const { tools, unknown: unknownTools } = mapToolNames(originalTools)
  const declaredType = frontmatter.agentType ?? frontmatter.agent_type
  return {
    id, name, description,
    role: typeof frontmatter.role === 'string' ? frontmatter.role : (description || id),
    goal: typeof frontmatter.goal === 'string' ? frontmatter.goal : description,
    systemPrompt: body,
    capabilities: stringList(frontmatter.capabilities),
    tools,
    tier: asAgentTier(frontmatter.tier),
    agentType: typeof declaredType === 'string' && AGENT_TYPES.has(declaredType as AgentType) ? (declaredType as AgentType) : inferAgentType(`${name} ${description}`),
    originalTools,
    unknownTools,
    frontmatter,
  }
}
```

Then make `importPersonasFromDirectory` use it: replace its per-file body from `const match = …` down to the `registry.create({...})` call with:

```ts
      const content = await readFile(join(dir, file), 'utf-8')
      const p = parsePersonaMarkdown(content, file.replace(/\.md$/i, ''))
      if (!p) continue
      const existing = registry.get(p.id)
      if (existing) {
        registry.update(p.id, { name: p.name, description: p.description || existing.description, role: p.role, systemPrompt: p.systemPrompt, tools: p.tools ?? existing.tools })
      } else {
        registry.create({ id: p.id, name: p.name, role: p.role, description: p.description, goal: p.goal, backstory: '', systemPrompt: p.systemPrompt, capabilities: p.capabilities, tools: p.tools ?? [], constraints: [], tier: p.tier, agentType: p.agentType, source: 'user' })
      }
```

- [ ] **Step 4: Add `applyPersonaItem` to `apply.ts`**

Add to `ApplyDeps`:

```ts
  agents?: {
    get: (id: string) => { id: string; systemPrompt: string; source: string } | null
    create: (input: import('@modules/agent/types.js').CreateAgentInput) => { id: string }
  }
```

Add the function (import `parsePersonaMarkdown` from `@modules/agent/persona-import.js` and `basename` is already imported):

```ts
export async function applyPersonaItem(
  deps: ApplyDeps,
  input: { jobId: string; sourceProfile: SourceProfile; relativePath: string; raw: string },
): Promise<ApplyResult> {
  if (!deps.agents) return { status: 'skipped', reason: 'agent registry unavailable' }
  const stem = basename(input.relativePath).replace(/\.(agent\.)?md$/i, '')
  const p = parsePersonaMarkdown(input.raw, stem)
  if (!p) return { status: 'skipped', reason: 'no frontmatter — not a persona' }
  try {
    let id = p.id
    const existing = deps.agents.get(id)
    if (existing && existing.systemPrompt.trim() === p.systemPrompt.trim()) return { status: 'unchanged', ref: id }
    const tags = [...baseTags(input.sourceProfile, input.jobId), ...p.unknownTools.map((t) => `claude-tool:${t}`)]
    if (existing) { let n = 2; while (deps.agents.get(`${p.id}-${n}`)) n++; id = `${p.id}-${n}`; tags.push(`conflict-with:${p.id}`) }
    const created = deps.agents.create({
      id, name: p.name, role: p.role, description: p.description, goal: p.goal, backstory: '',
      systemPrompt: p.systemPrompt, capabilities: p.capabilities, tools: p.tools ?? [], constraints: [],
      tier: 'specialist', agentType: p.agentType, source: 'user', enabled: true, tags,
    })
    return { status: 'applied', kind: 'agent', ref: created.id }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
```

Note: `CreateAgentInput.tools` is `string[]`; the registry treats `[]` as "no tools" only in conversation-runner (Task 16 does not touch that) — so when `p.tools` is undefined pass the registry's default toolset: read it once in `data-port/index.ts` as `defaultTools = registry.get(<primary>)?.tools ?? []` and inject via `deps.agents.create` wrapper (Task 14 wires: `create: (i) => registry.create({ ...i, tools: i.tools.length ? i.tools : defaultTools })`).

- [ ] **Step 5: Run to verify it passes** — `bun vitest run tests/modules/data-port/persona.test.ts tests/modules/agent/persona-import.test.ts` → PASS.

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 13: Rules — primary agent, append on approval, project-type prompt target

**Files:**
- Modify: `src/modules/data-port/service.ts` (`approveProposal`, `createProposal` unchanged), `src/modules/data-port/index.ts` (`resolveDefaultAgentId`, project-type prompt reader/writer), `src/modules/data-port/pipeline/apply.ts` (`applyWorkspaceProposal` body from full text; `prompt.project-type` file id)
- Test: `tests/modules/data-port/proposals.test.ts`

**Interfaces:**
- Produces: `resolveDefaultAgentId()` = `SELECT id FROM agent_definitions WHERE enabled = 1 AND tier = 'primary' ORDER BY created_at ASC LIMIT 1`, then addressable, then any.
- `workspaceFileForTarget('prompt.project-type')` = `'project-type:general'`; `readWorkspaceFile(agentId, 'project-type:general')` reads `project_types.prompt WHERE id='general'`; the writer for that file id updates the same column. Proposal rows for it use `agent_id = '-'`.
- `approveProposal(id, writer, reader)` re-reads the current file via `reader.read(agentId, file)` and appends `\n\n---\n\n## Imported: <title> (<sourcePath>)\n\n<body>\n`; `existing_body` in the row is display-only.
- `applyWorkspaceProposal` input gains `sourcePath: string` and `frontmatterYaml: string | null` (kept as a fenced block at the top of the appended section).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/proposals.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { applyWorkspaceProposal } from '@modules/data-port/pipeline/apply'

let db: any
let files: Record<string, string>
let service: ReturnType<typeof createDataPortService>
const logger = { debug() {}, info() {}, warn() {}, error() {} }

beforeEach(() => {
  db = createMemoryDb()
  createDataPortTables(db)
  files = { 'a1/AGENTS.md': 'seed rules', 'project-type:general': 'type prompt' }
  service = createDataPortService({ db, modelCtx: {}, applyDepsFactory: () => ({ createProposal: (i) => service.createProposal(i), resolveDefaultAgentId: () => 'a1', readWorkspaceFile: (a, f) => files[`${a}/${f}`] ?? files[f] ?? null }), dataDir: '/tmp/x', logger })
})

describe('proposals', () => {
  it('two approvals both survive because approval re-reads the current file', async () => {
    const p1 = await applyWorkspaceProposal({ createProposal: (i) => service.createProposal(i), resolveDefaultAgentId: () => 'a1', readWorkspaceFile: (a, f) => files[`${a}/${f}`] ?? null }, { jobId: 'j', target: 'workspace.agents', title: 'Grok rules', body: 'G', sourcePath: '.grok/AGENTS.md', frontmatterYaml: null })
    const p2 = await applyWorkspaceProposal({ createProposal: (i) => service.createProposal(i), resolveDefaultAgentId: () => 'a1', readWorkspaceFile: (a, f) => files[`${a}/${f}`] ?? null }, { jobId: 'j', target: 'workspace.agents', title: 'Claude rules', body: 'C', sourcePath: '.claude/CLAUDE.md', frontmatterYaml: 'x: 1' })
    const writer = { write: async (r: any) => { files[`${r.agentId}/${r.file}`] = r.body } }
    const reader = { read: (a: string, f: string) => files[`${a}/${f}`] ?? null }
    await service.approveProposal((p1 as any).proposalId, writer, reader)
    await service.approveProposal((p2 as any).proposalId, writer, reader)
    const out = files['a1/AGENTS.md']
    expect(out.startsWith('seed rules')).toBe(true)
    expect(out).toContain('## Imported: Grok rules (.grok/AGENTS.md)\n\nG')
    expect(out).toContain('## Imported: Claude rules (.claude/CLAUDE.md)\n\n```yaml\nx: 1\n```\n\nC')
  })
  it('routes prompt.project-type proposals to the general type prompt', async () => {
    const r = await applyWorkspaceProposal({ createProposal: (i) => service.createProposal(i), resolveDefaultAgentId: () => 'a1', readWorkspaceFile: (a, f) => files[f] ?? null }, { jobId: 'j', target: 'prompt.project-type', title: 'Rules', body: 'R', sourcePath: 'CLAUDE.md', frontmatterYaml: null })
    expect(r).toMatchObject({ status: 'proposal', workspaceFile: 'project-type:general' })
    const row = db.all(sql`SELECT agent_id, existing_body FROM data_port_proposals`)[0]
    expect(row.agent_id).toBe('-')
    expect(row.existing_body).toBe('type prompt')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/proposals.test.ts` → FAIL (`approveProposal` has no reader; `prompt.project-type` unsupported).

- [ ] **Step 3: Update `apply.ts`**

In `workspaceFileForTarget` add `case 'prompt.project-type': return 'project-type:general'`. Replace `applyWorkspaceProposal`:

```ts
export async function applyWorkspaceProposal(
  deps: ApplyDeps,
  input: { jobId: string; target: CandidateTarget; title: string; body: string; sourcePath: string; frontmatterYaml: string | null },
): Promise<ApplyResult> {
  const file = workspaceFileForTarget(input.target)
  if (!file) return { status: 'skipped', reason: `not a workspace target: ${input.target}` }
  const agentId = input.target === 'prompt.project-type' ? '-' : deps.resolveDefaultAgentId()
  if (!agentId) return { status: 'skipped', reason: 'no agent available for workspace proposal' }
  try {
    const existing = deps.readWorkspaceFile?.(agentId, file) ?? null
    const proposed = input.frontmatterYaml ? '```yaml\n' + input.frontmatterYaml.trim() + '\n```\n\n' + input.body : input.body
    const proposalId = deps.createProposal({ jobId: input.jobId, agentId, workspaceFile: file, title: `${input.title} (${input.sourcePath})`, proposedBody: proposed, existingBody: existing })
    return { status: 'proposal', proposalId, workspaceFile: file }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Update `service.ts`**

Replace `approveProposal`:

```ts
    async approveProposal(
      id: string,
      writer: { write: (req: { agentId: string; file: string; body: string }) => Promise<void> },
      reader?: { read: (agentId: string, file: string) => string | null },
    ): Promise<WorkspaceProposal> {
      const proposal = this.getProposal(id)
      if (!proposal) throw new Error('Proposal not found')
      if (proposal.status !== 'pending') throw new Error(`Proposal already ${proposal.status}`)
      // Append to what is on disk NOW — a snapshot taken at scan time would erase every approval made since.
      const current = reader?.read(proposal.agentId, proposal.workspaceFile) ?? proposal.existingBody ?? ''
      const section = `## Imported: ${proposal.title}\n\n${proposal.proposedBody.trim()}\n`
      const body = current.trim() ? `${current.trimEnd()}\n\n---\n\n${section}` : section
      await writer.write({ agentId: proposal.agentId, file: proposal.workspaceFile, body })
      const now = new Date().toISOString()
      deps.db.run(sql`UPDATE data_port_proposals SET status = 'approved', resolved_at = ${now} WHERE id = ${id}`)
      return this.getProposal(id)!
    },
```

- [ ] **Step 5: Update `index.ts` wiring**

Replace `resolveDefaultAgentId` with:

```ts
        resolveDefaultAgentId: () => {
          const pick = (q: any) => (ctx.db.all(q) as Array<{ id: string }>)[0]?.id ?? null
          try {
            return pick(sql`SELECT id FROM agent_definitions WHERE enabled = 1 AND tier = 'primary' ORDER BY created_at ASC LIMIT 1`)
              ?? pick(sql`SELECT id FROM agent_definitions WHERE enabled = 1 AND addressable = 1 ORDER BY name ASC LIMIT 1`)
              ?? pick(sql`SELECT id FROM agent_definitions WHERE enabled = 1 ORDER BY name ASC LIMIT 1`)
          } catch { return null }
        },
```

Make `readWorkspaceFile` handle the type prompt: at the top of its body add

```ts
          if (file.startsWith('project-type:')) {
            const row = (ctx.db.all(sql`SELECT prompt FROM project_types WHERE id = ${file.slice('project-type:'.length)}`) as Array<{ prompt: string }>)[0]
            return row?.prompt ?? null
          }
```

And in `createDataPortRoutes(ctx.http, { … workspaceWriter: { write } })` make `write` branch: if `req.file.startsWith('project-type:')` run `ctx.db.run(sql\`UPDATE project_types SET prompt = ${req.body} WHERE id = ${req.file.slice(13)}\`)` else the existing `workspaceWriter.write`. Pass a `workspaceReader: { read: applyDepsFactory().readWorkspaceFile! }` too and, in `routes.ts`, call `service.approveProposal(id, deps.workspaceWriter, deps.workspaceReader)`.

- [ ] **Step 6: Run to verify it passes** — `bun vitest run tests/modules/data-port/proposals.test.ts` → PASS.

- [ ] **Step 7: Review** — `git status --short`.

---

### Task 14: Job runner — read units at apply time, hook pre-pass, stats, ledger, optional enrichment

**Files:**
- Modify: `src/modules/data-port/service.ts` (`persistScan`, `runJob`), `src/modules/data-port/index.ts` (apply deps: episodic, vault.read, skills.findByName/writeAssets, agents)
- Test: rewrite `tests/modules/data-port/scan-and-apply.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–13.
- Produces: `persistScan` stores candidates WITHOUT `content` but WITH `sourcePath/unit/sha256/mtime/birthtime/assets/sessionId/sessionDate`; API responses strip `sourcePath`. `runJob` per selected item: read file → adapter `read` (or `readSourceNote`) → route by target; stats `{ processed, applied, unchanged, skipped, proposals, errors, aiEnriched, aiFallback, byKind, skippedReasons }`; every applied/proposal result is written to the ledger.
- AI: `enrichMemory` only when `useAi` (≤ 48 selected) AND `note.declaredKind === null`; classify pass only for candidates of kind `unknown`/`knowledge`.

- [ ] **Step 1: Rewrite the test file**

```ts
// tests/modules/data-port/scan-and-apply.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { listApplied } from '@modules/data-port/ledger'

function createSkillsTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT, trigger_patterns TEXT, capabilities TEXT, version TEXT DEFAULT '1.0.0', content TEXT NOT NULL, skill_type TEXT NOT NULL DEFAULT 'knowledge', tool_config TEXT, integration_config TEXT, sources TEXT, source TEXT NOT NULL DEFAULT 'user', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source_path TEXT, source_root TEXT, last_seen_at TEXT, disabled_reason TEXT, disabled_at TEXT, disabled_by TEXT, use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT)`)
}

const wait = async (f: () => boolean, ms = 3000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20)) }

describe('data-port end to end', () => {
  let root: string, dataDir: string, db: any, service: ReturnType<typeof createDataPortService>, loader: ReturnType<typeof createSkillLoader>, vault: ReturnType<typeof createVaultService>
  const episodic: any[] = []
  const agents: any[] = []
  const logger = { debug() {}, info() {}, warn() {}, error() {} }

  beforeEach(() => {
    root = join(tmpdir(), `eyas-dp-${process.pid}-${Math.random().toString(36).slice(2)}`)
    dataDir = join(root, 'data')
    mkdirSync(join(root, 'src', 'ai-memory'), { recursive: true })
    mkdirSync(join(root, 'src', '.claude', 'skills', 'deploy', 'scripts'), { recursive: true })
    mkdirSync(join(root, 'src', '.claude', 'agents'), { recursive: true })
    mkdirSync(join(root, 'src', '.grok', 'memory', 'p1', 'sessions'), { recursive: true })
    writeFileSync(join(root, 'src', 'ai-memory', 'MEMORY.md'), '# Index\n## User\n- [Owner profile hook](user_profile.md)\n## Rules\n- [Never auto-commit](feedback_no_auto_commit.md)\n')
    writeFileSync(join(root, 'src', 'ai-memory', 'user_profile.md'), '---\nname: user_profile\ntype: user\n---\nSenior dev.\n')
    writeFileSync(join(root, 'src', 'ai-memory', 'feedback_no_auto_commit.md'), '---\nname: feedback_no_auto_commit\ndescription: Do not commit automatically\ntype: feedback\n---\n' + 'Never commit. '.repeat(1000))
    writeFileSync(join(root, 'src', 'ai-memory', 'bullets.md'), '---\ntype: project\n---\n- a\n- b\n- c\n- d\n- e\n')
    writeFileSync(join(root, 'src', '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Use when "deploy docs"\n---\n# Deploy\n' + 'step '.repeat(2000))
    writeFileSync(join(root, 'src', '.claude', 'skills', 'deploy', 'scripts', 'deploy.sh'), '#!/bin/sh\necho hi\n')
    writeFileSync(join(root, 'src', '.claude', 'agents', 'dev.md'), '---\nname: dev\ndescription: developer\ntools:\n  - Read\n---\nYou code.')
    writeFileSync(join(root, 'src', '.claude', 'CLAUDE.md'), '# Global rules\n' + 'rule '.repeat(4000))
    writeFileSync(join(root, 'src', '.grok', 'memory', 'p1', 'sessions', '2026-09-05-x-01a0abcd.md'), '## Session Summary\n\n- **Date:** 2026-09-05 07:25 UTC\n\n## Topics\n1. thing')
    db = createMemoryDb(); createDataPortTables(db); createSkillsTable(db)
    loader = createSkillLoader(db, logger)
    vault = createVaultService(join(dataDir, 'vault'))
    episodic.length = 0; agents.length = 0
    service = createDataPortService({
      db, modelCtx: {}, dataDir, logger,
      applyDepsFactory: () => ({
        vault: { write: (p, fm, c) => vault.write(p, fm as any, c), exists: (p) => vault.exists(p), read: (p) => vault.read(p) },
        episodic: { create: (i) => { episodic.push(i); return { id: `e${episodic.length}` } } },
        skills: { create: (i) => loader.create(i), findByName: (n) => loader.list(false).find((s) => s.name === n) ?? null, writeAssets: (n, a) => { const d = join(dataDir, 'skills', 'imported', n); for (const f of a) { mkdirSync(join(d, f.relPath, '..'), { recursive: true }); writeFileSync(join(d, f.relPath), f.content) } return d } },
        agents: { get: (id) => agents.find((a) => a.id === id) ?? null, create: (i) => { agents.push(i); return { id: i.id } } },
        createProposal: (i) => service.createProposal(i),
        resolveDefaultAgentId: () => 'primary-1',
        readWorkspaceFile: () => 'seed',
      }),
    })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('imports everything selected, verbatim, into the right layers, and records the ledger', async () => {
    const scan = service.scanPath('auto', join(root, 'src'))
    expect(scan.candidates.every((c) => !('sourcePath' in c))).toBe(true)
    const selection = scan.candidates.filter((c) => c.selectedByDefault).map((c) => ({ candidateId: c.id }))
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(job.id)?.status === 'completed')
    const done = service.getJob(job.id)!
    expect(done.stats.errors).toBe(0)
    expect(done.stats.byKind).toMatchObject({ memory: 3, index: 1, skill: 1, persona: 1, rule: 1, session: 1 })

    const fb = vault.read('procedural/feedback_no_auto_commit.md')!
    expect(fb.frontmatter.kind).toBe('feedback')
    expect(fb.frontmatter.summary).toBe('Do not commit automatically')
    expect(fb.content.length).toBeGreaterThan(13_000)
    const up = vault.read('semantic/user_profile.md')!
    expect(up.frontmatter.kind).toBe('user')
    expect(up.frontmatter.summary).toBe('Owner profile hook')
    expect(vault.read('semantic/bullets.md')?.frontmatter.kind).toBe('project')
    expect(vault.exists('semantic/memory-index-claude-code.md')).toBe(true)

    const skill = loader.list(false).find((s) => s.name === 'deploy')!
    expect(skill.content.length).toBeGreaterThan(10_000)
    expect(skill.content).toContain('### scripts/deploy.sh')
    expect(existsSync(join(dataDir, 'skills', 'imported', 'deploy', 'scripts', 'deploy.sh'))).toBe(true)
    expect(skill.triggerPatterns).toContain('deploy docs')

    expect(agents[0]).toMatchObject({ id: 'dev', tools: ['read_file'] })
    expect(episodic[0].content).toContain('## Session Summary')
    const proposals = service.listProposals({ jobId: job.id })
    expect(proposals[0].proposedBody.length).toBeGreaterThan(19_000)
    expect(proposals[0].agentId).toBe('primary-1')

    const ledger = listApplied(db, job.id)
    expect(ledger.map((r) => r.kind).sort()).toEqual(['agent', 'episodic', 'proposal', 'skill', 'skill-assets', 'vault', 'vault', 'vault', 'vault'])
  })

  it('is idempotent: a second run reports unchanged and writes nothing new', async () => {
    const scan = service.scanPath('auto', join(root, 'src'))
    const selection = scan.candidates.filter((c) => c.selectedByDefault && c.kind === 'memory').map((c) => ({ candidateId: c.id }))
    const j1 = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(j1.id)?.status === 'completed')
    const j2 = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection })
    await wait(() => service.getJob(j2.id)?.status === 'completed')
    expect(service.getJob(j2.id)!.stats).toMatchObject({ unchanged: 3, applied: 0 })
    expect(vault.listFiles().filter((f) => f.endsWith('-2.md'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/scan-and-apply.test.ts` → FAIL.

- [ ] **Step 3: Rewrite `persistScan` and `runJob` in `service.ts`**

`persistScan`: store `result.candidates.map(({ content: _c, ...rest }) => rest)` in `candidates_json` (the `content` field is never persisted); the public response additionally strips `sourcePath`: `publicCandidates = stored.map(({ sourcePath: _s, ...rest }) => rest)`. Keep the in-memory `scanCache` holding the stored (content-less) candidates.

Replace `runJob` with:

```ts
  async function runJob(jobId: string): Promise<void> {
    const job = getJob(jobId)
    if (!job) return
    const rows = deps.db.all(sql`SELECT selection_json FROM data_port_jobs WHERE id = ${jobId}`) as any[]
    const selection = JSON.parse(rows[0]?.selection_json || '[]') as ImportJobSelection[]
    const candidates = loadScanCandidates(job.scanId)
    if (!candidates) {
      updateJob(jobId, { status: 'failed', phase: 'error', error: 'Scan data expired or missing — re-scan and try again', finishedAt: new Date().toISOString() })
      return
    }
    const byId = new Map(candidates.map((c) => [c.id, c]))
    const selected = selection
      .map((s) => { const c = byId.get(s.candidateId); return c ? { candidate: c, target: s.target ?? c.target } : null })
      .filter(Boolean) as Array<{ candidate: ScanCandidate; target: CandidateTarget }>

    const stats = emptyStats()
    const skipWith = (reason: string) => { stats.skipped++; stats.skippedReasons[reason] = (stats.skippedReasons[reason] ?? 0) + 1 }
    updateJob(jobId, { status: 'running', phase: 'read', progress: 0.05, stats })

    const AI_ITEM_LIMIT = 48
    const useAi = Boolean(deps.modelCtx.model) && selected.length > 0 && selected.length <= AI_ITEM_LIMIT
    const applyDeps = deps.applyDepsFactory()
    const profile = job.sourceProfile === 'auto' ? (loadScanProfile(job.scanId) ?? 'generic-md') : job.sourceProfile
    const adapter = adapterFor(profile)

    // Pre-pass: hooks from every selected index file feed the summaries of the notes that follow.
    const hooks = new Map<string, IndexEntry>()
    for (const { candidate } of selected) {
      if (candidate.kind !== 'index' || !candidate.sourcePath) continue
      try {
        const parsed = parseMemoryIndex(splitFrontmatter(readFileSync(candidate.sourcePath, 'utf-8')).body)
        for (const [k, v] of parsed.entries) hooks.set(k, v)
      } catch { /* an unreadable index only loses its hooks */ }
    }

    const readUnit = (c: ScanCandidate): { raw: Buffer; note: SourceNote; sourceChanged: boolean } | null => {
      if (!c.sourcePath) return null
      let raw: Buffer
      try { raw = readFileSync(c.sourcePath) } catch { return null }
      const sha = createHash('sha256').update(raw).digest('hex')
      const times = { mtime: c.mtime, birthtime: c.birthtime }
      const note = adapter.read ? adapter.read(c.relativePath, raw, c.unit ?? null, times) : readSourceNote(c.relativePath, raw.toString('utf-8'), times)
      return { raw, note, sourceChanged: Boolean(c.sha256 && c.sha256 !== sha) }
    }

    const record = (kind: AppliedKind, ref: string, sourcePath?: string | null) => recordApplied(deps.db, { jobId, kind, ref, sourcePath: sourcePath ?? null })
    const total = selected.length || 1
    let lastProgressWrite = 0

    try {
      for (let i = 0; i < selected.length; i++) {
        const { candidate, target } = selected[i]!
        stats.processed++
        const kind = candidate.kind
        try {
          if (target === 'none' || kind === 'noise') { skipWith('not importable'); continue }
          const unit = readUnit(candidate)
          if (!unit) { stats.errors++; deps.logger?.warn?.({ path: candidate.relativePath }, 'data-port: source unreadable at apply time'); continue }
          const { raw, note, sourceChanged } = unit
          let result: ApplyResult

          if (target === 'workspace.agents' || target === 'workspace.soul' || target === 'workspace.identity' || target === 'workspace.tools' || target === 'workspace.memory' || target === 'prompt.project-type') {
            const fmYaml = note.hadFrontmatter ? stringifyYaml(note.data).trim() : null
            result = await applyWorkspaceProposal(applyDeps, { jobId, target, title: note.title, body: note.body, sourcePath: candidate.relativePath, frontmatterYaml: fmYaml })
          } else if (target === 'agent' || kind === 'persona') {
            result = await applyPersonaItem(applyDeps, { jobId, sourceProfile: profile, relativePath: candidate.relativePath, raw: raw.toString('utf-8') })
          } else if (target === 'skill' || kind === 'skill') {
            const assets = (candidate.assets ?? []).map((a) => {
              const full = join(dirname(candidate.sourcePath!), a.relPath)
              let mode: number | undefined
              try { mode = statSync(full).mode } catch { /* default */ }
              return { relPath: a.relPath, content: readFileSync(full, 'utf-8'), mode }
            })
            result = await applySkillItem(applyDeps, { jobId, sourceProfile: profile, transformed: buildSkillFromPackage({ relativePath: candidate.relativePath, raw: raw.toString('utf-8'), assets }) })
          } else if (target === 'episodic' || target === 'vault.semantic' || target === 'vault.procedural') {
            const key = basename(candidate.relativePath).replace(/\.md$/i, '')
            let transformed = normalizeMemory(note, { relativePath: candidate.relativePath, sourceProfile: profile, hooks: hooks.get(key) ?? null, sha256: candidate.sha256, mtime: candidate.mtime, unit: candidate.unit ?? null, sourceChanged })
            if (useAi && note.declaredKind === null && target !== 'episodic') {
              const e = await enrichMemory(deps.modelCtx, note, transformed, { path: candidate.relativePath, sourceProfile: profile })
              transformed = e.result
              if (e.enriched) stats.aiEnriched++; else stats.aiFallback++
            }
            result = await applyMemoryItem(applyDeps, { jobId, sourceProfile: profile, target, transformed, relativePath: candidate.relativePath, unit: candidate.unit ?? null, sessionId: candidate.sessionId ?? note.sessionId, sessionDate: candidate.sessionDate ?? note.sessionDate })
          } else {
            skipWith(`unsupported target ${target}`); continue
          }

          if (result.status === 'applied') {
            stats.applied++
            record(result.kind === 'episodic' ? 'episodic' : result.kind === 'skill' ? 'skill' : result.kind === 'agent' ? 'agent' : 'vault', result.ref, candidate.sourcePath)
            if (result.kind === 'skill' && candidate.assets?.length) record('skill-assets', result.ref, candidate.sourcePath)
          } else if (result.status === 'unchanged') stats.unchanged++
          else if (result.status === 'proposal') { stats.proposals++; record('proposal', result.proposalId, candidate.sourcePath) }
          else if (result.status === 'skipped') skipWith(result.reason)
          else { stats.errors++; deps.logger?.warn?.({ path: candidate.relativePath, err: result.error }, 'data-port item failed') }
        } catch (err) {
          stats.errors++
          deps.logger?.warn?.({ err: String(err), path: candidate.relativePath }, 'data-port item failed')
        } finally {
          stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1
          if (total <= 50 || i === total - 1 || i - lastProgressWrite >= 9) {
            lastProgressWrite = i
            updateJob(jobId, { phase: 'apply', progress: 0.05 + (0.95 * (i + 1)) / total, stats: { ...stats } })
          }
        }
      }
      updateJob(jobId, { status: 'completed', phase: 'done', progress: 1, stats, finishedAt: new Date().toISOString(), error: null })
    } catch (err) {
      updateJob(jobId, { status: 'failed', phase: 'error', error: err instanceof Error ? err.message : String(err), stats, finishedAt: new Date().toISOString() })
    }
  }
```

Supporting changes in `service.ts`: `emptyStats()` returns `{ processed: 0, applied: 0, unchanged: 0, skipped: 0, proposals: 0, errors: 0, aiEnriched: 0, aiFallback: 0, byKind: {}, skippedReasons: {} }`; add `loadScanProfile(scanId)` reading `detected_profile` from `data_port_scans`; imports: `createHash` (node:crypto), `readFileSync, statSync` (node:fs), `basename, dirname, join` (node:path), `stringify as stringifyYaml` from `'yaml'`, `adapterFor` (adapters/registry), `readSourceNote, splitFrontmatter` (source-frontmatter), `parseMemoryIndex` + `IndexEntry` (memory-index-hooks), `normalizeMemory, enrichMemory` (pipeline/transform), `applyMemoryItem, applySkillItem, applyPersonaItem, applyWorkspaceProposal, ApplyResult` (pipeline/apply), `buildSkillFromPackage` (skill-package), `recordApplied, AppliedKind` (ledger), `SourceNote` (adapters/types). Remove the `classifyCandidates` import and the old classify branch (AI classify is not needed: every candidate already carries a deterministic kind/target from the scan).

- [ ] **Step 4: Wire the richer deps in `index.ts`**

In `applyDepsFactory`:

```ts
      const memory = (ctx as any).memory
      const skills = (ctx as any).skills?.loader
      const registry = (ctx as any).agents?.registry
      const primaryTools = (): string[] => {
        try {
          const row = (ctx.db.all(sql`SELECT tools FROM agent_definitions WHERE tier = 'primary' AND enabled = 1 ORDER BY created_at ASC LIMIT 1`) as Array<{ tools: string }>)[0]
          return row?.tools ? (JSON.parse(row.tools) as string[]) : []
        } catch { return [] }
      }
      return {
        episodic: memory?.episodic,
        vault: memory?.vault ? { write: (p, fm, c) => memory.vault.write(p, fm, c), exists: (p) => memory.vault.exists(p), read: (p) => memory.vault.read(p) } : undefined,
        indexer: memory?.indexer,
        skills: skills ? {
          create: (input) => skills.create(input),
          findByName: (name) => skills.list(false).find((s: any) => s.name === name) ?? null,
          writeAssets: (name, assets) => {
            const dir = resolve(dataDir, 'skills', 'imported', name)
            for (const a of assets) {
              const full = resolve(dir, a.relPath)
              if (!full.startsWith(dir)) continue
              mkdirSync(dirname(full), { recursive: true })
              writeFileSync(full, a.content, { mode: a.mode ?? 0o644 })
            }
            return dir
          },
        } : undefined,
        agents: registry ? {
          get: (id) => { const a = registry.get(id); return a ? { id: a.id, systemPrompt: a.systemPrompt ?? '', source: a.source } : null },
          create: (i) => registry.create({ ...i, tools: i.tools.length ? i.tools : primaryTools() }),
        } : undefined,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: /* Task 13 version */,
        resolveDefaultAgentId: /* Task 13 version */,
        logger: ctx.logger,
      }
```

(imports: `mkdirSync, writeFileSync` from node:fs, `dirname, resolve` from node:path.)

- [ ] **Step 5: Run to verify it passes** — `bun vitest run tests/modules/data-port/scan-and-apply.test.ts` → PASS (2 tests).

- [ ] **Step 6: Full data-port suite and types** — `bun vitest run tests/modules/data-port && bun run lint 2>&1 | tail -3` → all green, error count ≤ baseline.

- [ ] **Step 7: Review** — `git status --short`.

---

### Task 15: Rollback endpoint, profiles from the registry, proposals with agent names

**Files:**
- Create: `src/modules/data-port/rollback.ts`
- Modify: `src/modules/data-port/service.ts` (`rollbackJob`, `listJobs` includes `rolledBack`), `src/modules/data-port/routes.ts` (profile schema from `listProfiles()`, target enum extended, `POST /import/jobs/:id/rollback`, `GET /import/profiles`, `agentName` on proposals), `src/modules/data-port/index.ts` (rollback deps)
- Test: `tests/modules/data-port/rollback.test.ts`

**Interfaces:**
- Produces: `rollbackJob(deps: RollbackDeps, jobId: string): RollbackResult` with `RollbackDeps = { db; vault?: { delete(p); read(p); write(p, fm, body) }; indexer?: { indexAll(); removeStale() }; episodic?: { delete(id) }; skills?: { delete(id) }; agents?: { delete(id) }; removeAssetDir(name: string): void; readWorkspaceFile(agentId, file): string | null; writeWorkspaceFile(agentId, file, body): Promise<void>; listProposals(jobId) }` and `RollbackResult = { removed: Record<AppliedKind, number>; skipped: string[] }`.
- Job status gains `'rolled_back'`.
- Routes: `GET /api/v1/data-port/import/profiles` → `{ profiles: [{ id, rootHints }] }`; `POST /api/v1/data-port/import/jobs/:id/rollback` (permission `delete DataPort`); proposal rows include `agentName`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/rollback.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { recordApplied } from '@modules/data-port/ledger'
import { rollbackJob } from '@modules/data-port/rollback'

describe('rollbackJob', () => {
  it('removes every recorded item, strips approved proposal sections, rejects pending ones', async () => {
    const db = createMemoryDb(); createDataPortTables(db)
    db.run(sql`INSERT INTO data_port_jobs (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at) VALUES ('j', 'completed', 'claude-code', 's', '[]', 'done', 1, '{}', 't', 't')`)
    db.run(sql`INSERT INTO data_port_proposals (id, job_id, agent_id, workspace_file, title, proposed_body, existing_body, status, created_at) VALUES ('p1', 'j', 'a1', 'AGENTS.md', 'Rules (x.md)', 'R', 'seed', 'approved', 't')`)
    db.run(sql`INSERT INTO data_port_proposals (id, job_id, agent_id, workspace_file, title, proposed_body, existing_body, status, created_at) VALUES ('p2', 'j', 'a1', 'AGENTS.md', 'Other (y.md)', 'O', 'seed', 'pending', 't')`)
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/a.md' })
    recordApplied(db, { jobId: 'j', kind: 'episodic', ref: 'e1' })
    recordApplied(db, { jobId: 'j', kind: 'skill', ref: 'sk1' })
    recordApplied(db, { jobId: 'j', kind: 'skill-assets', ref: 'sk1' })
    recordApplied(db, { jobId: 'j', kind: 'agent', ref: 'dev' })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p1' })
    const deleted: string[] = []
    const files: Record<string, string> = { 'a1/AGENTS.md': 'seed\n\n---\n\n## Imported: Rules (x.md)\n\nR\n\n---\n\n## Imported: Later (z.md)\n\nL\n' }
    const r = await rollbackJob({
      db,
      vault: { delete: (p) => deleted.push(`vault:${p}`), read: () => null, write: () => {} },
      indexer: { indexAll: () => 0, removeStale: () => {} },
      episodic: { delete: (id) => deleted.push(`ep:${id}`) },
      skills: { delete: (id) => deleted.push(`skill:${id}`), get: (id) => ({ id, name: 'deploy' }) },
      agents: { delete: (id) => deleted.push(`agent:${id}`) },
      removeAssetDir: (name) => deleted.push(`assets:${name}`),
      readWorkspaceFile: (a, f) => files[`${a}/${f}`] ?? null,
      writeWorkspaceFile: async (a, f, body) => { files[`${a}/${f}`] = body },
    }, 'j')
    expect(deleted.sort()).toEqual(['agent:dev', 'assets:deploy', 'ep:e1', 'skill:sk1', 'vault:semantic/a.md'])
    expect(files['a1/AGENTS.md']).toBe('seed\n\n---\n\n## Imported: Later (z.md)\n\nL\n')
    expect(r.removed).toMatchObject({ vault: 1, episodic: 1, skill: 1, 'skill-assets': 1, agent: 1, proposal: 1 })
    expect(db.all(sql`SELECT status FROM data_port_proposals WHERE id='p2'`)[0].status).toBe('rejected')
    expect(db.all(sql`SELECT status FROM data_port_jobs WHERE id='j'`)[0].status).toBe('rolled_back')
    expect(db.all(sql`SELECT count(*) AS n FROM data_port_applied WHERE job_id='j'`)[0].n).toBe(0)
  })
  it('refuses a job that is still running', async () => {
    const db = createMemoryDb(); createDataPortTables(db)
    db.run(sql`INSERT INTO data_port_jobs (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at) VALUES ('j', 'running', 'x', 's', '[]', 'apply', 0.5, '{}', 't', 't')`)
    await expect(rollbackJob({ db, removeAssetDir: () => {}, readWorkspaceFile: () => null, writeWorkspaceFile: async () => {} }, 'j')).rejects.toThrow(/running/)
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun vitest run tests/modules/data-port/rollback.test.ts` → FAIL.

- [ ] **Step 3: Write `rollback.ts`**

```ts
// src/modules/data-port/rollback.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { deleteApplied, listApplied, type AppliedKind } from './ledger.js'

export interface RollbackDeps {
  db: EyasDb
  vault?: { delete: (p: string) => void; read: (p: string) => unknown; write: (p: string, fm: Record<string, unknown>, body: string) => void }
  indexer?: { indexAll: () => number; removeStale: () => void }
  episodic?: { delete: (id: string) => void }
  skills?: { delete: (id: string) => void; get: (id: string) => { id: string; name: string } | null }
  agents?: { delete: (id: string) => void }
  removeAssetDir: (skillName: string) => void
  readWorkspaceFile: (agentId: string, file: string) => string | null
  writeWorkspaceFile: (agentId: string, file: string, body: string) => Promise<void>
}

export interface RollbackResult { removed: Record<AppliedKind, number>; skipped: string[] }

/** Remove exactly one `## Imported: <title>` section (up to the next `---` separator or EOF). */
export function stripImportedSection(body: string, title: string): string {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(\\n\\n---\\n\\n)?## Imported: ${esc}\\n[\\s\\S]*?(?=\\n\\n---\\n\\n## Imported: |$)`)
  return body.replace(re, '').replace(/\n{3,}$/, '\n')
}

export async function rollbackJob(deps: RollbackDeps, jobId: string): Promise<RollbackResult> {
  const job = (deps.db.all(sql`SELECT status FROM data_port_jobs WHERE id = ${jobId}`) as Array<{ status: string }>)[0]
  if (!job) throw new Error('Job not found')
  if (job.status === 'running' || job.status === 'pending') throw new Error(`Job is ${job.status}; wait for it to finish`)
  const removed: Record<AppliedKind, number> = { vault: 0, episodic: 0, skill: 0, 'skill-assets': 0, agent: 0, proposal: 0 }
  const skipped: string[] = []
  const rows = listApplied(deps.db, jobId)
  const skillNames = new Map<string, string>()
  for (const r of rows) {
    try {
      if (r.kind === 'vault') { if (!deps.vault) { skipped.push(r.ref); continue } deps.vault.delete(r.ref); removed.vault++ }
      else if (r.kind === 'episodic') { if (!deps.episodic) { skipped.push(r.ref); continue } deps.episodic.delete(r.ref); removed.episodic++ }
      else if (r.kind === 'skill') { if (!deps.skills) { skipped.push(r.ref); continue } const s = deps.skills.get(r.ref); if (s) skillNames.set(r.ref, s.name); deps.skills.delete(r.ref); removed.skill++ }
      else if (r.kind === 'skill-assets') { const name = skillNames.get(r.ref) ?? deps.skills?.get(r.ref)?.name; if (name) { deps.removeAssetDir(name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '')); removed['skill-assets']++ } else skipped.push(`assets:${r.ref}`) }
      else if (r.kind === 'agent') { if (!deps.agents) { skipped.push(r.ref); continue } deps.agents.delete(r.ref); removed.agent++ }
      else if (r.kind === 'proposal') {
        const p = (deps.db.all(sql`SELECT agent_id, workspace_file, title, status FROM data_port_proposals WHERE id = ${r.ref}`) as any[])[0]
        if (!p) { skipped.push(r.ref); continue }
        if (p.status === 'approved') {
          const current = deps.readWorkspaceFile(p.agent_id, p.workspace_file)
          if (current !== null) await deps.writeWorkspaceFile(p.agent_id, p.workspace_file, stripImportedSection(current, p.title))
        }
        deps.db.run(sql`UPDATE data_port_proposals SET status = 'rejected', resolved_at = ${new Date().toISOString()} WHERE id = ${r.ref} AND status <> 'rejected'`)
        removed.proposal++
      }
    } catch (err) { skipped.push(`${r.kind}:${r.ref} (${err instanceof Error ? err.message : String(err)})`) }
  }
  deps.db.run(sql`UPDATE data_port_proposals SET status = 'rejected', resolved_at = ${new Date().toISOString()} WHERE job_id = ${jobId} AND status = 'pending'`)
  if (removed.vault && deps.indexer) { deps.indexer.removeStale(); deps.indexer.indexAll() }
  deleteApplied(deps.db, jobId)
  deps.db.run(sql`UPDATE data_port_jobs SET status = 'rolled_back', phase = 'rolled_back', updated_at = ${new Date().toISOString()} WHERE id = ${jobId}`)
  return { removed, skipped }
}
```

- [ ] **Step 4: Service, routes, wiring**

`service.ts`: add `rollback(jobId, rollbackDeps)` delegating to `rollbackJob`; `JobStatus` in `types.ts` gains `'rolled_back'`; `listProposals` rows gain `agentName` via `deps.agentName?.(agentId)` (new optional service dep `agentName?: (id: string) => string | null`, wired from the registry in `index.ts`; `'-'` → `'Project type: general'`).

`routes.ts`:
- `sourceProfileSchema = z.enum(['auto', ...listProfiles()] as [string, ...string[]])`; target enum adds `'agent'`, `'prompt.project-type'`.
- `app.get('/api/v1/data-port/import/profiles', requirePermission('read','DataPort'), (c) => c.json({ profiles: ADAPTERS.map((a) => ({ id: a.id, rootHints: a.rootHints })) }))`.
- `app.post('/api/v1/data-port/import/jobs/:id/rollback', requirePermission('delete','DataPort'), async (c) => { try { return c.json({ result: await service.rollback(c.req.param('id'), deps.rollbackDeps!) }) } catch (err) { const msg = err instanceof Error ? err.message : String(err); return c.json({ error: msg }, msg.includes('not found') ? 404 : 409) } })`.
- `approve` passes `deps.workspaceReader`.

`index.ts`: build `rollbackDeps` from `ctx.memory` (vault, indexer, episodic), `ctx.skills.loader`, `ctx.agents.registry`, `removeAssetDir: (name) => rmSync(resolve(dataDir,'skills','imported',name), { recursive: true, force: true })` guarded by a `startsWith` check, and the workspace reader/writer from Task 13.

- [ ] **Step 5: Run** — `bun vitest run tests/modules/data-port` → PASS; `bun run lint 2>&1 | tail -3`.

- [ ] **Step 6: Review** — `git status --short`.

---

## Phase 3 — Recall, UI, docs

### Task 16: Unscoped project notes are global; index budget is configurable

**Files:**
- Modify: `src/modules/memory/memory-index.ts` (`vaultNoteInScope`), `src/core/config/schema.ts` (`memory.index.budgetChars`), `config/default.yaml`, `src/modules/memory/index.ts` (accessor passes the budget), `src/modules/agent/conversation-runner.ts` (+ `memoryIndex?` dep), `src/modules/agent/index.ts` (wire it)
- Test: modify `tests/modules/memory/memory-index.test.ts`, `tests/modules/memory/search-scope.test.ts`; create `tests/modules/memory/index-budget.test.ts`

**Interfaces:**
- `vaultNoteInScope`: `kind === 'project'` → `row.project_id ? row.project_id === opts.projectId : true`; `kind === 'domain'` → `row.project_type_id ? row.project_type_id === opts.projectTypeId : true`.
- Config: `memory.index.budgetChars` (int > 0, default 2 400).
- `ConversationRunnerDeps.memoryIndex?: (opts: MemoryIndexOptions) => MemoryIndexResult | null`; the runner uses it when present, else `buildMemoryIndex(db, …)` as today.

- [ ] **Step 1: Update the scope tests**

In `tests/modules/memory/memory-index.test.ts` replace the test `excludes project notes in M1, deliberately` with:

```ts
  it('shows an UNSCOPED project note everywhere, ranked as project', () => {
    note('semantic/decisions.md', { kind: 'project', summary: 'Version is frozen' })
    const out = buildMemoryIndex(db)!.content
    expect(out).toContain('- [project] Version is frozen')
  })
```

and in `excludes other projects entirely, and all projects when there is none` keep the scoped assertions but add `note2('semantic/free.md', 'project', 'Free note')` and assert `Free note` appears for `projectId: 'p1'` and for `buildMemoryIndex(db)`.

In `tests/modules/memory/search-scope.test.ts` add:

```ts
  it('an unscoped project note is found from any project and from no project', async () => {
    writeNote('semantic/unscoped.md', { kind: 'project', title: 'Unscoped fact', content: 'unscopedterm here' })
    expect((await search('unscopedterm', { projectId: 'alpha' })).map((r) => r.path)).toContain('semantic/unscoped.md')
    expect((await search('unscopedterm', { projectId: null })).map((r) => r.path)).toContain('semantic/unscoped.md')
  })
```

(use the file's existing note-writing and search helpers; match their names.)

```ts
// tests/modules/memory/index-budget.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { configSchema } from '@core/config/schema'

describe('memory.index.budgetChars', () => {
  it('defaults to 2400 and accepts an override', () => {
    expect(configSchema.parse({}).memory.index.budgetChars).toBe(2400)
    expect(configSchema.parse({ memory: { index: { budgetChars: 8000 } } }).memory.index.budgetChars).toBe(8000)
    expect(() => configSchema.parse({ memory: { index: { budgetChars: 0 } } })).toThrow()
  })
})
```

(check the exported schema name at the top of `src/core/config/schema.ts` — use the export that `loader.ts` parses with.)

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/memory/memory-index.test.ts tests/modules/memory/search-scope.test.ts tests/modules/memory/index-budget.test.ts` → FAIL.

- [ ] **Step 3: Change `vaultNoteInScope`**

```ts
export function vaultNoteInScope(
  row: VaultNoteScopeRow,
  opts: { projectId?: string | null; projectTypeId?: string | null; scope?: MemorySearchScope },
): boolean {
  if (opts.scope !== 'current') return true
  const kind = inferKind(row)
  // A scoped note stays in its project / type. An UNSCOPED project or domain
  // note (imported, or written before a project existed) is global: hiding it
  // would lose it for every conversation, which is worse than showing it.
  if (kind === 'project') return row.project_id ? Boolean(opts.projectId) && row.project_id === opts.projectId : true
  if (kind === 'domain') return row.project_type_id ? Boolean(opts.projectTypeId) && row.project_type_id === opts.projectTypeId : true
  return KIND_ORDER.includes(kind)
}
```

Update the comment above `KIND_ORDER` accordingly.

- [ ] **Step 4: Config key**

In `src/core/config/schema.ts` inside the `memory` object, after `relatedWork`:

```ts
    // Always-on durable-memory index. ~600 tokens by default; raise it when the
    // owner's user + feedback notes no longer fit (each line ≈ 100 chars).
    index: z.object({
      budgetChars: z.number().int().positive().default(2_400),
    }).default({}),
```

In `config/default.yaml` under `memory:` after the `relatedWork:` block:

```yaml
  index:
    # Characters of the always-on memory index injected per turn (~600 tokens).
    # Raise it (e.g. 8000) so every user + feedback line fits; needs a restart.
    budgetChars: 2400
```

- [ ] **Step 5: Accessor and runner**

`src/modules/memory/index.ts` — the `memoryIndex` accessor:

```ts
    ;(ctx as any).memoryIndex = (opts?: import('./memory-index.js').MemoryIndexOptions) => {
      try {
        const budget = (ctx.config as any)?.memory?.index?.budgetChars
        return buildMemoryIndex(ctx.db, { ...(opts ?? {}), budgetChars: opts?.budgetChars ?? (typeof budget === 'number' ? budget : undefined) })
      } catch (err) {
        ctx.logger.warn({ err }, 'Memory index could not be built; this turn goes without it')
        return null
      }
    }
```

`src/modules/agent/conversation-runner.ts` — add to `ConversationRunnerDeps` next to `relatedWork?`:

```ts
  /** Same accessor the chat route uses; applies `memory.index.budgetChars`. Absent: direct build. */
  memoryIndex?: (opts: import('@modules/memory/memory-index.js').MemoryIndexOptions) => import('@modules/memory/memory-index.js').MemoryIndexResult | null
```

and at the build site:

```ts
      const opts = { projectId: effectiveProjectId(conv.project_id ?? null) }
      if (deps.memoryIndex) memoryBlock = deps.memoryIndex(opts)
      else {
        const { buildMemoryIndex } = await import('@modules/memory/memory-index.js')
        memoryBlock = buildMemoryIndex(db, opts)
      }
```

`src/modules/agent/index.ts` — next to the `relatedWork:` line in the runner deps:

```ts
      memoryIndex: (opts: import('@modules/memory/memory-index.js').MemoryIndexOptions) =>
        (ctx as any).memoryIndex?.(opts) ?? null,
```

- [ ] **Step 6: Run** — the three memory test files + `tests/modules/memory/memory-index-wiring.test.ts` + `tests/modules/memory/related-work.test.ts` → PASS.

- [ ] **Step 7: Review** — `git status --short`.

---

### Task 17: Settings card — new kinds, profiles from the API, target agent, rollback, previous imports — six languages

**Files:**
- Modify: `src/web/src/pages/settings/data-port-card.tsx`, `src/web/src/pages/settings/locales/{en,hu,de,es,fr,tlh}.json`
- Test: `bun run build:web` compiles; manual check on the dev instance (`bun run dev` on :3100) — the wizard lists the new kinds and the rollback button.

- [ ] **Step 1: Types and constants in the card**

- `KIND_ORDER` → `['memory', 'index', 'session', 'skill', 'rule', 'identity', 'persona', 'knowledge', 'unknown', 'noise']`.
- `SourceProfile` type → `string`; replace the static `PROFILES` array with state loaded from `GET /data-port/import/profiles` on open (`api.get<{ profiles: Array<{ id: string; rootHints: string[] }> }>('/data-port/import/profiles')`), always prefixed with `'auto'`; the profile label = `tOr(\`settings.dataPort.profile.${p}\`, p)`; under the path input show the selected profile's `rootHints` joined with ` · ` in `text-[11px] text-muted-foreground`.
- `CandidateTarget` union adds `'agent' | 'prompt.project-type'`; `ImportJob.stats` adds `unchanged: number; aiEnriched: number; aiFallback: number`; `ImportJob` adds `sourceProfile: string; createdAt: string`; `WorkspaceProposal` adds `agentName?: string | null`.
- Candidate row: when `c.assets?.length` (add `assets?: Array<{ relPath: string }>` to the `ScanCandidate` type) show a `Badge variant="outline"` with `t('settings.dataPort.wizard.bundledFiles', { count: c.assets.length })`.
- Stats grid: `['applied', 'unchanged', 'proposals', 'skipped', 'errors']` (five columns: `sm:grid-cols-5`). Under it, when `job.stats.aiEnriched + job.stats.aiFallback > 0`, a line `t('settings.dataPort.wizard.aiSummary', { enriched, fallback })`.
- Proposal card: next to the `workspaceFile` badge add `<Badge variant="secondary">{p.agentName ?? p.agentId}</Badge>`, and when `p.workspaceFile === 'AGENTS.md'` a hint line `t('settings.dataPort.wizard.agentsWindowHint')`.
- Done step: a `Button variant="destructive" size="sm"` "Roll back this import" → `window.confirm(t('settings.dataPort.wizard.rollbackConfirm'))` → `api.post(\`/data-port/import/jobs/${job.id}/rollback\`)` → toast/inline text `t('settings.dataPort.wizard.rollbackDone', { count })` and refresh the job.
- Card body (outside the dialog): "Previous imports" list from `GET /data-port/import/jobs?limit=5`: one row per job — `createdAt` (locale date), `sourceProfile`, `status` badge, `stats.applied`, and the same rollback button for `completed`/`failed` jobs.

- [ ] **Step 2: Add the strings (all six files, flat keys)**

| key | en | hu |
|---|---|---|
| `settings.dataPort.wizard.kind.index` | Memory index | Memória-index |
| `settings.dataPort.wizard.kind.session` | Sessions | Munkamenetek |
| `settings.dataPort.wizard.kind.persona` | Agent personas | Ügynök-personák |
| `settings.dataPort.wizard.bundledFiles` | +{{count}} bundled files | +{{count}} csatolt fájl |
| `settings.dataPort.wizard.stat.unchanged` | Unchanged | Változatlan |
| `settings.dataPort.wizard.aiSummary` | Model enrichment: {{enriched}} enriched, {{fallback}} deterministic | Modell-dúsítás: {{enriched}} dúsítva, {{fallback}} determinisztikus |
| `settings.dataPort.wizard.targetAgent` | Target agent | Cél-ügynök |
| `settings.dataPort.wizard.agentsWindowHint` | The whole file is kept on disk; the model sees about the first 3 200 characters of AGENTS.md. Long rule files are better sent to the project-type prompt. | A teljes fájl megmarad a lemezen; a modell az AGENTS.md első kb. 3 200 karakterét látja. Hosszú szabályfájl inkább a projekttípus-promptba való. |
| `settings.dataPort.wizard.rollback` | Roll back this import | Import visszavonása |
| `settings.dataPort.wizard.rollbackConfirm` | Remove every note, skill, agent and approved rule section this import created? | Eltávolítod az import által létrehozott összes jegyzetet, skillt, ügynököt és jóváhagyott szabály-szakaszt? |
| `settings.dataPort.wizard.rollbackDone` | Rolled back: {{count}} items removed | Visszavonva: {{count}} elem eltávolítva |
| `settings.dataPort.previousImports` | Previous imports | Korábbi importok |
| `settings.dataPort.rootHints` | Typical locations | Tipikus helyek |
| `settings.dataPort.profile.grok-cli` | Grok CLI | Grok CLI |
| `settings.dataPort.profile.codex` | Codex CLI | Codex CLI |
| `settings.dataPort.profile.gemini-cli` | Gemini CLI | Gemini CLI |
| `settings.dataPort.profile.windsurf` | Windsurf / Codeium | Windsurf / Codeium |
| `settings.dataPort.profile.copilot` | GitHub Copilot (unverified layout) | GitHub Copilot (nem ellenőrzött elrendezés) |
| `settings.dataPort.wizard.status.rolled_back` | Rolled back | Visszavonva |

| key | de | es |
|---|---|---|
| `…kind.index` | Gedächtnis-Index | Índice de memoria |
| `…kind.session` | Sitzungen | Sesiones |
| `…kind.persona` | Agenten-Personas | Personas de agente |
| `…bundledFiles` | +{{count}} gebündelte Dateien | +{{count}} archivos adjuntos |
| `…stat.unchanged` | Unverändert | Sin cambios |
| `…aiSummary` | Modell-Anreicherung: {{enriched}} angereichert, {{fallback}} deterministisch | Enriquecimiento del modelo: {{enriched}} enriquecidos, {{fallback}} deterministas |
| `…targetAgent` | Ziel-Agent | Agente destino |
| `…agentsWindowHint` | Die ganze Datei bleibt auf der Platte; das Modell sieht etwa die ersten 3 200 Zeichen von AGENTS.md. Lange Regeldateien gehören eher in den Projekttyp-Prompt. | El archivo completo se guarda en disco; el modelo ve unos 3 200 primeros caracteres de AGENTS.md. Los archivos de reglas largos van mejor al prompt del tipo de proyecto. |
| `…rollback` | Diesen Import zurücknehmen | Revertir esta importación |
| `…rollbackConfirm` | Alle Notizen, Skills, Agenten und genehmigten Regelabschnitte dieses Imports entfernen? | ¿Eliminar todas las notas, skills, agentes y secciones de reglas aprobadas creadas por esta importación? |
| `…rollbackDone` | Zurückgenommen: {{count}} Elemente entfernt | Revertido: {{count}} elementos eliminados |
| `settings.dataPort.previousImports` | Frühere Importe | Importaciones anteriores |
| `settings.dataPort.rootHints` | Typische Orte | Ubicaciones habituales |
| `…profile.grok-cli` | Grok CLI | Grok CLI |
| `…profile.codex` | Codex CLI | Codex CLI |
| `…profile.gemini-cli` | Gemini CLI | Gemini CLI |
| `…profile.windsurf` | Windsurf / Codeium | Windsurf / Codeium |
| `…profile.copilot` | GitHub Copilot (ungeprüftes Layout) | GitHub Copilot (estructura no verificada) |
| `…status.rolled_back` | Zurückgenommen | Revertido |

| key | fr | tlh |
|---|---|---|
| `…kind.index` | Index de mémoire | qawHaq mem |
| `…kind.session` | Sessions | qeplu'meH poHmey |
| `…kind.persona` | Personas d'agent | ghoqwI' DaqaSmey |
| `…bundledFiles` | +{{count}} fichiers joints | +{{count}} teywI' tlhej |
| `…stat.unchanged` | Inchangés | choHbe' |
| `…aiSummary` | Enrichissement par le modèle : {{enriched}} enrichis, {{fallback}} déterministes | mIw ghoq: {{enriched}} ghoqlu', {{fallback}} nIteb |
| `…targetAgent` | Agent cible | ghoqwI' 'ay' |
| `…agentsWindowHint` | Le fichier complet est conservé sur disque ; le modèle voit environ les 3 200 premiers caractères d'AGENTS.md. Les longs fichiers de règles vont mieux dans le prompt du type de projet. | teywI' naQ pol; AGENTS.md 3 200 ngoDmey wa'DIch legh mIw. chut teywI' tIq: ghotI' Segh ra'ghomDaq. |
| `…rollback` | Annuler cet import | qaSmoHqa' — le' |
| `…rollbackConfirm` | Supprimer toutes les notes, skills, agents et sections de règles approuvées créés par cet import ? | qaSmoHqa'meH: Hoch qonlu'pu'bogh, laH, ghoqwI', chut 'ay' teq'a'? |
| `…rollbackDone` | Annulé : {{count}} éléments supprimés | qaSmoHqa'lu': {{count}} Doch teqlu' |
| `settings.dataPort.previousImports` | Imports précédents | qaSpu'bogh le'mey |
| `settings.dataPort.rootHints` | Emplacements habituels | Daq motlh |
| `…profile.grok-cli` | Grok CLI | Grok CLI |
| `…profile.codex` | Codex CLI | Codex CLI |
| `…profile.gemini-cli` | Gemini CLI | Gemini CLI |
| `…profile.windsurf` | Windsurf / Codeium | Windsurf / Codeium |
| `…profile.copilot` | GitHub Copilot (structure non vérifiée) | GitHub Copilot (pat lulegh'be') |
| `…status.rolled_back` | Annulé | qaSmoHqa'lu' |

(`…` = `settings.dataPort.wizard.`; insert next to the existing `settings.dataPort.*` keys in each file, same indentation.)

- [ ] **Step 3: Build**

Run: `bun run build:web 2>&1 | tail -5` → no type errors. Then `bun run dev` (dev instance, :3100), open Settings → Data portability → Import data… and confirm: profile list from the API, kinds `Memory index` / `Sessions` / `Agent personas` appear after a scan of a small fixture folder, the rollback button on the done step, the "Previous imports" list. Stop the dev server.

- [ ] **Step 4: Review** — `git status --short` (six locale files + the card).

---

### Task 18: Documentation and changelog (six languages)

**Files:**
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/admin/data-port.md`, `…/knowledge/memory.md`, `…/deploy/configuration.md`, `CHANGELOG.md`
- Test: `bun run docs:build 2>&1 | tail -3` → builds; the six files each contain the new headings.

- [ ] **Step 1: `admin/data-port.md` — replace the paragraph starting "You do not have to pick the perfect folder." and the "Features" table row `Targets`**

English text (translate faithfully for hu/de/es/fr/tlh, keeping the file's register; Hungarian below):

```markdown
## What lands where

| Source | EYAS layer |
|--------|------------|
| Note with `type: user` / `feedback` / `project` / `reference` (Claude Code, Obsidian, Grok) | Vault note with that **kind**; `feedback` under `procedural/`, the rest under `semantic/`; the file keeps its **source file name**, so `[[wikilinks]]` keep resolving |
| `MEMORY.md` index | One vault note tagged `index`; every one-line hook becomes the summary of the note it points to |
| Session notes and summaries (Claude Code, Grok, Codex, Cursor, ChatGPT / Claude.ai exports) | Episodic memory, one row per session; Grok project summaries are selected by default, transcripts are not |
| `SKILL.md` with `references/` and `scripts/` | One **own** skill: the whole package verbatim, files also copied to `data/skills/imported/<name>/` |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor `.mdc`, Windsurf and Copilot rules | Proposal for the **primary assistant's** `AGENTS.md` — or, when you choose *Project-type prompt*, for the `general` project type — appended on approval, never overwritten |
| `.claude/agents/*.md` personas | Agent definitions (tools mapped to EYAS tools) |

**Nothing is clipped or silently skipped.** Files are read whole at import time (up to 4 MiB); the original frontmatter, path, hash and modification time travel with the note under `source:`. Every file the scan does not import is listed in the *Skipped / noise* group with its reason. Re-running an import reports **Unchanged** for notes already present and never overwrites — a different note with the same name gets a `-2` suffix and a `conflict-with:` tag.

**Any assistant.** Sources are recognised by adapters: Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (documented layout only), Obsidian, ChatGPT / Claude.ai / generic JSON exports, eyas-export and plain markdown. Files reached through several paths (a vault symlinked into `~/.grok/memory`) become one note.

**Model enrichment is optional and metadata-only.** With 48 items or fewer and a configured model, notes *without* a declared type get a suggested kind, summary and tags; the body is never rewritten and nothing is skipped on the model's say-so. The result panel shows how many notes were enriched.

**Rolling back.** Every job can be reverted from the result panel or the *Previous imports* list: notes, episodic rows, skills (and their copied files), agents and approved rule sections are removed; pending proposals are rejected.
```

Hungarian:

```markdown
## Mi hova kerül

| Forrás | EYAS-réteg |
|--------|------------|
| Jegyzet `type: user` / `feedback` / `project` / `reference` jelöléssel (Claude Code, Obsidian, Grok) | Vault-jegyzet ugyanazzal a **kind** értékkel; a `feedback` a `procedural/`, a többi a `semantic/` mappába; a fájl **a forrás nevét** kapja, így a `[[wikilinkek]]` továbbra is feloldódnak |
| `MEMORY.md` index | Egyetlen `index` címkéjű vault-jegyzet; minden egysoros hook a hivatkozott jegyzet összefoglalója lesz |
| Session-jegyzetek és -összefoglalók (Claude Code, Grok, Codex, Cursor, ChatGPT / Claude.ai export) | Epizodikus memória, sessionönként egy sor; a Grok projekt-összefoglalók alapból kijelölve, az átiratok nem |
| `SKILL.md` a `references/` és `scripts/` mappákkal | Egy **saját** skill: a teljes csomag szó szerint, a fájlok a `data/skills/imported/<név>/` mappába is lemásolva |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor `.mdc`, Windsurf- és Copilot-szabályok | Javaslat az **elsődleges asszisztens** `AGENTS.md` fájljához — vagy a *Projekttípus-prompt* választásakor a `general` projekttípushoz — jóváhagyáskor hozzáfűzve, soha felülírva |
| `.claude/agents/*.md` personák | Ügynök-definíciók (az eszköznevek EYAS-eszközökre leképezve) |

**Semmi nem vágódik el és nem marad ki némán.** A fájlokat az import egészben olvassa (4 MiB-ig); az eredeti frontmatter, útvonal, hash és módosítási idő a jegyzettel utazik a `source:` blokkban. Minden fájl, amit a scan nem importál, a *Kihagyott / zaj* csoportban szerepel az okával. Az ismételt import a már meglévő jegyzeteknél **Változatlan** eredményt ad, és soha nem ír felül — az azonos nevű, eltérő jegyzet `-2` utótagot és `conflict-with:` címkét kap.

**Bármely asszisztens.** A forrásokat adapterek ismerik fel: Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (csak dokumentált elrendezés), Obsidian, ChatGPT / Claude.ai / általános JSON-export, eyas-export és sima markdown. A több úton elért fájl (a `~/.grok/memory` alá symlinkelt vault) egy jegyzet lesz.

**A modell-dúsítás opcionális és csak metaadat.** Legfeljebb 48 tétel és beállított modell esetén a *deklarált típus nélküli* jegyzetek javasolt kind-ot, összefoglalót és címkéket kapnak; a törzs sosem íródik át, és a modell szavára semmi nem marad ki. Az eredménypanel mutatja, hány jegyzet dúsult.

**Visszavonás.** Minden job visszavonható az eredménypanelről vagy a *Korábbi importok* listából: a jegyzetek, epizodikus sorok, skillek (és lemásolt fájljaik), ügynökök és jóváhagyott szabály-szakaszok eltűnnek; a függő javaslatok elutasítódnak.
```

Also update the `Kind filter` row of the controls table to list **Memory index / Sessions / Agent personas**, and the Features row `Targets` to "Memory (kind + tier), episodic sessions, skills with bundled files, agent personas, workspace rules, project-type prompt".

- [ ] **Step 2: `knowledge/memory.md`** — under "Durable notes" add a short subsection (en; translate for the other five):

```markdown
### Project notes without a project

A note whose kind is `project` or `domain` but that carries no `project:` / `projectType:` is **global**: it appears in the always-on index, in `search_memory` and in related work for every conversation, ranked as a project note. Moving it into `projects/<id>/` (or stamping `project:` in its frontmatter) scopes it to that project. Imported client notes start out this way until you create the matching projects.
```

- [ ] **Step 3: `deploy/configuration.md`** — in the memory keys table add `memory.index.budgetChars` — "Characters of the always-on memory index per turn (default 2400 ≈ 600 tokens). Raise to ~8000 when your user + feedback notes no longer fit. Needs a restart." (six languages.)

- [ ] **Step 4: `CHANGELOG.md`** — under `## [Unreleased]`:

```markdown
### Data port — lossless import

- Every selected file is read whole at import time: no 12 000-character scan clip, no 4 000-character note cap, no 6 000-character skill cap; the original frontmatter, path, hash and modification time are kept under `source:`.
- Declared `type` becomes the note's `kind`; `feedback` files under `procedural/`; the source file name is the vault file name so wikilinks keep resolving; `description` (or the `MEMORY.md` hook) becomes the summary.
- Every skipped file is a visible row with a reason; the bullet-ratio "index file" rule that dropped nine real notes is gone — only `MEMORY.md` is an index, and it is imported as one note.
- Provider adapters: Claude Code, Grok CLI (incl. per-project session summaries), Cursor, Codex (SQLite memories, rollouts), Gemini CLI, Windsurf, Copilot, Obsidian, ChatGPT / Claude.ai / generic JSON exports.
- Skills import as whole packages (`references/`, `scripts/` verbatim, also copied to `data/skills/imported/`), with trigger phrases from the description; `.claude/agents` personas become agent definitions with mapped tools.
- Rule proposals target the primary assistant and are appended to the current file on approval (two approvals no longer overwrite each other); optional *Project-type prompt* target.
- Idempotent re-runs (`Unchanged`), `-N` suffixes instead of overwrites, an applied-items ledger and **Roll back this import**.
- Model enrichment is optional and metadata-only; it never rewrites a body.
- Recall: unscoped `project` / `domain` notes are global; `memory.index.budgetChars` makes the always-on index budget configurable.
```

- [ ] **Step 5: Build the docs** — `bun run docs:build 2>&1 | tail -3` → success. Grep: `grep -l "budgetChars" packages/docs/src/content/docs/*/deploy/configuration.md | wc -l` → 6; same for `## ` new heading in the six data-port pages.

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 19: Whole-suite verification and hand-off

- [ ] **Step 1: Run everything**

Run: `bun run test 2>&1 | tail -15` → all green (note any pre-existing failures by name; the memory notes list known ones: anomaly-job, fixture drift).
Run: `bun run lint 2>&1 | tail -3` → error count ≤ the baseline recorded before Task 1.
Run: `grep -rn "\[\\\\s\\\\S\]\*?---" src/modules/data-port` → no output (the destructive regex is gone).
Run: `grep -rn "slice(0, 4000)\|slice(0, 6000)\|MAX_CHUNK_CHARS + 512" src/modules/data-port` → no output.

- [ ] **Step 2: End-to-end on the dev instance with a synthetic tree**

Create `/tmp/eyas-import-fixture/` mirroring the fixture of Task 14 (plus a 60 000-character note), start `bun run dev` (:3100), run the wizard on that path with profile *Auto-detect*, and check: the 60 000-character note is complete in `data/vault/semantic/`, `procedural/` holds the feedback note, the skill has its bundled script under `data/skills/imported/`, the persona appears under Agents, the proposal names the primary assistant, *Roll back this import* removes everything, and a second import reports *Unchanged*. Stop the dev server. Delete the fixture.

- [ ] **Step 3: Hand-off**

`git status --short` and `git diff --stat` → report the list to the owner. **Do not commit.** The owner decides on commit, dev → live update, rollback of live job `01M1V2C113X40EDN07HDHXJBV7`, and the live re-import (spec D-5).
