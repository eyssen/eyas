# Durable memory F1 — The write path (M2 + scoping amendments)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans
> (or subagent-driven-development) to implement this plan task by task. Steps
> use checkbox (`- [ ]`) syntax.

**Goal:** a durable fact established in a conversation is written to the vault
without anybody asking, stamped with the conversation and project it came from,
and project facts are ranked into the prompt of that project's conversations.

**Architecture:** the approved M2 capture pipeline (post-delivery structural
gate → one cheap completion → Zod schema → dedup → privacy → vault write),
executed with the amendments the 2026-08-27 adversarial review demanded:
`project` kind ships together with project-ranked recall, the extractor sees
the project and the existing index, provenance lands in frontmatter + a link
table, and the boot-order bug that silently killed every memory hook is fixed
first.

**Tech Stack:** TypeScript (ESM, strict), Zod, Drizzle over SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-memory-scale-and-scoping-design.md`
(decisions D1–D5), which extends
`docs/superpowers/specs/2026-08-27-durable-memory-design.md`.
**REQUIRED COMPANION:** `docs/superpowers/plans/2026-08-27-m2-memory-capture.md`
— Tasks marked **[M2 verbatim]** below are executed from that document's full
code; this plan states only their deltas. Read both before starting.

## Global Constraints

- **Never commit, never push, never branch — this binds subagents too.**
- Version stays **0.8.15-beta**. No version bump in this phase.
- **Baseline first:** before Task 0, record `bun run test` (the `^ FAIL` file
  list) and `bun run lint` (finding count). Neither list may grow; diff on
  files, not counts.
- English code and comments; the six-language rule applies to the docs task
  (the capture pipeline itself ships no UI strings — those come in F3).
- MIT-compatible dependencies only. **F1 adds none.**
- `bun run full-docs` is forbidden; `bun run docs:build` is the allowed build.

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/conversations/memory-hooks.ts` (create) | lazy, boot-order-proof memory hook proxy |
| `src/modules/conversations/index.ts` (modify :119-126, :202) | use the proxy; provide project lookup |
| `src/modules/memory/schema.ts` (modify) | scoping columns, `memory_note_links`, `memory_capture_runs` |
| `src/modules/memory/types.ts` (modify) | frontmatter `project`, episodic scoping fields, `'agent-memory'` source, default-project helper |
| `src/modules/memory/vault/frontmatter.ts` (modify) | parse `project` |
| `src/modules/memory/vault/vault-indexer.ts` (modify) | project `project` into `vault_index.project_id` |
| `src/modules/memory/tiers/episodic-memory.ts` (modify) | stamp + read the new columns |
| `src/modules/memory/memory-index.ts` (modify) | project ranking, stable order, pruned SELECT |
| `src/modules/conversations/routes.ts` (modify :252, :818, :1240-1247) | thread projectId; call capture |
| `src/modules/agent/conversation-runner.ts` (modify :426-432, after :727) | thread projectId; call capture |
| `src/core/config/schema.ts` + `config/default.yaml` (modify) | **[M2 verbatim Task 1]** |
| `src/modules/memory/capture/candidate-schema.ts` (create) | amended: factory with `allowProject` |
| `src/modules/memory/capture/capture-gate.ts` (create) | **[M2 verbatim Task 3]** |
| `src/modules/memory/capture/capture-prompt.ts` (create) | amended: project + existing-index context |
| `src/modules/memory/capture/note-writer.ts` (create) | amended: project folder, links, provenance |
| `src/modules/memory/capture/index.ts` (create) | amended: projectId, kinds measurement |
| `src/modules/memory/index.ts` (modify) | publish `ctx.memoryCapture` |
| `src/modules/tools/builtin/memory-tools.ts` (modify :61-73) | `save_memory` stamps from ToolContext |
| `src/modules/memory/consolidation/memory-lifecycle.ts` (modify) | PreCompact stamps conversation/project |
| tests | one test file per task, listed in the tasks |

---

### Task 0: Lazy memory hooks — the boot-order fix

Everything else in this plan writes through paths this bug can silently kill.
It goes first and lands alone.

**Files:**
- Create: `src/modules/conversations/memory-hooks.ts`
- Modify: `src/modules/conversations/index.ts:119-126` (delete the value-captured
  wiring), `:202` stays — the same `memoryHooks` variable name is now the proxy
- Test: `tests/modules/conversations/memory-hooks-lazy.test.ts`

**Interfaces:**
- Produces: `createLazyMemoryHooks(getMemory, logger): ConversationMemoryHooks`
  where `getMemory: () => { episodic: unknown } | undefined`. Task 8 extends the
  underlying lifecycle; this task only fixes WHEN it resolves.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createLazyMemoryHooks } from '@modules/conversations/memory-hooks'

const logger = { info: vi.fn(), warn: vi.fn() } as any
// The lazy resolve crosses a dynamic import; one macrotask tick is not
// reliably enough for it to settle.
const flush = () => new Promise((r) => setTimeout(r, 10))

