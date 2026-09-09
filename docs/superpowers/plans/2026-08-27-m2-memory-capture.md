# Durable memory M2 — Capture

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans
> to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a durable fact established in a conversation is written to the vault
without anybody remembering to ask for it.

**Architecture:** after an assistant turn is delivered, a deterministic gate
decides whether to spend a model call; if it does, one cheap completion returns
0–2 candidate notes against a Zod schema, each is deduplicated against the vault
FTS index, sanitised by the privacy module, and written as a markdown file. M1's
index then carries it into every later prompt.

**Tech Stack:** TypeScript (ESM, strict), Zod, Drizzle over SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-durable-memory-design.md`
**Prior phase:** `docs/superpowers/plans/2026-08-27-m1-memory-recall.md` (done)

## Global Constraints

- **Never commit, never push, never branch.**
- Version frozen at **0.8.14-beta**.
- Baseline that must not grow: `bun run test` → 58 failing in 9 files;
  `bun run lint` → 51. Diff the failing FILE list on `^ FAIL` only.
- English code and comments; six languages for any user-facing string.
- MIT-compatible dependencies only. M2 adds none.
- `bun run full-docs` is forbidden.

## The owner's decision

**It runs on every conversation.** Not per-conversation opt-in: an opt-in
reproduces the 0/24 that started this work, because nobody turns it on. The
switch is therefore global and defaults to **on**, and the honest consequence —
a model call attached to turns — is stated in the config comment and the manual.

For scale: the measured interactive turn on this instance reported **299 931
tokens**. An extraction call sees at most two clipped messages. It is noise
against the turn it follows, and that is the argument for not gating it cleverly.

## The gate is structural, not lexical

The obvious pre-gate is a keyword list — "correction words", "preference
words". **Do not build that.** Two reasons, both load-bearing:

1. This instance is used in Hungarian and the codebase ships six languages. A
   keyword gate would fire unevenly by language, and the two regex traps this
   project already paid for (`\b` is ASCII-only, so `\bűrlap` never matches
   "Űrlapelemek"; Hungarian plurals lengthen the stem vowel, so "minta" is not a
   prefix of "minták") are exactly what a multilingual keyword gate walks into.
2. It guesses at meaning, which is the model's job — the point of this design is
   that the *when* is code and the *what* is the model.

The gate is therefore one length check: a user message under `minUserChars`
cannot contain a durable fact. In this very session that would have skipped
"mehet", "ok", "igen" and "mehet" — four of the owner's last messages — at zero
cost and with no language knowledge at all.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/config/schema.ts` (modify) | `memory.capture` block |
| `config/default.yaml` (modify) | the shipped defaults, with the cost stated |
| `src/modules/memory/capture/candidate-schema.ts` (create) | the Zod contract for what the model may return |
| `src/modules/memory/capture/capture-gate.ts` (create) | the structural gate and the per-conversation cap |
| `src/modules/memory/capture/capture-prompt.ts` (create) | the extraction prompt, including the do-not-save list |
| `src/modules/memory/capture/note-writer.ts` (create) | dedup, privacy, slug, vault write, reindex |
| `src/modules/memory/capture/index.ts` (create) | `createMemoryCapture()` — wires the four together |
| `src/modules/memory/index.ts` (modify) | construct it, publish `ctx.memoryCapture` |
| `src/modules/conversations/routes.ts` (modify) | call it after the stream completes |
| `src/modules/agent/conversation-runner.ts` (modify) | call it after the run completes |
| `tests/modules/memory/capture-gate.test.ts` (create) | |
| `tests/modules/memory/capture-candidates.test.ts` (create) | schema + prompt contract |
| `tests/modules/memory/note-writer.test.ts` (create) | dedup, privacy, paths |
| `tests/modules/memory/capture-wiring.test.ts` (create) | both paths, non-blocking, cap, switch |

---

### Task 1: Config

