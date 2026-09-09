# Memory P1a — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the ground every other Phase 1 memory plan builds on — the `memory.engine`/`memory.l0` config keys, deterministic ULIDs, a three-tier zstd shim, a live SQLite capability probe (FTS5 + sqlite-vec int8 KNN) wired into `connection.ts` and `eyas doctor`, and the complete, idempotent `memory_*` v2 schema with its single integer allocator, run ledger and instance id.

**Architecture:** Everything here is additive and side-effect-free for the legacy engine: new Zod keys with defaults, new `src/shared` utilities, a new `src/core/db/sqlite-capabilities.ts` that measures capabilities on a live connection instead of inferring them from file paths, a small `connection.ts` refactor (darwin-only once-per-process `setCustomSQLite`, `synchronous=NORMAL`, an `openRawSqlite()` helper), and `src/modules/memory/v2/{schema,runs,instance}.ts` called from memory's `onRegister` right after the legacy tables. Sibling plans consume these by the exact names in the "Interfaces" blocks: **p1b** (L0 capture) writes `memory_item/memory_blob/memory_raw/memory_raw_fts/memory_tag` through `allocateRid` and `zstdCompress`; **p1c** (extraction) writes facts/gists/links and `recordRun`; **p1d** (migration/CLI) uses `generateIdAt`, `recordRun`, the same tables; **p1e** (retirements/infra) owns Dockerfile/K8s/provider flags and touches none of these files.

**Tech Stack:** TypeScript 5.9 strict/ESM, Bun 1.3.10 (`bun:sqlite`, `Bun.zstdCompressSync`) with Node 22 fallback (`better-sqlite3`, `node:zlib` zstd ≥ 22.15.0), Drizzle raw `sql` templates, SQLite FTS5 (`unicode61 remove_diacritics 2`, contentless) and `sqlite-vec` 0.1.9 (`vec0`, `int8[384]`, `PARTITION KEY`, `vec_int8()` binding), Zod 3.24, Pino, Vitest (`bun vitest run <path>`). **One new dependency:** `@bokuweb/zstd-wasm` **0.0.27** (MIT, ~0.9 MB unpacked) — the WASM compression tier for a Node without zstd.

