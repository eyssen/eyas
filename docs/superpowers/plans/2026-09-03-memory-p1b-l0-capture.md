# Memory P1b — L(−1)/L0 Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user message, assistant reply, background-run output and (opt-in) tool result EYAS persists is captured at the persistence layer with a ULID, buffered per task, and flushed exactly once into the L0 raw layer (`memory_raw` + zstd `memory_blob` + contentless FTS + structural tags) — with zero model calls and no dependency on module boot order.

**Architecture:** Three persistence hooks (`chatService.addMessage`, `EventStore.append` for `LlmResponse`, the tool executor's `logExecution`) call one process-global, bounded, boot-order-safe bridge (`captureUnit`). The memory module's `onStart` builds `MemoryIngest` (per-conversation buffers; flush on task close / 30-min idle / ~8k-token chunk; `INSERT OR IGNORE` on the capture-time ULID for exactly-once; blob keyed `(content_hash, shred_partition_id)` with `ref_count`), attaches it to the bridge (draining anything captured before memory started), publishes it as `ctx.memoryIngest`, and registers a one-minute scheduler sweep `memory.v2.flush` for idle detection. Extraction (P1c) subscribes through `ingest.onFlushed`; migration (P1d) writes the same tables through the same schema.

**Tech Stack:** TypeScript 5.9 strict/ESM, Bun 1.3.10 (`bun:sqlite`) with Node 22 fallback (`better-sqlite3`), Drizzle raw `sql` templates, SQLite FTS5 (`unicode61 remove_diacritics 2`), zstd via `src/shared/zstd.ts` (P1a), Pino, Vitest (`bun vitest run <path>`). **No new dependencies in this plan.**

**Spec:** `docs/superpowers/specs/2026-09-03-sovereign-layered-memory-design.md` (§3 principles, §4 layer table, §5 data model, §6 write path, §15 Phase 1, §17 risks) as corrected by `docs/superpowers/specs/2026-09-03-memory-p0-spike-report.md` (§2 #13 zstd shim, #21 migration corrections, §6 spec changes — blob acceptance rewritten to "two raw rows, two blobs, one `content_hash`"). Companion: `docs/superpowers/specs/2026-09-03-memory-gap-analysis.md` (§A rows 1, 2, 14; §E-1, §E-5).

**Depends on:** plan `p1a-foundation` (provides `src/modules/memory/v2/schema.ts` `createMemoryV2Tables`/`allocateRid`, `src/shared/zstd.ts`, `src/core/db/sqlite-capabilities.ts`, `src/modules/memory/v2/instance.ts`, the `memory.engine`/`memory.l0` Zod config). Task 1 below is the gate that proves those contracts are present before anything else is built. **Do not** implement extraction (plan `p1c-extraction`) or migration/CLI (plan `p1d-migration-cli`) here; they consume `ingest.onFlushed` and the tables this plan fills.

## Global Constraints

- Spec §1: **TypeScript/Bun (Node 22 fallback), single process, embedded SQLite via Drizzle, MIT-compatible dependencies only, VPS/K8s pods without GPU, no local LLM assumed (CLI-only providers such as Claude Code or Grok CLI may be the only model), six UI languages, the existing board (a task is a conversation) and scheduler.**
- Spec §3: L0 is immutable and complete; the model never decides what is stored; degraded mode (zero model calls) is the default path; `project`/`task` tags come from the board at capture, never inferred; ULID, `content_hash`, HLC, `origin_instance_id`, `trust_tier` on every row from day one.
- Spec §6 flush contract: idempotency keyed on the capture-time ULID (`INSERT OR IGNORE` on `id`), never on content; zstd level 3; blob identity = SHA-256 of the **uncompressed** bytes; trust at capture: owner conversation text → `owner`, tool results → `ingested`.
- Spike §2 #21(iv): `memory_blob` keeps the composite key `(content_hash, shred_partition_id)`; acceptance = "two identical messages in two conversations → two raw rows, two blobs, one `content_hash`; within one conversation → two raw rows, one blob, `ref_count = 2`". `ref_count` is bumped only when the raw row was actually inserted.
- Spike §2 #21(ii)/(iii): background outputs join `agent_events.session_id = agent_sessions.id → agent_sessions.conversation_id`, `actor = agent_sessions.agent_id`; all new timestamps are INTEGER epoch ms; `CriticVerdict` is never captured.
- Repo rules: English code and comments; Pino via `ctx.logger` / injected logger, **never `console.log`**; Zod for config (the `memory.l0` schema entry lives in P1a — this plan reads it with the same defaults); `/api/v1/` untouched (no routes here); no user-facing strings are added (log lines are not UI, so no i18n keys); version stays **0.8.22-beta** — do not touch `package.json`, `CHANGELOG.md`, or any version string.
- Git: **an agent executing this plan never runs `git commit`, `git push`, or creates a branch.** Each task ends with the commit command the owner runs by hand; stop at that step and hand it over. No `Co-Authored-By` lines.
- Every hook added here is **fail-open**: a capture failure is logged (or swallowed at the hook, logged at the ingest) and never changes the return value or throws into `addMessage`, `EventStore.append`, or the tool executor.
- Tests: new files under `tests/modules/memory/v2/**.test.ts`; use `createMemoryDb()` / `createTestDb()` / `getRawFromDrizzle()` / `insertTestOwner()` from `tests/helpers/test-db.ts`; run one file with `bun vitest run <path>`; type-check with `bun run lint` (`tsc --noEmit`).

---

## File structure

| Path | Responsibility |
|---|---|
| `src/modules/memory/v2/ingest-bridge.ts` (create) | Process-global L(−1) bridge: `captureUnit`, bounded 5 000-unit pre-attach queue (drop-oldest + counter, warned once at attach), `attachIngest`/`detachIngest`, `pendingUnits`, test reset. Exports `CaptureUnit`, `RawSourceType`, `TrustTier`. |
| `src/modules/memory/v2/language.ts` (create) | Dependency-free `detectLanguage` for en/hu/de/es/fr/tlh/und (marker words + diacritic/Klingon-orthography bonuses). |
| `src/modules/memory/v2/scope.ts` (create) | `resolveConversationScope(db, conversationId)` — project (D2 applied), project type via `projects.type_id`, user, agent, god-mode flag, parent; tolerant of partial test schemas. |
| `src/modules/memory/v2/ingest.ts` (create) | `createMemoryIngest`: per-conversation buffers, chunk/idle/close/manual flush, exactly-once flush transaction (blob → rid → raw → FTS → tags), assistant-duplicate suppression, tool-result byte cap, `onFlushed`, `flushAll`, `sha256Hex`. |
| `src/modules/memory/v2/flush-job.ts` (create) | `registerFlushJob(scheduler, ingest)` — `memory.v2.flush` handler + idempotent one-minute cron job. |
| `src/modules/memory/v2/wire.ts` (create) | `wireL0Capture(ctx)` — zstd init, ingest creation, bridge attach, flush job, bus subscriptions (`eyas.conversations.closed`, closed-stage `stage_changed`). Called from `memory/index.ts`. **Plan p1c (its Task 11) edits this file afterwards:** it inserts the one `ingest.onFlushed(...)` → `runExtraction` subscription between `createMemoryIngest({ … })` and `attachIngest(ingest, logger)`, and adds two optional fields (`engine?`, `extractInLegacy?`) to `L0WireConfig`. |
| `src/modules/conversations/l0-capture.ts` (create) | `captureConversationMessage(db, message)` — maps a persisted `ConversationMessage` to a `CaptureUnit`. |
| `src/modules/event-store/l0-capture.ts` (create) | `captureLlmResponse(db, sessionId, seq, ts, payload)` — session→conversation join, empty-turn skip. |
| `src/modules/tools/l0-capture.ts` (create) | `captureToolResult(db, entry, isEnabled)` — `tool_result` unit, `ingested` trust, gated by `memory.l0.captureToolResults`. |
| `src/modules/conversations/conversation-service.ts` (modify `addMessage`, lines 565–578) | Call `captureConversationMessage` after the insert with the recovered row — covers all 14 `addMessage` call sites including God Mode. |
| `src/modules/event-store/event-store.ts` (modify imports lines 5–11 and `append`, lines 86–108) | Call `captureLlmResponse` after a successful `LlmResponse` insert. |
| `src/modules/tools/tool-executor.ts` (modify `ExecutionLogEntry` lines 24–33 and every `options.logExecution?.({` literal) | Add `sessionId?: string` and populate it from `ctx?.sessionId`. |
| `src/modules/tools/index.ts` (modify `logExecution`, lines 60–65) | Call `captureToolResult` after the `tool_executions` insert. |
| `src/modules/memory/index.ts` (modify imports, `onStart` after line 268, `onStop` lines 392–395) | `wireL0Capture` → `ctx.memoryIngest`; `flushAll('manual')` on stop. (Plan p1c's Task 11 later extends the `config:` closure of this block with `engine` / `extractInLegacy`; plan p1d's Task 13 later replaces the "Start vault file watcher" block below it.) |
| `tests/modules/memory/v2/helpers.ts` (create) | `makeV2Db()`, `makeUnit()`, `silentLogger`, `testIngestConfig`. |
| `tests/modules/memory/v2/*.test.ts` (create) | One test file per task (listed in each task). |

---

### Task 1: Contract gate — the P1a tables this plan writes into

**Files:**
- Create: `tests/modules/memory/v2/helpers.ts`
- Test: `tests/modules/memory/v2/l0-schema-contract.test.ts`

**Interfaces:**
- Consumes (from P1a): `createMemoryV2Tables(db: EyasDb, caps: SqliteCapabilities): void` and `allocateRid(db, itemType, id, createdAt): number` from `@modules/memory/v2/schema`; `probeSqliteCapabilities(rawDb, logger?): SqliteCapabilities` from `@core/db/sqlite-capabilities`.
- Produces: `makeV2Db(): { db: any; caps: SqliteCapabilities }`, `makeUnit(overrides?): CaptureUnit`, `silentLogger`, `testIngestConfig` — every later test in this plan imports these from `./helpers`.

This task has no implementation step on purpose: it is the gate that proves P1a's contract exists with the exact column names the ingest INSERTs use. If any assertion fails, **stop and reconcile with p1a-foundation** — do not "fix" the schema from this plan.

- [ ] **Step 1: Write the shared test helpers**

```ts
// tests/modules/memory/v2/helpers.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { generateId } from '@shared/crypto'
import type { CaptureUnit } from '@modules/memory/v2/ingest-bridge'
import type { MemoryIngestConfig } from '@modules/memory/v2/ingest'

/** A pino-shaped logger that records nothing. */
export const silentLogger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return silentLogger },
}

/** Mirrors the config/schema.ts defaults for memory.l0. */
export const testIngestConfig: MemoryIngestConfig = {
  toolResultMaxBytes: 8_192,
  idleFlushMinutes: 30,
  chunkTokens: 8_000,
}

/** Bare in-memory DB with only the memory v2 tables. */
export function makeV2Db(): { db: any; caps: SqliteCapabilities } {
  const db = createMemoryDb()
  const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
  createMemoryV2Tables(db, caps)
  return { db, caps }
}

export function makeUnit(overrides: Partial<CaptureUnit> = {}): CaptureUnit {
  return {
    id: generateId(),
    sourceType: 'user_message',
    actor: 'owner-1',
    conversationId: 'conv-1',
    projectId: null,
    projectTypeId: null,
    occurredAtMs: Date.now(),
    content: 'The owner always answers in Hungarian, that is how the work is done.',
    trustTier: 'owner',
    ...overrides,
  }
}
```

- [ ] **Step 2: Write the contract test**

```ts
// tests/modules/memory/v2/l0-schema-contract.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Gate for plan p1b: the ingest INSERTs below name these columns literally.
// A failure here means p1a-foundation's schema and this plan disagree —
// reconcile the schema plan, never patch columns from here.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryV2Tables, allocateRid } from '@modules/memory/v2/schema'
import { makeV2Db } from './helpers'

const columnsOf = (db: any, table: string): string[] =>
  (db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map((c) => c.name)

describe('memory v2 schema contract (p1a → p1b)', () => {
  it('creates the L0 tables with the columns the ingest writes', () => {
    const { db } = makeV2Db()
    expect(columnsOf(db, 'memory_item')).toEqual(expect.arrayContaining(['rid', 'item_type', 'id', 'created_at']))
    expect(columnsOf(db, 'memory_raw')).toEqual(expect.arrayContaining([
      'rid', 'id', 'content_hash', 'origin_instance_id', 'hlc_physical_ms', 'hlc_logical', 'revision', 'created_at',
      'shred_partition_id', 'source_type', 'actor', 'conversation_id', 'project_id', 'project_type_id',
      'occurred_at', 'trust_tier', 'dek_id', 'tombstoned', 'meta_json',
    ]))
    expect(columnsOf(db, 'memory_blob')).toEqual(expect.arrayContaining([
      'content_hash', 'shred_partition_id', 'compressed_blob', 'byte_length', 'ref_count',
    ]))
    expect(columnsOf(db, 'memory_tag')).toEqual(expect.arrayContaining(['memory_rid', 'memory_type', 'tag_type', 'tag_value']))
  })

  it('creates the contentless FTS table when FTS5 is available', () => {
    const { db, caps } = makeV2Db()
    const rows = db.all(sql`SELECT name FROM sqlite_master WHERE name = 'memory_raw_fts'`) as any[]
    expect(rows.length).toBe(caps.fts5 ? 1 : 0)
  })

  it('is idempotent and allocateRid hands out increasing integers bound to the ULID', () => {
    const { db, caps } = makeV2Db()
    createMemoryV2Tables(db, caps)
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1_700_000_000_000)
    const b = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1_700_000_000_001)
    expect(Number.isInteger(a)).toBe(true)
    expect(b).toBeGreaterThan(a)
    const row = (db.all(sql`SELECT item_type, id FROM memory_item WHERE rid = ${a}`) as any[])[0]
    expect(row).toEqual({ item_type: 'raw', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA' })
  })
})
```

- [ ] **Step 3: Run the gate**

Run: `bun vitest run tests/modules/memory/v2/l0-schema-contract.test.ts`
Expected: PASS (3 tests). If it fails with "Cannot find module '@modules/memory/v2/schema'" or a missing column, p1a-foundation has not landed — stop here.

- [ ] **Step 4: Commit**

```bash
git add tests/modules/memory/v2/helpers.ts tests/modules/memory/v2/l0-schema-contract.test.ts
git commit -m "test(memory): gate p1b on the v2 schema contract from p1a"
```

---

### Task 2: Language heuristic (en/hu/de/es/fr/tlh/und)

**Files:**
- Create: `src/modules/memory/v2/language.ts`
- Test: `tests/modules/memory/v2/language.test.ts`

**Interfaces:**
- Produces: `export type Language = 'en'|'hu'|'de'|'es'|'fr'|'tlh'|'und'`; `export function detectLanguage(text: string): Language`. Used by the ingest (Task 5) for the `language` tag; P1c may reuse it for gists.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/language.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { detectLanguage } from '@modules/memory/v2/language'

describe('detectLanguage — dependency-free six-language heuristic', () => {
  it('recognises the six UI languages from ordinary sentences', () => {
    expect(detectLanguage('The quick brown fox jumps over the lazy dog and then it sleeps.')).toBe('en')
    expect(detectLanguage('Kérlek, mindig magyarul válaszolj nekem, és ne felejtsd el a hosszú ékezeteket.')).toBe('hu')
    expect(detectLanguage('Bitte antworte mir immer auf Deutsch und vergiss nicht die Umlaute.')).toBe('de')
    expect(detectLanguage('Por favor, responde siempre en español y no olvides los acentos.')).toBe('es')
    expect(detectLanguage("S'il vous plaît, répondez toujours en français et n'oubliez pas les accents.")).toBe('fr')
    expect(detectLanguage("tlhIngan Hol Dajatlh'a'? Qapla'! jIyaj 'ej maSuv.")).toBe('tlh')
  })

  it('uses Hungarian-only letters as a strong signal even without marker words', () => {
    expect(detectLanguage('árvíztűrő tükörfúrógép')).toBe('hu')
  })

  it('returns und for empty, too-short or signal-free text', () => {
    expect(detectLanguage('')).toBe('und')
    expect(detectLanguage('ok')).toBe('und')
    expect(detectLanguage('x = 42; foo(bar)')).toBe('und')
  })

  it('does not mistake camelCase identifiers for Klingon', () => {
    // EYAS transcripts are full of code. A word-internal capital alone must not
    // elect 'tlh' — before this guard, all three of these scored Klingon.
    expect(detectLanguage('Please rename getUserById to fetchUserById before merging.')).toBe('und')
    expect(detectLanguage('The build failed because parseConfig returned null, so I added a guard.')).toBe('und')
    expect(detectLanguage('I updated resolveConversationScope and the tests still pass, but captureUnit is slow.')).toBe('en')
    // …and genuine Klingon still resolves, with or without the "tlh" cluster.
    expect(detectLanguage("Qapla'! jIyaj 'ej maSuv batlh.")).toBe('tlh')
  })

  it('never throws on odd input', () => {
    expect(() => detectLanguage('\x00�'.repeat(50))).not.toThrow()
    expect(detectLanguage('🙂 🙃 🙂')).toBe('und')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/language.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/language'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/language.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Language tag for L0 rows. Deliberately dependency-free and cheap: marker
// words plus a few orthographic signals. It only has to separate the six UI
// languages from each other; anything else (code, emoji, one-word turns)
// is 'und'. Spec §6: "Language detection (hu/en/de/es/fr/tlh) is a
// dependency-free heuristic."

export type Language = 'en' | 'hu' | 'de' | 'es' | 'fr' | 'tlh' | 'und'

type Scored = Exclude<Language, 'und'>

const MARKERS: Record<Scored, ReadonlySet<string>> = {
  en: new Set(['the', 'and', 'is', 'are', 'was', 'were', 'you', 'that', 'this', 'with', 'for', 'not', 'have', 'has', 'will', 'from', 'your', 'please', 'always', 'answer', 'then', 'over']),
  hu: new Set(['és', 'a', 'az', 'hogy', 'nem', 'van', 'egy', 'ez', 'meg', 'csak', 'mert', 'kérlek', 'mindig', 'magyarul', 'ne', 'el', 'majd', 'vagy', 'lesz', 'volt', 'már', 'még', 'nekem']),
  de: new Set(['und', 'der', 'die', 'das', 'ist', 'nicht', 'ich', 'mit', 'ein', 'eine', 'auf', 'bitte', 'immer', 'sie', 'wir', 'auch', 'für', 'von', 'dem', 'den', 'zu', 'dass', 'mir']),
  es: new Set(['el', 'la', 'los', 'las', 'que', 'de', 'y', 'es', 'en', 'por', 'favor', 'siempre', 'no', 'una', 'un', 'con', 'para', 'como', 'pero', 'más', 'también']),
  fr: new Set(['le', 'la', 'les', 'est', 'et', 'des', 'une', 'un', 'pas', 'vous', 'nous', 'pour', 'dans', 'que', 'qui', 'sur', 'avec', 'toujours', 'plaît', 'merci', 'ne', 'ce', 'cette', 'je']),
  tlh: new Set(["'ej", "'ach", 'jih', 'soh', 'ghah', "qapla'", 'tlhingan', 'hol', 'nuq', 'vaj', 'hoch', "'oh", 'mah', 'yaj', 'jang', "qar'a'", "chay'", 'nuqneh', "majqa'", "ghu'", 'batlh', 'suv', 'pagh']),
}

const LANGS: Scored[] = ['en', 'hu', 'de', 'es', 'fr', 'tlh']

/** Letters that occur in exactly one of the six orthographies. */
function orthographyBonus(text: string, score: Record<Scored, number>): void {
  if (/[őűŐŰ]/u.test(text)) score.hu += 3
  if (/ß/u.test(text)) score.de += 3
  if (/[ñ¿¡]/u.test(text)) score.es += 3
  if (/[œŒ]/u.test(text) || /[çÇ]/u.test(text)) score.fr += 2
}

/**
 * Klingon romanisation: a capital inside a word (tlhIngan, jIyaj, maSuv) or the
 * "tlh" cluster. The word-internal capital is NOT Klingon evidence on its own —
 * in this product's transcripts `getUserById` and `parseConfig` are ordinary
 * English — so it only scores once something Klingon-specific is already
 * present: a marker word (counted before this runs) or the "tlh" cluster.
 */
function klingonBonus(rawTokens: string[], score: Record<Scored, number>): void {
  let innerCapital = 0
  let cluster = 0
  for (const tok of rawTokens) {
    if (/^[a-z']+[A-Z][A-Za-z']*$/.test(tok)) innerCapital += 2
    if (/tlh/i.test(tok)) cluster += 2
  }
  const corroborated = cluster > 0 || score.tlh > 0
  score.tlh += cluster
  if (corroborated) score.tlh += innerCapital
}

export function detectLanguage(text: string): Language {
  if (!text) return 'und'
  const rawTokens = text.split(/[^\p{L}\p{N}']+/u).filter((t) => t.length > 0)
  if (rawTokens.length < 2) return 'und'
  const score: Record<Scored, number> = { en: 0, hu: 0, de: 0, es: 0, fr: 0, tlh: 0 }
  for (const raw of rawTokens) {
    const tok = raw.toLowerCase()
    for (const lang of LANGS) if (MARKERS[lang].has(tok)) score[lang] += 1
  }
  orthographyBonus(text, score)
  klingonBonus(rawTokens, score)
  let best: Scored = 'en'
  let bestScore = -1
  let second = -1
  for (const lang of LANGS) {
    const s = score[lang]
    if (s > bestScore) { second = bestScore; bestScore = s; best = lang }
    else if (s > second) second = s
  }
  if (bestScore < 2 || bestScore === second) return 'und'
  return best
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/language.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/language.ts tests/modules/memory/v2/language.test.ts
git commit -m "feat(memory): dependency-free six-language heuristic for L0 tags"
```

---

### Task 3: Ingest bridge — the boot-order-safe L(−1) entry point

**Files:**
- Create: `src/modules/memory/v2/ingest-bridge.ts`
- Test: `tests/modules/memory/v2/ingest-bridge.test.ts`

**Interfaces:**
- Produces (contract names): `RawSourceType`, `TrustTier`, `CaptureUnit`, `captureUnit(unit): void`, `attachIngest(ingest: MemoryIngest, logger?): void`, `detachIngest(): void`, `pendingUnits(): number`. Extras: `BRIDGE_MAX_PENDING = 5000`, `droppedUnits(): number`, `disableIngestBridge(): void` (config `memory.l0.enabled=false`: drop everything, buffer nothing), `resetIngestBridge(): void` (tests only).
- Consumes: `MemoryIngest` type from `./ingest.js` (Task 5) — a type-only import, so this file compiles before Task 5 exists only if you add the interface first. **Order of work:** write `ingest.ts` with just its exported types (Step 3 below includes that stub) — Task 5 fills in `createMemoryIngest`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/ingest-bridge.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The loader orders modules by hard dependencies only: conversations, tools
// and event-store persist on both sides of memory's onStart. The bridge is
// what makes a message captured BEFORE memory exists reach L0 anyway.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  captureUnit, attachIngest, detachIngest, pendingUnits, droppedUnits,
  disableIngestBridge, resetIngestBridge, BRIDGE_MAX_PENDING,
} from '@modules/memory/v2/ingest-bridge'
import { makeUnit } from './helpers'

function fakeIngest() {
  return {
    enqueue: vi.fn(),
    flushConversation: vi.fn(),
    sweepIdle: vi.fn(() => 0),
    onFlushed: vi.fn(),
    flushAll: vi.fn(() => 0),
    bufferedUnits: vi.fn(() => 0),
  }
}

beforeEach(() => resetIngestBridge())

describe('ingest bridge', () => {
  it('buffers units captured before memory starts and drains them, in order, on attach', () => {
    const a = makeUnit({ content: 'first' })
    const b = makeUnit({ content: 'second' })
    captureUnit(a)
    captureUnit(b)
    expect(pendingUnits()).toBe(2)

    const ingest = fakeIngest()
    const logger = { warn: vi.fn(), info: vi.fn() }
    attachIngest(ingest as any, logger)

    expect(pendingUnits()).toBe(0)
    expect(ingest.enqueue.mock.calls.map((c) => c[0].id)).toEqual([a.id, b.id])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('forwards directly once attached', () => {
    const ingest = fakeIngest()
    attachIngest(ingest as any)
    const u = makeUnit()
    captureUnit(u)
    expect(pendingUnits()).toBe(0)
    expect(ingest.enqueue).toHaveBeenCalledWith(u)
  })

  it('drops the oldest unit past the cap, counts the drops, and warns ONCE at attach', () => {
    const first = makeUnit({ content: 'oldest' })
    captureUnit(first)
    for (let i = 0; i < BRIDGE_MAX_PENDING; i++) captureUnit(makeUnit({ content: `u${i}` }))
    expect(pendingUnits()).toBe(BRIDGE_MAX_PENDING)
    expect(droppedUnits()).toBe(1)

    const ingest = fakeIngest()
    const logger = { warn: vi.fn(), info: vi.fn() }
    attachIngest(ingest as any, logger)
    expect(ingest.enqueue.mock.calls[0][0].id).not.toBe(first.id)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ dropped: 1, drained: BRIDGE_MAX_PENDING })
    expect(droppedUnits()).toBe(0)
  })

  it('never lets an ingest error reach the persistence hook', () => {
    const ingest = fakeIngest()
    ingest.enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    attachIngest(ingest as any)
    expect(() => captureUnit(makeUnit())).not.toThrow()
  })

  it('buffers again after detach', () => {
    attachIngest(fakeIngest() as any)
    detachIngest()
    captureUnit(makeUnit())
    expect(pendingUnits()).toBe(1)
  })

  it('drops everything silently when disabled by config', () => {
    captureUnit(makeUnit())
    disableIngestBridge()
    expect(pendingUnits()).toBe(0)
    captureUnit(makeUnit())
    expect(pendingUnits()).toBe(0)
  })

  it('forgets a stale drop count on disable, and counts a drain rejection even with no logger', () => {
    // A count left over from an earlier overflow must not resurface at the next
    // attach as "the buffer overflowed" for an attach that drained nothing.
    for (let i = 0; i <= BRIDGE_MAX_PENDING; i++) captureUnit(makeUnit())
    expect(droppedUnits()).toBe(1)
    disableIngestBridge()
    expect(droppedUnits()).toBe(0)
    const logger = { warn: vi.fn(), info: vi.fn() }
    attachIngest(fakeIngest() as any, logger)
    expect(logger.warn).not.toHaveBeenCalled()

    // A unit the ingest rejects while draining is lost. L0 is meant to be
    // complete, so it must be visible even when the caller passed no logger.
    resetIngestBridge()
    captureUnit(makeUnit())
    const hostile = fakeIngest()
    hostile.enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    attachIngest(hostile as any)
    expect(droppedUnits()).toBe(1)

    // Detaching forgets it too, for the same reason disabling does — otherwise
    // a rejection from this cycle inflates the NEXT attach's overflow report.
    detachIngest()
    expect(droppedUnits()).toBe(0)
    for (let i = 0; i <= BRIDGE_MAX_PENDING; i++) captureUnit(makeUnit())
    const logger2 = { warn: vi.fn(), info: vi.fn() }
    attachIngest(fakeIngest() as any, logger2)
    expect(logger2.warn.mock.calls[0][0]).toMatchObject({ dropped: 1, rejected: 0, drained: BRIDGE_MAX_PENDING })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/ingest-bridge.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/ingest-bridge'`.

- [ ] **Step 3: Write the bridge and the ingest type stub**

```ts
// src/modules/memory/v2/ingest-bridge.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L(-1) capture bridge — the ONE function every persistence hook calls.
//
// Why a process-global: `ModuleLoader` orders modules by hard dependencies
// only; conversations, tools and event-store all persist before memory's
// onStart on every real boot (src/core/bootstrap.ts registration order), and
// the hooks live in files that have no ctx. Units captured before
// `attachIngest` are held in a bounded queue and drained on attach — the
// same lazy-resolution idea as conversations/memory-hooks.ts, without a
// dynamic import on the hot path. Nothing here ever throws to a caller.

import type { MemoryIngest } from './ingest.js'

export type RawSourceType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_result'
  | 'document'
  | 'r6_sync'
  | 'legacy_episodic'

export type TrustTier = 'owner' | 'derived' | 'ingested' | 'peer' | 'quarantined'

export interface CaptureUnit {
  /** Capture-time ULID (generateId()). The exactly-once key of the flush. */
  id: string
  sourceType: RawSourceType
  actor: string
  /** = task (spec §9: a task is a conversation). */
  conversationId: string
  /** Effective project (D2 already applied: `general-general` → null). */
  projectId: string | null
  projectTypeId: string | null
  occurredAtMs: number
  content: string
  trustTier: TrustTier
  /** Crypto-shred / blob-dedup partition; defaults to the conversation. */
  shredPartitionId?: string
  /** Free-form provenance (message id, attachments, session, tool name…). Stored as meta_json. */
  meta?: Record<string, unknown>
}

/**
 * The pre-attach queue is bounded by item COUNT, not bytes — tool-result
 * clipping happens downstream in the ingest. Normally the window is one boot,
 * so that is fine. It is NOT fine when the memory module is disabled outright
 * (`modules.disabled: [memory]`): the three capture hooks are static imports in
 * other modules and keep calling `captureUnit` for the life of the process,
 * with nothing ever attaching or disabling. The bridge then holds 5 000 units
 * of unknown size and evicts silently. Every other non-attach path now calls
 * `disableIngestBridge()`; this one cannot, because the hooks have no way to
 * know the module is absent. Accepted, and recorded here rather than left to be
 * rediscovered.
 */
export const BRIDGE_MAX_PENDING = 5_000

type BridgeLogger = {
  warn: (obj: unknown, msg?: string) => void
  info?: (obj: unknown, msg?: string) => void
}

let ingest: MemoryIngest | null = null
let disabled = false
const pending: CaptureUnit[] = []
let dropped = 0

export function captureUnit(unit: CaptureUnit): void {
  if (disabled) return
  if (ingest) {
    try {
      ingest.enqueue(unit)
    } catch {
      /* the ingest logs its own failures; a hook must never see one */
    }
    return
  }
  if (pending.length >= BRIDGE_MAX_PENDING) {
    pending.shift()
    dropped++
  }
  pending.push(unit)
}

/**
 * Attaching clears `disabled`: a config flip from off to on is exactly how the
 * bridge is meant to come back. Whether that flip really happened is the
 * caller's to check — `wireL0Capture` branches on `memory.l0.enabled` and calls
 * either this or `disableIngestBridge`, never both.
 */
export function attachIngest(next: MemoryIngest, logger?: BridgeLogger): void {
  ingest = next
  disabled = false
  // Units dropped while nothing was attached, i.e. the pre-attach buffer filled.
  const overflowed = dropped
  const drained = pending.splice(0, pending.length)
  let rejected = 0
  for (const unit of drained) {
    try {
      next.enqueue(unit)
    } catch (err) {
      rejected++
      logger?.warn({ err, unitId: unit.id }, 'L0 bridge: buffered unit rejected by the ingest')
    }
  }
  // The overflow is reported here and then forgotten; the rejections are not.
  // L0 is meant to be complete, so a unit the ingest refused stays visible
  // through droppedUnits() even when the caller supplied no logger.
  dropped = rejected
  if (overflowed > 0 || rejected > 0) {
    logger?.warn(
      { dropped: overflowed, rejected, drained: drained.length },
      'L0 bridge: units captured before memory started were lost (pre-attach buffer full, or rejected by the ingest)',
    )
  } else if (drained.length > 0) {
    logger?.info?.({ drained: drained.length }, 'L0 bridge: drained units captured before memory started')
  }
}

export function detachIngest(): void {
  ingest = null
  // Same reason as disableIngestBridge: a count belonging to this lifecycle must
  // not resurface at the next attach labelled as a pre-attach buffer overflow.
  dropped = 0
}

export function pendingUnits(): number {
  return pending.length
}

export function droppedUnits(): number {
  return dropped
}

/** memory.l0.enabled=false: capture nothing, buffer nothing. */
export function disableIngestBridge(): void {
  disabled = true
  ingest = null
  pending.length = 0
  // Without this, a stale count resurfaces at the next attach as a warning that
  // contradicts itself: "the buffer overflowed" for an attach that drained nothing.
  dropped = 0
}

/** Tests only — module state is process-global. */
export function resetIngestBridge(): void {
  ingest = null
  disabled = false
  pending.length = 0
  dropped = 0
}
```

Create `src/modules/memory/v2/ingest.ts` with **only the exported types** for now (Task 5 adds `createMemoryIngest` and the constants beneath them):

```ts
// src/modules/memory/v2/ingest.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 ingest — the only writer of memory_raw / memory_blob / memory_raw_fts /
// memory_tag(layer=raw). Units arrive from the bridge with a capture-time
// ULID; they are buffered per conversation and flushed on task close, idle
// or an ~8k-token chunk. Idempotency is keyed on that ULID (memory_item.id),
// never on content: a retried flush is a no-op; two byte-identical
// occurrences in two conversations are two raw rows with two blobs (one per
// shred partition) sharing one content_hash; within one conversation they
// share one blob (ref_count 2). Spec §6 + spike §2 #21(iv).

import type { CaptureUnit } from './ingest-bridge.js'

export type FlushReason = 'close' | 'idle' | 'chunk' | 'manual'

export interface FlushResult {
  conversationId: string
  rawRows: number
  newBlobs: number
  skipped: number
}

export interface MemoryIngestConfig {
  toolResultMaxBytes: number
  idleFlushMinutes: number
  chunkTokens: number
}

export interface MemoryIngest {
  enqueue(unit: CaptureUnit): void
  flushConversation(conversationId: string, reason: FlushReason): FlushResult
  sweepIdle(nowMs?: number): number
  onFlushed(cb: (conversationId: string, reason: string) => void): void
  /** Flush every buffered conversation (shutdown, tests). Returns conversations flushed. */
  flushAll(reason: FlushReason): number
  /** Units buffered and not yet flushed, across all conversations. */
  bufferedUnits(): number
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/ingest-bridge.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/ingest-bridge.ts src/modules/memory/v2/ingest.ts tests/modules/memory/v2/ingest-bridge.test.ts
git commit -m "feat(memory): bounded boot-order-safe L(-1) capture bridge"
```

---

### Task 4: Conversation scope resolver (project / type / actor at capture)

**Files:**
- Create: `src/modules/memory/v2/scope.ts`
- Test: `tests/modules/memory/v2/scope.test.ts`

**Interfaces:**
- Produces: `export interface ConversationScope { projectId: string|null; projectTypeId: string|null; userId: string|null; agentId: string|null; godMode: boolean; parentConversationId: string|null }`; `export function resolveConversationScope(db: EyasDb, conversationId: string): ConversationScope`. Used by all three hooks (Tasks 8–10).
- Consumes: `effectiveProjectId` from `@modules/memory/types` (D2: `general-general` → null); `projects.type_id` (board schema; `tests/helpers/test-db.ts:66`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/scope.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import { resolveConversationScope } from '@modules/memory/v2/scope'

function fullSchema(db: any) {
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER NOT NULL DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('p1', 'Apollo', 'type-a'), ('p2', 'No type', NULL)`)
  db.run(sql`INSERT INTO conversations VALUES ('c1', 'p1', 'u1', 'agent-1', 1, 'c0'), ('c2', 'general-general', 'u1', NULL, 0, NULL), ('c3', 'p2', 'u2', NULL, 0, NULL)`)
}

describe('resolveConversationScope', () => {
  it('returns project, type via projects.type_id, user, agent, god-mode flag and parent', () => {
    const db = createMemoryDb(); fullSchema(db)
    expect(resolveConversationScope(db, 'c1')).toEqual({
      projectId: 'p1', projectTypeId: 'type-a', userId: 'u1', agentId: 'agent-1', godMode: true, parentConversationId: 'c0',
    })
  })

  it('applies D2: general-general is no project, hence no type', () => {
    const db = createMemoryDb(); fullSchema(db)
    const s = resolveConversationScope(db, 'c2')
    expect(s.projectId).toBeNull()
    expect(s.projectTypeId).toBeNull()
    expect(s.godMode).toBe(false)
  })

  it('leaves the type null when the project has none', () => {
    const db = createMemoryDb(); fullSchema(db)
    expect(resolveConversationScope(db, 'c3').projectTypeId).toBeNull()
  })

  it('degrades to project-only on a narrow conversations table, and to nulls when the table is absent', () => {
    const narrow = createMemoryDb()
    narrow.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT)`)
    narrow.run(sql`INSERT INTO conversations VALUES ('c1', 'p1')`)
    expect(resolveConversationScope(narrow, 'c1')).toEqual({
      projectId: 'p1', projectTypeId: null, userId: null, agentId: null, godMode: false, parentConversationId: null,
    })
    const none = createMemoryDb()
    expect(resolveConversationScope(none, 'c1')).toEqual({
      projectId: null, projectTypeId: null, userId: null, agentId: null, godMode: false, parentConversationId: null,
    })
  })

  it('returns nulls for an unknown conversation', () => {
    const db = createMemoryDb(); fullSchema(db)
    expect(resolveConversationScope(db, 'nope').projectId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/scope.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/scope'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/scope.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Board context at capture time (spec §3: project and task are structural,
// never inferred). Best-effort by design: the hooks run inside other
// modules' persistence paths and partial schemas exist (older installs,
// test fixtures), so every lookup degrades to null instead of throwing.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { effectiveProjectId } from '../types.js'

export interface ConversationScope {
  projectId: string | null
  projectTypeId: string | null
  userId: string | null
  agentId: string | null
  godMode: boolean
  parentConversationId: string | null
}

const EMPTY: ConversationScope = {
  projectId: null, projectTypeId: null, userId: null, agentId: null, godMode: false, parentConversationId: null,
}

interface WideRow {
  project_id: string | null
  user_id?: string | null
  agent_id?: string | null
  god_mode?: number | null
  parent_conversation_id?: string | null
}

export function resolveConversationScope(db: EyasDb, conversationId: string): ConversationScope {
  let row: WideRow | undefined
  try {
    row = db.all<WideRow>(sql`SELECT project_id, user_id, agent_id, god_mode, parent_conversation_id
      FROM conversations WHERE id = ${conversationId}`)[0]
  } catch {
    try {
      row = db.all<WideRow>(sql`SELECT project_id FROM conversations WHERE id = ${conversationId}`)[0]
    } catch {
      return { ...EMPTY }
    }
  }
  if (!row) return { ...EMPTY }
  const projectId = effectiveProjectId(row.project_id ?? null)
  let projectTypeId: string | null = null
  if (projectId) {
    try {
      projectTypeId = db.all<{ type_id: string | null }>(sql`SELECT type_id FROM projects WHERE id = ${projectId}`)[0]?.type_id ?? null
    } catch {
      projectTypeId = null
    }
  }
  return {
    projectId,
    projectTypeId,
    userId: row.user_id ?? null,
    agentId: row.agent_id ?? null,
    godMode: Number(row.god_mode ?? 0) === 1,
    parentConversationId: row.parent_conversation_id ?? null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/scope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/scope.ts tests/modules/memory/v2/scope.test.ts
git commit -m "feat(memory): tolerant board-scope resolver for L0 capture"
```

---

### Task 5: Ingest core — exactly-once flush into blob, raw, FTS and tags

**Files:**
- Modify: `src/modules/memory/v2/ingest.ts` (append below the types from Task 3)
- Test: `tests/modules/memory/v2/ingest-flush.test.ts`

**Interfaces:**
- Produces: `createMemoryIngest(deps: { db: EyasDb; caps: SqliteCapabilities; config: () => MemoryIngestConfig; instanceId: string; logger: Logger }): MemoryIngest`; `sha256Hex(bytes: Uint8Array): string`; constants `DUPLICATE_WINDOW_MS`, `RAW_FTS_CLIP_CHARS`.
- Consumes: `zstdCompress(data, level = 3): Uint8Array` from `@shared/zstd` (sync after `initZstd()`, P1a); `allocateRid` (P1a); `detectLanguage` (Task 2); `estimateTokens(text): number` from `@modules/prompt-wizard/token-budget` (chars ÷ 4, pure function).
- Row contract written here (P1c/P1d read it): `memory_raw.meta_json` is `JSON.stringify(unit.meta)` or NULL; tags for `memory_type='raw'`: `project`, `project_type` (when present), `task`=conversation id, `source_type`, `language`, `layer`='raw', `trust_tier`; `memory_raw_fts.rowid = memory_raw.rid`, body clipped to 16 000 chars.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/ingest-flush.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §15 Phase 1 acceptance, as rewritten by spike §2 #21(iv).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd, zstdDecompress } from '@shared/zstd'
import { createMemoryIngest, sha256Hex, RAW_FTS_CLIP_CHARS, type MemoryIngest } from '@modules/memory/v2/ingest'
import { makeV2Db, makeUnit, silentLogger, testIngestConfig } from './helpers'

let db: any
let ingest: MemoryIngest

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  ingest = createMemoryIngest({ db, caps: v2.caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
})

const rawRows = (conv: string) => db.all(sql`SELECT * FROM memory_raw WHERE conversation_id = ${conv} ORDER BY rid`) as any[]
const blobs = () => db.all(sql`SELECT content_hash, shred_partition_id, ref_count, byte_length FROM memory_blob ORDER BY shred_partition_id`) as any[]
const tagsOf = (rid: number) => Object.fromEntries(
  (db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${rid} AND memory_type = 'raw'`) as any[]).map((t) => [t.tag_type, t.tag_value]),
)

describe('L0 flush', () => {
  it('writes one raw row, one blob, one FTS row and the structural tags', () => {
    const unit = makeUnit({ projectId: 'p1', projectTypeId: 'type-a', occurredAtMs: 1_700_000_000_000, meta: { messageId: 7, attachments: ['doc-1'] } })
    ingest.enqueue(unit)
    const result = ingest.flushConversation('conv-1', 'manual')
    expect(result).toEqual({ conversationId: 'conv-1', rawRows: 1, newBlobs: 1, skipped: 0 })

    const [row] = rawRows('conv-1')
    expect(row.id).toBe(unit.id)
    expect(row.source_type).toBe('user_message')
    expect(row.actor).toBe('owner-1')
    expect(row.project_id).toBe('p1')
    expect(row.project_type_id).toBe('type-a')
    expect(row.occurred_at).toBe(1_700_000_000_000)
    expect(row.trust_tier).toBe('owner')
    expect(row.origin_instance_id).toBe('inst-test')
    expect(row.shred_partition_id).toBe('conv-1')
    expect(row.revision).toBe(1)
    expect(row.tombstoned).toBe(0)
    expect(row.dek_id).toBeNull()
    expect(typeof row.hlc_physical_ms).toBe('number')
    expect(typeof row.created_at).toBe('number')
    expect(JSON.parse(row.meta_json)).toEqual({ messageId: 7, attachments: ['doc-1'] })

    expect(tagsOf(row.rid)).toEqual({
      project: 'p1', project_type: 'type-a', task: 'conv-1', source_type: 'user_message',
      language: 'en', layer: 'raw', trust_tier: 'owner',
    })
    const fts = db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'hungarian'`) as any[]
    expect(fts.map((r) => r.rowid)).toEqual([row.rid])
  })

  it('two identical messages in two conversations → two raw rows, two blobs, one content_hash', () => {
    ingest.enqueue(makeUnit({ conversationId: 'conv-a', content: 'same bytes' }))
    ingest.enqueue(makeUnit({ conversationId: 'conv-b', content: 'same bytes' }))
    ingest.flushConversation('conv-a', 'manual')
    ingest.flushConversation('conv-b', 'manual')
    const all = db.all(sql`SELECT content_hash FROM memory_raw`) as any[]
    expect(all).toHaveLength(2)
    expect(new Set(all.map((r) => r.content_hash)).size).toBe(1)
    expect(blobs()).toEqual([
      { content_hash: all[0].content_hash, shred_partition_id: 'conv-a', ref_count: 1, byte_length: 10 },
      { content_hash: all[0].content_hash, shred_partition_id: 'conv-b', ref_count: 1, byte_length: 10 },
    ])
  })

  it('two identical messages in one conversation → two raw rows, one blob with ref_count 2', () => {
    ingest.enqueue(makeUnit({ content: 'same bytes', occurredAtMs: 1_000 }))
    ingest.enqueue(makeUnit({ content: 'same bytes', occurredAtMs: 2_000 }))
    const r = ingest.flushConversation('conv-1', 'manual')
    expect(r).toMatchObject({ rawRows: 2, newBlobs: 1 })
    expect(rawRows('conv-1')).toHaveLength(2)
    expect(blobs()).toEqual([{ content_hash: expect.any(String), shred_partition_id: 'conv-1', ref_count: 2, byte_length: 10 }])
  })

  it('a retried flush of the same ULID is a no-op — no row, no ref_count bump', () => {
    const unit = makeUnit()
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'manual')
    ingest.enqueue(unit)
    expect(ingest.flushConversation('conv-1', 'manual')).toEqual({ conversationId: 'conv-1', rawRows: 0, newBlobs: 0, skipped: 1 })
    expect(rawRows('conv-1')).toHaveLength(1)
    expect(blobs()[0].ref_count).toBe(1)
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_item`) as any[])[0].c).toBe(1)
  })

  it('the blob decompresses to the original bytes and its hash is the row hash', () => {
    const unit = makeUnit({ content: 'árvíztűrő tükörfúrógép — with a long tail '.repeat(20) })
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const blob = (db.all(sql`SELECT compressed_blob FROM memory_blob WHERE content_hash = ${row.content_hash}`) as any[])[0]
    const bytes = zstdDecompress(new Uint8Array(blob.compressed_blob))
    expect(new TextDecoder().decode(bytes)).toBe(unit.content)
    expect(sha256Hex(new TextEncoder().encode(unit.content))).toBe(row.content_hash)
  })

  it('FTS finds a Hungarian word with its diacritics stripped', () => {
    ingest.enqueue(makeUnit({ content: 'Az árvíztűrő tükörfúrógép a legjobb magyar tesztmondat, és mindig működik.' }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const hits = (q: string) => (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH ${q}`) as any[]).map((r) => r.rowid)
    expect(hits('arvizturo')).toEqual([row.rid])
    expect(hits('tukorfurogep')).toEqual([row.rid])
    expect(tagsOf(row.rid).language).toBe('hu')
  })

  it('omits project tags when there is no project, and honours an explicit shred partition', () => {
    ingest.enqueue(makeUnit({ projectId: null, projectTypeId: null, shredPartitionId: 'vault:notes/a.md', sourceType: 'document', trustTier: 'ingested' }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const tags = tagsOf(row.rid)
    expect(tags.project).toBeUndefined()
    expect(tags.project_type).toBeUndefined()
    expect(tags.trust_tier).toBe('ingested')
    expect(row.shred_partition_id).toBe('vault:notes/a.md')
    expect(blobs()[0].shred_partition_id).toBe('vault:notes/a.md')
  })

  it('stores SQL NULL in meta_json — not the string "null" — when the unit carries no meta', () => {
    ingest.enqueue(makeUnit())
    ingest.flushConversation('conv-1', 'manual')
    expect(rawRows('conv-1')[0].meta_json).toBeNull()
  })

  it('clips the FTS body at RAW_FTS_CLIP_CHARS while the blob keeps the whole text', () => {
    const head = 'elsoegyeditokenword'
    const tail = 'utolsoegyeditokenword'
    const content = `${head} ${'x'.repeat(RAW_FTS_CLIP_CHARS)} ${tail}`
    ingest.enqueue(makeUnit({ content }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = rawRows('conv-1')
    const hits = (q: string) => (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH ${q}`) as any[]).map((r) => r.rowid)
    expect(hits(head)).toEqual([row.rid])
    expect(hits(tail)).toEqual([])
    // The record itself stays complete — only the index is partial.
    const blob = (db.all(sql`SELECT compressed_blob FROM memory_blob WHERE content_hash = ${row.content_hash}`) as any[])[0]
    expect(new TextDecoder().decode(zstdDecompress(new Uint8Array(blob.compressed_blob)))).toBe(content)
  })

  it('flushing a conversation with nothing buffered returns zeros', () => {
    expect(ingest.flushConversation('nothing', 'manual')).toEqual({ conversationId: 'nothing', rawRows: 0, newBlobs: 0, skipped: 0 })
  })

  it('rolls the whole flush back when a write fails and keeps the units buffered', () => {
    ingest.enqueue(makeUnit())
    db.run(sql`DROP TABLE memory_raw`)
    expect(() => ingest.flushConversation('conv-1', 'manual')).toThrow()
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_item`) as any[])[0].c).toBe(0)
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_blob`) as any[])[0].c).toBe(0)
    expect(ingest.bufferedUnits()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/ingest-flush.test.ts`
Expected: FAIL — `createMemoryIngest is not a function` (the module only exports types so far).

- [ ] **Step 3: Write the implementation**

Replace the import line at the top of `src/modules/memory/v2/ingest.ts` and append the implementation after the `MemoryIngest` interface. The complete file after this step:

```ts
// src/modules/memory/v2/ingest.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 ingest — the only writer of memory_raw / memory_blob / memory_raw_fts /
// memory_tag(layer=raw). Units arrive from the bridge with a capture-time
// ULID; they are buffered per conversation and flushed on task close, idle
// or an ~8k-token chunk. Idempotency is keyed on that ULID (memory_item.id),
// never on content: a retried flush is a no-op; two byte-identical
// occurrences in two conversations are two raw rows with two blobs (one per
// shred partition) sharing one content_hash; within one conversation they
// share one blob (ref_count 2). Spec §6 + spike §2 #21(iv).

import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { zstdCompress } from '@shared/zstd.js'
import { estimateTokens } from '@modules/prompt-wizard/token-budget.js'
import { allocateRid } from './schema.js'
import { detectLanguage } from './language.js'
import type { CaptureUnit } from './ingest-bridge.js'

export type FlushReason = 'close' | 'idle' | 'chunk' | 'manual'

export interface FlushResult {
  conversationId: string
  rawRows: number
  newBlobs: number
  skipped: number
}

export interface MemoryIngestConfig {
  toolResultMaxBytes: number
  idleFlushMinutes: number
  chunkTokens: number
}

export interface MemoryIngest {
  enqueue(unit: CaptureUnit): void
  flushConversation(conversationId: string, reason: FlushReason): FlushResult
  sweepIdle(nowMs?: number): number
  onFlushed(cb: (conversationId: string, reason: string) => void): void
  /** Flush every buffered conversation (shutdown, tests). Returns conversations flushed. */
  flushAll(reason: FlushReason): number
  /** Units buffered and not yet flushed, across all conversations. */
  bufferedUnits(): number
}

export interface MemoryIngestDeps {
  db: EyasDb
  caps: SqliteCapabilities
  /** Read on every call so `config reload` takes effect without a restart. */
  config: () => MemoryIngestConfig
  instanceId: string
  logger: Logger
}

/** An assistant reply persisted twice for one task (LlmResponse event + addMessage) inside this window is one occurrence. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000
/** Contentless FTS body clip; tool results are already byte-capped by config. */
export const RAW_FTS_CLIP_CHARS = 16_000
/** A conversation whose flushes keep failing must not grow without bound. */
const MAX_BUFFERED_PER_CONVERSATION = 2_000

interface BufferedUnit extends CaptureUnit {
  contentHash: string
}

interface ConversationBuffer {
  units: BufferedUnit[]
  tokens: number
  lastActivityMs: number
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function changes(db: EyasDb): number {
  return db.all<{ c: number }>(sql`SELECT changes() AS c`)[0]?.c ?? 0
}

/** Byte-bounded clip on a UTF-8 boundary with a visible marker. */
function clipToBytes(text: string, maxBytes: number): { text: string; originalBytes: number; truncated: boolean } {
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength <= maxBytes) return { text, originalBytes: bytes.byteLength, truncated: false }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, maxBytes)).replace(/�+$/u, '')
  return {
    text: `${head}\n…[truncated: ${bytes.byteLength} bytes total, kept ${maxBytes}]`,
    originalBytes: bytes.byteLength,
    truncated: true,
  }
}

// Hybrid logical clock (spec §5 syncCols). One instance today, so the
// logical part only disambiguates same-millisecond writes.
let hlcPhysical = 0
let hlcLogical = 0
function nextHlc(nowMs: number): { physicalMs: number; logical: number } {
  if (nowMs > hlcPhysical) {
    hlcPhysical = nowMs
    hlcLogical = 0
  } else {
    hlcLogical += 1
  }
  return { physicalMs: hlcPhysical, logical: hlcLogical }
}

export function createMemoryIngest(deps: MemoryIngestDeps): MemoryIngest {
  const { db, caps, instanceId, logger } = deps
  const buffers = new Map<string, ConversationBuffer>()
  const flushedListeners: Array<(conversationId: string, reason: string) => void> = []
  const overflowWarned = new Set<string>()

  function bufferFor(conversationId: string): ConversationBuffer {
    let buf = buffers.get(conversationId)
    if (!buf) {
      buf = { units: [], tokens: 0, lastActivityMs: Date.now() }
      buffers.set(conversationId, buf)
    }
    return buf
  }

  function tag(rid: number, tagType: string, tagValue: string): void {
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
      VALUES (${rid}, 'raw', ${tagType}, ${tagValue})`)
  }

  /**
   * Two capture paths can record one assistant reply: the `LlmResponse` event
   * and the `addMessage` that follows it. Suppress the second — but ONLY when
   * the two copies came from DIFFERENT origins, which is the whole reason this
   * heuristic exists. Within one origin a byte-identical repeat is a genuine
   * second occurrence ("Done." twice), and spec §3 says L0 is complete.
   */
  function isDuplicateAssistantReply(buf: ConversationBuffer, unit: BufferedUnit): boolean {
    const origin = (unit.meta?.origin ?? null) as string | null
    const pendingDup = buf.units.some((u) =>
      u.sourceType === 'assistant_message'
      && u.contentHash === unit.contentHash
      && ((u.meta?.origin ?? null) as string | null) !== origin
      && Math.abs(u.occurredAtMs - unit.occurredAtMs) <= DUPLICATE_WINDOW_MS)
    if (pendingDup) return true
    const since = unit.occurredAtMs - DUPLICATE_WINDOW_MS
    const flushed = db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM memory_raw
      WHERE conversation_id = ${unit.conversationId} AND source_type = 'assistant_message'
        AND content_hash = ${unit.contentHash} AND occurred_at >= ${since}
        AND json_extract(meta_json, '$.origin') IS NOT ${origin} LIMIT 1`)
    return flushed.length > 0
  }

  /** Writes one unit inside the caller's transaction. Returns what it did. */
  function writeUnit(unit: BufferedUnit): 'inserted' | 'skipped' | 'inserted_new_blob' {
    const existing = db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${unit.id}`)
    if (existing.length > 0) return 'skipped'

    const contentBytes = new TextEncoder().encode(unit.content)
    const partition = unit.shredPartitionId ?? unit.conversationId
    const compressed = zstdCompress(contentBytes)
    const blobParam = Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength)
    db.run(sql`INSERT OR IGNORE INTO memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length, ref_count)
      VALUES (${unit.contentHash}, ${partition}, ${blobParam}, ${contentBytes.byteLength}, 0)`)
    const newBlob = changes(db) === 1
    db.run(sql`UPDATE memory_blob SET ref_count = ref_count + 1
      WHERE content_hash = ${unit.contentHash} AND shred_partition_id = ${partition}`)

    const now = Date.now()
    const rid = allocateRid(db, 'raw', unit.id, now)
    const hlc = nextHlc(now)
    const metaJson = unit.meta ? JSON.stringify(unit.meta) : null
    db.run(sql`INSERT INTO memory_raw (
        rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
        shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id,
        occurred_at, trust_tier, dek_id, tombstoned, meta_json)
      VALUES (
        ${rid}, ${unit.id}, ${unit.contentHash}, ${instanceId}, ${hlc.physicalMs}, ${hlc.logical}, 1, ${now},
        ${partition}, ${unit.sourceType}, ${unit.actor}, ${unit.conversationId}, ${unit.projectId}, ${unit.projectTypeId},
        ${unit.occurredAtMs}, ${unit.trustTier}, NULL, 0, ${metaJson})`)

    if (caps.fts5) {
      db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${rid}, ${unit.content.slice(0, RAW_FTS_CLIP_CHARS)})`)
    }

    if (unit.projectId) tag(rid, 'project', unit.projectId)
    if (unit.projectTypeId) tag(rid, 'project_type', unit.projectTypeId)
    tag(rid, 'task', unit.conversationId)
    tag(rid, 'source_type', unit.sourceType)
    tag(rid, 'language', detectLanguage(unit.content))
    tag(rid, 'layer', 'raw')
    tag(rid, 'trust_tier', unit.trustTier)
    return newBlob ? 'inserted_new_blob' : 'inserted'
  }

  function flushUnits(conversationId: string, units: BufferedUnit[]): FlushResult {
    const result: FlushResult = { conversationId, rawRows: 0, newBlobs: 0, skipped: 0 }
    // BEGIN MUST STAY OUTSIDE THE try. If a caller already has a transaction
    // open, this BEGIN throws — and because the catch is unreachable, no
    // ROLLBACK runs and their uncommitted work survives. Moved inside "for
    // symmetry", the catch would fire and roll back THEIR transaction instead
    // of ours, which is precisely the data-loss bug p1a found in the SQLite
    // capability probe. Same hazard, same reason, as the `began` guards in
    // security-gate/autonomy-policy.ts and agent/god-mode/store.ts.
    db.run(sql`BEGIN IMMEDIATE`)
    try {
      for (const unit of units) {
        const outcome = writeUnit(unit)
        if (outcome === 'skipped') result.skipped++
        else {
          result.rawRows++
          if (outcome === 'inserted_new_blob') result.newBlobs++
        }
      }
      db.run(sql`COMMIT`)
    } catch (err) {
      try { db.run(sql`ROLLBACK`) } catch { /* the transaction may already be gone */ }
      throw err
    }
    return result
  }

  function notifyFlushed(conversationId: string, reason: FlushReason): void {
    for (const cb of flushedListeners) {
      try {
        cb(conversationId, reason)
      } catch (err) {
        logger.warn({ err, conversationId, reason }, 'L0 ingest: onFlushed listener threw; the flush itself is committed')
      }
    }
  }

  const ingest: MemoryIngest = {
    enqueue(raw: CaptureUnit): void {
      const cfg = deps.config()
      let content = raw.content
      let meta = raw.meta
      if (raw.sourceType === 'tool_result') {
        const clipped = clipToBytes(content, cfg.toolResultMaxBytes)
        content = clipped.text
        if (clipped.truncated) meta = { ...(meta ?? {}), truncated: true, originalBytes: clipped.originalBytes }
      }
      const unit: BufferedUnit = { ...raw, content, meta, contentHash: sha256Hex(new TextEncoder().encode(content)) }
      const buf = bufferFor(unit.conversationId)
      if (unit.sourceType === 'assistant_message' && isDuplicateAssistantReply(buf, unit)) {
        logger.debug({ conversationId: unit.conversationId, unitId: unit.id }, 'L0 ingest: assistant reply already captured for this task within the duplicate window; skipped')
        return
      }
      if (buf.units.length >= MAX_BUFFERED_PER_CONVERSATION) {
        buf.units.shift()
        if (!overflowWarned.has(unit.conversationId)) {
          overflowWarned.add(unit.conversationId)
          logger.warn({ conversationId: unit.conversationId, cap: MAX_BUFFERED_PER_CONVERSATION }, 'L0 ingest: conversation buffer full (flushes failing?); dropping the oldest unit')
        }
      }
      buf.units.push(unit)
      buf.tokens += estimateTokens(content)
      buf.lastActivityMs = Date.now()
      if (buf.tokens >= cfg.chunkTokens) {
        try {
          ingest.flushConversation(unit.conversationId, 'chunk')
        } catch (err) {
          logger.warn({ err, conversationId: unit.conversationId }, 'L0 ingest: chunk flush failed; units stay buffered for the next trigger')
        }
      }
    },

    flushConversation(conversationId: string, reason: FlushReason): FlushResult {
      const buf = buffers.get(conversationId)
      if (!buf || buf.units.length === 0) return { conversationId, rawRows: 0, newBlobs: 0, skipped: 0 }
      const units = buf.units.splice(0, buf.units.length)
      buf.tokens = 0
      try {
        const result = flushUnits(conversationId, units)
        buffers.delete(conversationId)
        // The buffer drained, so the next overflow is a new episode and
        // deserves its own warning. Without this, a conversation warns once
        // per process and every later drop is silent.
        overflowWarned.delete(conversationId)
        if (result.rawRows > 0) notifyFlushed(conversationId, reason)
        return result
      } catch (err) {
        // Put them back at the front so order survives a retry.
        buf.units.unshift(...units)
        buf.tokens = units.reduce((n, u) => n + estimateTokens(u.content), 0)
        logger.warn({ err, conversationId, reason, units: units.length }, 'L0 ingest: flush rolled back')
        throw err
      }
    },

    sweepIdle(nowMs: number = Date.now()): number {
      const idleMs = deps.config().idleFlushMinutes * 60_000
      let flushed = 0
      for (const [conversationId, buf] of [...buffers.entries()]) {
        if (buf.units.length === 0) { buffers.delete(conversationId); continue }
        if (nowMs - buf.lastActivityMs < idleMs) continue
        try {
          ingest.flushConversation(conversationId, 'idle')
          flushed++
        } catch {
          /* already logged in flushConversation; try again next sweep */
        }
      }
      return flushed
    },

    onFlushed(cb): void {
      flushedListeners.push(cb)
    },

    flushAll(reason: FlushReason): number {
      let flushed = 0
      for (const conversationId of [...buffers.keys()]) {
        try {
          if (ingest.flushConversation(conversationId, reason).rawRows > 0 || true) flushed++
        } catch {
          /* logged in flushConversation */
        }
      }
      return flushed
    },

    bufferedUnits(): number {
      let n = 0
      for (const buf of buffers.values()) n += buf.units.length
      return n
    },
  }

  return ingest
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/ingest-flush.test.ts`
Expected: PASS (11 tests). If the blob round-trip test fails with a binding error on Node (`SQLite3 can only bind numbers, strings, bigints, buffers, and null`), the `Buffer.from(...)` wrapper above is what fixes it — check it was kept.

- [ ] **Step 5: Type-check**

Run: `bun run lint`
Expected: no errors in `src/modules/memory/v2/ingest.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/memory/v2/ingest.ts tests/modules/memory/v2/ingest-flush.test.ts
git commit -m "feat(memory): exactly-once L0 flush into blob, raw, FTS and tags"
```

---

### Task 6: Ingest triggers — chunk, idle, onFlushed, duplicate suppression, tool-result cap

**Files:**
- Modify: `src/modules/memory/v2/ingest.ts` (one cleanup, see Step 3)
- Test: `tests/modules/memory/v2/ingest-triggers.test.ts`

**Interfaces:**
- Consumes/produces: the `MemoryIngest` surface from Task 5. P1c registers `ingest.onFlushed((conversationId, reason) => runExtraction(...))`; this task proves the callback fires only when new rows landed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/ingest-triggers.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { createMemoryIngest, DUPLICATE_WINDOW_MS, type MemoryIngest, type MemoryIngestConfig } from '@modules/memory/v2/ingest'
import { makeV2Db, makeUnit, silentLogger } from './helpers'

let db: any
let ingest: MemoryIngest
let config: MemoryIngestConfig

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  db = v2.db
  config = { toolResultMaxBytes: 64, idleFlushMinutes: 30, chunkTokens: 100 }
  ingest = createMemoryIngest({ db, caps: v2.caps, config: () => config, instanceId: 'inst-test', logger: silentLogger })
})

const count = (conv: string) => (db.all(sql`SELECT COUNT(*) AS c FROM memory_raw WHERE conversation_id = ${conv}`) as any[])[0].c

describe('L0 ingest triggers', () => {
  it('flushes on its own once a conversation buffers ~chunkTokens, reporting reason chunk', () => {
    const flushed = vi.fn()
    ingest.onFlushed(flushed)
    ingest.enqueue(makeUnit({ content: 'x'.repeat(200) }))   // ~50 tokens, below 100
    expect(count('conv-1')).toBe(0)
    ingest.enqueue(makeUnit({ content: 'y'.repeat(200) }))   // crosses 100
    expect(count('conv-1')).toBe(2)
    expect(flushed).toHaveBeenCalledWith('conv-1', 'chunk')
    expect(ingest.bufferedUnits()).toBe(0)
  })

  it('sweepIdle flushes only conversations idle for idleFlushMinutes', () => {
    const t0 = Date.now()
    ingest.enqueue(makeUnit({ conversationId: 'old' }))
    expect(ingest.sweepIdle(t0 + 5 * 60_000)).toBe(0)
    expect(count('old')).toBe(0)
    expect(ingest.sweepIdle(t0 + 31 * 60_000)).toBe(1)
    expect(count('old')).toBe(1)
    expect(ingest.sweepIdle(t0 + 62 * 60_000)).toBe(0)
  })

  it('onFlushed fires with the reason, and not at all when every unit was a replay', () => {
    const flushed = vi.fn()
    ingest.onFlushed(flushed)
    const unit = makeUnit()
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'close')
    expect(flushed).toHaveBeenCalledTimes(1)
    expect(flushed).toHaveBeenCalledWith('conv-1', 'close')
    ingest.enqueue(unit)
    ingest.flushConversation('conv-1', 'manual')
    expect(flushed).toHaveBeenCalledTimes(1)
  })

  it('a throwing onFlushed listener does not undo the committed flush', () => {
    ingest.onFlushed(() => { throw new Error('extractor on fire') })
    ingest.enqueue(makeUnit())
    expect(() => ingest.flushConversation('conv-1', 'manual')).not.toThrow()
    expect(count('conv-1')).toBe(1)
  })

  it('caps tool results at toolResultMaxBytes with a marker and records the original size', () => {
    ingest.enqueue(makeUnit({ sourceType: 'tool_result', trustTier: 'ingested', content: 'A'.repeat(500), meta: { toolName: 'bash' } }))
    ingest.flushConversation('conv-1', 'manual')
    const [row] = db.all(sql`SELECT meta_json FROM memory_raw WHERE conversation_id = 'conv-1'`) as any[]
    const blob = (db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0]
    expect(JSON.parse(row.meta_json)).toEqual({ toolName: 'bash', truncated: true, originalBytes: 500 })
    expect(blob.byte_length).toBeLessThan(200)
    expect(blob.byte_length).toBeGreaterThan(64)
  })

  it('does not cap messages, only tool results', () => {
    ingest.enqueue(makeUnit({ content: 'B'.repeat(500) }))
    ingest.flushConversation('conv-1', 'manual')
    expect((db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0].byte_length).toBe(500)
  })

  it('suppresses one reply captured by BOTH paths within 10 minutes, but keeps two genuine repeats from one path', () => {
    const t = 1_700_000_000_000
    const base = { sourceType: 'assistant_message' as const, actor: 'agent-1', content: 'final answer' }
    const fromEvent = (over: Record<string, unknown> = {}) => makeUnit({ ...base, meta: { origin: 'agent_events' }, ...over })
    const fromMessage = (over: Record<string, unknown> = {}) => makeUnit({ ...base, meta: { origin: 'conversation_messages' }, ...over })

    // Both paths, both still pending: one occurrence.
    ingest.enqueue(fromEvent({ occurredAtMs: t }))
    ingest.enqueue(fromMessage({ occurredAtMs: t + 1_000 }))
    expect(ingest.bufferedUnits()).toBe(1)

    // Both paths, the first already flushed: still one occurrence.
    ingest.flushConversation('conv-1', 'manual')
    ingest.enqueue(fromMessage({ occurredAtMs: t + 2_000 }))
    expect(ingest.bufferedUnits()).toBe(0)

    // Past the window, it is a new occurrence again.
    ingest.enqueue(fromMessage({ occurredAtMs: t + DUPLICATE_WINDOW_MS + 1 }))
    expect(ingest.bufferedUnits()).toBe(1)

    // Two byte-identical replies from the SAME path are two real occurrences —
    // the old content-only key threw the second away silently.
    ingest.enqueue(fromEvent({ conversationId: 'conv-3', occurredAtMs: t }))
    ingest.enqueue(fromEvent({ conversationId: 'conv-3', occurredAtMs: t + 1_000 }))
    expect(ingest.bufferedUnits()).toBe(3)

    // Never across tasks, never across roles.
    ingest.enqueue(fromMessage({ conversationId: 'conv-2', occurredAtMs: t + 3_000 }))
    ingest.enqueue(makeUnit({ sourceType: 'user_message', content: 'final answer', occurredAtMs: t + 4_000 }))
    expect(ingest.bufferedUnits()).toBe(5)
  })

  it('flushAll flushes every buffered conversation', () => {
    ingest.enqueue(makeUnit({ conversationId: 'a' }))
    ingest.enqueue(makeUnit({ conversationId: 'b' }))
    expect(ingest.flushAll('manual')).toBe(2)
    expect(count('a') + count('b')).toBe(2)
    expect(ingest.bufferedUnits()).toBe(0)
  })

  it('flushAll keeps going past a conversation that throws, and does not count it', () => {
    // This is the shutdown path (memory/index.ts onStop calls flushAll): one
    // broken conversation must not cost every other conversation its flush.
    ingest.enqueue(makeUnit({ conversationId: 'bad' }))
    ingest.enqueue(makeUnit({ conversationId: 'good' }))
    const real = ingest.flushConversation.bind(ingest)
    ingest.flushConversation = (id, reason) => {
      if (id === 'bad') throw new Error('flush on fire')
      return real(id, reason)
    }
    expect(ingest.flushAll('manual')).toBe(1)
    expect(count('bad')).toBe(0)
    expect(count('good')).toBe(1)
    expect(ingest.bufferedUnits()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/ingest-triggers.test.ts`
Expected: all 8 PASS already — Task 5 implemented the behaviour. The `|| true` in `flushAll` is **not** load-bearing: `flushConversation` throws before `.rawRows` is read, so the surrounding `try`/`catch` already excludes a failing conversation from the count, and a successful flush of a non-empty buffer always returns `rawRows > 0`. Step 3 removes the wart as a pure readability fix, and the new ninth test pins the throw-isolation the eight originals never exercised.

- [ ] **Step 3: Clean up `flushAll`**

In `src/modules/memory/v2/ingest.ts` replace:

```ts
    flushAll(reason: FlushReason): number {
      let flushed = 0
      for (const conversationId of [...buffers.keys()]) {
        try {
          if (ingest.flushConversation(conversationId, reason).rawRows > 0 || true) flushed++
        } catch {
          /* logged in flushConversation */
        }
      }
      return flushed
    },
```

with:

```ts
    flushAll(reason: FlushReason): number {
      let flushed = 0
      for (const conversationId of [...buffers.keys()]) {
        try {
          ingest.flushConversation(conversationId, reason)
          flushed++
        } catch {
          /* logged in flushConversation; the units stay buffered */
        }
      }
      return flushed
    },
```

- [ ] **Step 4: Run both ingest test files**

Run: `bun vitest run tests/modules/memory/v2/ingest-flush.test.ts tests/modules/memory/v2/ingest-triggers.test.ts`
Expected: PASS (11 + 9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/ingest.ts tests/modules/memory/v2/ingest-triggers.test.ts
git commit -m "feat(memory): chunk/idle triggers, duplicate-reply suppression and tool-result cap for L0"
```

---

### Task 7: Scheduler sweep `memory.v2.flush`

**Files:**
- Create: `src/modules/memory/v2/flush-job.ts`
- Test: `tests/modules/memory/v2/flush-job.test.ts`

**Interfaces:**
- Produces: `FLUSH_JOB_NAME = 'memory.v2.flush'`, `FLUSH_HANDLER_KEY = 'memory.v2.flush'`, `FLUSH_JOB_CRON = '* * * * *'`, `interface FlushJobScheduler { registerHandler(name, fn): void; list(): Array<{ name?: string }>; create(job): unknown }`, `registerFlushJob(scheduler: FlushJobScheduler, ingest: Pick<MemoryIngest, 'sweepIdle'>): void`.
- Consumes: the scheduler service published on `ctx.scheduler` in scheduler's `onRegister` (`src/modules/scheduler/index.ts:70`), `registerHandler(name, fn)` / `list()` / `create(CreateJobInput)` — same shape `memory/index.ts:361-378` already uses for `memory.team_memory.retention`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/flush-job.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { registerFlushJob, FLUSH_JOB_NAME, FLUSH_HANDLER_KEY, FLUSH_JOB_CRON } from '@modules/memory/v2/flush-job'

function fakeScheduler(existing: Array<{ name: string }> = []) {
  const handlers = new Map<string, () => Promise<unknown>>()
  const created: any[] = []
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    list: () => existing,
    create: vi.fn((job: any) => { created.push(job); return job }),
    run: (name: string) => handlers.get(name)!(),
    created,
    handlers,
  }
}

describe('memory.v2.flush scheduler job', () => {
  it('registers the handler and seeds a one-minute cron job', async () => {
    const scheduler = fakeScheduler()
    const ingest = { sweepIdle: vi.fn(() => 2) }
    registerFlushJob(scheduler, ingest)

    expect(scheduler.handlers.has(FLUSH_HANDLER_KEY)).toBe(true)
    expect(scheduler.created).toHaveLength(1)
    expect(scheduler.created[0]).toMatchObject({
      name: FLUSH_JOB_NAME, triggerType: 'cron', handler: FLUSH_HANDLER_KEY,
      triggerConfig: JSON.stringify({ cron: FLUSH_JOB_CRON }),
    })
    await expect(scheduler.run(FLUSH_HANDLER_KEY)).resolves.toEqual({ flushed: 2 })
    expect(ingest.sweepIdle).toHaveBeenCalledTimes(1)
  })

  it('does not create a second job on restart', () => {
    const scheduler = fakeScheduler([{ name: FLUSH_JOB_NAME }])
    registerFlushJob(scheduler, { sweepIdle: () => 0 })
    expect(scheduler.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/flush-job.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/flush-job'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/flush-job.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Idle detection for L(-1) buffers rides the existing scheduler: one sweep a
// minute asks the ingest to flush every task idle for memory.l0.idleFlushMinutes.
// Same registration shape as memory.team_memory.retention in memory/index.ts.

import type { MemoryIngest } from './ingest.js'

export const FLUSH_JOB_NAME = 'memory.v2.flush'
export const FLUSH_HANDLER_KEY = 'memory.v2.flush'
export const FLUSH_JOB_CRON = '* * * * *'

export interface FlushJobScheduler {
  registerHandler(name: string, fn: () => Promise<unknown>): void
  list(): Array<{ name?: string }>
  create(job: {
    name: string
    description?: string
    triggerType: 'cron'
    triggerConfig: string
    handler: string
  }): unknown
}

/** Registers the handler and seeds the cron job (idempotent — safe on every restart). */
export function registerFlushJob(scheduler: FlushJobScheduler, ingest: Pick<MemoryIngest, 'sweepIdle'>): void {
  scheduler.registerHandler(FLUSH_HANDLER_KEY, async () => ({ flushed: ingest.sweepIdle() }))
  const existing = scheduler.list().find((j) => j.name === FLUSH_JOB_NAME)
  if (existing) return
  scheduler.create({
    name: FLUSH_JOB_NAME,
    description: 'Flush L0 capture buffers of tasks idle for memory.l0.idleFlushMinutes',
    triggerType: 'cron',
    triggerConfig: JSON.stringify({ cron: FLUSH_JOB_CRON }),
    handler: FLUSH_HANDLER_KEY,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/flush-job.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/flush-job.ts tests/modules/memory/v2/flush-job.test.ts
git commit -m "feat(memory): one-minute memory.v2.flush sweep for idle L0 buffers"
```

---

### Task 8: Hook `chatService.addMessage` (all 14 call sites, God Mode included)

**Files:**
- Create: `src/modules/conversations/l0-capture.ts`
- Modify: `src/modules/conversations/conversation-service.ts:3-6` (imports) and `:565-578` (`addMessage`)
- Test: `tests/modules/memory/v2/capture-conversations.test.ts`, `tests/modules/memory/v2/capture-god-mode.test.ts`

**Interfaces:**
- Produces: `captureConversationMessage(db: EyasDb, message: ConversationMessage): void`.
- Consumes: `ConversationMessage` (`conversation-service.ts:62-73`: `id: number`, `conversationId`, `role`, `content`, `model`, `provider`, `attachmentIds: string[]`, `createdAt: string` ISO), `captureUnit` (Task 3), `resolveConversationScope` (Task 4), `generateId` from `@shared/crypto`.
- Mapping decided here: `role 'user'` → `user_message`, actor = `conversations.user_id` (fallback `'user'`); `role 'assistant'` → `assistant_message`, actor = `conversations.agent_id`, else the message's `provider`, else `'assistant'`; any other role (prompt-coach/enhancer use `'user'`; none write `'tool'`/`'system'` today) → not captured; empty/whitespace content (God Mode attachment-only turn) → not captured (attachments as `document` rows are deferred, spec §16-4). Trust `owner` for both roles (spec §6, migration mapping §14). `occurredAtMs = Date.parse(createdAt)`. `meta = { origin: 'conversation_messages', messageId, attachments, model, provider, godMode }`.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/modules/memory/v2/capture-conversations.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Hooking inside addMessage covers all 14 call sites at once (routes, agent
// executeAgent/persistText, orchestrator, God Mode winner promotion,
// communication adapters) — see the touchpoint table in the plan.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, insertTestOwner } from '../../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { attachIngest, pendingUnits, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'

const testDb = createTestDb('capture-conversations')

let db: any
let chat: ReturnType<typeof createConversationService>
let userId: string
let enqueue: ReturnType<typeof vi.fn>

beforeEach(async () => {
  resetIngestBridge()
  db = testDb.open()
  userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO project_types (id, name, created_at) VALUES ('type-a', 'Type A', ${now})`)
  db.run(sql`INSERT INTO projects (id, name, type_id, created_at, updated_at) VALUES ('p1', 'Apollo', 'type-a', ${now}, ${now})`)
  chat = createConversationService(db)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

describe('addMessage → L0 capture', () => {
  it('captures a user message with the board scope, actor and provenance', () => {
    const id = chat.create({ userId, title: 'T', projectId: 'p1' }).id
    const msg = chat.addMessage(id, { role: 'user', content: 'Always answer me in Hungarian.', attachmentIds: ['doc-1'] })

    expect(enqueue).toHaveBeenCalledTimes(1)
    const unit = enqueue.mock.calls[0][0]
    expect(unit).toMatchObject({
      sourceType: 'user_message', actor: userId, conversationId: id, projectId: 'p1', projectTypeId: 'type-a',
      content: 'Always answer me in Hungarian.', trustTier: 'owner',
      meta: { origin: 'conversation_messages', messageId: msg.id, attachments: ['doc-1'], godMode: false },
    })
    expect(unit.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(unit.occurredAtMs).toBe(Date.parse(msg.createdAt))
  })

  it('captures an assistant reply, attributing it to the agent or the provider', () => {
    const id = chat.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    chat.addMessage(id, { role: 'assistant', content: 'Rendben.', provider: 'p1', model: 'm1' })
    expect(enqueue.mock.calls[0][0]).toMatchObject({ sourceType: 'assistant_message', actor: 'p1', trustTier: 'derived', projectId: null })

    chat.update(id, { agentId: 'agent-1' })
    chat.addMessage(id, { role: 'assistant', content: 'Második válasz.', provider: 'p1' })
    expect(enqueue.mock.calls[1][0].actor).toBe('agent-1')
  })

  it('applies D2: general-general carries no project', () => {
    const id = chat.create({ userId, title: 'T', projectId: 'general-general' }).id
    chat.addMessage(id, { role: 'user', content: 'projectless' })
    expect(enqueue.mock.calls[0][0]).toMatchObject({ projectId: null, projectTypeId: null })
  })

  it('skips empty content and non-chat roles', () => {
    const id = chat.create({ userId, title: 'T' }).id
    chat.addMessage(id, { role: 'user', content: '   ' })
    chat.addMessage(id, { role: 'system', content: 'not a turn' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('buffers in the bridge when memory has not started yet (boot order)', () => {
    resetIngestBridge()
    const id = chat.create({ userId, title: 'T' }).id
    chat.addMessage(id, { role: 'user', content: 'captured before memory.onStart' })
    expect(pendingUnits()).toBe(1)
  })

  it('never lets capture break addMessage', () => {
    enqueue.mockImplementation(() => { throw new Error('ingest on fire') })
    const id = chat.create({ userId, title: 'T' }).id
    const msg = chat.addMessage(id, { role: 'user', content: 'still stored' })
    expect(msg.content).toBe('still stored')
    expect(chat.get(id)!.messages).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/capture-conversations.test.ts`
Expected: FAIL — `enqueue` never called (`expected 1, received 0`).

- [ ] **Step 3: Write the hook module**

```ts
// src/modules/conversations/l0-capture.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 capture for chat messages, at the persistence layer (spec §6). Every
// addMessage call site — interactive routes, executeAgent, the orchestrator,
// God Mode's winner promotion, channel adapters — lands here, so the God
// Mode branch that returns before the old post-turn capture is covered
// structurally. Best-effort: nothing in here may change what addMessage
// returns.

import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { captureUnit, type RawSourceType } from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope } from '@modules/memory/v2/scope.js'
import type { ConversationMessage } from './conversation-service.js'

function sourceTypeOf(role: string): RawSourceType | null {
  if (role === 'user') return 'user_message'
  if (role === 'assistant') return 'assistant_message'
  return null
}

export function captureConversationMessage(db: EyasDb, message: ConversationMessage): void {
  try {
    const sourceType = sourceTypeOf(message.role)
    if (!sourceType) return
    if (!message.content || !message.content.trim()) return
    const scope = resolveConversationScope(db, message.conversationId)
    const actor = sourceType === 'user_message'
      ? (scope.userId ?? 'user')
      : (scope.agentId ?? message.provider ?? 'assistant')
    const occurredAtMs = Date.parse(message.createdAt)
    captureUnit({
      id: generateId(),
      sourceType,
      actor,
      conversationId: message.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
      content: message.content,
      // The owner's own words are 'owner'; the model's are 'derived'. A gist
      // takes trust_tier = min(sources) (spec §5), so a fact extracted from an
      // assistant turn that echoed injected text must not inherit the maximum.
      trustTier: sourceType === 'user_message' ? 'owner' : 'derived',
      meta: {
        origin: 'conversation_messages',
        messageId: message.id,
        attachments: message.attachmentIds,
        model: message.model,
        provider: message.provider,
        godMode: scope.godMode,
      },
    })
  } catch {
    /* capture is best-effort; the message is already stored */
  }
}
```

- [ ] **Step 4: Wire it into `addMessage`**

In `src/modules/conversations/conversation-service.ts`, the imports currently read (lines 3–6):

```ts
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasBus } from '@core/types'
import { attachConversationContext, type ConversationContextFields } from './context-occupancy.js'
```

Add after line 6:

```ts
import { captureConversationMessage } from './l0-capture.js'
```

`addMessage` currently reads (lines 565–578):

```ts
    addMessage(conversationId: string, input: AddMessageInput): ConversationMessage {
      const now = new Date().toISOString()
      const tokensIn = input.tokensIn ?? 0
      const tokensOut = input.tokensOut ?? 0
      const attachmentsJson = JSON.stringify(input.attachmentIds ?? [])
      db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, tokens_in, tokens_out, attachments, created_at)
        VALUES (${conversationId}, ${input.role}, ${input.content}, ${input.model ?? null}, ${input.provider ?? null}, ${tokensIn}, ${tokensOut}, ${attachmentsJson}, ${now})`)
      const rows = db.all(sql`SELECT * FROM conversation_messages WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT 1`) as any[]
      const totalTokens = tokensIn + tokensOut
      if (totalTokens > 0) {
        db.run(sql`UPDATE conversations SET tokens_used = tokens_used + ${totalTokens}, updated_at = ${now} WHERE id = ${conversationId}`)
      }
      return toMessage(rows[0])
    },
```

Replace the last line `return toMessage(rows[0])` with:

```ts
      const message = toMessage(rows[0])
      // L0 capture at the persistence layer (spec §6) — covers every call site.
      captureConversationMessage(db, message)
      return message
```

- [ ] **Step 5: Run the unit test**

Run: `bun vitest run tests/modules/memory/v2/capture-conversations.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the God Mode regression test**

```ts
// tests/modules/memory/v2/capture-god-mode.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §17: "God Mode branch skips capture — capture at the persistence
// layer; regression test." The route's God Mode branch returns its own
// stream before the old post-turn capture block (routes.ts:691-706); both
// God Mode messages (the user's, routes.ts:694; the winner, god-mode/
// orchestrator.ts:684) go through addMessage, so L0 sees them.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner, getRawFromDrizzle } from '../../../helpers/test-db'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { attachIngest, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import type { AIProvider, StreamEvent } from '@modules/model/types'
import type { GodModeOrchestrator, StartGodModeInput } from '@modules/agent/god-mode/orchestrator'
import { silentLogger, testIngestConfig } from './helpers'

const testDb = createTestDb('capture-god-mode')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

describe('God Mode turn → L0 rows', () => {
  let app: Hono
  let db: any
  let conversationId: string
  let chatService: ReturnType<typeof createConversationService>
  let ingest: MemoryIngest
  let start: ReturnType<typeof vi.fn>

  beforeAll(async () => { await initZstd() })

  beforeEach(async () => {
    resetIngestBridge()
    db = testDb.open()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)

    const userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(): AsyncIterable<StreamEvent> {
        throw new Error('God Mode must not use the solo stream')
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    chatService = createConversationService(db)
    conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
    chatService.update(conversationId, { godMode: true, orchestration: 'auto', workingDirectories: ['/tmp/god-src'] })

    start = vi.fn(async (input: StartGodModeInput) => ({
      id: 'run-1', conversationId: input.conversationId, userMessageId: input.userMessageId, status: 'completed',
      winnerParticipantId: null, tieBroken: false, chairParticipantId: null, participantsSnapshot: [], isolation: 'none',
      sourceWorkingDirectory: input.sourceWorkingDirectory, totalTokens: 0, totalCostUsd: 0, durationMs: 0, error: null,
      insights: [], createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    }))
    const orchestrator = {
      start, cancel: async () => {}, cancelActive: vi.fn(async () => null), retryPromote: async () => {},
      get: () => null, listForConversation: () => [], hasActiveRun: () => false,
    } as unknown as GodModeOrchestrator
    const getGodMode = () => ({ orchestrator, enabled: true, limits: { min: 2, max: 5 }, getLiveKeys: () => new Set(['p1/m1', 'p1/m2']) })

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chatService, gateway, createProviderConfigService(db),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined,
      getGodMode,
    )
  })

  it('writes the user turn and the promoted winner to memory_raw with godMode provenance', async () => {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello ensemble' }),
    })
    expect(res.status).toBe(200)
    await res.text()
    expect(start).toHaveBeenCalledTimes(1)

    // What god-mode/orchestrator.ts:684 does after the race: promote the winner via addMessage.
    chatService.addMessage(conversationId, { role: 'assistant', content: 'the winning answer', model: 'm2', provider: 'p1' })

    const flushed = ingest.flushConversation(conversationId, 'manual')
    expect(flushed.rawRows).toBe(2)
    const rows = db.all(sql`SELECT source_type, actor, meta_json FROM memory_raw WHERE conversation_id = ${conversationId} ORDER BY rid`) as any[]
    expect(rows.map((r) => r.source_type)).toEqual(['user_message', 'assistant_message'])
    expect(JSON.parse(rows[0].meta_json)).toMatchObject({ godMode: true, origin: 'conversation_messages' })
    // The winner row's provenance, not just the user turn's. This conversation
    // has no agent_id, so it also pins the provider fallback tier of the actor
    // mapping — the tier that differs from the event-store path in Task 9.
    expect(rows[1].actor).toBe('p1')
    expect(JSON.parse(rows[1].meta_json)).toMatchObject({ godMode: true, origin: 'conversation_messages', model: 'm2' })
  })
})
```

- [ ] **Step 7: Run the God Mode test and the existing conversation suites**

Run: `bun vitest run tests/modules/memory/v2/capture-god-mode.test.ts tests/modules/conversations/god-mode-send.test.ts tests/modules/conversations/conversation-service.test.ts tests/modules/memory/capture-wiring.test.ts`
Expected: all PASS (the existing suites are unaffected: capture is a no-throw side effect).

- [ ] **Step 8: Commit**

```bash
git add src/modules/conversations/l0-capture.ts src/modules/conversations/conversation-service.ts tests/modules/memory/v2/capture-conversations.test.ts tests/modules/memory/v2/capture-god-mode.test.ts
git commit -m "feat(conversations): capture every persisted chat message into L0 (God Mode included)"
```

---

### Task 9: Hook `EventStore.append` for background `LlmResponse` outputs

**Files:**
- Create: `src/modules/event-store/l0-capture.ts`
- Modify: `src/modules/event-store/event-store.ts:5-11` (imports) and `:86-108` (`append`)
- Test: `tests/modules/memory/v2/capture-event-store.test.ts`, `tests/modules/memory/v2/capture-event-store-guard.test.ts`

**Interfaces:**
- Produces: `captureLlmResponse(db: EyasDb, sessionId: string, seq: number, ts: number, payload: Record<string, unknown>): void`.
- Consumes: `EventTypes.LlmResponse` (`event-store/types.ts:18-29`), payload shape written by `agent-runner.ts:476-482` (`{ response: { content: string; stopReason; usage: { inputTokens; outputTokens } } }`), `agent_sessions(id, conversation_id, agent_id)` (`agent/index.ts:157-169`, `run-supervisor.ts:125-137`).

**Where the hook lives, and why `EventStore.append` rather than `emitEvent` in agent-runner.ts:** `append` is the single persistence point for every `LlmResponse` (the live runner, resume paths, God Mode workers, tests), it already owns a `db` handle for the `agent_sessions` join the spec requires, and it matches the principle "L0 is fed at the persistence layer". `emitEvent` has no db and no reliable conversation id (`options.conversationId` is optional).

**Duplicate policy (spike §2 #21(ii), "choose one and justify"):** executeAgent (`agent/index.ts:578`) persists the run's final text with `addMessage` **after** the runner already emitted the same text as an `LlmResponse`; conversation-runner background runs never call `addMessage`, so there the event is the only copy. We **skip the later byte-identical assistant reply within 10 minutes for the same task** (implemented generically in the ingest, Task 6) rather than writing a second raw row plus a `part_of` link, because: (a) it is order-independent and needs no second pass (the message row does not exist yet when the event arrives); (b) a `part_of` row would leave two raw rows for one occurrence and make P1c extraction double-count the text; (c) the migration (P1d) applies the mirror rule offline (messages first, matching events skipped), so both paths converge on one row per occurrence. The surviving row here is the event's (it arrives first) and carries `meta.sessionId/seq/usage`; the skipped `addMessage` copy is logged at debug level. `CriticVerdict` and every other event type are never captured.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/capture-event-store.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Background runs never write conversation_messages (conversation-runner.ts
// ~818); their outputs exist only as LlmResponse events. Spec §15 Phase 1:
// "background runs produce L0 rows".

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { EventTypes } from '@modules/event-store/types'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest, type MemoryIngest } from '@modules/memory/v2/ingest'
import { attachIngest, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'
import { silentLogger, testIngestConfig } from './helpers'

function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUse(name: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'tool_use', id: 'tu', name, input: { q: 'x' } }], stopReason: 'tool_use', usage: { inputTokens: 2, outputTokens: 3 } }
}
function gatewayOf(responses: ModelResponse[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[i++] ?? makeText('done')),
    async *stream() { yield { type: 'done', response: responses[i++] ?? makeText('done') } as StreamEvent },
  } as unknown as ModelGateway
}
async function drain(gen: AsyncGenerator<any>) { for await (const _ of gen) { /* consume */ } }

let db: any
let enqueue: ReturnType<typeof vi.fn>

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  resetIngestBridge()
  db = createMemoryDb()
  createEventStoreTables(db)
  ensureRunSupervisionSchema(db)
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id, agent_id) VALUES ('conv-bg', 'p1', 'u1', 'agent-1')`)
  db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('sess-bg', 'conv-bg', 'agent-1', 'running', '2026-09-03T00:00:00Z')`)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

describe('agent_events LlmResponse → L0 capture', () => {
  it('captures an LlmResponse as an assistant_message of the session\'s conversation, attributed to the agent', async () => {
    const store = createEventStore(db)
    await store.append({ sessionId: 'sess-bg', ts: 1_700_000_000_000, type: EventTypes.LlmResponse, payload: { response: { content: 'what the run concluded', stopReason: 'end', usage: { inputTokens: 5, outputTokens: 7 } } } })
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      sourceType: 'assistant_message', actor: 'agent-1', conversationId: 'conv-bg', projectId: 'p1',
      occurredAtMs: 1_700_000_000_000, content: 'what the run concluded', trustTier: 'derived',
      meta: { origin: 'agent_events', sessionId: 'sess-bg', seq: 0, usage: { inputTokens: 5, outputTokens: 7 }, stopReason: 'end' },
    })
  })

  it('skips empty turns (tool-use only), other event types, and CriticVerdict', async () => {
    const store = createEventStore(db)
    await store.append({ sessionId: 'sess-bg', type: EventTypes.LlmResponse, payload: { response: { content: '', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } } } })
    await store.append({ sessionId: 'sess-bg', type: EventTypes.ToolCall, payload: { toolName: 'bash', input: {}, toolUseId: 't1' } })
    await store.append({ sessionId: 'sess-bg', type: EventTypes.CriticVerdict, payload: { verdict: 'complete' } })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('still appends when the session is unknown or agent_sessions does not exist', async () => {
    const store = createEventStore(db)
    await expect(store.append({ sessionId: 'sess-unknown', type: EventTypes.LlmResponse, payload: { response: { content: 'orphan', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } } })).resolves.toBe(0)
    db.run(sql`DROP TABLE agent_sessions`)
    await expect(store.append({ sessionId: 'sess-bg', type: EventTypes.LlmResponse, payload: { response: { content: 'no join table', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } } })).resolves.toBe(0)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('a background run through the real runner produces an L0 row', async () => {
    resetIngestBridge()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest: MemoryIngest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)

    const events = createEventStore(db)
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: 1 }, durationMs: 1 })) }
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('final answer')]), toolExecutor, eventStore: events } as any)
    await drain(runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'search_memory', description: 'x', inputSchema: { type: 'object' } }],
      maxTurns: 3, sessionId: 'sess-bg',
    } as any))

    expect(ingest.flushConversation('conv-bg', 'manual').rawRows).toBe(1)
    const rows = db.all(sql`SELECT source_type, actor, meta_json FROM memory_raw WHERE conversation_id = 'conv-bg'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_type: 'assistant_message', actor: 'agent-1' })
    expect(JSON.parse(rows[0].meta_json)).toMatchObject({ sessionId: 'sess-bg', origin: 'agent_events' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/capture-event-store.test.ts`
Expected: FAIL — first test `expected 1, received 0`.

- [ ] **Step 3: Write the hook module**

```ts
// src/modules/event-store/l0-capture.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L0 capture for background-run outputs. agent_events has no conversation
// column: the join is agent_events.session_id = agent_sessions.id →
// agent_sessions.conversation_id, and the actor is agent_sessions.agent_id
// (agent_events.actor is NULL on every live row — spike §2 #21(ii)). Only
// LlmResponse is captured; CriticVerdict and the rest are run bookkeeping.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { captureUnit } from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope } from '@modules/memory/v2/scope.js'

interface LlmResponseShape {
  content?: unknown
  stopReason?: unknown
  usage?: unknown
}

export function captureLlmResponse(
  db: EyasDb,
  sessionId: string,
  seq: number,
  ts: number,
  payload: Record<string, unknown>,
): void {
  try {
    const response = (payload as { response?: LlmResponseShape }).response
    const content = typeof response?.content === 'string' ? response.content : ''
    if (!content.trim()) return
    const session = db.all<{ conversation_id: string | null; agent_id: string | null }>(
      sql`SELECT conversation_id, agent_id FROM agent_sessions WHERE id = ${sessionId}`,
    )[0]
    if (!session?.conversation_id) return
    const scope = resolveConversationScope(db, session.conversation_id)
    captureUnit({
      id: generateId(),
      sourceType: 'assistant_message',
      actor: session.agent_id ?? scope.agentId ?? 'agent',
      conversationId: session.conversation_id,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: ts,
      content,
      // Model-authored text: 'derived', not 'owner'. Matches the addMessage
      // path, and keeps trust_tier = min(sources) meaningful downstream.
      trustTier: 'derived',
      meta: {
        origin: 'agent_events',
        sessionId,
        seq,
        usage: response?.usage ?? null,
        stopReason: response?.stopReason ?? null,
      },
    })
  } catch {
    /* the event is already persisted; capture is best-effort */
  }
}
```

- [ ] **Step 4: Wire it into `append`**

In `src/modules/event-store/event-store.ts` the import block currently reads (lines 5–11):

```ts
import {
  AgentEvent,
  AgentEventSchema,
  AppendEventInput,
  EventQueryOptions,
  validateEventPayload,
} from './types.js'
```

Change it to:

```ts
import {
  AgentEvent,
  AgentEventSchema,
  AppendEventInput,
  EventQueryOptions,
  EventTypes,
  validateEventPayload,
} from './types.js'
import { captureLlmResponse } from './l0-capture.js'
```

In `append` (lines 86–108) the successful insert currently reads:

```ts
      try {
        dbAny.run(
          sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload)
              VALUES (${sessionId}, ${nextSeq}, ${ts}, ${parsed.type}, ${parsed.actor ?? null}, ${JSON.stringify(validatedPayload)})`,
        )
        return nextSeq
      } catch (err: any) {
```

Change the two lines `        return nextSeq` into:

```ts
        // L0 capture at the persistence layer (spec §6): background outputs
        // never reach conversation_messages, this is their only copy.
        //
        // Guarded HERE, not only inside captureLlmResponse: this call sits in
        // the UNIQUE-collision retry `try`, so a throw would be read as an
        // insert failure. If its message happened to contain "constraint" the
        // loop would `continue` and INSERT again — up to 8 duplicate event
        // rows in the agent replay log. The capture path swallows its own
        // errors today; this makes that independent of three other files
        // continuing to do so.
        if (parsed.type === EventTypes.LlmResponse) {
          try {
            captureLlmResponse(db, sessionId, nextSeq, ts, validatedPayload as Record<string, unknown>)
          } catch {
            /* the event row is already committed; capture is best-effort */
          }
        }
        return nextSeq
```

- [ ] **Step 4b: Pin that a throwing capture cannot destabilise `append`**

The guard above is only as good as a test that fails without it. This needs its
own file, because it mocks the capture module for the whole module graph.

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The L0 capture call lives inside append()'s UNIQUE-collision retry `try`.
// A throw there is indistinguishable from an insert failure, and if its message
// contains "constraint" the loop retries the INSERT — writing duplicate rows
// into the agent replay log. Its own file lives in a separate test file because
// it has to mock the capture module for the whole module graph.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { EventTypes } from '@modules/event-store/types'

vi.mock('@modules/event-store/l0-capture.js', () => ({
  captureLlmResponse: () => {
    throw new Error('SQLITE_CONSTRAINT: the capture path threw')
  },
}))

let db: any

beforeEach(() => {
  db = createMemoryDb()
  createEventStoreTables(db)
})

describe('append() is not destabilised by a throwing L0 capture', () => {
  it('still returns the seq and writes exactly one event row', async () => {
    const store = createEventStore(db)
    const payload = { response: { content: 'the run concluded', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } } }
    await expect(store.append({ sessionId: 's1', type: EventTypes.LlmResponse, payload })).resolves.toBe(0)
    const rows = db.all(sql`SELECT seq FROM agent_events WHERE session_id = 's1'`) as any[]
    expect(rows.map((r) => r.seq)).toEqual([0])
  })
})
```

Run: `bun vitest run tests/modules/memory/v2/capture-event-store-guard.test.ts`
Expected: PASS (1 test). Without the `try`/`catch` added in Step 4 it fails with
`EventStoreError: Failed to append event after 8 attempts` — the retry loop
having inserted eight duplicate rows.

- [ ] **Step 5: Run the new test and the existing event-store / runner suites**

Run: `bun vitest run tests/modules/memory/v2/capture-event-store.test.ts tests/modules/event-store tests/modules/agent/agent-runner-capture.test.ts tests/modules/agent/conversation-runner.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/event-store/l0-capture.ts src/modules/event-store/event-store.ts tests/modules/memory/v2/capture-event-store.test.ts tests/modules/memory/v2/capture-event-store-guard.test.ts
git commit -m "feat(event-store): capture background LlmResponse outputs into L0 via the session join"
```

---

### Task 10: Tool executor — `sessionId` on the log entry and the opt-in `tool_result` hook

**Files:**
- Modify: `src/modules/tools/tool-executor.ts:24-33` (`ExecutionLogEntry`) and every `options.logExecution?.({` literal in `execute()` (seven in the current tree: lines 315, 347, 373, 415, 437, 506, 536)
- Create: `src/modules/tools/l0-capture.ts`
- Modify: `src/modules/tools/index.ts:60-65` (`logExecution`)
- Modify (comments only): `src/core/config/schema.ts`, `config/default.yaml` — the operator-facing warning on `captureToolResults`
- Test: `tests/modules/memory/v2/capture-tools.test.ts`

**Interfaces:**
- Produces: `ExecutionLogEntry.sessionId?: string`; `captureToolResult(db: EyasDb, entry: ExecutionLogEntry, isEnabled: () => boolean): void`.
- Consumes: `ToolContext.sessionId?: string` (`tools/types.ts:51`), `ExecutionLogEntry` (`tool-executor.ts:24-33`), config `memory.l0.captureToolResults` (P1a schema; default `false` — Phase 1b is opt-in until the privacy `collectSegments` `tool_result` arm from plan p1e lands).
- Policy: capture only `success === true` entries with a non-empty output and a `conversationId` (a tool call outside a task has no L0 home; denials and failures stay in `tool_executions`); content = `JSON.stringify(output)`; the 8 KB cap is applied by the ingest (`toolResultMaxBytes`, Task 6); trust `ingested`; actor = `agentId ?? 'tool'`; `meta = { origin: 'tool_executions', toolName, sessionId, durationMs, input (JSON clipped to 2 048 chars) }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/capture-tools.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 1b (spec §16-4): tool results into L0, 8 KB cap, `ingested` trust,
// opt-in via memory.l0.captureToolResults.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, type ExecutionLogEntry } from '@modules/tools/tool-executor'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import { captureToolResult } from '@modules/tools/l0-capture'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { attachIngest, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { initZstd } from '@shared/zstd'
import { silentLogger, testIngestConfig } from './helpers'

function echoTool(): ToolImplementation {
  return {
    name: 'echo', description: 'Echo', category: 'custom', riskTier: 'green', inputSchema: {},
    execute: vi.fn(async (input: Record<string, unknown>) => ({ echoed: input })),
  }
}
function ctx(extra: Partial<ToolContext> = {}): ToolContext {
  return { conversationId: 'c1', userId: 'u1', agentId: 'a1', sessionId: 's1', logger: silentLogger, ...extra } as ToolContext
}
function entry(overrides: Partial<ExecutionLogEntry> = {}): ExecutionLogEntry {
  return { toolName: 'echo', input: { a: 1 }, output: { echoed: { a: 1 } }, success: true, durationMs: 3, timestamp: '2026-09-03T10:00:00.000Z', conversationId: 'c1', agentId: 'a1', sessionId: 's1', ...overrides }
}

let db: any
let enqueue: ReturnType<typeof vi.fn>

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  resetIngestBridge()
  db = createMemoryDb()
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, agent_id TEXT, god_mode INTEGER DEFAULT 0, parent_conversation_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, project_id, user_id) VALUES ('c1', 'p1', 'u1')`)
  enqueue = vi.fn()
  attachIngest({ enqueue, flushConversation: vi.fn(), sweepIdle: vi.fn(), onFlushed: vi.fn(), flushAll: vi.fn(), bufferedUnits: vi.fn() } as any)
})