**Files:**
- Modify: `src/core/config/schema.ts:86-97` (the existing `memory` block)
- Modify: `config/default.yaml`
- Test: `tests/core/config-schema.test.ts` (extend; it already pins that a
  missing schema entry silently strips the operator's YAML)

**Interfaces:**
- Produces: `config.memory.capture: { enabled, minUserChars, maxPerConversation, maxInputChars }`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps a memory.capture block instead of stripping it', () => {
  const parsed = configSchema.parse({ memory: { capture: { enabled: false, minUserChars: 80 } } })
  expect(parsed.memory.capture.enabled).toBe(false)
  expect(parsed.memory.capture.minUserChars).toBe(80)
})

it('defaults capture to on, because an opt-in reproduces the bug this fixes', () => {
  expect(configSchema.parse({}).memory.capture.enabled).toBe(true)
})
```

- [ ] **Step 2: Run it and watch it fail** — `capture` is stripped by `z.object`.

- [ ] **Step 3: Extend the schema**

Inside the existing `memory: z.object({ ... })`, beside `reflection`:

```ts
    // Durable-memory capture. ON by default, deliberately: the whole reason
    // this exists is that the soft, opt-in path scored 0 writes in 24
    // conversations. It attaches a small model call to qualifying turns —
    // see config/default.yaml for the cost note.
    capture: z.object({
      enabled: z.boolean().default(true),
      /** A user message shorter than this cannot hold a durable fact. */
      minUserChars: z.number().int().positive().default(40),
      /** Runaway guard: extractions per conversation, not per turn. */
      maxPerConversation: z.number().int().positive().default(20),
      /** Each of the two messages is clipped to this before the model sees it. */
      maxInputChars: z.number().int().positive().default(4_000),
    }).default({}),
```

- [ ] **Step 4: Document the default in `config/default.yaml`**

```yaml
memory:
  capture:
    # A durable fact learned in a conversation is written to the vault without
    # anyone asking. This attaches a SMALL MODEL CALL to turns whose user
    # message is at least `minUserChars` long — set `enabled: false` to stop it.
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

- [ ] **Step 5: Run the test** — expect PASS.

---

### Task 2: The candidate schema

**Files:**
- Create: `src/modules/memory/capture/candidate-schema.ts`
- Test: `tests/modules/memory/capture-candidates.test.ts`

**Interfaces:**
- Produces: `CandidateNote`, `candidateSchema`, `candidateBatchSchema`,
  `MAX_CANDIDATES`. Tasks 3, 4 and 5 consume them.

**The one non-obvious rule:** `kind: 'project'` is **not** in the enum. M1 does
not rank project notes because there is no project→vault-folder mapping, so a
project note the extractor writes would be a file nothing ever reads. A surface
with no consumer is the failure this codebase keeps producing; when the mapping
lands, the enum grows with it.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { candidateBatchSchema, MAX_CANDIDATES } from '@modules/memory/capture/candidate-schema'

