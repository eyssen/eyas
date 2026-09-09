# Memory P1d — Migration, Rebuild and CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every legacy memory source (`conversation_messages`, `agent_events` `LlmResponse`, `episodic_memories`, `archive_memories`, `working_memory`, the vault markdown files, `memory_capture_runs`, `memory_note_links`) into the v2 tables deterministically and idempotently; make L1–L3 rebuildable from L0; mirror pinned memory back to the vault; ingest vault edits into L0; and expose all of it as `eyas memory migrate | rebuild --from-l0 | rebuild-index | export --vault | status`.

**Architecture:** One migration module (`src/modules/memory/v2/migration/*`) writes the same rows P1b's ingest writes — same columns, same tag set, same blob/FTS discipline — but with **deterministic ULIDs** (`generateIdAt(sourceTimestamp, SHA-256('legacy:<table>:<pk>'))`), real `occurred_at`, a `migrated_from` link per raw row and its own `memory_run(run_type='migration')`, so a re-run is a no-op by construction (`memory_item.id` lookup, `INSERT OR IGNORE`, blob `ref_count` bumped only on a real insert). Every legacy timestamp is normalised at the boundary (`toEpochMs`: ISO `Z`, integer ms, `datetime('now')` **as UTC**, date-only → midnight UTC). `undoMigration` removes only rows reachable from `migrated_from` links and migration runs; `rebuildFromL0` truncates the derived layers, re-derives vault gists from the L0 document bytes and replays P1c's `runExtraction` per conversation in `occurred_at` order; `rebuildIndex` drops and refills `memory_raw_fts` and `memory_embedding_vec` from stored data; `exportVault` renders pinned gists and current facts as `generated: true` markdown under `data/vault/generated/`. The vault watcher gains one hook that feeds a changed file into L0 through P1b's `captureUnit` (partition `vault:<path>`, hash = SHA-256 of the file bytes). The CLI (`src/cli/commands/memory.ts`) opens the database offline exactly like `eyas doctor` resolves it, creates the v2 tables first, and calls those functions.

**Tech Stack:** TypeScript 5.9 strict/ESM, Bun 1.3.10 (`bun:sqlite`) with Node 22 fallback (`better-sqlite3`), Drizzle raw `sql` templates, SQLite FTS5 + sqlite-vec `vec0` (when loadable), zstd via `src/shared/zstd.ts` (P1a), `gray-matter` (already a dependency), `citty` (already a dependency), Pino, Vitest (`bun vitest run <path>`). **No new dependencies in this plan.**

**Spec:** `docs/superpowers/specs/2026-09-03-sovereign-layered-memory-design.md` (§3 principles, §4 vault role, §5 data model, §9 tags, §14 migration and retirements, §15 Phase 1 acceptance, §16-7 trust of imports, §16-10 migration approach) as corrected by `docs/superpowers/specs/2026-09-03-memory-p0-spike-report.md` (§2 #21 (i)–(x) migration corrections, §4.3 #6 seeded episodic/archive fixture, §5 `migrate-dryrun.ts` → `legacy-migrate.ts`, `verify.ts` → `migration.test.ts`). Companions: `docs/superpowers/specs/2026-09-03-memory-gap-analysis.md` §C (migration mapping, rollback) and the spike source preserved at `.superpowers/spikes/2026-09-03-memory/migration-dryrun/{migrate-dryrun.ts,verify.ts,REPORT.md}`.

**Depends on:** plan `p1a-foundation` (`@modules/memory/v2/schema` `createMemoryV2Tables`/`allocateRid`, `@shared/zstd`, `@core/db/sqlite-capabilities`, `@shared/crypto` `generateIdAt`/`ulidTimestampMs`, `@modules/memory/v2/runs` `recordRun`, `@modules/memory/v2/instance` `getInstanceId`, the `memory.engine`/`memory.l0` Zod config); plan `p1b-l0-capture` (`@modules/memory/v2/ingest-bridge` `captureUnit`/`pendingUnits`/`resetIngestBridge`/`CaptureUnit`/`RawSourceType`/`TrustTier`, `@modules/memory/v2/ingest` `sha256Hex`/`RAW_FTS_CLIP_CHARS`/`createMemoryIngest`/`MemoryIngest`, `@modules/memory/v2/language` `detectLanguage`, `tests/modules/memory/v2/helpers.ts` `makeV2Db`/`silentLogger`/`testIngestConfig`); plan `p1c-extraction` (`@modules/memory/v2/extractor` `runExtraction` — which **never throws**: a rolled-back run returns `status: 'failed'`, and Task 11 counts that as a failure). P1a's `MEMORY_V2_TABLES` (23 regular tables) and `memory_partition_key` are reused as-is (Tasks 10 and 14), never re-declared here. Task 1 is the gate that proves those contracts exist. **Do not** implement capture hooks (p1b), extraction (p1c) or the `save_memory` retirement / Dockerfile / k8s changes (p1e) here.

## Global Constraints

- Spec §1: **TypeScript/Bun (Node 22 fallback), single process, embedded SQLite via Drizzle, MIT-compatible dependencies only, VPS/K8s pods without GPU, no local LLM assumed (CLI-only providers such as Claude Code or Grok CLI may be the only model), six UI languages, the existing board (a task is a conversation) and scheduler.**
- Spec §3: L0 is immutable and complete; everything above L0 is rebuildable from it; the model never decides what is stored; `project`/`task` tags come from the board (here: the legacy row's own `conversation_id`/`project_id`, D2 applied), never inferred; ULID, `content_hash`, HLC, `origin_instance_id`, `trust_tier` on every row.
- Spec §14 principles: additive schema (no `ALTER`/`DROP` of legacy tables); deterministic re-runnable ULIDs (timestamp from the source `created_at`, random part from `SHA-256('legacy:'+table+':'+pk)`); real `occurred_at`; vault files never rewritten; `memory.engine` selects the read/write path; legacy tables read-only for one release; every raw row gets a `memory_link(raw → <legacy table>, <pk>, 'migrated_from')`; the migration writes its own `memory_run(run_type='migration')` and is idempotent by construction — no "already migrated" flag; a disaster-recovery backup precedes migration.
- Spike §2 #21: (i) vault hash = SHA-256 of the file bytes at migration — `vault_index.file_hash` is a `${size}-${mtimeMs}` change detector and is never reused; (ii) `LlmResponse` join `agent_events.session_id = agent_sessions.id → agent_sessions.conversation_id`, skip an `LlmResponse` whose hash already exists as an `assistant_message` in the parent conversation, `actor = agent_sessions.agent_id`; (iii) timestamps normalised at the boundary, INTEGER epoch ms in the new tables; (iv) blob key `(content_hash, shred_partition_id)` + `ref_count`; (v) a `migrated_from` link per raw row; (vi) `skipped_reason='error'` → `failed`, `unparsable`/`too-short` → `skipped`, run↔link match = same conversation + same second, ±60 s fallback; (vii) attachments → `meta_json`; (viii) `CriticVerdict` is **not** migrated; (ix) own migration run row, idempotent, no flag; (x) imported `reference` gist text = first body paragraph, leading `# heading` stripped; `import-job:*` → `changelog_json`, `imported` dropped, `source:x` → `source_type` tag.
- Spec §16-7: data-port imports the owner performed are `trust_tier='owner'` (every vault note).
- Repo rules: English code and comments; Pino via an injected `logger` in library code, **never `console.log`** there (the `src/cli/commands/*` files use `console.log` for terminal output — that is the existing CLI convention, e.g. `doctor.ts`, and it stays); Zod for config (P1a owns the `memory.engine` entry; this plan reads it); `/api/v1/` untouched (no routes here); no new user-facing UI strings (the CLI prints English terminal output like every other `eyas` command; the handbook pages are updated in all six languages in Task 15); version stays **0.8.22-beta** — do not touch `package.json`, `CHANGELOG.md`, or any version string.
- Git: **an agent executing this plan never runs `git commit`, `git push`, or creates a branch.** Each task ends with the commit command the owner runs by hand; stop at that step and hand it over. No `Co-Authored-By` lines.
- Tests: new files under `tests/modules/memory/v2/**.test.ts` and `tests/cli/memory.test.ts`; use `createTestDb()` / `createMemoryDb()` / `getRawFromDrizzle()` from `tests/helpers/test-db.ts` and `makeV2Db()` / `silentLogger` from `tests/modules/memory/v2/helpers.ts` (P1b); run one file with `bun vitest run <path>`; type-check with `bun run lint` (`tsc --noEmit`). Every test that touches blobs calls `await initZstd()` in `beforeAll`.

---

## File structure

| Path | Responsibility |
|---|---|
| `src/modules/memory/v2/migration/legacy-ids.ts` (create) | `toEpochMs` (the timestamp zoo → INTEGER epoch ms, UTC), `legacyId(ms, seed)` (deterministic ULID via `generateIdAt`), `encodeUtf8`. |
| `src/modules/memory/v2/migration/sqlite-helpers.ts` (create) | `tableExists`, `hasColumn`, `changes`, `insertLink`, `insertLegacyRun` — small, tested SQL helpers shared by every migration file. |
| `src/modules/memory/v2/vault-ingest.ts` (create) | Vault document → L0 unit (`buildVaultDocumentUnit`, `vaultConversationId`, `isGeneratedVaultPath`), the §14 gist derivation (`deriveVaultGist`, `firstBodyParagraph`, `clipGistText`), and the watcher entry point `ingestVaultFile` (hash-in-partition dedup → `captureUnit`). |
| `src/modules/memory/v2/migration/raw-writer.ts` (create) | `writeMigratedRaw` — the one L0 writer of the migration: blob (`INSERT OR IGNORE` + `ref_count`), `memory_item` rid, `memory_raw`, contentless FTS, the seven raw tags P1b writes, the `migrated_from` link. |
| `src/modules/memory/v2/migration/context.ts` (create) | `MigrationContext` (counts, surprises, conversation/project lookups, `writeRaw`, id maps) + `createMigrationContext`. |
| `src/modules/memory/v2/migration/legacy-migrate-sources.ts` (create) | Per-source migrators: `migrateConversationMessages`, `migrateAgentEvents`, `migrateEpisodicTables` (+ `writeMigratedFact`, synthetic extraction run), `migrateWorkingMemory`. |
| `src/modules/memory/v2/migration/legacy-migrate-vault.ts` (create) | `listVaultMarkdown`, `writeMigratedGist`, `migrateVaultNotes`, `migrateCaptureRuns` (+ `mapCaptureStatus`), `migrateNoteLinks` (+ `matchRun`). |
| `src/modules/memory/v2/migration/legacy-migrate.ts` (create) | `migrateLegacy` — transaction, own run row, dry-run rollback, `MigrationReport`; `undoMigration`. |
| `src/modules/memory/v2/migration/rebuild.ts` (create) | `rebuildIndex` (+ `partitionKeyFor`), `rebuildFromL0`. |
| `src/modules/memory/v2/migration/export-vault.ts` (create) | `exportVault`, `parseExportScope`, `slugify`. |
| `src/modules/memory/vault/vault-watcher.ts` (modify lines 18–33, 47–51) | Optional `hooks.onFileChanged(relPath, event)` fired per changed `.md`. |
| `src/modules/memory/index.ts` (modify lines 290–294) | Pass the L0 hook: `ingestVaultFile` + immediate flush of the file's pseudo-conversation. |
| `src/cli/commands/memory.ts` (create), `src/cli/index.ts` (modify) | `eyas memory migrate|rebuild|rebuild-index|export|status`; `openOfflineMemoryDb`, `collectMemoryStatus`, `formatMemoryStatus`, `warnIfServerRunning`. |
| `tests/modules/memory/v2/fixtures/legacy-store.ts` (create) | `openLegacyTestDb`, `seedLegacyStore` — the spike §3.9-shaped fixture (61 messages, 9 `LlmResponse` of which 3 duplicate the parent, 9 `CriticVerdict`, 266 vault notes, 15 capture runs, 2 note links, 46 conversations, 12 sessions) plus 2 episodic + 1 archive + 1 working row. |
| `tests/modules/memory/v2/*.test.ts`, `tests/cli/memory.test.ts` (create) | One test file per task (named in each task). |
| `CLAUDE.md`, `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/deploy/cli.md` (modify) | The new commands, six languages. |

Row contract this plan honours (from P1b Task 5, quoted so nobody has to open that plan): `memory_raw` columns `rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id, occurred_at, trust_tier, dek_id, tombstoned, meta_json`; blob written with `ref_count 0` then `+1` per inserted raw row; `memory_raw_fts.rowid = memory_raw.rid`, body clipped to `RAW_FTS_CLIP_CHARS`; tags for `memory_type='raw'`: `project`, `project_type` (when present), `task` = conversation id (when present), `source_type`, `language`, `layer='raw'`, `trust_tier`. Vault documents use `conversation_id = 'vault:<relPath>'` (P1b's `CaptureUnit.conversationId` is a required string; one pseudo-conversation per file keeps `(conversation_id, occurred_at)` = the file's version history and lets P1c's `onFlushed(conversationId)` run per document) and `shred_partition_id = 'vault:<relPath>'`, in **both** the migration and the live watcher path.

---

### Task 1: Contract gate — what P1a, P1b and P1c must already provide

**Files:**
- Test: `tests/modules/memory/v2/p1d-contract.test.ts`

**Interfaces:**
- Consumes (P1a): `generateIdAt(ms, random80)`, `ulidTimestampMs(id)` from `@shared/crypto`; `initZstd`, `zstdCompress`, `zstdDecompress` from `@shared/zstd`; `allocateRid`, `createMemoryV2Tables`, `MEMORY_V2_TABLES` from `@modules/memory/v2/schema`; `probeSqliteCapabilities`, `getSqliteCapabilities` from `@core/db/sqlite-capabilities`; `recordRun` from `@modules/memory/v2/runs`; `getInstanceId` from `@modules/memory/v2/instance`; the tables `memory_link` (with `created_at NOT NULL`), `memory_run` (with `conversation_id`, `created_at NOT NULL`, `finished_at`) and `memory_partition_key`. (P1b): `sha256Hex`, `RAW_FTS_CLIP_CHARS`, `createMemoryIngest` from `@modules/memory/v2/ingest`; `captureUnit`, `pendingUnits`, `resetIngestBridge` from `@modules/memory/v2/ingest-bridge`; `detectLanguage` from `@modules/memory/v2/language`; `makeV2Db`, `silentLogger`, `testIngestConfig` from `tests/modules/memory/v2/helpers.ts`. (P1c): `runExtraction` from `@modules/memory/v2/extractor`.
- Produces: nothing — a failing assertion here means a sibling plan has not landed or disagrees with the contract. **Stop and reconcile; never patch the schema from this plan.**

- [ ] **Step 1: Write the gate test**

```ts
// tests/modules/memory/v2/p1d-contract.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Gate for plan p1d: every import below is a contract name from p1a/p1b/p1c,
// and every column named here is written literally by the migration.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { generateIdAt, ulidTimestampMs } from '@shared/crypto'
import { initZstd, zstdCompress, zstdDecompress } from '@shared/zstd'
import { probeSqliteCapabilities, getSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { allocateRid, createMemoryV2Tables, MEMORY_V2_TABLES } from '@modules/memory/v2/schema'
import { recordRun } from '@modules/memory/v2/runs'
import { getInstanceId } from '@modules/memory/v2/instance'
import { sha256Hex, RAW_FTS_CLIP_CHARS, createMemoryIngest } from '@modules/memory/v2/ingest'
import { captureUnit, pendingUnits, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { detectLanguage } from '@modules/memory/v2/language'
import { makeV2Db, silentLogger, testIngestConfig } from './helpers'

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const columnsOf = (db: any, table: string): string[] =>
  (db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map((c) => c.name)

describe('p1d contract gate', () => {
  it('generateIdAt is deterministic and ulidTimestampMs inverts its time part', () => {
    const random = new Uint8Array(10).fill(7)
    const a = generateIdAt(1_700_000_000_000, random)
    expect(a).toMatch(ULID)
    expect(generateIdAt(1_700_000_000_000, random)).toBe(a)
    expect(generateIdAt(1_700_000_000_000, new Uint8Array(10).fill(8))).not.toBe(a)
    expect(ulidTimestampMs(a)).toBe(1_700_000_000_000)
  })

  it('the tables the migration writes carry the columns it names', () => {
    const { db } = makeV2Db()
    expect(columnsOf(db, 'memory_raw')).toEqual(expect.arrayContaining([
      'rid', 'id', 'content_hash', 'origin_instance_id', 'hlc_physical_ms', 'hlc_logical', 'revision', 'created_at',
      'shred_partition_id', 'source_type', 'actor', 'conversation_id', 'project_id', 'project_type_id',
      'occurred_at', 'trust_tier', 'dek_id', 'tombstoned', 'meta_json',
    ]))
    expect(columnsOf(db, 'memory_blob')).toEqual(expect.arrayContaining(['content_hash', 'shred_partition_id', 'compressed_blob', 'byte_length', 'ref_count']))
    expect(columnsOf(db, 'memory_gist')).toEqual(expect.arrayContaining([
      'rid', 'id', 'content_hash', 'origin_instance_id', 'hlc_physical_ms', 'hlc_logical', 'revision', 'created_at',
      'scope_type', 'scope_id', 'tree_depth', 'text', 'structured_json', 'pinned', 'trust_tier', 'token_count',
      'importance_score', 'gist_source', 'consolidation_run_id', 'is_current', 'decay_score', 'presence_tier',
      'times_retrieved', 'changelog_json',
    ]))
    expect(columnsOf(db, 'memory_fact')).toEqual(expect.arrayContaining([
      'rid', 'id', 'content_hash', 'origin_instance_id', 'hlc_physical_ms', 'hlc_logical', 'revision', 'created_at',
      'subject', 'predicate', 'object_text', 'valid_from', 'valid_until', 'invalidated_by_fact_id', 'confidence',
      'trust_tier', 'extraction_run_id', 'entity_id', 'decay_score', 'presence_tier', 'archived',
    ]))
    expect(columnsOf(db, 'memory_gist_source')).toEqual(expect.arrayContaining(['gist_id', 'child_type', 'child_id']))
    expect(columnsOf(db, 'memory_fact_source')).toEqual(expect.arrayContaining(['fact_id', 'episode_id']))
    // created_at is NOT NULL without a default on both tables: an INSERT OR IGNORE that omits it writes NOTHING (Task 2 writes it).
    expect(columnsOf(db, 'memory_link')).toEqual(expect.arrayContaining(['id', 'from_type', 'from_id', 'to_type', 'to_id', 'link_type', 'run_id', 'created_at']))
    expect(columnsOf(db, 'memory_run')).toEqual(expect.arrayContaining(['id', 'run_type', 'status', 'conversation_id', 'model_used', 'stats_json', 'created_at', 'finished_at']))
    expect(columnsOf(db, 'memory_tag')).toEqual(expect.arrayContaining(['memory_rid', 'memory_type', 'tag_type', 'tag_value']))
    expect(columnsOf(db, 'memory_meta')).toEqual(expect.arrayContaining(['key', 'value']))
    expect(columnsOf(db, 'memory_embedding')).toEqual(expect.arrayContaining(['rid', 'id', 'owner_type', 'owner_id', 'owner_rid', 'model_id', 'vector', 'project_key', 'live_in_index', 'created_at']))
    expect(columnsOf(db, 'memory_partition_key')).toEqual(expect.arrayContaining(['project_key', 'scope_type', 'scope_id']))
    expect(columnsOf(db, 'memory_item')).toEqual(expect.arrayContaining(['rid', 'item_type', 'id', 'created_at']))
    expect(MEMORY_V2_TABLES).toHaveLength(23)
    expect(MEMORY_V2_TABLES).toContain('memory_partition_key')
  })

  it('runs, instance id, rid allocation, zstd, sha256 and language helpers work', async () => {
    const { db } = makeV2Db()
    expect(recordRun(db, { runType: 'migration', status: 'ok' })).toMatch(ULID)
    expect(getInstanceId(db)).toBe(getInstanceId(db))
    expect(Number.isInteger(allocateRid(db, 'gist', '01ARZ3NDEKTSV4RRFFQ69G5FAV', 1_700_000_000_000))).toBe(true)
    await initZstd()
    const bytes = new TextEncoder().encode('round trip')
    expect(new TextDecoder().decode(zstdDecompress(zstdCompress(bytes)))).toBe('round trip')
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/)
    expect(RAW_FTS_CLIP_CHARS).toBeGreaterThan(0)
    expect(detectLanguage('Kérlek, mindig magyarul válaszolj nekem, és ne felejtsd el az ékezeteket.')).toBe('hu')
  })

  it('p1c exposes runExtraction', async () => {
    const mod = await import('@modules/memory/v2/extractor')
    expect(typeof mod.runExtraction).toBe('function')
  })

  it("p1a's probe/DDL and p1b's bridge + ingest are callable the way the CLI and the vault watcher use them", () => {
    expect(typeof probeSqliteCapabilities).toBe('function')
    expect(typeof getSqliteCapabilities).toBe('function')
    expect(typeof createMemoryV2Tables).toBe('function')
    const { db, caps } = makeV2Db()
    resetIngestBridge()
    // A document unit buffered before memory attaches — exactly what ingestVaultFile (Task 3) hands to the bridge.
    captureUnit({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', sourceType: 'document', actor: 'vault', conversationId: 'vault:semantic/x.md',
      projectId: null, projectTypeId: null, occurredAtMs: 1, content: 'buffered before attach', trustTier: 'owner',
      shredPartitionId: 'vault:semantic/x.md',
    })
    expect(pendingUnits()).toBe(1)
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    expect(typeof ingest.flushConversation).toBe('function')
    expect(typeof ingest.onFlushed).toBe('function')
    resetIngestBridge()
  })
})
```

- [ ] **Step 2: Run the gate**

Run: `bun vitest run tests/modules/memory/v2/p1d-contract.test.ts`
Expected: PASS (5 tests). A `Cannot find module` or a missing column means the sibling plan has not landed — stop here.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/memory/v2/p1d-contract.test.ts
git commit -m "test(memory): gate p1d on the p1a/p1b/p1c contracts"
```

---

### Task 2: Legacy timestamps, deterministic ids and the SQL helpers

**Files:**
- Create: `src/modules/memory/v2/migration/legacy-ids.ts`
- Create: `src/modules/memory/v2/migration/sqlite-helpers.ts`
- Test: `tests/modules/memory/v2/migration-ids.test.ts`

**Interfaces:**
- Produces: `toEpochMs(value: unknown, where: string): number`; `legacyId(ms: number, seed: string): string`; `encodeUtf8(text: string): Uint8Array`; `tableExists(db, name): boolean`; `hasColumn(db, table, column): boolean`; `changes(db): number`; `insertLink(db, link: MemoryLinkInput): boolean`; `insertLegacyRun(db, run: LegacyRunInput): boolean`; `export interface MemoryLinkInput { id: string; fromType: string; fromId: string; toType: string; toId: string; linkType: 'derived_from'|'supersedes'|'invalidates'|'part_of'|'merged_into'|'alternate_of'|'migrated_from'; runId: string | null; createdAtMs?: number }` (P1a's `memory_link.created_at` is `NOT NULL` with no default — `INSERT OR IGNORE` swallows a NOT NULL violation and writes nothing, so the helper always supplies it, `Date.now()` when the caller does not); `export interface LegacyRunInput { id: string; runType: 'extraction'|'consolidation_light'|'consolidation_heavy'|'migration'; status: 'ok'|'partial'|'failed'|'skipped'|'degraded_no_model'; conversationId?: string | null; modelUsed: string | null; statsJson: Record<string, unknown>; createdAtMs: number }` (written to P1a's `conversation_id`, `created_at` and `finished_at` columns — the same discipline).
- Consumes: `generateIdAt` (P1a).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/migration-ids.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spike §3.9 "timestamp zoo": ISO Z with ms, INTEGER ms, datetime('now')
// 19-char zone-less UTC (naive Date.parse shifts it by the host offset —
// 7 200 000 ms on the spike host), date-only vault `created`.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { ulidTimestampMs } from '@shared/crypto'
import { toEpochMs, legacyId, encodeUtf8 } from '@modules/memory/v2/migration/legacy-ids'
import { tableExists, hasColumn, changes, insertLink, insertLegacyRun } from '@modules/memory/v2/migration/sqlite-helpers'
import { makeV2Db } from './helpers'

describe('toEpochMs', () => {
  it("parses datetime('now') text as UTC — delta 0, never the host offset", () => {
    expect(toEpochMs('2026-08-27 20:25:40', 'runs')).toBe(Date.parse('2026-08-27T20:25:40Z'))
    expect(toEpochMs('2026-08-27 20:25:40', 'runs') - Date.parse('2026-08-27T20:25:40Z')).toBe(0)
  })
  it('parses ISO Z text, integer ms, integer seconds, date-only and Date instances', () => {
    expect(toEpochMs('2026-08-14T18:45:53.643Z', 'msg')).toBe(1_786_733_153_643)
    expect(toEpochMs('2026-08-14T18:45:53.643', 'msg')).toBe(1_786_733_153_643)
    expect(toEpochMs(1_787_557_527_083, 'evt')).toBe(1_787_557_527_083)
    expect(toEpochMs(1_787_557_527, 'evt-seconds')).toBe(1_787_557_527_000)
    expect(toEpochMs('2026-08-28', 'vault created')).toBe(Date.parse('2026-08-28T00:00:00Z'))
    expect(toEpochMs(new Date('2026-08-28T00:00:00Z'), 'vault created')).toBe(Date.parse('2026-08-28T00:00:00Z'))
  })
  it('throws with the location on garbage', () => {
    expect(() => toEpochMs('yesterday', 'x#1')).toThrow(/x#1/)
    expect(() => toEpochMs(null, 'x#2')).toThrow(/x#2/)
  })
})

describe('legacyId', () => {
  it('is deterministic, a 26-char ULID, and carries the source timestamp', () => {
    const a = legacyId(1_786_733_153_643, 'legacy:conversation_messages:7')
    expect(a).toBe(legacyId(1_786_733_153_643, 'legacy:conversation_messages:7'))
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(ulidTimestampMs(a)).toBe(1_786_733_153_643)
    expect(legacyId(1_786_733_153_643, 'legacy:conversation_messages:8')).not.toBe(a)
  })
  it('refuses a bad timestamp', () => {
    expect(() => legacyId(Number.NaN, 'seed')).toThrow(/seed/)
  })
  it('encodeUtf8 round-trips', () => {
    expect(new TextDecoder().decode(encodeUtf8('árvíztűrő'))).toBe('árvíztűrő')
  })
})

describe('sqlite helpers', () => {
  it('tableExists / hasColumn / changes', () => {
    const { db } = makeV2Db()
    expect(tableExists(db, 'memory_raw')).toBe(true)
    expect(tableExists(db, 'no_such_table')).toBe(false)
    expect(hasColumn(db, 'memory_raw', 'meta_json')).toBe(true)
    expect(hasColumn(db, 'memory_raw', 'no_such_column')).toBe(false)
    db.run(sql`INSERT INTO memory_meta (key, value) VALUES ('k', 'v')`)
    expect(changes(db)).toBe(1)
  })
  it('insertLink is INSERT OR IGNORE on the link id', () => {
    const { db } = makeV2Db()
    const link = { id: legacyId(1, 'legacy-link:conversation_messages:7'), fromType: 'raw', fromId: 'R1', toType: 'conversation_messages', toId: '7', linkType: 'migrated_from' as const, runId: null }
    expect(insertLink(db, link)).toBe(true)
    expect(insertLink(db, link)).toBe(false)
    const rows = db.all(sql`SELECT from_type, from_id, to_type, to_id, link_type, run_id FROM memory_link`) as any[]
    expect(rows).toEqual([{ from_type: 'raw', from_id: 'R1', to_type: 'conversation_messages', to_id: '7', link_type: 'migrated_from', run_id: null }])
    // created_at is NOT NULL on p1a's memory_link; the helper fills it so OR IGNORE cannot swallow the row.
    expect((db.all(sql`SELECT created_at FROM memory_link`) as any[])[0].created_at).toBeGreaterThan(0)
    expect(insertLink(db, { ...link, id: legacyId(2, 'legacy-link:x'), createdAtMs: 1_700_000_000_000 })).toBe(true)
    expect((db.all(sql`SELECT created_at FROM memory_link ORDER BY created_at LIMIT 1`) as any[])[0].created_at).toBe(1_700_000_000_000)
  })
  it('insertLegacyRun writes a run with a caller-chosen id and is idempotent', () => {
    const { db } = makeV2Db()
    const run = { id: legacyId(1_700_000_000_000, 'legacy:memory_capture_runs:3'), runType: 'extraction' as const, status: 'skipped' as const, conversationId: 'c1', modelUsed: null, statsJson: { legacy_id: 3 }, createdAtMs: 1_700_000_000_000 }
    expect(insertLegacyRun(db, run)).toBe(true)
    expect(insertLegacyRun(db, run)).toBe(false)
    const row = (db.all(sql`SELECT run_type, status, conversation_id, model_used, stats_json, created_at, finished_at FROM memory_run WHERE id = ${run.id}`) as any[])[0]
    expect(row).toMatchObject({ run_type: 'extraction', status: 'skipped', conversation_id: 'c1', model_used: null, created_at: 1_700_000_000_000, finished_at: 1_700_000_000_000 })
    expect(JSON.parse(row.stats_json)).toEqual({ legacy_id: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/migration-ids.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/migration/legacy-ids'`.

- [ ] **Step 3: Write the implementations**

```ts
// src/modules/memory/v2/migration/legacy-ids.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Deterministic identity for migrated rows (spec §14): the ULID's time part is
// the SOURCE timestamp, its random part the first 80 bits of
// SHA-256(seed), seed = 'legacy:<table>:<pk>'. Re-running the migration
// therefore produces the same ids and INSERT OR IGNORE makes it a no-op.
//
// Legacy timestamp normalisation (spike §2 #21 iii): ISO `Z` text; ISO text
// without a zone (treated as UTC); INTEGER epoch ms (agent_events.ts);
// INTEGER epoch seconds (< 1e11); SQLite datetime('now') 'YYYY-MM-DD HH:MM:SS'
// — zone-less UTC, which a naive Date.parse would shift by the host offset;
// date-only vault `created` → midnight UTC; Date instances from YAML.

import { createHash } from 'node:crypto'
import { generateIdAt } from '@shared/crypto'

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/
const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function toEpochMs(value: unknown, where: string): number {
  if (value instanceof Date) {
    const ms = value.getTime()
    if (Number.isNaN(ms)) throw new Error(`invalid Date at ${where}`)
    return ms
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite timestamp at ${where}: ${value}`)
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value === 'string') {
    let s = value.trim()
    if (SQLITE_DATETIME.test(s)) s = `${s.replace(' ', 'T')}Z`
    else if (ISO_NO_ZONE.test(s)) s = `${s}Z`
    else if (DATE_ONLY.test(s)) s = `${s}T00:00:00Z`
    const ms = Date.parse(s)
    if (Number.isNaN(ms)) throw new Error(`unparsable legacy timestamp at ${where}: ${JSON.stringify(value)}`)
    return ms
  }
  throw new Error(`unsupported legacy timestamp type at ${where}: ${value === null ? 'null' : typeof value}`)
}

/** Deterministic ULID: time = source ms, random = SHA-256(seed)[0..10). */
export function legacyId(ms: number, seed: string): string {
  if (!Number.isFinite(ms) || ms < 0) throw new Error(`legacy id: bad timestamp ${ms} for ${seed}`)
  const digest = createHash('sha256').update(seed).digest()
  return generateIdAt(Math.round(ms), Uint8Array.from(digest.subarray(0, 10)))
}

const encoder = new TextEncoder()
export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text)
}
```

```ts
// src/modules/memory/v2/migration/sqlite-helpers.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Small SQL helpers the migration files share. Everything is INSERT OR IGNORE
// on a caller-chosen id so a re-run cannot duplicate a row.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export type MemoryLinkType = 'derived_from' | 'supersedes' | 'invalidates' | 'part_of' | 'merged_into' | 'alternate_of' | 'migrated_from'

