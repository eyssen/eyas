# Related prior work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans
> (or subagent-driven-development) to implement this plan task by task. Steps
> use checkbox (`- [ ]`) syntax.

**Goal:** a new user message retrieves related prior work from EYAS's own
stores and injects it into the prompt, and every past user/assistant message
is searchable via FTS — without asking the model to call a tool.

**Architecture:** L0 is an FTS5 external-content index over the existing
`conversation_messages` table (triggers + chunked backfill). Related-work is
a derived, per-turn section (same placement as `memory-index`): lexical FTS
across vault + episodic + L0, clipped, scoped by D1/D2, injected on both
the interactive and background paths. No model call on the recall path. No
new storage engine.

**Tech Stack:** TypeScript (ESM, strict), Drizzle over SQLite FTS5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-related-prior-work-design.md`
(extends the 2026-08-27 durable-memory and scale/scoping specs; D1–D5 stand).

## Global Constraints

- **Never commit, never push, never branch — this binds subagents too.**
  Steps below have no commit step; the owner commits.
- Version stays **0.8.18-beta**. Do not touch `package.json`, `version.json`,
  or any HTML version string. Do not write CHANGELOG until the owner closes
  the wave.
- English code and comments. User-facing handbook strings go in all six
  languages (`en hu de es fr tlh`). The related-work *prompt section* is
  English, like `memory-index`.
- MIT-compatible dependencies only. **This wave adds none.**
- `bun run full-docs` is forbidden; `bun run docs:build` is the allowed build.
- Do not reopen packing (F4), F3 UI, trigram, vector-hydration, God Mode
  capture, or provider-memory reads.

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/memory/search/conversation-fts.ts` (create) | `ensureConversationFts`, `backfillConversationFts`, `ftsConversation` |
| `src/modules/memory/schema.ts` (modify) | call `ensureConversationFts` at the end of `createMemoryTables` |
| `src/modules/memory/types.ts` (modify) | `MemorySearchResult.source` gains `'conversation'`; optional `conversation` in `tiers` |
| `src/modules/memory/memory-service.ts` (modify) | default search includes L0; hydrate `source: 'conversation'` |
| `src/modules/tools/builtin/memory-tools.ts` (modify) | `search_memory` description + optional `tier: 'conversation'`; pass `excludeConversationId` |
| `src/modules/memory/related-work.ts` (create) | gate, lexical retrieval, ranking, clip, section renderer |
| `src/core/config/schema.ts` + `config/default.yaml` (modify) | `memory.relatedWork` |
| `src/modules/memory/index.ts` (modify) | publish `ctx.relatedWork`; start backfill onStart |
| `src/modules/conversations/routes.ts` (modify) | last positional accessor; inject after memory-index |
| `src/modules/conversations/index.ts` (modify) | pass the accessor |
| `src/modules/agent/conversation-runner.ts` (modify) | inject on the background path |
| `docs/eyas-architecture.md` | §13 subsection |
| `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/knowledge/memory.md` | handbook |
| `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/automation/tools.md` | `search_memory` now searches L0 |

---

### Task 1: L0 FTS — table, triggers, clip, backfill, scoped search

**Files:**
- Create: `src/modules/memory/search/conversation-fts.ts`
- Modify: `src/modules/memory/schema.ts` (end of `createMemoryTables`)
- Test: `tests/modules/memory/conversation-fts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CONVERSATION_FTS_CLIP = 4_000
  export const CONVERSATION_FTS_BATCH = 500

  export function ensureConversationFts(db: EyasDb): void
  export function backfillConversationFts(db: EyasDb, opts?: { afterRowId?: number; limit?: number }): { done: boolean; lastRowId: number; indexed: number }
  export function ftsConversation(db: EyasDb, query: string, opts: {
    limit: number
    projectId?: string | null
    scope?: 'current' | 'all'
    excludeConversationId?: string | null
  }): Array<{
    messageId: number
    conversationId: string
    title: string | null
    role: string
    body: string
    score: number
  }>
  ```
- Later tasks consume `ftsConversation` (Task 2, Task 3) and
  `ensureConversationFts` / `backfillConversationFts` (Task 4 boot).

- [ ] **Step 1: Write the failing test**