describe('lazy memory hooks', () => {
  it('wires the lifecycle even when memory appears AFTER the hooks are created', async () => {
    // This is the boot order on every real start: conversations first, memory later.
    let memory: any = undefined
    const hooks = createLazyMemoryHooks(() => memory, logger)

    const create = vi.fn()
    memory = { episodic: { create, touchConversation: vi.fn() } }

    hooks.onContextCompact?.('conv-1', 'a summary long enough to keep for later sessions')
    await flush()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ sourceType: 'system', sourceId: 'conv-1' })
  })

  it('is a silent no-op while memory does not exist, and recovers when it does', async () => {
    let memory: any = undefined
    const hooks = createLazyMemoryHooks(() => memory, logger)

    hooks.onContextCompact?.('conv-1', 'a summary long enough to keep for later sessions')
    await flush() // nothing to assert — it must simply not throw

    const create = vi.fn()
    memory = { episodic: { create, touchConversation: vi.fn() } }
    hooks.onContextCompact?.('conv-1', 'a summary long enough to keep for later sessions')
    await flush()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('resolves the lifecycle once, not per call', async () => {
    const create = vi.fn()
    const getMemory = vi.fn(() => ({ episodic: { create, touchConversation: vi.fn() } }))
    const hooks = createLazyMemoryHooks(getMemory as any, logger)
    hooks.onContextCompact?.('c', 'a summary long enough to keep for later sessions')
    await flush()
    hooks.onContextCompact?.('c', 'another summary long enough to keep for later use')
    await flush()
    expect(create).toHaveBeenCalledTimes(2)
    expect(getMemory.mock.calls.length).toBeLessThanOrEqual(2) // cached after first success
  })
})
```

- [ ] **Step 2: Run it and watch it fail** — module not found.
Run: `bun run test tests/modules/conversations/memory-hooks-lazy.test.ts`

- [ ] **Step 3: Implement**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/memory-hooks.ts
//
// Memory lifecycle hooks, resolved LAZILY at call time.
//
// The old wiring checked (ctx as any).memory at conversations' own onStart.
// The loader orders modules by hard `dependencies` only; conversations starts
// before memory on every boot, so ctx.memory was always undefined and the
// hooks were wired 0 times in 68 recorded start cycles. Same failure class as
// the lazy getters directly above the old site — this file is that pattern.

import type { ConversationMemoryHooks } from './routes.js'

type Lifecycle = ConversationMemoryHooks

export function createLazyMemoryHooks(
  getMemory: () => { episodic: unknown } | undefined,
  logger: { info: (msg: string) => void; warn: (obj: unknown, msg?: string) => void },
): ConversationMemoryHooks {
  let lifecycle: Lifecycle | undefined

  const resolve = async (): Promise<Lifecycle | undefined> => {
    if (lifecycle) return lifecycle
    const memory = getMemory() as { episodic?: unknown } | undefined
    if (!memory?.episodic) return undefined
    const { createMemoryLifecycle } = await import('@modules/memory/consolidation/memory-lifecycle.js')
    lifecycle = createMemoryLifecycle({
      episodic: memory.episodic as import('@modules/memory/tiers/episodic-memory.js').EpisodicMemoryService,
    })
    logger.info('Memory lifecycle hooks wired into conversations (lazy)')
    return lifecycle
  }

  // Every hook is fire-and-forget: a memory failure is a missing memory,
  // never a failed conversation.
  return {
    onContextCompact: (conversationId, summary) => {
      void resolve().then((l) => l?.onContextCompact?.(conversationId, summary)).catch(() => {})
    },
    onTurnComplete: (conversationId, userMessage, assistantMessage) => {
      void resolve().then((l) => l?.onTurnComplete?.(conversationId, userMessage, assistantMessage)).catch(() => {})
    },
    onMemoryAccessed: (conversationId, memoryIds) => {
      void resolve().then((l) => l?.onMemoryAccessed?.(conversationId, memoryIds)).catch(() => {})
    },
  }
}
```

In `src/modules/conversations/index.ts`, replace lines 119-126 with:

```ts
    // Memory lifecycle hooks — lazy proxy (see memory-hooks.ts for why).
    const { createLazyMemoryHooks } = await import('./memory-hooks.js')
    const memoryHooks = createLazyMemoryHooks(
      () => (ctx as any).memory,
      ctx.logger,
    )
```

(The `memoryHooks` variable keeps its name; the pass-through at :202 is
untouched. Delete the now-unused `ConversationMemoryHooks` import type if the
compiler flags it.)

- [ ] **Step 4: Run the test** — expect PASS. Then `bun run lint` — count must
  not exceed the baseline.

---

### Task 1: Scoping schema, end to end

Columns exist before anything ranks or stamps them.

**Files:**
- Modify: `src/modules/memory/schema.ts` (after :49 and after :85),
  `src/modules/memory/types.ts` (:17, :70-84 and append),
  `src/modules/memory/vault/frontmatter.ts:14-27`,
  `src/modules/memory/vault/vault-indexer.ts:48-63`,
  `src/modules/memory/tiers/episodic-memory.ts:8-43`
- Test: `tests/modules/memory/scoping-schema.test.ts`

**Interfaces:**
- Produces: `episodic_memories.conversation_id/.project_id`,
  `vault_index.project_id`, table `memory_note_links(note_path, owner_module,
  owner_id, source, created_at)`, table `memory_capture_runs(id,
  conversation_id, notes_written, kinds, skipped_reason, created_at)`;
  `CreateEpisodicInput.conversationId?/.projectId?`; `VaultFrontmatter.project?`;
  `EpisodicSourceType` includes `'agent-memory'`;
  `effectiveProjectId(id: string | null | undefined): string | null` and
  `MEMORY_DEFAULT_PROJECT_ID` in `@modules/memory/types`.
  Consumed by every later task.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { effectiveProjectId, MEMORY_DEFAULT_PROJECT_ID } from '@modules/memory/types'