export interface MemoryLinkInput {
  id: string
  fromType: string
  fromId: string
  toType: string
  toId: string
  linkType: MemoryLinkType
  runId: string | null
  /** memory_link.created_at (NOT NULL, no default); Date.now() when omitted. */
  createdAtMs?: number
}

export interface LegacyRunInput {
  id: string
  runType: 'extraction' | 'consolidation_light' | 'consolidation_heavy' | 'migration'
  status: 'ok' | 'partial' | 'failed' | 'skipped' | 'degraded_no_model'
  /** The task a migrated extraction run served (memory_run.conversation_id); null for the migration's own rows. */
  conversationId?: string | null
  modelUsed: string | null
  statsJson: Record<string, unknown>
  createdAtMs: number
}

export function tableExists(db: EyasDb, name: string): boolean {
  return db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table', 'view') AND name = ${name}`).length > 0
}

export function hasColumn(db: EyasDb, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false
  const cols = db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`))
  return cols.some((c) => c.name === column)
}

export function changes(db: EyasDb): number {
  return db.all<{ c: number }>(sql`SELECT changes() AS c`)[0]?.c ?? 0
}

/**
 * Returns true when the link was inserted, false when it already existed.
 * Every NOT NULL column of p1a's memory_link is supplied: INSERT OR IGNORE
 * also ignores a NOT NULL violation, so an omitted created_at would silently
 * write no row and report "already existed".
 */
export function insertLink(db: EyasDb, link: MemoryLinkInput): boolean {
  db.run(sql`INSERT OR IGNORE INTO memory_link (id, from_type, from_id, to_type, to_id, link_type, run_id, created_at)
    VALUES (${link.id}, ${link.fromType}, ${link.fromId}, ${link.toType}, ${link.toId}, ${link.linkType}, ${link.runId}, ${link.createdAtMs ?? Date.now()})`)
  return changes(db) === 1
}

/**
 * memory_run row with a caller-chosen (deterministic) id — recordRun() (p1a)
 * generates its own id, which a migrated legacy run must not do. Same
 * discipline as insertLink: created_at (NOT NULL, no default) and the
 * finished_at / conversation_id columns p1a's ledger carries are all written,
 * so a re-run's OR IGNORE hits the primary key, never a silent constraint skip.
 */
export function insertLegacyRun(db: EyasDb, run: LegacyRunInput): boolean {
  db.run(sql`INSERT OR IGNORE INTO memory_run (id, run_type, status, conversation_id, model_used, stats_json, created_at, finished_at)
    VALUES (${run.id}, ${run.runType}, ${run.status}, ${run.conversationId ?? null}, ${run.modelUsed}, ${JSON.stringify(run.statsJson)}, ${run.createdAtMs}, ${run.createdAtMs})`)
  return changes(db) === 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/migration-ids.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/migration/legacy-ids.ts src/modules/memory/v2/migration/sqlite-helpers.ts tests/modules/memory/v2/migration-ids.test.ts
git commit -m "feat(memory): legacy timestamp normalisation, deterministic migration ids and SQL helpers"
```

---
### Task 3: Vault document → L0 unit and the §14 gist derivation

**Files:**
- Create: `src/modules/memory/v2/vault-ingest.ts`
- Test: `tests/modules/memory/v2/vault-ingest.test.ts`

**Interfaces:**
- Produces: `VAULT_CONVERSATION_PREFIX = 'vault:'`, `VAULT_GENERATED_DIR = 'generated'`, `VAULT_GIST_MAX_CHARS = 280`; `normalizeVaultPath(rel)`, `vaultConversationId(rel)`, `isGeneratedVaultPath(rel)`; `firstBodyParagraph(content)`, `clipGistText(text, max?)`; `export type VaultGistScopeType = 'global'|'project'|'project_type'|'topic'`; `export interface VaultGistDerivation { kind: 'user'|'feedback'|'project'|'domain'|'reference'|'undeclared'; text: string; scopeType: VaultGistScopeType; scopeId: string|null; pinned: boolean; importance: number; structuredJson: string|null; projectId: string|null; projectTypeId: string|null; topics: string[]; sourceTypeTags: string[]; importJobs: string[]; surprises: string[] }`; `deriveVaultGist(parsed: ParsedVaultFile, relPath: string): VaultGistDerivation`; `vaultOccurredAtMs(parsed, fallbackMs, relPath)`; `buildVaultDocumentUnit(input: { relPath; bytes: Uint8Array; id: string; occurredAtMs: number; parsed: ParsedVaultFile; sizeBytes?: number; mtimeMs?: number }): CaptureUnit`; `ingestVaultFile(db, vaultRoot, relPath, deps?: { capture?: (u: CaptureUnit) => void }): { status: 'captured'|'skipped_generated'|'skipped_unchanged'|'skipped_missing'|'skipped_not_markdown'; contentHash?: string; unitId?: string }`.
- Consumes: `parseVaultFile`/`ParsedVaultFile` (`src/modules/memory/vault/frontmatter.ts`), `effectiveProjectId` (`src/modules/memory/types.ts`), `captureUnit`/`CaptureUnit` (P1b), `sha256Hex` (P1b), `generateId` (`@shared/crypto`), `toEpochMs` (Task 2).
- Used by: Task 7 (migration of vault notes), Task 11 (rebuild re-derives vault gists from L0 bytes), Task 13 (watcher).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/vault-ingest.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §14 vault row + spike §2 #21 (i) and (x).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { parseVaultFile } from '@modules/memory/vault/frontmatter'
import { sha256Hex } from '@modules/memory/v2/ingest'
import {
  deriveVaultGist, buildVaultDocumentUnit, ingestVaultFile, firstBodyParagraph, clipGistText,
  vaultConversationId, isGeneratedVaultPath, vaultOccurredAtMs, VAULT_GIST_MAX_CHARS,
} from '@modules/memory/v2/vault-ingest'
import { makeV2Db } from './helpers'

const REFERENCE = `---
title: '3Dee ticket #1164 — részleges előleg-jóváírás'
tags:
  - imported
  - 'source:claude-code'
  - 'import-job:01M1BKYPWV2ZZXK5GCC8Y6ZX7K'
  - odoo
tier: semantic
kind: reference
summary: >-
  # 3Dee ticket #1164 — részleges előleg-jóváírás **Client:** 3Dee Technologies (eYssen kliens, pod
links: []
created: '2026-08-31'
updated: '2026-08-31'
---
# 3Dee ticket #1164 — részleges előleg-jóváírás

**Client:** 3Dee Technologies. **Kérés:** az előlegből nettó 79.000 Ft jóváírandó.
Viktória nem tud részleges előleg-jóváírót csinálni.

## Diagnózis

Nem kódhiba.
`

const USER = `---
title: 'eYssen company identity'
tags: []
tier: semantic
links: []
created: '2026-08-28'
updated: '2026-08-28'
kind: user
summary: >-
  Legal entity = Krisztian Eyssen, UK sole trader; brand = eYssen
---
The old Hungarian company will be discontinued. Work is done as a UK sole trader.
`

const FEEDBACK = `---
title: 'Odoo always means the Community fork'
tags: []
tier: procedural
links: []
created: '2026-08-28'
updated: '2026-08-28'
kind: feedback
summary: When discussing Odoo, it always means the Community fork.
---
Odoo refers exclusively to the Community fork.

**Why:** The user works on a custom Community fork and wants no Enterprise mixing.

**How to apply:** Default all Odoo discussion to the Community fork.
`

describe('deriveVaultGist', () => {
  it('reference: first body paragraph, heading stripped; provenance tags become source_type / import jobs; imported dropped', () => {
    const d = deriveVaultGist(parseVaultFile(REFERENCE), 'semantic/3dee-1164.md')
    expect(d.kind).toBe('reference')
    expect(d.text).toBe('**Client:** 3Dee Technologies. **Kérés:** az előlegből nettó 79.000 Ft jóváírandó. Viktória nem tud részleges előleg-jóváírót csinálni.')
    expect(d.text.startsWith('#')).toBe(false)
    expect(d).toMatchObject({ scopeType: 'topic', scopeId: 'semantic/3dee-1164', pinned: false, importance: 0.5, structuredJson: null })
    expect(d.topics).toEqual(['odoo'])
    expect(d.sourceTypeTags).toEqual(['claude-code'])
    expect(d.importJobs).toEqual(['01M1BKYPWV2ZZXK5GCC8Y6ZX7K'])
    expect(d.surprises).toEqual([])
  })

  it('user: summary, global, pinned, importance 1', () => {
    const d = deriveVaultGist(parseVaultFile(USER), 'semantic/identity.md')
    expect(d).toMatchObject({ kind: 'user', text: 'Legal entity = Krisztian Eyssen, UK sole trader; brand = eYssen', scopeType: 'global', scopeId: null, pinned: true, importance: 1 })
  })

  it('feedback: structured_json carries why / howToApply', () => {
    const d = deriveVaultGist(parseVaultFile(FEEDBACK), 'procedural/odoo.md')
    expect(d.scopeType).toBe('global')
    expect(d.pinned).toBe(true)
    expect(JSON.parse(d.structuredJson!)).toEqual({
      why: 'The user works on a custom Community fork and wants no Enterprise mixing.',
      howToApply: 'Default all Odoo discussion to the Community fork.',
    })
  })

  it('project / domain scope from frontmatter, with a surprise when the scope id is missing', () => {
    const p = deriveVaultGist(parseVaultFile(USER.replace('kind: user', 'kind: project\nproject: p1\nprojectType: type-a')), 'projects/p1/x.md')
    expect(p).toMatchObject({ scopeType: 'project', scopeId: 'p1', projectId: 'p1', projectTypeId: 'type-a', pinned: false })
    const d = deriveVaultGist(parseVaultFile(USER.replace('kind: user', 'kind: domain\nprojectType: type-a')), 'project-types/type-a/x.md')
    expect(d).toMatchObject({ scopeType: 'project_type', scopeId: 'type-a' })
    const orphan = deriveVaultGist(parseVaultFile(USER.replace('kind: user', 'kind: project')), 'semantic/x.md')
    expect(orphan.scopeType).toBe('topic')
    expect(orphan.surprises[0]).toMatch(/kind=project without frontmatter project/)
    const gg = deriveVaultGist(parseVaultFile(USER.replace('kind: user', 'kind: project\nproject: general-general')), 'semantic/x.md')
    expect(gg.projectId).toBeNull()
  })

  it('falls back from a heading-only summary to the body, and from an empty body to the title', () => {
    const headingSummary = deriveVaultGist(parseVaultFile(USER.replace('Legal entity = Krisztian Eyssen, UK sole trader; brand = eYssen', '# Just a heading')), 'semantic/identity.md')
    expect(headingSummary.text).toBe('The old Hungarian company will be discontinued. Work is done as a UK sole trader.')
    const empty = deriveVaultGist(parseVaultFile('---\ntitle: Only a title\nkind: reference\n---\n'), 'semantic/t.md')
    expect(empty.text).toBe('Only a title')
    expect(empty.surprises[0]).toMatch(/falls back to the title/)
  })

  it('clips long gist text on a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(100).trim()
    const clipped = clipGistText(long)
    expect(clipped.length).toBeLessThanOrEqual(VAULT_GIST_MAX_CHARS + 1)
    expect(clipped.endsWith('…')).toBe(true)
    expect(firstBodyParagraph('# H1\n\n\n## H2\n\nfirst  para\nsecond line\n\nthird')).toBe('first para second line')
  })
})

describe('buildVaultDocumentUnit', () => {
  it('builds a document unit keyed on vault:<path> with owner trust and the file bytes', () => {
    const bytes = new TextEncoder().encode(USER)
    const parsed = parseVaultFile(USER)
    const unit = buildVaultDocumentUnit({ relPath: 'semantic/identity.md', bytes, id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', occurredAtMs: vaultOccurredAtMs(parsed, 0, 'semantic/identity.md'), parsed, sizeBytes: bytes.byteLength, mtimeMs: 123 })
    expect(unit).toMatchObject({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', sourceType: 'document', actor: 'vault', conversationId: 'vault:semantic/identity.md',
      projectId: null, projectTypeId: null, occurredAtMs: Date.parse('2026-08-28T00:00:00Z'), trustTier: 'owner',
      shredPartitionId: 'vault:semantic/identity.md',
      meta: { origin: 'vault', path: 'semantic/identity.md', title: 'eYssen company identity', kind: 'user', tier: 'semantic', created: '2026-08-28', updated: '2026-08-28', sizeBytes: bytes.byteLength, mtimeMs: 123 },
    })
    expect(unit.content).toBe(USER)
    expect(vaultConversationId('semantic\\identity.md')).toBe('vault:semantic/identity.md')
    expect(isGeneratedVaultPath('generated/gists/x.md')).toBe(true)
    expect(isGeneratedVaultPath('semantic/generated.md')).toBe(false)
  })
})

describe('ingestVaultFile (watcher entry)', () => {
  let root: string
  let db: any
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eyas-vault-ingest-'))
    mkdirSync(join(root, 'semantic'), { recursive: true })
    mkdirSync(join(root, 'generated'), { recursive: true })
    db = makeV2Db().db
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('captures a markdown file once per content hash and skips generated / missing / non-markdown paths', () => {
    writeFileSync(join(root, 'semantic', 'a.md'), USER)
    writeFileSync(join(root, 'generated', 'g.md'), USER)
    const capture = vi.fn()
    const first = ingestVaultFile(db, root, 'semantic/a.md', { capture })
    expect(first.status).toBe('captured')
    expect(first.contentHash).toBe(sha256Hex(new TextEncoder().encode(USER)))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0]).toMatchObject({ conversationId: 'vault:semantic/a.md', shredPartitionId: 'vault:semantic/a.md', trustTier: 'owner' })

    // Pretend the flush landed: the same bytes must not be captured again.
    db.run(sql`INSERT INTO memory_item (item_type, id, created_at) VALUES ('raw', ${first.unitId}, 1)`)
    db.run(sql`INSERT INTO memory_raw (rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at, shred_partition_id, source_type, actor, conversation_id, occurred_at, trust_tier, tombstoned)
      VALUES (1, ${first.unitId}, ${first.contentHash}, 'i', 1, 0, 1, 1, 'vault:semantic/a.md', 'document', 'vault', 'vault:semantic/a.md', 1, 'owner', 0)`)
    expect(ingestVaultFile(db, root, 'semantic/a.md', { capture }).status).toBe('skipped_unchanged')
    expect(capture).toHaveBeenCalledTimes(1)

    writeFileSync(join(root, 'semantic', 'a.md'), `${USER}\nEdited.\n`)
    expect(ingestVaultFile(db, root, 'semantic/a.md', { capture }).status).toBe('captured')
    expect(capture).toHaveBeenCalledTimes(2)

    expect(ingestVaultFile(db, root, 'generated/g.md', { capture }).status).toBe('skipped_generated')
    expect(ingestVaultFile(db, root, 'semantic/missing.md', { capture }).status).toBe('skipped_missing')
    expect(ingestVaultFile(db, root, 'semantic/notes.txt', { capture }).status).toBe('skipped_not_markdown')
    expect(capture).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/vault-ingest.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/vault-ingest'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/vault-ingest.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The vault is a human layer, not the capture sink (spec §4): every markdown
// file is ingested into L0 as a `document` occurrence, partition
// `vault:<path>`, hash = SHA-256 of the file bytes at ingestion — never
// vault_index.file_hash, which is a `${size}-${mtimeMs}` change detector
// (spike §2 #21 i). The same derivation serves the migration (Task 7), the
// rebuild (Task 11) and the live watcher (Task 13).

import { readFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import { effectiveProjectId } from '../types.js'
import { parseVaultFile, type ParsedVaultFile } from '../vault/frontmatter.js'
import { captureUnit, type CaptureUnit } from './ingest-bridge.js'
import { sha256Hex } from './ingest.js'
import { toEpochMs } from './migration/legacy-ids.js'

export const VAULT_CONVERSATION_PREFIX = 'vault:'
/** Written by `eyas memory export --vault`; never re-ingested (it would loop). */
export const VAULT_GENERATED_DIR = 'generated'
export const VAULT_GIST_MAX_CHARS = 280

export type VaultGistScopeType = 'global' | 'project' | 'project_type' | 'topic'
export type VaultKind = 'user' | 'feedback' | 'project' | 'domain' | 'reference' | 'undeclared'

export interface VaultGistDerivation {
  kind: VaultKind
  text: string
  scopeType: VaultGistScopeType
  scopeId: string | null
  pinned: boolean
  importance: number
  structuredJson: string | null
  projectId: string | null
  projectTypeId: string | null
  topics: string[]
  sourceTypeTags: string[]
  importJobs: string[]
  surprises: string[]
}

export function normalizeVaultPath(relPath: string): string {
  return relPath.split(sep).join('/').split('\\').join('/').replace(/^\.\//, '')
}

export function vaultConversationId(relPath: string): string {
  return `${VAULT_CONVERSATION_PREFIX}${normalizeVaultPath(relPath)}`
}

export function isGeneratedVaultPath(relPath: string): boolean {
  const p = normalizeVaultPath(relPath)
  return p === VAULT_GENERATED_DIR || p.startsWith(`${VAULT_GENERATED_DIR}/`)
}

/** First paragraph of the body that is not a heading or a rule, whitespace collapsed. */
export function firstBodyParagraph(content: string): string {
  for (const paragraph of content.split(/\n\s*\n/)) {
    const lines = paragraph
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^#{1,6}\s/.test(l) && !/^-{3,}$/.test(l))
    if (lines.length === 0) continue
    return lines.join(' ').replace(/\s+/g, ' ').trim()
  }
  return ''
}

export function clipGistText(text: string, max = VAULT_GIST_MAX_CHARS): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function parseFeedbackStructure(content: string): { why: string | null; howToApply: string | null } {
  const grab = (label: string): string | null => {
    const m = new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?:\\n\\s*\\n|$)`).exec(content)
    return m ? m[1].replace(/\s+/g, ' ').trim() || null : null
  }
  return { why: grab('Why'), howToApply: grab('How to apply') }
}

/** Spec §14 vault row + spike §2 #21 (x): one depth-0 gist per note. */
export function deriveVaultGist(parsed: ParsedVaultFile, relPath: string): VaultGistDerivation {
  const fm = parsed.frontmatter
  const rel = normalizeVaultPath(relPath)
  const kind: VaultKind = fm.kind ?? 'undeclared'
  const surprises: string[] = []

  const summary = (fm.summary ?? '').trim()
  const summaryUsable = summary.length > 0 && !summary.startsWith('#')
  let text = kind === 'reference'
    ? firstBodyParagraph(parsed.content) || (summaryUsable ? summary : '')
    : (summaryUsable ? summary : firstBodyParagraph(parsed.content))
  if (!text) {
    text = fm.title
    surprises.push(`vault ${rel}: no summary and no body paragraph; gist falls back to the title`)
  }
  text = clipGistText(text)

  const projectId = effectiveProjectId(fm.project ?? null)
  const projectTypeId = fm.projectType ?? null
  let scopeType: VaultGistScopeType = 'topic'
  let scopeId: string | null = rel.replace(/\.md$/, '')
  let pinned = false
  switch (kind) {
    case 'user':
    case 'feedback':
      scopeType = 'global'; scopeId = null; pinned = true
      break
    case 'project':
      if (projectId) { scopeType = 'project'; scopeId = projectId }
      else surprises.push(`vault ${rel}: kind=project without frontmatter project; scoped as topic`)
      break
    case 'domain':
      if (projectTypeId) { scopeType = 'project_type'; scopeId = projectTypeId }
      else surprises.push(`vault ${rel}: kind=domain without frontmatter projectType; scoped as topic`)
      break
    default:
      break
  }

  const topics: string[] = []
  const sourceTypeTags: string[] = []
  const importJobs: string[] = []
  for (const raw of fm.tags) {
    const t = String(raw).trim()
    if (!t || t === 'imported') continue
    if (t.startsWith('source:')) sourceTypeTags.push(t.slice('source:'.length))
    else if (t.startsWith('import-job:')) importJobs.push(t.slice('import-job:'.length))
    else topics.push(t)
  }

  let structuredJson: string | null = null
  if (kind === 'feedback') {
    const s = parseFeedbackStructure(parsed.content)
    if (!s.why || !s.howToApply) surprises.push(`vault ${rel}: feedback note without parsable **Why:** / **How to apply:**`)
    structuredJson = JSON.stringify(s)
  }

  return { kind, text, scopeType, scopeId, pinned, importance: pinned ? 1 : 0.5, structuredJson, projectId, projectTypeId, topics, sourceTypeTags, importJobs, surprises }
}

/** Frontmatter `created` (date → midnight UTC, spike §2 #21 iii); the file mtime when unparsable. */
export function vaultOccurredAtMs(parsed: ParsedVaultFile, fallbackMs: number, relPath: string): number {
  try {
    return toEpochMs(parsed.frontmatter.created, `vault ${relPath} created`)
  } catch {
    return fallbackMs
  }
}

export interface VaultDocumentInput {
  relPath: string
  bytes: Uint8Array
  id: string
  occurredAtMs: number
  parsed: ParsedVaultFile
  sizeBytes?: number
  mtimeMs?: number
}

export function buildVaultDocumentUnit(input: VaultDocumentInput): CaptureUnit {
  const rel = normalizeVaultPath(input.relPath)
  const fm = input.parsed.frontmatter
  return {
    id: input.id,
    sourceType: 'document',
    actor: 'vault',
    conversationId: vaultConversationId(rel),
    projectId: effectiveProjectId(fm.project ?? null),
    projectTypeId: fm.projectType ?? null,
    occurredAtMs: input.occurredAtMs,
    content: new TextDecoder().decode(input.bytes),
    trustTier: 'owner',
    shredPartitionId: `vault:${rel}`,
    meta: {
      origin: 'vault',
      path: rel,
      title: fm.title,
      kind: fm.kind ?? null,
      tier: fm.tier,
      created: fm.created ?? null,
      updated: fm.updated ?? null,
      sizeBytes: input.sizeBytes ?? input.bytes.byteLength,
      mtimeMs: input.mtimeMs ?? null,
    },
  }
}

export interface IngestVaultFileResult {
  status: 'captured' | 'skipped_generated' | 'skipped_unchanged' | 'skipped_missing' | 'skipped_not_markdown'
  contentHash?: string
  unitId?: string
}

/**
 * Watcher entry point: read the file, skip it when L0 already holds these
 * exact bytes for this partition, otherwise hand a document unit to the
 * bridge. The occurrence time of an edit is the file's mtime.
 */
export function ingestVaultFile(
  db: EyasDb,
  vaultRoot: string,
  relPath: string,
  deps: { capture?: (unit: CaptureUnit) => void } = {},
): IngestVaultFileResult {
  const rel = normalizeVaultPath(relPath)
  if (!rel.endsWith('.md')) return { status: 'skipped_not_markdown' }
  if (isGeneratedVaultPath(rel)) return { status: 'skipped_generated' }
  const abs = join(vaultRoot, rel)
  let bytes: Buffer
  let mtimeMs: number
  let size: number
  try {
    const st = statSync(abs)
    if (!st.isFile()) return { status: 'skipped_missing' }
    bytes = readFileSync(abs)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch {
    return { status: 'skipped_missing' }
  }
  const contentHash = sha256Hex(bytes)
  const partition = `vault:${rel}`
  try {
    const seen = db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM memory_raw
      WHERE shred_partition_id = ${partition} AND content_hash = ${contentHash} LIMIT 1`)
    if (seen.length > 0) return { status: 'skipped_unchanged', contentHash }
  } catch {
    /* v2 tables not created yet — capture anyway; the ingest is exactly-once on the ULID */
  }
  const parsed = parseVaultFile(bytes.toString('utf8'))
  const unit = buildVaultDocumentUnit({ relPath: rel, bytes, id: generateId(), occurredAtMs: Math.round(mtimeMs), parsed, sizeBytes: size, mtimeMs })
  ;(deps.capture ?? captureUnit)(unit)
  return { status: 'captured', contentHash, unitId: unit.id }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/vault-ingest.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/vault-ingest.ts tests/modules/memory/v2/vault-ingest.test.ts
git commit -m "feat(memory): vault document units and the vault-note gist derivation"
```

---

### Task 4: The legacy-store fixture (spike §3.9 counts + episodic/archive/working rows)

**Files:**
- Create: `tests/modules/memory/v2/fixtures/legacy-store.ts`
- Test: `tests/modules/memory/v2/legacy-fixture.test.ts`

**Interfaces:**
- Produces: `openLegacyTestDb(): { db: any; caps: SqliteCapabilities }` (core tables from `createTestDb` + legacy memory tables + `agent_events` + v2 tables); `seedLegacyStore(db, vaultRoot): LegacyFixture` with `export interface LegacyFixture { vaultRoot: string; expected: { conversations: number; messages: number; userMessages: number; assistantMessages: number; messagesWithAttachments: number; llmResponses: number; llmResponseParentDuplicates: number; criticVerdicts: number; episodic: number; archive: number; working: number; vaultNotes: number; vaultReference: number; vaultUser: number; vaultFeedback: number; captureRuns: number; captureRunsOk: number; captureRunsSkipped: number; captureRunsFailed: number; noteLinks: number; rawRows: number; distinctRawHashes: number }; duplicateEventIds: number[]; userNotePath: string; feedbackNotePath: string }`.
- Consumes: `createTestDb` (`tests/helpers/test-db.ts`), `createMemoryTables` (`@modules/memory/schema`), `createEventStoreTables` (`@modules/event-store/schema`), `createMemoryV2Tables` + `probeSqliteCapabilities` (P1a).

Shape (mirrors the live store the spike measured): 46 conversations — `c001..c033` interactive (project `general-general`, 52 messages: 19 with a user+assistant pair, 14 with one user message), `c034` interactive (project `eyas-system`, type `eyas`, 1 user + 8 assistant), `c035..c046` managed children (`mode='managed'`, parents `c001..c012`, 0 messages; `c035..c044` project `general-general`, `c045`/`c046` no project); 61 messages = 34 user / 27 assistant, 13 of them the byte-identical user message `Rendben.` in 13 different conversations (→ 49 distinct contents), 5 with one attachment; 12 `agent_sessions` `s01..s12` → `c035..c046`; 18 `agent_events`: `LlmResponse` on `s01..s09` (seq 1) + `CriticVerdict` (seq 2) — the responses of `s01..s03` are byte-identical to the assistant reply of parents `c001..c003`; 2 episodic + 1 archive + 1 working row; 266 vault files (264 `reference`, 59 with a `# heading` summary; 1 `user`; 1 `feedback`); 15 capture runs (`'2026-08-27 20:25:NN'` text, 12 clean, `error`, `too-short`, `unparsable`, 6 with `provider` NULL); 2 note links in the same second as a run of their conversation.

- [ ] **Step 1: Write the fixture**

```ts
// tests/modules/memory/v2/fixtures/legacy-store.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A legacy store shaped like the live one the Phase 0 spike measured
// (spike report §3.9), plus the rows that instance did not have (2 episodic,
// 1 archive, 1 working — spike §4.3 #6). Deterministic: no randomness.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createTestDb, getRawFromDrizzle } from '../../../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEventStoreTables } from '@modules/event-store/schema'
import { probeSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'

export interface LegacyFixture {
  vaultRoot: string
  expected: {
    conversations: number; messages: number; userMessages: number; assistantMessages: number; messagesWithAttachments: number
    llmResponses: number; llmResponseParentDuplicates: number; criticVerdicts: number
    episodic: number; archive: number; working: number
    vaultNotes: number; vaultReference: number; vaultUser: number; vaultFeedback: number
    captureRuns: number; captureRunsOk: number; captureRunsSkipped: number; captureRunsFailed: number
    noteLinks: number
    rawRows: number; distinctRawHashes: number
  }
  duplicateEventIds: number[]
  userNotePath: string
  feedbackNotePath: string
}

export function openLegacyTestDb(): { db: any; caps: SqliteCapabilities } {
  const db = createTestDb('legacy-store').open()
  createMemoryTables(db)
  createEventStoreTables(db)
  const caps = probeSqliteCapabilities(getRawFromDrizzle(db))
  createMemoryV2Tables(db, caps)
  return { db, caps }
}

const T0 = Date.parse('2026-08-14T18:45:53.643Z')
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()
const convId = (n: number) => `c${String(n).padStart(3, '0')}`
const DUPLICATE_USER_TEXT = 'Rendben.'

export function seedLegacyStore(db: any, vaultRoot: string): LegacyFixture {
  const now = iso(0)
  db.run(sql`INSERT INTO project_types (id, name, created_at) VALUES ('eyas', 'EYAS', ${now})`)
  db.run(sql`INSERT INTO projects (id, name, type_id, created_at, updated_at) VALUES ('eyas-system', 'EYAS system', 'eyas', ${now}, ${now})`)

  // 46 conversations
  for (let n = 1; n <= 46; n++) {
    const id = convId(n)
    const managed = n >= 35
    const project = n === 34 ? 'eyas-system' : n >= 45 ? null : 'general-general'
    const parent = managed ? convId(n - 34) : null
    db.run(sql`INSERT INTO conversations (id, title, status, user_id, project_id, mode, agent_id, parent_conversation_id, created_at, updated_at)
      VALUES (${id}, ${`Conversation ${n}`}, 'idle', 'u-owner', ${project}, ${managed ? 'managed' : 'simple'}, ${managed ? 'agent-bg' : null}, ${parent}, ${iso(n * 60_000)}, ${iso(n * 60_000)})`)
  }

  // 61 messages: c001..c019 user+assistant, c020..c033 user only, c034 1 user + 8 assistant.
  let messageNo = 0
  let userMessages = 0
  let assistantMessages = 0
  let withAttachments = 0
  const distinct = new Set<string>()
  const duplicateConvs = new Set<number>([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26])
  const assistantTextOf = new Map<string, string>()
  const insertMessage = (conv: string, role: 'user' | 'assistant', content: string, attachments: string[] = []) => {
    messageNo++
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, tokens_in, tokens_out, attachments, created_at)
      VALUES (${conv}, ${role}, ${content}, ${role === 'assistant' ? 'm1' : null}, ${role === 'assistant' ? 'p1' : null}, 1, 1, ${JSON.stringify(attachments)}, ${iso(messageNo * 1_000)})`)
    if (role === 'user') userMessages++; else assistantMessages++
    if (attachments.length) withAttachments++
    distinct.add(content)
  }
  for (let n = 1; n <= 33; n++) {
    const conv = convId(n)
    const userText = duplicateConvs.has(n) ? DUPLICATE_USER_TEXT : `User message ${n}: please always answer in Hungarian, that is how the work is done.`
    insertMessage(conv, 'user', userText, n <= 5 ? [`01ATTACHMENT${String(n).padStart(14, '0')}`] : [])
    if (n <= 19) {
      const reply = `Assistant reply ${n}: rendben, mindig magyarul válaszolok ebben a feladatban.`
      insertMessage(conv, 'assistant', reply)
      assistantTextOf.set(conv, reply)
    }
  }
  insertMessage(convId(34), 'user', 'System conversation user turn about the EYAS memory migration.')
  for (let k = 1; k <= 8; k++) insertMessage(convId(34), 'assistant', `System conversation assistant turn ${k} about the EYAS memory migration.`)

  // 12 background sessions, 9 LlmResponse + 9 CriticVerdict events
  for (let s = 1; s <= 12; s++) {
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES (${`s${String(s).padStart(2, '0')}`}, ${convId(34 + s)}, 'agent-bg', 'completed', ${iso(s * 1_000)})`)
  }
  const duplicateEventIds: number[] = []
  let eventNo = 0
  for (let s = 1; s <= 9; s++) {
    const sessionId = `s${String(s).padStart(2, '0')}`
    const parent = convId(s)
    const content = s <= 3 ? assistantTextOf.get(parent)! : `Background run ${s} concluded: the migration plan is ready.`
    eventNo++
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload)
      VALUES (${sessionId}, 1, ${T0 + 10_000_000 + s * 1_000}, 'LlmResponse', NULL, ${JSON.stringify({ response: { content, stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 } } })})`)
    if (s <= 3) duplicateEventIds.push(eventNo)
    eventNo++
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload)
      VALUES (${sessionId}, 2, ${T0 + 10_000_000 + s * 1_000 + 500}, 'CriticVerdict', NULL, ${JSON.stringify({ verdict: 'complete', reason: 'done', missing: [], round: 1 })})`)
  }

  // Episodic (2), archive (1), working (1)
  db.run(sql`INSERT INTO episodic_memories (id, content, source_type, source_id, salience, valid_from, valid_until, tags, created_at, conversation_id, project_id, agent_id)
    VALUES ('ep-1', 'The owner prefers Hungarian replies in every task.', 'agent-memory', 'c001', 0.8, ${iso(1_000)}, NULL, '["language"]', ${iso(1_000)}, 'c001', 'general-general', NULL)`)
  db.run(sql`INSERT INTO episodic_memories (id, content, source_type, source_id, salience, valid_from, valid_until, tags, created_at, conversation_id, project_id, agent_id)
    VALUES ('ep-2', 'EYAS system project uses the eyas project type.', 'pre-compact', NULL, 1.2, ${iso(2_000)}, ${iso(3_000)}, '[]', ${iso(2_000)}, NULL, 'eyas-system', 'agent-bg')`)
  db.run(sql`INSERT INTO archive_memories (id, original_id, content, source_type, tags, archived_at, original_created_at, agent_id)
    VALUES ('ar-1', 'ep-0', 'An archived memory about the first deployment.', 'agent-memory', '["deploy"]', ${iso(9_000)}, ${iso(500)}, NULL)`)
  db.run(sql`INSERT INTO working_memory (key, content, max_tokens, access_count, created_at, updated_at, expires_at)
    VALUES ('agent-bg:scratch', 'Scratchpad: next step is the migration test.', 500, 0, ${iso(4_000)}, ${iso(4_500)}, ${iso(90_000_000)})`)

  // 266 vault files
  mkdirSync(join(vaultRoot, 'semantic'), { recursive: true })
  mkdirSync(join(vaultRoot, 'procedural'), { recursive: true })
  for (let i = 0; i < 264; i++) {
    const n = String(i).padStart(3, '0')
    const summary = i < 59
      ? `# Reference note ${n} — imported title **Client:** Fixture client ${n}`
      : `Reference note ${n}: an imported summary about an Odoo ticket.`
    writeFileSync(join(vaultRoot, 'semantic', `ref-${n}-note.md`), `---
title: 'Reference note ${n}'
tags:
  - imported
  - 'source:claude-code'
  - 'import-job:01M1BKYPWV2ZZXK5GCC8Y6ZX7K'
tier: semantic
kind: reference
summary: >-
  ${summary}
links: []
created: '2026-08-31'
updated: '2026-08-31'
---
# Reference note ${n}

**Client:** Fixture client ${n}. Első bekezdés a(z) ${n}. jegyzetről: előleg jóváírás, helyesbítő számla.

## Details

Second paragraph ${n}.
`)
  }
  const userNotePath = 'semantic/owner-identity.md'
  writeFileSync(join(vaultRoot, userNotePath), `---
title: 'Owner identity'
tags: []
tier: semantic
links: []
created: '2026-08-28'
updated: '2026-08-28'
kind: user
summary: >-
  Legal entity = the fixture owner, UK sole trader; brand = eYssen
---
The old company is winding down; work is done as a UK sole trader.
`)
  const feedbackNotePath = 'procedural/odoo-means-fork.md'
  writeFileSync(join(vaultRoot, feedbackNotePath), `---
title: 'Odoo always means the Community fork'
tags: []
tier: procedural
links: []
created: '2026-08-28'
updated: '2026-08-28'
kind: feedback
summary: When discussing Odoo, it always means the Community fork.
---
Odoo refers exclusively to the Community fork.

**Why:** The user works on a custom Community fork.

**How to apply:** Default all Odoo discussion to the Community fork.
`)

  // 15 capture runs (datetime('now') text, no zone) and 2 note links in the same second
  const runConv = (i: number) => convId(((i - 1) % 33) + 1)
  const reasons: Array<string | null> = [null, null, null, null, null, null, null, null, null, null, null, null, 'error', 'too-short', 'unparsable']
  for (let i = 1; i <= 15; i++) {
    const createdAt = `2026-08-27 20:25:${String(30 + i).padStart(2, '0')}`
    db.run(sql`INSERT INTO memory_capture_runs (id, conversation_id, notes_written, kinds, skipped_reason, created_at, provider)
      VALUES (${i}, ${runConv(i)}, ${i === 1 || i === 2 ? 1 : 0}, ${i === 1 || i === 2 ? '["user"]' : null}, ${reasons[i - 1]}, ${createdAt}, ${i <= 9 ? 'p1/m1' : null})`)
  }
  db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id, source, created_at) VALUES (${userNotePath}, 'conversations', ${runConv(1)}, 'capture', '2026-08-27 20:25:31')`)
  db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id, source, created_at) VALUES (${feedbackNotePath}, 'conversations', ${runConv(2)}, 'capture', '2026-08-27 20:25:32')`)

  const messages = messageNo
  const llmResponses = 9
  const rawRows = messages + (llmResponses - 3) + 2 + 1 + 1 + 266
  return {
    vaultRoot,
    expected: {
      conversations: 46, messages, userMessages, assistantMessages, messagesWithAttachments: withAttachments,
      llmResponses, llmResponseParentDuplicates: 3, criticVerdicts: 9,
      episodic: 2, archive: 1, working: 1,
      vaultNotes: 266, vaultReference: 264, vaultUser: 1, vaultFeedback: 1,
      captureRuns: 15, captureRunsOk: 12, captureRunsSkipped: 2, captureRunsFailed: 1,
      noteLinks: 2,
      rawRows,
      // 13 rows share one content; the 6 surviving LlmResponse texts, episodic/archive/working and 266 files are all distinct.
      distinctRawHashes: rawRows - 12,
    },
    duplicateEventIds,
    userNotePath,
    feedbackNotePath,
  }
}
```

- [ ] **Step 2: Write the fixture sanity test**

```ts
// tests/modules/memory/v2/legacy-fixture.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { openLegacyTestDb, seedLegacyStore, type LegacyFixture } from './fixtures/legacy-store'