**Spec:** `docs/superpowers/specs/2026-09-03-sovereign-layered-memory-design.md` (§1 constraints, §3 principles, §5 data model, §6 flush contract, §13 storage engine / compression / IDs, §15 Phase 1, §16-1/§16-16, §17 risks), as corrected by `docs/superpowers/specs/2026-09-03-memory-p0-spike-report.md` (§2 defaults #1, #2, #5–#8, #13–#15, #21; §5 scripts that become repo tests; §6 spec changes). Companions: `docs/superpowers/specs/2026-09-03-memory-gap-analysis.md` (§A rows 5, 9, 12, 13, 46, 47; §E-7, §E-8) and the sibling plan `docs/superpowers/plans/2026-09-03-memory-p1b-l0-capture.md` (its Task 1 is the contract gate on this plan).

**Evidence this plan rests on (measured 2026-09-03 on this machine, Bun 1.3.10, Homebrew SQLite 3.51.2, sqlite-vec v0.1.9):** `Bun.zstdCompressSync(data, { level })` exists and emits RFC 8878 frames (`28b52ffd`); `Database.setCustomSQLite()` throws `SQLite already loaded` on its second call; `CREATE VIRTUAL TABLE temp.x USING fts5(... content='' ...)` works and rolls back inside a transaction; contentless FTS5 `'delete'` by original text works; loading sqlite-vec twice on one connection is harmless; a vec0 table created inside a transaction disappears on `ROLLBACK`; `project_key IN (0, ?)` returns k rows **per partition**, the flattened subquery + outer `LIMIT` throws `Only LIMIT or 'k =?' can be provided, not both`, and the `MATERIALIZED` CTE returns exactly the top-k of the union; `+rowid IN (...)` and the naive `rowid IN (...)` return identical rows; `changes()` is 0 after an ignored `INSERT OR IGNORE`; `PRAGMA synchronous` defaults to 2 (FULL). The query-shape fixture below was run at 2 000 rows: every filtered-KNN shape returned identical rowids and distances, FTS shapes A/B/C/E were identical, and over-fetch-then-filter recall was 0–43 %.

## Global Constraints

- Spec §1: **TypeScript/Bun (Node 22 fallback), single process, embedded SQLite via Drizzle, MIT-compatible dependencies only, VPS/K8s pods without GPU, no local LLM assumed (CLI-only providers such as Claude Code or Grok CLI may be the only model), six UI languages, the existing board (a task is a conversation) and scheduler.**
- Spec §3: L0 is immutable and complete; ULID, `content_hash`, HLC, `origin_instance_id`, `trust_tier` on every row from day one; "designed for sharing, shipped alone" (the four R6 tables exist, empty).
- Spec §5 + spike §2 #7: **one INTEGER surrogate key** (`memory_item.rid`) shared by every typed row, the contentless FTS rowid, the vec0 rowid and `memory_tag.memory_rid`; ULIDs are the sync identity only. `memory_blob` keeps the composite key `(content_hash, shred_partition_id)` + `ref_count`. Timestamps are INTEGER epoch ms. Float vectors are not stored anywhere; `vec_int8(?)` on INSERT and MATCH.
- Spec §13 / spike §2 #2: `bun:sqlite` stays primary; `setCustomSQLite()` is a **darwin-only** workaround guarded **once per process**; capabilities are measured by a **live self-test** (`vec_version()`, 1-row int8 insert, KNN), never inferred; `eyas doctor` prints it. `synchronous=NORMAL` on every connection (spike §2 #15, §4.3 #11).
- Spec §6 / spike §2 #13: zstd tiers `Bun.zstdCompressSync` → `node:zlib` (Node ≥ 22.15.0; 23.0–23.7 have none — **fail loudly, never silently**) → `@bokuweb/zstd-wasm` (MIT; `fzstd` excluded, decompress-only); **level 3**; blob identity = SHA-256 of the **uncompressed** bytes.
- Spec §14: deterministic re-runnable ULIDs (timestamp from the source `created_at`, random part from a hash) — `generateIdAt(ms, random80)`; `generateId()` stays the runtime source; `nanoid` stays for non-memory ids.
- Repo rules: English code and comments; Pino via `ctx.logger` / an injected logger in library code, **never `console.log`** in `src/core`, `src/shared`, `src/modules` (CLI commands print with `console.log` as `doctor.ts` already does); Zod for config; no user-facing UI strings are added here (doctor lines are operator terminal output, not i18n'd, same as today's checks); every new source file starts with `// Part of eYssen. See LICENSE file for full copyright and licensing details.`; **do not touch the version** (`package.json` `version`, `CHANGELOG.md`) — the only `package.json` edit is the one dependency line.
- Git: **an agent executing this plan never runs `git commit`, `git push`, or creates a branch.** Each task ends with the commit command the owner runs by hand; stop there. No `Co-Authored-By` lines.
- Tests: `tests/core/db/`, `tests/shared/`, `tests/cli/`, `tests/modules/memory/v2/`; helpers `createMemoryDb()` / `createTestDb()` / `getRawFromDrizzle()` from `tests/helpers/test-db.ts`; run one file with `bun vitest run <path>`; type-check with `bun run lint` (`tsc --noEmit`). Tests must pass on a box **with or without** sqlite-vec loadable (macOS without Homebrew SQLite = no vec0): vec0-dependent assertions are gated on the probe result, never skipped silently without saying so in the test name.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/core/config/schema.ts` (modify, `memory` block lines 90–125) | `memory.engine` + `memory.l0` Zod keys with the contract defaults. |
| `src/core/types.ts` (modify, `EyasConfig.memory` lines 25–30) | Typed `engine`/`l0` on the hand-written config interface. |
| `config/default.yaml` (modify, `memory:` block line 27) | Documented defaults for the two new keys. |
| `src/shared/crypto.ts` (modify, lines 11–45) | ULID encoder split into helpers; `generateIdAt`, `ulidTimestampMs`. |
| `src/shared/zstd.ts` (create) | Three-tier zstd shim: `initZstd`, `zstdTier`, `zstdCompress`, `zstdDecompress`, `ZstdUnavailableError`, `resetZstdForTests`. |
| `src/shared/zstd-wasm.d.ts` (create) | Ambient types for `@bokuweb/zstd-wasm` (its `exports` map hides its typings from bundler resolution). |
| `package.json` (modify, dependencies) | `"@bokuweb/zstd-wasm": "0.0.27"`. |
| `src/core/db/sqlite-capabilities.ts` (create) | `SqliteCapabilities`, `probeSqliteCapabilities` (live, cached per connection), `getSqliteCapabilities` (main connection), `rawHandleOf`, `describeSqliteCapabilities`, `NO_SQLITE_CAPABILITIES`. |
| `src/core/db/connection.ts` (modify, whole file, 112 lines) | Darwin-only once-per-process custom-SQLite probe, `openRawSqlite(path)`, `customSqliteStatus()`, `synchronous=NORMAL`; `isSqliteExtensionLoadingAvailable()` removed (zero callers). |
| `src/cli/commands/doctor.ts` (modify, after `checkOllama` line 85 and in `run` line 153) | `checkSqliteCapabilities()` and `checkZstd()` lines. |
| `src/modules/memory/v2/schema.ts` (create) | `createMemoryV2Tables(db, caps)`, `allocateRid`, `findRid`, `getMemoryMeta`/`setMemoryMeta`, `MEMORY_V2_TABLES`, `MEMORY_V2_SCHEMA_VERSION`. |
| `src/modules/memory/v2/runs.ts` (create) | `MemoryRunInput`, `recordRun`, `finishRun`, `getRun`. |
| `src/modules/memory/v2/instance.ts` (create) | `getInstanceId(db)` via `memory_meta`. |
| `src/modules/memory/index.ts` (modify, imports line 30 and `onRegister` lines 45–47) | Create the v2 tables after the legacy ones, with the main-connection probe. |
| `tests/core/config.test.ts`, `tests/shared/crypto.test.ts`, `tests/core/db.test.ts`, `tests/cli/doctor.test.ts` (modify) | New cases appended to the existing suites. |
| `tests/helpers/sqlite-errors.ts` (create, Task 7 Step 0) | `expectSqliteError` — asserts on a SQLite error's `.cause` text, because Drizzle wraps `db.run()` failures (pre-flight B1). |
| `tests/shared/zstd-shim.test.ts`, `tests/core/db/sqlite-capabilities.test.ts`, `tests/modules/memory/v2/schema.test.ts`, `tests/modules/memory/v2/runs-instance.test.ts`, `tests/modules/memory/v2/register-v2-tables.test.ts`, `tests/modules/memory/v2/shapes-fixture.ts`, `tests/modules/memory/v2/query-shapes.test.ts` (create) | One test file per deliverable; the shapes fixture is shared by the query-shapes suite (and reusable by Phase 2). |

Task order matters only where stated: Task 4 (probe) before Task 5 (connection) before Task 6 (doctor); Task 7 (schema) before Tasks 8–10.

---

### Task 1: `memory.engine` and `memory.l0` config keys

**Files:**
- Modify: `src/core/config/schema.ts:90-93`
- Modify: `src/core/types.ts:25-30`
- Modify: `config/default.yaml:27-28`
- Test: `tests/core/config.test.ts` (append)

**Interfaces:**
- Produces: `config.memory.engine: 'legacy' | 'v2'` (default `'legacy'`) and `config.memory.l0: { enabled: boolean; captureToolResults: boolean; toolResultMaxBytes: number; idleFlushMinutes: number; chunkTokens: number; extractInLegacy: boolean }` (defaults `true, false, 8192, 30, 8000, true`). p1b reads `(ctx.config as any)?.memory?.l0`; p1c reads `memory.engine` and `memory.l0.extractInLegacy`; p1d flips nothing (the flag default stays `legacy` in Phase 1).
- Consumes: the existing `configSchema` / `loadConfig` (`src/core/config/loader.ts:61-73`).

- [ ] **Step 1: Write the failing test**

Append at the end of `tests/core/config.test.ts` (after the `describe('deepMerge', …)` block, line 230). The file already imports `configSchema`, `defaultConfig`, `loadConfig`, `writeFileSync`, `mkdirSync`, `rmSync`, `join`, `tmpdir`, and `afterEach`.

```ts
describe('memory.engine / memory.l0 (plan p1a)', () => {
  const dir = join(tmpdir(), `eyas-config-memory-${Date.now()}`)
  afterEach(() => { try { rmSync(dir, { recursive: true }) } catch {} })

  it('defaults to the legacy engine with L0 capture on and tool results off', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.memory.engine).toBe('legacy')
      expect(result.data.memory.l0).toEqual({
        enabled: true,
        captureToolResults: false,
        toolResultMaxBytes: 8192,
        idleFlushMinutes: 30,
        chunkTokens: 8000,
        extractInLegacy: true,
      })
    }
  })

  it('keeps YAML-provided keys instead of stripping them (z.object drops unknown keys)', () => {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'config.yaml')
    writeFileSync(path, [
      'memory:',
      '  engine: v2',
      '  l0:',
      '    captureToolResults: true',
      '    chunkTokens: 4000',
    ].join('\n'))
    const config = loadConfig(path)
    expect(config.memory?.engine).toBe('v2')
    expect(config.memory?.l0).toEqual({
      enabled: true,
      captureToolResults: true,
      toolResultMaxBytes: 8192,
      idleFlushMinutes: 30,
      chunkTokens: 4000,
      extractInLegacy: true,
    })
    // Siblings in the same block keep their defaults.
    expect(config.memory?.reflection.enabled).toBe(false)
  })

  it('rejects an unknown engine and a non-positive byte cap', () => {
    expect(configSchema.safeParse({ memory: { engine: 'v3' } }).success).toBe(false)
    expect(configSchema.safeParse({ memory: { l0: { toolResultMaxBytes: 0 } } }).success).toBe(false)
    expect(configSchema.safeParse({ memory: { l0: { idleFlushMinutes: 1.5 } } }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/core/config.test.ts`
Expected: FAIL — `expected undefined to be 'legacy'` (the key is stripped today) and a type error on `config.memory?.engine` under `bun run lint`.

- [ ] **Step 3: Add the schema keys**

In `src/core/config/schema.ts`, lines 90–93 currently read:

```ts
  // Cap 6 dream-engine — nightly reflection (OFF by default). Without this schema
  // entry the loader stripped `memory`, leaving the feature unreachable.
  memory: z.object({
    reflection: z.object({
```

Replace them with:

```ts
  // Cap 6 dream-engine — nightly reflection (OFF by default). Without this schema
  // entry the loader stripped `memory`, leaving the feature unreachable.
  memory: z.object({
    // Sovereign layered memory (spec 2026-09-03 §14): which engine serves the
    // read/write path. 'legacy' = vault + episodic tiers (today); 'v2' = the
    // L0–L3 store. L0 capture runs under BOTH engines (see `l0`); the flag
    // selects retrieval and the extraction sink. Phase 1 ships 'legacy'.
    engine: z.enum(['legacy', 'v2']).default('legacy'),
    // L(−1)/L0 raw capture (plan p1b). Defaults are the spec's: tool results
    // are opt-in with an 8 KB cap (§16-4); buffers flush after 30 idle
    // minutes or ~8k tokens (§4). `extractInLegacy` lets deterministic
    // extraction (plan p1c) run while the engine is still 'legacy'.
    l0: z.object({
      enabled: z.boolean().default(true),
      captureToolResults: z.boolean().default(false),
      toolResultMaxBytes: z.number().int().positive().default(8192),
      idleFlushMinutes: z.number().int().positive().default(30),
      chunkTokens: z.number().int().positive().default(8000),
      extractInLegacy: z.boolean().default(true),
    }).default({}),
    reflection: z.object({
```

In `src/core/types.ts`, lines 25–30 currently read (the `memory?:` block sits after `autonomy`, before the `proactive` comment):

```ts
  memory?: {
    reflection: {
      enabled: boolean
      webEgress: { enabled: boolean; urls: string[]; maxItems: number }
    }
  }
```

Replace with:

```ts
  memory?: {
    /** Sovereign layered memory engine switch (spec 2026-09-03 §14). Phase 1 default: 'legacy'. */
    engine?: 'legacy' | 'v2'
    /** L(−1)/L0 raw capture (plan p1b). */
    l0?: {
      enabled: boolean
      captureToolResults: boolean
      toolResultMaxBytes: number
      idleFlushMinutes: number
      chunkTokens: number
      extractInLegacy: boolean
    }
    reflection: {
      enabled: boolean
      webEgress: { enabled: boolean; urls: string[]; maxItems: number }
    }
  }
```

In `config/default.yaml`, lines 27–28 currently read:

```yaml
memory:
  capture:
```

Replace with:

```yaml
memory:
  # Which engine serves memory reads/writes: 'legacy' (vault + episodic tiers)
  # or 'v2' (sovereign layered memory — docs/superpowers/specs/2026-09-03-*).
  # L0 capture below runs under both; Phase 1 ships 'legacy'.
  engine: legacy
  # L(-1)/L0 raw capture — every persisted message is kept verbatim (zstd,
  # content-addressed). Tool results are opt-in and capped at 8 KB.
  l0:
    enabled: true
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
  capture:
```

- [ ] **Step 4: Run the test and the type-check**

Run: `bun vitest run tests/core/config.test.ts && bun run lint`
Expected: PASS (all existing cases + 3 new); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/schema.ts src/core/types.ts config/default.yaml tests/core/config.test.ts
git commit -m "feat(config): memory.engine and memory.l0 keys for the layered memory"
```

---

### Task 2: Deterministic ULIDs — `generateIdAt` and `ulidTimestampMs`

**Files:**
- Modify: `src/shared/crypto.ts:11-45`
- Test: `tests/shared/crypto.test.ts` (modify import line 2, append a `describe`)

**Interfaces:**
- Produces: `generateIdAt(ms: number, random80: Uint8Array): string` (26-char Crockford ULID; throws `RangeError` on a non-integer / out-of-48-bit `ms` or a random part ≠ 10 bytes) and `ulidTimestampMs(id: string): number` (throws `RangeError` on anything that is not a 26-char ULID). `generateId()` keeps its exact behaviour. p1d derives migration ids as `generateIdAt(sourceCreatedAtMs, sha256('legacy:' + table + ':' + pk).subarray(0, 10))`; p1d's verification asserts `ulidTimestampMs(raw.id) === raw.occurred_at`.

- [ ] **Step 1: Write the failing test**

Change line 2 of `tests/shared/crypto.test.ts` from

```ts
import { sha256, generateId, constantTimeEqual } from '@shared/crypto'
```

to

```ts
import { sha256, generateId, generateIdAt, ulidTimestampMs, constantTimeEqual } from '@shared/crypto'
```

and append inside the outer `describe('crypto utilities', …)` block (before its closing `})` on line 57):

```ts
  describe('generateIdAt / ulidTimestampMs (deterministic migration ids, plan p1a)', () => {
    const random = (fill: number) => new Uint8Array(10).fill(fill)

    it('is deterministic: same inputs, same 26-char Crockford ULID', () => {
      const a = generateIdAt(1_700_000_000_000, random(7))
      const b = generateIdAt(1_700_000_000_000, random(7))
      expect(a).toBe(b)
      expect(a).toHaveLength(26)
      expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    })

    it('differs when the random part differs, and sorts by timestamp first', () => {
      expect(generateIdAt(1_700_000_000_000, random(7))).not.toBe(generateIdAt(1_700_000_000_000, random(8)))
      const earlier = generateIdAt(1_700_000_000_000, random(255))
      const later = generateIdAt(1_700_000_000_001, random(0))
      expect(later > earlier).toBe(true)
    })

    it('round-trips the timestamp, including both edges of the 48-bit range', () => {
      for (const ms of [0, 1, 1_700_000_000_000, 2 ** 48 - 1]) {
        expect(ulidTimestampMs(generateIdAt(ms, random(3)))).toBe(ms)
      }
    })

    it('decodes the runtime generator too', () => {
      const before = Date.now()
      const ms = ulidTimestampMs(generateId())
      expect(ms).toBeGreaterThanOrEqual(before)
      expect(ms).toBeLessThanOrEqual(Date.now())
    })

    it('accepts lowercase input when decoding', () => {
      const id = generateIdAt(1_700_000_000_000, random(9))
      expect(ulidTimestampMs(id.toLowerCase())).toBe(1_700_000_000_000)
    })

    it('rejects bad input loudly', () => {
      expect(() => generateIdAt(-1, random(0))).toThrow(RangeError)
      expect(() => generateIdAt(2 ** 48, random(0))).toThrow(RangeError)
      expect(() => generateIdAt(1.5, random(0))).toThrow(RangeError)
      expect(() => generateIdAt(1, new Uint8Array(9))).toThrow(RangeError)
      expect(() => ulidTimestampMs('too-short')).toThrow(RangeError)
      expect(() => ulidTimestampMs('U'.repeat(26))).toThrow(RangeError) // 'U' is not in the Crockford alphabet
    })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/shared/crypto.test.ts`
Expected: FAIL — `generateIdAt is not a function`.

- [ ] **Step 3: Refactor the encoder and add the two functions**

Lines 11–45 of `src/shared/crypto.ts` currently read:

```ts
// ULID: Crockford Base32, 10 chars timestamp + 16 chars random, monotonic
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let lastTime = 0
let lastRandom = 0n

export function generateId(): string {
  let now = Date.now()
  if (now <= lastTime) {
    // Same millisecond: increment random part for monotonicity
    lastRandom += 1n
  } else {
    lastTime = now
    const bytes = new Uint8Array(10)
    crypto.getRandomValues(bytes)
    lastRandom = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
  }

  // Encode timestamp (10 chars)
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }

  // Encode random (16 chars)
  let random = ''
  let r = lastRandom
  for (let i = 0; i < 16; i++) {
    random = ENCODING[Number(r % 32n)] + random
    r = r / 32n
  }

  return time + random
}
```

Replace them with (the `generateId` output is byte-for-byte what it was: the random loop already truncated to the low 80 bits, which the mask below makes explicit):

```ts
// ULID: Crockford Base32, 10 chars timestamp (48-bit ms) + 16 chars random
// (80 bits), monotonic within a millisecond. generateId() is the runtime id
// source; generateIdAt() is the deterministic sibling the memory migration
// uses (timestamp from the source row, random part from a hash) so a re-run
// derives byte-identical ids and INSERT OR IGNORE makes it idempotent.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const DECODING: Record<string, number> = Object.fromEntries(Array.from(ENCODING, (c, i) => [c, i]))
const ULID_TIME_MAX = 2 ** 48 - 1
const ULID_RANDOM_BYTES = 10
const ULID_RANDOM_MASK = (1n << 80n) - 1n
let lastTime = 0
let lastRandom = 0n

function encodeUlidTime(ms: number): string {
  let time = ''
  let t = ms
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }
  return time
}

function encodeUlidRandom(random: bigint): string {
  let out = ''
  let r = random & ULID_RANDOM_MASK
  for (let i = 0; i < 16; i++) {
    out = ENCODING[Number(r % 32n)] + out
    r = r / 32n
  }
  return out
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
}

export function generateId(): string {
  const now = Date.now()
  if (now <= lastTime) {
    // Same millisecond: increment random part for monotonicity
    lastRandom += 1n
  } else {
    lastTime = now
    const bytes = new Uint8Array(ULID_RANDOM_BYTES)
    crypto.getRandomValues(bytes)
    lastRandom = bytesToBigInt(bytes)
  }
  return encodeUlidTime(now) + encodeUlidRandom(lastRandom)
}

/**
 * Deterministic ULID: `ms` is the 48-bit timestamp, `random80` the ten
 * random bytes. Same inputs → same id. The memory migration derives both
 * from the legacy row, so re-running it re-creates identical ids.
 */
export function generateIdAt(ms: number, random80: Uint8Array): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > ULID_TIME_MAX) {
    throw new RangeError(`ULID timestamp must be an integer in [0, ${ULID_TIME_MAX}], got ${ms}`)
  }
  if (random80.length !== ULID_RANDOM_BYTES) {
    throw new RangeError(`ULID random part must be exactly ${ULID_RANDOM_BYTES} bytes, got ${random80.length}`)
  }
  return encodeUlidTime(ms) + encodeUlidRandom(bytesToBigInt(random80))
}

/** The millisecond timestamp encoded in a ULID's first 10 characters. */
export function ulidTimestampMs(id: string): number {
  if (typeof id !== 'string' || id.length !== 26) {
    throw new RangeError(`not a ULID (expected 26 characters): ${String(id)}`)
  }
  let ms = 0
  for (let i = 0; i < 10; i++) {
    const ch = id[i].toUpperCase()
    const value = DECODING[ch]
    if (value === undefined) throw new RangeError(`not a ULID (bad character '${id[i]}' at ${i}): ${id}`)
    ms = ms * 32 + value
  }
  if (ms > ULID_TIME_MAX) throw new RangeError(`not a ULID (timestamp overflows 48 bits): ${id}`)
  return ms
}
```

- [ ] **Step 4: Run the tests**

Run: `bun vitest run tests/shared/crypto.test.ts && bun run lint`
Expected: PASS (9 existing + 6 new); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto.ts tests/shared/crypto.test.ts
git commit -m "feat(shared): deterministic ULID helpers generateIdAt and ulidTimestampMs"
```

---
### Task 3: Three-tier zstd shim (`src/shared/zstd.ts`)

**Files:**
- Create: `src/shared/zstd.ts`
- Create: `src/shared/zstd-wasm.d.ts`
- Modify: `package.json` (dependencies)
- Test: `tests/shared/zstd-shim.test.ts`

**Interfaces:**
- Produces (contract): `export type ZstdTier = 'bun' | 'node' | 'wasm'`; `export async function initZstd(force?: ZstdTier): Promise<ZstdTier>` (first available of bun → node → wasm; cached; `force` reselects one tier or rejects); `export function zstdTier(): ZstdTier | 'none'`; `export function zstdCompress(data: Uint8Array, level = 3): Uint8Array`; `export function zstdDecompress(data: Uint8Array): Uint8Array` (both **sync** after init; both throw `ZstdUnavailableError` when no tier is active); `export class ZstdUnavailableError extends Error`; `export const ZSTD_DEFAULT_LEVEL = 3`; `export function resetZstdForTests(): void`. p1b calls `await initZstd()` once in `wireL0Capture` and `zstdCompress(bytes)` inside the flush transaction; p1d decompresses for hash spot-checks.
- New dependency: `@bokuweb/zstd-wasm` **0.0.27** — license **MIT** (verified with `npm view @bokuweb/zstd-wasm@0.0.27 license`), 903 925 B unpacked, Node entry `dist/common/index.node.js` (CommonJS), API `init(): Promise<void>`, `compress(data: Uint8Array, level?: number): Uint8Array`, `decompress(data: Uint8Array): Uint8Array` (the Phase 0 spike interchanged 1000/1000 frames with Bun and Node through exactly these three calls).

- [ ] **Step 1: Add the dependency**

In `package.json` `dependencies`, the block is alphabetical; the first entries are:

```json
    "@anthropic-ai/claude-agent-sdk": "^0.2.89",
    "@anthropic-ai/sdk": "^0.91.1",
    "@casl/ability": "^6.8.0",
```

Insert the pinned line between `@anthropic-ai/sdk` and `@casl/ability`:

```json
    "@anthropic-ai/sdk": "^0.91.1",
    "@bokuweb/zstd-wasm": "0.0.27",
    "@casl/ability": "^6.8.0",
```

Then run `bun install` (updates `bun.lock`; commit both). Do not change any other line of `package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/shared/zstd-shim.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Port of the Phase 0 spike's zstd-shim.test.ts (spike §5): round-trip on
// every available tier, WASM ↔ native interchange, forced-tier selection,
// and a LOUD failure before a tier is selected.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  initZstd, zstdCompress, zstdDecompress, zstdTier, resetZstdForTests,
  ZstdUnavailableError, ZSTD_DEFAULT_LEVEL, type ZstdTier,
} from '@shared/zstd'

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
const enc = (s: string) => new TextEncoder().encode(s)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const samples: Uint8Array[] = [
  new Uint8Array(0),
  enc('x'),
  enc('Árvíztűrő tükörfúrógép — a NAV online számla riport 30 napos határidővel. '.repeat(40)),
  enc('export const sweep = async (db) => { for (let lo = 1; lo <= max; lo += 2000) await Bun.sleep(1); };\n'.repeat(120)),
  crypto.getRandomValues(new Uint8Array(20 * 1024)), // incompressible
]

beforeEach(() => resetZstdForTests())

describe('zstd shim', () => {
  it('fails loudly before init instead of silently storing nothing', () => {
    expect(zstdTier()).toBe('none')
    expect(() => zstdCompress(enc('x'))).toThrow(ZstdUnavailableError)
    expect(() => zstdDecompress(enc('x'))).toThrow(ZstdUnavailableError)
  })

  it('auto-detects the runtime tier: bun under Bun, node or wasm under Node', async () => {
    const tier = await initZstd()
    if (isBun) expect(tier).toBe('bun')
    else expect(['node', 'wasm']).toContain(tier)
    expect(zstdTier()).toBe(tier)
    expect(await initZstd()).toBe(tier) // cached
  })

  for (const tier of ['bun', 'node', 'wasm'] as ZstdTier[]) {
    it(`round-trips every sample on the ${tier} tier (passes trivially where that tier is unavailable)`, async () => {
      let selected: ZstdTier
      try {
        selected = await initZstd(tier)
      } catch (err) {
        expect(err).toBeInstanceOf(ZstdUnavailableError)
        return
      }
      expect(selected).toBe(tier)
      for (const s of samples) {
        const c = zstdCompress(s, ZSTD_DEFAULT_LEVEL)
        expect(hex(c.subarray(0, 4))).toBe('28b52ffd') // zstd magic (RFC 8878)
        expect(hex(zstdDecompress(c))).toBe(hex(s))
      }
    })
  }

  it('the WASM tier is always present (pinned dependency) and interchanges frames with the native tier', async () => {
    expect(await initZstd('wasm')).toBe('wasm')
    const wasmFrames = samples.map((s) => zstdCompress(s))
    // MUST reset: initZstd() is cached, so without this the next call returns
    // the 'wasm' tier just forced above and the whole cross-check below is dead.
    resetZstdForTests()
    const native = await initZstd()
    if (native === 'wasm') return // a Node without zstd: nothing native to cross-check
    for (let i = 0; i < samples.length; i++) {
      expect(hex(zstdDecompress(wasmFrames[i]))).toBe(hex(samples[i])) // wasm → native
    }
    const nativeFrames = samples.map((s) => zstdCompress(s))
    await initZstd('wasm')
    for (let i = 0; i < samples.length; i++) {
      expect(hex(zstdDecompress(nativeFrames[i]))).toBe(hex(samples[i])) // native → wasm
    }
  })

  it('compresses real text by more than 2x at level 3 (spike: 2.66 on repo text)', async () => {
    await initZstd()
    const text = samples[2]
    expect(zstdCompress(text, 3).byteLength * 2).toBeLessThan(text.byteLength)
  })

  it('rejects an unknown tier with ZstdUnavailableError', async () => {
    await expect(initZstd('brotli' as unknown as ZstdTier)).rejects.toBeInstanceOf(ZstdUnavailableError)
    expect(zstdTier()).toBe('none')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun vitest run tests/shared/zstd-shim.test.ts`
Expected: FAIL — `Cannot find module '@shared/zstd'`.

- [ ] **Step 4: Write the ambient types and the shim**

```ts
// src/shared/zstd-wasm.d.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Ambient types for the WASM zstd tier. The package's `exports` map has no
// `types` condition and TypeScript's bundler resolution does not pair its
// Node entry with the browser typings, so this declaration is what
// src/shared/zstd.ts compiles against (an ambient module wins over file
// resolution). The three signatures are the ones the Phase 0 spike exercised.
declare module '@bokuweb/zstd-wasm' {
  export function init(wasmPath?: string): Promise<void>
  export function compress(data: Uint8Array, level?: number): Uint8Array
  export function decompress(data: Uint8Array): Uint8Array
}
```

```ts
// src/shared/zstd.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Runtime-detected zstd for the L0 raw layer (spec §6, spike §2 #13).
// Three tiers, first available wins: Bun.zstdCompressSync → node:zlib zstd
// (Node ≥ 22.15.0; 23.0–23.7 have none) → @bokuweb/zstd-wasm (MIT). All
// three emit RFC 8878 frames and decompress each other's output; frame bytes
// may differ between tiers, which is fine because blob identity is the
// SHA-256 of the UNCOMPRESSED bytes, never of the frame. Level 3 is the
// measured sweet spot (ratio 2.66 on repo text, ~32 µs/msg at 2 vCPU; L6
// buys +4 % ratio for 2–4× CPU). The sync API throws — loudly, never
// silently — until initZstd() has resolved a tier.

export type ZstdTier = 'bun' | 'node' | 'wasm'

export const ZSTD_DEFAULT_LEVEL = 3

export class ZstdUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZstdUnavailableError'
  }
}

interface ZstdBackend {
  tier: ZstdTier
  compress(data: Uint8Array, level: number): Uint8Array
  decompress(data: Uint8Array): Uint8Array
}

interface ZstdWasmApi {
  init(): Promise<void>
  compress(data: Uint8Array, level?: number): Uint8Array
  decompress(data: Uint8Array): Uint8Array
}

const TIER_ORDER: readonly ZstdTier[] = ['bun', 'node', 'wasm']

let active: ZstdBackend | null = null
let pending: Promise<ZstdTier> | null = null

/** Buffers are Uint8Arrays already; re-view without copying, reject anything else. */
function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new ZstdUnavailableError(`zstd backend returned an unexpected value (${typeof value})`)
}

async function loadBun(): Promise<ZstdBackend | null> {
  const bun = (globalThis as { Bun?: { zstdCompressSync?: unknown; zstdDecompressSync?: unknown } }).Bun
  if (!bun || typeof bun.zstdCompressSync !== 'function' || typeof bun.zstdDecompressSync !== 'function') return null
  const compressSync = bun.zstdCompressSync as (data: Uint8Array, options: { level: number }) => Uint8Array
  const decompressSync = bun.zstdDecompressSync as (data: Uint8Array) => Uint8Array
  return {
    tier: 'bun',
    compress: (data, level) => asBytes(compressSync(data, { level })),
    decompress: (data) => asBytes(decompressSync(data)),
  }
}

async function loadNode(): Promise<ZstdBackend | null> {
  try {
    const zlib = (await import('node:zlib')) as unknown as {
      zstdCompressSync?: (data: Uint8Array, options: { params: Record<number, number> }) => Uint8Array
      zstdDecompressSync?: (data: Uint8Array) => Uint8Array
      constants: { ZSTD_c_compressionLevel?: number }
    }
    if (typeof zlib.zstdCompressSync !== 'function' || typeof zlib.zstdDecompressSync !== 'function') return null
    const levelParam = zlib.constants.ZSTD_c_compressionLevel
    if (typeof levelParam !== 'number') return null
    const compressSync = zlib.zstdCompressSync
    const decompressSync = zlib.zstdDecompressSync
    return {
      tier: 'node',
      compress: (data, level) => asBytes(compressSync(data, { params: { [levelParam]: level } })),
      decompress: (data) => asBytes(decompressSync(data)),
    }
  } catch {
    return null
  }
}

async function loadWasm(): Promise<ZstdBackend | null> {
  try {
    // The Node entry is CommonJS; under ESM interop the API may sit on `default`.
    const mod = (await import('@bokuweb/zstd-wasm')) as unknown as ZstdWasmApi & { default?: ZstdWasmApi }
    const api: ZstdWasmApi | undefined = typeof mod.compress === 'function' ? mod : mod.default
    if (!api || typeof api.compress !== 'function' || typeof api.decompress !== 'function') return null
    await api.init()
    return {
      tier: 'wasm',
      compress: (data, level) => asBytes(api.compress(data, level)),
      decompress: (data) => asBytes(api.decompress(data)),
    }
  } catch {
    return null
  }
}

const LOADERS: Record<ZstdTier, () => Promise<ZstdBackend | null>> = { bun: loadBun, node: loadNode, wasm: loadWasm }

async function detect(force?: ZstdTier): Promise<ZstdTier> {
  const order: readonly ZstdTier[] = force ? [force] : TIER_ORDER
  const misses: string[] = []
  for (const tier of order) {
    const loader = LOADERS[tier]
    if (!loader) {
      active = null
      throw new ZstdUnavailableError(`unknown zstd tier '${String(tier)}' (expected bun, node or wasm)`)
    }
    const backend = await loader()
    if (backend) {
      active = backend
      return tier
    }
    misses.push(tier)
  }
  active = null
  throw new ZstdUnavailableError(
    `no zstd backend available (tried: ${misses.join(', ')}). Run on Bun, on Node >= 22.15.0, or install @bokuweb/zstd-wasm.`,
  )
}

/**
 * Resolve the best tier once (cached). `force` is for tests and diagnostics:
 * it (re)selects exactly that tier or rejects with ZstdUnavailableError.
 */
export function initZstd(force?: ZstdTier): Promise<ZstdTier> {
  if (force) return detect(force)
  if (active) return Promise.resolve(active.tier)
  if (!pending) {
    pending = detect().finally(() => { pending = null })
  }
  return pending
}

export function zstdTier(): ZstdTier | 'none' {
  return active?.tier ?? 'none'
}

function requireBackend(operation: string): ZstdBackend {
  if (!active) throw new ZstdUnavailableError(`zstd ${operation} called before initZstd() resolved a tier`)
  return active
}

export function zstdCompress(data: Uint8Array, level: number = ZSTD_DEFAULT_LEVEL): Uint8Array {
  return requireBackend('compress').compress(data, level)
}

export function zstdDecompress(data: Uint8Array): Uint8Array {
  return requireBackend('decompress').decompress(data)
}

/** Tests only: forget the selected tier so the ladder runs again. */
export function resetZstdForTests(): void {
  active = null
  pending = null
}
```

- [ ] **Step 5: Run the tests and the type-check**

Run: `bun vitest run tests/shared/zstd-shim.test.ts && bun run lint`
Expected: PASS (8 tests; under Bun the `node` tier case passes either by round-tripping or by the documented unavailability path); `tsc` clean. If `tsc` reports `Cannot find module '@bokuweb/zstd-wasm'`, the `.d.ts` was not picked up — check it sits under `src/shared/` (tsconfig `include` covers `src/**/*.ts`).

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/shared/zstd.ts src/shared/zstd-wasm.d.ts tests/shared/zstd-shim.test.ts
git commit -m "feat(shared): three-tier zstd shim (Bun, node:zlib, @bokuweb/zstd-wasm) for L0 blobs"
```

---
### Task 4: Live SQLite capability probe (`src/core/db/sqlite-capabilities.ts`)

**Files:**
- Create: `src/core/db/sqlite-capabilities.ts`
- Test: `tests/core/db/sqlite-capabilities.test.ts` (new directory)

**Interfaces:**
- Produces (contract): `export interface SqliteCapabilities { sqliteVersion: string; fts5: boolean; vec0: boolean; vecVersion: string | null; int8Knn: boolean; extensionLoading: boolean }`; `export function probeSqliteCapabilities(rawDb: unknown, logger?: Pick<Logger, 'debug' | 'warn'>): SqliteCapabilities` (live self-test on **that** connection, result cached per connection in a `WeakMap`; side effect by design: sqlite-vec stays loaded on the connection so `vec0` DDL works afterwards); `export function getSqliteCapabilities(logger?): SqliteCapabilities` (the main connection from `createDatabase()`; throws `Database not initialized` before it). Helpers: `export const NO_SQLITE_CAPABILITIES`, `export function rawHandleOf(db: EyasDb): unknown` (Drizzle's `$client`, else the main raw handle), `export function describeSqliteCapabilities(caps): string` (the `eyas doctor` line).
- Consumes: `getRawDatabase()` from `src/core/db/connection.ts:104-107` (unchanged by this task); `require('sqlite-vec').getLoadablePath()` (`node_modules/sqlite-vec/index.cjs`); `tests/helpers/test-db.ts` `getRawFromDrizzle()`.
- Semantics: `fts5` = a contentless FTS5 table with `unicode61 remove_diacritics 2` can be created and queried with `bm25()`; `extensionLoading` = `loadExtension()` of sqlite-vec succeeded; `vecVersion` = `vec_version()`; `int8Knn` = a `vec0(project_key INTEGER PARTITION KEY, embedding int8[4])` table accepts one `vec_int8()` row and answers KNN with distance 0; `vec0 = extensionLoading && int8Knn`. Every probe object is created and rolled back inside a `SAVEPOINT`, so a probed connection has no leftover tables and no open transaction.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/db/sqlite-capabilities.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Port of the spike's sqlite-ext-docker/ctx/probe-bun.ts (spike §5, row 1):
// version, FTS5 with bm25(), loadExtension(sqlite-vec) → vec_version(),
// int8 insert + KNN (nearest = self, distance 0), FTS5 still fine after.

import { describe, it, expect } from 'vitest'
import { createMemoryDb, getRawFromDrizzle } from '../../helpers/test-db'
import {
  probeSqliteCapabilities, describeSqliteCapabilities, rawHandleOf, NO_SQLITE_CAPABILITIES,
} from '@core/db/sqlite-capabilities'

describe('probeSqliteCapabilities', () => {
  it('reports the SQLite version and FTS5 with the memory tokenizer', () => {
    const raw = getRawFromDrizzle(createMemoryDb())
    const caps = probeSqliteCapabilities(raw)
    expect(caps.sqliteVersion).toMatch(/^3\.\d+\.\d+$/)
    expect(caps.fts5).toBe(true) // every existing memory FTS table already depends on it
  })

  it('answers vec0 only from a live int8 KNN, and leaves the extension loaded for the caller', () => {
    const raw = getRawFromDrizzle(createMemoryDb())
    const caps = probeSqliteCapabilities(raw)
    expect(typeof caps.vec0).toBe('boolean')
    expect(caps.vec0).toBe(caps.extensionLoading && caps.int8Knn)
    if (caps.vec0) {
      expect(caps.vecVersion).toMatch(/^v\d+\.\d+\.\d+/)
      expect((raw.prepare('SELECT vec_version() AS v').get() as { v: string }).v).toBe(caps.vecVersion)
      raw.exec('CREATE VIRTUAL TABLE probe_after USING vec0(embedding int8[4])')
      raw.exec('DROP TABLE probe_after')
    } else {
      expect(caps.int8Knn).toBe(false)
    }
  })

  it('leaves no probe tables and no open transaction behind', () => {
    const raw = getRawFromDrizzle(createMemoryDb())
    probeSqliteCapabilities(raw)
    const leftovers = raw.prepare(
      "SELECT name FROM sqlite_master WHERE name LIKE 'eyas_probe%' UNION ALL SELECT name FROM sqlite_temp_master WHERE name LIKE 'eyas_probe%'",
    ).all()
    expect(leftovers).toEqual([])
    // A dangling SAVEPOINT would make this BEGIN fail with "cannot start a transaction within a transaction".
    raw.exec('BEGIN')
    raw.exec('ROLLBACK')
    // FTS5 still works after the vec load (spike probe step 'fts5_after_vec').
    raw.exec("CREATE VIRTUAL TABLE probe_fts USING fts5(x, content='', tokenize='unicode61 remove_diacritics 2')")
    raw.exec("INSERT INTO probe_fts(rowid, x) VALUES (1, 'számla')")
    expect(raw.prepare("SELECT rowid FROM probe_fts WHERE probe_fts MATCH 'szamla'").all()).toEqual([{ rowid: 1 }])
  })

  it('is cached per connection, and separate connections are probed separately', () => {
    const rawA = getRawFromDrizzle(createMemoryDb())
    const rawB = getRawFromDrizzle(createMemoryDb())
    const a1 = probeSqliteCapabilities(rawA)
    expect(probeSqliteCapabilities(rawA)).toBe(a1)
    expect(probeSqliteCapabilities(rawB)).not.toBe(a1)
    expect(probeSqliteCapabilities(rawB)).toEqual(a1)
  })

  it('rejects a missing handle instead of guessing', () => {
    expect(() => probeSqliteCapabilities(undefined)).toThrow(TypeError)
    expect(() => probeSqliteCapabilities(null)).toThrow(TypeError)
  })

  it('rawHandleOf finds the driver behind a Drizzle handle', () => {
    const db = createMemoryDb()
    expect(rawHandleOf(db)).toBe(getRawFromDrizzle(db))
  })

  it('describes the result in one doctor line', () => {
    expect(describeSqliteCapabilities(NO_SQLITE_CAPABILITIES))
      .toBe('SQLite unknown · FTS5 MISSING · sqlite-vec not loadable (vector search → JS int8 scan)')
    expect(describeSqliteCapabilities({ sqliteVersion: '3.51.2', fts5: true, vec0: true, vecVersion: 'v0.1.9', int8Knn: true, extensionLoading: true }))
      .toBe('SQLite 3.51.2 · FTS5 ok · sqlite-vec v0.1.9 (int8 KNN ok)')
    expect(describeSqliteCapabilities({ sqliteVersion: '3.51.2', fts5: true, vec0: false, vecVersion: 'v0.1.9', int8Knn: false, extensionLoading: true }))
      .toBe('SQLite 3.51.2 · FTS5 ok · sqlite-vec v0.1.9 loaded but int8 KNN FAILED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/core/db/sqlite-capabilities.test.ts`
Expected: FAIL — `Cannot find module '@core/db/sqlite-capabilities'`.

- [ ] **Step 3: Write the probe**

```ts
// src/core/db/sqlite-capabilities.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Live SQLite capability self-test (spec §13, spike §2 #2). Nothing is
// inferred from file paths or the platform: the connection either creates a
// contentless FTS5 table, loads sqlite-vec and answers a one-row int8 KNN,
// or it does not. Results are cached per connection (WeakMap). The probe
// deliberately leaves sqlite-vec loaded on the connection it tested — that
// is what lets createMemoryV2Tables() create the vec0 table afterwards, and
// loading the extension a second time on the same connection is harmless.
// Every probe object lives inside a SAVEPOINT that is always rolled back.

import type { Logger } from 'pino'
import type { EyasDb } from '../types.js'
import { getRawDatabase } from './connection.js'

export interface SqliteCapabilities {
  sqliteVersion: string
  /** Contentless FTS5 with `unicode61 remove_diacritics 2` + bm25() — what memory_raw_fts needs. */
  fts5: boolean
  /** sqlite-vec loaded AND a vec0 int8 table answered a KNN. */
  vec0: boolean
  vecVersion: string | null
  int8Knn: boolean
  /** loadExtension() of the sqlite-vec binary succeeded on this connection. */
  extensionLoading: boolean
}

/** The capabilities of a connection that could not be probed at all. */
export const NO_SQLITE_CAPABILITIES: SqliteCapabilities = Object.freeze({
  sqliteVersion: 'unknown',
  fts5: false,
  vec0: false,
  vecVersion: null,
  int8Knn: false,
  extensionLoading: false,
})

type ProbeLogger = Pick<Logger, 'debug' | 'warn'>

/** The surface shared by bun:sqlite's Database and better-sqlite3's Database. */
interface RawSqlite {
  exec(sql: string): unknown
  prepare(sql: string): {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
  }
  loadExtension?(path: string): unknown
}

const cache = new WeakMap<object, SqliteCapabilities>()

function sqliteVersion(raw: RawSqlite): string {
  const row = raw.prepare('SELECT sqlite_version() AS v').get() as { v?: string } | undefined
  return row?.v ?? 'unknown'
}

/** Run `body` inside a savepoint that is always rolled back; false on any error. */
function inRolledBackSavepoint(raw: RawSqlite, name: string, body: () => boolean): boolean {
  try {
    raw.exec(`SAVEPOINT ${name}`)
  } catch {
    return false
  }
  try {
    return body()
  } catch {
    return false
  } finally {
    try {
      raw.exec(`ROLLBACK TO ${name}`)
      raw.exec(`RELEASE ${name}`)
    } catch {
      /* nothing more to undo */
    }
  }
}

function probeFts5(raw: RawSqlite): boolean {
  return inRolledBackSavepoint(raw, 'eyas_probe_fts', () => {
    raw.exec("CREATE VIRTUAL TABLE temp.eyas_probe_fts USING fts5(body, content='', tokenize='unicode61 remove_diacritics 2')")
    raw.exec("INSERT INTO eyas_probe_fts(rowid, body) VALUES (1, 'árvíztűrő tükörfúrógép')")
    const row = raw.prepare(
      "SELECT rowid, bm25(eyas_probe_fts) AS score FROM eyas_probe_fts WHERE eyas_probe_fts MATCH 'arvizturo'",
    ).get() as { rowid?: number } | undefined
    return row?.rowid === 1
  })
}

function loadSqliteVec(raw: RawSqlite, logger?: ProbeLogger): { loaded: boolean; version: string | null } {
  if (typeof raw.loadExtension !== 'function') {
    logger?.debug('sqlite capability probe: this driver has no loadExtension()')
    return { loaded: false, version: null }
  }
  try {
    // Dynamic require so a platform without the binary fails here, not at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqliteVec = require('sqlite-vec') as { getLoadablePath(): string }
    raw.loadExtension(sqliteVec.getLoadablePath())
    const row = raw.prepare('SELECT vec_version() AS v').get() as { v?: string } | undefined
    return { loaded: true, version: row?.v ?? null }
  } catch (err) {
    logger?.debug({ err: String(err) }, 'sqlite capability probe: sqlite-vec did not load on this connection')
    return { loaded: false, version: null }
  }
}

/** The production shape exactly: int8, PARTITION KEY, vec_int8() on INSERT and MATCH (spike §2 #5, §17 "binding trap"). */
function probeInt8Knn(raw: RawSqlite): boolean {
  return inRolledBackSavepoint(raw, 'eyas_probe_vec', () => {
    raw.exec('CREATE VIRTUAL TABLE eyas_probe_vec USING vec0(project_key INTEGER PARTITION KEY, embedding int8[4])')
    const vector = Buffer.from(new Int8Array([1, -2, 3, -4]).buffer)
    raw.prepare('INSERT INTO eyas_probe_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))').run(1, 0, vector)
    const row = raw.prepare(
      'SELECT rowid, distance FROM eyas_probe_vec WHERE embedding MATCH vec_int8(?) AND k = 1 AND project_key = 0',
    ).get(vector) as { rowid?: number; distance?: number } | undefined
    return row?.rowid === 1 && row?.distance === 0
  })
}

export function probeSqliteCapabilities(rawDb: unknown, logger?: ProbeLogger): SqliteCapabilities {
  if (!rawDb || typeof rawDb !== 'object') {
    throw new TypeError('probeSqliteCapabilities: a raw bun:sqlite / better-sqlite3 handle is required')
  }
  const cached = cache.get(rawDb)
  if (cached) return cached
  const raw = rawDb as RawSqlite
  const version = sqliteVersion(raw)
  const fts5 = probeFts5(raw)
  const vec = loadSqliteVec(raw, logger)
  const int8Knn = vec.loaded ? probeInt8Knn(raw) : false
  const caps: SqliteCapabilities = Object.freeze({
    sqliteVersion: version,
    fts5,
    vec0: vec.loaded && int8Knn,
    vecVersion: vec.version,
    int8Knn,
    extensionLoading: vec.loaded,
  })
  cache.set(rawDb, caps)
  if (!fts5) logger?.warn({ sqliteVersion: version }, 'SQLite has no usable FTS5 — memory full-text search is unavailable')
  if (!caps.vec0) {
    logger?.debug(
      { sqliteVersion: version, extensionLoading: caps.extensionLoading, vecVersion: caps.vecVersion },
      'sqlite-vec unavailable on this connection — vector search falls back to the JS int8 scan',
    )
  }
  return caps
}

/** The raw driver handle behind a Drizzle EyasDb (drizzle-orm exposes it as `$client`); the main connection otherwise. */
export function rawHandleOf(db: EyasDb): unknown {
  const client = (db as { $client?: unknown }).$client
  return client ?? getRawDatabase()
}

/** Cached probe of the main connection (createDatabase()). Throws before createDatabase(). */
export function getSqliteCapabilities(logger?: ProbeLogger): SqliteCapabilities {
  return probeSqliteCapabilities(getRawDatabase(), logger)
}

/** One line for `eyas doctor` and boot logs. */
export function describeSqliteCapabilities(caps: SqliteCapabilities): string {
  const parts = [`SQLite ${caps.sqliteVersion}`, caps.fts5 ? 'FTS5 ok' : 'FTS5 MISSING']
  if (caps.vec0) parts.push(`sqlite-vec ${caps.vecVersion ?? '?'} (int8 KNN ok)`)
  else if (caps.extensionLoading) parts.push(`sqlite-vec ${caps.vecVersion ?? '?'} loaded but int8 KNN FAILED`)
  else parts.push('sqlite-vec not loadable (vector search → JS int8 scan)')
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `bun vitest run tests/core/db/sqlite-capabilities.test.ts && bun run lint`
Expected: PASS (7 tests) on both a box with Homebrew SQLite (vec0 true) and without (vec0 false; the second test takes its `else` branch); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/db/sqlite-capabilities.ts tests/core/db/sqlite-capabilities.test.ts
git commit -m "feat(db): live SQLite capability probe (FTS5, sqlite-vec int8 KNN) cached per connection"
```

---
### Task 5: `connection.ts` — darwin-only once-per-process probe, `openRawSqlite`, `synchronous=NORMAL`

**Files:**
- Modify: `src/core/db/connection.ts` (whole file, 112 lines)
- Test: `tests/core/db.test.ts` (modify import lines 1–2, append)

**Interfaces:**
- Produces: `export function openRawSqlite(path: string): any` (runtime-appropriate raw handle with the four connection PRAGMAs `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`; the caller closes it); `export interface CustomSqliteStatus { attempted: boolean; libraryPath: string | null; note: string | null }` + `export function customSqliteStatus(): CustomSqliteStatus`. `createDatabase`, `getDatabase`, `closeDatabase`, `getRawDatabase` keep their signatures. **Removed:** `isSqliteExtensionLoadingAvailable()` (zero callers outside this file — verified by grep over `src` and `tests`).
- Consumed by: Task 6 (`eyas doctor` opens `openRawSqlite(':memory:')` and probes it), `getSqliteCapabilities()` (Task 4, via `getRawDatabase()`), p1b's ingest (`BEGIN IMMEDIATE` on a connection whose `synchronous` is NORMAL).

- [ ] **Step 1: Write the failing tests**

Change lines 1–2 of `tests/core/db.test.ts` from

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createDatabase, closeDatabase } from '@core/db/connection'
```

to

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { createDatabase, closeDatabase, openRawSqlite, customSqliteStatus } from '@core/db/connection'
import { getSqliteCapabilities } from '@core/db/sqlite-capabilities'
```

Inside the existing `describe('Database Connection', …)` block, add after the `'creates data directory if it does not exist'` case (before the block's closing `})` on line 40):

```ts
  it('opens with synchronous=NORMAL and foreign keys on (spike §2 #15)', () => {
    const db = createDatabase(testDbPath)
    expect(db.all<{ synchronous: number }>(sql`PRAGMA synchronous`)[0].synchronous).toBe(1) // 1 = NORMAL
    expect(db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)[0].foreign_keys).toBe(1)
  })
```

Then append a new block at the end of the file:

```ts
describe('openRawSqlite / main-connection capability probe', () => {
  const scratchDbPath = join(tmpdir(), `eyas-test-caps-${Date.now()}.db`)

  afterEach(() => {
    closeDatabase()
    for (const suffix of ['', '-wal', '-shm']) {
      try { rmSync(`${scratchDbPath}${suffix}`) } catch {}
    }
  })

  it('opens a scratch connection with the same PRAGMAs and no file side effect', () => {
    const raw = openRawSqlite(':memory:')
    try {
      expect((raw.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous).toBe(1)
      expect((raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1)
      expect((raw.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout).toBe(5000)
    } finally {
      raw.close()
    }
  })

  it('runs the darwin-only custom-SQLite probe at most once per process', () => {
    openRawSqlite(':memory:').close()
    const status = customSqliteStatus()
    expect(status.attempted).toBe(true)
    if (process.platform !== 'darwin') {
      expect(status.libraryPath).toBeNull()
      expect(status.note).toMatch(/not needed/)
    }
    openRawSqlite(':memory:').close()
    expect(customSqliteStatus()).toEqual(status) // a second open changes nothing
  })

  it('getSqliteCapabilities probes the main connection once and caches it', () => {
    expect(() => getSqliteCapabilities()).toThrow(/not initialized/)
    createDatabase(scratchDbPath)
    const caps = getSqliteCapabilities()
    expect(caps.fts5).toBe(true)
    expect(getSqliteCapabilities()).toBe(caps)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun vitest run tests/core/db.test.ts`
Expected: FAIL — `openRawSqlite is not a function` (and `synchronous` is `2` today).

- [ ] **Step 3: Rewrite `connection.ts`**

Replace the whole file with:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { isBun } from '@shared/platform.js'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { platform, arch } from 'node:process'
import type { EyasDb } from '../types.js'

let db: any | null = null
let rawDb: any | null = null

export interface CustomSqliteStatus {
  /** True once openRawSqlite() has run the probe — it runs at most once per process. */
  attempted: boolean
  /** The system libsqlite3 Bun was pointed at, or null (bundled build, or another caller chose first). */
  libraryPath: string | null
  /** Why no library was set, when that is the case. */
  note: string | null
}

const customSqlite: CustomSqliteStatus = { attempted: false, libraryPath: null, note: null }

/**
 * macOS-only workaround (spike §2 #2): Apple's libsqlite3 refuses
 * loadExtension(), Homebrew's allows it, and Bun's own bundled SQLite loads
 * extensions natively on Linux — so on Linux the probe is skipped instead of
 * silently doing nothing. `Database.setCustomSQLite()` may be called exactly
 * once per process, before the first Database opens; a second call throws
 * "SQLite already loaded" (tests/helpers/test-db.ts may have called it first).
 */
function ensureCustomSqliteOnce(DatabaseCtor: any): void {
  if (customSqlite.attempted) return
  customSqlite.attempted = true
  if (platform !== 'darwin') {
    customSqlite.note = `not needed on ${platform}: Bun's bundled SQLite loads extensions natively`
    return
  }
  if (typeof DatabaseCtor?.setCustomSQLite !== 'function') {
    customSqlite.note = 'Database.setCustomSQLite is not available in this Bun build'
    return
  }
  const candidates = arch === 'arm64'
    ? ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib']
    : ['/usr/local/opt/sqlite/lib/libsqlite3.dylib', '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib']
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      DatabaseCtor.setCustomSQLite(candidate)
      customSqlite.libraryPath = candidate
    } catch (err) {
      // "SQLite already loaded": someone else chose before us; do not keep trying.
      customSqlite.note = String((err as Error)?.message ?? err)
    }
    return
  }
  customSqlite.note = "no Homebrew libsqlite3 found (brew install sqlite); Apple's build refuses loadExtension()"
}

export function customSqliteStatus(): CustomSqliteStatus {
  return { ...customSqlite }
}

/**
 * Open a raw driver handle (bun:sqlite under Bun, better-sqlite3 under Node)
 * with the PRAGMAs every EYAS connection uses. WAL + synchronous=NORMAL is
 * the spike's measured pairing (§2 #15): durable across process crashes, no
 * fsync per commit. The caller owns the handle and closes it.
 */
export function openRawSqlite(path: string): any {
  if (isBun) {
    const { Database } = require('bun:sqlite')
    ensureCustomSqliteOnce(Database)
    const handle = new Database(path)
    handle.exec('PRAGMA journal_mode = WAL')
    handle.exec('PRAGMA synchronous = NORMAL')
    handle.exec('PRAGMA foreign_keys = ON')
    handle.exec('PRAGMA busy_timeout = 5000')
    return handle
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3')
  const handle = new BetterSqlite3(path)
  handle.pragma('journal_mode = WAL')
  handle.pragma('synchronous = NORMAL')
  handle.pragma('foreign_keys = ON')
  handle.pragma('busy_timeout = 5000')
  return handle
}

export function createDatabase(path: string): EyasDb {
  if (db) return db
  mkdirSync(dirname(path), { recursive: true })
  rawDb = openRawSqlite(path)
  const { drizzle } = isBun ? require('drizzle-orm/bun-sqlite') : require('drizzle-orm/better-sqlite3')
  db = drizzle(rawDb)
  return db
}

export function getDatabase(): EyasDb {
  if (!db) throw new Error('Database not initialized. Call createDatabase() first.')
  return db
}

export function closeDatabase() {
  if (rawDb) {
    rawDb.close()
    rawDb = null
    db = null
  }
}

/**
 * Returns the underlying bun:sqlite or better-sqlite3 Database instance.
 * Needed for operations Drizzle does not expose directly (e.g. loadExtension).
 */
export function getRawDatabase(): any {
  if (!rawDb) throw new Error('Database not initialized. Call createDatabase() first.')
  return rawDb
}
```

- [ ] **Step 4: Run the tests, the type-check and the neighbours that open the main DB**

Run: `bun vitest run tests/core/db.test.ts tests/core/db/sqlite-capabilities.test.ts tests/core/bootstrap.test.ts tests/modules/memory/vec-store.test.ts && bun run lint`
Expected: all PASS (db.test.ts: 2 existing + 4 new); `tsc` clean — in particular no remaining reference to `isSqliteExtensionLoadingAvailable` anywhere (`grep -rn isSqliteExtensionLoadingAvailable src tests` prints nothing).

- [ ] **Step 5: Commit**

```bash
git add src/core/db/connection.ts tests/core/db.test.ts
git commit -m "refactor(db): darwin-only once-per-process custom SQLite probe, openRawSqlite, synchronous=NORMAL"
```

---
### Task 6: `eyas doctor` prints the SQLite capability line and the zstd tier

**Files:**
- Modify: `src/cli/commands/doctor.ts:75-85` (add two checks after `checkOllama`), `:152-153` (call them in `run`)
- Test: `tests/cli/doctor.test.ts` (modify import line 2, append)

**Interfaces:**
- Produces: `export async function checkSqliteCapabilities(): Promise<CheckResult>` (name `'SQLite'`; `ok` when FTS5 and vec0 both work, `warn` with a platform remedy when vec0 is missing, `fail` when FTS5 is missing or the probe throws) and `export async function checkZstd(): Promise<CheckResult>` (name `'zstd'`; `ok` for a native tier, `warn` for the WASM tier, `fail` with the remedy when no tier exists). p1e's Docker/K8s work reads the same `doctor` output in its image-capabilities CI job.
- Consumes: `openRawSqlite`, `customSqliteStatus` (Task 5); `probeSqliteCapabilities`, `describeSqliteCapabilities` (Task 4); `initZstd` (Task 3). `platform` is already imported from `'process'` at `doctor.ts:3`.

- [ ] **Step 1: Write the failing tests**

Change line 2 of `tests/cli/doctor.test.ts` from

```ts
import { checkPlatform, checkDatabase, checkMasterKey, checkConfig, type CheckResult } from '../../src/cli/commands/doctor'
```

to

```ts
import {
  checkPlatform, checkDatabase, checkMasterKey, checkConfig, checkSqliteCapabilities, checkZstd, type CheckResult,
} from '../../src/cli/commands/doctor'
```

and append inside the `describe('Doctor checks', …)` block (before its closing `})` on line 59):

```ts
  it('probes SQLite capabilities live and prints one line', async () => {
    const result = await checkSqliteCapabilities()
    expect(result.name).toBe('SQLite')
    expect(['ok', 'warn']).toContain(result.status) // FTS5 is present wherever the suite runs; vec0 depends on the box
    expect(result.message).toMatch(/^SQLite 3\.\d+\.\d+ · FTS5 ok/)
    if (result.status === 'warn') expect(result.message).toMatch(/remedy:/)
  })

  it('reports the zstd tier', async () => {
    const result = await checkZstd()
    expect(result.name).toBe('zstd')
    expect(result.status).not.toBe('fail')
    expect(result.message).toMatch(/Bun native|node:zlib native|WASM fallback/)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun vitest run tests/cli/doctor.test.ts`
Expected: FAIL — `checkSqliteCapabilities is not a function`.

- [ ] **Step 3: Add the two checks**

In `src/cli/commands/doctor.ts`, lines 75–85 currently read:

```ts
export async function checkOllama(): Promise<CheckResult> {
  try {
    const res = await fetch('http://localhost:11434', { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      return { name: 'Ollama', status: 'ok', message: 'Ollama is reachable at localhost:11434' }
    }
    return { name: 'Ollama', status: 'warn', message: `Ollama responded with ${res.status}` }
  } catch {
    return { name: 'Ollama', status: 'warn', message: 'Ollama not reachable at localhost:11434 (optional)' }
  }
}
```

Insert directly after that function:

```ts
/**
 * Live SQLite self-test on a scratch in-memory connection (spec §13, spike
 * §2 #2): FTS5, sqlite-vec load, one int8 row, one KNN. Uses the same
 * openRawSqlite() path the server uses, so the darwin custom-SQLite probe
 * is exercised too — the data file is never opened by doctor.
 */
export async function checkSqliteCapabilities(): Promise<CheckResult> {
  try {
    const { openRawSqlite, customSqliteStatus } = await import('../../core/db/connection.js')
    const { probeSqliteCapabilities, describeSqliteCapabilities } = await import('../../core/db/sqlite-capabilities.js')
    const raw = openRawSqlite(':memory:')
    try {
      const caps = probeSqliteCapabilities(raw)
      const custom = customSqliteStatus()
      const via = custom.libraryPath ? ` via ${custom.libraryPath}` : ''
      const message = describeSqliteCapabilities(caps) + via
      if (!caps.fts5) {
        return { name: 'SQLite', status: 'fail', message: `${message} — FTS5 is required (memory, conversation and vault search)` }
      }
      if (!caps.vec0) {
        const remedy = platform === 'darwin'
          ? "brew install sqlite (Apple's libsqlite3 refuses extensions)"
          : 'sqlite-vec binary for this platform (glibc only; musl needs vec0 built from the amalgamation)'
        return { name: 'SQLite', status: 'warn', message: `${message} — remedy: ${remedy}` }
      }
      return { name: 'SQLite', status: 'ok', message }
    } finally {
      raw.close()
    }
  } catch (err: any) {
    return { name: 'SQLite', status: 'fail', message: `capability probe failed: ${err?.message ?? err}` }
  }
}

/** Which zstd tier L0 compression will use (spec §6): native is expected, WASM is a warning, none is a failure. */
export async function checkZstd(): Promise<CheckResult> {
  try {
    const { initZstd } = await import('../../shared/zstd.js')
    const tier = await initZstd()
    const label = tier === 'bun'
      ? 'Bun native'
      : tier === 'node'
        ? 'node:zlib native'
        : '@bokuweb/zstd-wasm (WASM fallback, about 2x slower than native)'
    return { name: 'zstd', status: tier === 'wasm' ? 'warn' : 'ok', message: `L0 compression tier: ${label}` }
  } catch (err: any) {
    return { name: 'zstd', status: 'fail', message: `no zstd backend — ${err?.message ?? err}` }
  }
}
```

Then in `run`, lines 152–153 currently read:

```ts
    // Async checks
    results.push(await checkOllama())
```

Change to:

```ts
    // Async checks
    results.push(await checkOllama())
    results.push(await checkSqliteCapabilities())
    results.push(await checkZstd())
```

- [ ] **Step 4: Run the tests, the type-check, and the command itself**

Run: `bun vitest run tests/cli/doctor.test.ts && bun run lint && bun src/cli/index.ts doctor`
Expected: PASS (6 existing + 2 new); `tsc` clean; the doctor output contains two new lines, e.g. `✓ SQLite: SQLite 3.51.2 · FTS5 ok · sqlite-vec v0.1.9 (int8 KNN ok) via /opt/homebrew/opt/sqlite/lib/libsqlite3.dylib` and `✓ zstd: L0 compression tier: Bun native` (on a Mac without Homebrew SQLite the first is a `⚠` with the `brew install sqlite` remedy).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/doctor.ts tests/cli/doctor.test.ts
git commit -m "feat(cli): eyas doctor reports SQLite capabilities and the zstd tier"
```

---
### Task 7: The v2 schema — `createMemoryV2Tables` and the single integer allocator

**Files:**
- Create: `src/modules/memory/v2/schema.ts`
- Create: `tests/helpers/sqlite-errors.ts` (shared assertion helper — see Step 0)
- Test: `tests/modules/memory/v2/schema.test.ts`

**Interfaces:**
- Produces (contract): `export function createMemoryV2Tables(db: EyasDb, caps: SqliteCapabilities): void` (idempotent; creates every table below; `memory_raw_fts` only when `caps.fts5`, `memory_embedding_vec` only when `caps.vec0` — and then only on a connection the probe loaded sqlite-vec into); `export function allocateRid(db: EyasDb, itemType: 'raw'|'fact'|'gist'|'entity'|'embedding', id: string, createdAt: number): number` (**idempotent**: `INSERT OR IGNORE` then `SELECT` — an already-allocated `id` returns its existing rid; the same `id` with a different `item_type` throws). Helpers: `findRid(db, id): number | null`, `getMemoryMeta(db, key): string | null`, `setMemoryMeta(db, key, value): void`, `MEMORY_V2_TABLES` (the 23 table names), `MEMORY_V2_SCHEMA_VERSION = '1'`, `EMBEDDING_DIMENSIONS = 384`, `MemoryItemType`.
- Row contracts other plans write against (column lists are exact): p1b inserts `memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length, ref_count)`, `memory_raw (rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id, occurred_at, trust_tier, dek_id, tombstoned, meta_json)`, `memory_raw_fts (rowid, body)`, `memory_tag (memory_rid, memory_type, tag_type, tag_value)`; every other column of those tables has a default. p1c writes `memory_fact`, `memory_fact_source`, `memory_gist`, `memory_gist_source`, `memory_entity`, `memory_link`, `memory_idf`; p1d writes `memory_link(link_type='migrated_from')` and reads everything.
- Foreign keys: every typed row's `rid` `REFERENCES memory_item(rid) ON DELETE CASCADE`, and so does `memory_tag.memory_rid`. Consequence for p1d: `DELETE FROM memory_item WHERE item_type IN ('fact','gist','entity','embedding')` clears L1/L2/L3 rows and their tags in one statement (never `'raw'`); `memory_fact_source`, `memory_gist_source` and `memory_link` reference ULIDs (TEXT) and are cleared explicitly. Insert order: `allocateRid` first, then the typed row, then tags (p1b already does this).
- Extra table beyond spec §5 (documented here): `memory_partition_key(project_key INTEGER PRIMARY KEY AUTOINCREMENT, scope_type, scope_id)` maps a project / project-type ULID to the INTEGER `vec0` partition key; `0` is reserved for global (`AUTOINCREMENT` starts at 1). It is the **only** allocator of partition keys: p1d's `projectKey()` (`eyas memory rebuild-index`, its Task 10) allocates rows on demand with `INSERT OR IGNORE (scope_type, scope_id)` + `SELECT project_key`, and Phase 2's embedder reuses the same rows — no parallel counter in `memory_meta`.

- [ ] **Step 0: The shared SQLite-error assertion helper**

Controller ruling (pre-flight finding B1, reproduced on this tree): Drizzle 0.45.2
wraps every SQLite failure from `db.run()` in a `DrizzleError` whose `message` is
``Failed to run the query '<sql>'`` — the real text (`CHECK constraint failed: …`,
`FOREIGN KEY constraint failed`) lives **only** on `.cause.message`. Vitest's
`toThrow(regex)` reads `.message` alone, so `toThrow(/CHECK|constraint/i)` on a
`db.run()` returns **false** (measured), and worse, it would match spuriously
whenever the echoed SQL happens to contain the word. Every constraint assertion in
this plan therefore goes through this helper, which asserts the *cause* text.

```ts
// tests/helpers/sqlite-errors.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Drizzle wraps SQLite failures: db.run() throws a DrizzleError whose message is
// "Failed to run the query '<sql>'" and whose .cause carries the real SQLite
// error. Asserting on .message alone both misses the constraint text and can
// match the SQL echoed into the wrapper. Raw bun:sqlite / better-sqlite3 handles
// throw unwrapped, so this helper handles both shapes.

import { expect } from 'vitest'

export function expectSqliteError(fn: () => unknown, pattern: RegExp): void {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught, 'expected the statement to throw a SQLite error').toBeDefined()
  const cause = (caught as { cause?: unknown }).cause
  const text = cause instanceof Error ? cause.message : String((caught as Error)?.message ?? caught)
  expect(text).toMatch(pattern)
}
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/schema.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { expectSqliteError } from '../../../helpers/sqlite-errors'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import {
  createMemoryV2Tables, allocateRid, findRid, getMemoryMeta, setMemoryMeta,
  MEMORY_V2_TABLES, MEMORY_V2_SCHEMA_VERSION,
} from '@modules/memory/v2/schema'

function setup(): { db: any; caps: SqliteCapabilities } {
  const db = createMemoryDb()
  const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
  createMemoryV2Tables(db, caps)
  return { db, caps }
}

const tableNames = (db: any): Set<string> =>
  new Set((db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`) as Array<{ name: string }>).map((r) => r.name))
const count = (db: any, table: string): number =>
  (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`)) as Array<{ c: number }>)[0].c

describe('createMemoryV2Tables', () => {
  it('creates every table in the contract, the FTS index and the vec0 projection where the connection allows', () => {
    const { db, caps } = setup()
    const names = tableNames(db)
    for (const t of MEMORY_V2_TABLES) expect(names.has(t), `${t} missing`).toBe(true)
    expect(MEMORY_V2_TABLES).toHaveLength(23)
    expect(names.has('memory_raw_fts')).toBe(caps.fts5)
    expect(names.has('memory_embedding_vec')).toBe(caps.vec0)
    expect(getMemoryMeta(db, 'schema_version')).toBe(MEMORY_V2_SCHEMA_VERSION)
  })

  it('is idempotent: a second run changes nothing and keeps data', () => {
    const { db, caps } = setup()
    allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    setMemoryMeta(db, 'probe', 'kept')
    createMemoryV2Tables(db, caps)
    expect(count(db, 'memory_item')).toBe(1)
    expect(getMemoryMeta(db, 'probe')).toBe('kept')
    expect(tableNames(db).size).toBeGreaterThanOrEqual(23)
  })

  it('skips the vec0 table gracefully when caps.vec0 is false, even on a connection that could load it', () => {
    const db = createMemoryDb()
    const real = probeSqliteCapabilities(getRawFromDrizzle(db))
    createMemoryV2Tables(db, { ...real, vec0: false, int8Knn: false })
    expect(tableNames(db).has('memory_embedding_vec')).toBe(false)
    expect(tableNames(db).has('memory_embedding')).toBe(true)
  })

  it('refuses a vec0 table on a connection without the extension, with a message naming the probe', () => {
    const db = createMemoryDb()
    const real = probeSqliteCapabilities(getRawFromDrizzle(db))
    if (real.vec0) return // cannot unload an extension; the path is exercised on boxes without sqlite-vec
    expect(() => createMemoryV2Tables(db, { ...real, vec0: true, int8Knn: true, extensionLoading: true }))
      .toThrow(/memory_embedding_vec.*probeSqliteCapabilities/)
  })

  it('contentless FTS: insert, diacritic-insensitive bm25 query, delete by original text', () => {
    const { db, caps } = setup()
    if (!caps.fts5) throw new Error('FTS5 is required by the existing memory tables; the probe says it is missing')
    const rid = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1)
    const body = 'Az árvíztűrő tükörfúrógép a legjobb magyar tesztmondat.'
    db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${rid}, ${body})`)
    const hits = db.all(sql`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH 'tukorfurogep'`) as any[]
    expect(hits.map((h) => h.rowid)).toEqual([rid])
    expect(hits[0].score).toBeLessThan(0)
    db.run(sql`INSERT INTO memory_raw_fts (memory_raw_fts, rowid, body) VALUES ('delete', ${rid}, ${body})`)
    expect(db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'tukorfurogep'`)).toEqual([])
  })

  it('enforces the CHECK vocabularies of the spec', () => {
    const { db } = setup()
    // INSERT OR IGNORE would swallow a CHECK violation, so allocateRid validates the type itself.
    expect(() => allocateRid(db, 'blob' as any, '01ARZ3NDEKTSV4RRFFQ69G5FAC', 1)).toThrow(/invalid item_type/)
    expectSqliteError(() => db.run(sql`INSERT INTO memory_item (item_type, id, created_at) VALUES ('blob', 'x', 1)`), /CHECK constraint failed/i)
    const rid = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAD', 1)
    const insertRaw = (sourceType: string, trust: string) => db.run(sql`INSERT INTO memory_raw (
        rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
        shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id,
        occurred_at, trust_tier, dek_id, tombstoned, meta_json)
      VALUES (${rid}, '01ARZ3NDEKTSV4RRFFQ69G5FAD', 'h', 'inst', 1, 0, 1, 1, 'conv', ${sourceType}, 'owner-1', 'conv', NULL, NULL, 1, ${trust}, NULL, 0, NULL)`)
    expectSqliteError(() => insertRaw('telepathy', 'owner'), /CHECK constraint failed/i)
    expectSqliteError(() => insertRaw('user_message', 'trusted'), /CHECK constraint failed/i)
    expect(() => insertRaw('user_message', 'owner')).not.toThrow()
    expectSqliteError(() => db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'raw', 'mood', 'x')`), /CHECK constraint failed/i)
    expectSqliteError(() => db.run(sql`INSERT INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at) VALUES ('l1', 'raw', 'a', 'raw', 'b', 'likes', NULL, 1)`), /CHECK constraint failed/i)
  })

  it('cascades from memory_item to the typed row and its tags (the rebuild/undo primitive)', () => {
    const { db } = setup()
    const rid = allocateRid(db, 'fact', '01ARZ3NDEKTSV4RRFFQ69G5FAE', 1)
    db.run(sql`INSERT INTO memory_fact (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, subject, predicate, object_text, trust_tier)
      VALUES (${rid}, '01ARZ3NDEKTSV4RRFFQ69G5FAE', 'h', 'inst', 1, 1, 'owner', 'prefers', 'Hungarian', 'owner')`)
    db.run(sql`INSERT INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'fact', 'layer', 'fact')`)
    db.run(sql`DELETE FROM memory_item WHERE rid = ${rid}`)
    expect(count(db, 'memory_fact')).toBe(0)
    expect(count(db, 'memory_tag')).toBe(0)
  })

  it('rejects a typed row whose rid was never allocated', () => {
    const { db } = setup()
    expectSqliteError(() => db.run(sql`INSERT INTO memory_entity (rid, id, content_hash, origin_instance_id, hlc_physical_ms, created_at, canonical_name, entity_type)
      VALUES (999, 'x', 'h', 'inst', 1, 1, 'EYAS', 'product')`), /FOREIGN KEY constraint failed/i)
  })
})

describe('allocateRid', () => {
  it('hands out increasing integers bound to the ULID', () => {
    const { db } = setup()
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1_700_000_000_000)
    const b = allocateRid(db, 'gist', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1_700_000_000_001)
    expect(Number.isInteger(a)).toBe(true)
    expect(b).toBeGreaterThan(a)
    expect(db.all(sql`SELECT item_type, id, created_at FROM memory_item WHERE rid = ${a}`))
      .toEqual([{ item_type: 'raw', id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', created_at: 1_700_000_000_000 }])
  })

  it('is idempotent on the same id (migration re-runs) and refuses a type change', () => {
    const { db } = setup()
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    expect(allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 2)).toBe(a)
    expect(count(db, 'memory_item')).toBe(1)
    expect(() => allocateRid(db, 'fact', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 3)).toThrow(/already allocated as 'raw'/)
    expect(findRid(db, '01ARZ3NDEKTSV4RRFFQ69G5FAA')).toBe(a)
    expect(findRid(db, 'nope')).toBeNull()
  })

  it('never reuses a rid after a delete (AUTOINCREMENT)', () => {
    const { db } = setup()
    const a = allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAA', 1)
    db.run(sql`DELETE FROM memory_item WHERE rid = ${a}`)
    expect(allocateRid(db, 'raw', '01ARZ3NDEKTSV4RRFFQ69G5FAB', 1)).toBeGreaterThan(a)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/schema.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/schema'`.

- [ ] **Step 3: Write the schema module**

```ts
// src/modules/memory/v2/schema.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Sovereign layered memory — the v2 tables (spec §5 with the Phase 0
// corrections, spike §2 #7 and #21). Additive and idempotent: every
// statement is CREATE ... IF NOT EXISTS, nothing legacy is altered, and a
// re-run is a no-op. Three rules the whole design rests on:
//   1. ONE integer allocator (memory_item.rid) is shared by every typed row,
//      the contentless FTS rowid, the vec0 rowid and memory_tag.memory_rid —
//      ULIDs (id) are the sync identity, never the filter path.
//   2. Timestamps are INTEGER epoch milliseconds everywhere.
//   3. Deleting is a tombstone; the only physical deletes cascade from
//      memory_item, so rebuild/undo can clear a derived layer in one statement
//      and can never touch L0 by accident (item_type 'raw' is excluded there).

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'

export const MEMORY_V2_SCHEMA_VERSION = '1'
export const EMBEDDING_DIMENSIONS = 384

export type MemoryItemType = 'raw' | 'fact' | 'gist' | 'entity' | 'embedding'
const ITEM_TYPES: readonly MemoryItemType[] = ['raw', 'fact', 'gist', 'entity', 'embedding']

/** Every regular table this module owns (the FTS and vec0 virtual tables are conditional). */
export const MEMORY_V2_TABLES = [
  'memory_meta', 'memory_item', 'memory_blob', 'memory_raw', 'memory_fact', 'memory_fact_archive',
  'memory_fact_source', 'memory_gist', 'memory_gist_source', 'memory_entity', 'memory_partition_key',
  'memory_embedding', 'memory_tag', 'memory_link', 'memory_run', 'memory_access_log', 'memory_dek',
  'memory_purge_log', 'memory_idf', 'share_scope', 'share_peer', 'share_grant', 'tombstone',
] as const

const TRUST_TIERS = "('owner','derived','ingested','peer','quarantined')"
const PRESENCE_TIERS = "('hot','warm','cold')"

/** Spec §5 `syncCols` + the surrogate key and the tombstone flag, shared by raw/fact/gist/entity. */
const SYNC_COLUMNS = `
    rid INTEGER PRIMARY KEY REFERENCES memory_item(rid) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    origin_instance_id TEXT NOT NULL,
    hlc_physical_ms INTEGER NOT NULL,
    hlc_logical INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    tombstoned INTEGER NOT NULL DEFAULT 0`

/** memory_fact and memory_fact_archive share these (the archive adds archived_at). */
const FACT_COLUMNS = `${SYNC_COLUMNS},
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object_text TEXT NOT NULL,
    valid_from INTEGER,
    valid_until INTEGER,
    invalidated_by_fact_id TEXT,
    confidence REAL NOT NULL DEFAULT 0.5,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ${TRUST_TIERS}),
    extraction_run_id TEXT,
    entity_id TEXT,
    decay_score REAL NOT NULL DEFAULT 1.0,
    presence_tier TEXT NOT NULL DEFAULT 'hot' CHECK (presence_tier IN ${PRESENCE_TIERS}),
    archived INTEGER NOT NULL DEFAULT 0,
    facts_pending INTEGER NOT NULL DEFAULT 0`

function run(db: EyasDb, ddl: string): void {
  db.run(sql.raw(ddl))
}

function createCoreTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS memory_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)

  // The one allocator. AUTOINCREMENT so a deleted rid is never reused by a
  // later row (FTS/vec projections may still hold it until rebuilt).
  run(db, `CREATE TABLE IF NOT EXISTS memory_item (
    rid INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL CHECK (item_type IN ('raw','fact','gist','entity','embedding')),
    id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_item_type_created ON memory_item (item_type, created_at)`)

  // Content-addressed, deduplicated WITHIN a crypto-shred partition (spike §2 #21 iv).
  run(db, `CREATE TABLE IF NOT EXISTS memory_blob (
    content_hash TEXT NOT NULL,
    shred_partition_id TEXT NOT NULL,
    compressed_blob BLOB NOT NULL,
    byte_length INTEGER NOT NULL,
    ref_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (content_hash, shred_partition_id)
  )`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_raw (${SYNC_COLUMNS},
    shred_partition_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('user_message','assistant_message','tool_result','document','r6_sync','legacy_episodic')),
    actor TEXT NOT NULL,
    conversation_id TEXT,
    project_id TEXT,
    project_type_id TEXT,
    occurred_at INTEGER NOT NULL,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ${TRUST_TIERS}),
    dek_id TEXT,
    meta_json TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_conversation ON memory_raw (conversation_id, occurred_at)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_project ON memory_raw (project_id, occurred_at)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_blob ON memory_raw (content_hash, shred_partition_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_raw_source ON memory_raw (source_type, occurred_at)`)
}

function createFactAndGistTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS memory_fact (${FACT_COLUMNS})`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_subject_predicate ON memory_fact (subject, predicate, valid_until)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_run ON memory_fact (extraction_run_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_entity ON memory_fact (entity_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_hash ON memory_fact (content_hash)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_presence ON memory_fact (presence_tier, decay_score)`)

  // Same shape, off the hot path and off the default consolidation scan (spec §4 L1 retention).
  run(db, `CREATE TABLE IF NOT EXISTS memory_fact_archive (${FACT_COLUMNS},
    archived_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_archive_subject ON memory_fact_archive (subject, predicate)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_fact_source (
    fact_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    PRIMARY KEY (fact_id, episode_id)
  ) WITHOUT ROWID`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_fact_source_episode ON memory_fact_source (episode_id)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_gist (${SYNC_COLUMNS},
    scope_type TEXT NOT NULL CHECK (scope_type IN ('global','task','project','project_type','topic','era')),
    scope_id TEXT,
    tree_depth INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    structured_json TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    trust_tier TEXT NOT NULL CHECK (trust_tier IN ${TRUST_TIERS}),
    token_count INTEGER NOT NULL DEFAULT 0,
    importance_score REAL NOT NULL DEFAULT 0.5,
    gist_source TEXT NOT NULL CHECK (gist_source IN ('heuristic','model')),
    consolidation_run_id TEXT,
    supersedes_gist_id TEXT,
    superseded_by_gist_id TEXT,
    is_current INTEGER NOT NULL DEFAULT 1,
    decay_score REAL NOT NULL DEFAULT 1.0,
    presence_tier TEXT NOT NULL DEFAULT 'hot' CHECK (presence_tier IN ${PRESENCE_TIERS}),
    alternate_of_gist_id TEXT,
    multi_project INTEGER NOT NULL DEFAULT 0,
    times_retrieved INTEGER NOT NULL DEFAULT 0,
    changelog_json TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_scope ON memory_gist (scope_type, scope_id, is_current)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_pinned ON memory_gist (scope_type, is_current) WHERE pinned = 1`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_run ON memory_gist (consolidation_run_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_presence ON memory_gist (presence_tier, decay_score)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_gist_source (
    gist_id TEXT NOT NULL,
    child_type TEXT NOT NULL CHECK (child_type IN ('raw','fact','gist','entity')),
    child_id TEXT NOT NULL,
    PRIMARY KEY (gist_id, child_type, child_id)
  ) WITHOUT ROWID`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_gist_source_child ON memory_gist_source (child_type, child_id)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_entity (${SYNC_COLUMNS},
    canonical_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    merged_into_entity_id TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_name ON memory_entity (canonical_name)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_type_name ON memory_entity (entity_type, canonical_name)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_entity_merged ON memory_entity (merged_into_entity_id)`)
}

function createIndexLayerTables(db: EyasDb, caps: SqliteCapabilities): void {
  // vec0 partitions are INTEGER; projects and project types are ULIDs. 0 = global.
  run(db, `CREATE TABLE IF NOT EXISTS memory_partition_key (
    project_key INTEGER PRIMARY KEY AUTOINCREMENT,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('project','project_type')),
    scope_id TEXT NOT NULL,
    UNIQUE (scope_type, scope_id)
  )`)

  // int8 vectors of facts, gists and entity names only — never raw text (spec §4 L3).
  run(db, `CREATE TABLE IF NOT EXISTS memory_embedding (
    rid INTEGER PRIMARY KEY REFERENCES memory_item(rid) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('fact','gist','entity')),
    owner_id TEXT NOT NULL,
    owner_rid INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    dimensions INTEGER NOT NULL DEFAULT ${EMBEDDING_DIMENSIONS},
    vector BLOB NOT NULL,
    project_key INTEGER NOT NULL DEFAULT 0,
    live_in_index INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    UNIQUE (owner_type, owner_id, model_id)
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_embedding_live ON memory_embedding (live_in_index, project_key)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_embedding_owner_rid ON memory_embedding (owner_rid)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_embedding_model ON memory_embedding (model_id)`)

  if (caps.vec0) {
    // rowid = memory_embedding.rid; rebuildable from memory_embedding.vector (Phase 2 populates it).
    try {
      run(db, `CREATE VIRTUAL TABLE IF NOT EXISTS memory_embedding_vec USING vec0(
        project_key INTEGER PARTITION KEY,
        embedding int8[${EMBEDDING_DIMENSIONS}]
      )`)
    } catch (err) {
      throw new Error(
        `memory_embedding_vec could not be created although caps.vec0 is true — sqlite-vec is not loaded on THIS connection; `
        + `probe it first with probeSqliteCapabilities(rawHandle) (${String(err)})`,
      )
    }
  }

  run(db, `CREATE TABLE IF NOT EXISTS memory_tag (
    memory_rid INTEGER NOT NULL REFERENCES memory_item(rid) ON DELETE CASCADE,
    memory_type TEXT NOT NULL CHECK (memory_type IN ('raw','fact','gist','entity','embedding')),
    tag_type TEXT NOT NULL CHECK (tag_type IN ('project','project_type','task','kind','entity','topic','source_type','language','trust_tier','layer')),
    tag_value TEXT NOT NULL,
    PRIMARY KEY (memory_rid, tag_type, tag_value)
  ) WITHOUT ROWID`)
  // The covering index every filtered read uses (`+rowid IN (SELECT memory_rid FROM memory_tag ...)`).
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_tag_lookup ON memory_tag (tag_type, tag_value, memory_type, memory_rid)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_idf (
    stem TEXT PRIMARY KEY,
    df INTEGER NOT NULL
  ) WITHOUT ROWID`)
}

function createProvenanceTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS memory_link (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (link_type IN ('derived_from','supersedes','invalidates','part_of','merged_into','alternate_of','migrated_from')),
    run_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (from_type, from_id, to_type, to_id, link_type)
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_link_from ON memory_link (from_type, from_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_link_to ON memory_link (to_type, to_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_link_run ON memory_link (run_id)`)

  // memory_capture_runs widened (spec §5): a skip writes a row too.
  run(db, `CREATE TABLE IF NOT EXISTS memory_run (
    id TEXT PRIMARY KEY,
    run_type TEXT NOT NULL CHECK (run_type IN ('extraction','consolidation_light','consolidation_heavy','migration')),
    status TEXT NOT NULL CHECK (status IN ('ok','partial','failed','skipped','degraded_no_model')),
    conversation_id TEXT,
    model_used TEXT,
    prompt_template_hash TEXT,
    raw_model_output_hash TEXT,
    rejected_candidate_count INTEGER NOT NULL DEFAULT 0,
    quarantined_candidate_count INTEGER NOT NULL DEFAULT 0,
    model_calls_used INTEGER NOT NULL DEFAULT 0,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    duration_api_ms INTEGER,
    provider_version TEXT,
    stats_json TEXT,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_run_type_created ON memory_run (run_type, created_at)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_run_conversation ON memory_run (conversation_id, created_at)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    actor TEXT NOT NULL CHECK (actor IN ('system_index','model_drilldown','user_ui')),
    memory_type TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('inject','drilldown_read','edit','tombstone','crypto_shred','purge')),
    context_task_id TEXT,
    tokens_estimate INTEGER,
    rank_detail_json TEXT
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_access_log_ts ON memory_access_log (ts)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log (memory_type, memory_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_memory_access_log_task ON memory_access_log (context_task_id, ts)`)

  run(db, `CREATE TABLE IF NOT EXISTS memory_dek (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    destroyed_at INTEGER,
    UNIQUE (scope, scope_id)
  )`)

  // Survives every purge: kept outside every table it describes (spec §11).
  run(db, `CREATE TABLE IF NOT EXISTS memory_purge_log (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    reason TEXT NOT NULL,
    purged_by TEXT NOT NULL,
    purged_at INTEGER NOT NULL,
    details_json TEXT
  )`)
}

/** R6 scaffolding (spec §12): present and empty; a solo instance is L4 with an empty peer set. */
function createShareTables(db: EyasDb): void {
  run(db, `CREATE TABLE IF NOT EXISTS share_scope (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('project','tag')),
    scope_value TEXT NOT NULL,
    sync_gists INTEGER NOT NULL DEFAULT 0,
    hmac_key_id TEXT,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE (scope_type, scope_value)
  )`)
  run(db, `CREATE TABLE IF NOT EXISTS share_peer (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL UNIQUE,
    public_key TEXT,
    last_ack_hlc INTEGER,
    presumed_gone_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE TABLE IF NOT EXISTS share_grant (
    id TEXT PRIMARY KEY,
    scope_id TEXT NOT NULL REFERENCES share_scope(id),
    peer_id TEXT NOT NULL REFERENCES share_peer(id),
    token_id TEXT,
    issued_by_instance_id TEXT NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_share_grant_scope_peer ON share_grant (scope_id, peer_id)`)
  run(db, `CREATE TABLE IF NOT EXISTS tombstone (
    id TEXT PRIMARY KEY,
    entity_table TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT,
    hlc_physical_ms INTEGER NOT NULL,
    hlc_logical INTEGER NOT NULL DEFAULT 0,
    compacted_at INTEGER,
    created_at INTEGER NOT NULL
  )`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_tombstone_entity ON tombstone (entity_table, entity_id)`)
  run(db, `CREATE INDEX IF NOT EXISTS idx_tombstone_compacted ON tombstone (compacted_at)`)
}

/** Contentless FTS5 over L0 text (spec §5), rowid = memory_raw.rid, populated at flush. */
function createRawFts(db: EyasDb): void {
  try {
    run(db, `CREATE VIRTUAL TABLE IF NOT EXISTS memory_raw_fts USING fts5(
      body,
      content='',
      tokenize='unicode61 remove_diacritics 2'
    )`)
    setMemoryMeta(db, 'fts_tokenizer', 'unicode61 remove_diacritics 2')
  } catch {
    // Same fallback search/conversation-fts.ts uses for a SQLite without remove_diacritics 2.
    run(db, `CREATE VIRTUAL TABLE IF NOT EXISTS memory_raw_fts USING fts5(
      body,
      content='',
      tokenize='unicode61'
    )`)
    setMemoryMeta(db, 'fts_tokenizer', 'unicode61')
  }
}

export function createMemoryV2Tables(db: EyasDb, caps: SqliteCapabilities): void {
  createCoreTables(db)
  createFactAndGistTables(db)
  createIndexLayerTables(db, caps)
  createProvenanceTables(db)
  createShareTables(db)
  if (caps.fts5) createRawFts(db)
  db.run(sql`INSERT OR IGNORE INTO memory_meta (key, value) VALUES ('schema_version', ${MEMORY_V2_SCHEMA_VERSION})`)
}

/**
 * Reserve the integer surrogate for a ULID. Idempotent: an id that is
 * already allocated returns its existing rid (INSERT OR IGNORE — what makes
 * the migration re-runnable); the same id under another type is a bug.
 */
export function allocateRid(db: EyasDb, itemType: MemoryItemType, id: string, createdAt: number): number {
  // OR IGNORE also ignores CHECK violations, so the vocabulary is enforced here.
  if (!ITEM_TYPES.includes(itemType)) throw new RangeError(`allocateRid: invalid item_type '${String(itemType)}'`)
  db.run(sql`INSERT OR IGNORE INTO memory_item (item_type, id, created_at) VALUES (${itemType}, ${id}, ${createdAt})`)
  const row = db.all<{ rid: number; item_type: string }>(sql`SELECT rid, item_type FROM memory_item WHERE id = ${id}`)[0]
  if (!row) throw new Error(`allocateRid: memory_item row for ${id} is missing after insert`)
  if (row.item_type !== itemType) {
    throw new Error(`allocateRid: ${id} is already allocated as '${row.item_type}', not '${itemType}'`)
  }
  return row.rid
}

export function findRid(db: EyasDb, id: string): number | null {
  return db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${id}`)[0]?.rid ?? null
}

export function getMemoryMeta(db: EyasDb, key: string): string | null {
  return db.all<{ value: string }>(sql`SELECT value FROM memory_meta WHERE key = ${key}`)[0]?.value ?? null
}

export function setMemoryMeta(db: EyasDb, key: string, value: string): void {
  db.run(sql`INSERT INTO memory_meta (key, value) VALUES (${key}, ${value})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
}
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `bun vitest run tests/modules/memory/v2/schema.test.ts && bun run lint`
Expected: PASS (11 tests; the "refuses a vec0 table on a connection without the extension" case returns early on a box where sqlite-vec loads); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/schema.ts tests/modules/memory/v2/schema.test.ts
git commit -m "feat(memory): sovereign layered memory v2 schema with one integer allocator"
```

---
### Task 8: Run ledger (`runs.ts`) and instance id (`instance.ts`)

**Files:**
- Create: `src/modules/memory/v2/runs.ts`
- Create: `src/modules/memory/v2/instance.ts`
- Test: `tests/modules/memory/v2/runs-instance.test.ts`

**Interfaces:**
- Produces (contract): `export interface MemoryRunInput { runType: 'extraction'|'consolidation_light'|'consolidation_heavy'|'migration'; status: 'ok'|'partial'|'failed'|'skipped'|'degraded_no_model'; modelUsed?: string|null; promptTemplateHash?: string|null; rawModelOutputHash?: string|null; rejectedCandidateCount?: number; quarantinedCandidateCount?: number; modelCallsUsed?: number; tokensIn?: number; tokensOut?: number; costUsd?: number|null; durationApiMs?: number|null; providerVersion?: string|null; statsJson?: Record<string, unknown>; conversationId?: string|null }` (`conversationId` is an addition: extraction runs are per task — p1c passes it, p1d passes nothing); `export function recordRun(db: EyasDb, run: MemoryRunInput): string` (ULID; the row is complete — `finished_at = created_at`); helpers `finishRun(db, runId, patch)` (re-stamps `finished_at`, merges the given fields; throws on an unknown run), `getRun(db, runId): MemoryRunRow | null`. `export function getInstanceId(db: EyasDb): string` — `memory_meta['instance_id']`, a ULID generated once; `INSTANCE_ID_META_KEY = 'instance_id'`. p1b stamps it on every `memory_raw.origin_instance_id`; p1d on every migrated row.
- Consumes: `memory_run` and `memory_meta` from Task 7; `generateId` from `@shared/crypto`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/runs-instance.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { expectSqliteError } from '../../../helpers/sqlite-errors'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { recordRun, finishRun, getRun } from '@modules/memory/v2/runs'
import { getInstanceId, INSTANCE_ID_META_KEY } from '@modules/memory/v2/instance'
import { ulidTimestampMs } from '@shared/crypto'

function setup(): any {
  const db = createMemoryDb()
  createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
  return db
}

describe('recordRun / finishRun / getRun', () => {
  it('records a complete run with defaults and returns its ULID', () => {
    const db = setup()
    const before = Date.now()
    const id = recordRun(db, { runType: 'extraction', status: 'degraded_no_model', conversationId: 'conv-1' })
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(ulidTimestampMs(id)).toBeGreaterThanOrEqual(before)
    const run = getRun(db, id)
    expect(run).toMatchObject({
      id, runType: 'extraction', status: 'degraded_no_model', conversationId: 'conv-1',
      modelUsed: null, promptTemplateHash: null, rawModelOutputHash: null,
      rejectedCandidateCount: 0, quarantinedCandidateCount: 0, modelCallsUsed: 0, tokensIn: 0, tokensOut: 0,
      costUsd: null, durationApiMs: null, providerVersion: null, statsJson: null,
    })
    expect(run!.createdAt).toBeGreaterThanOrEqual(before)
    expect(run!.finishedAt).toBe(run!.createdAt)
  })

  it('round-trips every field, including stats_json and cost', () => {
    const db = setup()
    const id = recordRun(db, {
      runType: 'migration', status: 'ok', modelUsed: null, promptTemplateHash: 'p'.repeat(64), rawModelOutputHash: 'r'.repeat(64),
      rejectedCandidateCount: 2, quarantinedCandidateCount: 1, modelCallsUsed: 1, tokensIn: 6300, tokensOut: 500,
      costUsd: 0.015, durationApiMs: 7392, providerVersion: '2.1.89', statsJson: { raw: 336, blob: 336, surprises: ['x'] },
    })
    const run = getRun(db, id)!
    expect(run.statsJson).toEqual({ raw: 336, blob: 336, surprises: ['x'] })
    expect(run.costUsd).toBeCloseTo(0.015)
    expect(run.durationApiMs).toBe(7392)
    expect(run.providerVersion).toBe('2.1.89')
    expect(run.tokensIn).toBe(6300)
  })

  it('finishRun merges a patch, re-stamps finished_at, and refuses an unknown run', () => {
    const db = setup()
    const id = recordRun(db, { runType: 'consolidation_heavy', status: 'partial', modelCallsUsed: 3 })
    const first = getRun(db, id)!
    finishRun(db, id, { status: 'ok', tokensOut: 42, statsJson: { clusters: 7 } })
    const after = getRun(db, id)!
    expect(after.status).toBe('ok')
    expect(after.tokensOut).toBe(42)
    expect(after.modelCallsUsed).toBe(3)         // untouched by the patch
    expect(after.statsJson).toEqual({ clusters: 7 })
    expect(after.finishedAt).toBeGreaterThanOrEqual(first.finishedAt!)
    expect(() => finishRun(db, 'nope', { status: 'failed' })).toThrow(/unknown run/)
  })

  it('rejects an invalid status or type at the database (CHECK)', () => {
    const db = setup()
    expectSqliteError(() => recordRun(db, { runType: 'extraction', status: 'done' as any }), /CHECK constraint failed/i)
    expectSqliteError(() => recordRun(db, { runType: 'dream' as any, status: 'ok' }), /CHECK constraint failed/i)
    expect(getRun(db, 'missing')).toBeNull()
  })
})

describe('getInstanceId', () => {
  it('generates a ULID once and returns the same value afterwards', () => {
    const db = setup()
    const a = getInstanceId(db)
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(getInstanceId(db)).toBe(a)
    expect(db.all(sql`SELECT value FROM memory_meta WHERE key = ${INSTANCE_ID_META_KEY}`)).toEqual([{ value: a }])
  })

  it('differs between instances (two databases)', () => {
    expect(getInstanceId(setup())).not.toBe(getInstanceId(setup()))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/runs-instance.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/runs'`.

- [ ] **Step 3: Write both modules**

```ts
// src/modules/memory/v2/runs.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// memory_run — one audited ledger for extraction, consolidation and
// migration (spec §5; today's memory_capture_runs widened, not duplicated).
// The discipline it keeps: a skip writes a row too, so "why did nothing
// happen" is always answerable. Cost fields come from spike §2 #17.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'

export type MemoryRunType = 'extraction' | 'consolidation_light' | 'consolidation_heavy' | 'migration'
export type MemoryRunStatus = 'ok' | 'partial' | 'failed' | 'skipped' | 'degraded_no_model'

export interface MemoryRunInput {
  runType: MemoryRunType
  status: MemoryRunStatus
  /** The task an extraction run served; null for consolidation and migration. */
  conversationId?: string | null
  modelUsed?: string | null
  promptTemplateHash?: string | null
  rawModelOutputHash?: string | null
  rejectedCandidateCount?: number
  quarantinedCandidateCount?: number
  modelCallsUsed?: number
  tokensIn?: number
  tokensOut?: number
  costUsd?: number | null
  durationApiMs?: number | null
  /** SDK-bundled CLI version for claude-code, the API version string otherwise. */
  providerVersion?: string | null
  statsJson?: Record<string, unknown>
}

export interface MemoryRunRow {
  id: string
  runType: MemoryRunType
  status: MemoryRunStatus
  conversationId: string | null
  modelUsed: string | null
  promptTemplateHash: string | null
  rawModelOutputHash: string | null
  rejectedCandidateCount: number
  quarantinedCandidateCount: number
  modelCallsUsed: number
  tokensIn: number
  tokensOut: number
  costUsd: number | null
  durationApiMs: number | null
  providerVersion: string | null
  statsJson: Record<string, unknown> | null
  createdAt: number
  finishedAt: number | null
}

interface RawRunRow {
  id: string
  run_type: MemoryRunType
  status: MemoryRunStatus
  conversation_id: string | null
  model_used: string | null
  prompt_template_hash: string | null
  raw_model_output_hash: string | null
  rejected_candidate_count: number
  quarantined_candidate_count: number
  model_calls_used: number
  tokens_in: number
  tokens_out: number
  cost_usd: number | null
  duration_api_ms: number | null
  provider_version: string | null
  stats_json: string | null
  created_at: number
  finished_at: number | null
}

function toRow(r: RawRunRow): MemoryRunRow {
  return {
    id: r.id,
    runType: r.run_type,
    status: r.status,
    conversationId: r.conversation_id,
    modelUsed: r.model_used,
    promptTemplateHash: r.prompt_template_hash,
    rawModelOutputHash: r.raw_model_output_hash,
    rejectedCandidateCount: r.rejected_candidate_count,
    quarantinedCandidateCount: r.quarantined_candidate_count,
    modelCallsUsed: r.model_calls_used,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    durationApiMs: r.duration_api_ms,
    providerVersion: r.provider_version,
    statsJson: r.stats_json ? (JSON.parse(r.stats_json) as Record<string, unknown>) : null,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }
}

/** Insert a complete run row; returns its ULID. */
export function recordRun(db: EyasDb, run: MemoryRunInput): string {
  const id = generateId()
  const now = Date.now()
  db.run(sql`INSERT INTO memory_run (
      id, run_type, status, conversation_id, model_used, prompt_template_hash, raw_model_output_hash,
      rejected_candidate_count, quarantined_candidate_count, model_calls_used, tokens_in, tokens_out,
      cost_usd, duration_api_ms, provider_version, stats_json, created_at, finished_at)
    VALUES (
      ${id}, ${run.runType}, ${run.status}, ${run.conversationId ?? null}, ${run.modelUsed ?? null},
      ${run.promptTemplateHash ?? null}, ${run.rawModelOutputHash ?? null},
      ${run.rejectedCandidateCount ?? 0}, ${run.quarantinedCandidateCount ?? 0}, ${run.modelCallsUsed ?? 0},
      ${run.tokensIn ?? 0}, ${run.tokensOut ?? 0}, ${run.costUsd ?? null}, ${run.durationApiMs ?? null},
      ${run.providerVersion ?? null}, ${run.statsJson ? JSON.stringify(run.statsJson) : null}, ${now}, ${now})`)
  return id
}

export function getRun(db: EyasDb, runId: string): MemoryRunRow | null {
  const row = db.all<RawRunRow>(sql`SELECT * FROM memory_run WHERE id = ${runId}`)[0]
  return row ? toRow(row) : null
}

/** Merge a patch into an existing run and re-stamp finished_at. */
export function finishRun(
  db: EyasDb,
  runId: string,
  patch: Partial<Omit<MemoryRunInput, 'runType'>> & { status: MemoryRunStatus },
): void {
  const current = getRun(db, runId)
  if (!current) throw new Error(`finishRun: unknown run ${runId}`)
  const stats = patch.statsJson !== undefined ? patch.statsJson : current.statsJson
  db.run(sql`UPDATE memory_run SET
      status = ${patch.status},
      conversation_id = ${patch.conversationId !== undefined ? patch.conversationId : current.conversationId},
      model_used = ${patch.modelUsed !== undefined ? patch.modelUsed : current.modelUsed},
      prompt_template_hash = ${patch.promptTemplateHash !== undefined ? patch.promptTemplateHash : current.promptTemplateHash},
      raw_model_output_hash = ${patch.rawModelOutputHash !== undefined ? patch.rawModelOutputHash : current.rawModelOutputHash},
      rejected_candidate_count = ${patch.rejectedCandidateCount ?? current.rejectedCandidateCount},
      quarantined_candidate_count = ${patch.quarantinedCandidateCount ?? current.quarantinedCandidateCount},
      model_calls_used = ${patch.modelCallsUsed ?? current.modelCallsUsed},
      tokens_in = ${patch.tokensIn ?? current.tokensIn},
      tokens_out = ${patch.tokensOut ?? current.tokensOut},
      cost_usd = ${patch.costUsd !== undefined ? patch.costUsd : current.costUsd},
      duration_api_ms = ${patch.durationApiMs !== undefined ? patch.durationApiMs : current.durationApiMs},
      provider_version = ${patch.providerVersion !== undefined ? patch.providerVersion : current.providerVersion},
      stats_json = ${stats ? JSON.stringify(stats) : null},
      finished_at = ${Date.now()}
    WHERE id = ${runId}`)
}
```

```ts
// src/modules/memory/v2/instance.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// origin_instance_id for every syncable row (spec §5, §12). Not a secret —
// it identifies this EYAS to future peers — so it lives in memory_meta
// rather than the secrets registry, whose API is async and empty until the
// master key exists (the flush needs the id synchronously on every insert).

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { getMemoryMeta } from './schema.js'

export const INSTANCE_ID_META_KEY = 'instance_id'

/** The instance's ULID, generated once and kept forever. */
export function getInstanceId(db: EyasDb): string {
  const existing = getMemoryMeta(db, INSTANCE_ID_META_KEY)
  if (existing) return existing
  const candidate = generateId()
  // OR IGNORE: if a concurrent caller won the race, keep theirs.
  db.run(sql`INSERT OR IGNORE INTO memory_meta (key, value) VALUES (${INSTANCE_ID_META_KEY}, ${candidate})`)
  return getMemoryMeta(db, INSTANCE_ID_META_KEY) ?? candidate
}
```

- [ ] **Step 4: Run the tests and the type-check**

Run: `bun vitest run tests/modules/memory/v2/runs-instance.test.ts && bun run lint`
Expected: PASS (6 tests); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/runs.ts src/modules/memory/v2/instance.ts tests/modules/memory/v2/runs-instance.test.ts
git commit -m "feat(memory): memory_run ledger helpers and the once-generated instance id"
```

---
### Task 9: Create the v2 tables from memory's `onRegister`

**Files:**
- Modify: `src/modules/memory/index.ts:25-30` (imports), `:45-47` (`onRegister`)
- Test: `tests/modules/memory/v2/register-v2-tables.test.ts`

**Interfaces:**
- Produces: on every boot, right after `createMemoryTables(ctx.db)`, the v2 tables exist on the main connection and sqlite-vec is loaded on it (probe side effect) — the precondition p1b's `wireL0Capture` (its Task 11) and p1c/p1d rely on. The probe result is cached on the main raw handle, so p1b's later `getSqliteCapabilities()` returns the same object without re-probing.
- Consumes: `createMemoryV2Tables` (Task 7), `probeSqliteCapabilities` + `rawHandleOf` (Task 4). `getRawDatabase` is already imported at `memory/index.ts:30`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/register-v2-tables.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The real module against a real file-backed main connection, the way
// bootstrap runs it: onRegister must leave every v2 table in place next to
// the legacy ones, using the main connection's capability probe.

import { describe, it, expect, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabase, closeDatabase } from '@core/db/connection'
import { getSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { MEMORY_V2_TABLES } from '@modules/memory/v2/schema'
import { memoryModule } from '@modules/memory/index'

const silentLogger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return silentLogger },
}

const tableNames = (db: any): Set<string> =>
  new Set((db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`) as Array<{ name: string }>).map((r) => r.name))

describe('memory module onRegister creates the v2 tables on the main connection', () => {
  const dir = join(tmpdir(), `eyas-memory-v2-register-${Date.now()}`)

  afterEach(() => {
    closeDatabase()
    try { rmSync(dir, { recursive: true }) } catch {}
  })

  it('creates every v2 table next to the legacy ones, using the main connection probe', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    await memoryModule.onRegister!({ db, logger: silentLogger } as any)
    const names = tableNames(db)
    for (const t of MEMORY_V2_TABLES) expect(names.has(t), `${t} missing`).toBe(true)
    expect(names.has('episodic_memories')).toBe(true) // legacy untouched
    expect(names.has('memory_capture_runs')).toBe(true)
    const caps = getSqliteCapabilities()
    expect(names.has('memory_raw_fts')).toBe(caps.fts5)
    expect(names.has('memory_embedding_vec')).toBe(caps.vec0)
  })

  it('is safe to register twice (restart)', async () => {
    const db = createDatabase(join(dir, 'eyas.db'))
    const ctx = { db, logger: silentLogger } as any
    await memoryModule.onRegister!(ctx)
    await memoryModule.onRegister!(ctx)
    expect(tableNames(db).has('memory_item')).toBe(true)
  })
})

describe('memory/index.ts wiring (source contract)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/memory/index.ts'), 'utf-8')
  it('creates the v2 tables in onRegister right after the legacy tables', () => {
    const legacy = source.indexOf('createMemoryTables(ctx.db)')
    const v2 = source.indexOf('createMemoryV2Tables(ctx.db')
    expect(legacy).toBeGreaterThan(-1)
    expect(v2).toBeGreaterThan(legacy)
    expect(source).toMatch(/probeSqliteCapabilities\(rawHandleOf\(ctx\.db\)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/register-v2-tables.test.ts`
Expected: FAIL — `memory_meta missing` (and the source-contract case).

- [ ] **Step 3: Wire it**

The import block of `src/modules/memory/index.ts` currently ends (lines 25–30):

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
import { probeSqliteCapabilities, rawHandleOf } from '@core/db/sqlite-capabilities.js'
import { createMemoryV2Tables } from './v2/schema.js'
```

`onRegister` currently begins (lines 45–47):

```ts
  async onRegister(ctx: ModuleContext) {
    createMemoryTables(ctx.db)

```

Change to:

```ts
  async onRegister(ctx: ModuleContext) {
    createMemoryTables(ctx.db)

    // Sovereign layered memory (v2) tables — additive, idempotent, created
    // under BOTH engines so L0 capture (plan p1b) always has a sink. The
    // probe runs on this very connection and leaves sqlite-vec loaded on it,
    // which is what the vec0 DDL needs; its result is cached for
    // getSqliteCapabilities() later in onStart.
    try {
      createMemoryV2Tables(ctx.db, probeSqliteCapabilities(rawHandleOf(ctx.db), ctx.logger))
    } catch (err) {
      ctx.logger.error({ err }, 'memory v2 tables could not be created; L0 capture will stay buffered until the next start')
    }

```

- [ ] **Step 4: Run the test, the type-check, and the boot test**

Run: `bun vitest run tests/modules/memory/v2/register-v2-tables.test.ts tests/core/bootstrap.test.ts && bun run lint`
Expected: PASS (3 + 1); `tsc` clean. The boot log of `bootstrap.test.ts` shows no `memory v2 tables could not be created` line.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/index.ts tests/modules/memory/v2/register-v2-tables.test.ts
git commit -m "feat(memory): create the v2 tables on register with the main-connection capability probe"
```

---
### Task 10: Query-shape regression suite (port of the spike's `shapes.sql`)

**Files:**
- Create: `tests/modules/memory/v2/shapes-fixture.ts`
- Test: `tests/modules/memory/v2/query-shapes.test.ts`

**Interfaces:**
- Produces: `buildShapesFixture(rows: number, seed?: number): ShapesFixture` — a deterministic 384-d int8 corpus (mulberry32, seed 1234 like the spike's `build.ts`) over the real `memory_item` / `memory_tag` / `memory_raw_fts` / `memory_embedding_vec` tables plus two ad-hoc vec0 tables (`qs_vec_plain`, `qs_vec_meta`) that exist only to prove the shapes are interchangeable. Phase 2's `js-int8-scan.test.ts` and the nightly `scripts/bench/memory-knn-200k.ts` reuse it at other sizes.
- Asserts (spike §5 row "shapes.sql"), **identity only** — latency is not asserted in the unit suite (5 000 rows say nothing; the nightly bench at 200 k does): (1) filtered KNN top-50: `rowid IN (subquery)` == temp table == `PARTITION KEY =` == metadata `=` for a 0.3 %, 1.1 % and 2 % project; (2) the D1 set: `project_key IN (0, ?)` returns k rows **per partition**, the flattened subquery + outer `LIMIT` errors, the `MATERIALIZED` CTE returns exactly the top-50 of the union; (3) partition + `rowid IN` combine; (4) FTS filter shapes A (naive `rowid IN`), B (`+rowid IN`), C (subselect + JOIN), E (CROSS JOIN) return identical rows and scores; (5) over-fetch-then-filter loses recall (the reason it is banned); (6) diacritics: `szamla` finds `számla`.
- Consumes: Task 7 schema, Task 4 probe, `getRawFromDrizzle` (raw prepared statements bind `Buffer` vectors exactly as production will).

- [ ] **Step 1: Write the fixture**

```ts
// tests/modules/memory/v2/shapes-fixture.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Deterministic corpus for the read-path SQL shapes (port of the Phase 0
// spike's fts-knn-shapes/common.ts + build.ts). Same seed → same vectors,
// same project assignment, same FTS bodies, at any row count.

import { createMemoryDb, getRawFromDrizzle } from '../../../helpers/test-db'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables, EMBEDDING_DIMENSIONS } from '@modules/memory/v2/schema'

export const N_PROJECTS = 40
/** Selectivity ramps from 0.3 % (p1) to 2 % (p40); the rest (~54 %) is global (partition 0). */
export const PROJECT_WEIGHTS = Array.from({ length: N_PROJECTS }, (_, i) => 0.003 + (0.017 * i) / (N_PROJECTS - 1))
export const SMALL_PROJECT = 1
export const MID_PROJECT = 20
export const LARGE_PROJECT = 40

export const HU_WORDS = 'számla vevő szállító projekt feladat árajánlat készlet raktár beszerzés jóváhagyás kiegyenlítés ügyfél telefonszám adószám átutalás előleg határidő módosítás értesítés visszaigazolás könyvelés szerződés hibajegy verzió frissítés telepítés konténer memória keresés beágyazás címke összefoglaló döntés kérdés válasz tegnap holnap fizetés kedvezmény'.split(' ')
export const EN_WORDS = 'invoice customer vendor project task quotation stock warehouse purchase approval payment client phone tax transfer deposit deadline change notification confirmation accounting contract ticket version update install container memory search embedding tag summary decision question answer yesterday tomorrow discount migration cluster pipeline'.split(' ')

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gaussian-ish unit vector (sum of four uniforms), scaled so max |x| = 127. */
export function makeInt8Vector(r: () => number): Int8Array {
  const f = new Float32Array(EMBEDDING_DIMENSIONS)
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    const g = r() + r() + r() + r() - 2
    f[i] = g
    norm += g * g
  }
  norm = Math.sqrt(norm)
  let maxAbs = 0
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    f[i] /= norm
    if (Math.abs(f[i]) > maxAbs) maxAbs = Math.abs(f[i])
  }
  const i8 = new Int8Array(EMBEDDING_DIMENSIONS)
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) i8[i] = Math.round((f[i] / maxAbs) * 127)
  return i8
}

/** 0 = global, 1..40 = project. */
export function pickProject(r: () => number): number {
  let x = r()
  for (let i = 0; i < N_PROJECTS; i++) {
    x -= PROJECT_WEIGHTS[i]
    if (x < 0) return i + 1
  }
  return 0
}

export interface ShapesFixture {
  db: any
  raw: any
  caps: SqliteCapabilities
  rows: number
  /** Query vector, as the Buffer production binds through vec_int8(?). */
  queryVector: Buffer
  projectRows(project: number): number
}

export function buildShapesFixture(rows: number, seed = 1234): ShapesFixture {
  const db = createMemoryDb()
  const raw = getRawFromDrizzle(db)
  const caps = probeSqliteCapabilities(raw)
  createMemoryV2Tables(db, caps)
  if (caps.vec0) {
    raw.exec(`CREATE VIRTUAL TABLE qs_vec_plain USING vec0(embedding int8[${EMBEDDING_DIMENSIONS}])`)
    raw.exec(`CREATE VIRTUAL TABLE qs_vec_meta USING vec0(embedding int8[${EMBEDDING_DIMENSIONS}], project_key INTEGER)`)
  }
  const insItem = raw.prepare(`INSERT INTO memory_item (item_type, id, created_at) VALUES ('fact', ?, ?) RETURNING rid`)
  const insPart = caps.vec0 ? raw.prepare(`INSERT INTO memory_embedding_vec(rowid, project_key, embedding) VALUES (?, ?, vec_int8(?))`) : null
  const insPlain = caps.vec0 ? raw.prepare(`INSERT INTO qs_vec_plain(rowid, embedding) VALUES (?, vec_int8(?))`) : null
  const insMeta = caps.vec0 ? raw.prepare(`INSERT INTO qs_vec_meta(rowid, embedding, project_key) VALUES (?, vec_int8(?), ?)`) : null
  const insTag = raw.prepare(`INSERT INTO memory_tag(memory_rid, memory_type, tag_type, tag_value) VALUES (?, 'fact', 'project', ?)`)
  const insFts = caps.fts5 ? raw.prepare(`INSERT INTO memory_raw_fts(rowid, body) VALUES (?, ?)`) : null

  const r = mulberry32(seed)
  raw.exec('BEGIN')
  try {
    for (let i = 1; i <= rows; i++) {
      const rid = (insItem.get(`shape-${seed}-${i}`, i) as { rid: number }).rid
      const vector = Buffer.from(makeInt8Vector(r).buffer)
      const project = pickProject(r)
      if (insPart && insPlain && insMeta) {
        insPart.run(rid, project, vector)
        insPlain.run(rid, vector)
        insMeta.run(rid, vector, project)
      }
      if (project > 0) insTag.run(rid, `p${project}`)
      // Half Hungarian (diacritics on purpose), half English, plus one rare token.
      const words = r() < 0.5 ? HU_WORDS : EN_WORDS
      const len = 6 + Math.floor(r() * 14)
      const parts: string[] = []
      for (let k = 0; k < len; k++) parts.push(words[Math.floor(r() * words.length)])
      parts.push(`ref${Math.floor(r() * 500)}`)
      if (insFts) insFts.run(rid, parts.join(' '))
    }
    raw.exec('COMMIT')
  } catch (err) {
    raw.exec('ROLLBACK')
    throw err
  }

  const queryVector = Buffer.from(makeInt8Vector(mulberry32(777)).buffer)
  const countStmt = raw.prepare(`SELECT COUNT(*) AS c FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact'`)
  return {
    db,
    raw,
    caps,
    rows,
    queryVector,
    projectRows: (project) => (countStmt.get(`p${project}`) as { c: number }).c,
  }
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/modules/memory/v2/query-shapes.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Port of the Phase 0 spike's fts-knn-shapes/shapes.sql (USE / DO NOT USE)
// and cte-check.ts. Identity assertions only: at 5 000 rows latency means
// nothing, the 200 k numbers live in the spike report (§3.2, §3.3) and the
// nightly bench. What this guards is that a SQLite / sqlite-vec upgrade
// cannot silently change which shape is correct.

import { describe, it, expect } from 'vitest'
import { buildShapesFixture, SMALL_PROJECT, MID_PROJECT, LARGE_PROJECT } from './shapes-fixture'

const fixture = buildShapesFixture(5_000)
const { raw, caps, queryVector: qv } = fixture

type KnnRow = { rowid: number; distance: number }
type FtsRow = { rowid: number; score: number }
const knn = (sql: string, ...params: unknown[]): KnnRow[] => raw.prepare(sql).all(...params) as KnnRow[]
const fts = (sql: string, ...params: unknown[]): FtsRow[] => raw.prepare(sql).all(...params) as FtsRow[]
const ids = (rows: Array<{ rowid: number }>): number[] => rows.map((r) => r.rowid).sort((a, b) => a - b)
const dists = (rows: KnnRow[]): number[] => rows.map((r) => r.distance).sort((a, b) => a - b)

const TAG_FILTER = `(SELECT memory_rid FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact')`

describe.skipIf(!caps.vec0)('filtered KNN shapes (skipped when sqlite-vec is not loadable on this box)', () => {
  for (const project of [SMALL_PROJECT, MID_PROJECT, LARGE_PROJECT]) {
    it(`p${project}: rowid IN == temp table == PARTITION KEY == metadata column (top-50)`, () => {
      const tag = `p${project}`
      const a = knn(`SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 50 AND rowid IN ${TAG_FILTER}`, qv, tag)
      raw.exec('CREATE TEMP TABLE IF NOT EXISTS qs_cand (id INTEGER PRIMARY KEY)')
      raw.exec('DELETE FROM temp.qs_cand')
      raw.prepare(`INSERT INTO temp.qs_cand(id) SELECT memory_rid FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact'`).run(tag)
      const b = knn(`SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 50 AND rowid IN (SELECT id FROM temp.qs_cand)`, qv)
      const c = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ?`, qv, project)
      const d = knn(`SELECT rowid, distance FROM qs_vec_meta WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ?`, qv, project)
      expect(a.length).toBe(Math.min(50, fixture.projectRows(project)))
      expect(a.length).toBeGreaterThan(0)
      expect(ids(b)).toEqual(ids(a))
      expect(ids(c)).toEqual(ids(a))
      expect(ids(d)).toEqual(ids(a))
      expect(dists(c)).toEqual(dists(a))
      expect(dists(d)).toEqual(dists(a))
    })
  }

  it('D1 set (global ∪ project): vec0 returns k rows PER partition; a bare outer LIMIT errors; the MATERIALIZED CTE is the shape', () => {
    const perPartition = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key IN (0, ?)`, qv, MID_PROJECT)
    expect(perPartition.length).toBe(50 + Math.min(50, fixture.projectRows(MID_PROJECT)))

    expect(() => knn(`SELECT rowid, distance FROM (SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key IN (0, ?)) ORDER BY distance LIMIT 50`, qv, MID_PROJECT))
      .toThrow(/LIMIT|k =/)

    const materialized = knn(`WITH c AS MATERIALIZED (SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key IN (0, ?)) SELECT rowid, distance FROM c ORDER BY distance LIMIT 50`, qv, MID_PROJECT)
    expect(materialized.length).toBe(50)
    const top50 = [...perPartition].sort((x, y) => x.distance - y.distance).slice(0, 50)
    expect(ids(materialized)).toEqual(ids(top50))
    for (let i = 1; i < materialized.length; i++) expect(materialized[i].distance).toBeGreaterThanOrEqual(materialized[i - 1].distance)
  })

  it('PARTITION KEY combines with a rowid IN tag filter (project partition + secondary tag)', () => {
    const only = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ?`, qv, LARGE_PROJECT)
    const combined = knn(`SELECT rowid, distance FROM memory_embedding_vec WHERE embedding MATCH vec_int8(?) AND k = 50 AND project_key = ? AND rowid IN ${TAG_FILTER}`, qv, LARGE_PROJECT, `p${LARGE_PROJECT}`)
    expect(ids(combined)).toEqual(ids(only))
  })

  it('over-fetch-then-filter is banned because it loses recall (spike: 2–30 % at 200 k)', () => {
    const tag = `p${SMALL_PROJECT}`
    const exact = knn(`SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 50 AND rowid IN ${TAG_FILTER}`, qv, tag)
    const overfetch = knn(`SELECT v.rowid, v.distance FROM (SELECT rowid, distance FROM qs_vec_plain WHERE embedding MATCH vec_int8(?) AND k = 500) v JOIN memory_tag t ON t.memory_rid = v.rowid AND t.memory_type = 'fact' AND t.tag_type = 'project' AND t.tag_value = ? ORDER BY v.distance LIMIT 50`, qv, tag)
    expect(exact.length).toBeGreaterThan(0)
    expect(overfetch.length).toBeLessThan(exact.length)
    expect(overfetch.length / exact.length).toBeLessThan(0.5)
  })

  it('binds int8 vectors only through vec_int8(): a bare 384-byte blob is rejected as float32', () => {
    expect(() => raw.prepare(`SELECT rowid FROM qs_vec_plain WHERE embedding MATCH ? AND k = 1`).all(qv)).toThrow()
  })
})

describe.skipIf(!caps.fts5)('FTS5 filter shapes (skipped without FTS5)', () => {
  const tag = `p${MID_PROJECT}`

  it('A (naive rowid IN), B (+rowid IN), C (subselect + JOIN) and E (CROSS JOIN) return identical rows and scores', () => {
    const A = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? AND rowid IN ${TAG_FILTER} ORDER BY score, rowid LIMIT 50`, 'szamla', tag)
    const B = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? AND +rowid IN ${TAG_FILTER} ORDER BY score, rowid LIMIT 50`, 'szamla', tag)
    const C = fts(`SELECT x.rowid, x.score FROM (SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ?) x JOIN memory_tag t ON t.memory_rid = x.rowid AND t.tag_type = 'project' AND t.tag_value = ? AND t.memory_type = 'fact' ORDER BY x.score, x.rowid LIMIT 50`, 'szamla', tag)
    const E = fts(`SELECT memory_raw_fts.rowid AS rowid, bm25(memory_raw_fts) AS score FROM memory_tag t CROSS JOIN memory_raw_fts ON memory_raw_fts.rowid = t.memory_rid WHERE t.tag_type = 'project' AND t.tag_value = ? AND t.memory_type = 'fact' AND memory_raw_fts MATCH ? ORDER BY score, rowid LIMIT 50`, tag, 'szamla')
    expect(A.length).toBeGreaterThan(0)
    expect(B).toEqual(A)
    expect(C).toEqual(A)
    expect(E).toEqual(A)
  })

  it('the filter is a strict subset of the unfiltered top-50 space and diacritics are folded both ways', () => {
    const unfiltered = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? ORDER BY score, rowid LIMIT 50`, 'szamla')
    expect(unfiltered.length).toBe(50)
    const folded = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? ORDER BY score, rowid LIMIT 50`, 'számla')
    expect(folded).toEqual(unfiltered)
    const filtered = fts(`SELECT rowid, bm25(memory_raw_fts) AS score FROM memory_raw_fts WHERE memory_raw_fts MATCH ? AND +rowid IN ${TAG_FILTER} ORDER BY score, rowid LIMIT 50`, 'szamla', tag)
    const projectIds = new Set(ids(raw.prepare(`SELECT memory_rid AS rowid FROM memory_tag WHERE tag_type = 'project' AND tag_value = ? AND memory_type = 'fact'`).all(tag) as Array<{ rowid: number }>))
    for (const row of filtered) expect(projectIds.has(row.rowid)).toBe(true)
  })
})
```

- [ ] **Step 3: Run the suite and the type-check**

Run: `bun vitest run tests/modules/memory/v2/query-shapes.test.ts && bun run lint`
Expected: PASS — 7 KNN cases + 2 FTS cases on a box where sqlite-vec loads (about 1–2 s including the 5 000-row build); on a box without it the KNN block reports as skipped with its reason in the name, the FTS block still passes. `tsc` clean.

- [ ] **Step 4: Commit**

```bash
git add tests/modules/memory/v2/shapes-fixture.ts tests/modules/memory/v2/query-shapes.test.ts
git commit -m "test(memory): read-path SQL shape regression suite from the Phase 0 spike"
```

---
## Final check for the whole plan

Run: `bun vitest run tests/core tests/shared tests/cli tests/modules/memory && bun run lint`
Expected: every suite green (the memory suites still run on the legacy engine — nothing in this plan changes a read or write path), `tsc` clean, `grep -rn "isSqliteExtensionLoadingAvailable" src tests` empty, `bun src/cli/index.ts doctor` shows the `SQLite` and `zstd` lines. Then hand over to plan **p1b** (its Task 1 contract gate must pass against this tree).

## Self-review

**1. Spec coverage (this plan's slice of §15 Phase 1)**

| Requirement | Task |
|---|---|
| `memory.engine` flag (§14) and the `l0` keys the capture needs (§4, §16-4) | 1 |
| ULID utility, no dependency; deterministic re-runnable ids for the migration (§13, §14) | 2 |
| zstd shim, three tiers, level 3, loud failure, `@bokuweb/zstd-wasm` MIT (§6, §13, spike §2 #13) | 3 |
| Live capability self-test — `vec_version()`, 1-row int8 insert, KNN — cached, `vec_int8()` binding (§13, spike §2 #2, #5, §17) | 4 |
| `connection.ts`: darwin-only probe, once per process, `isSqliteExtensionLoadingAvailable()` replaced, `synchronous=NORMAL` (§13, spike §2 #2, #15, §4.3 #11) | 5 |
| `eyas doctor` reports FTS5/vec0 (§13, §17) and the compression tier | 6 |
| All `memory_*` tables incl. empty R6 tables, one integer surrogate key, `memory_blob` composite key + `ref_count`, `meta_json`, `cost_usd`/`duration_api_ms`/`provider_version`, `structured_json`/`pinned`, `global`/`project_type` scopes, `migrated_from` link, `memory_meta`, `memory_idf`, INTEGER ms timestamps (§5, spike §2 #7, #21, §6) | 7 |
| `memory_run` discipline ("a skip writes a row") and `instance_id` generated once (§5, §13) | 8 |
| Tables exist from boot, under both engines, before any capture hook fires (§6 boot-order risk, §17) | 9 |
| `shapes.sql` → `tests/modules/memory/query-shapes.test.ts`: `+rowid IN`, partition `IN (0, ?)` + `MATERIALIZED` CTE, over-fetch banned, identity of filtered shapes (§7, §13, spike §5) | 10 |

Deliberately **not** in this plan (owned elsewhere, by the orchestrator's split): capture hooks, `MemoryIngest`, language heuristic (p1b); extraction, arbitration, poisoning gate, `memory_idf` maintenance (p1c); `eyas memory migrate/rebuild/export`, `undoMigration` (p1d); `supportsHeadlessInvocation`, `isEligibleForBackground`, `save_memory` retirement, dead-file deletion, `collectSegments` tool_result scanning, Dockerfile/Bun pin, K8s `1Gi/2Gi` (p1e). Phase 2 populates `memory_embedding` and `memory_embedding_vec` (p1d's `rebuild-index` already allocates `memory_partition_key` rows); Phase 4 uses `memory_fact_archive`, `memory_dek`, `memory_purge_log`, `memory_access_log`.

**Open item no Phase 1 plan owns:** the §8/§15 acceptance line "solo-instance tombstone compaction fires" (an empty peer set compacts on schedule). This plan creates the `tombstone` table (Task 7) but ships no compaction routine or test, and none of p1b–p1e does either. Either a small `compactTombstones(db, nowMs)` + scheduler job is added here in a follow-up task, or the owner defers the line to Phase 4 (tombstone GC) and amends §15 accordingly.

**2. Placeholder scan.** No "TBD/TODO/implement later", no "add error handling", no "similar to Task N" — every Modify step quotes the current lines with numbers and gives the replacement; every test step contains the test code; every code step compiles against the types named in its Interfaces block. The only external facts not re-checked by a test are the `@bokuweb/zstd-wasm` API names (`init`/`compress`/`decompress`), which the Phase 0 spike exercised on Bun and Node and which Task 3's WASM test will confirm on install.

**3. Type consistency.** `SqliteCapabilities` (Task 4) is the type consumed by `createMemoryV2Tables(db, caps)` (Task 7), `buildShapesFixture` (Task 10), `memory/index.ts` (Task 9) and p1b's helpers; `probeSqliteCapabilities(rawDb: unknown, logger?)` / `getSqliteCapabilities(logger?)` / `rawHandleOf(db)` are the same names in Tasks 4, 5, 6, 9; `openRawSqlite` / `customSqliteStatus` are defined in Task 5 and used in Task 6; `allocateRid(db, itemType, id, createdAt): number` and `getMemoryMeta`/`setMemoryMeta` are defined in Task 7 and used in Tasks 8 and 10; `generateId` / `generateIdAt` / `ulidTimestampMs` (Task 2) are used in Tasks 8 and 10 with the same signatures; `initZstd(force?)` / `zstdCompress(data, level = 3)` / `zstdDecompress` / `ZstdUnavailableError` (Task 3) match what p1b's `wire.ts` and `ingest.ts` import; the `memory_raw`, `memory_blob`, `memory_tag`, `memory_raw_fts` column lists in Task 7 are the ones p1b's `writeUnit` inserts, and `memory_run` columns are the ones `recordRun` (Task 8) inserts.