let db: any, root: string

beforeEach(() => {
  db = createMemoryDb(); createMemoryTables(db)
  root = mkdtempSync(join(tmpdir(), 'eyas-scoping-'))
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('scoping schema', () => {
  it('stamps conversation and project onto an episodic row', () => {
    const episodic = createEpisodicMemoryService(db)
    const m = episodic.create({
      content: 'the owner ships on Fridays', sourceType: 'agent-memory',
      conversationId: 'conv-1', projectId: 'proj-1',
    })
    const row = (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories WHERE id = ${m.id}`) as any[])[0]
    expect(row).toEqual({ conversation_id: 'conv-1', project_id: 'proj-1' })
    expect(m.conversationId).toBe('conv-1')
    expect(m.projectId).toBe('proj-1')
  })

  it('projects frontmatter `project` into vault_index.project_id', () => {
    mkdirSync(join(root, 'projects', 'proj-1'), { recursive: true })
    writeFileSync(join(root, 'projects', 'proj-1', 'deploy-rule.md'),
      '---\ntitle: Deploy rule\ntier: semantic\nkind: project\nproject: proj-1\nsummary: Deploys need a green pipeline\n---\nBody.\n')
    const vault = createVaultService(root)
    const wikilinks = createWikilinkService(db); wikilinks.init()
    createVaultIndexer(db, vault, wikilinks).indexAll()
    const row = (db.all(sql`SELECT project_id, kind FROM vault_index WHERE path = ${'projects/proj-1/deploy-rule.md'}`) as any[])[0]
    expect(row).toEqual({ project_id: 'proj-1', kind: 'project' })
  })

  it('memory_note_links dedupes on its primary key', () => {
    db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id) VALUES ('semantic/a.md', 'conversations', 'c1')`)
    db.run(sql`INSERT OR IGNORE INTO memory_note_links (note_path, owner_module, owner_id) VALUES ('semantic/a.md', 'conversations', 'c1')`)
    const n = (db.all(sql`SELECT COUNT(*) AS n FROM memory_note_links`) as any[])[0].n
    expect(Number(n)).toBe(1)
  })

  it('memory_capture_runs accepts a run row with kinds', () => {
    db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written, kinds) VALUES ('c1', 2, '["user","project"]')`)
    const row = (db.all(sql`SELECT notes_written, kinds FROM memory_capture_runs WHERE conversation_id = 'c1'`) as any[])[0]
    expect(row.notes_written).toBe(2)
    expect(JSON.parse(row.kinds)).toEqual(['user', 'project'])
  })

  it('treats the seed project as no project — a catch-all is not an identity', () => {
    expect(effectiveProjectId(MEMORY_DEFAULT_PROJECT_ID)).toBeNull()
    expect(effectiveProjectId(null)).toBeNull()
    expect(effectiveProjectId(undefined)).toBeNull()
    expect(effectiveProjectId('proj-1')).toBe('proj-1')
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**
Run: `bun run test tests/modules/memory/scoping-schema.test.ts`

- [ ] **Step 3: Implement, in this order**

1. `src/modules/memory/schema.ts` — add a guarded-ALTER helper near the top and
   use it for the new columns (the blind try/catch pattern swallows locked-DB
   errors too; `PRAGMA table_info` is the codebase's safer precedent,
   `src/modules/board/index.ts:98-104`):

```ts
function addColumnIfMissing(db: EyasDb, table: string, column: string, ddl: string): void {
  const cols = (db as any).all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${ddl}`))
}
```

   After the episodic block (:49):

```ts
  // F1 scoping: which conversation/project a memory came from. Nullable —
  // imports and pre-F1 rows have neither.
  addColumnIfMissing(db, 'episodic_memories', 'conversation_id', 'conversation_id TEXT')
  addColumnIfMissing(db, 'episodic_memories', 'project_id', 'project_id TEXT')
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_conversation ON episodic_memories(conversation_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_episodic_project ON episodic_memories(project_id)`)
```

   After the vault_index kind/summary migration (:85):

```ts
  addColumnIfMissing(db, 'vault_index', 'project_id', 'project_id TEXT')
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_vault_index_project ON vault_index(project_id)`)

  // Which conversations a note came from or was reinforced by. Mirrors
  // design_links/document_links: multi-owner, no duplication.
  db.run(sql`CREATE TABLE IF NOT EXISTS memory_note_links (
    note_path TEXT NOT NULL,
    owner_module TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'capture',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (note_path, owner_module, owner_id)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_memory_note_links_owner ON memory_note_links(owner_module, owner_id)`)

  // The capture pipeline's counter AND its measurement: every run writes a
  // row, skips included, so minUserChars and kind mislabeling are measured,
  // never argued. (Consumed by capture-gate.countExtractions.)
  db.run(sql`CREATE TABLE IF NOT EXISTS memory_capture_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    notes_written INTEGER NOT NULL DEFAULT 0,
    kinds TEXT,
    skipped_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_capture_runs_conversation ON memory_capture_runs(conversation_id)`)
```

2. `src/modules/memory/types.ts`:
   - `:17` → `export type EpisodicSourceType = 'conversation' | 'extraction' | 'user' | 'system' | 'agent-memory'`
     (legalizes the value `save_memory` has always written).
   - `EpisodicMemory` and `CreateEpisodicInput` gain
     `conversationId?: string | null` and `projectId?: string | null`.
   - `VaultFrontmatter` gains
     `/** Board project id this note is scoped to. Set at capture, frozen. */`
     `project?: string`.
   - Append:

```ts
/**
 * The seed catch-all project. Conversations default into it, so for MEMORY it
 * is "no project": capture never emits project facts there and recall treats
 * it as projectless (spec D2). Mirrors the seed id in board/index.ts.
 */
export const MEMORY_DEFAULT_PROJECT_ID = 'general-general'

export function effectiveProjectId(id: string | null | undefined): string | null {
  return id && id !== MEMORY_DEFAULT_PROJECT_ID ? id : null
}
```

3. `frontmatter.ts` — inside the object literal (:14-27) add:
   `project: typeof data.project === 'string' && data.project.trim() ? data.project.trim() : undefined,`
4. `vault-indexer.ts` — add `project_id = ${entry.frontmatter.project ?? null}`
   to the UPDATE (:48-55) and the column + value to the INSERT (:57-63).
5. `episodic-memory.ts` — `rowToMemory` maps
   `conversationId: r.conversation_id ?? null, projectId: r.project_id ?? null`;
   `create()` adds the two columns to the INSERT with
   `${input.conversationId ?? null}, ${input.projectId ?? null}`.

- [ ] **Step 4: Run the test** — expect PASS. Then run the full memory test
  directory (`bun run test tests/modules/memory`) — no regressions.

---

### Task 2: Project-ranked, stable, pruned memory index

**Files:**
- Modify: `src/modules/memory/memory-index.ts`,
  `src/modules/conversations/routes.ts:252` (accessor type) and `:818` (call),
  `src/modules/agent/conversation-runner.ts:429` (call)
- Test: extend `tests/modules/memory/memory-index.test.ts`

**Interfaces:**
- Consumes: `vault_index.project_id` (Task 1), `effectiveProjectId` (Task 1).
- Produces: `MemoryIndexOptions.projectId?: string | null`. The accessor at
  `memory/index.ts:164` already forwards opts — no change there.

- [ ] **Step 1: Write the failing tests** (add to the existing file)

```ts
const note = (path: string, kind: string, summary: string, projectId: string | null = null) =>
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, project_id, file_hash, indexed_at)
    VALUES (${path}, ${path}, 'semantic', '[]', 'body', ${kind}, ${summary}, ${projectId}, 'h', ${new Date().toISOString()})`)

describe('project-ranked recall (F1)', () => {
  it('ranks user, feedback, active project, reference — in that order', () => {
    note('semantic/r.md', 'reference', 'A reference fact')
    note('projects/p1/rule.md', 'project', 'P1 deploy rule', 'p1')
    note('procedural/f.md', 'feedback', 'Never commit unasked')
    note('semantic/u.md', 'user', 'Works in Hungarian')
    const lines = buildMemoryIndex(db, { projectId: 'p1' })!.content.split('\n').slice(2)
    expect(lines.map((l) => l.split(']')[0] + ']')).toEqual(['- [user]', '- [feedback]', '- [project]', '- [reference]'])
  })

  it('excludes other projects entirely, and all projects when there is none', () => {
    note('projects/p2/rule.md', 'project', 'P2 rule', 'p2')
    note('semantic/u.md', 'user', 'Works in Hungarian')
    expect(buildMemoryIndex(db, { projectId: 'p1' })!.content).not.toContain('P2 rule')
    expect(buildMemoryIndex(db, {})!.content).not.toContain('P2 rule')
  })

  it('orders stably by path within a kind — a reindex must not reorder the prompt', () => {
    note('semantic/b.md', 'user', 'Fact B')
    note('semantic/a.md', 'user', 'Fact A')
    const first = buildMemoryIndex(db, {})!.content
    // Touch b so indexed_at changes — the old indexed_at DESC order would flip the lines.
    db.run(sql`UPDATE vault_index SET indexed_at = ${new Date(Date.now() + 5000).toISOString()} WHERE path = 'semantic/b.md'`)
    expect(buildMemoryIndex(db, {})!.content).toBe(first)
  })

  it('a project note with no declared project id never ranks', () => {
    note('projects/team-sessions/x.md', 'project', 'Orphan project note', null)
    expect(buildMemoryIndex(db, { projectId: 'p1' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run and watch the new cases fail.**

- [ ] **Step 3: Implement in `memory-index.ts`**

```ts
/** Ranked highest first. `project` rows rank ONLY for the active project. */
const KIND_ORDER: MemoryKind[] = ['user', 'feedback', 'project', 'reference']

export interface MemoryIndexOptions {
  budgetChars?: number
  /** Effective project of the conversation (already passed through effectiveProjectId). */
  projectId?: string | null
}

interface IndexRow {
  path: string; title: string; tier: string
  summary: string | null; kind: string | null
  project_id: string | null; content_head: string
}
```

   The query — pruned (no full bodies) and stable (`path ASC`; the JS kind sort
   is stable, so path order survives within a kind):

```ts
    rows = db.all(sql`SELECT path, title, tier, summary, kind, project_id,
      substr(content_text, 1, 240) AS content_head
      FROM vault_index ORDER BY path ASC`) as IndexRow[]
```

   The ranking filter replaces the current `.filter`:

```ts
  const activeProject = opts.projectId ?? null
  const ranked = rows
    .map((row) => ({ row, kind: inferKind(row) }))
    .filter((r) => r.kind === 'project'
      ? activeProject !== null && r.row.project_id === activeProject
      : KIND_ORDER.includes(r.kind))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
```

   `summaryOf` reads `row.content_head` instead of `row.content_text` for its
   first-line fallback (same logic, shorter source).

   Call sites:
   - `routes.ts:252` accessor type becomes
     `getMemoryIndex?: (opts?: import('@modules/memory/memory-index.js').MemoryIndexOptions) => import('@modules/memory/memory-index.js').MemoryIndexResult | null,`
   - `routes.ts:818`:
     `const { effectiveProjectId } = await import('@modules/memory/types.js')`
     `const memoryIndex = getMemoryIndex?.({ projectId: effectiveProjectId((conv as any).projectId ?? null) })`
     (fold the import into the existing dynamic import block at :820).
   - `conversation-runner.ts:429`:
     `const { effectiveProjectId } = await import('@modules/memory/types.js')`
     `memoryBlock = buildMemoryIndex(db, { projectId: effectiveProjectId(conv.project_id ?? null) })`

- [ ] **Step 4: Run the full memory-index test file** — all old M1 cases and
  the new ones PASS.

---

### Task 3: Capture config — **[M2 verbatim Task 1]**

Execute the companion plan's Task 1 exactly as written
(`src/core/config/schema.ts`, `config/default.yaml`,
`tests/core/config-schema.test.ts`). No deltas.

- [ ] Steps 1-5 of M2 Task 1, verbatim.

---

### Task 4: The candidate schema — amended

**Files:**
- Create: `src/modules/memory/capture/candidate-schema.ts`
- Test: `tests/modules/memory/capture-candidates.test.ts`

**Interfaces:**
- Produces: `CandidateNote`, `createCandidateBatchSchema(opts: { allowProject:
  boolean })`, `CANDIDATE_KINDS`, `MAX_CANDIDATES`. Tasks 6-7 consume them.
- Delta vs M2 Task 2: `project` IS in the enum now — its consumer (Task 2's
  ranking) ships in this same plan — but the schema is a **factory**: a call
  site with no effective project gets a schema that rejects `project`, so the
  model cannot scope a fact to a project the conversation does not have.

- [ ] **Step 1: Write the failing test** — M2 Task 2's cases, with the schema
  built via `createCandidateBatchSchema({ allowProject: true })`, PLUS:

```ts
describe('project kind gating', () => {
  const project = { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'x' }

  it('accepts project when the conversation has one', () => {
    expect(createCandidateBatchSchema({ allowProject: true }).safeParse({ notes: [project] }).success).toBe(true)
  })

  it('rejects project when there is no effective project — a fact cannot be scoped to nothing', () => {
    expect(createCandidateBatchSchema({ allowProject: false }).safeParse({ notes: [project] }).success).toBe(false)
  })

  it('project notes need no why/howToApply — that discipline is feedback-only', () => {
    expect(createCandidateBatchSchema({ allowProject: true }).safeParse({ notes: [project] }).success).toBe(true)
  })
})
```

  (Drop M2's "rejects project" case — it is inverted by this amendment.)

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement** — M2 Task 2's file with these changes:

```ts
export const CANDIDATE_KINDS = ['user', 'feedback', 'project', 'reference'] as const

const base = z.object({
  kind: z.enum(CANDIDATE_KINDS),
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(140),
  body: z.string().min(3).max(4_000),
  why: z.string().max(400).optional(),
  howToApply: z.string().max(400).optional(),
})

export type CandidateNote = z.infer<typeof base>

export function createCandidateBatchSchema(opts: { allowProject: boolean }) {
  const candidate = base
    .refine((n) => n.kind !== 'feedback' || (!!n.why?.trim() && !!n.howToApply?.trim()),
      { message: 'a feedback note must carry both why and howToApply' })
    .refine((n) => opts.allowProject || n.kind !== 'project',
      { message: 'a project note needs a conversation that belongs to a project' })
  return z.object({ notes: z.array(candidate).max(MAX_CANDIDATES).default([]) })
}
```

  (`MAX_CANDIDATES = 2` and the header comment carry over from M2 unchanged.)

- [ ] **Step 4: Run the test** — expect PASS.

---

### Task 5: The gate — **[M2 verbatim Task 3]**

Execute the companion plan's Task 3 exactly as written
(`capture-gate.ts`, `tests/modules/memory/capture-gate.test.ts`), with ONE
delta: **do not add `memory_capture_runs` to schema.ts here** — Task 1 of this
plan already created it, with the extra `kinds` column. `countExtractions` is
unchanged.

- [ ] Steps 1-4 of M2 Task 3, verbatim minus the schema addition.

---

### Task 6: The note writer — amended for scope and provenance

**Files:**
- Create: `src/modules/memory/capture/note-writer.ts`
- Modify: `src/modules/privacy/index.ts` (publish `ctx.privacySanitize` — M2
  Task 4 step 3.4's snippet, unchanged)
- Test: `tests/modules/memory/note-writer.test.ts`

**Interfaces:**
- Consumes: `CandidateNote` (Task 4), `VaultService`, `VaultIndexer`, `EyasDb`,
  optional `privacySanitize`.
- Produces: `createNoteWriter(deps).write(candidate, scope): Promise<WriteOutcome>`
  where `scope = { conversationId: string; projectId: string | null }` and
  `WriteOutcome = { action: 'created' | 'updated' | 'skipped'; path: string }`.
  Task 7 consumes it.
- Deltas vs M2 Task 4 (everything else — slug, dedup, append-on-update,
  privacy-before-write, `-2` suffix on slug collision, `indexer.indexAll()` —
  is executed as written there):
  1. **Folder routing:** `feedback` → `procedural/`; `project` →
     `projects/<scope.projectId>/` (writer throws if `kind === 'project'` and
     `scope.projectId` is null — the schema already prevents it; the throw is
     the second lock); everything else → `semantic/`.
  2. **Frontmatter:** `kind`, `summary` as in M2, plus `project:
     scope.projectId` when kind is `project`. Scope is frozen at capture (spec
     D1/M2 review): an update never rewrites `project`.
  3. **Provenance:** after every successful create OR update,
     `INSERT OR IGNORE INTO memory_note_links (note_path, owner_module,
     owner_id, source) VALUES (${path}, 'conversations',
     ${scope.conversationId}, 'capture')` — a note reinforced in conversation B
     must appear in B's memory view.

- [ ] **Step 1: Write the failing test** — M2 Task 4's eight cases (adding the
  `scope` second argument, `{ conversationId: 'c1', projectId: null }` where
  irrelevant), PLUS:

```ts
  it('routes a project note into the project folder with frozen scope', async () => {
    const out = await writer.write(
      { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'Green pipeline first.' },
      { conversationId: 'c1', projectId: 'p1' })
    expect(out.path).toBe('projects/p1/deploy-rule.md')
    expect(vault.read(out.path)!.frontmatter.project).toBe('p1')
  })

  it('records a provenance link on create and on update, without duplicates', async () => {
    const c = { kind: 'user' as const, title: 'Language', summary: 'Answers in Hungarian', body: 'Hungarian.' }
    await writer.write(c, { conversationId: 'c1', projectId: null })
    indexer.indexAll()
    await writer.write({ ...c, body: 'Confirmed.' }, { conversationId: 'c2', projectId: null })
    await writer.write({ ...c, body: 'Again.' }, { conversationId: 'c2', projectId: null })
    const rows = db.all(sql`SELECT owner_id FROM memory_note_links WHERE note_path = 'semantic/language.md' ORDER BY owner_id`) as any[]
    expect(rows.map((r: any) => r.owner_id)).toEqual(['c1', 'c2'])
  })
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** — M2 Task 4 step 3's responsibilities with the
  three deltas above folded in at their stated points (folder choice in
  responsibility 2, frontmatter in 5, the links INSERT directly after the
  `vault.write`/`indexAll` in 6).
- [ ] **Step 4: Run the test** — all cases PASS.

---

### Task 7: The extractor and both call sites — amended

**Files:**
- Create: `src/modules/memory/capture/capture-prompt.ts`,
  `src/modules/memory/capture/index.ts`
- Modify: `src/modules/memory/index.ts` (publish `ctx.memoryCapture`),
  `src/modules/conversations/routes.ts` (accessor beside :252; call in the
  post-turn block :1240-1247), `src/modules/agent/conversation-runner.ts`
  (optional dep; call after `handle?.complete` at :727)
- Test: `tests/modules/memory/capture-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3-6.
- Produces: `ctx.memoryCapture: (input: CaptureInput) => Promise<void>` with
  `CaptureInput = { conversationId: string; projectId: string | null;
  userMessage: string; assistantMessage: string }`.
- Deltas vs M2 Task 5 (its non-negotiables — post-delivery, never throws into
  the turn, every outcome writes a run row, clip to `maxInputChars` — all
  stand):
  1. `CaptureInput` carries `projectId` (raw; capture applies
     `effectiveProjectId` itself so call sites cannot get D2 wrong twice).
  2. The system prompt documents the `project` kind; the user prompt gains a
     PROJECT section (name + description, from
     `SELECT name, description FROM projects WHERE id = ?`) when an effective
     project exists, and an EXISTING NOTES section carrying the current index
     one-liners — the do-not-duplicate rule is unenforceable against notes the
     model cannot see.
  3. Schema per call: `createCandidateBatchSchema({ allowProject:
     effProjectId !== null })`.
  4. The run row records `kinds` (JSON array of written kinds) so mislabeling
     is measurable.

- [ ] **Step 1: Write the failing test** — M2 Task 5 step 1's cases (fake
  `complete`, qualifying turn writes note + run row; short message → `too-short`
  row, no model call; throwing `complete` leaves turn intact; switch off → no
  call; cap stops the 21st) PLUS:

```ts
  it('offers project kind and the project context only when there is an effective project', async () => {
    await capture({ conversationId: 'c1', projectId: 'p1', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[0][0].user).toContain('PROJECT:')
    await capture({ conversationId: 'c2', projectId: 'general-general', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[1][0].user).not.toContain('PROJECT:')
  })

  it('drops a project note returned for a projectless conversation, and records the batch as unparsable-shape', async () => {
    fakeComplete.mockResolvedValueOnce(JSON.stringify({ notes: [{ kind: 'project', title: 'Rule', summary: 'S', body: 'B' }] }))
    await capture({ conversationId: 'c3', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = db.all(sql`SELECT skipped_reason FROM memory_capture_runs WHERE conversation_id = 'c3'`) as any[]
    expect(runs[0].skipped_reason).toBe('unparsable')
  })

  it('records which kinds were written', async () => {
    fakeComplete.mockResolvedValueOnce(JSON.stringify({ notes: [{ kind: 'user', title: 'Lang', summary: 'Hungarian', body: 'HU' }] }))
    await capture({ conversationId: 'c4', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = db.all(sql`SELECT kinds FROM memory_capture_runs WHERE conversation_id = 'c4'`) as any[]
    expect(JSON.parse(runs[0].kinds)).toEqual(['user'])
  })

  it('feeds the existing index one-liners into the prompt', async () => {
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
      VALUES ('semantic/u.md', 'Language', 'semantic', '[]', 'b', 'user', 'Answers in Hungarian', 'h', ${new Date().toISOString()})`)
    await capture({ conversationId: 'c5', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls.at(-1)![0].user).toContain('Answers in Hungarian')
  })
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement `capture-prompt.ts`** — M2 Task 5 step 3's file with
  the system prompt's kind line extended to
  `"kind": "user" = who the owner is; "feedback" = how to work; "project" = a durable fact about the named project (only when a PROJECT section is present); "reference" = a durable external fact.`
  and:

```ts
export interface CaptureExtras {
  project?: { name: string; description: string | null }
  existingIndex?: string
}

export function buildCaptureUser(userMessage: string, assistantMessage: string, maxChars: number, extras: CaptureExtras = {}): string {
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars)}\n[clipped]` : s)
  const parts: string[] = []
  if (extras.project) {
    parts.push('PROJECT:', extras.project.name, extras.project.description ?? '', '')
  }
  if (extras.existingIndex) {
    parts.push('EXISTING NOTES (do not restate any of these):', extras.existingIndex, '')
  }
  parts.push('USER MESSAGE:', clip(userMessage), '', 'ASSISTANT REPLY:', clip(assistantMessage))
  return parts.join('\n')
}
```

- [ ] **Step 4: Implement `capture/index.ts`** — M2 Task 5 step 4's file with:
  `effectiveProjectId(input.projectId)` computed first; a `resolveProject`
  helper (`SELECT name, description FROM projects WHERE id = ?`, try/catch →
  null); `existingIndex` = `buildMemoryIndex(deps.db, { projectId: effProjectId })?.content`
  (the lines only, header stripped, clipped to 1 200 chars);
  `createCandidateBatchSchema({ allowProject: effProjectId !== null })` for the
  parse; `writer.write(note, { conversationId: input.conversationId, projectId:
  effProjectId })`; `recordRun` gains the `kinds` JSON parameter (written kinds,
  `null` on skip).

- [ ] **Step 5: Publish and wire both call sites.**
  - `memory/index.ts` (after the `memoryIndex` accessor at :164-171): build the
    writer + capture with `deps.complete` resolved through the model gateway
    exactly as the reflection engine resolves its completions, and publish
    `;(ctx as any).memoryCapture = capture`.
  - Interactive: in `routes.ts`, add
    `getMemoryCapture?: () => ((input: import('@modules/memory/capture/index.js').CaptureInput) => Promise<void>) | undefined,`
    beside `getMemoryIndex` (:252, wired from `conversations/index.ts` as
    `() => (ctx as any).memoryCapture`), then extend the existing post-turn
    block (:1240-1247):

```ts
          // ── Post-turn memory hooks ──
          if (fullText) {
            const userContent = typeof body.content === 'string' ? body.content : ''
            try { memoryHooks?.onTurnComplete?.(id, userContent, fullText) } catch { /* non-fatal */ }
            // Durable-memory capture: after the reply is delivered, never in
            // its critical path, never throwing into the turn.
            void getMemoryCapture?.()?.({
              conversationId: id,
              projectId: (conv as any).projectId ?? null,
              userMessage: userContent,
              assistantMessage: fullText,
            })?.catch(() => {})
          }
```

  - Background: `ConversationRunnerDeps` gains
    `memoryCapture?: (input: import('@modules/memory/capture/index.js').CaptureInput) => Promise<void>`
    (wired where the runner is constructed in `agent/index.ts`, as
    `(input) => ((ctx as any).memoryCapture?.(input) ?? Promise.resolve())`).
    Directly after `handle?.complete({ ... })` at :727, fetch the exchange from
    the store the runner already writes (immune to runner-internal renames):

```ts
    // Durable-memory capture — fire-and-forget, after the run is complete.
    if (deps.memoryCapture) {
      try {
        const lastOf = (role: string) => ((db as any).all(sql`SELECT content FROM conversation_messages
          WHERE conversation_id = ${conv.id} AND role = ${role} ORDER BY created_at DESC LIMIT 1`) as Array<{ content: string }>)[0]?.content ?? ''
        void deps.memoryCapture({
          conversationId: conv.id,
          projectId: conv.project_id ?? null,
          userMessage: lastOf('user'),
          assistantMessage: lastOf('assistant'),
        }).catch(() => {})
      } catch { /* a missing note, never a failed run */ }
    }
```

- [ ] **Step 6: Run the wiring test, then the full suite; diff the `^ FAIL`
  file list against the baseline.**

---

### Task 8: `save_memory` and PreCompact stamp their scope

**Files:**
- Modify: `src/modules/tools/builtin/memory-tools.ts:61-73`,
  `src/modules/memory/consolidation/memory-lifecycle.ts` (deps + :22-30),
  `src/modules/conversations/memory-hooks.ts` (pass the resolver through)
- Test: `tests/modules/memory/scope-stamping.test.ts`

**Interfaces:**
- Consumes: Task 1's columns and `effectiveProjectId`;
  `ToolContext.conversationId/.projectId` (already populated by the executor).
- Produces: every episodic writer stamps scope. (The data-port import stays
  unstamped — an import has no conversation; documented, not changed.)

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'
import { createMemoryLifecycle } from '@modules/memory/consolidation/memory-lifecycle'

let db: any, episodic: any

beforeEach(() => { db = createMemoryDb(); createMemoryTables(db); episodic = createEpisodicMemoryService(db) })

const rowFor = (id: string) =>
  (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories WHERE id = ${id}`) as any[])[0]

describe('scope stamping', () => {
  it('save_memory stamps conversation and effective project from ToolContext', async () => {
    const save = createMemoryTools(() => ({ episodic })).find((t) => t.name === 'save_memory')!
    const out: any = await save.execute({ content: 'the owner prefers rebase over merge' },
      { conversationId: 'c1', projectId: 'p1', userId: 'u', logger: { warn: vi.fn() } } as any)
    expect(rowFor(out.id)).toEqual({ conversation_id: 'c1', project_id: 'p1' })
  })

  it('save_memory treats the seed project as no project', async () => {
    const save = createMemoryTools(() => ({ episodic })).find((t) => t.name === 'save_memory')!
    const out: any = await save.execute({ content: 'the owner prefers rebase over merge' },
      { conversationId: 'c1', projectId: 'general-general', userId: 'u', logger: { warn: vi.fn() } } as any)
    expect(rowFor(out.id).project_id).toBeNull()
  })

  it('PreCompact stamps the conversation and the resolved project', () => {
    const hooks = createMemoryLifecycle({ episodic, resolveProjectId: () => 'p9' })
    hooks.onContextCompact!('c2', 'a compaction summary long enough to be worth keeping around')
    const row = (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories`) as any[])[0]
    expect(row).toEqual({ conversation_id: 'c2', project_id: 'p9' })
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement**
  - `memory-tools.ts` — `save_memory.execute` becomes
    `async (input, toolCtx) => { ... }` and creates with:

```ts
        const { effectiveProjectId } = await import('@modules/memory/types.js')
        const entry = service.episodic.create({
          content: input.content as string,
          sourceType: 'agent-memory',
          tags: (input.tags as string[]) ?? [],
          conversationId: toolCtx?.conversationId ?? null,
          projectId: effectiveProjectId(toolCtx?.projectId ?? null),
          // Kept alongside the typed column for pre-F1 readers of source_id.
          sourceId: toolCtx?.conversationId ?? null,
        })
```

  - `memory-lifecycle.ts` — deps become
    `{ episodic: EpisodicMemoryService; resolveProjectId?: (conversationId: string) => string | null }`;
    `onContextCompact` adds
    `conversationId, projectId: deps.resolveProjectId?.(conversationId) ?? null`
    to its `create` input (D2 is the resolver's job — see next line).
  - `memory-hooks.ts` — `createLazyMemoryHooks` gains a third parameter
    `resolveProjectId?: (conversationId: string) => string | null`, forwarded
    into `createMemoryLifecycle`. `conversations/index.ts` supplies it:

```ts
    const memoryHooks = createLazyMemoryHooks(
      () => (ctx as any).memory,
      ctx.logger,
      (conversationId) => {
        try {
          const row = (ctx.db as any).all(sql`SELECT project_id FROM conversations WHERE id = ${conversationId}`) as any[]
          const { effectiveProjectId } = require('@modules/memory/types.js') // eslint-disable-line
          return effectiveProjectId(row[0]?.project_id ?? null)
        } catch { return null }
      },
    )
```

    (Use a top-of-file static `import { effectiveProjectId } from
    '@modules/memory/types.js'` instead of `require` — the require form above
    is illustrative only; this is an ESM codebase and value-imports of
    constants are the triage.ts lesson.)

- [ ] **Step 4: Run the test, then the full suite; diff the FAIL file list.**

---

### Task 9: Documentation — **[M2 verbatim Task 6, plus scoping]**

Execute M2 Task 6 (architecture § 13 capture subsection, CHANGELOG, the six
`knowledge/memory.md` pages, `bun run docs:build`) with these additions:

- [ ] **Step 1:** Architecture § 13 also documents: the boot-order bug and the
  lazy-hook fix; the D1 ranking (`user → feedback → active project →
  reference`, other projects excluded); D2 (`general-general` is "no
  project"); provenance (`memory_note_links`, frontmatter `project` frozen at
  capture); and that `memory_capture_runs.kinds` is the mislabel measurement.
- [ ] **Step 2:** CHANGELOG section `### Memory that fills itself — and knows
  where it came from`, listing capture, scoping, ranking, and the boot-order
  fix as the wave's contents.
- [ ] **Step 3:** The six `knowledge/memory.md` pages replace the "Nothing
  writes these automatically yet" paragraph per M2, and add one paragraph on
  project memory: facts learned inside a project's conversations rank first in
  that project and are invisible elsewhere. All six languages, each page in its
  own register.
- [ ] **Step 4:** `bun run docs:build` — must complete cleanly.

---

## Self-review checklist (run before handing back)

- Spec coverage: F1 items 1-7 of the spec each map to a task (1→T2/T4, 2→T4/T7,
  3→T7, 4→T1/T6, 5→T1/T8, 6→T0, 7→T2). D1/D2 encoded in T2 and
  `effectiveProjectId`; D4's indicator and lists are F3, not here.
- The full suite's `^ FAIL` file list and the lint count match the baseline
  recorded before Task 0.
- `bun run docs:build` clean.

## Phase gate

Stop here. Before F2, read `memory_capture_runs`: the gate's fire rate tunes
`minUserChars`, and the `kinds` distribution says whether project mislabeling
is real. Both were built so this is measured, not argued.