let db: any
let root: string
let fx: LegacyFixture

beforeEach(() => {
  db = openLegacyTestDb().db
  root = mkdtempSync(join(tmpdir(), 'eyas-legacy-fixture-'))
  fx = seedLegacyStore(db, root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const count = (table: string, where = '1=1') => (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)) as any[])[0].c

describe('legacy store fixture', () => {
  it('matches the spike §3.9 counts', () => {
    expect(count('conversations')).toBe(46)
    expect(count('conversation_messages')).toBe(61)
    expect(count('conversation_messages', "role = 'user'")).toBe(34)
    expect(count('conversation_messages', "role = 'assistant'")).toBe(27)
    expect((db.all(sql`SELECT COUNT(DISTINCT content) AS c FROM conversation_messages`) as any[])[0].c).toBe(49)
    expect(count('conversation_messages', "attachments <> '[]'")).toBe(5)
    expect(count('conversations', "project_id = 'general-general'")).toBe(43)
    expect(count('agent_sessions')).toBe(12)
    expect(count('agent_events', "event_type = 'LlmResponse'")).toBe(9)
    expect(count('agent_events', "event_type = 'CriticVerdict'")).toBe(9)
    expect(count('episodic_memories')).toBe(2)
    expect(count('archive_memories')).toBe(1)
    expect(count('working_memory')).toBe(1)
    expect(count('memory_capture_runs')).toBe(15)
    expect(count('memory_capture_runs', "skipped_reason IS NULL")).toBe(12)
    expect(count('memory_capture_runs', "provider IS NULL")).toBe(6)
    expect(count('memory_note_links')).toBe(2)
    expect(readdirSync(join(root, 'semantic')).length + readdirSync(join(root, 'procedural')).length).toBe(266)
    expect(fx.expected).toMatchObject({ messages: 61, userMessages: 34, assistantMessages: 27, rawRows: 61 + 6 + 2 + 1 + 1 + 266, distinctRawHashes: 337 - 12 })
    expect(fx.duplicateEventIds).toHaveLength(3)
  })

  it('three LlmResponse payloads are byte-identical to an assistant message of the parent conversation', () => {
    for (const id of fx.duplicateEventIds) {
      const e = (db.all(sql`SELECT e.payload, s.conversation_id FROM agent_events e JOIN agent_sessions s ON s.id = e.session_id WHERE e.id = ${id}`) as any[])[0]
      const parent = (db.all(sql`SELECT parent_conversation_id FROM conversations WHERE id = ${e.conversation_id}`) as any[])[0].parent_conversation_id
      const content = JSON.parse(e.payload).response.content
      expect(count('conversation_messages', `conversation_id = '${parent}' AND role = 'assistant' AND content = '${content.replace(/'/g, "''")}'`)).toBe(1)
    }
  })
})
```

- [ ] **Step 3: Run it**

Run: `bun vitest run tests/modules/memory/v2/legacy-fixture.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/modules/memory/v2/fixtures/legacy-store.ts tests/modules/memory/v2/legacy-fixture.test.ts
git commit -m "test(memory): legacy-store fixture shaped like the spike measurements"
```

---
### Task 5: The migration's L0 writer (blob, rid, raw row, FTS, tags, `migrated_from` link)

**Files:**
- Create: `src/modules/memory/v2/migration/raw-writer.ts`
- Test: `tests/modules/memory/v2/raw-writer.test.ts`

**Interfaces:**
- Produces: `export interface RawWriterDeps { db: EyasDb; caps: SqliteCapabilities; instanceId: string; nowMs: number }`; `export interface MigratedRawRow { id: string; bytes: Uint8Array; shredPartitionId: string; sourceType: RawSourceType; actor: string | null; conversationId: string | null; projectId: string | null; projectTypeId: string | null; occurredAtMs: number; trustTier: TrustTier; meta: Record<string, unknown> | null; legacyTable: string; legacyPk: string }`; `export interface RawWriteOutcome { inserted: boolean; newBlob: boolean; contentHash: string; rid: number; linkInserted: boolean }`; `writeMigratedRaw(deps: RawWriterDeps, row: MigratedRawRow): RawWriteOutcome`.
- Consumes: `zstdCompress` (P1a, sync after `initZstd`), `allocateRid` (P1a), `sha256Hex`/`RAW_FTS_CLIP_CHARS` (P1b), `detectLanguage` (P1b), `legacyId`, `changes`, `insertLink` (Task 2).
- Writes exactly the P1b row contract (see "File structure"), so migrated and live rows are indistinguishable to P1c and Phase 2 except for `meta_json.origin`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/raw-writer.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd, zstdDecompress } from '@shared/zstd'
import { ulidTimestampMs } from '@shared/crypto'
import { writeMigratedRaw, type MigratedRawRow, type RawWriterDeps } from '@modules/memory/v2/migration/raw-writer'
import { legacyId, encodeUtf8 } from '@modules/memory/v2/migration/legacy-ids'
import { makeV2Db } from './helpers'

let deps: RawWriterDeps
const T = 1_786_733_153_643

function row(over: Partial<MigratedRawRow> = {}): MigratedRawRow {
  const pk = over.legacyPk ?? '7'
  return {
    id: legacyId(over.occurredAtMs ?? T, `legacy:conversation_messages:${pk}`),
    bytes: encodeUtf8('Kérlek, mindig magyarul válaszolj nekem, és ne felejtsd el az ékezeteket.'),
    shredPartitionId: 'c001', sourceType: 'user_message', actor: 'u-owner', conversationId: 'c001',
    projectId: 'p1', projectTypeId: 'type-a', occurredAtMs: T, trustTier: 'owner',
    meta: { origin: 'conversation_messages', messageId: 7 }, legacyTable: 'conversation_messages', legacyPk: pk,
    ...over,
  }
}

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const v2 = makeV2Db()
  deps = { db: v2.db, caps: v2.caps, instanceId: 'inst-test', nowMs: 1_800_000_000_000 }
})

const tagsOf = (rid: number) => Object.fromEntries(
  (deps.db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${rid} AND memory_type = 'raw'`) as any[]).map((t) => [t.tag_type, t.tag_value]),
)

describe('writeMigratedRaw', () => {
  it('writes the raw row with the P1b column set, the seven raw tags, an FTS entry, a blob and a migrated_from link', () => {
    const out = writeMigratedRaw(deps, row())
    expect(out).toMatchObject({ inserted: true, newBlob: true, linkInserted: true })
    const r = (deps.db.all(sql`SELECT * FROM memory_raw`) as any[])[0]
    expect(r).toMatchObject({
      rid: out.rid, content_hash: out.contentHash, origin_instance_id: 'inst-test', hlc_physical_ms: T, hlc_logical: 0, revision: 1,
      created_at: 1_800_000_000_000, shred_partition_id: 'c001', source_type: 'user_message', actor: 'u-owner', conversation_id: 'c001',
      project_id: 'p1', project_type_id: 'type-a', occurred_at: T, trust_tier: 'owner', dek_id: null, tombstoned: 0,
    })
    expect(ulidTimestampMs(r.id)).toBe(T)
    expect(JSON.parse(r.meta_json)).toEqual({ origin: 'conversation_messages', messageId: 7 })
    expect(tagsOf(out.rid)).toEqual({ project: 'p1', project_type: 'type-a', task: 'c001', source_type: 'user_message', language: 'hu', layer: 'raw', trust_tier: 'owner' })
    if (deps.caps.fts5) {
      expect((deps.db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'magyarul'`) as any[]).map((x) => x.rowid)).toEqual([out.rid])
    }
    const blob = (deps.db.all(sql`SELECT compressed_blob, byte_length, ref_count FROM memory_blob`) as any[])[0]
    expect(blob.ref_count).toBe(1)
    expect(new TextDecoder().decode(zstdDecompress(new Uint8Array(blob.compressed_blob)))).toBe(new TextDecoder().decode(row().bytes))
    expect(blob.byte_length).toBe(row().bytes.byteLength)
    const link = (deps.db.all(sql`SELECT from_type, from_id, to_type, to_id, link_type, run_id FROM memory_link`) as any[])[0]
    expect(link).toEqual({ from_type: 'raw', from_id: r.id, to_type: 'conversation_messages', to_id: '7', link_type: 'migrated_from', run_id: null })
  })

  it('is a no-op on re-run: no row, no ref_count bump, no second link', () => {
    writeMigratedRaw(deps, row())
    const again = writeMigratedRaw(deps, row())
    expect(again).toMatchObject({ inserted: false, newBlob: false, linkInserted: false })
    expect((deps.db.all(sql`SELECT COUNT(*) AS c FROM memory_raw`) as any[])[0].c).toBe(1)
    expect((deps.db.all(sql`SELECT ref_count FROM memory_blob`) as any[])[0].ref_count).toBe(1)
    expect((deps.db.all(sql`SELECT COUNT(*) AS c FROM memory_link`) as any[])[0].c).toBe(1)
  })

  it('two partitions → two blobs, one hash; one partition → one blob, ref_count 2', () => {
    writeMigratedRaw(deps, row({ legacyPk: '1', shredPartitionId: 'c001', conversationId: 'c001' }))
    writeMigratedRaw(deps, row({ legacyPk: '2', shredPartitionId: 'c002', conversationId: 'c002' }))
    const b = writeMigratedRaw(deps, row({ legacyPk: '3', shredPartitionId: 'c002', conversationId: 'c002', occurredAtMs: T + 1 }))
    expect(b.newBlob).toBe(false)
    const blobs = deps.db.all(sql`SELECT shred_partition_id, ref_count FROM memory_blob ORDER BY shred_partition_id`) as any[]
    expect(blobs).toEqual([{ shred_partition_id: 'c001', ref_count: 1 }, { shred_partition_id: 'c002', ref_count: 2 }])
    expect((deps.db.all(sql`SELECT COUNT(DISTINCT content_hash) AS c FROM memory_raw`) as any[])[0].c).toBe(1)
  })

  it('omits project / project_type / task tags when the row has none (vault-less documents)', () => {
    const out = writeMigratedRaw(deps, row({ sourceType: 'document', actor: 'prompt-wizard', conversationId: null, projectId: null, projectTypeId: null, shredPartitionId: 'working_memory:k', trustTier: 'derived', legacyTable: 'working_memory', legacyPk: 'k' }))
    expect(tagsOf(out.rid)).toEqual({ source_type: 'document', language: 'hu', layer: 'raw', trust_tier: 'derived' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/raw-writer.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/migration/raw-writer'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/migration/raw-writer.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The migration's only L0 writer. It mirrors p1b's ingest flush row for row
// (same columns, same blob discipline, same seven raw tags, same FTS clip)
// with three differences: the id is the caller's deterministic ULID, the
// HLC physical part is the SOURCE time (so a re-run writes nothing new), and
// every row is linked to its legacy origin with `migrated_from`.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { zstdCompress } from '@shared/zstd.js'
import { allocateRid } from '../schema.js'
import { sha256Hex, RAW_FTS_CLIP_CHARS } from '../ingest.js'
import { detectLanguage } from '../language.js'
import type { RawSourceType, TrustTier } from '../ingest-bridge.js'
import { legacyId } from './legacy-ids.js'
import { changes, insertLink } from './sqlite-helpers.js'

export interface RawWriterDeps {
  db: EyasDb
  caps: SqliteCapabilities
  instanceId: string
  nowMs: number
}

export interface MigratedRawRow {
  /** Deterministic ULID (legacyId of the source timestamp + 'legacy:<table>:<pk>'). */
  id: string
  bytes: Uint8Array
  shredPartitionId: string
  sourceType: RawSourceType
  actor: string | null
  conversationId: string | null
  projectId: string | null
  projectTypeId: string | null
  occurredAtMs: number
  trustTier: TrustTier
  meta: Record<string, unknown> | null
  legacyTable: string
  legacyPk: string
}

export interface RawWriteOutcome {
  inserted: boolean
  newBlob: boolean
  contentHash: string
  rid: number
  linkInserted: boolean
}

const decoder = new TextDecoder()

export function writeMigratedRaw(deps: RawWriterDeps, row: MigratedRawRow): RawWriteOutcome {
  const { db, caps, instanceId, nowMs } = deps
  const contentHash = sha256Hex(row.bytes)
  const link = {
    id: legacyId(row.occurredAtMs, `legacy-link:${row.legacyTable}:${row.legacyPk}`),
    fromType: 'raw', fromId: row.id, toType: row.legacyTable, toId: row.legacyPk,
    linkType: 'migrated_from' as const, runId: null,
  }

  const existing = db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${row.id}`)[0]
  if (existing) {
    return { inserted: false, newBlob: false, contentHash, rid: existing.rid, linkInserted: insertLink(db, link) }
  }

  const compressed = zstdCompress(row.bytes)
  const blobParam = Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength)
  db.run(sql`INSERT OR IGNORE INTO memory_blob (content_hash, shred_partition_id, compressed_blob, byte_length, ref_count)
    VALUES (${contentHash}, ${row.shredPartitionId}, ${blobParam}, ${row.bytes.byteLength}, 0)`)
  const newBlob = changes(db) === 1
  db.run(sql`UPDATE memory_blob SET ref_count = ref_count + 1
    WHERE content_hash = ${contentHash} AND shred_partition_id = ${row.shredPartitionId}`)

  const rid = allocateRid(db, 'raw', row.id, nowMs)
  const metaJson = row.meta ? JSON.stringify(row.meta) : null
  db.run(sql`INSERT INTO memory_raw (
      rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
      shred_partition_id, source_type, actor, conversation_id, project_id, project_type_id,
      occurred_at, trust_tier, dek_id, tombstoned, meta_json)
    VALUES (
      ${rid}, ${row.id}, ${contentHash}, ${instanceId}, ${row.occurredAtMs}, 0, 1, ${nowMs},
      ${row.shredPartitionId}, ${row.sourceType}, ${row.actor}, ${row.conversationId}, ${row.projectId}, ${row.projectTypeId},
      ${row.occurredAtMs}, ${row.trustTier}, NULL, 0, ${metaJson})`)

  const text = decoder.decode(row.bytes)
  if (caps.fts5) {
    db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${rid}, ${text.slice(0, RAW_FTS_CLIP_CHARS)})`)
  }

  const tag = (tagType: string, tagValue: string): void => {
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value)
      VALUES (${rid}, 'raw', ${tagType}, ${tagValue})`)
  }
  if (row.projectId) tag('project', row.projectId)
  if (row.projectTypeId) tag('project_type', row.projectTypeId)
  if (row.conversationId) tag('task', row.conversationId)
  tag('source_type', row.sourceType)
  tag('language', detectLanguage(text))
  tag('layer', 'raw')
  tag('trust_tier', row.trustTier)

  return { inserted: true, newBlob, contentHash, rid, linkInserted: insertLink(db, link) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/raw-writer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/migration/raw-writer.ts tests/modules/memory/v2/raw-writer.test.ts
git commit -m "feat(memory): idempotent L0 writer for migrated rows"
```

---

### Task 6: Migration context and the per-source migrators (messages, `LlmResponse`, episodic/archive, working memory)

**Files:**
- Create: `src/modules/memory/v2/migration/context.ts`
- Create: `src/modules/memory/v2/migration/legacy-migrate-sources.ts`
- Test: `tests/modules/memory/v2/migration-sources.test.ts`

**Interfaces:**
- Produces (context): `export interface ConversationRow { id: string; user_id: string | null; project_id: string | null; agent_id: string | null; parent_conversation_id: string | null; god_mode: number | null }`; `export interface MigrationContext extends RawWriterDeps { runId: string; vaultRoot: string; logger: Logger; counts: Record<string, number>; surprises: string[]; bump(key: string, n?: number): void; conversations: Map<string, ConversationRow>; projectTypeOf(projectId: string | null): string | null; writeRaw(row: MigratedRawRow): RawWriteOutcome; rawIdByLegacy: Map<string, string>; gistIdByVaultPath: Map<string, string>; runsByConversation: Map<string, Array<{ id: string; ms: number }>> }`; `createMigrationContext(db, opts: { caps; instanceId; runId; nowMs; vaultRoot; logger }): MigrationContext`.
- Produces (sources): `migrateConversationMessages(ctx)`, `migrateAgentEvents(ctx)`, `migrateEpisodicTables(ctx)`, `migrateWorkingMemory(ctx)` (all `void`); `export interface MigratedFactInput { id: string; rawId: string; subject: string; predicate: string; objectText: string; validFromMs: number | null; validUntilMs: number | null; confidence: number | null; trustTier: TrustTier; extractionRunId: string; presenceTier: 'hot' | 'cold'; archived: boolean; occurredAtMs: number; projectId: string | null; projectTypeId: string | null; conversationId: string | null }`; `writeMigratedFact(ctx: MigrationContext, fact: MigratedFactInput): boolean`; `LEGACY_FACT_RUN_SEED = 'legacy:episodic-facts-run'`.
- Consumes: Task 2 helpers, Task 5 writer, `effectiveProjectId` (`src/modules/memory/types.ts`), `sha256Hex` (P1b), `allocateRid` (P1a), `detectLanguage` (P1b).
- Count keys written here (read by Task 8's assertions and `eyas memory migrate` output): `raw.inserted`, `raw.skipped_existing`, `blob.inserted`, `conversation_messages.migrated`, `conversation_messages.role.<role>`, `conversation_messages.with_attachments`, `conversation_messages.orphan`, `conversation_messages.skipped_role`, `conversation_messages.skipped_empty`, `agent_events.llm_response_migrated`, `agent_events.duplicate_of_parent_skipped`, `agent_events.critic_verdict_not_migrated`, `agent_events.orphan`, `agent_events.no_content`, `episodic_memories.migrated`, `archive_memories.migrated`, `facts.inserted`, `facts.skipped_existing`, `working_memory.flushed`, `<table>.table_missing`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/migration-sources.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §14 table rows 1–3 and 7 with the spike §2 #21 corrections (ii),
// (iii), (vii), (viii).

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { ulidTimestampMs } from '@shared/crypto'
import { sha256Hex } from '@modules/memory/v2/ingest'
import { createMigrationContext, type MigrationContext } from '@modules/memory/v2/migration/context'
import {
  migrateConversationMessages, migrateAgentEvents, migrateEpisodicTables, migrateWorkingMemory,
} from '@modules/memory/v2/migration/legacy-migrate-sources'
import { openLegacyTestDb } from './fixtures/legacy-store'
import { silentLogger } from './helpers'

let db: any
let ctx: MigrationContext
const NOW = 1_800_000_000_000

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  db.run(sql`INSERT INTO project_types (id, name, created_at) VALUES ('type-a', 'A', 'x')`)
  db.run(sql`INSERT INTO projects (id, name, type_id, created_at, updated_at) VALUES ('p1', 'Apollo', 'type-a', 'x', 'x')`)
  db.run(sql`INSERT INTO conversations (id, status, user_id, project_id, mode, agent_id, god_mode, created_at, updated_at) VALUES ('c1', 'idle', 'u-owner', 'p1', 'simple', NULL, 1, 'x', 'x')`)
  db.run(sql`INSERT INTO conversations (id, status, user_id, project_id, mode, agent_id, created_at, updated_at) VALUES ('c2', 'idle', 'u-owner', 'general-general', 'simple', 'agent-2', 'x', 'x')`)
  db.run(sql`INSERT INTO conversations (id, status, user_id, project_id, mode, agent_id, parent_conversation_id, created_at, updated_at) VALUES ('child', 'idle', 'u-owner', 'p1', 'managed', 'agent-bg', 'c1', 'x', 'x')`)
  ctx = createMigrationContext(db, { caps: opened.caps, instanceId: 'inst-test', runId: 'RUN', nowMs: NOW, vaultRoot: '/nonexistent', logger: silentLogger })
})

const raws = () => db.all(sql`SELECT * FROM memory_raw ORDER BY rid`) as any[]
const tagsOf = (rid: number, type = 'raw') => Object.fromEntries((db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${rid} AND memory_type = ${type}`) as any[]).map((t) => [t.tag_type, t.tag_value]))

describe('migrateConversationMessages', () => {
  it('maps roles, actors, scope (D2), attachments, occurred_at and god-mode provenance', () => {
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, attachments, created_at) VALUES ('c1', 'user', 'first question', NULL, NULL, '["01DOC"]', '2026-08-14T18:45:53.643Z')`)
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, attachments, created_at) VALUES ('c1', 'assistant', 'first answer', 'm1', 'p1', '[]', '2026-08-14T18:45:54.000Z')`)
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, attachments, created_at) VALUES ('c2', 'assistant', 'agent answer', 'm1', 'p1', '[]', '2026-08-14T18:45:55.000Z')`)
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, attachments, created_at) VALUES ('c2', 'system', 'not a turn', NULL, NULL, '[]', '2026-08-14T18:45:56.000Z')`)
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, attachments, created_at) VALUES ('c2', 'user', '   ', NULL, NULL, '[]', '2026-08-14T18:45:57.000Z')`)
    migrateConversationMessages(ctx)
    const rows = raws()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ source_type: 'user_message', actor: 'u-owner', conversation_id: 'c1', project_id: 'p1', project_type_id: 'type-a', occurred_at: 1_786_733_153_643, trust_tier: 'owner', shred_partition_id: 'c1' })
    expect(JSON.parse(rows[0].meta_json)).toEqual({ origin: 'conversation_messages', messageId: 1, attachments: ['01DOC'], model: null, provider: null, godMode: true })
    expect(ulidTimestampMs(rows[0].id)).toBe(1_786_733_153_643)
    expect(rows[1]).toMatchObject({ source_type: 'assistant_message', actor: 'p1' })
    expect(rows[2]).toMatchObject({ source_type: 'assistant_message', actor: 'agent-2', project_id: null, project_type_id: null })
    expect(tagsOf(rows[2].rid)).toMatchObject({ task: 'c2', source_type: 'assistant_message', layer: 'raw', trust_tier: 'derived' })
    expect(tagsOf(rows[2].rid).project).toBeUndefined()
    expect(ctx.counts).toMatchObject({ 'conversation_messages.migrated': 3, 'conversation_messages.role.user': 1, 'conversation_messages.role.assistant': 2, 'conversation_messages.with_attachments': 1, 'conversation_messages.skipped_role': 1, 'conversation_messages.skipped_empty': 1, 'raw.inserted': 3 })
    expect(ctx.rawIdByLegacy.get('conversation_messages:1')).toBe(rows[0].id)
    const links = db.all(sql`SELECT to_type, to_id FROM memory_link WHERE link_type = 'migrated_from' ORDER BY to_id`) as any[]
    expect(links).toEqual([{ to_type: 'conversation_messages', to_id: '1' }, { to_type: 'conversation_messages', to_id: '2' }, { to_type: 'conversation_messages', to_id: '3' }])
  })

  it('flags an orphan conversation as a surprise but still migrates the row', () => {
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, attachments, created_at) VALUES ('ghost', 'user', 'orphan', '[]', '2026-08-14T18:45:53.643Z')`)
    migrateConversationMessages(ctx)
    expect(raws()).toHaveLength(1)
    expect(ctx.surprises[0]).toMatch(/orphan conversation ghost/)
    expect(ctx.counts['conversation_messages.orphan']).toBe(1)
  })
})

describe('migrateAgentEvents', () => {
  it('joins through agent_sessions, takes the actor from the session, skips a parent duplicate with a link, and never migrates CriticVerdict', () => {
    db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, attachments, created_at) VALUES ('c1', 'assistant', 'the same final answer', 'm1', 'p1', '[]', '2026-08-14T18:45:54.000Z')`)
    migrateConversationMessages(ctx)
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('s1', 'child', 'agent-bg', 'completed', 'x')`)
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload) VALUES ('s1', 1, 1787557527083, 'LlmResponse', NULL, ${JSON.stringify({ response: { content: 'the same final answer', stopReason: 'end', usage: { inputTokens: 1, outputTokens: 2 } } })})`)
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload) VALUES ('s1', 2, 1787557527084, 'LlmResponse', NULL, ${JSON.stringify({ response: { content: 'a genuinely new background output', stopReason: 'end', usage: { inputTokens: 3, outputTokens: 4 } } })})`)
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload) VALUES ('s1', 3, 1787557527085, 'CriticVerdict', NULL, '{"verdict":"complete"}')`)
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload) VALUES ('s1', 4, 1787557527086, 'LlmResponse', NULL, '{"response":{"content":"","stopReason":"tool_use"}}')`)
    db.run(sql`INSERT INTO agent_events (session_id, seq, ts, event_type, actor, payload) VALUES ('s-ghost', 1, 1787557527087, 'LlmResponse', NULL, '{"response":{"content":"orphan session"}}')`)
    migrateAgentEvents(ctx)

    const rows = raws()
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ source_type: 'assistant_message', actor: 'agent-bg', conversation_id: 'child', project_id: 'p1', project_type_id: 'type-a', occurred_at: 1787557527084, trust_tier: 'derived', shred_partition_id: 'child' })
    expect(JSON.parse(rows[1].meta_json)).toEqual({ origin: 'agent_events', sessionId: 's1', seq: 2, usage: { inputTokens: 3, outputTokens: 4 }, stopReason: 'end' })
    expect(ctx.counts).toMatchObject({ 'agent_events.llm_response_migrated': 1, 'agent_events.duplicate_of_parent_skipped': 1, 'agent_events.critic_verdict_not_migrated': 1, 'agent_events.no_content': 1, 'agent_events.orphan': 1 })
    // The skipped duplicate is provenance on the parent's raw row, not a second row.
    const dupLinks = db.all(sql`SELECT from_id, to_type, to_id FROM memory_link WHERE to_type = 'agent_events' ORDER BY to_id`) as any[]
    expect(dupLinks).toEqual([{ from_id: rows[0].id, to_type: 'agent_events', to_id: '1' }, { from_id: rows[1].id, to_type: 'agent_events', to_id: '2' }])
    expect(sha256Hex(new TextEncoder().encode('the same final answer'))).toBe(rows[0].content_hash)
  })
})