const ok = { kind: 'user', title: 'Language', summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.' }

describe('candidate schema', () => {
  it('accepts a well-formed batch', () => {
    expect(candidateBatchSchema.safeParse({ notes: [ok] }).success).toBe(true)
  })

  it('accepts an empty batch — "nothing worth keeping" is the common answer', () => {
    expect(candidateBatchSchema.safeParse({ notes: [] }).success).toBe(true)
  })

  it('requires why and howToApply on feedback, and only on feedback', () => {
    // A rule without its reason is an anecdote; the reason is what lets a
    // later reader decide whether it still applies.
    const bare = { kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked', body: 'x' }
    expect(candidateBatchSchema.safeParse({ notes: [bare] }).success).toBe(false)
    expect(candidateBatchSchema.safeParse({ notes: [{ ...bare, why: 'The owner decides what enters history', howToApply: 'Ask before every commit' }] }).success).toBe(true)
    expect(candidateBatchSchema.safeParse({ notes: [ok] }).success).toBe(true)  // user needs neither
  })

  it('rejects project — M1 does not rank it, so nothing would read the file', () => {
    expect(candidateBatchSchema.safeParse({ notes: [{ ...ok, kind: 'project' }] }).success).toBe(false)
  })

  it('caps the batch', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, n) => ({ ...ok, title: `T${n}` }))
    expect(candidateBatchSchema.safeParse({ notes: many }).success).toBe(false)
  })

  it('bounds every string, because the model chooses them', () => {
    expect(candidateBatchSchema.safeParse({ notes: [{ ...ok, summary: 'x'.repeat(500) }] }).success).toBe(false)
    expect(candidateBatchSchema.safeParse({ notes: [{ ...ok, body: 'x'.repeat(20_000) }] }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail** — module not found.

- [ ] **Step 3: Implement**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/candidate-schema.ts
//
// The contract for what the extractor may return. Everything here is attacker-
// influenced text: the model writes it from conversation content, and the
// result becomes a file that is replayed into later system prompts. The schema
// is what fixes the SHAPE of that file even when its content is chosen by
// someone else.

import { z } from 'zod'

/** Two is a batch; more per turn means the extractor is inventing. */
export const MAX_CANDIDATES = 2

/**
 * `project` is absent on purpose. M1 does not rank project notes — there is no
 * project→vault-folder mapping — so a project note written here would be a
 * file nothing ever reads. The enum grows when the mapping does.
 */
export const CANDIDATE_KINDS = ['user', 'feedback', 'reference'] as const

const base = z.object({
  kind: z.enum(CANDIDATE_KINDS),
  title: z.string().min(3).max(120),
  summary: z.string().min(3).max(140),
  body: z.string().min(3).max(4_000),
  why: z.string().max(400).optional(),
  howToApply: z.string().max(400).optional(),
})

export const candidateSchema = base.refine(
  (n) => n.kind !== 'feedback' || (!!n.why?.trim() && !!n.howToApply?.trim()),
  { message: 'a feedback note must carry both why and howToApply' },
)

export const candidateBatchSchema = z.object({
  notes: z.array(candidateSchema).max(MAX_CANDIDATES).default([]),
})

export type CandidateNote = z.infer<typeof base>
```

- [ ] **Step 4: Run the test** — expect PASS.

---

### Task 3: The gate

**Files:**
- Create: `src/modules/memory/capture/capture-gate.ts`
- Test: `tests/modules/memory/capture-gate.test.ts`

**Interfaces:**
- Consumes: the config block from Task 1.
- Produces: `shouldExtract(input): GateVerdict` and
  `countExtractions(db, conversationId): number`. Task 5 consumes both.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { shouldExtract } from '@modules/memory/capture/capture-gate'

const cfg = { enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4000 }
const long = 'The owner wants every commit to be asked about first, always.'

describe('the capture gate', () => {
  it('lets a substantial turn through', () => {
    expect(shouldExtract({ config: cfg, userMessage: long, alreadyExtracted: 0 }).run).toBe(true)
  })

  it('skips a short acknowledgement without knowing any language', () => {
    // "mehet", "ok", "igen" — four of the owner's last messages in the session
    // that produced this feature. No keyword list, no language assumption.
    for (const short of ['ok', 'mehet', 'igen', 'yes', 'go ahead']) {
      const verdict = shouldExtract({ config: cfg, userMessage: short, alreadyExtracted: 0 })
      expect(verdict.run).toBe(false)
      expect(verdict.reason).toBe('too-short')
    }
  })

  it('obeys the switch', () => {
    expect(shouldExtract({ config: { ...cfg, enabled: false }, userMessage: long, alreadyExtracted: 0 }))
      .toEqual({ run: false, reason: 'disabled' })
  })

  it('stops at the per-conversation cap', () => {
    const verdict = shouldExtract({ config: cfg, userMessage: long, alreadyExtracted: 20 })
    expect(verdict).toEqual({ run: false, reason: 'cap-reached' })
  })

  it('counts characters, not bytes — an accented message is not longer', () => {
    // 41 ASCII characters vs 41 Hungarian ones must gate identically; a byte
    // count would let one through and stop the other.
    const ascii = 'a'.repeat(41)
    const magyar = 'á'.repeat(41)
    expect(shouldExtract({ config: cfg, userMessage: ascii, alreadyExtracted: 0 }).run)
      .toBe(shouldExtract({ config: cfg, userMessage: magyar, alreadyExtracted: 0 }).run)
  })

  it('ignores surrounding whitespace when measuring', () => {
    expect(shouldExtract({ config: cfg, userMessage: `   ${'a'.repeat(20)}   `, alreadyExtracted: 0 }).run).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/capture-gate.ts
//
// When to spend a model call. Deliberately NOT a keyword list.
//
// A lexical gate — "correction words", "preference words" — would fire unevenly
// across the six languages this product ships, and this project has already
// paid twice for exactly that class of bug (JS `\b` is defined on ASCII word
// characters, so `\bűrlap` never matches "Űrlapelemek"; Hungarian plurals
// lengthen the stem vowel, so "minta" is not a prefix of "minták"). It would
// also be guessing at meaning, which is the model's half of this design.
//
// What is left is one length check, which needs no language knowledge at all.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export interface CaptureConfig {
  enabled: boolean
  minUserChars: number
  maxPerConversation: number
  maxInputChars: number
}

export type GateReason = 'ok' | 'disabled' | 'too-short' | 'cap-reached'
export interface GateVerdict { run: boolean; reason: GateReason }

export interface GateInput {
  config: CaptureConfig
  userMessage: string
  alreadyExtracted: number
}

export function shouldExtract({ config, userMessage, alreadyExtracted }: GateInput): GateVerdict {
  if (!config.enabled) return { run: false, reason: 'disabled' }
  if (alreadyExtracted >= config.maxPerConversation) return { run: false, reason: 'cap-reached' }
  // [...str] counts code points, not UTF-16 units and not bytes: an accented
  // message must gate identically to an ASCII one of the same length.
  if ([...userMessage.trim()].length < config.minUserChars) return { run: false, reason: 'too-short' }
  return { run: true, reason: 'ok' }
}

/** How many extractions this conversation has already produced. */
export function countExtractions(db: EyasDb, conversationId: string): number {
  try {
    const row = (db.all(sql`SELECT COUNT(*) AS n FROM memory_capture_runs
      WHERE conversation_id = ${conversationId}`) as Array<{ n: number }>)[0]
    return Number(row?.n ?? 0)
  } catch {
    // No table yet is the same as no extractions.
    return 0
  }
}
```

Add the `memory_capture_runs` table to `src/modules/memory/schema.ts`
(`id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
notes_written INTEGER NOT NULL DEFAULT 0, skipped_reason TEXT, created_at TEXT
NOT NULL DEFAULT (datetime('now'))`) plus an index on `conversation_id`. It is
both the cap's counter and the only way to answer "how often does the gate
actually fire" without guessing.

- [ ] **Step 4: Run the test** — expect PASS.

---

### Task 4: The note writer

**Files:**
- Create: `src/modules/memory/capture/note-writer.ts`
- Test: `tests/modules/memory/note-writer.test.ts`

**Interfaces:**
- Consumes: `CandidateNote` (Task 2), `VaultService`, `VaultIndexer`, `EyasDb`.
- Produces: `createNoteWriter(deps).write(candidate): WriteOutcome` where
  `WriteOutcome = { action: 'created' | 'updated' | 'skipped'; path: string }`.
  Task 5 consumes it.

- [ ] **Step 1: Write the failing test**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createNoteWriter } from '@modules/memory/capture/note-writer'

let db: any, root: string, vault: any, indexer: any, writer: any

const candidate = (over = {}) => ({
  kind: 'user' as const, title: 'Working language',
  summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.', ...over,
})

beforeEach(() => {
  db = createMemoryDb(); createMemoryTables(db)
  root = mkdtempSync(join(tmpdir(), 'eyas-notewriter-'))
  vault = createVaultService(root)
  const wikilinks = createWikilinkService(db); wikilinks.init()
  indexer = createVaultIndexer(db, vault, wikilinks)
  writer = createNoteWriter({ db, vault, indexer })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('note writer', () => {
  it('writes a user note into semantic/ with kind and summary in frontmatter', () => {
    const out = writer.write(candidate())
    expect(out.action).toBe('created')
    expect(out.path).toBe('semantic/working-language.md')

    const entry = vault.read(out.path)!
    expect(entry.frontmatter.kind).toBe('user')
    expect(entry.frontmatter.summary).toBe('Answers in Hungarian')
    expect(entry.frontmatter.tier).toBe('semantic')
  })

  it('writes a feedback note into procedural/, with its reason', () => {
    const out = writer.write(candidate({
      kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked',
      body: 'Do not commit without being asked.',
      why: 'The owner decides what enters history', howToApply: 'Ask before every commit',
    }))
    expect(out.path).toBe('procedural/commits.md')
    const body = vault.read(out.path)!.content
    expect(body).toContain('The owner decides what enters history')
    expect(body).toContain('Ask before every commit')
  })

  it('updates the existing note instead of writing a second one', () => {
    writer.write(candidate())
    indexer.indexAll()
    const again = writer.write(candidate({ summary: 'Answers in Hungarian, always', body: 'Confirmed again.' }))

    expect(again.action).toBe('updated')
    expect(vault.listFiles().filter((f: string) => f.endsWith('.md'))).toHaveLength(1)
    const entry = vault.read(again.path)!
    expect(entry.frontmatter.summary).toBe('Answers in Hungarian, always')
    // History is appended, not overwritten: a later reader can see it was
    // reinforced rather than invented once.
    expect(entry.content).toContain('The owner works in Hungarian.')
    expect(entry.content).toContain('Confirmed again.')
  })

  it('indexes what it wrote, so the very next turn can see it', () => {
    const out = writer.write(candidate())
    const rows = db.all(sql`SELECT summary FROM vault_index WHERE path = ${out.path}`) as any[]
    expect(rows[0]?.summary).toBe('Answers in Hungarian')
  })

  it('sanitises before writing, never after', () => {
    // The file IS the artefact; a redaction applied on read would leave the
    // secret on disk and in the FTS index.
    const out = writer.write(candidate({ body: 'Reach the owner at owner@example.com about this.' }))
    expect(vault.read(out.path)!.content).not.toContain('owner@example.com')
  })

  it('refuses a title that would escape the vault', () => {
    const out = writer.write(candidate({ title: '../../etc/passwd' }))
    expect(out.path.startsWith('semantic/')).toBe(true)
    expect(out.path).not.toContain('..')
  })

  it('does not collide two different notes onto one slug', () => {
    writer.write(candidate({ title: 'Language' }))
    indexer.indexAll()
    const second = writer.write(candidate({ title: 'Language', summary: 'Unrelated fact about builds', body: 'Builds run on Bun.' }))
    // Same slug, genuinely different note: it must land somewhere of its own.
    expect(second.action === 'created' ? second.path : '').not.toBe('semantic/language.md')
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement `note-writer.ts`**

Responsibilities, in order, with the reason each exists:

1. **Slug** from the title: lowercase, NFKD, non-word → `-`, collapse, clip to
   60. Then `basename()` the result and reject any `..` — a title is model
   output and the vault write takes a relative path.
2. **Folder** from the kind: `feedback` → `procedural/`, everything else →
   `semantic/`. The vault's `tier` frontmatter follows the folder.
3. **Dedup** against `vault_fts` on `title` — an exact slug hit is an update; a
   strong FTS hit whose stored `summary` is materially the same is an update;
   anything else is a new file. A same-slug-different-content candidate gets
   `-2`, because silently merging two unrelated facts is worse than two files.
4. **Privacy** — sanitise `summary` and `body` before serialising, on the way
   in, because the file is the artefact and an FTS row is built from it.
   **The privacy module publishes nothing reusable today**: it exports
   `createScannerChain`, `applyPolicy` and `sanitizeText`, but only wires them
   into `wrapGateway`. Rather than rebuilding the rule resolution here, add to
   `src/modules/privacy/index.ts`, inside `onStart`, next to the existing chain:

   ```ts
   // A second consumer is what justifies publishing this: durable-memory
   // capture writes model-extracted conversation text to disk, and a
   // redaction applied on read would leave the secret in the file and in
   // the FTS index.
   ;(ctx as any).privacySanitize = async (text: string): Promise<string> => {
     const matches = await chain.scan(text)
     if (matches.length === 0) return text
     return sanitizeText(text, matches, applyPolicy(text, matches, rules).actions)
   }
   ```

   The note writer takes it as an optional dep and, when it is absent, writes
   the text unchanged — a self-hosted build without the privacy module must
   still capture, and the test pins both branches.
5. **Body** = the candidate body, plus, for `feedback`, a `**Why:**` and a
   `**How to apply:**` line. On an update, append the new body under a dated
   bullet rather than replacing it.
6. **Write** through `vault.write(path, frontmatter, content)` and then
   `indexer.indexAll()` — the only index entry point this codebase has. It
   hashes and skips unchanged files, so the cost is a stat per note, and the
   note must be indexed now: the next turn's index reads the table, not the disk.

- [ ] **Step 4: Run the test** — expect PASS, all eight cases.

---

### Task 5: The extractor, and both call sites

**Files:**
- Create: `src/modules/memory/capture/capture-prompt.ts`, `src/modules/memory/capture/index.ts`
- Modify: `src/modules/memory/index.ts`, `src/modules/conversations/routes.ts`,
  `src/modules/agent/conversation-runner.ts`
- Test: `tests/modules/memory/capture-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `ctx.memoryCapture: (input: { conversationId, userMessage, assistantMessage }) => Promise<void>`.

**Non-negotiables for this task:**

- **It runs after the reply is delivered.** Interactive: after the SSE stream is
  drained, in the same post-turn block that collects workspace outputs.
  Background: after `handle?.complete(...)`. Never in the critical path — the
  owner waited 8 min 43 s for one turn already.
- **It never throws into the turn.** Its own try/catch, its own log line. A
  failed extraction is a missing note, not a failed conversation.
- **Every outcome writes a `memory_capture_runs` row**, including a skip and its
  reason. Without that, "how often does the gate fire" is unanswerable and the
  `minUserChars` default stays a guess forever.
- **The prompt carries the do-not-save list**, not only the agent's: nothing the
  repository already records, nothing that matters only inside this
  conversation, nothing an existing note already covers.
- **The two messages are clipped to `maxInputChars` each** before the model sees
  them.

- [ ] **Step 1: Write the failing test** — `capture-wiring.test.ts`, with a fake
  `complete` returning a JSON batch, covering: a qualifying turn writes a note
  and a run row; a short message writes a `too-short` run row and no note; a
  throwing `complete` leaves the turn intact and logs; the switch off produces
  no model call at all; the cap stops the twenty-first extraction; and the call
  happens after the assistant message is persisted, not before.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Write `capture-prompt.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/capture-prompt.ts
//
// The extractor's whole prompt, in one constant so a test can assert the
// do-not-save rules are actually present. Those rules are not decoration: they
// are the only thing between this feature and a vault that costs tokens on
// every turn to say nothing.

export const CAPTURE_SYSTEM_PROMPT = `You extract DURABLE FACTS from one exchange.

A durable fact is something still true and still useful in a month: who the
owner is, how they want to be worked with, a constraint that outlives this task.

Do NOT save:
- anything the repository already records (code structure, git history, past fixes, project config files)
- anything that only matters inside this conversation (what was just done, what comes next)
- a restatement of a fact an existing note already covers
- an event ("the owner asked for X today") — record the RULE, not the occurrence

Return JSON only, matching:
{"notes":[{"kind":"user|feedback|reference","title":"...","summary":"one line","body":"...","why":"...","howToApply":"..."}]}

- "kind": "user" = who the owner is; "feedback" = how to work; "reference" = a durable external fact.
- "why" and "howToApply" are REQUIRED for "feedback" and omitted otherwise.
- "summary" is the single line that will be shown in every future prompt. Make it stand alone.
- Return {"notes":[]} when nothing qualifies. That is the common and correct answer.`

export function buildCaptureUser(userMessage: string, assistantMessage: string, maxChars: number): string {
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars)}\n[clipped]` : s)
  return [
    'USER MESSAGE:', clip(userMessage), '', 'ASSISTANT REPLY:', clip(assistantMessage),
  ].join('\n')
}
```

- [ ] **Step 4: Write `capture/index.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/index.ts
//
// Deterministic WHEN, model-decided WHAT. This function is called after the
// reply has already reached the user, and it may not throw into that turn.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { candidateBatchSchema } from './candidate-schema.js'
import { CAPTURE_SYSTEM_PROMPT, buildCaptureUser } from './capture-prompt.js'
import { countExtractions, shouldExtract, type CaptureConfig } from './capture-gate.js'
import type { NoteWriter } from './note-writer.js'

export interface CaptureDeps {
  db: EyasDb
  config: () => CaptureConfig
  complete: (args: { system: string; user: string }) => Promise<string>
  writer: NoteWriter
  logger: { warn: (o: unknown, m?: string) => void; debug?: (o: unknown, m?: string) => void }
}

export interface CaptureInput {
  conversationId: string
  userMessage: string
  assistantMessage: string
}

function recordRun(db: EyasDb, conversationId: string, written: number, skipped: string | null): void {
  try {
    db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written, skipped_reason)
      VALUES (${conversationId}, ${written}, ${skipped})`)
  } catch { /* the counter is diagnostics; losing a row must not fail a capture */ }
}

export function createMemoryCapture(deps: CaptureDeps) {
  return async function capture(input: CaptureInput): Promise<void> {
    try {
      const config = deps.config()
      const verdict = shouldExtract({
        config,
        userMessage: input.userMessage,
        alreadyExtracted: countExtractions(deps.db, input.conversationId),
      })
      if (!verdict.run) {
        // Skips are recorded too. Without them, "how often does the gate fire"
        // is unanswerable and minUserChars stays a guess forever.
        if (verdict.reason !== 'disabled') recordRun(deps.db, input.conversationId, 0, verdict.reason)
        return
      }

      const raw = await deps.complete({
        system: CAPTURE_SYSTEM_PROMPT,
        user: buildCaptureUser(input.userMessage, input.assistantMessage, config.maxInputChars),
      })

      let parsed
      try {
        parsed = candidateBatchSchema.safeParse(JSON.parse(raw.trim()))
      } catch {
        parsed = { success: false as const, error: new Error('not JSON') as any }
      }
      if (!parsed.success) {
        // A dropped batch, never a retry loop: the turn is over and the user is
        // not waiting for this.
        deps.logger.warn({ conversationId: input.conversationId }, 'Memory capture: unusable extractor output, batch dropped')
        recordRun(deps.db, input.conversationId, 0, 'unparsable')
        return
      }

      let written = 0
      for (const note of parsed.data.notes) {
        const outcome = await deps.writer.write(note)
        if (outcome.action !== 'skipped') written++
      }
      recordRun(deps.db, input.conversationId, written, null)
    } catch (err) {
      // The reply has already been delivered. A failed capture is a missing
      // note, never a failed conversation.
      deps.logger.warn({ err, conversationId: input.conversationId }, 'Memory capture failed')
    }
  }
}
```

- [ ] **Step 5: Publish and wire both call sites** (see the M1 plan's Task 4 for
  the shape: the runner has `deps.db`, the route gets a lazy accessor).

- [ ] **Step 6: Run the test, then the full suite and diff against the baseline.**

---

### Task 6: Documentation

- [ ] **Step 1:** Architecture § 13 — extend the durable-memory subsection with
  the capture half: the owner's every-conversation decision, why the gate is
  structural rather than lexical, and the `memory_capture_runs` table as the
  measurement that makes `minUserChars` tunable instead of permanent.
- [ ] **Step 2:** CHANGELOG — a `### Memory that fills itself` section.
- [ ] **Step 3:** The six `knowledge/memory.md` pages — replace the "Nothing
  writes these automatically yet" paragraph, which is what this phase makes
  false, and say plainly that a model call is attached to qualifying turns and
  how to switch it off.
- [ ] **Step 4:** `bun run docs:build`.

---

## Phase gate

Stop here. Before M3, read the `memory_capture_runs` rows: if the gate fires on
nearly every turn, `minUserChars` is too low and the cost argument in this plan
was wrong. That table exists so the answer is measured rather than argued.