`tests/modules/memory/conversation-fts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import {
  backfillConversationFts,
  ftsConversation,
} from '@modules/memory/search/conversation-fts'

let db: any

function tables() {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    user_id TEXT NOT NULL DEFAULT 'u1', project_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
}

function conv(id: string, over: Record<string, unknown> = {}) {
  const now = '2026-08-31T00:00:00Z'
  db.run(sql`INSERT INTO conversations (id, title, status, project_id, created_at, updated_at)
    VALUES (${id}, ${over.title ?? id}, ${over.status ?? 'idle'}, ${over.project_id ?? null}, ${now}, ${now})`)
}

function msg(conversationId: string, role: string, content: string) {
  db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES (${conversationId}, ${role}, ${content}, '2026-08-31T00:00:00Z')`)
}

beforeEach(() => {
  db = createMemoryDb()
  tables()
  createMemoryTables(db)
})

describe('conversation FTS', () => {
  it('indexes inserts that happen after ensure, via the trigger', () => {
    conv('c1', { title: 'MNB' })
    msg('c1', 'user', 'Cloudflare 1010 blocked the IAP from pods')
    const hits = ftsConversation(db, 'Cloudflare IAP', { limit: 5, scope: 'all' })
    expect(hits.some(h => h.body.includes('Cloudflare 1010'))).toBe(true)
    expect(hits[0].conversationId).toBe('c1')
  })

  it('backfills rows that predate the triggers', () => {
    conv('c1')
    msg('c1', 'user', 'historical SOAP endpoint')
    // Recreate FTS without triggers by dropping — then insert, then ensure+backfill.
    db.run(sql`DROP TABLE IF EXISTS conversation_fts`)
    db.run(sql`DROP TRIGGER IF EXISTS conversation_fts_ai`)
    db.run(sql`DROP TRIGGER IF EXISTS conversation_fts_ad`)
    db.run(sql`DROP TRIGGER IF EXISTS conversation_fts_au`)
    msg('c1', 'assistant', 'use http://www.mnb.hu/arfolyamok.asmx')
    const { ensureConversationFts } = require('@modules/memory/search/conversation-fts')
    ensureConversationFts(db)
    expect(ftsConversation(db, 'arfolyamok', { limit: 5, scope: 'all' })).toHaveLength(0)
    let last = 0
    for (let i = 0; i < 10; i++) {
      const r = backfillConversationFts(db, { afterRowId: last, limit: 10 })
      last = r.lastRowId
      if (r.done) break
    }
    expect(ftsConversation(db, 'arfolyamok', { limit: 5, scope: 'all' }).length).toBeGreaterThan(0)
  })

  it('excludes deleted conversations', () => {
    conv('c1', { status: 'deleted' })
    msg('c1', 'user', 'secret deleted thread about IAP')
    expect(ftsConversation(db, 'IAP', { limit: 5, scope: 'all' })).toHaveLength(0)
  })

  it('excludes the current conversation', () => {
    conv('c1')
    conv('c2')
    msg('c1', 'user', 'unique-token-alpha IAP')
    msg('c2', 'user', 'unique-token-alpha SOAP')
    const hits = ftsConversation(db, 'unique-token-alpha', {
      limit: 5, scope: 'all', excludeConversationId: 'c1',
    })
    expect(hits.map(h => h.conversationId)).toEqual(['c2'])
  })

  it('does not index tool or system roles', () => {
    conv('c1')
    msg('c1', 'tool', 'tool output mentioning unique-token-bravo')
    msg('c1', 'system', 'system unique-token-bravo')
    msg('c1', 'user', 'hello')
    expect(ftsConversation(db, 'unique-token-bravo', { limit: 5, scope: 'all' })).toHaveLength(0)
  })

  it('scope=current hides other projects', () => {
    conv('c1', { project_id: 'proj-a' })
    conv('c2', { project_id: 'proj-b' })
    msg('c1', 'user', 'unique-token-charlie on A')
    msg('c2', 'user', 'unique-token-charlie on B')
    const hits = ftsConversation(db, 'unique-token-charlie', {
      limit: 5, scope: 'current', projectId: 'proj-a',
    })
    expect(hits.map(h => h.conversationId)).toEqual(['c1'])
  })

  it('clips indexed body to 4000 characters', () => {
    conv('c1')
    const body = `head ${'x'.repeat(5000)} unique-token-delta`
    msg('c1', 'user', body)
    const hits = ftsConversation(db, 'head', { limit: 5, scope: 'all' })
    expect(hits[0].body.length).toBeLessThanOrEqual(4000)
    expect(ftsConversation(db, 'unique-token-delta', { limit: 5, scope: 'all' })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test — it must fail**

```
bun vitest run tests/modules/memory/conversation-fts.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/modules/memory/search/conversation-fts.ts`:

- `ensureConversationFts(db)`:
  - no-op if `conversation_messages` is missing (`sqlite_master`).
  - `CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(body, content='conversation_messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`. On throw, recreate without `remove_diacritics 2`.
  - Triggers `conversation_fts_ai/ad/au` with `WHEN new.role IN ('user','assistant')` (and `old.role` on delete/update). Insert `substr(new.content, 1, 4000)` as `body`.
- `backfillConversationFts`: `INSERT INTO conversation_fts(rowid, body) SELECT rowid, substr(content, 1, 4000) FROM conversation_messages WHERE role IN ('user','assistant') AND rowid > :after ORDER BY rowid LIMIT :limit`. Return `{ indexed, lastRowId, done: indexed < limit }`. Skip rows already in FTS (`rowid NOT IN (SELECT rowid FROM conversation_fts)`).
- `ftsConversation`: `escapeFtsQuery` from `schema.ts`. Empty query → `[]`. JOIN `conversation_messages` + `conversations`. `status != 'deleted'`. `excludeConversationId` when set. `scope !== 'all'` AND `projectId` set → `c.project_id = projectId`. `scope !== 'all'` AND no `projectId` → `(c.project_id IS NULL OR c.project_id = 'general-general')`. Order by `-bm25(conversation_fts) DESC`. Limit.

Call `ensureConversationFts(db)` at the end of `createMemoryTables`. Do **not** run `'rebuild'` on boot.

- [ ] **Step 4: Run the test — it must pass**

```
bun vitest run tests/modules/memory/conversation-fts.test.ts
```

Expected: PASS.

---

### Task 2: `search_memory` sees L0

**Files:**
- Modify: `src/modules/memory/types.ts` (`MemorySearchQuery.tiers`, `MemorySearchResult.source`)
- Modify: `src/modules/memory/memory-service.ts` (`search`)
- Modify: `src/modules/tools/builtin/memory-tools.ts` (enum + description + `excludeConversationId: toolCtx?.conversationId`)
- Test: `tests/modules/memory/search-conversation.test.ts`

**Interfaces:**
- Consumes: `ftsConversation` from Task 1.
- Produces: `MemorySearchResult` with `source: 'conversation'` and metadata `{ conversationId, messageId, title, role }`. Default `tiers` when omitted: `['episodic','semantic','procedural','archive','conversation']`. Passing an explicit `tiers` list that omits `'conversation'` must not return L0.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryService } from '@modules/memory/memory-service'

// Construct the service the way tests/modules/memory/search-integration.test.ts
// does (real db + working/episodic/archive/vault/indexer/wikilinks). Also
// create conversations + conversation_messages before createMemoryTables.

it('default search includes a conversation hit', async () => {
  // seed conv + user message "Cloudflare blocked IAP"
  const results = await service.search({ query: 'Cloudflare IAP', projectId: null, scope: 'all' })
  expect(results.some(r => r.source === 'conversation')).toBe(true)
})

it('tier=episodic does not return conversation hits', async () => {
  const results = await service.search({ query: 'Cloudflare IAP', tiers: ['episodic'], scope: 'all' })
  expect(results.every(r => r.source !== 'conversation')).toBe(true)
})

it('scope=current hides another project\'s L0', async () => {
  // conv A project proj-a, conv B project proj-b, same distinctive token
  const results = await service.search({
    query: 'unique-token-echo', scope: 'current', projectId: 'proj-a',
  })
  expect(results.filter(r => r.source === 'conversation').every(r => r.metadata.conversationId === 'c-a')).toBe(true)
})
```

Extend `tests/contracts/tool-service/memory-tools.contract.test.ts` so
`execute` forwards `excludeConversationId: toolCtx.conversationId`. Add a
case if the contract file has no execute spy; do not create a parallel
tools test file.

- [ ] **Step 2: Run — must fail**

```
bun vitest run tests/modules/memory/search-conversation.test.ts
```

- [ ] **Step 3: Implement**

In `search()`:

- Default tiers include `'conversation'`.
- `wantConversation = !query.tiers || query.tiers.includes('conversation')` — wait: the current default *sets* tiers to a list. Change that default list to include `'conversation'`. `wantConversation = tiers.includes('conversation')`.
- Call `ftsConversation` with `projectId`, `scope`, `excludeConversationId: query.excludeConversationId`.
- Add to `contentMap` as `cv:{conversationId}:{messageId}` with `source: 'conversation'`.
- Add those ids to `ftsItems` (not `vecItems`).
- `MemorySearchQuery` gains `excludeConversationId?: string | null`.

Tool: `excludeConversationId: toolCtx?.conversationId ?? null`. Description mentions prior conversation messages. Enum adds `'conversation'`.

- [ ] **Step 4: Run — must pass**

```
bun vitest run tests/modules/memory/search-conversation.test.ts tests/modules/tools/memory-tools.test.ts
```

---

### Task 3: Related-work renderer

**Files:**
- Create: `src/modules/memory/related-work.ts`
- Modify: `src/core/config/schema.ts` (`memory.relatedWork`)
- Modify: `config/default.yaml`
- Test: `tests/modules/memory/related-work.test.ts`

**Interfaces:**
- Consumes: `ftsConversation`; vault/episodic FTS via the same SQL shape as `memory-service` (keep the queries in `related-work.ts` — do not await embeddings).
- Produces:
  ```ts
  export const RELATED_WORK_SECTION_KEY = 'related-work'
  export const DEFAULT_RELATED_WORK_CHARS = 1_200
  export const DEFAULT_RELATED_WORK_HITS = 5
  export const DEFAULT_RELATED_WORK_SNIPPET = 140
  export const DEFAULT_RELATED_WORK_MIN_QUERY = 40

  export interface RelatedWorkOptions {
    query: string
    conversationId: string
    projectId?: string | null
    excludeVaultPaths?: string[]
    budgetChars?: number
    maxHits?: number
    minQueryChars?: number
    enabled?: boolean
  }
  export interface RelatedWorkResult { content: string; ids: string[] }
  export function buildRelatedWork(db: EyasDb, opts: RelatedWorkOptions): RelatedWorkResult | null
  ```

Config block (defaults match the constants):

```yaml
memory:
  relatedWork:
    enabled: true
    minQueryChars: 40
    maxHits: 5
    budgetChars: 1200
    maxSnippetChars: 140
```

Zod: nest `relatedWork` next to `capture` under `memory`. Defaults in
`z.object({...}).default({})` so a config file written before this block
still runs the feature ON.

- [ ] **Step 1: Write the failing test**

```ts
describe('buildRelatedWork', () => {
  it('returns null when the query is shorter than minQueryChars', () => {
    expect(buildRelatedWork(db, { query: 'ok', conversationId: 'c-now' })).toBeNull()
  })

  it('returns null when enabled is false', () => {
    expect(buildRelatedWork(db, { query: 'x'.repeat(40), conversationId: 'c-now', enabled: false })).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(buildRelatedWork(db, { query: 'zzzz-no-such-token-in-store', conversationId: 'c-now' })).toBeNull()
  })

  it('ranks a vault hit above an L0 hit', () => {
    // vault note summary "Direct MNB SOAP — Cloudflare 1010 blocked IAP"
    // L0 message in another conversation with the same words
    const block = buildRelatedWork(db, { query: 'MNB SOAP Cloudflare IAP from pods please', conversationId: 'c-now' })
    const vaultAt = block!.content.indexOf('[vault]')
    const convAt = block!.content.indexOf('[conversation]')
    expect(vaultAt).toBeGreaterThan(-1)
    expect(convAt).toBeGreaterThan(vaultAt)
  })

  it('does not repeat a vault path already in excludeVaultPaths', () => {
    const block = buildRelatedWork(db, {
      query: 'MNB SOAP Cloudflare IAP from pods please',
      conversationId: 'c-now',
      excludeVaultPaths: ['semantic/mnb-iap.md'],
    })
    expect(block?.content ?? '').not.toMatch(/\[vault\]/)
  })

  it('excludes the current conversation\'s own messages', () => {
    // only c-now has the distinctive token
    expect(buildRelatedWork(db, { query: 'only-in-current-conversation-token xx', conversationId: 'c-now' })).toBeNull()
  })

  it('clips to whole lines and reports the drop', () => {
    // seed 8 vault notes that all match
    const block = buildRelatedWork(db, {
      query: 'shared-token-enough-chars-to-pass-the-gate-xxxx',
      conversationId: 'c-now',
      maxHits: 5,
    })
    expect(block!.content).toMatch(/more hits not shown/)
    expect((block!.content.match(/^- \[/gm) ?? []).length).toBe(5)
  })

  it('labels the section as background, not instructions', () => {
    const block = buildRelatedWork(db, { query: 'MNB SOAP Cloudflare IAP from pods please', conversationId: 'c-now' })
    expect(block!.content).toMatch(/not instructions/)
    expect(block!.content).toMatch(/search_memory/)
  })
})
```

Seed vault rows via `INSERT INTO vault_index` (same helper as
`memory-index.test.ts`). Seed conversations as in Task 1. Query strings in
tests MUST be ≥ 40 code points unless the test is the too-short case.

- [ ] **Step 2: Run — must fail**

```
bun vitest run tests/modules/memory/related-work.test.ts
```

- [ ] **Step 3: Implement `buildRelatedWork`**

Gate first (`enabled === false` or `[...query].length < minQueryChars` →
`null`). Then three lexical lists, each `limit = maxHits * 2`:

1. Vault FTS (copy the JOIN from `memory-service.ftsVault`), filter with
   `vaultNoteInScope(..., { projectId, scope: 'current' })`, drop paths in
   `excludeVaultPaths`.
2. Episodic FTS (`valid_until IS NULL`). If `projectId` is set, keep rows
   whose `project_id` is that id; if not, keep rows whose `project_id` is
   null.
3. `ftsConversation` with `excludeConversationId: conversationId`,
   `scope: 'current'`, `projectId`.

Concatenate in that order, unique by id, slice to `maxHits`. Render as in
the spec. If zero lines survive the budget, return `null` (no empty
heading). Whole lines only. Snippet clip at `maxSnippetChars`.

No `async`. No embedding call.

- [ ] **Step 4: Run — must pass**

```
bun vitest run tests/modules/memory/related-work.test.ts
```

---

### Task 4: Wiring — interactive + background, fail-soft

**Files:**
- Modify: `src/modules/memory/index.ts` (publish `ctx.relatedWork`; fire-and-forget backfill in `onStart`)
- Modify: `src/modules/conversations/routes.ts` (append last positional arg)
- Modify: `src/modules/conversations/index.ts` (pass the accessor)
- Modify: `src/modules/agent/conversation-runner.ts` (build next to memory-index)
- Test: `tests/modules/memory/related-work-wiring.test.ts` (clone
  `memory-index-wiring.test.ts`)

**Interfaces:**
- Consumes: `buildRelatedWork`, `RELATED_WORK_SECTION_KEY`.
- Produces: `ctx.relatedWork(opts) => RelatedWorkResult | null` with the
  same try/catch-warn contract as `ctx.memoryIndex`.
- `createConversationRoutes` last parameter:
  ```ts
  getRelatedWork?: (opts: import('@modules/memory/related-work.js').RelatedWorkOptions) => import('@modules/memory/related-work.js').RelatedWorkResult | null
  ```
  **Append after `getStudio`. Do not insert in the middle.** Existing
  positional call sites (including `memory-index-wiring.test.ts`, which
  stops at `getMemoryIndex`) must keep compiling.

Interactive injection (immediately after the memory-index try/catch):

```ts
try {
  const { effectiveProjectId } = await import('@modules/memory/types.js')
  const query = typeof body.content === 'string' ? body.content : ''
  const related = getRelatedWork?.({
    query,
    conversationId: id,
    projectId: effectiveProjectId((conv as any).projectId ?? null),
    excludeVaultPaths: memoryIndex?.paths ?? [],
  })
  if (related) {
    const { RELATED_WORK_SECTION_KEY } = await import('@modules/memory/related-work.js')
    system = system ? `${system}\n\n${related.content}` : related.content
    appendSection(RELATED_WORK_SECTION_KEY, related.content, related.ids.join(','))
  }
} catch {
  // accessor already logged
}
```

`memoryIndex` must be in scope (const in the previous block — lift it out
of the inner `if` so `paths` is available even when the index was empty).

Background (`conversation-runner.ts`), after the memory-index block:

```ts
let relatedBlock: { content: string; ids: string[] } | null = null
try {
  const { buildRelatedWork } = await import('@modules/memory/related-work.js')
  const { effectiveProjectId } = await import('@modules/memory/types.js')
  const query = (conv.goal_description ?? '').trim()
  relatedBlock = buildRelatedWork(db, {
    query,
    conversationId: conv.id,
    projectId: effectiveProjectId(conv.project_id ?? null),
    excludeVaultPaths: memoryBlock?.paths ?? [],
  })
} catch (err: any) {
  logger.warn(`Conversation runner: related work failed for conversation ${conv.id}: ${err?.message ?? err}`)
}
const extraSystem = [orchestrationDirective, designBlock?.content, memoryBlock?.content, relatedBlock?.content]
```

`onStart` backfill: after `indexer.indexAll()`, if `conversation_messages`
exists, loop `backfillConversationFts` in a `void (async () => { ... })()`
(or `setTimeout(0)`). Do not await on the start path. Catch and log.

`ctx.relatedWork` reads `memory.relatedWork` from `ctx.config` on each
call (same freshness as capture).

- [ ] **Step 1: Write the failing wiring tests**

Copy `memory-index-wiring.test.ts` into `related-work-wiring.test.ts`.

Background: seed a *different* conversation's vault-matching message is
unnecessary if a vault note exists — `goal_description` of `'do the MNB SOAP IAP Cloudflare thing now please'` (≥40 chars) plus a vault note
should put `[vault]` into `runCalls[0]` system / reminders.

Interactive: `createConversationRoutes(... 18 undefineds after gateway's
neighbors ..., getRelatedWork)` — count carefully: args 5–22 may be
`undefined`, arg 23 is the accessor. Easier: pass a real `getRelatedWork`
and leave `getMemoryIndex` undefined; the section must still appear.

Cases:

- accessor content is in `captured[0].system`
- no accessor → no `Related prior work` heading
- accessor returns null → no heading
- accessor throws → turn still 200, one captured request
- background path puts the section in `extraSystem` / reminders

- [ ] **Step 2: Run — must fail**

```
bun vitest run tests/modules/memory/related-work-wiring.test.ts
```

- [ ] **Step 3: Wire**

Then run the existing memory-index wiring tests to prove the positional
append did not shift `getMemoryIndex`:

```
bun vitest run tests/modules/memory/memory-index-wiring.test.ts tests/modules/memory/capture-wiring.test.ts
```

- [ ] **Step 4: Run — must pass**

```
bun vitest run tests/modules/memory/related-work-wiring.test.ts tests/modules/memory/memory-index-wiring.test.ts tests/modules/memory/conversation-fts.test.ts tests/modules/memory/related-work.test.ts
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/eyas-architecture.md` §13 (after the durable-memory capture
  subsection, before Vault struktura)
- Modify: `packages/docs/src/content/docs/en/knowledge/memory.md` and the
  five translations
- Modify: `packages/docs/src/content/docs/en/automation/tools.md` and the
  five translations
- Test: none (docs). `bun run docs:build` must succeed.

- [ ] **Step 1: Architecture subsection (English, matching §13's register)**

Add **Tartos memoria: kapcsolodo korabbi munka** covering:

- query-conditioned block, structural, FTS-only, no model call
- L0 FTS on `conversation_messages` (user+assistant, 4000 clip, deleted
  join, D1/D2, current conversation excluded)
- `search_memory` default includes L0
- not packing / not F3 / not God Mode capture

- [ ] **Step 2: Handbook — English source paragraph**

Insert into Durable notes, after the index paragraph:

> A second per-turn block retrieves **related prior work** from the vault,
> episodic memory, and past conversation messages, using the current
> message as the query. The model does not have to call `search_memory`
> for those hits to appear. Bodies still load through `search_memory`.
> Past messages are searchable because they are already stored; this is
> not a second copy.

Tools table: `search_memory` also searches prior conversation messages
(user + assistant) in the current project; `scope=all` crosses projects.

- [ ] **Step 3: Translate that paragraph into `hu de es fr tlh`**
  `knowledge/memory.md` and `automation/tools.md`. Match each file's
  existing register. Do not leave English-only handbook strings.

- [ ] **Step 4: `bun run docs:build`**

Expected: success.

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| L0 FTS, unicode61, clip 4000, user+assistant only | 1 |
| No sync rebuild on boot; chunked backfill | 1 + 4 |
| Deleted conversations excluded | 1 |
| Current conversation excluded | 1, 3, 2 (tool) |
| D1/D2 scope | 1, 2, 3 |
| `search_memory` default includes L0 | 2 |
| Related-work gate 40 chars, default ON | 3 |
| Vault > episodic > L0; max 5; 1200 chars; whole lines | 3 |
| Dedup vs memory-index paths | 3, 4 |
| No embeddings on the turn path | 3 |
| Fail-soft both paths | 4 |
| Last positional arg | 4 |
| God Mode capture not opened | (explicitly omitted) |
| Packing / F3 / trigram / vector-hydration omitted | (explicitly omitted) |
| Handbook six languages | 5 |
| Version freeze, no CHANGELOG, no commit | Global Constraints |