describe('migrateEpisodicTables + migrateWorkingMemory', () => {
  it('writes legacy_episodic raw rows, one fact each (confidence = clamped salience), a synthetic extraction run, and cold/archived facts for the archive', () => {
    db.run(sql`INSERT INTO episodic_memories (id, content, source_type, source_id, salience, valid_from, valid_until, tags, created_at, conversation_id, project_id, agent_id) VALUES ('ep-1', 'The owner prefers that you always answer in Hungarian.', 'agent-memory', 'c1', 1.7, '2026-08-14T18:45:53.643Z', NULL, '["language"]', '2026-08-14T18:45:53.643Z', 'c1', 'p1', NULL)`)
    db.run(sql`INSERT INTO archive_memories (id, original_id, content, source_type, tags, archived_at, original_created_at, agent_id) VALUES ('ar-1', 'ep-0', 'An archived memory.', 'agent-memory', '[]', '2026-08-20T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'agent-bg')`)
    db.run(sql`INSERT INTO working_memory (key, content, max_tokens, access_count, created_at, updated_at, expires_at) VALUES ('agent-bg:scratch', 'Scratchpad text.', 500, 0, '2026-08-14T18:45:53.643Z', '2026-08-14T18:50:00.000Z', '2026-08-15T18:45:53.643Z')`)
    migrateEpisodicTables(ctx)
    migrateWorkingMemory(ctx)

    const rows = raws()
    expect(rows.map((r) => r.source_type)).toEqual(['legacy_episodic', 'legacy_episodic', 'document'])
    expect(rows[0]).toMatchObject({ actor: 'legacy', conversation_id: 'c1', project_id: 'p1', trust_tier: 'derived', shred_partition_id: 'c1' })
    expect(rows[1]).toMatchObject({ actor: 'agent-bg', conversation_id: null, shred_partition_id: 'legacy:archive_memories', occurred_at: Date.parse('2026-08-01T00:00:00.000Z') })
    expect(rows[2]).toMatchObject({ actor: 'prompt-wizard', shred_partition_id: 'working_memory:agent-bg:scratch', trust_tier: 'derived', occurred_at: Date.parse('2026-08-14T18:50:00.000Z') })

    const facts = db.all(sql`SELECT * FROM memory_fact ORDER BY rid`) as any[]
    expect(facts).toHaveLength(2)
    expect(facts[0]).toMatchObject({ subject: 'note', predicate: 'states', object_text: 'The owner prefers that you always answer in Hungarian.', confidence: 1, trust_tier: 'derived', presence_tier: 'hot', archived: 0, valid_until: null, valid_from: 1_786_733_153_643 })
    expect(facts[1]).toMatchObject({ presence_tier: 'cold', archived: 1 })
    expect(ulidTimestampMs(facts[0].id)).toBe(1_786_733_153_643)
    const run = (db.all(sql`SELECT * FROM memory_run WHERE id = ${facts[0].extraction_run_id}`) as any[])[0]
    expect(run).toMatchObject({ run_type: 'extraction', status: 'ok', model_used: null })
    expect(JSON.parse(run.stats_json)).toMatchObject({ migrated: true })
    expect(facts[1].extraction_run_id).toBe(facts[0].extraction_run_id)
    expect(db.all(sql`SELECT fact_id, episode_id FROM memory_fact_source ORDER BY rowid`)).toEqual([{ fact_id: facts[0].id, episode_id: rows[0].id }, { fact_id: facts[1].id, episode_id: rows[1].id }])
    expect(tagsOf(facts[0].rid, 'fact')).toEqual({ layer: 'fact', source_type: 'legacy_episodic', trust_tier: 'derived', language: 'en', project: 'p1', project_type: 'type-a', task: 'c1' })
    const derived = db.all(sql`SELECT from_type, from_id, to_type, to_id, run_id FROM memory_link WHERE link_type = 'derived_from' ORDER BY rowid`) as any[]
    expect(derived).toEqual([
      { from_type: 'fact', from_id: facts[0].id, to_type: 'raw', to_id: rows[0].id, run_id: facts[0].extraction_run_id },
      { from_type: 'fact', from_id: facts[1].id, to_type: 'raw', to_id: rows[1].id, run_id: facts[0].extraction_run_id },
    ])
    expect(ctx.counts).toMatchObject({ 'episodic_memories.migrated': 1, 'archive_memories.migrated': 1, 'facts.inserted': 2, 'working_memory.flushed': 1 })

    // Idempotent
    migrateEpisodicTables(ctx)
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_fact`) as any[])[0].c).toBe(2)
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_run`) as any[])[0].c).toBe(1)
    expect(ctx.counts['facts.skipped_existing']).toBe(2)
  })

  it('counts a missing legacy table instead of throwing', () => {
    db.run(sql`DROP TABLE archive_memories`)
    migrateEpisodicTables(ctx)
    expect(ctx.counts['archive_memories.table_missing']).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/migration-sources.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/migration/context'`.

- [ ] **Step 3: Write the context**

```ts
// src/modules/memory/v2/migration/context.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Shared state of one migration run: counters and surprises for the report
// and the run row, board lookups (tolerant of partial schemas), the L0
// writer with bookkeeping, and the id maps later steps join on.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { writeMigratedRaw, type MigratedRawRow, type RawWriteOutcome, type RawWriterDeps } from './raw-writer.js'
import { tableExists } from './sqlite-helpers.js'

export interface ConversationRow {
  id: string
  user_id: string | null
  project_id: string | null
  agent_id: string | null
  parent_conversation_id: string | null
  god_mode: number | null
}

export interface MigrationContext extends RawWriterDeps {
  runId: string
  vaultRoot: string
  logger: Logger
  counts: Record<string, number>
  surprises: string[]
  bump(key: string, n?: number): void
  conversations: Map<string, ConversationRow>
  projectTypeOf(projectId: string | null): string | null
  writeRaw(row: MigratedRawRow): RawWriteOutcome
  /** `${legacyTable}:${legacyPk}` → migrated raw ULID. */
  rawIdByLegacy: Map<string, string>
  /** vault relative path → migrated gist ULID. */
  gistIdByVaultPath: Map<string, string>
  /** conversation id → migrated extraction runs (for note-link matching). */
  runsByConversation: Map<string, Array<{ id: string; ms: number }>>
}

export interface MigrationContextOptions {
  caps: SqliteCapabilities
  instanceId: string
  runId: string
  nowMs: number
  vaultRoot: string
  logger: Logger
}

function loadConversations(db: EyasDb): Map<string, ConversationRow> {
  const map = new Map<string, ConversationRow>()
  if (!tableExists(db, 'conversations')) return map
  let rows: ConversationRow[]
  try {
    rows = db.all<ConversationRow>(sql`SELECT id, user_id, project_id, agent_id, parent_conversation_id, god_mode FROM conversations`)
  } catch {
    rows = db.all<{ id: string; user_id: string | null; project_id: string | null }>(sql`SELECT id, user_id, project_id FROM conversations`)
      .map((r) => ({ ...r, agent_id: null, parent_conversation_id: null, god_mode: null }))
  }
  for (const r of rows) map.set(r.id, r)
  return map
}

function loadProjectTypes(db: EyasDb): Map<string, string | null> {
  const map = new Map<string, string | null>()
  if (!tableExists(db, 'projects')) return map
  try {
    for (const p of db.all<{ id: string; type_id: string | null }>(sql`SELECT id, type_id FROM projects`)) map.set(p.id, p.type_id)
  } catch {
    /* a projects table without type_id: no project types */
  }
  return map
}

export function createMigrationContext(db: EyasDb, opts: MigrationContextOptions): MigrationContext {
  const counts: Record<string, number> = {}
  const projectTypes = loadProjectTypes(db)
  const ctx: MigrationContext = {
    db,
    caps: opts.caps,
    instanceId: opts.instanceId,
    nowMs: opts.nowMs,
    runId: opts.runId,
    vaultRoot: opts.vaultRoot,
    logger: opts.logger,
    counts,
    surprises: [],
    bump(key, n = 1) { counts[key] = (counts[key] ?? 0) + n },
    conversations: loadConversations(db),
    projectTypeOf(projectId) { return projectId ? (projectTypes.get(projectId) ?? null) : null },
    rawIdByLegacy: new Map(),
    gistIdByVaultPath: new Map(),
    runsByConversation: new Map(),
    writeRaw(row) {
      const out = writeMigratedRaw(ctx, row)
      ctx.bump(out.inserted ? 'raw.inserted' : 'raw.skipped_existing')
      if (out.newBlob) ctx.bump('blob.inserted')
      ctx.rawIdByLegacy.set(`${row.legacyTable}:${row.legacyPk}`, row.id)
      return out
    },
  }
  return ctx
}
```

- [ ] **Step 4: Write the per-source migrators**

```ts
// src/modules/memory/v2/migration/legacy-migrate-sources.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §14 table: conversation_messages, agent_events LlmResponse,
// episodic/archive, working_memory. Each function is idempotent because the
// writer is (deterministic ids + INSERT OR IGNORE) and tolerant of a legacy
// table that does not exist on this install.

import { sql } from 'drizzle-orm'
import { allocateRid } from '../schema.js'
import { sha256Hex } from '../ingest.js'
import { detectLanguage } from '../language.js'
import type { TrustTier } from '../ingest-bridge.js'
import { effectiveProjectId } from '../../types.js'
import type { MigrationContext } from './context.js'
import { encodeUtf8, legacyId, toEpochMs } from './legacy-ids.js'
import { insertLegacyRun, insertLink, tableExists } from './sqlite-helpers.js'

export const LEGACY_FACT_RUN_SEED = 'legacy:episodic-facts-run'

interface MessageRow {
  id: number
  conversation_id: string
  role: string
  content: string | null
  model: string | null
  provider: string | null
  created_at: string
  attachments: string | null
}

export function migrateConversationMessages(ctx: MigrationContext): void {
  if (!tableExists(ctx.db, 'conversation_messages')) { ctx.bump('conversation_messages.table_missing'); return }
  const rows = ctx.db.all<MessageRow>(sql`SELECT id, conversation_id, role, content, model, provider, created_at, attachments
    FROM conversation_messages ORDER BY id`)
  for (const m of rows) {
    const conv = ctx.conversations.get(m.conversation_id)
    if (!conv) {
      ctx.surprises.push(`conversation_messages#${m.id}: orphan conversation ${m.conversation_id}`)
      ctx.bump('conversation_messages.orphan')
    }
    const sourceType = m.role === 'user' ? 'user_message' : m.role === 'assistant' ? 'assistant_message' : null
    if (!sourceType) {
      ctx.surprises.push(`conversation_messages#${m.id}: role ${m.role} is not a captured role`)
      ctx.bump('conversation_messages.skipped_role')
      continue
    }
    if (!m.content || !m.content.trim()) { ctx.bump('conversation_messages.skipped_empty'); continue }
    const occurredAtMs = toEpochMs(m.created_at, `conversation_messages#${m.id}`)
    let attachments: string[] = []
    try {
      const parsed = JSON.parse(m.attachments ?? '[]')
      if (Array.isArray(parsed)) attachments = parsed.map(String)
    } catch {
      ctx.surprises.push(`conversation_messages#${m.id}: attachments column is not JSON`)
    }
    if (attachments.length > 0) ctx.bump('conversation_messages.with_attachments')
    const projectId = effectiveProjectId(conv?.project_id ?? null)
    ctx.writeRaw({
      id: legacyId(occurredAtMs, `legacy:conversation_messages:${m.id}`),
      bytes: encodeUtf8(m.content),
      shredPartitionId: m.conversation_id,
      sourceType,
      actor: sourceType === 'user_message' ? (conv?.user_id ?? 'user') : (conv?.agent_id ?? m.provider ?? 'assistant'),
      conversationId: m.conversation_id,
      projectId,
      projectTypeId: ctx.projectTypeOf(projectId),
      occurredAtMs,
      // Mirrors the live hook (p1b conversations/l0-capture.ts): the owner's own
      // words are 'owner', the model's are 'derived'. Migrated history must not
      // land at a different trust than the same content captured live.
      trustTier: sourceType === 'user_message' ? 'owner' : 'derived',
      meta: { origin: 'conversation_messages', messageId: m.id, attachments, model: m.model, provider: m.provider, godMode: Number(conv?.god_mode ?? 0) === 1 },
      legacyTable: 'conversation_messages',
      legacyPk: String(m.id),
    })
    ctx.bump('conversation_messages.migrated')
    ctx.bump(`conversation_messages.role.${m.role}`)
  }
}

interface EventRow {
  id: number
  session_id: string
  seq: number
  ts: number
  payload: string
  conversation_id: string | null
  agent_id: string | null
}

/** Assistant messages of a conversation keyed by content hash → legacy message id. */
function parentAssistantHashes(ctx: MigrationContext, conversationId: string, cache: Map<string, Map<string, number>>): Map<string, number> {
  let m = cache.get(conversationId)
  if (m) return m
  m = new Map()
  const rows = ctx.db.all<{ id: number; content: string }>(sql`SELECT id, content FROM conversation_messages
    WHERE conversation_id = ${conversationId} AND role = 'assistant'`)
  for (const r of rows) m.set(sha256Hex(encodeUtf8(r.content ?? '')), r.id)
  cache.set(conversationId, m)
  return m
}

export function migrateAgentEvents(ctx: MigrationContext): void {
  if (!tableExists(ctx.db, 'agent_events')) { ctx.bump('agent_events.table_missing'); return }
  const critic = ctx.db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM agent_events WHERE event_type = 'CriticVerdict'`)[0]?.c ?? 0
  if (critic > 0) ctx.bump('agent_events.critic_verdict_not_migrated', critic)
  const rows = tableExists(ctx.db, 'agent_sessions')
    ? ctx.db.all<EventRow>(sql`SELECT e.id, e.session_id, e.seq, e.ts, e.payload, s.conversation_id, s.agent_id
        FROM agent_events e LEFT JOIN agent_sessions s ON s.id = e.session_id
        WHERE e.event_type = 'LlmResponse' ORDER BY e.id`)
    : ctx.db.all<EventRow>(sql`SELECT id, session_id, seq, ts, payload, NULL AS conversation_id, NULL AS agent_id
        FROM agent_events WHERE event_type = 'LlmResponse' ORDER BY id`)
  const hashCache = new Map<string, Map<string, number>>()
  const hasMessages = tableExists(ctx.db, 'conversation_messages')
  for (const e of rows) {
    if (!e.conversation_id) {
      ctx.surprises.push(`agent_events#${e.id}: no agent_sessions row for session ${e.session_id}`)
      ctx.bump('agent_events.orphan')
      continue
    }
    let payload: { response?: { content?: unknown; usage?: unknown; stopReason?: unknown } } = {}
    try { payload = JSON.parse(e.payload) } catch { /* handled below as no content */ }
    const content = payload?.response?.content
    if (typeof content !== 'string' || !content.trim()) { ctx.bump('agent_events.no_content'); continue }
    const occurredAtMs = toEpochMs(e.ts, `agent_events#${e.id}`)
    const child = ctx.conversations.get(e.conversation_id)
    const parentId = child?.parent_conversation_id ?? null
    if (parentId && hasMessages) {
      const dupMessageId = parentAssistantHashes(ctx, parentId, hashCache).get(sha256Hex(encodeUtf8(content)))
      if (dupMessageId !== undefined) {
        // Spike §2 #21 (ii): the parent conversation already holds these bytes.
        // Keep the provenance on the parent's raw row instead of a second row.
        const parentRawId = ctx.rawIdByLegacy.get(`conversation_messages:${dupMessageId}`)
        if (parentRawId) {
          insertLink(ctx.db, { id: legacyId(occurredAtMs, `legacy-link:agent_events:${e.id}`), fromType: 'raw', fromId: parentRawId, toType: 'agent_events', toId: String(e.id), linkType: 'migrated_from', runId: null })
        }
        ctx.bump('agent_events.duplicate_of_parent_skipped')
        continue
      }
    }
    const projectId = effectiveProjectId(child?.project_id ?? null)
    ctx.writeRaw({
      id: legacyId(occurredAtMs, `legacy:agent_events:${e.id}`),
      bytes: encodeUtf8(content),
      shredPartitionId: e.conversation_id,
      sourceType: 'assistant_message',
      actor: e.agent_id ?? child?.agent_id ?? 'agent',
      conversationId: e.conversation_id,
      projectId,
      projectTypeId: ctx.projectTypeOf(projectId),
      occurredAtMs,
      // Always model-authored, so 'derived' — same as the live event-store hook.
      trustTier: 'derived',
      meta: { origin: 'agent_events', sessionId: e.session_id, seq: e.seq, usage: payload.response?.usage ?? null, stopReason: payload.response?.stopReason ?? null },
      legacyTable: 'agent_events',
      legacyPk: String(e.id),
    })
    ctx.bump('agent_events.llm_response_migrated')
  }
}

export interface MigratedFactInput {
  id: string
  rawId: string
  subject: string
  predicate: string
  objectText: string
  validFromMs: number | null
  validUntilMs: number | null
  confidence: number | null
  trustTier: TrustTier
  extractionRunId: string
  presenceTier: 'hot' | 'cold'
  archived: boolean
  occurredAtMs: number
  projectId: string | null
  projectTypeId: string | null
  conversationId: string | null
}

/** One bi-temporal fact per legacy episodic row; returns false when it already existed. */
export function writeMigratedFact(ctx: MigrationContext, fact: MigratedFactInput): boolean {
  const { db } = ctx
  if (db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${fact.id}`).length > 0) {
    ctx.bump('facts.skipped_existing')
    return false
  }
  const rid = allocateRid(db, 'fact', fact.id, ctx.nowMs)
  db.run(sql`INSERT INTO memory_fact (
      rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
      subject, predicate, object_text, valid_from, valid_until, invalidated_by_fact_id, confidence,
      trust_tier, extraction_run_id, entity_id, decay_score, presence_tier, archived)
    VALUES (
      ${rid}, ${fact.id}, ${sha256Hex(encodeUtf8(fact.objectText))}, ${ctx.instanceId}, ${fact.occurredAtMs}, 0, 1, ${ctx.nowMs},
      ${fact.subject}, ${fact.predicate}, ${fact.objectText}, ${fact.validFromMs}, ${fact.validUntilMs}, NULL, ${fact.confidence ?? 0.5},
      ${fact.trustTier}, ${fact.extractionRunId}, NULL, 1, ${fact.presenceTier}, ${fact.archived ? 1 : 0})`)
  db.run(sql`INSERT OR IGNORE INTO memory_fact_source (fact_id, episode_id) VALUES (${fact.id}, ${fact.rawId})`)
  const tag = (t: string, v: string): void => {
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'fact', ${t}, ${v})`)
  }
  tag('layer', 'fact')
  tag('source_type', 'legacy_episodic')
  tag('trust_tier', fact.trustTier)
  tag('language', detectLanguage(fact.objectText))
  if (fact.projectId) tag('project', fact.projectId)
  if (fact.projectTypeId) tag('project_type', fact.projectTypeId)
  if (fact.conversationId) tag('task', fact.conversationId)
  insertLink(db, { id: legacyId(fact.occurredAtMs, `legacy-link:fact:${fact.id}`), fromType: 'fact', fromId: fact.id, toType: 'raw', toId: fact.rawId, linkType: 'derived_from', runId: fact.extractionRunId })
  ctx.bump('facts.inserted')
  return true
}

interface EpisodicRow {
  id: string
  content: string
  source_type: string | null
  source_id: string | null
  salience: number | null
  valid_from?: string | null
  valid_until?: string | null
  tags: string | null
  created_at?: string
  original_created_at?: string
  conversation_id?: string | null
  project_id?: string | null
  agent_id?: string | null
  access_count?: number | null
}

function clamp01(v: number | null | undefined): number | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null
  return Math.min(1, Math.max(0, v))
}

function parseJsonArray(text: string | null): unknown[] {
  if (!text) return []
  try { const v = JSON.parse(text); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function migrateEpisodicTables(ctx: MigrationContext): void {
  const sources: Array<{ table: 'episodic_memories' | 'archive_memories'; cold: boolean; rows: EpisodicRow[] }> = []
  for (const [table, cold] of [['episodic_memories', false], ['archive_memories', true]] as const) {
    if (!tableExists(ctx.db, table)) { ctx.bump(`${table}.table_missing`); continue }
    sources.push({ table, cold, rows: ctx.db.all<EpisodicRow>(sql.raw(`SELECT * FROM ${table} ORDER BY rowid`)) })
  }
  const all = sources.flatMap((s) => s.rows.map((r) => ({ ...r, table: s.table, cold: s.cold })))
  if (all.length === 0) return
  const timed = all.map((r) => ({ ...r, occurredAtMs: toEpochMs(r.cold ? r.original_created_at : r.created_at, `${r.table}:${r.id}`) }))
  // One synthetic extraction run for every legacy fact, anchored on the earliest row so re-runs reuse it.
  const runMs = Math.min(...timed.map((r) => r.occurredAtMs))
  const runId = legacyId(runMs, LEGACY_FACT_RUN_SEED)
  insertLegacyRun(ctx.db, { id: runId, runType: 'extraction', status: 'ok', modelUsed: null, createdAtMs: ctx.nowMs, statsJson: { migrated: true, legacy_tables: sources.map((s) => s.table), migration_run_id: ctx.runId } })
  for (const r of timed) {
    const projectId = effectiveProjectId(r.project_id ?? null)
    const conversationId = r.conversation_id ?? null
    const rawId = legacyId(r.occurredAtMs, `legacy:${r.table}:${r.id}`)
    ctx.writeRaw({
      id: rawId,
      bytes: encodeUtf8(r.content),
      shredPartitionId: conversationId ?? `legacy:${r.table}`,
      sourceType: 'legacy_episodic',
      actor: r.agent_id ?? 'legacy',
      conversationId,
      projectId,
      projectTypeId: ctx.projectTypeOf(projectId),
      occurredAtMs: r.occurredAtMs,
      trustTier: 'derived',
      meta: { origin: r.table, legacyId: r.id, sourceType: r.source_type ?? null, sourceId: r.source_id ?? null, tags: parseJsonArray(r.tags), salience: r.salience ?? null, accessCount: r.access_count ?? null },
      legacyTable: r.table,
      legacyPk: String(r.id),
    })
    writeMigratedFact(ctx, {
      id: legacyId(r.occurredAtMs, `legacy:${r.table}:fact:${r.id}`),
      rawId,
      subject: 'note',
      predicate: 'states',
      objectText: r.content,
      validFromMs: r.valid_from ? toEpochMs(r.valid_from, `${r.table}:${r.id} valid_from`) : r.occurredAtMs,
      validUntilMs: r.valid_until ? toEpochMs(r.valid_until, `${r.table}:${r.id} valid_until`) : null,
      confidence: clamp01(r.salience),
      trustTier: 'derived',
      extractionRunId: runId,
      presenceTier: r.cold ? 'cold' : 'hot',
      archived: r.cold,
      occurredAtMs: r.occurredAtMs,
      projectId,
      projectTypeId: ctx.projectTypeOf(projectId),
      conversationId,
    })
    ctx.bump(`${r.table}.migrated`)
  }
}

export function migrateWorkingMemory(ctx: MigrationContext): void {
  if (!tableExists(ctx.db, 'working_memory')) { ctx.bump('working_memory.table_missing'); return }
  const rows = ctx.db.all<{ key: string; content: string; updated_at: string }>(sql`SELECT key, content, updated_at FROM working_memory ORDER BY key`)
  for (const w of rows) {
    if (!w.content || !w.content.trim()) continue
    const occurredAtMs = toEpochMs(w.updated_at, `working_memory ${w.key}`)
    ctx.writeRaw({
      id: legacyId(occurredAtMs, `legacy:working_memory:${w.key}`),
      bytes: encodeUtf8(w.content),
      shredPartitionId: `working_memory:${w.key}`,
      sourceType: 'document',
      actor: 'prompt-wizard',
      conversationId: null,
      projectId: null,
      projectTypeId: null,
      occurredAtMs,
      trustTier: 'derived',
      meta: { origin: 'working_memory', key: w.key },
      legacyTable: 'working_memory',
      legacyPk: w.key,
    })
    ctx.bump('working_memory.flushed')
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/migration-sources.test.ts`
Expected: PASS (5 tests). Then `bun run lint` — no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/memory/v2/migration/context.ts src/modules/memory/v2/migration/legacy-migrate-sources.ts tests/modules/memory/v2/migration-sources.test.ts
git commit -m "feat(memory): migrate messages, background outputs, episodic/archive and working memory into v2"
```

---
### Task 7: Vault notes, capture runs, note links — and `migrateLegacy` itself

**Files:**
- Create: `src/modules/memory/v2/migration/legacy-migrate-vault.ts`
- Create: `src/modules/memory/v2/migration/legacy-migrate.ts`
- Test: `tests/modules/memory/v2/migration-vault.test.ts`

**Interfaces:**
- Produces: `listVaultMarkdown(vaultRoot): string[]`; `export interface GistWriterDeps { db: EyasDb; caps: SqliteCapabilities; instanceId: string; runId: string; nowMs: number; bump(key: string, n?: number): void }` (a `MigrationContext` satisfies it; Task 11 builds one for the rebuild); `export interface MigratedGistInput { id: string; rawId: string; derivation: VaultGistDerivation; occurredAtMs: number; language: string; sourcePath: string }`; `writeMigratedGist(deps, gist): boolean`; `migrateVaultNotes(ctx)`, `migrateCaptureRuns(ctx)`, `mapCaptureStatus(reason: string | null): 'ok'|'partial'|'failed'|'skipped'`, `migrateNoteLinks(ctx)`, `matchRun(runs: Array<{ id: string; ms: number }>, ms: number): { id: string; ms: number } | null`.
- Produces (contract): `export interface MigrationReport { runId: string; counts: Record<string, number>; surprises: string[]; durationMs: number; dryRun: boolean }`; `export interface MigrateLegacyOptions { vaultRoot: string; dryRun?: boolean; logger: Logger; caps?: SqliteCapabilities; instanceId?: string; now?: () => number }`; `migrateLegacy(db: EyasDb, opts: MigrateLegacyOptions): MigrationReport`. Callers `await initZstd()` first (the CLI does; tests do in `beforeAll`).
- Consumes: Task 3 (`deriveVaultGist`, `buildVaultDocumentUnit`, `vaultOccurredAtMs`, `isGeneratedVaultPath`), Task 6 (context + sources), `estimateTokens` (`src/modules/prompt-wizard/token-budget.ts:73`, chars ÷ 4), `recordRun` (P1a), `getInstanceId` (P1a), `getSqliteCapabilities` (P1a).
- Count keys added: `vault.migrated`, `vault.kind.<kind>`, `vault.no_frontmatter`, `vault.kind_undeclared`, `vault.not_in_vault_index`, `vault.index_without_file`, `gists.inserted`, `gists.skipped_existing`, `memory_capture_runs.migrated`, `memory_capture_runs.status.<status>`, `memory_note_links.migrated`, `memory_note_links.matched_run`, `memory_note_links.no_run`, `memory_note_links.dangling`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/migration-vault.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §14 rows 4–6 and the migration's own run row; spike §2 #21 (vi), (ix), (x).

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { sha256Hex } from '@modules/memory/v2/ingest'
import { migrateLegacy } from '@modules/memory/v2/migration/legacy-migrate'
import { mapCaptureStatus, matchRun, listVaultMarkdown } from '@modules/memory/v2/migration/legacy-migrate-vault'
import { openLegacyTestDb } from './fixtures/legacy-store'
import { silentLogger } from './helpers'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities'

const USER = `---
title: 'Owner identity'
tags: []
tier: semantic
links: []
created: '2026-08-28'
updated: '2026-08-28'
kind: user
summary: Legal entity = the owner, UK sole trader
---
Body of the user note.
`
const FEEDBACK = `---
title: 'Odoo means the fork'
tags: []
tier: procedural
links: []
created: '2026-08-28'
updated: '2026-08-28'
kind: feedback
summary: Odoo always means the Community fork.
---
Odoo refers exclusively to the Community fork.

**Why:** No Enterprise mixing.

**How to apply:** Default to the fork.
`
const REFERENCE = `---
title: 'Ref'
tags:
  - imported
  - 'source:claude-code'
  - 'import-job:01JOB'
  - odoo
tier: semantic
kind: reference
summary: >-
  # Ref heading **Client:** truncated summ
links: []
created: '2026-08-31'
updated: '2026-08-31'
---
# Ref

First paragraph of the reference note: this is what the ticket was about, and it is not a code bug.

More.
`

let db: any
let caps: SqliteCapabilities
let root: string

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  caps = opened.caps
  root = mkdtempSync(join(tmpdir(), 'eyas-migrate-vault-'))
  mkdirSync(join(root, 'semantic'), { recursive: true })
  mkdirSync(join(root, 'procedural'), { recursive: true })
  mkdirSync(join(root, 'generated'), { recursive: true })
  mkdirSync(join(root, '.obsidian'), { recursive: true })
  writeFileSync(join(root, 'semantic', 'owner.md'), USER)
  writeFileSync(join(root, 'procedural', 'odoo.md'), FEEDBACK)
  writeFileSync(join(root, 'semantic', 'ref.md'), REFERENCE)
  writeFileSync(join(root, 'generated', 'mirror.md'), USER)
  writeFileSync(join(root, '.obsidian', 'hidden.md'), USER)
  writeFileSync(join(root, 'semantic', 'notes.txt'), 'not markdown')
  db.run(sql`INSERT INTO conversations (id, status, user_id, project_id, mode, created_at, updated_at) VALUES ('c1', 'idle', 'u-owner', 'general-general', 'simple', 'x', 'x'), ('c2', 'idle', 'u-owner', NULL, 'simple', 'x', 'x')`)
  db.run(sql`INSERT INTO memory_capture_runs (id, conversation_id, notes_written, kinds, skipped_reason, created_at, provider) VALUES
    (1, 'c1', 1, '["user"]', NULL, '2026-08-27 20:25:40', 'p1/m1'),
    (2, 'c1', 0, NULL, 'error', '2026-08-27 20:26:40', 'p1/m1'),
    (3, 'c2', 0, NULL, 'too-short', '2026-08-27 20:27:40', NULL),
    (4, 'c2', 0, NULL, 'unparsable', '2026-08-27 20:28:40', 'p1/m1'),
    (5, 'c2', 0, NULL, 'rejected-shape', '2026-08-27 20:29:40', 'p1/m1')`)
  db.run(sql`INSERT INTO memory_note_links (note_path, owner_module, owner_id, source, created_at) VALUES
    ('semantic/owner.md', 'conversations', 'c1', 'capture', '2026-08-27 20:25:40'),
    ('procedural/odoo.md', 'conversations', 'c2', 'capture', '2026-08-27 20:28:20'),
    ('semantic/missing.md', 'conversations', 'c2', 'capture', '2026-08-27 20:28:20')`)
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, file_hash, indexed_at) VALUES ('semantic/gone.md', 'Gone', 'semantic', '[]', '', '1-1', 'x')`)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const migrate = (dryRun = false) => migrateLegacy(db, { vaultRoot: root, dryRun, logger: silentLogger, caps, instanceId: 'inst-test', now: () => 1_800_000_000_000 })
const count = (table: string) => (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`)) as any[])[0].c

describe('listVaultMarkdown', () => {
  it('walks markdown only, skipping dot-dirs and generated/', () => {
    expect(listVaultMarkdown(root)).toEqual(['procedural/odoo.md', 'semantic/owner.md', 'semantic/ref.md'])
  })
})