describe('tool executor log entry', () => {
  it('carries the session id from the tool context', async () => {
    const registry = createToolRegistry()
    registry.register(echoTool())
    const logExecution = vi.fn()
    const exec = createToolExecutor(registry, { authorization: 'disabled', logExecution })
    await exec.execute('echo', { a: 1 }, ctx())
    expect(logExecution).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'echo', success: true, conversationId: 'c1', agentId: 'a1', sessionId: 's1' }))
  })

  it('stamps sessionId on every logExecution call site (source contract)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/tools/tool-executor.ts'), 'utf-8')
    const sites = (source.match(/options\.logExecution\?\.\(\{/g) ?? []).length
    const stamped = (source.match(/sessionId: ctx\?\.sessionId,/g) ?? []).length
    expect(sites).toBeGreaterThanOrEqual(6)
    expect(stamped).toBe(sites)
  })
})

describe('tools/index.ts wiring (source contract)', () => {
  // The six behavioural tests below call captureToolResult directly with a
  // hand-made gate. Nothing else proves the real logExecution calls it, or
  // that the config path it reads is spelled correctly — delete that one line
  // or typo the property chain and every other test still passes.
  const source = readFileSync(resolve(process.cwd(), 'src/modules/tools/index.ts'), 'utf-8')
  it('calls captureToolResult from logExecution, gated on the config flag', () => {
    expect(source).toMatch(/captureToolResult\(ctx\.db, entry,/)
    expect(source).toMatch(/memory\?\.l0\?\.captureToolResults === true/)
  })
})

describe('captureToolResult', () => {
  it('captures nothing while memory.l0.captureToolResults is off', () => {
    captureToolResult(db, entry(), () => false)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('captures a successful result as an ingested tool_result unit with provenance', () => {
    captureToolResult(db, entry(), () => true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      sourceType: 'tool_result', actor: 'a1', conversationId: 'c1', projectId: 'p1',
      occurredAtMs: Date.parse('2026-09-03T10:00:00.000Z'), content: JSON.stringify({ echoed: { a: 1 } }), trustTier: 'ingested',
      meta: { origin: 'tool_executions', toolName: 'echo', sessionId: 's1', durationMs: 3, input: JSON.stringify({ a: 1 }) },
    })
  })

  it('skips failures, empty outputs and calls without a conversation', () => {
    captureToolResult(db, entry({ success: false, error: 'boom', output: undefined }), () => true)
    captureToolResult(db, entry({ output: {} }), () => true)
    captureToolResult(db, entry({ conversationId: undefined }), () => true)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('applies the 8 KB cap at flush and keeps the marker', () => {
    resetIngestBridge()
    const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, caps)
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    attachIngest(ingest)
    captureToolResult(db, entry({ output: { big: 'Z'.repeat(20_000) } }), () => true)
    ingest.flushConversation('c1', 'manual')
    const blob = (db.all(sql`SELECT byte_length FROM memory_blob`) as any[])[0]
    expect(blob.byte_length).toBeLessThan(8_192 + 80)
    const row = (db.all(sql`SELECT meta_json, trust_tier FROM memory_raw`) as any[])[0]
    expect(row.trust_tier).toBe('ingested')
    expect(JSON.parse(row.meta_json)).toMatchObject({ truncated: true, originalBytes: expect.any(Number) })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/capture-tools.test.ts`
Expected: FAIL — `Cannot find module '@modules/tools/l0-capture'`.

- [ ] **Step 3: Add `sessionId` to `ExecutionLogEntry` and every call site**

In `src/modules/tools/tool-executor.ts` the interface currently reads (lines 24–33):

```ts
export interface ExecutionLogEntry {
  toolName: string
  conversationId?: string
  agentId?: string
  input: Record<string, unknown>
  output?: ToolResult
  error?: string
  success: boolean
  durationMs: number
  timestamp: string
}
```

Change it to:

```ts
export interface ExecutionLogEntry {
  toolName: string
  conversationId?: string
  agentId?: string
  /** Agent session id (== agent_sessions.id) when the call ran inside a supervised run. */
  sessionId?: string
  input: Record<string, unknown>
  output?: ToolResult
  error?: string
  success: boolean
  durationMs: number
  timestamp: string
}
```

Then, inside `execute()`, every `options.logExecution?.({ … })` object literal ends with the pair

```ts
          conversationId: ctx?.conversationId,
          agentId: ctx?.agentId,
```

(indented 10 or 12 spaces depending on the site). Add one line after each `agentId: ctx?.agentId,` **inside those literals only** — not in `emitExecuted` (lines 288–293, the same pair at 8 spaces), and not in the `gate.validateToolCall(...)` (line 193) or `autonomy.createApproval({...})` (line 256) argument objects, which carry `agentId: ctx?.agentId,` too; the source-contract test in Step 1 requires the stamped count to equal the seven `options.logExecution?.({` sites exactly:

```ts
          sessionId: ctx?.sessionId,
```

The success site (lines 506–515) becomes, verbatim:

```ts
        options.logExecution?.({
          toolName,
          input: validatedInput,
          output: finalOutput,
          success: true,
          durationMs: result.durationMs,
          timestamp: new Date().toISOString(),
          conversationId: ctx?.conversationId,
          agentId: ctx?.agentId,
          sessionId: ctx?.sessionId,
        })
```

and the catch site (lines 536–545):

```ts
        options.logExecution?.({
          toolName,
          input: validatedInput,
          success: false,
          error,
          durationMs: result.durationMs,
          timestamp: new Date().toISOString(),
          conversationId: ctx?.conversationId,
          agentId: ctx?.agentId,
          sessionId: ctx?.sessionId,
        })
```

The other five (`Tool not found` at 315, security-gate denial at 347, PreToolUse denial at 373, Zod `INVALID_INPUT` at 415, not-an-object at 437) get the identical one-line addition. The source-contract test in Step 1 counts them.

- [ ] **Step 4: Write the hook module**

```ts
// src/modules/tools/l0-capture.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Phase 1b L0 capture for tool results (spec §16-4): only successful
// outputs inside a task, `ingested` trust, byte-capped by the ingest
// (memory.l0.toolResultMaxBytes), and OFF unless memory.l0.captureToolResults
// is set.
//
// What "off by default" is protecting against, precisely. `content` is
// JSON.stringify(entry.output) — the whole tool result, verbatim and
// unredacted — and `meta.input` carries 2 048 clipped but equally unredacted
// characters of the call's arguments. `run_command` returns raw stdout,
// `read_file` returns file contents, and `browser_totp` returns a live
// one-time auth code. Nothing here redacts, and nothing encrypts at rest:
// `dek_id` is written NULL, and the blob is zstd-compressed, which is not
// confidentiality.
//
// Do NOT read plan p1e as making this safe. Its Task 11 teaches
// privacy.collectSegments to scan `tool_result` blocks on their way INTO a
// prompt; it does not touch what this function has already written into
// memory_raw. At-rest scanning of L0 is unscoped work.

import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { captureUnit } from '@modules/memory/v2/ingest-bridge.js'
import { resolveConversationScope } from '@modules/memory/v2/scope.js'
import type { ExecutionLogEntry } from './tool-executor.js'

const META_INPUT_MAX_CHARS = 2_048

function clipJson(value: unknown, maxChars: number): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    text = '"[unserialisable]"'
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

export function captureToolResult(db: EyasDb, entry: ExecutionLogEntry, isEnabled: () => boolean): void {
  try {
    if (!isEnabled()) return
    if (!entry.success || !entry.output || !entry.conversationId) return
    const content = JSON.stringify(entry.output)
    if (!content || content === '{}') return
    const scope = resolveConversationScope(db, entry.conversationId)
    const occurredAtMs = Date.parse(entry.timestamp)
    captureUnit({
      id: generateId(),
      sourceType: 'tool_result',
      actor: entry.agentId ?? 'tool',
      conversationId: entry.conversationId,
      projectId: scope.projectId,
      projectTypeId: scope.projectTypeId,
      occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now(),
      content,
      trustTier: 'ingested',
      meta: {
        origin: 'tool_executions',
        toolName: entry.toolName,
        sessionId: entry.sessionId ?? null,
        durationMs: entry.durationMs,
        input: clipJson(entry.input, META_INPUT_MAX_CHARS),
      },
    })
  } catch {
    /* the tool_executions row is already written; capture is best-effort */
  }
}
```

- [ ] **Step 5: Wire it into `tools/index.ts`**

`logExecution` currently reads (lines 60–65):

```ts
      logExecution: (entry) => {
        ctx.db.run(sql`INSERT INTO tool_executions (conversation_id, agent_id, tool_name, input, output, error, success, duration_ms, created_at)
          VALUES (${entry.conversationId ?? null}, ${entry.agentId ?? null}, ${entry.toolName},
                  ${JSON.stringify(entry.input)}, ${entry.output ? JSON.stringify(entry.output) : null},
                  ${entry.error ?? null}, ${entry.success ? 1 : 0}, ${entry.durationMs}, ${entry.timestamp})`)
      },
```

Change it to:

```ts
      logExecution: (entry) => {
        ctx.db.run(sql`INSERT INTO tool_executions (conversation_id, agent_id, tool_name, input, output, error, success, duration_ms, created_at)
          VALUES (${entry.conversationId ?? null}, ${entry.agentId ?? null}, ${entry.toolName},
                  ${JSON.stringify(entry.input)}, ${entry.output ? JSON.stringify(entry.output) : null},
                  ${entry.error ?? null}, ${entry.success ? 1 : 0}, ${entry.durationMs}, ${entry.timestamp})`)
        // Phase 1b L0 capture — read the flag per call so `config reload` applies.
        captureToolResult(ctx.db, entry, () => (ctx.config as any)?.memory?.l0?.captureToolResults === true)
      },
```

and add the import after line 9 (`import { createToolSuggester } from './tool-suggester.js'`):

```ts
import { captureToolResult } from './l0-capture.js'
```

- [ ] **Step 5b: Warn where the flag is actually flipped**

The doc comment above is in a file an operator never opens. Add the same warning
to the two places the flag is read and edited. **Comments only — the schema, the
defaults and the key names are P1a's and do not change.**

In `src/core/config/schema.ts`, above `captureToolResults`:

```ts
      enabled: z.boolean().default(true),
      // Off for a reason: a captured tool result is stored verbatim and
      // unredacted, and nothing scans or encrypts it at rest. run_command's
      // stdout, read_file's contents and browser_totp's one-time code would
      // all land in memory_raw as-is. Turn it on only where that is acceptable.
      captureToolResults: z.boolean().default(false),
```

In `config/default.yaml`, above the same key:

```yaml
    enabled: true
    # Off for a reason: a captured tool result is stored verbatim and
    # unredacted, and nothing scans or encrypts it at rest — run_command's
    # stdout, read_file's contents and browser_totp's one-time code included.
    captureToolResults: false
```

- [ ] **Step 6: Run the new test and the executor suites**

Run: `bun vitest run tests/modules/memory/v2/capture-tools.test.ts tests/modules/tools/executor-authorization.test.ts tests/modules/tools/aci-executor-integration.test.ts`
Expected: all PASS. Then `bun run lint` — no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/tools/tool-executor.ts src/modules/tools/l0-capture.ts src/modules/tools/index.ts src/core/config/schema.ts config/default.yaml tests/modules/memory/v2/capture-tools.test.ts
git commit -m "feat(tools): sessionId on execution log entries and opt-in tool_result capture into L0"
```

---

### Task 11: Wire it all in `memory/index.ts` — `ctx.memoryIngest`, flush job, task-close flush, shutdown flush

**Files:**
- Create: `src/modules/memory/v2/wire.ts`
- Modify: `src/modules/memory/index.ts:25-30` (imports), `:268-270` (after the `memoryCapture` block, before `createMemoryRoutes`), `:392-395` (`onStop`)
- Test: `tests/modules/memory/v2/wire.test.ts`

**Interfaces:**
- Produces: `export interface L0WireConfig { enabled: boolean; toolResultMaxBytes: number; idleFlushMinutes: number; chunkTokens: number }`; `export interface L0WireContext { db: EyasDb; logger: Logger; caps: SqliteCapabilities; instanceId: string; config: () => L0WireConfig; bus?: Pick<EyasBus, 'on'>; scheduler?: FlushJobScheduler }`; `export async function wireL0Capture(ctx: L0WireContext): Promise<MemoryIngest | null>`. `memory/index.ts` publishes the result as `(ctx as any).memoryIngest` (contract) — P1c reads `ctx.memoryIngest.onFlushed`. **P1c Task 11 modifies `wire.ts` in place** (the only other plan that touches it): it inserts the single `ingest.onFlushed((conversationId, reason) => runExtraction(...))` statement between the `createMemoryIngest({ … })` call and `attachIngest(ingest, logger)`, and adds `engine?: 'legacy' | 'v2'` / `extractInLegacy?: boolean` to `L0WireConfig` — keep those two statements adjacent so the insertion point stays unambiguous.
- Consumes: `initZstd(): Promise<'bun'|'node'|'wasm'>` and `ZstdUnavailableError` (P1a `@shared/zstd`), `getSqliteCapabilities()` / `probeSqliteCapabilities()` (P1a), `getInstanceId(db)` (P1a `@modules/memory/v2/instance`), `getRawDatabase()` (`@core/db/connection`, already imported at `memory/index.ts:30`), bus events `eyas.conversations.closed` (`conversation-service.ts:559, 590`, payload `{ conversationId, status }`) and `eyas.conversations.stage_changed` (`:553`, payload `{ conversationId, fromStageId, toStageId }`), `stages.is_closed` (`board/schema.ts:51`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/wire.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The wiring is extracted from memory/index.ts onStart (same reason as
// reflection-job.ts) so the real code runs here against fakes.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { wireL0Capture, type L0WireConfig } from '@modules/memory/v2/wire'
import { captureUnit, pendingUnits, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import * as zstd from '@shared/zstd'
import { FLUSH_JOB_NAME, FLUSH_HANDLER_KEY } from '@modules/memory/v2/flush-job'
import { makeV2Db, makeUnit, silentLogger } from './helpers'

type Handler = (data: unknown) => Promise<void>

function fakeBus() {
  const handlers = new Map<string, Handler[]>()
  return {
    on: vi.fn((subject: string, handler: Handler) => {
      handlers.set(subject, [...(handlers.get(subject) ?? []), handler])
      return { subject, id: 'x', unsubscribe() {} }
    }),
    emit: async (subject: string, data: unknown) => { for (const h of handlers.get(subject) ?? []) await h(data) },
  }
}
function fakeScheduler() {
  const handlers = new Map<string, () => Promise<unknown>>()
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    list: () => [] as Array<{ name?: string }>,
    create: vi.fn(),
    handlers,
  }
}
const config = (over: Partial<L0WireConfig> = {}): L0WireConfig => ({ enabled: true, toolResultMaxBytes: 8_192, idleFlushMinutes: 30, chunkTokens: 8_000, captureToolResults: false, ...over })

beforeEach(() => resetIngestBridge())

describe('wireL0Capture', () => {
  it('attaches the bridge (draining early units), registers the sweep, and flushes on task close and closed-stage moves', async () => {
    const { db, caps } = makeV2Db()
    db.run(sql`CREATE TABLE stages (id TEXT PRIMARY KEY, is_closed INTEGER NOT NULL DEFAULT 0)`)
    db.run(sql`INSERT INTO stages VALUES ('open', 0), ('done', 1)`)
    const early = makeUnit({ conversationId: 'conv-early' })
    captureUnit(early)
    const bus = fakeBus()
    const scheduler = fakeScheduler()

    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config(), bus, scheduler })
    expect(ingest).not.toBeNull()
    expect(pendingUnits()).toBe(0)
    expect(ingest!.bufferedUnits()).toBe(1)
    expect(scheduler.handlers.has(FLUSH_HANDLER_KEY)).toBe(true)
    expect(scheduler.create).toHaveBeenCalledWith(expect.objectContaining({ name: FLUSH_JOB_NAME }))

    const flushed = vi.fn()
    ingest!.onFlushed(flushed)
    await bus.emit('eyas.conversations.closed', { conversationId: 'conv-early', status: 'archived' })
    expect(flushed).toHaveBeenCalledWith('conv-early', 'close')

    captureUnit(makeUnit({ conversationId: 'conv-stage' }))
    await bus.emit('eyas.conversations.stage_changed', { conversationId: 'conv-stage', fromStageId: 'open', toStageId: 'open' })
    expect(ingest!.bufferedUnits()).toBe(1)
    await bus.emit('eyas.conversations.stage_changed', { conversationId: 'conv-stage', fromStageId: 'open', toStageId: 'done' })
    expect(flushed).toHaveBeenCalledWith('conv-stage', 'close')
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_raw`) as any[])[0].c).toBe(2)
  })

  it('returns null and disables the bridge when memory.l0.enabled is false', async () => {
    const { db, caps } = makeV2Db()
    captureUnit(makeUnit())
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config({ enabled: false }) })
    expect(ingest).toBeNull()
    expect(pendingUnits()).toBe(0)
    captureUnit(makeUnit())
    expect(pendingUnits()).toBe(0)
  })

  it('disables the bridge when no zstd tier is available, instead of buffering forever', async () => {
    const { db, caps } = makeV2Db()
    const boom = new Error('no zstd backend available')
    const spy = vi.spyOn(zstd, 'initZstd').mockRejectedValueOnce(boom as never)
    try {
      const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config() })
      expect(ingest).toBeNull()
      // Not merely "not attached" — actively disabled, so the hooks that keep
      // calling captureUnit do not fill a queue nothing will ever drain.
      captureUnit(makeUnit())
      expect(pendingUnits()).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })

  it('warns at boot when tool-result capture is on, and stays quiet when it is off', async () => {
    const { db, caps } = makeV2Db()
    const loud = { ...silentLogger, warn: vi.fn() }
    await wireL0Capture({ db, caps, logger: loud as any, instanceId: 'inst-test', config: () => config({ captureToolResults: true }) })
    expect(loud.warn).toHaveBeenCalledWith(expect.stringContaining('captureToolResults is ON'))

    resetIngestBridge()
    const quiet = { ...silentLogger, warn: vi.fn() }
    await wireL0Capture({ db, caps, logger: quiet as any, instanceId: 'inst-test', config: () => config() })
    expect(quiet.warn).not.toHaveBeenCalled()
  })

  it('works without a bus or a scheduler (explicit and idle flush only)', async () => {
    const { db, caps } = makeV2Db()
    const ingest = await wireL0Capture({ db, caps, logger: silentLogger, instanceId: 'inst-test', config: () => config() })
    expect(ingest).not.toBeNull()
    captureUnit(makeUnit())
    expect(ingest!.flushConversation('conv-1', 'manual').rawRows).toBe(1)
  })
})

describe('memory/index.ts wiring (source contract)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/memory/index.ts'), 'utf-8')
  it('calls wireL0Capture in onStart and publishes ctx.memoryIngest', () => {
    expect(source).toMatch(/wireL0Capture\(/)
    expect(source).toMatch(/\.memoryIngest = /)
  })
  it('flushes the buffers on stop', () => {
    expect(source).toMatch(/memoryIngest\?\.flushAll\('manual'\)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/wire.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/wire'`.

- [ ] **Step 3: Write `wire.ts`**

```ts
// src/modules/memory/v2/wire.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Everything memory/index.ts needs to turn the bridge into a live L0 writer,
// in one testable function: zstd init, ingest, bridge attach, the idle
// sweep on the scheduler, and the task-close flush from the bus.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasBus, EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { initZstd } from '@shared/zstd.js'
import { createMemoryIngest, type MemoryIngest, type FlushReason } from './ingest.js'
import { attachIngest, disableIngestBridge } from './ingest-bridge.js'
import { registerFlushJob, type FlushJobScheduler } from './flush-job.js'

export interface L0WireConfig {
  enabled: boolean
  toolResultMaxBytes: number
  idleFlushMinutes: number
  chunkTokens: number
  /** Read only to warn at boot; the tool hook reads the flag itself per call. */
  captureToolResults: boolean
}

export interface L0WireContext {
  db: EyasDb
  logger: Logger
  caps: SqliteCapabilities
  instanceId: string
  /** Read per call so `config reload` takes effect without a restart. */
  config: () => L0WireConfig
  bus?: Pick<EyasBus, 'on'>
  scheduler?: FlushJobScheduler
}

function isClosedStage(db: EyasDb, stageId: string): boolean {
  try {
    const row = db.all<{ is_closed: number | null }>(sql`SELECT is_closed FROM stages WHERE id = ${stageId}`)[0]
    return Number(row?.is_closed ?? 0) === 1
  } catch {
    return false
  }
}

export async function wireL0Capture(ctx: L0WireContext): Promise<MemoryIngest | null> {
  const { db, logger, caps, instanceId } = ctx
  if (!ctx.config().enabled) {
    disableIngestBridge()
    logger.info('L0 capture disabled (memory.l0.enabled=false); nothing is recorded')
    return null
  }
  try {
    const tier = await initZstd()
    logger.info({ tier }, 'L0 capture: zstd ready')
  } catch (err) {
    // A Node without zlib zstd (23.0–23.7) and without the WASM package.
    // Loud, never silent (spike §2 #13). Disable rather than just returning:
    // the hooks are static imports in other modules and keep calling
    // captureUnit regardless, so an un-disabled bridge would buffer 5 000
    // units and then silently evict the oldest for the rest of the process,
    // with nothing that ever reports it.
    disableIngestBridge()
    logger.error({ err }, 'L0 capture unavailable: no zstd tier (Bun, Node >= 22.15, or @bokuweb/zstd-wasm required); capture is off')
    return null
  }

  const ingest = createMemoryIngest({
    db,
    caps,
    instanceId,
    logger,
    config: () => {
      const c = ctx.config()
      return { toolResultMaxBytes: c.toolResultMaxBytes, idleFlushMinutes: c.idleFlushMinutes, chunkTokens: c.chunkTokens }
    },
  })
  attachIngest(ingest, logger)

  if (ctx.scheduler && typeof ctx.scheduler.registerHandler === 'function') {
    try {
      registerFlushJob(ctx.scheduler, ingest)
    } catch (err) {
      // Same shape as memory.team_memory.retention's own try/catch in
      // memory/index.ts: a scheduler hiccup (list()/create() throwing) must
      // not sink the rest of the memory module's onStart over one cron job.
      // The idle sweep is lost for this boot; flush still happens on task
      // close, chunk and shutdown.
      logger.warn({ err }, 'L0 capture: flush job registration failed — idle sweep will not run this boot')
    }
  } else {
    logger.debug('L0 capture: scheduler unavailable — idle buffers flush only on task close, chunk or shutdown')
  }

  const safeFlush = (conversationId: string, reason: FlushReason): void => {
    try {
      ingest.flushConversation(conversationId, reason)
    } catch {
      /* logged inside the ingest; the units stay buffered */
    }
  }

  if (ctx.bus) {
    ctx.bus.on('eyas.conversations.closed', async (data) => {
      const id = (data as { conversationId?: string } | undefined)?.conversationId
      if (id) safeFlush(id, 'close')
    })
    ctx.bus.on('eyas.conversations.stage_changed', async (data) => {
      const d = data as { conversationId?: string; toStageId?: string | null } | undefined
      if (d?.conversationId && d.toStageId && isClosedStage(db, d.toStageId)) safeFlush(d.conversationId, 'close')
    })
  }

  if (ctx.config().captureToolResults) {
    // The flag can be set by anything that writes YAML. The written warnings
    // sit in three files nobody re-reads; this is the one place it surfaces at
    // runtime that tool output is being persisted verbatim and unredacted.
    logger.warn('L0 capture: memory.l0.captureToolResults is ON — tool results are stored verbatim and unredacted, and nothing scans or encrypts them at rest')
  }

  return ingest
}
```

- [ ] **Step 4: Wire it into `memory/index.ts`**

The import block currently ends (lines 25–30):

```ts
import { createCompletedRunsPort } from '@modules/agent/completed-runs.js'
import { createModelBridge } from './embeddings/model-bridge.js'
import { createVecStore } from './embeddings/vec-store.js'
import { createEmbeddingService } from './embeddings/embedding-service.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'
import { getRawDatabase } from '@core/db/connection'
```

Add after line 30:

```ts
import { getSqliteCapabilities, probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { getInstanceId } from './v2/instance.js'
import { wireL0Capture } from './v2/wire.js'
import { detachIngest, disableIngestBridge } from './v2/ingest-bridge.js'
```

In `onStart`, the `memoryCapture` block ends at line 268 with `    })` and line 270 reads `    const { createMemoryRoutes } = await import('./routes.js')`. Insert between them:

```ts
    // ── L0 capture (sovereign memory v2, plan p1b) ─────────────────────────
    // The bridge has been buffering since the first addMessage of this boot;
    // attaching here drains it. Capabilities come from the main connection's
    // probe (p1a); the fallback probe covers a test harness without one.
    let caps: SqliteCapabilities | null = null
    try {
      caps = getSqliteCapabilities()
    } catch {
      try { caps = probeSqliteCapabilities(getRawDatabase(), ctx.logger) } catch { caps = null }
    }
    if (caps) {
      const ingest = await wireL0Capture({
        db: ctx.db,
        logger: ctx.logger,
        caps,
        instanceId: getInstanceId(ctx.db),
        bus: ctx.bus,
        scheduler: (ctx as any).scheduler,
        // Defaults mirror config/schema.ts memory.l0; read fresh per call.
        config: () => {
          const c = (ctx.config as any)?.memory?.l0 ?? {}
          return {
            enabled: c.enabled ?? true,
            toolResultMaxBytes: c.toolResultMaxBytes ?? 8_192,
            idleFlushMinutes: c.idleFlushMinutes ?? 30,
            chunkTokens: c.chunkTokens ?? 8_000,
            captureToolResults: c.captureToolResults === true,
          }
        },
      })
      ;(ctx as any).memoryIngest = ingest ?? undefined
    } else {
      // Same reason as wire.ts's zstd-failure path: the capture hooks live in
      // other modules and keep calling captureUnit whatever happens here, so
      // the bridge has to be told to stop rather than left buffering into a
      // queue nothing will ever drain.
      disableIngestBridge()
      ctx.logger.warn('L0 capture skipped: SQLite capabilities could not be probed; capture is off')
    }

```

`onStop` currently reads (lines 392–395):

```ts
  async onStop(ctx: ModuleContext) {
    const watcher = (ctx as any).vaultWatcher
    if (watcher && typeof watcher.stop === 'function') watcher.stop()
  },
```

Change it to:

```ts
  async onStop(ctx: ModuleContext) {
    const watcher = (ctx as any).vaultWatcher
    if (watcher && typeof watcher.stop === 'function') watcher.stop()
    // Whatever is still buffered belongs to L0 — a restart must not lose it.
    try {
      const flushed = (ctx as any).memoryIngest?.flushAll('manual')
      if (flushed) ctx.logger.info({ conversations: flushed }, 'L0 capture: buffers flushed on stop')
    } catch (err) {
      ctx.logger.warn({ err }, 'L0 capture: flush on stop failed')
    }
    // bootstrap closes the database right after this. Leaving the bridge
    // attached would point a straggling captureUnit at an ingest holding a
    // closed connection.
    detachIngest()
  },
```

Note: `createMemoryV2Tables(ctx.db, caps)` belongs in `onRegister` and is added by plan **p1a-foundation**. If, when you execute this task, `memory/index.ts` `onRegister` does not yet call it, add exactly this after line 46 (`createMemoryTables(ctx.db)`), guarded the same way as above:

```ts
    try {
      const { createMemoryV2Tables } = await import('./v2/schema.js')
      let v2caps: SqliteCapabilities
      try { v2caps = getSqliteCapabilities() } catch { v2caps = probeSqliteCapabilities(getRawDatabase(), ctx.logger) }
      createMemoryV2Tables(ctx.db, v2caps)
    } catch (err) {
      ctx.logger.error({ err }, 'memory v2 tables could not be created; L0 capture will stay buffered')
    }
```

and do **not** add it twice.

- [ ] **Step 5: Run the wire test, type-check, and the memory suite**

Run: `bun vitest run tests/modules/memory/v2/wire.test.ts && bun run lint && bun vitest run tests/modules/memory tests/modules/conversations tests/modules/event-store tests/modules/tools`
Expected: wire test PASS (7 tests); `tsc` clean; every existing suite still green.

- [ ] **Step 6: Boot smoke (manual, optional in CI)**

Run: `bun run dev` for ~10 s, then Ctrl-C.
Expected log lines, in order: `L0 capture: zstd ready`, `L0 bridge: drained units captured before memory started` (or nothing if no message was persisted during boot), `Memory module started`; on stop, no error from `flushAll`. `eyas status` and `/api/v1/memory/*` are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/modules/memory/v2/wire.ts src/modules/memory/index.ts tests/modules/memory/v2/wire.test.ts
git commit -m "feat(memory): wire L0 capture — ctx.memoryIngest, memory.v2.flush sweep, task-close and shutdown flush"
```

---

### Task 12: Whole-plan verification and the acceptance checklist

**Files:** none new.

- [ ] **Step 1: Run every test this plan added, then the full suite**

Run: `bun vitest run tests/modules/memory/v2`
Expected: PASS — l0-schema-contract (3), language (5), ingest-bridge (7), scope (5), ingest-flush (11), ingest-triggers (9), flush-job (2), capture-conversations (6), capture-god-mode (1), capture-event-store (4), capture-event-store-guard (1), capture-tools (7), wire (7) = 68 tests.

Run: `bun run lint && bun vitest run`
Expected: `tsc` clean; the full suite green (the three hooks are no-throw side effects, so no pre-existing test changes behaviour).

- [ ] **Step 2: Tick the Phase 1 acceptance items this plan owns (spec §15 + spike §6)**

| Acceptance | Where proven |
|---|---|
| Two identical messages in two conversations → two raw rows, two blobs, one `content_hash` | `ingest-flush.test.ts` |
| Same conversation → one blob, `ref_count = 2` | `ingest-flush.test.ts` |
| Retried flush is a no-op (ULID idempotency) | `ingest-flush.test.ts`, `ingest-triggers.test.ts` |
| God Mode turn produces L0 rows | `capture-god-mode.test.ts` |
| Background run produces L0 rows (session join, agent actor) | `capture-event-store.test.ts` |
| Units captured before memory starts are drained after attach | `ingest-bridge.test.ts`, `capture-conversations.test.ts`, `wire.test.ts` |
| FTS finds a Hungarian word with diacritics stripped | `ingest-flush.test.ts` |
| Language tags for en/hu/de/es/fr/tlh | `language.test.ts`, `ingest-flush.test.ts` |
| Flush on close / idle / chunk; one-minute sweep registered | `ingest-triggers.test.ts`, `flush-job.test.ts`, `wire.test.ts` |
| Tool results: 8 KB cap, `ingested` trust, opt-in flag | `capture-tools.test.ts`, `ingest-triggers.test.ts` |
| Zero model calls anywhere on this path | no gateway import in any file of this plan |

- [ ] **Step 3: Hand over**

Report the test counts and the commit list to the owner. Plans p1c (extraction via `ctx.memoryIngest.onFlushed` / `runExtraction`) and p1d (migration into the same tables, `eyas memory status` reading `memory_raw`) can start.

---

## Self-review

**1. Spec coverage (P1b scope only).**
- §4 L(−1) "ULID at capture", flush on close / 30-min idle / 8k chunk → Tasks 3, 6, 7, 11. ✓
- §4/§5 L0: `memory_raw` per occurrence, zstd `memory_blob` keyed `(content_hash, shred_partition_id)` + `ref_count`, contentless FTS at flush, `meta_json`, INTEGER ms timestamps, syncCols (`origin_instance_id`, HLC, `revision`) → Task 5. ✓
- §6 capture hooks at `addMessage`, `agent_events` append, tool executor (1b, 8 KB, `ingested`, gated) → Tasks 8, 9, 10. ✓ God Mode and background gaps closed structurally (§17) → Tasks 8, 9 tests. ✓
- §6 flush contract: `INSERT OR IGNORE` on id, never content; blob identity = SHA-256 of uncompressed bytes; level 3 via P1a's shim → Task 5. ✓
- §6 trust at capture (owner / ingested) → Tasks 8–10. ✓
- §9 tags: `project`, `project_type`, `task`, `source_type`, `language`, `trust_tier`, `layer` in `memory_tag` (raw layer) → Task 5. (`kind`, `entity`, `topic` belong to P1c.) ✓
- §6 language heuristic hu/en/de/es/fr/tlh → Task 2. ✓
- Spike §2 #21(ii) session join + actor, #21(iv) blob acceptance rewrite, §6 duplicate `LlmResponse` rule (live variant justified in Task 9) → Tasks 5, 9. ✓
- §17 boot-order risk: lazy bounded `ctx.memoryIngest` bridge + regression tests → Tasks 3, 11. ✓
- Interfaces contract: `captureUnit`/`attachIngest`/`detachIngest`/`pendingUnits`, `createMemoryIngest(deps)` with the exact `deps` shape, `MemoryIngest` methods, `FlushResult`, `CaptureUnit`/`RawSourceType`/`TrustTier`, `detectLanguage`, `ctx.memoryIngest`, `ExecutionLogEntry.sessionId` — all used with the contract names; extras (`flushAll`, `bufferedUnits`, `droppedUnits`, `disableIngestBridge`, `resetIngestBridge`, `sha256Hex`, `registerFlushJob`, `wireL0Capture`, `resolveConversationScope`) are additive.
- Deliberately out of scope (other plans): extraction/arbitration (p1c), migration/CLI/`eyas memory status` (p1d), `memory.l0` Zod schema + zstd shim + capabilities probe + `createMemoryV2Tables` call in `onRegister` (p1a; Task 11 has the guarded fallback), `privacy.collectSegments` `tool_result` arm and `save_memory` retirement (p1e). Gap: none found for P1b.

**2. Placeholder scan.** No "TBD/TODO/implement later"; every code step is complete TypeScript; every test step has a runnable command and an expected result; no "similar to Task N" — the God Mode test repeats its route setup instead of referring to `god-mode-send.test.ts`. The Task 11 "if p1a has not added `createMemoryV2Tables`" branch is a concrete code block with a placement line, not a deferral.

**3. Type consistency.** `CaptureUnit` fields (`id, sourceType, actor, conversationId, projectId, projectTypeId, occurredAtMs, content, trustTier, shredPartitionId?, meta?`) are identical in Task 3's definition, the three hooks (Tasks 8–10) and every `makeUnit` fixture. `MemoryIngest` methods used by fakes in Tasks 3, 8, 9, 10 (`enqueue, flushConversation, sweepIdle, onFlushed, flushAll, bufferedUnits`) match Task 5's interface. `FlushReason` is `'close'|'idle'|'chunk'|'manual'` everywhere (`wire.ts` `safeFlush`, `flushAll('manual')` in `onStop`). `registerFlushJob(scheduler, ingest)` takes `Pick<MemoryIngest,'sweepIdle'>` and the wire passes the full ingest. `resolveConversationScope` returns the same six fields in Task 4's test, `l0-capture.ts` (conversations, event-store, tools) and `scope.ts`. `sessionId?: string` is declared once in `ExecutionLogEntry` and read as `entry.sessionId ?? null` in Task 10. Column names in Task 5's INSERTs are exactly the set Task 1 asserts.