describe('mapCaptureStatus / matchRun', () => {
  it('maps the legacy skip reasons (spike §2 #21 vi)', () => {
    expect(mapCaptureStatus(null)).toBe('ok')
    expect(mapCaptureStatus('error')).toBe('failed')
    expect(mapCaptureStatus('rejected-shape')).toBe('partial')
    expect(mapCaptureStatus('too-short')).toBe('skipped')
    expect(mapCaptureStatus('unparsable')).toBe('skipped')
    expect(mapCaptureStatus('cap-reached')).toBe('skipped')
  })
  it('prefers the same second, then the nearest within 60 s, else null', () => {
    const runs = [{ id: 'a', ms: 10_000 }, { id: 'b', ms: 10_900 }, { id: 'c', ms: 70_000 }]
    expect(matchRun(runs, 10_500)?.id).toBe('a')
    expect(matchRun(runs, 12_000)?.id).toBe('b')
    expect(matchRun(runs, 40_000)?.id).toBe('b')
    expect(matchRun(runs, 200_000)).toBeNull()
  })
})

describe('migrateLegacy (vault, runs, links, own run row)', () => {
  it('writes one document row + one gist per note with §14 scope, tags and provenance', () => {
    const report = migrate()
    expect(report.dryRun).toBe(false)
    expect(report.counts).toMatchObject({ 'vault.migrated': 3, 'vault.kind.user': 1, 'vault.kind.feedback': 1, 'vault.kind.reference': 1, 'gists.inserted': 3, 'vault.index_without_file': 1 })
    const docs = db.all(sql`SELECT * FROM memory_raw WHERE source_type = 'document' ORDER BY shred_partition_id`) as any[]
    expect(docs.map((d) => d.shred_partition_id)).toEqual(['vault:procedural/odoo.md', 'vault:semantic/owner.md', 'vault:semantic/ref.md'])
    expect(docs[1]).toMatchObject({ conversation_id: 'vault:semantic/owner.md', actor: 'vault', trust_tier: 'owner', occurred_at: Date.parse('2026-08-28T00:00:00Z'), content_hash: sha256Hex(new TextEncoder().encode(USER)) })
    expect(JSON.parse(docs[1].meta_json)).toMatchObject({ origin: 'vault', path: 'semantic/owner.md', kind: 'user' })

    const gists = db.all(sql`SELECT g.*, s.child_id FROM memory_gist g JOIN memory_gist_source s ON s.gist_id = g.id ORDER BY g.scope_type, g.text`) as any[]
    expect(gists).toHaveLength(3)
    const user = gists.find((g) => g.text === 'Legal entity = the owner, UK sole trader')!
    expect(user).toMatchObject({ scope_type: 'global', scope_id: null, pinned: 1, trust_tier: 'owner', gist_source: 'heuristic', tree_depth: 0, is_current: 1, importance_score: 1, consolidation_run_id: report.runId, child_id: docs[1].id })
    expect(JSON.parse(user.changelog_json)).toEqual([{ at: Date.parse('2026-08-28T00:00:00Z'), op: 'migrated', from: 'vault:semantic/owner.md', run: report.runId }])
    const feedback = gists.find((g) => g.structured_json !== null)!
    expect(JSON.parse(feedback.structured_json)).toEqual({ why: 'No Enterprise mixing.', howToApply: 'Default to the fork.' })
    const ref = gists.find((g) => g.scope_type === 'topic')!
    expect(ref).toMatchObject({ text: 'First paragraph of the reference note: this is what the ticket was about, and it is not a code bug.', scope_id: 'semantic/ref', pinned: 0, importance_score: 0.5 })
    expect(JSON.parse(ref.changelog_json)[1]).toEqual({ op: 'imported', job: '01JOB' })
    const refTags = db.all(sql`SELECT tag_type, tag_value FROM memory_tag WHERE memory_rid = ${ref.rid} AND memory_type = 'gist' ORDER BY tag_type, tag_value`) as any[]
    expect(refTags).toEqual([
      { tag_type: 'kind', tag_value: 'reference' }, { tag_type: 'language', tag_value: 'en' }, { tag_type: 'layer', tag_value: 'gist' },
      { tag_type: 'source_type', tag_value: 'claude-code' }, { tag_type: 'topic', tag_value: 'odoo' }, { tag_type: 'trust_tier', tag_value: 'owner' },
    ])
    expect(refTags.some((t) => t.tag_value === 'imported' || t.tag_value.startsWith('import-job'))).toBe(false)
  })

  it('migrates capture runs with the status mapping and links notes to runs by same second, then ±60 s', () => {
    const report = migrate()
    const runs = db.all(sql`SELECT status, model_used, stats_json FROM memory_run WHERE run_type = 'extraction' ORDER BY json_extract(stats_json, '$.legacy_id')`) as any[]
    expect(runs.map((r) => r.status)).toEqual(['ok', 'failed', 'skipped', 'skipped', 'partial'])
    expect(runs.map((r) => r.model_used)).toEqual(['p1/m1', 'p1/m1', null, 'p1/m1', 'p1/m1'])
    expect(JSON.parse(runs[0].stats_json)).toMatchObject({ legacy_table: 'memory_capture_runs', legacy_id: 1, conversation_id: 'c1', notes_written: 1, kinds: ['user'], created_at_ms: Date.parse('2026-08-27T20:25:40Z') })
    expect(report.counts).toMatchObject({ 'memory_capture_runs.migrated': 5, 'memory_capture_runs.status.ok': 1, 'memory_capture_runs.status.failed': 1, 'memory_capture_runs.status.skipped': 2, 'memory_capture_runs.status.partial': 1 })

    const links = db.all(sql`SELECT l.to_id, l.run_id, r.stats_json FROM memory_link l LEFT JOIN memory_run r ON r.id = l.run_id WHERE l.link_type = 'derived_from' AND l.from_type = 'gist' ORDER BY l.to_id`) as any[]
    expect(links).toHaveLength(2)
    expect(JSON.parse(links[0].stats_json).legacy_id).toBe(1)                // same second as run 1
    expect(JSON.parse(links[1].stats_json).legacy_id).toBe(4)                // 20:28:20 → nearest within 60 s is run 4 (20:28:40, 20 s) over run 3 (20:27:40, 40 s)
    expect(report.counts).toMatchObject({ 'memory_note_links.migrated': 2, 'memory_note_links.matched_run': 2, 'memory_note_links.dangling': 1 })
    expect(report.surprises.some((s) => s.includes('semantic/missing.md'))).toBe(true)
  })

  it('records its own migration run and is a no-op on re-run except for that run row', () => {
    const first = migrate()
    const own = (db.all(sql`SELECT status, stats_json FROM memory_run WHERE id = ${first.runId}`) as any[])[0]
    expect(own.status).toBe('partial')                                        // the dangling note link is a surprise
    expect(JSON.parse(own.stats_json)).toMatchObject({ counts: first.counts, dry_run: false })
    const before = { raw: count('memory_raw'), gist: count('memory_gist'), tag: count('memory_tag'), link: count('memory_link'), run: count('memory_run'), item: count('memory_item'), blob: count('memory_blob') }
    const second = migrate()
    expect(second.runId).not.toBe(first.runId)
    expect({ raw: count('memory_raw'), gist: count('memory_gist'), tag: count('memory_tag'), link: count('memory_link'), item: count('memory_item'), blob: count('memory_blob') })
      .toEqual({ raw: before.raw, gist: before.gist, tag: before.tag, link: before.link, item: before.item, blob: before.blob })
    expect(count('memory_run')).toBe(before.run + 1)
    expect(second.counts['raw.skipped_existing']).toBe(before.raw)
    expect((db.all(sql`SELECT MAX(ref_count) AS m FROM memory_blob`) as any[])[0].m).toBe(1)
  })

  it('--dry-run reports the counts and leaves every table empty, including memory_run', () => {
    const report = migrate(true)
    expect(report.dryRun).toBe(true)
    expect(report.counts['vault.migrated']).toBe(3)
    for (const t of ['memory_raw', 'memory_blob', 'memory_gist', 'memory_tag', 'memory_link', 'memory_run', 'memory_item']) expect(count(t)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/migration-vault.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/migration/legacy-migrate'`.

- [ ] **Step 3: Write the vault / runs / links migrators**

```ts
// src/modules/memory/v2/migration/legacy-migrate-vault.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §14 table: vault notes → memory_raw document + depth-0 gist + tags +
// source link; memory_capture_runs → memory_run(extraction);
// memory_note_links → memory_link(derived_from) matched to a run.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { estimateTokens } from '@modules/prompt-wizard/token-budget.js'
import { allocateRid } from '../schema.js'
import { sha256Hex } from '../ingest.js'
import { detectLanguage } from '../language.js'
import { parseVaultFile } from '../../vault/frontmatter.js'
import {
  buildVaultDocumentUnit, deriveVaultGist, isGeneratedVaultPath, vaultOccurredAtMs, type VaultGistDerivation,
} from '../vault-ingest.js'
import type { MigrationContext } from './context.js'
import { encodeUtf8, legacyId, toEpochMs } from './legacy-ids.js'
import { hasColumn, insertLegacyRun, insertLink, tableExists } from './sqlite-helpers.js'

/** Relative `.md` paths under the vault, sorted; dot-directories and generated/ are skipped. */
export function listVaultMarkdown(vaultRoot: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!isGeneratedVaultPath(childRel)) walk(join(dir, e.name), childRel)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(childRel)
      }
    }
  }
  walk(vaultRoot, '')
  return out.sort()
}

export interface GistWriterDeps {
  db: EyasDb
  caps: SqliteCapabilities
  instanceId: string
  runId: string
  nowMs: number
  bump(key: string, n?: number): void
}

export interface MigratedGistInput {
  id: string
  rawId: string
  derivation: VaultGistDerivation
  occurredAtMs: number
  language: string
  sourcePath: string
}

/** Depth-0 gist for a vault note (spec §14 vault row). Returns false when it already existed. */
export function writeMigratedGist(deps: GistWriterDeps, gist: MigratedGistInput): boolean {
  const { db } = deps
  if (db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${gist.id}`).length > 0) {
    deps.bump('gists.skipped_existing')
    return false
  }
  const d = gist.derivation
  const rid = allocateRid(db, 'gist', gist.id, deps.nowMs)
  const changelog = [
    { at: gist.occurredAtMs, op: 'migrated', from: `vault:${gist.sourcePath}`, run: deps.runId },
    ...d.importJobs.map((job) => ({ op: 'imported', job })),
  ]
  db.run(sql`INSERT INTO memory_gist (
      rid, id, content_hash, origin_instance_id, hlc_physical_ms, hlc_logical, revision, created_at,
      scope_type, scope_id, tree_depth, text, structured_json, pinned, trust_tier, token_count, importance_score,
      gist_source, consolidation_run_id, is_current, decay_score, presence_tier, times_retrieved, changelog_json)
    VALUES (
      ${rid}, ${gist.id}, ${sha256Hex(encodeUtf8(d.text))}, ${deps.instanceId}, ${gist.occurredAtMs}, 0, 1, ${deps.nowMs},
      ${d.scopeType}, ${d.scopeId}, 0, ${d.text}, ${d.structuredJson}, ${d.pinned ? 1 : 0}, 'owner', ${estimateTokens(d.text)}, ${d.importance},
      'heuristic', ${deps.runId}, 1, 1, 'hot', 0, ${JSON.stringify(changelog)})`)
  db.run(sql`INSERT OR IGNORE INTO memory_gist_source (gist_id, child_type, child_id) VALUES (${gist.id}, 'raw', ${gist.rawId})`)
  const tag = (t: string, v: string): void => {
    db.run(sql`INSERT OR IGNORE INTO memory_tag (memory_rid, memory_type, tag_type, tag_value) VALUES (${rid}, 'gist', ${t}, ${v})`)
  }
  if (d.kind !== 'undeclared') tag('kind', d.kind)
  tag('layer', 'gist')
  tag('trust_tier', 'owner')
  tag('language', gist.language)
  if (d.projectId) tag('project', d.projectId)
  if (d.projectTypeId) tag('project_type', d.projectTypeId)
  for (const topic of d.topics) tag('topic', topic)
  for (const source of d.sourceTypeTags) tag('source_type', source)
  deps.bump('gists.inserted')
  return true
}

export function migrateVaultNotes(ctx: MigrationContext): void {
  const files = listVaultMarkdown(ctx.vaultRoot)
  const indexed = tableExists(ctx.db, 'vault_index')
    ? new Set(ctx.db.all<{ path: string }>(sql`SELECT path FROM vault_index`).map((r) => r.path))
    : null
  for (const rel of files) {
    const abs = join(ctx.vaultRoot, rel)
    const bytes = readFileSync(abs)
    const st = statSync(abs)
    const text = bytes.toString('utf8')
    if (!text.startsWith('---')) { ctx.surprises.push(`vault ${rel}: no frontmatter`); ctx.bump('vault.no_frontmatter') }
    const parsed = parseVaultFile(text)
    const derivation = deriveVaultGist(parsed, rel)
    ctx.surprises.push(...derivation.surprises)
    if (derivation.kind === 'undeclared') ctx.bump('vault.kind_undeclared')
    const occurredAtMs = vaultOccurredAtMs(parsed, Math.round(st.mtimeMs), rel)
    const rawId = legacyId(occurredAtMs, `legacy:vault:${rel}`)
    const unit = buildVaultDocumentUnit({ relPath: rel, bytes, id: rawId, occurredAtMs, parsed, sizeBytes: st.size, mtimeMs: st.mtimeMs })
    ctx.writeRaw({
      id: unit.id,
      bytes,
      shredPartitionId: unit.shredPartitionId ?? `vault:${rel}`,
      sourceType: 'document',
      actor: unit.actor,
      conversationId: unit.conversationId,
      projectId: unit.projectId,
      projectTypeId: unit.projectTypeId,
      occurredAtMs,
      trustTier: unit.trustTier,
      meta: unit.meta ?? null,
      legacyTable: 'vault',
      legacyPk: rel,
    })
    const gistId = legacyId(occurredAtMs, `legacy:vault_gist:${rel}`)
    writeMigratedGist(ctx, { id: gistId, rawId, derivation, occurredAtMs, language: detectLanguage(parsed.content), sourcePath: rel })
    ctx.gistIdByVaultPath.set(rel, gistId)
    if (indexed && !indexed.has(rel)) ctx.bump('vault.not_in_vault_index')
    ctx.bump('vault.migrated')
    ctx.bump(`vault.kind.${derivation.kind}`)
  }
  if (indexed) {
    const present = new Set(files)
    for (const p of indexed) {
      if (!present.has(p)) { ctx.surprises.push(`vault_index row without a file: ${p}`); ctx.bump('vault.index_without_file') }
    }
  }
}

export function mapCaptureStatus(reason: string | null): 'ok' | 'partial' | 'failed' | 'skipped' {
  if (!reason) return 'ok'
  if (reason === 'error') return 'failed'
  if (reason === 'rejected-shape') return 'partial'
  return 'skipped'
}

interface CaptureRunRow {
  id: number
  conversation_id: string
  notes_written: number | null
  kinds: string | null
  skipped_reason: string | null
  created_at: string
  provider?: string | null
}

export function migrateCaptureRuns(ctx: MigrationContext): void {
  if (!tableExists(ctx.db, 'memory_capture_runs')) { ctx.bump('memory_capture_runs.table_missing'); return }
  const withProvider = hasColumn(ctx.db, 'memory_capture_runs', 'provider')
  const rows = withProvider
    ? ctx.db.all<CaptureRunRow>(sql`SELECT id, conversation_id, notes_written, kinds, skipped_reason, created_at, provider FROM memory_capture_runs ORDER BY id`)
    : ctx.db.all<CaptureRunRow>(sql`SELECT id, conversation_id, notes_written, kinds, skipped_reason, created_at FROM memory_capture_runs ORDER BY id`)
  for (const r of rows) {
    const ms = toEpochMs(r.created_at, `memory_capture_runs#${r.id}`)
    const status = mapCaptureStatus(r.skipped_reason)
    const id = legacyId(ms, `legacy:memory_capture_runs:${r.id}`)
    let kinds: unknown = null
    if (r.kinds) { try { kinds = JSON.parse(r.kinds) } catch { kinds = r.kinds } }
    insertLegacyRun(ctx.db, {
      id, runType: 'extraction', status, conversationId: r.conversation_id, modelUsed: r.provider ?? null, createdAtMs: ms,
      statsJson: { legacy_table: 'memory_capture_runs', legacy_id: r.id, conversation_id: r.conversation_id, notes_written: r.notes_written ?? 0, kinds, skipped_reason: r.skipped_reason ?? null, created_at_ms: ms },
    })
    const list = ctx.runsByConversation.get(r.conversation_id) ?? []
    list.push({ id, ms })
    ctx.runsByConversation.set(r.conversation_id, list)
    ctx.bump('memory_capture_runs.migrated')
    ctx.bump(`memory_capture_runs.status.${status}`)
  }
}

/** Same second first (observed delta 0 s), then the nearest run within ±60 s (spike §2 #21 vi). */
export function matchRun(runs: Array<{ id: string; ms: number }>, ms: number): { id: string; ms: number } | null {
  const second = Math.floor(ms / 1000)
  const same = runs.find((r) => Math.floor(r.ms / 1000) === second)
  if (same) return same
  const near = runs
    .filter((r) => Math.abs(r.ms - ms) <= 60_000)
    .sort((a, b) => Math.abs(a.ms - ms) - Math.abs(b.ms - ms))
  return near[0] ?? null
}

export function migrateNoteLinks(ctx: MigrationContext): void {
  if (!tableExists(ctx.db, 'memory_note_links')) { ctx.bump('memory_note_links.table_missing'); return }
  const rows = ctx.db.all<{ note_path: string; owner_module: string; owner_id: string; source: string; created_at: string }>(
    sql`SELECT note_path, owner_module, owner_id, source, created_at FROM memory_note_links ORDER BY note_path, owner_module, owner_id`,
  )
  for (const l of rows) {
    const gistId = ctx.gistIdByVaultPath.get(l.note_path)
    if (!gistId) {
      ctx.surprises.push(`memory_note_links: note ${l.note_path} has no vault file (dangling)`)
      ctx.bump('memory_note_links.dangling')
      continue
    }
    const ms = toEpochMs(l.created_at, `memory_note_links ${l.note_path}`)
    const run = matchRun(ctx.runsByConversation.get(l.owner_id) ?? [], ms)
    insertLink(ctx.db, {
      id: legacyId(ms, `legacy:memory_note_links:${l.note_path}|${l.owner_module}|${l.owner_id}`),
      fromType: 'gist', fromId: gistId,
      toType: l.owner_module === 'conversations' ? 'conversation' : l.owner_module, toId: l.owner_id,
      linkType: 'derived_from', runId: run?.id ?? null,
    })
    ctx.bump(run ? 'memory_note_links.matched_run' : 'memory_note_links.no_run')
    ctx.bump('memory_note_links.migrated')
  }
}
```

- [ ] **Step 4: Write the orchestrator**

```ts
// src/modules/memory/v2/migration/legacy-migrate.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas memory migrate` — spec §14. One transaction, one memory_run
// (run_type='migration') carrying counts and surprises in stats_json,
// idempotent by construction (deterministic ids + INSERT OR IGNORE); --dry-run
// runs everything and rolls back, so the report is exact.
//
// Order matters only for the two joins: messages before agent_events (the
// parent-duplicate link needs the parent's raw id) and vault notes + capture
// runs before note links (gist id and run match).

import { performance } from 'node:perf_hooks'
import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { getSqliteCapabilities, type SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { recordRun } from '../runs.js'
import { getInstanceId } from '../instance.js'
import { createMigrationContext } from './context.js'
import { migrateAgentEvents, migrateConversationMessages, migrateEpisodicTables, migrateWorkingMemory } from './legacy-migrate-sources.js'
import { migrateCaptureRuns, migrateNoteLinks, migrateVaultNotes } from './legacy-migrate-vault.js'

export interface MigrationReport {
  runId: string
  counts: Record<string, number>
  surprises: string[]
  durationMs: number
  dryRun: boolean
}

export interface MigrateLegacyOptions {
  vaultRoot: string
  dryRun?: boolean
  logger: Logger
  /** Defaults to the main connection's cached probe (p1a). Tests pass their own. */
  caps?: SqliteCapabilities
  instanceId?: string
  now?: () => number
}

const PARTIAL_MARKERS = /orphan|dangling|no frontmatter/

export function migrateLegacy(db: EyasDb, opts: MigrateLegacyOptions): MigrationReport {
  const t0 = performance.now()
  const nowMs = opts.now?.() ?? Date.now()
  const caps = opts.caps ?? getSqliteCapabilities()
  const instanceId = opts.instanceId ?? getInstanceId(db)
  const dryRun = opts.dryRun === true

  db.run(sql`BEGIN IMMEDIATE`)
  try {
    const runId = recordRun(db, { runType: 'migration', status: 'failed', statsJson: { phase: 'started', dry_run: dryRun } })
    const ctx = createMigrationContext(db, { caps, instanceId, runId, nowMs, vaultRoot: opts.vaultRoot, logger: opts.logger })

    migrateConversationMessages(ctx)
    migrateAgentEvents(ctx)
    migrateEpisodicTables(ctx)
    migrateWorkingMemory(ctx)
    migrateVaultNotes(ctx)
    migrateCaptureRuns(ctx)
    migrateNoteLinks(ctx)

    const durationMs = Math.round(performance.now() - t0)
    const status = ctx.surprises.some((s) => PARTIAL_MARKERS.test(s)) ? 'partial' : 'ok'
    db.run(sql`UPDATE memory_run SET status = ${status},
      stats_json = ${JSON.stringify({ counts: ctx.counts, surprises: ctx.surprises, duration_ms: durationMs, dry_run: dryRun })}
      WHERE id = ${runId}`)

    if (dryRun) db.run(sql`ROLLBACK`)
    else db.run(sql`COMMIT`)

    opts.logger.info({ runId, status, dryRun, durationMs, surprises: ctx.surprises.length, rawInserted: ctx.counts['raw.inserted'] ?? 0 }, 'memory migration finished')
    return { runId, counts: ctx.counts, surprises: ctx.surprises, durationMs, dryRun }
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* the transaction may already be gone */ }
    opts.logger.error({ err }, 'memory migration failed; nothing was written')
    throw err
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/migration-vault.test.ts`
Expected: PASS (7 tests). Then `bun run lint` — no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/memory/v2/migration/legacy-migrate-vault.ts src/modules/memory/v2/migration/legacy-migrate.ts tests/modules/memory/v2/migration-vault.test.ts
git commit -m "feat(memory): migrate vault notes, capture runs and note links; eyas memory migrate core"
```

---

### Task 8: Acceptance on the spike-shaped fixture (counts, 20 hash spot-checks, fidelity, idempotency)

**Files:**
- Test: `tests/modules/memory/v2/migration-acceptance.test.ts`

**Interfaces:**
- Consumes: Tasks 4 and 7; `ulidTimestampMs` (P1a); `zstdDecompress` (P1a); `sha256Hex` (P1b).
- This is the port of the spike's `verify.ts` (spike §5): counts per source; 20 hash spot-checks (zstd-decompress → SHA-256 = `content_hash` = SHA-256 of the source); `occurred_at` fidelity for every row; ULID timestamp = `occurred_at`; run twice → identical data counts + one migration run row; `datetime('now')` → UTC; `LlmResponse` duplicates of the parent skipped; vault hash = SHA-256 of the file bytes.

- [ ] **Step 1: Write the acceptance test**

```ts
// tests/modules/memory/v2/migration-acceptance.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §15 Phase 1 acceptance: "migration counts and hashes match; migration
// re-run is a no-op; datetime('now') timestamps land at UTC". Port of the
// Phase 0 spike's verify.ts onto the fixture of Task 4.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd, zstdDecompress } from '@shared/zstd'
import { ulidTimestampMs } from '@shared/crypto'
import { sha256Hex } from '@modules/memory/v2/ingest'
import { migrateLegacy, type MigrationReport } from '@modules/memory/v2/migration/legacy-migrate'
import { toEpochMs } from '@modules/memory/v2/migration/legacy-ids'
import { openLegacyTestDb, seedLegacyStore, type LegacyFixture } from './fixtures/legacy-store'
import { silentLogger } from './helpers'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities'

let db: any
let caps: SqliteCapabilities
let root: string
let fx: LegacyFixture

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  caps = opened.caps
  root = mkdtempSync(join(tmpdir(), 'eyas-migration-acceptance-'))
  fx = seedLegacyStore(db, root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const migrate = (): MigrationReport => migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
const count = (table: string, where = '1=1') => (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)) as any[])[0].c

/** Source bytes + timestamp of a migrated raw row, found through its migrated_from link. */
function sourceOf(rawId: string): { table: string; bytes: Uint8Array; ts: unknown } {
  const links = db.all(sql`SELECT to_type, to_id FROM memory_link WHERE from_type = 'raw' AND from_id = ${rawId} AND link_type = 'migrated_from' ORDER BY to_type`) as any[]
  const l = links.find((x) => x.to_type !== 'agent_events' || links.length === 1) ?? links[0]
  const enc = (s: string) => new TextEncoder().encode(s)
  switch (l.to_type) {
    case 'conversation_messages': { const r = (db.all(sql`SELECT content, created_at FROM conversation_messages WHERE id = ${Number(l.to_id)}`) as any[])[0]; return { table: l.to_type, bytes: enc(r.content), ts: r.created_at } }
    case 'agent_events': { const r = (db.all(sql`SELECT payload, ts FROM agent_events WHERE id = ${Number(l.to_id)}`) as any[])[0]; return { table: l.to_type, bytes: enc(JSON.parse(r.payload).response.content), ts: r.ts } }
    case 'episodic_memories': { const r = (db.all(sql`SELECT content, created_at FROM episodic_memories WHERE id = ${l.to_id}`) as any[])[0]; return { table: l.to_type, bytes: enc(r.content), ts: r.created_at } }
    case 'archive_memories': { const r = (db.all(sql`SELECT content, original_created_at FROM archive_memories WHERE id = ${l.to_id}`) as any[])[0]; return { table: l.to_type, bytes: enc(r.content), ts: r.original_created_at } }
    case 'working_memory': { const r = (db.all(sql`SELECT content, updated_at FROM working_memory WHERE key = ${l.to_id}`) as any[])[0]; return { table: l.to_type, bytes: enc(r.content), ts: r.updated_at } }
    case 'vault': { const bytes = readFileSync(join(root, l.to_id)); const m = /^created: '?(\d{4}-\d{2}-\d{2})'?/m.exec(bytes.toString('utf8')); return { table: 'vault', bytes, ts: m![1] } }
    default: throw new Error(`unknown legacy source ${l.to_type}`)
  }
}

describe('migration acceptance (spike §3.9 shape)', () => {
  it('migrates every source with the expected counts', () => {
    const report = migrate()
    const e = fx.expected
    expect(report.counts).toMatchObject({
      'conversation_messages.migrated': e.messages,
      'conversation_messages.role.user': e.userMessages,
      'conversation_messages.role.assistant': e.assistantMessages,
      'conversation_messages.with_attachments': e.messagesWithAttachments,
      'agent_events.llm_response_migrated': e.llmResponses - e.llmResponseParentDuplicates,
      'agent_events.duplicate_of_parent_skipped': e.llmResponseParentDuplicates,
      'agent_events.critic_verdict_not_migrated': e.criticVerdicts,
      'episodic_memories.migrated': e.episodic,
      'archive_memories.migrated': e.archive,
      'working_memory.flushed': e.working,
      'vault.migrated': e.vaultNotes,
      'vault.kind.reference': e.vaultReference,
      'vault.kind.user': e.vaultUser,
      'vault.kind.feedback': e.vaultFeedback,
      'gists.inserted': e.vaultNotes,
      'facts.inserted': e.episodic + e.archive,
      'memory_capture_runs.migrated': e.captureRuns,
      'memory_capture_runs.status.ok': e.captureRunsOk,
      'memory_capture_runs.status.skipped': e.captureRunsSkipped,
      'memory_capture_runs.status.failed': e.captureRunsFailed,
      'memory_note_links.migrated': e.noteLinks,
      'memory_note_links.matched_run': e.noteLinks,
      'raw.inserted': e.rawRows,
    })
    expect(count('memory_raw')).toBe(e.rawRows)
    expect(count('memory_blob')).toBe(e.rawRows)                              // no within-partition duplicate in the fixture
    expect((db.all(sql`SELECT COUNT(DISTINCT content_hash) AS c FROM memory_raw`) as any[])[0].c).toBe(e.distinctRawHashes)
    expect(count('memory_gist')).toBe(e.vaultNotes)
    expect(count('memory_gist_source')).toBe(e.vaultNotes)
    expect(count('memory_fact')).toBe(e.episodic + e.archive)
    expect(count('memory_link', "link_type = 'migrated_from'")).toBe(e.rawRows + e.llmResponseParentDuplicates)
    expect(count('memory_link', "link_type = 'derived_from'")).toBe(e.noteLinks + e.episodic + e.archive)
    expect(count('memory_run', "run_type = 'extraction'")).toBe(e.captureRuns + 1)
    expect(count('memory_run', "run_type = 'migration'")).toBe(1)
    expect(count('memory_tag', "tag_type = 'layer' AND tag_value = 'raw'")).toBe(e.rawRows)
    expect(count('memory_tag', "tag_type = 'layer' AND tag_value = 'gist'")).toBe(e.vaultNotes)
    expect(count('memory_tag', "tag_type = 'kind'")).toBe(e.vaultNotes)
    expect(count('memory_tag', "tag_type = 'topic'")).toBe(0)                 // imported / import-job / source:* are provenance, not topics
    expect(count('memory_tag', "tag_type = 'source_type' AND tag_value = 'claude-code'")).toBe(e.vaultReference)
    expect(count('memory_raw', "project_id = 'general-general'")).toBe(0)     // D2
    expect(count('memory_raw', "project_id = 'eyas-system' AND project_type_id = 'eyas' AND source_type IN ('user_message', 'assistant_message')")).toBe(9)
    expect(count('memory_raw', "source_type = 'document' AND conversation_id LIKE 'vault:%'")).toBe(e.vaultNotes)
    expect(report.surprises).toEqual([])
  })

  it('20 hash spot-checks: blob → SHA-256 = content_hash = SHA-256(source); occurred_at = source time', () => {
    migrate()
    const picks = db.all(sql`SELECT id, content_hash, shred_partition_id, occurred_at FROM memory_raw ORDER BY substr(content_hash, 1, 8) LIMIT 20`) as any[]
    expect(picks).toHaveLength(20)
    const tables = new Set<string>()
    for (const p of picks) {
      const blob = (db.all(sql`SELECT compressed_blob, byte_length FROM memory_blob WHERE content_hash = ${p.content_hash} AND shred_partition_id = ${p.shred_partition_id}`) as any[])[0]
      const plain = zstdDecompress(new Uint8Array(blob.compressed_blob))
      const src = sourceOf(p.id)
      tables.add(src.table)
      expect(plain.byteLength).toBe(blob.byte_length)
      expect(sha256Hex(plain)).toBe(p.content_hash)
      expect(sha256Hex(src.bytes)).toBe(p.content_hash)
      expect(toEpochMs(src.ts, src.table)).toBe(p.occurred_at)
    }
    expect(tables.size).toBeGreaterThanOrEqual(2)
  })

  it('occurred_at fidelity and ULID timestamp on every raw row, every migrated run and every gist', () => {
    migrate()
    const rows = db.all(sql`SELECT id, occurred_at, hlc_physical_ms FROM memory_raw`) as any[]
    expect(rows).toHaveLength(fx.expected.rawRows)
    for (const r of rows) {
      expect(ulidTimestampMs(r.id)).toBe(r.occurred_at)
      expect(r.hlc_physical_ms).toBe(r.occurred_at)
      expect(toEpochMs(sourceOf(r.id).ts, 'src')).toBe(r.occurred_at)
    }
    const runs = db.all(sql`SELECT id, json_extract(stats_json, '$.legacy_id') AS lid, json_extract(stats_json, '$.created_at_ms') AS ms FROM memory_run WHERE json_extract(stats_json, '$.legacy_table') = 'memory_capture_runs'`) as any[]
    expect(runs).toHaveLength(15)
    for (const r of runs) {
      const legacy = (db.all(sql`SELECT created_at FROM memory_capture_runs WHERE id = ${r.lid}`) as any[])[0].created_at
      expect(r.ms).toBe(Date.parse(`${legacy.replace(' ', 'T')}Z`))            // datetime('now') text parsed as UTC
      expect(ulidTimestampMs(r.id)).toBe(r.ms)
    }
    for (const g of db.all(sql`SELECT id, hlc_physical_ms FROM memory_gist`) as any[]) expect(ulidTimestampMs(g.id)).toBe(g.hlc_physical_ms)
  })

  it('skips the three LlmResponse duplicates of parent assistant messages and links them to the parent row', () => {
    migrate()
    for (const id of fx.duplicateEventIds) {
      expect(count('memory_link', `to_type = 'agent_events' AND to_id = '${id}'`)).toBe(1)
      const link = (db.all(sql`SELECT from_id FROM memory_link WHERE to_type = 'agent_events' AND to_id = ${String(id)}`) as any[])[0]
      const raw = (db.all(sql`SELECT source_type, meta_json FROM memory_raw WHERE id = ${link.from_id}`) as any[])[0]
      expect(raw.source_type).toBe('assistant_message')
      expect(JSON.parse(raw.meta_json).origin).toBe('conversation_messages')
    }
    expect(count('memory_raw', "json_extract(meta_json, '$.origin') = 'agent_events'")).toBe(fx.expected.llmResponses - fx.expected.llmResponseParentDuplicates)
  })

  it('vault documents carry the SHA-256 of the file bytes and gists follow the kind mapping', () => {
    migrate()
    const user = (db.all(sql`SELECT content_hash, occurred_at FROM memory_raw WHERE shred_partition_id = ${`vault:${fx.userNotePath}`}`) as any[])[0]
    expect(user.content_hash).toBe(sha256Hex(readFileSync(join(root, fx.userNotePath))))
    expect(user.occurred_at).toBe(Date.parse('2026-08-28T00:00:00Z'))
    expect(count('memory_gist', "scope_type = 'global' AND pinned = 1")).toBe(2)
    expect(count('memory_gist', "scope_type = 'topic' AND pinned = 0")).toBe(fx.expected.vaultReference)
    expect(count('memory_gist', "structured_json IS NOT NULL")).toBe(1)
    expect(count('memory_gist', "text LIKE '#%'")).toBe(0)
    expect(count('memory_gist', "text LIKE '**Client:** Fixture client%'")).toBe(fx.expected.vaultReference)
  })

  it('run twice → identical data counts, one more migration run row, no ref_count above 1', () => {
    migrate()
    const snapshot = () => Object.fromEntries(['memory_item', 'memory_raw', 'memory_blob', 'memory_fact', 'memory_fact_source', 'memory_gist', 'memory_gist_source', 'memory_tag', 'memory_link'].map((t) => [t, count(t)]))
    const before = snapshot()
    const runsBefore = count('memory_run')
    const second = migrate()
    expect(snapshot()).toEqual(before)
    expect(count('memory_run')).toBe(runsBefore + 1)
    expect(second.counts['raw.skipped_existing']).toBe(fx.expected.rawRows)
    expect(second.counts['gists.skipped_existing']).toBe(fx.expected.vaultNotes)
    expect(second.counts['raw.inserted']).toBeUndefined()
    expect((db.all(sql`SELECT MAX(ref_count) AS m FROM memory_blob`) as any[])[0].m).toBe(1)
  })
})
```

- [ ] **Step 2: Run it**

Run: `bun vitest run tests/modules/memory/v2/migration-acceptance.test.ts`
Expected: PASS (6 tests). If `count('memory_tag', "tag_type = 'topic'")` is not 0, the fixture frontmatter tags leaked into topics — check `deriveVaultGist` (Task 3), not the fixture.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/memory/v2/migration-acceptance.test.ts
git commit -m "test(memory): migration acceptance — counts, hash spot-checks, fidelity, idempotency"
```

---
### Task 9: `undoMigration` — remove only what the migration wrote

**Files:**
- Modify: `src/modules/memory/v2/migration/legacy-migrate.ts` (append `undoMigration`, add imports)
- Test: `tests/modules/memory/v2/migration-undo.test.ts`

**Interfaces:**
- Produces (contract): `undoMigration(db: EyasDb): { removed: Record<string, number> }` — keys `memory_raw_fts`, `memory_blob`, `memory_tag`, `memory_fact_source`, `memory_gist_source`, `memory_fact`, `memory_gist`, `memory_raw`, `memory_link`, `memory_item`, `memory_run`.
- Selection rule (spec §14 "drops only … `migrated_from` links"): raw rows = `from_id` of every `migrated_from` link; facts = `extraction_run_id` in a migration-created run **or** sourced from a migrated raw row; gists = `consolidation_run_id` in a migration run **or** sourced from a migrated raw row; runs = `run_type='migration'` or `stats_json.legacy_table='memory_capture_runs'` or `stats_json.migrated=1`. Rows the live ingest wrote are untouched. Legacy tables and vault files are never touched. A contentless FTS5 table needs the original body to delete a row, so each blob is decompressed once (callers `await initZstd()` first — the CLI does).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/migration-undo.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { generateId } from '@shared/crypto'
import { createMemoryIngest } from '@modules/memory/v2/ingest'
import { migrateLegacy, undoMigration } from '@modules/memory/v2/migration/legacy-migrate'
import { openLegacyTestDb, seedLegacyStore } from './fixtures/legacy-store'
import { silentLogger, testIngestConfig } from './helpers'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities'

let db: any
let caps: SqliteCapabilities
let root: string

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  caps = opened.caps
  root = mkdtempSync(join(tmpdir(), 'eyas-migration-undo-'))
  seedLegacyStore(db, root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const count = (table: string, where = '1=1') => (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)) as any[])[0].c
const LEGACY = ['conversations', 'conversation_messages', 'agent_sessions', 'agent_events', 'episodic_memories', 'archive_memories', 'working_memory', 'vault_index', 'memory_capture_runs', 'memory_note_links']
const legacySnapshot = () => Object.fromEntries(LEGACY.map((t) => [t, count(t)]))

describe('undoMigration', () => {
  it('removes every migrated row and nothing else; legacy tables and vault files stay intact', () => {
    migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
    const legacyBefore = legacySnapshot()
    const filesBefore = readdirSync(join(root, 'semantic')).length

    // A row the LIVE path wrote (p1b ingest) must survive the undo.
    const ingest = createMemoryIngest({ db, caps, config: () => testIngestConfig, instanceId: 'inst-test', logger: silentLogger })
    const liveId = generateId()
    ingest.enqueue({ id: liveId, sourceType: 'user_message', actor: 'u-owner', conversationId: 'c-live', projectId: null, projectTypeId: null, occurredAtMs: Date.now(), content: 'a live message after cutover, unmistakably fresh', trustTier: 'owner' })
    ingest.flushConversation('c-live', 'manual')
    expect(count('memory_raw')).toBeGreaterThan(300)

    const { removed } = undoMigration(db)

    expect(count('memory_raw')).toBe(1)
    expect((db.all(sql`SELECT id FROM memory_raw`) as any[])[0].id).toBe(liveId)
    expect(count('memory_item')).toBe(1)
    expect(count('memory_blob')).toBe(1)
    expect(count('memory_tag')).toBe(count('memory_tag', "memory_type = 'raw'"))
    expect(count('memory_gist')).toBe(0)
    expect(count('memory_gist_source')).toBe(0)
    expect(count('memory_fact')).toBe(0)
    expect(count('memory_fact_source')).toBe(0)
    expect(count('memory_link')).toBe(0)
    expect(count('memory_run')).toBe(0)
    if (caps.fts5) {
      expect((db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'unmistakably'`) as any[])).toHaveLength(1)
      expect((db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH 'előleg'`) as any[])).toHaveLength(0)
    }
    expect(removed).toMatchObject({ memory_raw: 337, memory_gist: 266, memory_fact: 3, memory_run: 17 })
    expect(removed.memory_link).toBeGreaterThan(337)

    expect(legacySnapshot()).toEqual(legacyBefore)
    expect(readdirSync(join(root, 'semantic')).length).toBe(filesBefore)
  })

  it('is safe to run twice and on an empty store', () => {
    expect(undoMigration(db).removed.memory_raw ?? 0).toBe(0)
    migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
    undoMigration(db)
    expect(undoMigration(db).removed.memory_raw ?? 0).toBe(0)
    // And a migration after an undo is a full first run again.
    const report = migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
    expect(report.counts['raw.inserted']).toBe(337)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/migration-undo.test.ts`
Expected: FAIL — `undoMigration is not a function` (or not exported).

- [ ] **Step 3: Append `undoMigration` to `legacy-migrate.ts`**

Add to the import block of `src/modules/memory/v2/migration/legacy-migrate.ts`:

```ts
import { zstdDecompress } from '@shared/zstd.js'
import { RAW_FTS_CLIP_CHARS } from '../ingest.js'
import { changes, tableExists } from './sqlite-helpers.js'
```

and append at the end of the file:

```ts
/**
 * `eyas memory migrate --undo`. Removes only rows reachable from the
 * migration: raw rows behind a `migrated_from` link, the facts/gists/links
 * derived from them or from a migration-created run, and those runs. Live
 * rows, legacy tables and vault files are untouched.
 */
export function undoMigration(db: EyasDb): { removed: Record<string, number> } {
  const removed: Record<string, number> = {}
  const rec = (key: string, n: number): void => { removed[key] = (removed[key] ?? 0) + n }
  const hasFts = tableExists(db, 'memory_raw_fts')
  const decoder = new TextDecoder()

  db.run(sql`BEGIN IMMEDIATE`)
  try {
    db.run(sql`CREATE TEMP TABLE IF NOT EXISTS undo_raw (id TEXT PRIMARY KEY, rid INTEGER NOT NULL, content_hash TEXT NOT NULL, shred_partition_id TEXT NOT NULL)`)
    db.run(sql`CREATE TEMP TABLE IF NOT EXISTS undo_fact (id TEXT PRIMARY KEY, rid INTEGER NOT NULL)`)
    db.run(sql`CREATE TEMP TABLE IF NOT EXISTS undo_gist (id TEXT PRIMARY KEY, rid INTEGER NOT NULL)`)
    db.run(sql`CREATE TEMP TABLE IF NOT EXISTS undo_run (id TEXT PRIMARY KEY)`)
    for (const t of ['undo_raw', 'undo_fact', 'undo_gist', 'undo_run']) db.run(sql.raw(`DELETE FROM ${t}`))

    db.run(sql`INSERT INTO undo_raw (id, rid, content_hash, shred_partition_id)
      SELECT r.id, r.rid, r.content_hash, r.shred_partition_id FROM memory_raw r
      WHERE r.id IN (SELECT from_id FROM memory_link WHERE link_type = 'migrated_from' AND from_type = 'raw')`)
    db.run(sql`INSERT INTO undo_run (id) SELECT id FROM memory_run
      WHERE run_type = 'migration'
         OR json_extract(stats_json, '$.legacy_table') = 'memory_capture_runs'
         OR json_extract(stats_json, '$.migrated') = 1`)
    db.run(sql`INSERT INTO undo_fact (id, rid) SELECT f.id, f.rid FROM memory_fact f
      WHERE f.extraction_run_id IN (SELECT id FROM undo_run)
         OR f.id IN (SELECT fact_id FROM memory_fact_source WHERE episode_id IN (SELECT id FROM undo_raw))`)
    db.run(sql`INSERT INTO undo_gist (id, rid) SELECT g.id, g.rid FROM memory_gist g
      WHERE g.consolidation_run_id IN (SELECT id FROM undo_run)
         OR g.id IN (SELECT gist_id FROM memory_gist_source WHERE child_type = 'raw' AND child_id IN (SELECT id FROM undo_raw))`)

    if (hasFts) {
      // Contentless FTS5: a delete must repeat the indexed body.
      const rows = db.all<{ rid: number; compressed_blob: Uint8Array }>(sql`SELECT u.rid, b.compressed_blob FROM undo_raw u
        JOIN memory_blob b ON b.content_hash = u.content_hash AND b.shred_partition_id = u.shred_partition_id`)
      for (const r of rows) {
        const body = decoder.decode(zstdDecompress(new Uint8Array(r.compressed_blob))).slice(0, RAW_FTS_CLIP_CHARS)
        db.run(sql`INSERT INTO memory_raw_fts (memory_raw_fts, rowid, body) VALUES ('delete', ${r.rid}, ${body})`)
      }
      rec('memory_raw_fts', rows.length)
    }

    db.run(sql`UPDATE memory_blob SET ref_count = ref_count - (
        SELECT COUNT(*) FROM undo_raw u WHERE u.content_hash = memory_blob.content_hash AND u.shred_partition_id = memory_blob.shred_partition_id)
      WHERE EXISTS (SELECT 1 FROM undo_raw u WHERE u.content_hash = memory_blob.content_hash AND u.shred_partition_id = memory_blob.shred_partition_id)`)
    db.run(sql`DELETE FROM memory_blob WHERE ref_count <= 0`)
    rec('memory_blob', changes(db))

    db.run(sql`DELETE FROM memory_tag
      WHERE (memory_type = 'raw' AND memory_rid IN (SELECT rid FROM undo_raw))
         OR (memory_type = 'fact' AND memory_rid IN (SELECT rid FROM undo_fact))
         OR (memory_type = 'gist' AND memory_rid IN (SELECT rid FROM undo_gist))`)
    rec('memory_tag', changes(db))
    db.run(sql`DELETE FROM memory_fact_source WHERE fact_id IN (SELECT id FROM undo_fact)`)
    rec('memory_fact_source', changes(db))
    db.run(sql`DELETE FROM memory_gist_source WHERE gist_id IN (SELECT id FROM undo_gist)`)
    rec('memory_gist_source', changes(db))
    db.run(sql`DELETE FROM memory_fact WHERE id IN (SELECT id FROM undo_fact)`)
    rec('memory_fact', changes(db))
    db.run(sql`DELETE FROM memory_gist WHERE id IN (SELECT id FROM undo_gist)`)
    rec('memory_gist', changes(db))
    db.run(sql`DELETE FROM memory_raw WHERE id IN (SELECT id FROM undo_raw)`)
    rec('memory_raw', changes(db))
    db.run(sql`DELETE FROM memory_link
      WHERE link_type = 'migrated_from'
         OR from_id IN (SELECT id FROM undo_raw) OR from_id IN (SELECT id FROM undo_fact) OR from_id IN (SELECT id FROM undo_gist)
         OR to_id IN (SELECT id FROM undo_raw)
         OR run_id IN (SELECT id FROM undo_run)`)
    rec('memory_link', changes(db))
    db.run(sql`DELETE FROM memory_item
      WHERE id IN (SELECT id FROM undo_raw) OR id IN (SELECT id FROM undo_fact) OR id IN (SELECT id FROM undo_gist)`)
    rec('memory_item', changes(db))
    db.run(sql`DELETE FROM memory_run WHERE id IN (SELECT id FROM undo_run)`)
    rec('memory_run', changes(db))

    for (const t of ['undo_raw', 'undo_fact', 'undo_gist', 'undo_run']) db.run(sql.raw(`DROP TABLE IF EXISTS ${t}`))
    db.run(sql`COMMIT`)
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* already rolled back */ }
    throw err
  }
  return { removed }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/migration-undo.test.ts tests/modules/memory/v2/migration-vault.test.ts`
Expected: PASS (2 + 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/migration/legacy-migrate.ts tests/modules/memory/v2/migration-undo.test.ts
git commit -m "feat(memory): eyas memory migrate --undo removes only migrated rows"
```

---

### Task 10: `rebuildIndex` — L3 from stored data (FTS from blobs, vec0 from `memory_embedding`)

**Files:**
- Create: `src/modules/memory/v2/migration/rebuild.ts`
- Test: `tests/modules/memory/v2/rebuild-index.test.ts`

**Interfaces:**
- Produces (contract): `rebuildIndex(db: EyasDb, caps: SqliteCapabilities): { ftsRows: number; vecRows: number }`. Extras: `partitionKeyFor(db, ownerType: string, ownerId: string): number` (vec0 partition = 0 for global, else the small integer P1a's `memory_partition_key` table holds for the project — `scope_type='project'`, `AUTOINCREMENT` from 1 so `0` stays global; Phase 2's embedder and KNN read the same rows), `projectKey(db, projectId): number` (allocates the row on demand with `INSERT OR IGNORE` + `SELECT`; the **only** partition-key allocator, no parallel counter in `memory_meta`).
- Consumes: `createMemoryV2Tables` (P1a — recreates a dropped virtual table idempotently), `memory_partition_key` (P1a Task 7), `zstdDecompress` (P1a), `RAW_FTS_CLIP_CHARS` (P1b), `memory_embedding.vector` (int8 blob) with `live_in_index = 1`; the `vec_int8(?)` binding (spike §2 #5, #9).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/rebuild-index.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §4 L3: "fully rebuildable projection — eyas memory rebuild-index is a tested command".

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { allocateRid } from '@modules/memory/v2/schema'
import { migrateLegacy } from '@modules/memory/v2/migration/legacy-migrate'
import { rebuildIndex, partitionKeyFor, projectKey } from '@modules/memory/v2/migration/rebuild'
import { openLegacyTestDb, seedLegacyStore } from './fixtures/legacy-store'
import { silentLogger } from './helpers'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities'

let db: any
let caps: SqliteCapabilities
let root: string

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  caps = opened.caps
  root = mkdtempSync(join(tmpdir(), 'eyas-rebuild-index-'))
  seedLegacyStore(db, root)
  migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const hits = (q: string) => (db.all(sql`SELECT rowid FROM memory_raw_fts WHERE memory_raw_fts MATCH ${q} ORDER BY rowid`) as any[]).map((r) => r.rowid)

describe('rebuildIndex', () => {
  it('refills memory_raw_fts from the blobs with identical hits, skipping tombstoned rows', () => {
    if (!caps.fts5) return
    const before = hits('eloleg')
    expect(before.length).toBeGreaterThan(200)
    db.run(sql`UPDATE memory_raw SET tombstoned = 1 WHERE rid = ${before[0]}`)
    const r = rebuildIndex(db, caps)
    expect(r.ftsRows).toBe((db.all(sql`SELECT COUNT(*) AS c FROM memory_raw WHERE tombstoned = 0`) as any[])[0].c)
    expect(hits('eloleg')).toEqual(before.slice(1))
    expect(rebuildIndex(db, caps).ftsRows).toBe(r.ftsRows)
  })

  it('allocates one small integer per project in memory_partition_key for the vec0 partition, 0 for global', () => {
    const gistWithProject = (db.all(sql`SELECT g.id FROM memory_gist g JOIN memory_tag t ON t.memory_rid = g.rid AND t.memory_type = 'gist' AND t.tag_type = 'project' LIMIT 1`) as any[])[0]
    const gistGlobal = (db.all(sql`SELECT g.id FROM memory_gist g WHERE g.scope_type = 'global' LIMIT 1`) as any[])[0]
    expect(partitionKeyFor(db, 'gist', gistGlobal.id)).toBe(0)
    expect(projectKey(db, 'p-first')).toBe(1)
    expect(projectKey(db, 'p-first')).toBe(1)
    expect(projectKey(db, 'p-second')).toBe(2)
    expect(partitionKeyFor(db, 'gist', 'no-such-gist')).toBe(0)
    if (gistWithProject) expect(partitionKeyFor(db, 'gist', gistWithProject.id)).toBeGreaterThan(0)
    // p1a's table is the one allocator (no counter in memory_meta).
    expect(db.all(sql`SELECT project_key, scope_type, scope_id FROM memory_partition_key ORDER BY project_key`)).toEqual([
      { project_key: 1, scope_type: 'project', scope_id: 'p-first' }, { project_key: 2, scope_type: 'project', scope_id: 'p-second' },
    ])
    expect((db.all(sql`SELECT COUNT(*) AS c FROM memory_meta WHERE key LIKE 'project_key%'`) as any[])[0].c).toBe(0)
  })

  it('refills memory_embedding_vec from live memory_embedding rows (when sqlite-vec loads)', () => {
    if (!caps.vec0) return
    const vec = Buffer.alloc(384, 3)
    const live = allocateRid(db, 'embedding', '01ARZ3NDEKTSV4RRFFQ69G5FA1', 1)
    const cold = allocateRid(db, 'embedding', '01ARZ3NDEKTSV4RRFFQ69G5FA2', 2)
    // owner_rid and created_at are NOT NULL on p1a's memory_embedding; the owners g1/g2 do not exist in this fixture, so owner_rid is 0.
    db.run(sql`INSERT INTO memory_embedding (rid, id, owner_type, owner_id, owner_rid, model_id, vector, live_in_index, created_at) VALUES (${live}, '01ARZ3NDEKTSV4RRFFQ69G5FA1', 'gist', 'g1', 0, 'multilingual-e5-small@q8/e5-prefix', ${vec}, 1, 1)`)
    db.run(sql`INSERT INTO memory_embedding (rid, id, owner_type, owner_id, owner_rid, model_id, vector, live_in_index, created_at) VALUES (${cold}, '01ARZ3NDEKTSV4RRFFQ69G5FA2', 'gist', 'g2', 0, 'multilingual-e5-small@q8/e5-prefix', ${vec}, 0, 2)`)
    const r = rebuildIndex(db, caps)
    expect(r.vecRows).toBe(1)
    expect((db.all(sql`SELECT rowid FROM memory_embedding_vec`) as any[]).map((x) => x.rowid)).toEqual([live])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/rebuild-index.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/migration/rebuild'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/migration/rebuild.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L3 is a projection (spec §4): memory_raw_fts is refilled from the blobs,
// memory_embedding_vec from memory_embedding.vector (int8, bound with
// vec_int8 — spike §2 #9). rebuildFromL0 (Task 11) lives here too.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { zstdDecompress } from '@shared/zstd.js'
import { createMemoryV2Tables } from '../schema.js'
import { RAW_FTS_CLIP_CHARS } from '../ingest.js'

const decoder = new TextDecoder()
const FTS_BATCH = 500

/**
 * Stable small integer per project for the vec0 PARTITION KEY; 0 = global.
 * The row lives in p1a's memory_partition_key (AUTOINCREMENT from 1, UNIQUE
 * (scope_type, scope_id)) — the one allocator Phase 2's embedder reuses.
 */
export function projectKey(db: EyasDb, projectId: string): number {
  db.run(sql`INSERT OR IGNORE INTO memory_partition_key (scope_type, scope_id) VALUES ('project', ${projectId})`)
  const row = db.all<{ project_key: number }>(sql`SELECT project_key FROM memory_partition_key
    WHERE scope_type = 'project' AND scope_id = ${projectId}`)[0]
  if (!row) throw new Error(`memory_partition_key row for project ${projectId} is missing after insert`)
  return row.project_key
}

/** Partition of an embedding's owner: its `project` tag, else global (0). */
export function partitionKeyFor(db: EyasDb, ownerType: string, ownerId: string): number {
  const item = db.all<{ rid: number }>(sql`SELECT rid FROM memory_item WHERE id = ${ownerId} AND item_type = ${ownerType}`)[0]
  if (!item) return 0
  const tag = db.all<{ tag_value: string }>(sql`SELECT tag_value FROM memory_tag
    WHERE memory_rid = ${item.rid} AND memory_type = ${ownerType} AND tag_type = 'project' LIMIT 1`)[0]
  return tag ? projectKey(db, tag.tag_value) : 0
}

export function rebuildIndex(db: EyasDb, caps: SqliteCapabilities): { ftsRows: number; vecRows: number } {
  let ftsRows = 0
  let vecRows = 0
  db.run(sql`BEGIN IMMEDIATE`)
  try {
    if (caps.fts5) {
      db.run(sql`DROP TABLE IF EXISTS memory_raw_fts`)
      createMemoryV2Tables(db, caps)
      let after = 0
      for (;;) {
        const rows = db.all<{ rid: number; compressed_blob: Uint8Array }>(sql`SELECT r.rid, b.compressed_blob FROM memory_raw r
          JOIN memory_blob b ON b.content_hash = r.content_hash AND b.shred_partition_id = r.shred_partition_id
          WHERE r.rid > ${after} AND r.tombstoned = 0 ORDER BY r.rid LIMIT ${FTS_BATCH}`)
        if (rows.length === 0) break
        for (const r of rows) {
          const body = decoder.decode(zstdDecompress(new Uint8Array(r.compressed_blob)))
          db.run(sql`INSERT INTO memory_raw_fts (rowid, body) VALUES (${r.rid}, ${body.slice(0, RAW_FTS_CLIP_CHARS)})`)
          ftsRows++
          after = r.rid
        }
      }
    }
    if (caps.vec0) {
      db.run(sql`DROP TABLE IF EXISTS memory_embedding_vec`)
      createMemoryV2Tables(db, caps)
      const rows = db.all<{ rid: number; owner_type: string; owner_id: string; vector: Uint8Array }>(
        sql`SELECT rid, owner_type, owner_id, vector FROM memory_embedding WHERE live_in_index = 1 ORDER BY rid`,
      )
      for (const r of rows) {
        const v = new Uint8Array(r.vector)
        const param = Buffer.from(v.buffer, v.byteOffset, v.byteLength)
        db.run(sql`INSERT INTO memory_embedding_vec (rowid, project_key, embedding)
          VALUES (${r.rid}, ${partitionKeyFor(db, r.owner_type, r.owner_id)}, vec_int8(${param}))`)
        vecRows++
      }
    }
    db.run(sql`COMMIT`)
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* already rolled back */ }
    throw err
  }
  return { ftsRows, vecRows }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/rebuild-index.test.ts`
Expected: PASS (3 tests; the vec0 test returns early on a host where sqlite-vec does not load — `caps.vec0 === false` — and passes on Linux/glibc and macOS-with-Homebrew).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/migration/rebuild.ts tests/modules/memory/v2/rebuild-index.test.ts
git commit -m "feat(memory): eyas memory rebuild-index refills FTS and vec0 from stored data"
```

---
### Task 11: `rebuildFromL0` — truncate L1–L3, re-derive vault gists, replay extraction in `occurred_at` order

**Files:**
- Modify: `src/modules/memory/v2/migration/rebuild.ts` (append `rebuildFromL0`, add imports)
- Test: `tests/modules/memory/v2/rebuild-from-l0.test.ts`

**Interfaces:**
- Produces (contract): `rebuildFromL0(db: EyasDb, deps: RebuildFromL0Deps): { runId: string; conversations: number; vaultGists: number; failures: number }` with `export interface RebuildFromL0Deps { logger: Logger; caps?: SqliteCapabilities; instanceId?: string; config?: () => { engine: 'legacy' | 'v2'; extractInLegacy: boolean }; runExtraction?: typeof runExtraction; now?: () => number }`.
- Consumes: `runExtraction(db, conversationId, reason, { logger, config })` (P1c contract — injected so the test replays with a recorder), `recordRun`/`getInstanceId`/`getSqliteCapabilities` (P1a), Task 3 (`deriveVaultGist`), Task 7 (`writeMigratedGist`, `GistWriterDeps`), Task 2 (`legacyId`, `tableExists`).
- Semantics (spec §14 "Rebuild-from-log"): never touches `memory_raw`, `memory_blob`, `memory_raw_fts`, `memory_run`, `memory_purge_log`, `memory_partition_key`, nor the `extract_wm:*` / `instance_id` / `schema_version` keys of `memory_meta` (P1c's `reason === 'rebuild'` bypasses the watermark instead); deletes facts, gists, entities, embeddings (+ vec rows), their tags, every non-`migrated_from` link, `memory_idf` **and its `memory_meta('idf_docs')` counter** (both are derived — P1c's `updateIdf` would otherwise keep counting documents against an emptied df table and skew every IDF weight); re-derives one gist per vault document from the **latest** L0 bytes of each `vault:` partition with the same deterministic id the migration used (so rebuilding a migrated store reproduces the migrated gists exactly); then calls `runExtraction` once per distinct `conversation_id` ordered by the conversation's earliest `occurred_at` (vault pseudo-conversations included — P1c decides what a document-only conversation yields). A call that throws **or returns `status: 'failed'`** (P1c's `runExtraction` never throws; a rolled-back run comes back as `'failed'`) counts as one failure. Records its own `memory_run(run_type='migration', stats_json.op='rebuild-from-l0')`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/rebuild-from-l0.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §14: "truncates L1/L2/L3 (never L0, memory_run, memory_purge_log) and
// replays deterministic extraction in occurred_at order; tested in Phase 1
// with row counts and hash spot-checks."

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { migrateLegacy } from '@modules/memory/v2/migration/legacy-migrate'
import { rebuildFromL0 } from '@modules/memory/v2/migration/rebuild'
import { openLegacyTestDb, seedLegacyStore } from './fixtures/legacy-store'
import { silentLogger } from './helpers'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities'

let db: any
let caps: SqliteCapabilities
let root: string

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  caps = opened.caps
  root = mkdtempSync(join(tmpdir(), 'eyas-rebuild-l0-'))
  seedLegacyStore(db, root)
  migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const count = (table: string, where = '1=1') => (db.all(sql.raw(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)) as any[])[0].c
const gistIds = () => (db.all(sql`SELECT id FROM memory_gist ORDER BY id`) as any[]).map((g) => g.id)
const l0Snapshot = () => ({
  raw: count('memory_raw'), blob: count('memory_blob'), items: count('memory_item', "item_type = 'raw'"),
  hashes: (db.all(sql`SELECT content_hash FROM memory_raw ORDER BY rid`) as any[]).map((r) => r.content_hash).join(','),
  migratedLinks: count('memory_link', "link_type = 'migrated_from'"),
})

describe('rebuildFromL0', () => {
  it('keeps L0 and runs, truncates the derived layers, reproduces the vault gists and replays extraction per conversation in occurred_at order', () => {
    const l0 = l0Snapshot()
    const gistsBefore = gistIds()
    const runsBefore = count('memory_run')
    expect(gistsBefore).toHaveLength(266)
    expect(count('memory_fact')).toBe(3)

    const calls: Array<{ conversationId: string; reason: string }> = []
    const fake = vi.fn((_db: unknown, conversationId: string, reason: string) => {
      calls.push({ conversationId, reason })
      return { runId: 'fake', status: 'ok' }
    })
    const result = rebuildFromL0(db, { logger: silentLogger, caps, instanceId: 'inst-test', runExtraction: fake as any })

    expect(l0Snapshot()).toEqual(l0)
    expect(gistIds()).toEqual(gistsBefore)                                      // same deterministic ids from the L0 bytes
    expect(result.vaultGists).toBe(266)
    expect(count('memory_fact')).toBe(0)                                        // facts are extraction's job — the recorder wrote none
    expect(count('memory_fact_source')).toBe(0)
    expect(count('memory_tag', "memory_type = 'fact'")).toBe(0)
    expect(count('memory_link', "link_type = 'derived_from'")).toBe(0)
    expect(count('memory_run')).toBe(runsBefore + 1)
    const own = (db.all(sql`SELECT status, stats_json FROM memory_run WHERE id = ${result.runId}`) as any[])[0]
    expect(own.status).toBe('ok')
    expect(JSON.parse(own.stats_json)).toMatchObject({ op: 'rebuild-from-l0', vault_gists: 266, failures: 0 })

    const distinctConversations = count('(SELECT DISTINCT conversation_id FROM memory_raw WHERE conversation_id IS NOT NULL)')
    expect(result.conversations).toBe(distinctConversations)
    expect(calls).toHaveLength(distinctConversations)
    expect(new Set(calls.map((c) => c.conversationId)).size).toBe(distinctConversations)
    expect(calls.every((c) => c.reason === 'rebuild')).toBe(true)
    // Earliest occurrence first: c001 holds the oldest rows (message 1 and ep-1 at T0 + 1 s), c034's messages come ~48 s later,
    // and every vault:<path> pseudo-conversation is dated 2026-08-28/31 — after all of them.
    const order = calls.map((c) => c.conversationId)
    expect(order.indexOf('c001')).toBeLessThan(order.indexOf('c034'))
    expect(order.indexOf('c034')).toBeLessThan(order.findIndex((id) => id.startsWith('vault:')))
    expect(order.some((id) => id.startsWith('vault:'))).toBe(true)
  })

  it('counts a throwing AND a status=failed extraction, marks the run partial, and never loses L0', () => {
    const l0 = l0Snapshot()
    const fake = vi.fn((_db: unknown, conversationId: string) => {
      if (conversationId === 'c002') throw new Error('extractor on fire')
      // p1c's real runExtraction never throws: a rolled-back run is reported this way.
      if (conversationId === 'c003') return { runId: 'fake-failed', status: 'failed' }
      return { runId: 'fake', status: 'ok' }
    })
    const result = rebuildFromL0(db, { logger: silentLogger, caps, instanceId: 'inst-test', runExtraction: fake as any })
    expect(result.failures).toBe(2)
    expect((db.all(sql`SELECT status FROM memory_run WHERE id = ${result.runId}`) as any[])[0].status).toBe('partial')
    expect(l0Snapshot()).toEqual(l0)
  })

  it('resets the derived IDF state (memory_idf + idf_docs) but keeps the extraction watermarks and the partition keys', () => {
    db.run(sql`INSERT INTO memory_idf (stem, df) VALUES ('stale', 9)`)
    db.run(sql`INSERT OR REPLACE INTO memory_meta (key, value) VALUES ('idf_docs', '9'), ('extract_wm:c001', '123')`)
    db.run(sql`INSERT OR IGNORE INTO memory_partition_key (scope_type, scope_id) VALUES ('project', 'p-keep')`)
    rebuildFromL0(db, { logger: silentLogger, caps, instanceId: 'inst-test', runExtraction: vi.fn(() => ({ runId: 'fake', status: 'ok' })) as any })
    expect(count('memory_idf')).toBe(0)
    expect(count('memory_meta', "key = 'idf_docs'")).toBe(0)
    expect((db.all(sql`SELECT value FROM memory_meta WHERE key = 'extract_wm:c001'`) as any[])[0].value).toBe('123')
    expect(count('memory_partition_key', "scope_id = 'p-keep'")).toBe(1)
  })

  it('uses P1c\'s runExtraction by default (smoke: no throw on an empty store)', () => {
    const fresh = openLegacyTestDb()
    const r = rebuildFromL0(fresh.db, { logger: silentLogger, caps: fresh.caps, instanceId: 'inst-test' })
    expect(r).toMatchObject({ conversations: 0, vaultGists: 0, failures: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/rebuild-from-l0.test.ts`
Expected: FAIL — `rebuildFromL0 is not a function`.

- [ ] **Step 3: Append `rebuildFromL0` to `rebuild.ts`**

Add to the import block of `src/modules/memory/v2/migration/rebuild.ts`:

```ts
import type { Logger } from 'pino'
import { getSqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import { recordRun } from '../runs.js'
import { getInstanceId } from '../instance.js'
import { runExtraction } from '../extractor.js'
import { detectLanguage } from '../language.js'
import { parseVaultFile } from '../../vault/frontmatter.js'
import { deriveVaultGist, VAULT_CONVERSATION_PREFIX } from '../vault-ingest.js'
import { writeMigratedGist, type GistWriterDeps } from './legacy-migrate-vault.js'
import { legacyId } from './legacy-ids.js'
import { tableExists } from './sqlite-helpers.js'
```

and append at the end of the file:

```ts
export interface RebuildFromL0Deps {
  logger: Logger
  caps?: SqliteCapabilities
  instanceId?: string
  config?: () => { engine: 'legacy' | 'v2'; extractInLegacy: boolean }
  /** Injected for tests; defaults to p1c's runExtraction. */
  runExtraction?: typeof runExtraction
  now?: () => number
}

export interface RebuildFromL0Result {
  runId: string
  conversations: number
  vaultGists: number
  failures: number
}

/**
 * Tables holding derived (non-L0) rows; deleted in this order. memory_raw,
 * memory_blob, memory_raw_fts, memory_run, memory_purge_log and
 * memory_partition_key are never touched; of memory_meta only the derived
 * idf_docs counter is reset (the extract_wm:* watermarks stay — p1c's
 * reason='rebuild' bypasses them).
 */
const DERIVED_TABLES = ['memory_fact_source', 'memory_gist_source', 'memory_fact_archive', 'memory_fact', 'memory_gist', 'memory_entity', 'memory_embedding', 'memory_embedding_vec', 'memory_idf'] as const

export function rebuildFromL0(db: EyasDb, deps: RebuildFromL0Deps): RebuildFromL0Result {
  const caps = deps.caps ?? getSqliteCapabilities()
  const instanceId = deps.instanceId ?? getInstanceId(db)
  const nowMs = deps.now?.() ?? Date.now()
  const extract = deps.runExtraction ?? runExtraction
  const config = deps.config ?? (() => ({ engine: 'v2' as const, extractInLegacy: true }))
  const counts: Record<string, number> = {}
  const bump = (key: string, n = 1): void => { counts[key] = (counts[key] ?? 0) + n }

  let runId = ''
  let vaultGists = 0
  db.run(sql`BEGIN IMMEDIATE`)
  try {
    runId = recordRun(db, { runType: 'migration', status: 'failed', statsJson: { op: 'rebuild-from-l0', phase: 'started' } })
    for (const t of DERIVED_TABLES) if (tableExists(db, t)) db.run(sql.raw(`DELETE FROM ${t}`))
    db.run(sql`DELETE FROM memory_tag WHERE memory_type IN ('fact', 'gist', 'entity', 'embedding')`)
    db.run(sql`DELETE FROM memory_link WHERE link_type <> 'migrated_from'`)
    db.run(sql`DELETE FROM memory_item WHERE item_type IN ('fact', 'gist', 'entity', 'embedding')`)
    // memory_idf is emptied above; its document counter (p1c's idf.ts IDF_DOCS_META_KEY) must restart with it.
    db.run(sql`DELETE FROM memory_meta WHERE key = 'idf_docs'`)

    // Vault gists are a pure function of the latest L0 bytes of each vault partition.
    const gistDeps: GistWriterDeps = { db, caps, instanceId, runId, nowMs, bump }
    const docs = db.all<{ id: string; shred_partition_id: string; occurred_at: number; compressed_blob: Uint8Array }>(sql`
      SELECT r.id, r.shred_partition_id, r.occurred_at, b.compressed_blob FROM memory_raw r
      JOIN memory_blob b ON b.content_hash = r.content_hash AND b.shred_partition_id = r.shred_partition_id
      WHERE r.source_type = 'document' AND r.tombstoned = 0 AND r.shred_partition_id LIKE ${`${VAULT_CONVERSATION_PREFIX}%`}
        AND r.occurred_at = (SELECT MAX(x.occurred_at) FROM memory_raw x WHERE x.shred_partition_id = r.shred_partition_id AND x.tombstoned = 0)
      ORDER BY r.shred_partition_id`)
    for (const d of docs) {
      const rel = d.shred_partition_id.slice(VAULT_CONVERSATION_PREFIX.length)
      const parsed = parseVaultFile(decoder.decode(zstdDecompress(new Uint8Array(d.compressed_blob))))
      const derivation = deriveVaultGist(parsed, rel)
      if (writeMigratedGist(gistDeps, { id: legacyId(d.occurred_at, `legacy:vault_gist:${rel}`), rawId: d.id, derivation, occurredAtMs: d.occurred_at, language: detectLanguage(parsed.content), sourcePath: rel })) vaultGists++
    }
    db.run(sql`COMMIT`)
  } catch (err) {
    try { db.run(sql`ROLLBACK`) } catch { /* already rolled back */ }
    deps.logger.error({ err }, 'rebuild from L0 failed before extraction; derived layers are unchanged')
    throw err
  }

  // Extraction runs outside the transaction above: p1c commits per conversation.
  const conversations = db.all<{ conversation_id: string }>(sql`SELECT conversation_id FROM memory_raw
    WHERE conversation_id IS NOT NULL AND tombstoned = 0
    GROUP BY conversation_id ORDER BY MIN(occurred_at), conversation_id`)
  let failures = 0
  for (const c of conversations) {
    try {
      const outcome = extract(db, c.conversation_id, 'rebuild', { logger: deps.logger, config })
      // p1c's runExtraction never throws: a rolled-back run comes back as status 'failed' (with its own memory_run row).
      if (outcome.status === 'failed') {
        failures++
        deps.logger.warn({ runId: outcome.runId, conversationId: c.conversation_id }, 'rebuild from L0: extraction recorded a failed run for one conversation; continuing')
      }
    } catch (err) {
      failures++
      deps.logger.warn({ err, conversationId: c.conversation_id }, 'rebuild from L0: extraction threw for one conversation; continuing')
    }
  }
  db.run(sql`UPDATE memory_run SET status = ${failures > 0 ? 'partial' : 'ok'},
    stats_json = ${JSON.stringify({ op: 'rebuild-from-l0', conversations: conversations.length, vault_gists: vaultGists, failures, counts })}
    WHERE id = ${runId}`)
  deps.logger.info({ runId, conversations: conversations.length, vaultGists, failures }, 'rebuild from L0 finished')
  return { runId, conversations: conversations.length, vaultGists, failures }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/rebuild-from-l0.test.ts tests/modules/memory/v2/rebuild-index.test.ts`
Expected: PASS (4 + 3 tests). Then `bun run lint` — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/migration/rebuild.ts tests/modules/memory/v2/rebuild-from-l0.test.ts
git commit -m "feat(memory): eyas memory rebuild --from-l0 re-derives L1-L3 from the raw layer"
```

---

### Task 12: `exportVault` — pinned gists and current facts as `generated: true` markdown

**Files:**
- Create: `src/modules/memory/v2/migration/export-vault.ts`
- Test: `tests/modules/memory/v2/export-vault.test.ts`

**Interfaces:**
- Produces (contract): `exportVault(db: EyasDb, opts: { vaultRoot: string; scope?: string }): { files: number }`. Extras: `export type ExportScope = { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string }`; `parseExportScope(scope?: string): ExportScope` (`undefined`/`'all'`, `'global'`, `'project:<id>'`; anything else throws); `slugify(text): string`.
- Output (spec §14 "Vault export", gap analysis §C "Keep the vault readable/exportable"): `<vaultRoot>/generated/gists/<slug>-<id-tail>.md` per pinned current gist and `<vaultRoot>/generated/facts/<slug(subject)>.md` per fact subject (current facts: `valid_until IS NULL`, `archived = 0`, not `quarantined`), frontmatter `generated: true`, `memory_id`/`memory_type`, the gist's scope, `pinned`, `trust_tier`; `generated/gists` and `generated/facts` are cleared and rewritten on every run (one-way mirror). `generated/` is never re-ingested (Task 3 `isGeneratedVaultPath`).
- Consumes: `gray-matter` (`matter.stringify`, as `vault/frontmatter.ts` does), `clipGistText` (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/export-vault.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import matter from 'gray-matter'
import { initZstd } from '@shared/zstd'
import { migrateLegacy } from '@modules/memory/v2/migration/legacy-migrate'
import { exportVault, parseExportScope, slugify } from '@modules/memory/v2/migration/export-vault'
import { openLegacyTestDb, seedLegacyStore } from './fixtures/legacy-store'
import { silentLogger } from './helpers'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities'

let db: any
let caps: SqliteCapabilities
let root: string

beforeAll(async () => { await initZstd() })
beforeEach(() => {
  const opened = openLegacyTestDb()
  db = opened.db
  caps = opened.caps
  root = mkdtempSync(join(tmpdir(), 'eyas-export-vault-'))
  seedLegacyStore(db, root)
  migrateLegacy(db, { vaultRoot: root, logger: silentLogger, caps, instanceId: 'inst-test' })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const files = (dir: string) => { try { return readdirSync(join(root, 'generated', dir)).sort() } catch { return [] } }

describe('parseExportScope / slugify', () => {
  it('parses all, global and project:<id>; rejects the rest', () => {
    expect(parseExportScope(undefined)).toEqual({ kind: 'all' })
    expect(parseExportScope('all')).toEqual({ kind: 'all' })
    expect(parseExportScope('global')).toEqual({ kind: 'global' })
    expect(parseExportScope('project:eyas-system')).toEqual({ kind: 'project', projectId: 'eyas-system' })
    expect(() => parseExportScope('task:x')).toThrow(/unknown export scope/)
  })
  it('slugifies with diacritics folded and a length cap', () => {
    expect(slugify('Árvíztűrő tükörfúrógép: első!')).toBe('arvizturo-tukorfurogep-elso')
    expect(slugify('***')).toBe('note')
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(60)
  })
})

describe('exportVault', () => {
  it('writes every pinned gist and one file per fact subject with generated frontmatter', () => {
    const r = exportVault(db, { vaultRoot: root })
    expect(r.files).toBe(3)                                                     // 2 pinned global gists + 1 subject ("note") file
    expect(files('gists')).toHaveLength(2)
    expect(files('facts')).toEqual(['note.md'])
    const gist = matter(readFileSync(join(root, 'generated', 'gists', files('gists')[0]), 'utf8'))
    expect(gist.data).toMatchObject({ generated: true, memory_type: 'gist', scope_type: 'global', pinned: true, trust_tier: 'owner' })
    expect(typeof gist.data.memory_id).toBe('string')
    expect(gist.data.memory_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(gist.content.length).toBeGreaterThan(10)
    const feedback = files('gists').map((f) => matter(readFileSync(join(root, 'generated', 'gists', f), 'utf8'))).find((g) => g.content.includes('**Why:**'))!
    expect(feedback.content).toContain('**How to apply:**')
    const facts = matter(readFileSync(join(root, 'generated', 'facts', 'note.md'), 'utf8'))
    expect(facts.data).toMatchObject({ generated: true, memory_type: 'fact', fact_count: 1 })   // ep-1 only: ep-2 is invalidated (valid_until set), ar-1 is archived
    expect(facts.content.split('\n').filter((l) => l.startsWith('- ')).length).toBe(1)
  })

  it('filters by scope and rewrites the mirror from scratch', () => {
    mkdirSync(join(root, 'generated', 'gists'), { recursive: true })
    writeFileSync(join(root, 'generated', 'gists', 'stale.md'), 'stale')
    expect(exportVault(db, { vaultRoot: root, scope: 'global' }).files).toBe(3)  // 2 gists + the one current fact without a project tag (ep-1)
    expect(files('gists')).not.toContain('stale.md')
    expect(exportVault(db, { vaultRoot: root, scope: 'project:eyas-system' }).files).toBe(0)   // no pinned project gist; ep-2 is invalidated
    expect(files('gists')).toEqual([])
    expect(files('facts')).toEqual([])
    expect(exportVault(db, { vaultRoot: root }).files).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/export-vault.test.ts`
Expected: FAIL — `Cannot find module '@modules/memory/v2/migration/export-vault'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/modules/memory/v2/migration/export-vault.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas memory export --vault [--scope …]` — spec §14: "renders pinned gists
// and facts as frontmatter markdown (generated: true) so Obsidian users lose
// nothing". One-way mirror under data/vault/generated/, rewritten on every
// run; the vault watcher never ingests that folder (vault-ingest.ts).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import matter from 'gray-matter'
import type { EyasDb } from '@core/types'
import { clipGistText, VAULT_GENERATED_DIR } from '../vault-ingest.js'

export type ExportScope = { kind: 'all' } | { kind: 'global' } | { kind: 'project'; projectId: string }

export function parseExportScope(scope?: string): ExportScope {
  if (!scope || scope === 'all') return { kind: 'all' }
  if (scope === 'global') return { kind: 'global' }
  const m = /^project:(.+)$/.exec(scope)
  if (m) return { kind: 'project', projectId: m[1] }
  throw new Error(`unknown export scope "${scope}" (expected all, global or project:<id>)`)
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return slug || 'note'
}

interface GistRow {
  id: string
  text: string
  scope_type: string
  scope_id: string | null
  structured_json: string | null
  trust_tier: string
  created_at: number
  hlc_physical_ms: number
}

interface FactRow {
  id: string
  subject: string
  predicate: string
  object_text: string
  confidence: number | null
  trust_tier: string
  valid_from: number | null
  created_at: number
}

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

function selectGists(db: EyasDb, scope: ExportScope): GistRow[] {
  const base = sql`SELECT id, text, scope_type, scope_id, structured_json, trust_tier, created_at, hlc_physical_ms FROM memory_gist
    WHERE is_current = 1 AND pinned = 1 AND trust_tier <> 'quarantined'`
  if (scope.kind === 'global') return db.all<GistRow>(sql`${base} AND scope_type = 'global' ORDER BY id`)
  if (scope.kind === 'project') return db.all<GistRow>(sql`${base} AND scope_type = 'project' AND scope_id = ${scope.projectId} ORDER BY id`)
  return db.all<GistRow>(sql`${base} ORDER BY id`)
}

function selectFacts(db: EyasDb, scope: ExportScope): FactRow[] {
  const base = sql`SELECT f.id, f.subject, f.predicate, f.object_text, f.confidence, f.trust_tier, f.valid_from, f.created_at FROM memory_fact f
    WHERE f.valid_until IS NULL AND f.archived = 0 AND f.trust_tier <> 'quarantined'`
  if (scope.kind === 'global') {
    return db.all<FactRow>(sql`${base} AND NOT EXISTS (SELECT 1 FROM memory_tag t WHERE t.memory_rid = f.rid AND t.memory_type = 'fact' AND t.tag_type = 'project') ORDER BY f.subject, f.id`)
  }
  if (scope.kind === 'project') {
    return db.all<FactRow>(sql`${base} AND EXISTS (SELECT 1 FROM memory_tag t WHERE t.memory_rid = f.rid AND t.memory_type = 'fact' AND t.tag_type = 'project' AND t.tag_value = ${scope.projectId}) ORDER BY f.subject, f.id`)
  }
  return db.all<FactRow>(sql`${base} ORDER BY f.subject, f.id`)
}

export function exportVault(db: EyasDb, opts: { vaultRoot: string; scope?: string }): { files: number } {
  const scope = parseExportScope(opts.scope)
  const gistDir = join(opts.vaultRoot, VAULT_GENERATED_DIR, 'gists')
  const factDir = join(opts.vaultRoot, VAULT_GENERATED_DIR, 'facts')
  for (const dir of [gistDir, factDir]) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
  let files = 0

  for (const g of selectGists(db, scope)) {
    const title = clipGistText(g.text, 80).replace(/…$/, '')
    let body = g.text
    if (g.structured_json) {
      try {
        const s = JSON.parse(g.structured_json) as { why?: string | null; howToApply?: string | null }
        if (s.why) body += `\n\n**Why:** ${s.why}`
        if (s.howToApply) body += `\n\n**How to apply:** ${s.howToApply}`
      } catch { /* leave the text alone */ }
    }
    const frontmatter = {
      title,
      tags: [],
      tier: 'semantic',
      links: [],
      created: isoDate(g.hlc_physical_ms),
      updated: isoDate(g.created_at),
      generated: true,
      memory_id: g.id,
      memory_type: 'gist',
      scope_type: g.scope_type,
      scope_id: g.scope_id ?? null,
      pinned: true,
      trust_tier: g.trust_tier,
    }
    writeFileSync(join(gistDir, `${slugify(title)}-${g.id.slice(-8).toLowerCase()}.md`), matter.stringify(`${body}\n`, frontmatter), 'utf8')
    files++
  }

  const bySubject = new Map<string, FactRow[]>()
  for (const f of selectFacts(db, scope)) {
    const list = bySubject.get(f.subject) ?? []
    list.push(f)
    bySubject.set(f.subject, list)
  }
  for (const [subject, facts] of bySubject) {
    const lines = facts.map((f) => `- ${f.predicate} ${f.object_text} _(confidence ${f.confidence ?? 'n/a'}, ${f.trust_tier}, ${f.id})_`)
    const frontmatter = {
      title: `Facts: ${subject}`,
      tags: [],
      tier: 'semantic',
      links: [],
      created: isoDate(Math.min(...facts.map((f) => f.valid_from ?? f.created_at))),
      updated: isoDate(Math.max(...facts.map((f) => f.created_at))),
      generated: true,
      memory_type: 'fact',
      subject,
      fact_count: facts.length,
    }
    writeFileSync(join(factDir, `${slugify(subject)}.md`), matter.stringify(`${lines.join('\n')}\n`, frontmatter), 'utf8')
    files++
  }
  return { files }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/memory/v2/export-vault.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/memory/v2/migration/export-vault.ts tests/modules/memory/v2/export-vault.test.ts
git commit -m "feat(memory): eyas memory export --vault mirrors pinned gists and facts as generated markdown"
```

---
### Task 13: Vault watcher → L0 (every edited note becomes a document occurrence)

**Files:**
- Modify: `src/modules/memory/vault/vault-watcher.ts` (signature at line 18, the `.on(...)` chain at lines 47–51)
- Modify: `src/modules/memory/index.ts` (the "Start vault file watcher" block — lines 290–294 at HEAD `9711ea1f` / 0.8.22-beta; ~30 lines lower once plan p1b's `wireL0Capture` block has been inserted above it)
- Test: `tests/modules/memory/v2/vault-watcher-l0.test.ts`

**Interfaces:**
- Produces: `export interface VaultWatcherHooks { onFileChanged?: (relPath: string, event: 'add' | 'change') => void }`; `createVaultWatcher(vaultPath, indexer, logger, hooks: VaultWatcherHooks = {})` — the fourth parameter is new and optional, so the two existing callers (`memory/index.ts`, e2e tests) keep compiling.
- Consumes: `ingestVaultFile`, `vaultConversationId` (Task 3); `captureUnit`/`pendingUnits`/`resetIngestBridge` (P1b); `(ctx as any).memoryIngest` (P1b Task 11 publishes it; `flushConversation(id, 'manual')` is the contract method).
- Behaviour: on `add`/`change` of a `.md` file the hook runs **before** the debounced reindex with the path relative to the vault root; a throwing hook is logged and never stops the watcher; `unlink` only reindexes (a deleted note keeps its L0 history — L0 is append-only). `memory/index.ts` passes a hook that calls `ingestVaultFile` (hash-in-partition dedup, `generated/` skipped) and flushes the file's pseudo-conversation immediately so P1c's `onFlushed` fires.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/memory/v2/vault-watcher-l0.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Spec §4: "Every vault file is ingested into L0 as a document occurrence
// (partition vault:<path>, hash = SHA-256 of the file bytes computed at
// ingestion)". Real chokidar on a temp dir; the hook is the seam.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createVaultWatcher } from '@modules/memory/vault/vault-watcher'
import { ingestVaultFile } from '@modules/memory/v2/vault-ingest'
import { pendingUnits, resetIngestBridge } from '@modules/memory/v2/ingest-bridge'
import { makeV2Db, silentLogger } from './helpers'

const NOTE = `---
title: 'Watched note'
tags: []
tier: semantic
links: []
created: '2026-09-03'
updated: '2026-09-03'
kind: user
summary: A note the watcher must see.
---
Body.
`

let root: string
let watcher: ReturnType<typeof createVaultWatcher> | null = null
const fakeIndexer = { indexAll: () => 0, removeStale: () => {} } as any

beforeEach(() => {
  resetIngestBridge()
  root = mkdtempSync(join(tmpdir(), 'eyas-vault-watch-'))
  mkdirSync(join(root, 'semantic'), { recursive: true })
  mkdirSync(join(root, 'generated'), { recursive: true })
})
afterEach(async () => {
  await watcher?.stop()
  watcher = null
  rmSync(root, { recursive: true, force: true })
})

describe('vault watcher → onFileChanged hook', () => {
  it('reports add and change with vault-relative paths, survives a throwing hook, ignores non-markdown', async () => {
    const seen: Array<[string, string]> = []
    const hook = vi.fn((rel: string, event: string) => {
      seen.push([rel, event])
      if (rel === 'semantic/boom.md') throw new Error('hook on fire')
    })
    watcher = createVaultWatcher(root, fakeIndexer, silentLogger, { onFileChanged: hook })
    watcher.start()
    await new Promise((r) => setTimeout(r, 300))                                // let chokidar finish its initial scan

    writeFileSync(join(root, 'semantic', 'boom.md'), NOTE)
    await vi.waitFor(() => expect(seen).toContainEqual(['semantic/boom.md', 'add']), { timeout: 8_000 })

    writeFileSync(join(root, 'semantic', 'a.md'), NOTE)
    await vi.waitFor(() => expect(seen).toContainEqual(['semantic/a.md', 'add']), { timeout: 8_000 })

    writeFileSync(join(root, 'semantic', 'a.md'), `${NOTE}\nEdited.\n`)
    await vi.waitFor(() => expect(seen).toContainEqual(['semantic/a.md', 'change']), { timeout: 8_000 })

    writeFileSync(join(root, 'semantic', 'notes.txt'), 'not markdown')
    await new Promise((r) => setTimeout(r, 700))
    expect(seen.some(([rel]) => rel.endsWith('.txt'))).toBe(false)
  }, 30_000)

  it('ingestVaultFile through the real bridge buffers one document unit per new content', () => {
    const { db } = makeV2Db()
    writeFileSync(join(root, 'semantic', 'a.md'), NOTE)
    expect(ingestVaultFile(db, root, 'semantic/a.md').status).toBe('captured')
    expect(pendingUnits()).toBe(1)
    expect(ingestVaultFile(db, root, 'semantic/a.md').status).toBe('captured')  // nothing flushed yet → the bridge, not L0, dedups later on the ULID
    expect(pendingUnits()).toBe(2)
    writeFileSync(join(root, 'generated', 'g.md'), NOTE)
    expect(ingestVaultFile(db, root, 'generated/g.md').status).toBe('skipped_generated')
    expect(pendingUnits()).toBe(2)
  })
})

describe('memory/index.ts wiring (source contract)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/memory/index.ts'), 'utf-8')
  it('passes an onFileChanged hook that ingests the file and flushes its pseudo-conversation', () => {
    expect(source).toMatch(/onFileChanged/)
    expect(source).toMatch(/ingestVaultFile\(ctx\.db, 'data\/vault', relPath\)/)
    expect(source).toMatch(/flushConversation\(vaultConversationId\(relPath\), 'manual'\)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/memory/v2/vault-watcher-l0.test.ts`
Expected: FAIL — the first test times out (`createVaultWatcher` ignores its fourth argument) and the source contract fails.

- [ ] **Step 3: Extend the watcher**

`src/modules/memory/vault/vault-watcher.ts` currently begins (lines 14–18):

```ts
import chokidar, { type FSWatcher } from 'chokidar'
import type { Logger } from 'pino'
import type { VaultIndexer } from './vault-indexer.js'

export function createVaultWatcher(vaultPath: string, indexer: VaultIndexer, logger: Logger) {
```

Change it to:

```ts
import chokidar, { type FSWatcher } from 'chokidar'
import { relative } from 'node:path'
import type { Logger } from 'pino'
import type { VaultIndexer } from './vault-indexer.js'

export interface VaultWatcherHooks {
  /**
   * Fired for every added or changed markdown file with its path relative to
   * the vault root, before the debounced reindex. Memory feeds L0 from here
   * (spec §4: every vault file is a `document` occurrence). Deletions are not
   * reported: L0 is append-only and keeps the note's history.
   */
  onFileChanged?: (relPath: string, event: 'add' | 'change') => void
}

export function createVaultWatcher(vaultPath: string, indexer: VaultIndexer, logger: Logger, hooks: VaultWatcherHooks = {}) {
```

The `.on(...)` chain inside `start()` currently reads (lines 47–51):

```ts
      watcher
        .on('add', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('change', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('unlink', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('error', (err) => logger.warn({ err: String(err) }, 'Vault watcher error'))
```

Change it to:

```ts
      const notify = (p: string, event: 'add' | 'change'): void => {
        if (!p.endsWith('.md')) return
        try {
          hooks.onFileChanged?.(relative(vaultPath, p), event)
        } catch (err) {
          logger.warn({ err: String(err), path: p }, 'Vault watcher: onFileChanged hook failed; reindex continues')
        }
        scheduleReindex()
      }
      watcher
        .on('add', (p) => notify(p, 'add'))
        .on('change', (p) => notify(p, 'change'))
        .on('unlink', (p) => { if (p.endsWith('.md')) scheduleReindex() })
        .on('error', (err) => logger.warn({ err: String(err) }, 'Vault watcher error'))
```

- [ ] **Step 4: Wire it in `memory/index.ts`**

The block currently reads:

```ts
    // Start vault file watcher
    const { createVaultWatcher } = await import('./vault/vault-watcher.js')
    const vaultWatcher = createVaultWatcher('data/vault', indexer, ctx.logger)
    vaultWatcher.start()
    ;(ctx as any).vaultWatcher = vaultWatcher
```

Replace it with:

```ts
    // Start vault file watcher. Every added or edited note also enters L0 as
    // a `document` occurrence (spec §4) and is flushed at once — one
    // pseudo-conversation per file, so extraction (p1c) sees it like a task.
    const { createVaultWatcher } = await import('./vault/vault-watcher.js')
    const { ingestVaultFile, vaultConversationId } = await import('./v2/vault-ingest.js')
    const vaultWatcher = createVaultWatcher('data/vault', indexer, ctx.logger, {
      onFileChanged: (relPath) => {
        const result = ingestVaultFile(ctx.db, 'data/vault', relPath)
        if (result.status !== 'captured') return
        try {
          ;(ctx as any).memoryIngest?.flushConversation(vaultConversationId(relPath), 'manual')
        } catch (err) {
          ctx.logger.warn({ err, relPath }, 'Vault note captured but not flushed; the memory.v2.flush sweep retries')
        }
      },
    })
    vaultWatcher.start()
    ;(ctx as any).vaultWatcher = vaultWatcher
```

- [ ] **Step 5: Run the test, the existing vault suites and the type-check**

Run: `bun vitest run tests/modules/memory/v2/vault-watcher-l0.test.ts tests/modules/memory/vault-service.test.ts tests/modules/memory/vault-parsers.test.ts && bun run lint`
Expected: all PASS (3 new tests); `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/modules/memory/vault/vault-watcher.ts src/modules/memory/index.ts tests/modules/memory/v2/vault-watcher-l0.test.ts
git commit -m "feat(memory): vault edits enter L0 through the watcher hook"
```

---

### Task 14: `eyas memory …` CLI

**Files:**
- Create: `src/cli/commands/memory.ts`
- Modify: `src/cli/index.ts` (the `subCommands` map, lines 11–22)
- Test: `tests/cli/memory.test.ts`

**Interfaces:**
- Produces: `MEMORY_STATUS_TABLES` — P1a's `MEMORY_V2_TABLES` (the 23 regular tables, imported, **never re-declared**) plus the two virtual projections `memory_raw_fts` and `memory_embedding_vec`: 25 names; `export interface MemoryStatus { engine: string; instanceId: string; zstdTier: string; sqliteVersion: string; fts5: boolean; vec0: boolean; tables: Record<string, number | null>; lastMigration: { id: string; status: string; statsJson: string | null } | null }`; `collectMemoryStatus(db, caps, opts: { engine: string; instanceId: string; zstdTier: string }): MemoryStatus`; `formatMemoryStatus(status: MemoryStatus): string`; `formatMigrationReport(report: MigrationReport): string`; `warnIfServerRunning(pidFile: string): string | null`; `export interface OfflineMemoryDb { db: EyasDb; caps: SqliteCapabilities; dbPath: string; vaultRoot: string; pidFile: string; engine: 'legacy' | 'v2'; instanceId: string; zstdTier: string; close(): void }`; `openOfflineMemoryDb(configPath?: string): Promise<OfflineMemoryDb>`; the default export is the citty command with sub-commands `migrate`, `rebuild`, `rebuild-index`, `export`, `status`.
- Consumes: `resolveInstance`/`loadResolvedConfig` (same shape as `doctor.ts:117-141`), `createDatabase`/`getRawDatabase`/`closeDatabase` (`src/core/db/connection.ts`), `probeSqliteCapabilities` (P1a), `createMemoryTables` (`src/modules/memory/schema.ts`, idempotent legacy DDL so a fresh install has the tables the migration reads), `createMemoryV2Tables` (P1a), `initZstd`/`zstdTier` (P1a), `getInstanceId` (P1a), `createLogger` (`src/core/logger.ts`), `readPidFile`/`isProcessRunning` (`src/cli/utils/process-control.ts`), `createBackupService`/`createLocalBackupProvider` (`src/modules/disaster-recovery`), Tasks 7, 9, 10, 11, 12.
- Terminal output uses `console.log` like every `src/cli/commands/*` file; library calls get a Pino logger at `warn` level so their own log lines still reach stderr.
- The commands take a write transaction on the live database file; `warnIfServerRunning` prints a warning when `data/eyas.pid` names a live process. `--backup` runs `createBackupService(createLocalBackupProvider())` **before** migrating (spec §14: "a disaster-recovery backup precedes migration"); it archives `data/` + `config/` under `data/backups/` relative to the current directory, so run it from the instance home like `eyas start`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/memory.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { initZstd } from '@shared/zstd'
import { collectMemoryStatus, formatMemoryStatus, formatMigrationReport, warnIfServerRunning, MEMORY_STATUS_TABLES } from '../../src/cli/commands/memory'
import memoryCommand from '../../src/cli/commands/memory'
import { MEMORY_V2_TABLES } from '@modules/memory/v2/schema'
import { insertLegacyRun } from '@modules/memory/v2/migration/sqlite-helpers'
import { makeV2Db } from '../modules/memory/v2/helpers'

beforeAll(async () => { await initZstd() })

describe('eyas memory status helpers', () => {
  it('counts every v2 table, marks absent ones null, and reports the last migration run', () => {
    const { db, caps } = makeV2Db()
    db.run(sql`INSERT INTO memory_meta (key, value) VALUES ('x', 'y')`)
    insertLegacyRun(db, { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', runType: 'migration', status: 'ok', modelUsed: null, statsJson: { counts: {} }, createdAtMs: 1_800_000_000_000 })
    const status = collectMemoryStatus(db, caps, { engine: 'legacy', instanceId: 'inst-test', zstdTier: 'bun' })
    expect(status.tables.memory_meta).toBe(1)
    expect(status.tables.memory_raw).toBe(0)
    expect(status.tables.memory_embedding_vec).toBe(caps.vec0 ? 0 : null)
    expect(status.lastMigration).toEqual({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', status: 'ok', statsJson: '{"counts":{}}' })
    expect(Object.keys(status.tables)).toEqual([...MEMORY_STATUS_TABLES])
    // p1a's list plus the two virtual tables — 25 names, memory_partition_key included.
    expect(MEMORY_STATUS_TABLES).toEqual([...MEMORY_V2_TABLES, 'memory_raw_fts', 'memory_embedding_vec'])
    expect(MEMORY_STATUS_TABLES).toHaveLength(25)
    expect(status.tables.memory_partition_key).toBe(0)
    const text = formatMemoryStatus(status)
    expect(text).toContain('engine: legacy')
    expect(text).toContain('memory_meta')
    expect(text).toContain('last migration: 01ARZ3NDEKTSV4RRFFQ69G5FAV (ok)')
  })

  it('formats a migration report with counts and surprises', () => {
    const text = formatMigrationReport({ runId: 'R', counts: { 'raw.inserted': 3, 'vault.migrated': 2 }, surprises: ['vault a.md: no frontmatter'], durationMs: 12, dryRun: true })
    expect(text).toContain('DRY RUN')
    expect(text).toContain('raw.inserted')
    expect(text).toContain('3')
    expect(text).toContain('no frontmatter')
  })

  it('warns only when the pid file names a live process', () => {
    expect(warnIfServerRunning('/nonexistent/eyas.pid')).toBeNull()
  })
})

describe('eyas memory command', () => {
  it('exposes the five sub-commands', () => {
    expect(Object.keys((memoryCommand as any).subCommands).sort()).toEqual(['export', 'migrate', 'rebuild', 'rebuild-index', 'status'])
  })
  it('is registered in src/cli/index.ts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/cli/index.ts'), 'utf-8')
    expect(source).toMatch(/memory: \(\) => import\('\.\/commands\/memory\.js'\)\.then\(\(m\) => m\.default\)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/cli/memory.test.ts`
Expected: FAIL — `Cannot find module '../../src/cli/commands/memory'`.

- [ ] **Step 3: Write the command**

```ts
// src/cli/commands/memory.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas memory` — sovereign memory v2 maintenance (spec §14):
//   eyas memory migrate [--dry-run] [--undo] [--backup]
//   eyas memory rebuild --from-l0
//   eyas memory rebuild-index
//   eyas memory export --vault [--scope global|project:<id>]
//   eyas memory status
// Every sub-command opens the instance database offline, exactly the way
// `eyas doctor` resolves it, and creates the v2 tables first. Stop the server
// before migrate/rebuild: they take a write transaction on the same file.

import { defineCommand } from 'citty'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { SqliteCapabilities } from '@core/db/sqlite-capabilities.js'
import type { MigrationReport } from '@modules/memory/v2/migration/legacy-migrate.js'
import { MEMORY_V2_TABLES } from '@modules/memory/v2/schema.js'
import { readPidFile, isProcessRunning } from '../utils/process-control.js'

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

/** Every table `eyas memory status` counts: p1a's regular tables plus the two virtual projections it creates conditionally. */
export const MEMORY_STATUS_TABLES = [...MEMORY_V2_TABLES, 'memory_raw_fts', 'memory_embedding_vec'] as const

export interface MemoryStatus {
  engine: string
  instanceId: string
  zstdTier: string
  sqliteVersion: string
  fts5: boolean
  vec0: boolean
  tables: Record<string, number | null>
  lastMigration: { id: string; status: string; statsJson: string | null } | null
}

export function collectMemoryStatus(db: EyasDb, caps: SqliteCapabilities, opts: { engine: string; instanceId: string; zstdTier: string }): MemoryStatus {
  const tables: Record<string, number | null> = {}
  for (const t of MEMORY_STATUS_TABLES) {
    const exists = db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM sqlite_master WHERE name = ${t}`).length > 0
    if (!exists) { tables[t] = null; continue }
    try {
      tables[t] = db.all<{ c: number }>(sql.raw(`SELECT COUNT(*) AS c FROM ${t}`))[0]?.c ?? 0
    } catch {
      tables[t] = null
    }
  }
  let lastMigration: MemoryStatus['lastMigration'] = null
  try {
    const row = db.all<{ id: string; status: string; stats_json: string | null }>(
      sql`SELECT id, status, stats_json FROM memory_run WHERE run_type = 'migration' ORDER BY id DESC LIMIT 1`,
    )[0]
    if (row) lastMigration = { id: row.id, status: row.status, statsJson: row.stats_json }
  } catch {
    /* no memory_run yet */
  }
  return { engine: opts.engine, instanceId: opts.instanceId, zstdTier: opts.zstdTier, sqliteVersion: caps.sqliteVersion, fts5: caps.fts5, vec0: caps.vec0, tables, lastMigration }
}

export function formatMemoryStatus(s: MemoryStatus): string {
  const lines = [
    bold('EYAS memory v2'),
    `  engine: ${s.engine}    instance: ${s.instanceId}`,
    `  sqlite ${s.sqliteVersion}    fts5: ${s.fts5 ? green('yes') : red('no')}    vec0: ${s.vec0 ? green('yes') : yellow('no (JS scan fallback)')}    zstd: ${s.zstdTier}`,
    '',
  ]
  for (const [table, n] of Object.entries(s.tables)) {
    lines.push(`  ${table.padEnd(22)} ${n === null ? dim('absent') : String(n)}`)
  }
  lines.push('')
  lines.push(s.lastMigration ? `  last migration: ${s.lastMigration.id} (${s.lastMigration.status})` : dim('  no migration run yet'))
  return lines.join('\n')
}

export function formatMigrationReport(r: MigrationReport): string {
  const lines = [bold(r.dryRun ? 'Migration DRY RUN — nothing was written' : 'Migration finished'), `  run: ${r.runId}    ${r.durationMs} ms`, '']
  for (const key of Object.keys(r.counts).sort()) lines.push(`  ${key.padEnd(48)} ${r.counts[key]}`)
  if (r.surprises.length > 0) {
    lines.push('', yellow(`  ${r.surprises.length} surprise(s):`))
    for (const s of r.surprises.slice(0, 50)) lines.push(`   - ${s}`)
    if (r.surprises.length > 50) lines.push(dim(`   … ${r.surprises.length - 50} more in memory_run.stats_json`))
  }
  return lines.join('\n')
}

/** A warning line when the pid file names a live server, else null. */
export function warnIfServerRunning(pidFile: string): string | null {
  const pid = readPidFile(pidFile)
  if (pid === null || !isProcessRunning(pid)) return null
  return `EYAS appears to be running (pid ${pid}). Stop it first (eyas stop) — memory commands take a write lock on the database.`
}

export interface OfflineMemoryDb {
  db: EyasDb
  caps: SqliteCapabilities
  dbPath: string
  vaultRoot: string
  pidFile: string
  engine: 'legacy' | 'v2'
  instanceId: string
  zstdTier: string
  close(): void
}

export async function openOfflineMemoryDb(configPath?: string): Promise<OfflineMemoryDb> {
  const { resolveInstance } = await import('../../core/instance.js')
  const { loadResolvedConfig } = await import('../../core/config/loader.js')
  const instance = resolveInstance({ configPath, ensureDirs: false })
  let dbPath = instance.databasePath
  let engine: 'legacy' | 'v2' = 'legacy'
  try {
    const config = loadResolvedConfig({ configPath: instance.configPath, localConfigPath: instance.localConfigPath, instance })
    dbPath = config.database.path
    engine = ((config as { memory?: { engine?: 'legacy' | 'v2' } }).memory?.engine) ?? 'legacy'
  } catch {
    /* instance defaults */
  }
  const { createDatabase, getRawDatabase, closeDatabase } = await import('../../core/db/connection.js')
  const { probeSqliteCapabilities } = await import('../../core/db/sqlite-capabilities.js')
  const { createMemoryTables } = await import('../../modules/memory/schema.js')
  const { createMemoryV2Tables } = await import('../../modules/memory/v2/schema.js')
  const { getInstanceId } = await import('../../modules/memory/v2/instance.js')
  const { initZstd } = await import('../../shared/zstd.js')

  const db = createDatabase(dbPath)
  const caps = probeSqliteCapabilities(getRawDatabase())
  createMemoryTables(db)
  createMemoryV2Tables(db, caps)
  const zstdTier = await initZstd()
  return {
    db, caps, dbPath, vaultRoot: join(instance.dataDir, 'vault'), pidFile: instance.pidFile, engine,
    instanceId: getInstanceId(db), zstdTier, close: () => closeDatabase(),
  }
}

async function quietLogger() {
  const { createLogger } = await import('../../core/logger.js')
  return createLogger({ level: 'warn', pretty: false })
}

const configArg = { config: { type: 'string' as const, description: 'Config file path' } }

const migrate = defineCommand({
  meta: { name: 'migrate', description: 'Migrate the legacy memory stores into memory v2 (idempotent; --undo removes only migrated rows)' },
  args: {
    ...configArg,
    'dry-run': { type: 'boolean', description: 'Run everything inside a transaction and roll back; print the exact counts', default: false },
    undo: { type: 'boolean', description: 'Remove every row the migration wrote; legacy tables and vault files are untouched', default: false },
    backup: { type: 'boolean', description: 'Create a disaster-recovery backup (data/backups) before migrating', default: false },
  },
  async run({ args }) {
    let opened: OfflineMemoryDb | null = null
    try {
      opened = await openOfflineMemoryDb(args.config || undefined)
      const warning = warnIfServerRunning(opened.pidFile)
      if (warning) console.log(yellow(`\n  ⚠ ${warning}\n`))
      const logger = await quietLogger()
      if (args.backup && !args['dry-run']) {
        const { createBackupService } = await import('../../modules/disaster-recovery/backup-service.js')
        const { createLocalBackupProvider } = await import('../../modules/disaster-recovery/providers/local.js')
        const meta = await createBackupService(createLocalBackupProvider(), { logger }).createBackup()
        console.log(`\n${green('✓')} Backup written: data/backups/${meta.filename} (${meta.sizeBytes} bytes)`)
      }
      if (args.undo) {
        const { undoMigration } = await import('../../modules/memory/v2/migration/legacy-migrate.js')
        const { removed } = undoMigration(opened.db)
        console.log(`\n${green('✓')} Migration undone`)
        for (const [table, n] of Object.entries(removed)) console.log(`  ${table.padEnd(22)} -${n}`)
        console.log('')
        return
      }
      const { migrateLegacy } = await import('../../modules/memory/v2/migration/legacy-migrate.js')
      const report = migrateLegacy(opened.db, { vaultRoot: opened.vaultRoot, dryRun: args['dry-run'], logger, caps: opened.caps, instanceId: opened.instanceId })
      console.log(`\n${formatMigrationReport(report)}\n`)
    } catch (err: any) {
      console.error(`\n${red('✗')} Migration failed: ${err.message}\n`)
      process.exitCode = 1
    } finally {
      opened?.close()
    }
  },
})

const rebuild = defineCommand({
  meta: { name: 'rebuild', description: 'Rebuild the derived layers (facts, gists, entities, embeddings) from the raw layer' },
  args: {
    ...configArg,
    'from-l0': { type: 'boolean', description: 'Required: truncate L1–L3 and replay deterministic extraction from L0', default: false },
  },
  async run({ args }) {
    if (!args['from-l0']) {
      console.error(`\n${red('✗')} eyas memory rebuild needs --from-l0 (the only rebuild source is the raw layer)\n`)
      process.exitCode = 1
      return
    }
    let opened: OfflineMemoryDb | null = null
    try {
      opened = await openOfflineMemoryDb(args.config || undefined)
      const warning = warnIfServerRunning(opened.pidFile)
      if (warning) console.log(yellow(`\n  ⚠ ${warning}\n`))
      const { rebuildFromL0 } = await import('../../modules/memory/v2/migration/rebuild.js')
      const engine = opened.engine
      const r = rebuildFromL0(opened.db, { logger: await quietLogger(), caps: opened.caps, instanceId: opened.instanceId, config: () => ({ engine, extractInLegacy: true }) })
      console.log(`\n${green('✓')} Rebuilt from L0: run ${r.runId}, ${r.conversations} conversation(s), ${r.vaultGists} vault gist(s), ${r.failures} failure(s)\n`)
      if (r.failures > 0) process.exitCode = 1
    } catch (err: any) {
      console.error(`\n${red('✗')} Rebuild failed: ${err.message}\n`)
      process.exitCode = 1
    } finally {
      opened?.close()
    }
  },
})

const rebuildIndexCommand = defineCommand({
  meta: { name: 'rebuild-index', description: 'Drop and refill the FTS and vector indexes from stored rows' },
  args: { ...configArg },
  async run({ args }) {
    let opened: OfflineMemoryDb | null = null
    try {
      opened = await openOfflineMemoryDb(args.config || undefined)
      const { rebuildIndex } = await import('../../modules/memory/v2/migration/rebuild.js')
      const r = rebuildIndex(opened.db, opened.caps)
      console.log(`\n${green('✓')} Index rebuilt: ${r.ftsRows} FTS row(s), ${r.vecRows} vector row(s)${opened.caps.vec0 ? '' : dim(' (vec0 unavailable — vectors stay in memory_embedding)')}\n`)
    } catch (err: any) {
      console.error(`\n${red('✗')} Index rebuild failed: ${err.message}\n`)
      process.exitCode = 1
    } finally {
      opened?.close()
    }
  },
})

const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Mirror pinned gists and current facts into data/vault/generated as markdown' },
  args: {
    ...configArg,
    vault: { type: 'boolean', description: 'Required: write the vault mirror', default: false },
    scope: { type: 'string', description: 'all (default), global, or project:<id>' },
  },
  async run({ args }) {
    if (!args.vault) {
      console.error(`\n${red('✗')} eyas memory export needs --vault (the only export target today)\n`)
      process.exitCode = 1
      return
    }
    let opened: OfflineMemoryDb | null = null
    try {
      opened = await openOfflineMemoryDb(args.config || undefined)
      const { exportVault } = await import('../../modules/memory/v2/migration/export-vault.js')
      const r = exportVault(opened.db, { vaultRoot: opened.vaultRoot, scope: args.scope || undefined })
      console.log(`\n${green('✓')} Vault mirror written: ${r.files} file(s) under ${join(opened.vaultRoot, 'generated')}\n`)
    } catch (err: any) {
      console.error(`\n${red('✗')} Export failed: ${err.message}\n`)
      process.exitCode = 1
    } finally {
      opened?.close()
    }
  },
})

const status = defineCommand({
  meta: { name: 'status', description: 'Row counts per memory v2 table, engine flag, capabilities and the last migration run' },
  args: { ...configArg },
  async run({ args }) {
    let opened: OfflineMemoryDb | null = null
    try {
      opened = await openOfflineMemoryDb(args.config || undefined)
      const s = collectMemoryStatus(opened.db, opened.caps, { engine: opened.engine, instanceId: opened.instanceId, zstdTier: opened.zstdTier })
      console.log(`\n${formatMemoryStatus(s)}\n`)
    } catch (err: any) {
      console.error(`\n${red('✗')} Status failed: ${err.message}\n`)
      process.exitCode = 1
    } finally {
      opened?.close()
    }
  },
})

export default defineCommand({
  meta: { name: 'memory', description: 'Sovereign memory v2: migrate, rebuild, reindex, export, status' },
  subCommands: {
    migrate,
    rebuild,
    'rebuild-index': rebuildIndexCommand,
    export: exportCommand,
    status,
  },
})
```

- [ ] **Step 4: Register the command**

In `src/cli/index.ts` the map currently ends (lines 20–22):

```ts
    migrate: () => import('./commands/migrate.js').then((m) => m.default),
    version: () => import('./commands/version.js').then((m) => m.default),
  },
```

Change it to:

```ts
    migrate: () => import('./commands/migrate.js').then((m) => m.default),
    memory: () => import('./commands/memory.js').then((m) => m.default),
    version: () => import('./commands/version.js').then((m) => m.default),
  },
```

- [ ] **Step 5: Run the test, the type-check and a manual smoke**

Run: `bun vitest run tests/cli/memory.test.ts && bun run lint`
Expected: PASS (5 tests); `tsc` clean.

Run: `bun src/cli/index.ts memory status`
Expected: the status block with 25 table lines (`memory_embedding_vec` reads `absent` on a Mac without Homebrew SQLite) and `no migration run yet`.

Run: `bun src/cli/index.ts memory migrate --dry-run`
Expected: `Migration DRY RUN — nothing was written`, counts matching this instance (61 `conversation_messages.migrated`, 266 `vault.migrated`, 15 `memory_capture_runs.migrated`, 3 `agent_events.duplicate_of_parent_skipped`, 9 `agent_events.critic_verdict_not_migrated`), then `eyas memory status` still shows every table at 0 rows.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/memory.ts src/cli/index.ts tests/cli/memory.test.ts
git commit -m "feat(cli): eyas memory migrate | rebuild --from-l0 | rebuild-index | export --vault | status"
```

---
### Task 15: Documentation (six languages + `CLAUDE.md`) and whole-plan verification

**Files:**
- Modify: `CLAUDE.md` (the `### CLI Commands` list, lines 77–83)
- Modify: `packages/docs/src/content/docs/en/deploy/cli.md:39`, `hu/deploy/cli.md:39`, `de/deploy/cli.md:23`, `es/deploy/cli.md:23`, `fr/deploy/cli.md:23`, `tlh/deploy/cli.md:23`

**Interfaces:** none — prose only. The handbook is the user-facing surface of the CLI, and the repo rule is six languages for every user-facing addition.

- [ ] **Step 1: `CLAUDE.md`**

The list currently ends:

```markdown
- `eyas module list|enable|disable` — Module management
- `eyas version` — Version info
```

Change it to:

```markdown
- `eyas module list|enable|disable` — Module management
- `eyas memory migrate|rebuild --from-l0|rebuild-index|export --vault|status` — Sovereign memory v2 maintenance (legacy migration, rebuild from L0, reindex, vault mirror)
- `eyas version` — Version info
```

- [ ] **Step 2: English and Hungarian handbook tables**

`packages/docs/src/content/docs/en/deploy/cli.md` line 39 is the `eyas migrate …` row. Insert after it:

```markdown
| `eyas memory …` | Sovereign memory v2: `migrate [--dry-run] [--undo] [--backup]` (legacy stores → memory v2, idempotent), `rebuild --from-l0`, `rebuild-index`, `export --vault [--scope global\|project:<id>]`, `status`. Stop the server first. |
```

`packages/docs/src/content/docs/hu/deploy/cli.md` line 39 is the `eyas migrate …` row. Insert after it:

```markdown
| `eyas memory …` | Szuverén memória v2: `migrate [--dry-run] [--undo] [--backup]` (régi tárak → memória v2, idempotens), `rebuild --from-l0`, `rebuild-index`, `export --vault [--scope global\|project:<id>]`, `status`. Előtte állítsd le a szervert. |
```

- [ ] **Step 3: German, Spanish, French, Klingon command lines**

These four pages list the commands in one paragraph (line 23). Replace the `migrate (…)` fragment in each:

`de/deploy/cli.md`: replace `migrate (v1→v2, kein Daily-Ops).` with
`migrate (v1→v2, kein Daily-Ops), memory migrate/rebuild --from-l0/rebuild-index/export --vault/status (Speicher v2 — Legacy-Migration, Neuaufbau aus L0, Reindex, Vault-Spiegel; Server vorher stoppen).`

`es/deploy/cli.md`: replace `migrate (v1→v2, no ops diarias).` with
`migrate (v1→v2, no ops diarias), memory migrate/rebuild --from-l0/rebuild-index/export --vault/status (memoria v2 — migración heredada, reconstrucción desde L0, reindexado, espejo del vault; para el servidor antes).`

`fr/deploy/cli.md`: replace `migrate (v1→v2, pas du daily ops).` with
`migrate (v1→v2, pas du daily ops), memory migrate/rebuild --from-l0/rebuild-index/export --vault/status (mémoire v2 — migration de l’existant, reconstruction depuis L0, réindexation, miroir du vault ; arrête le serveur avant).`

`tlh/deploy/cli.md`: replace `migrate (v1→v2, jaj ops 'oHbe').` with
`migrate (v1→v2, jaj ops 'oHbe'), memory migrate/rebuild --from-l0/rebuild-index/export --vault/status (qawHaq v2 — ngo' qawHaq vIH, L0vo' chenmoHqa', DIr chu', vault 'ang; wa'DIch server yImev).`

- [ ] **Step 4: Verify the six pages and the docs build**

Run: `grep -l "eyas memory\|memory migrate" packages/docs/src/content/docs/*/deploy/cli.md | wc -l`
Expected: `6`.

Run: `bun run docs:build`
Expected: the Starlight build finishes without a markdown/table error (an unescaped `|` inside a table cell is the usual failure — the rows above escape it as `\|`).

- [ ] **Step 5: Whole-plan verification**

Run: `bun vitest run tests/modules/memory/v2 tests/cli/memory.test.ts`
Expected: PASS — this plan's files: p1d-contract (5), migration-ids (9), vault-ingest (8), legacy-fixture (2), raw-writer (4), migration-sources (5), migration-vault (7), migration-acceptance (6), migration-undo (2), rebuild-index (3), rebuild-from-l0 (4), export-vault (4), vault-watcher-l0 (3), cli/memory (5) = **67 tests**, plus whatever p1b/p1c placed in the same directory.

Run: `bun run lint && bun vitest run`
Expected: `tsc` clean; the full suite green (this plan adds no runtime behaviour to any existing path except the watcher hook, which is fail-open).

Acceptance items this plan owns (spec §15 Phase 1, spike §6):

| Acceptance | Where proven |
|---|---|
| Replaying the live store yields raw/gist/tag rows with zero model calls | `migration-acceptance.test.ts` (no gateway import anywhere under `migration/`) |
| Migration counts and hashes match (20 spot-checks) | `migration-acceptance.test.ts` |
| Migration re-run is a no-op (+1 migration run row only) | `migration-vault.test.ts`, `migration-acceptance.test.ts` |
| `datetime('now')` timestamps land at UTC | `migration-ids.test.ts`, `migration-acceptance.test.ts` |
| `LlmResponse` duplicate of the parent message skipped | `migration-sources.test.ts`, `migration-acceptance.test.ts` |
| Vault hash = SHA-256 of the file bytes | `vault-ingest.test.ts`, `migration-acceptance.test.ts` |
| `--undo` leaves legacy tables untouched, removes only migrated rows | `migration-undo.test.ts` |
| `rebuild --from-l0` reproduces the gists from L0 and replays extraction in `occurred_at` order | `rebuild-from-l0.test.ts` |
| `rebuild-index` is a tested command | `rebuild-index.test.ts` |
| Vault export renders pinned gists + facts as `generated: true` markdown | `export-vault.test.ts` |
| Vault edits enter L0 as `document` occurrences | `vault-watcher-l0.test.ts`, `vault-ingest.test.ts` |
| `eyas memory …` commands exist and are registered | `tests/cli/memory.test.ts` |

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md packages/docs/src/content/docs/en/deploy/cli.md packages/docs/src/content/docs/hu/deploy/cli.md packages/docs/src/content/docs/de/deploy/cli.md packages/docs/src/content/docs/es/deploy/cli.md packages/docs/src/content/docs/fr/deploy/cli.md packages/docs/src/content/docs/tlh/deploy/cli.md
git commit -m "docs: eyas memory commands in CLAUDE.md and the six-language CLI reference"
```

- [ ] **Step 7: Hand over**

Report the test counts and the commit list to the owner. Note for the owner's cutover: `eyas memory migrate --backup` on the live instance (server stopped), then `eyas memory status`; `memory.engine: v2` in `config/local.yaml` switches the read/write path once plans p1b/p1c are live (this plan never flips it).

---

## Self-review

**1. Spec coverage (P1d scope).**
- §14 principles — additive schema (no legacy `ALTER`/`DROP`: Tasks 5–7 only INSERT into `memory_*`); deterministic re-runnable ULIDs (Task 2 `legacyId` = `generateIdAt(sourceMs, SHA-256('legacy:<table>:<pk>'))`); real `occurred_at` (Tasks 5–8); vault files never rewritten (Task 7 reads only; Task 12 writes only under `generated/`); `memory.engine` read by the CLI status (Task 14), never flipped; `migrated_from` link per raw row (Task 5) and per skipped duplicate (Task 6); own `memory_run(run_type='migration')` with counts in `stats_json`, idempotent by construction, no flag (Task 7); disaster-recovery backup before migration (`--backup`, Task 14); `--undo` removes only migrated rows (Task 9). ✓
- §14 table rows: `conversation_messages` (Task 6), `agent_events` `LlmResponse` with the session join, parent-duplicate skip, `actor` from the session, `CriticVerdict` not migrated (Task 6), `episodic_memories`/`archive_memories` → raw + fact, `presence_tier='cold'` (Task 6), vault notes → document + depth-0 gist + tags + source link with heading strip / first paragraph / `structured_json` / `import-job` → changelog / `imported` dropped (Tasks 3, 7), `memory_note_links` same-second then ±60 s (Task 7), `memory_capture_runs` status mapping (Task 7), `working_memory` flushed as `document` (Task 6), `memory_blocks`/`team_memory` not migrated (nothing reads them). ✓
- §14 "Rebuild-from-log" → Task 11; "Vault export" → Task 12; §4 "Every vault file is ingested into L0 … hash = SHA-256 of the file bytes computed at ingestion" → Tasks 3, 13; `rebuild-index` as a tested command → Task 10. ✓
- Spike §2 #21 (i)–(x): (i) Task 3/7 SHA-256 of bytes, `vault_index.file_hash` only consulted for the "row without file" surprise; (ii) Task 6; (iii) Task 2; (iv) Task 5 blob key + `ref_count`; (v) Task 5; (vi) Task 7; (vii) Task 6 `meta_json.attachments`; (viii) Task 6 counts `critic_verdict_not_migrated`; (ix) Task 7; (x) Tasks 3, 7. Spike §4.3 #6 seeded episodic/archive rows → Task 4. Spike §5 `migrate-dryrun.ts` → Tasks 5–7, `verify.ts` → Task 8. ✓
- §16-7 imports are `owner` → Task 3 (`trustTier: 'owner'`) and Task 7 gist `trust_tier='owner'`. ✓
- Interfaces contract: `MigrationReport`, `migrateLegacy(db, { vaultRoot, dryRun?, logger })`, `undoMigration(db)`, `rebuildFromL0(db, { logger })`, `rebuildIndex(db, caps)`, `exportVault(db, { vaultRoot, scope? })`, the five CLI sub-commands, `captureUnit` from the watcher path — all with the contract names; extra optional parameters (`caps`, `instanceId`, `now`, `runExtraction`, `config`) are additive.
- Deliberately out of scope: the `memory.engine` flip and the read-path switch (Phase 2), `save_memory` retirement / Dockerfile / k8s (p1e), extraction of migrated history (p1c via `rebuild --from-l0` or the P1c backlog queue — §16-10 "L0 backfill + queue"). Gap: none found for P1d.

**2. Placeholder scan.** No "TBD/TODO/implement later/similar to Task N"; every code step is complete TypeScript; every test step has a runnable command and an expected result; the four "run it" steps that depend on host capabilities (vec0, sqlite-vec on macOS) state the exact early-return behaviour. Task 3's `parseFeedbackStructure`, Task 7's `listVaultMarkdown` and Task 12's `slugify` are written out rather than referenced.

**3. Type consistency.** `MigratedRawRow` (Task 5) is what `ctx.writeRaw` (Task 6) takes and what every migrator passes (Tasks 6, 7) — same field names, `conversationId: string | null`, `meta: Record<string, unknown> | null`. `RawWriteOutcome.contentHash` is read in Task 6 (`out.contentHash` is not used by the fact writer, which hashes `objectText` itself). `MigrationContext extends RawWriterDeps` so `writeMigratedRaw(ctx, row)` type-checks; `GistWriterDeps` (Task 7) is satisfied by `MigrationContext` and by the object literal in Task 11 (`{ db, caps, instanceId, runId, nowMs, bump }`). `VaultGistDerivation` (Task 3) is the `derivation` field of `MigratedGistInput` (Tasks 7, 11). `legacyId(ms, seed)` seeds are identical between the migration and the rebuild (`legacy:vault_gist:<rel>`), which is what makes Task 11's "same gist ids" assertion true. `toEpochMs(value, where)` is used with the same argument order everywhere. `MemoryLinkType` includes every value the spec lists; `insertLink` returns the boolean Task 5 forwards as `linkInserted`. `MigrationReport` shape in Task 7 matches `formatMigrationReport` (Task 14) and the tests in Tasks 7–8. `OfflineMemoryDb.close()` is called in every `finally`. The `memory_gist` INSERT (Task 7) names only columns the Task 1 gate asserts.
