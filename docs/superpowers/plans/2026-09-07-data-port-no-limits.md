# Data Port — No Limits Implementation Plan (R11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every cap and keep-list from the data-port importer so that a scan maps every directory under the chosen root, every text file is a selected candidate, secrets are stored verbatim and hidden only at recall, bodies are byte-for-byte, every applied item carries its adapter, alias paths and content digest, and a tree ten times larger than the owner's (26 000 text files, 1 766 transcripts, 81 MB) is scanned, reviewed and imported without holding it in memory — idempotently, additively, with scan and import times reported.

**Architecture:** The walker becomes a generator that classifies directories (nine D-9 classes → one counted row each), counts a class directory cooperatively (ticks inside the count) and yields every file with its owning skill package; the scanner streams rows into a `data_port_candidates` table in batched transactions while the scan runs in the background — it never holds the row list: a skill package is buffered only until the walker leaves it, byte-identical duplicates are decided inline against an identity map, and alias paths reach already-flushed rows as patch events applied by `UPDATE`; a shared, ordered selection resolver (server module + verbatim web copy, one JSON fixture) turns folder/kind gestures into a resolved selection; the runner walks the table by keyset in pages of 500, keeps one container open, flushes the ledger per 100 items, persists a cursor and resumes after a restart; the secrets heuristic tags instead of refusing, and the memory module's index, related-work and search filter `contains-secrets` unless `memory.recall.includeSecrets` is on; the wizard renders a folder tree + virtualised candidate list + preview sheet and never loads the whole list.

**Tech Stack:** Bun 1.x, TypeScript 5.9 strict ESM, Hono, Drizzle + bun:sqlite (better-sqlite3 fallback, `SQLITE_MAX_VARIABLE_NUMBER` 32 766 respected), Zod, Vitest, React 19 + shadcn + `@tanstack/react-virtual` 3.14.6 (MIT, already in `src/web/package.json`), Astro Starlight docs (six languages). No new dependency. No gray-matter in data-port. No model call in the import path.

**Spec:** `docs/superpowers/specs/2026-09-07-data-port-no-limits-amendment.md` (R11.1–R11.8, D-7..D-9) — binding; it overrides `docs/superpowers/specs/2026-09-06-data-port-lossless-import-design.md` and every earlier ruling.

## Global Constraints

- Dev checkout only: `/Users/eyssen/GitHub/eyas` (port 3100). Never touch `/Users/eyssen/eyas` (live, port 3000) or its `data/`.
- **Never commit, branch or push.** Every task ends with green tests and a `git status --short` review; the owner commits.
- No version bump (`package.json`, `src/web/package.json`, `version.json`, HTML strings stay at `0.8.23-beta`). `CHANGELOG.md` changes stay under `## [Unreleased]`.
- No machine-specific paths, tenant names, vault folder names or Odoo-flavoured logic in committed source or tests. Fixtures use `alpha` / `bravo` / `charlie` names only. Session-note detection keys on `claude-sessions/` and `type: claude-session | grok-session`, never on a vault folder name.
- Every new user-facing string exists in `en, hu, de, es, fr, tlh` (`src/web/src/pages/settings/locales/*.json` for the wizard, `src/web/src/pages/memory/locales/*.json` for the memory page — flat dotted keys, each page reads its own bundle) — Task 1 adds all of them at once; no later task touches a locale file. Docs changes land in all six `packages/docs/src/content/docs/<lang>/…` trees (Task 16).
- **No caps anywhere in the scan or the import** (R11.1): the only remaining hard limits are transport limits — the 50 MiB HTTP upload body (`UPLOAD_BODY_BYTES`), one API page (`CANDIDATE_PAGE_MAX` 500 rows per response, paging unbounded) and one selection payload (`SELECTION_MAX_ROWS` 50 000 / `SELECTION_MAX_GROUPS` 5 000 — bulk gestures are folder/kind groups, never id lists). A grep guard (Task 4) fails the build if `MAX_SCAN_FILES`, `MAX_DIRS_TO_VISIT`, `WIDE_ROOT_KEEP`, `isWideScanRoot`, `SKIP_UNDER_AI_DOT`, `SESSION_DIR_KEEP`, `CLAUDE_PROJECT_DIR`, `AI_ITEM_LIMIT`, `truncated` or `maxFiles` reappear under `src/modules/data-port`. The optional enrichment (`enrich: true`) has no item cap either — it is opt-in and per item; its cost is time. The one runtime limit that is not a policy is the engine's string size (`STRING_LIMIT_BYTES`, ≈ 512 MiB): a single text file above it cannot become one JavaScript string, so the runner reports it with the truthful reason `exceeds-string-limit` (six-language label) instead of a generic `error` (P-17).
- Imported bodies are verbatim (R11.5): no trim, no size cap, no rewriting; the vault writer's single trailing newline and the dropped UTF-8 BOM (an encoding signature, not text) are the two documented exceptions.
- Memory sovereignty: an import never modifies an existing row; kind `user` only when the source declared it.
- `looksLikeSecrets` is a **flag**, never a refusal. `reasonCode: 'secrets'` and `'too-large'` must not survive anywhere under `src/modules/data-port` (Task 17 grep).
- No model call in the import path unless the owner explicitly opts into `enrich: true` (metadata-only, spec D-4, default off, never on a `contains-secrets` item); embeddings never — every episodic row the importer creates is created with `embed: false`.
- File headers: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Tests: `bun vitest run <file>`; whole suite `bun run test`; types `bun run lint` (record the error count once before Task 1 and never exceed it).

## Decisions fixed by this plan (owner may override; none is left open)

| # | Question | Decision |
|---|----------|----------|
| P-1 | Reason code for a skipped directory class | Emitted string is `directory-skipped:<class>`; `REASON_CODES` holds the bare prefix `directory-skipped`; the locale key is `settings.dataPort.reason.directory-skipped` with `{{detail}}` = class; `reasonPrefix()` splits at the first `:`. The class also travels on `candidate.directory.class`. |
| P-2 | D-8 kind for source files | New kind `code` (`reasonCode: 'source-code'`, target `vault.semantic`, importable, **unticked**). Data/config text (`.yaml .toml .ini .csv .log .xml .html .env .pem …`, assistant `settings.json`, `.grok/relocations/*`, `config.toml`, `history.jsonl`) → kind `knowledge`, `reasonCode: 'data-file'` / `'config'` / `'unknown-json'`, importable, **unticked**. Kind `unknown` is never emitted again. |
| P-3 | Credential-shaped files (`.env`, `credentials.json`, `id_rsa`, Codex `auth.json`) | Text rows (`knowledge` / `data-file` or `config`), importable, **unticked**, tagged `contains-secrets`. A memory note, rule, skill or transcript that merely contains a key keeps its own kind and stays **ticked**, tagged `contains-secrets`. |
| P-4 | D-9 markers | `node_modules`, `.git`/`.hg`/`.svn`, `.cache`, `__pycache__`, `.venv`/`venv` by bare name (D-9 literal); `dist`/`build`/`out`/`.next`/`.turbo`/`target` only when the parent holds a build manifest (`package.json`, `tsconfig.json`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `go.mod`, `build.gradle*`, `pom.xml`, `CMakeLists.txt`, `Makefile`, `deno.json`, a lockfile) — `Documents/build/notes.md` is still mapped; browser profiles by content markers (`Local State`+`Default`, `Preferences`+`History|Cookies|Web Data`, `prefs.js`+`places.sqlite`), location-agnostic; `.Trash`/`.Trashes`/`$RECYCLE.BIN`, `.local/share/Trash`; `Caches` directly under `Library`. `.DS_Store` is a **file** row (`app-state`, never read). The scan root itself is never classified. `~/Library` is otherwise walked in full. |
| P-5 | Transcript extras | Sub-agent / workflow transcripts (`projects/<slug>/<sid>/subagents/**/*.jsonl`, `agent-transcripts/<id>/subagents/*.jsonl`) are separate episodic rows tagged `subagent`, `parent-session:<id>`, `workflow:<id>`; `tool-results/*.txt` beside a session → kind `session`, `reasonCode: 'session-artifact'`, unticked; `isMeta: true` user lines render as `**meta:**`; `system` lines render; unknown typed lines are counted in `metaLines`; a rendered session over `MAX_EPISODIC_BODY_BYTES` (256 MiB) is stored as ordered parts `transcript#n` tagged `session-part:n/of`, never truncated. |
| P-6 | Runner order | Keyset on `seq` (scan emission order). The scanner emits every unit of a container consecutively and `finalizeScan` no longer sorts, so a container's units are contiguous by construction (asserted by test). One container open at a time. |
| P-7 | Batching | Apply functions run outside any transaction (they write files and are async); ledger rows + the job row (stats, progress, `cursor_seq`, `elapsed_ms`) are flushed together in one `BEGIN IMMEDIATE` per 100 items with an item-by-item fallback when the batch COMMIT fails. Index rebuilt once at the end. |
| P-8 | Restart | `running`/`pending` jobs are **resumed** from `cursor_seq` (phase `resuming`), not failed; a single-runner queue runs one job at a time per process; `POST /jobs/:id/cancel` is observed at the next batch boundary; `DELETE /scans/:id` cancels a running scan cooperatively and purges its rows. |
| P-9 | Scan execution | `POST /import/scan` validates the path eagerly (missing / not a directory → 400), inserts the header with `status: 'running'` and returns **202** before any walking: the drive starts on the next tick (`setImmediate`), so the 202 summary is `running` for every tree size. The drive inserts rows in batches of 500 per `BEGIN IMMEDIATE` and yields to the event loop every 500 files / 200 directories — inside a class-directory count and inside a streamed hash too, never only between files; `GET /scans/:id` is polled every second. Uploads stay synchronous (`status: 'done'`). Job creation answers 409 while the scan is `running`. |
| P-10 | Selection wire | `{ base: 'default'\|'all'\|'none', groups: [{kind?, folder?, selected}] (ordered, last match wins, any folder depth), rows: [{candidateId, selected?, target?}] }`. Resolution: `!importable → false`; else row → last matching group → base. `importable = target !== 'none'`. Legacy `selection: [{candidateId, target?}]` is still accepted and normalised. One resolver module, copied verbatim into the web app, both suites run `tests/fixtures/data-port/selection-cases.json`. |
| P-11 | Preview endpoint | `GET /scans/:id/candidates/:cid/preview` needs `create` on DataPort (the same right that produced the scan); reads `source_path` from the row only; 64 KiB head cut on a UTF-8 boundary; secrets returned verbatim (D-7 is a recall rule). |
| P-12 | Old scans | `migrateLegacyScans()` runs at startup right after the resume sweep: every `format = 1` scan row with a non-empty `candidates_json` blob is parsed once, inserted into the table, and set to `format = 2, candidates_json = '[]'`; a blob that fails to parse marks the scan `failed` with a `legacy` warning. Retention: candidate rows of scans older than the 10 newest **and** older than 30 days are deleted unless a `pending`/`running` job references them. |
| P-13 | Idempotency across the whitespace change | Verbatim digests are the new identity; every lookup falls back to the pre-amendment trimmed digest (`legacyBody()`, `assembleSkillContentLegacy()`) so the owner's live import reports `unchanged`, never duplicates (R11.8). |
| P-14 | Upload body limit | `UPLOAD_BODY_BYTES` (50 MiB) stays as a transport limit on `POST /scan-upload`; the docs point at the path scan for anything larger. |
| P-15 | Skill inline cap | `MAX_INLINE_ASSET_CHARS` (200 000) stays as a rendering clip of the inline copy inside the skill body; the on-disk copy is byte-exact and complete; documented. |
| P-16 | Third-party / legacy in recall | Both are ordinary recallable notes (the amendment says so); no ranking demotion in this wave. |
| P-17 | A text file above the engine's string limit | `STRING_LIMIT_BYTES` (512 MiB) is a runtime fact, not a policy: the scan lists the row like any other (`large-file` warning, full sha256, importable, ticked when its kind says so); the runner skips it with `reasonCode: 'exceeds-string-limit'` (six-language label, counted in `skippedReasons`) instead of a generic `error`. Streaming such a body into the vault is deferred; the row says why. |
| P-18 | Streaming finalize | The old finalize passes (content dedupe, dir aliases, skill assets, orphan assets) never run over a collected row list. Duplicates are decided inline against an identity map (`sha256`, or skill digest + bundled assets) the moment a row is complete; a skill package is buffered until the walker yields `skill-package-done` for its root; alias paths reach a row through `candidate-patch` / `dir-alias` events, which `driveScan` applies as `UPDATE … WHERE scan_id = ? AND id = ?` (JSON1 append) and the collecting `scanDirectory` applies to its array. The generator holds ids, digests and paths — never rows. |
| P-19 | Recall exclusion covers every model-facing consumer | `contains-secrets` is filtered in the memory index, related work, `search_memory`, the reflection job, the nightly consolidator's clustering, and the skill matcher (both call sites) — one accessor (`recallIncludesSecrets`) decides everywhere; a promoted cluster that includes a flagged row (only with the flag on) carries the tag onto the written note. |
| P-20 | Skill inline clip (P-15) is documented | `admin/data-port.md` ×6 and the CHANGELOG say: a bundled skill file over 200 000 characters is inlined up to that point with a marker naming the on-disk copy; that copy under the skill's asset directory is byte-exact and complete. |

## File structure

**Create**
- `src/modules/data-port/candidates-store.ts` — every SQL statement touching `data_port_candidates` / `data_port_scan_dirs`.
- `src/modules/data-port/selection.ts` — `compileSelection`, `normaliseSelection`, `SelectionWire`.
- `src/modules/data-port/adapters/transcript-paths.ts` — provider transcript path patterns and facts.
- `src/modules/data-port/scanners/directory-classes.ts` — `classifyDirectory`, `countTree`, `collectCount`, `nameClass`.
- `src/modules/skills/recallable.ts` — `recallableSkills(skills, includeSecrets)` (Task 13, P-19).
- `src/web/src/pages/settings/data-port-types.ts`, `data-port-selection.ts`, `data-port-pages.ts`, `data-port-reason-label.ts`, `data-port-progress.ts`, `data-port-folder-tree.tsx`, `data-port-candidate-list.tsx`, `data-port-preview.tsx`, `data-port-review.tsx`.
- `tests/fixtures/data-port/selection-cases.json`.
- Tests: `tests/modules/data-port/{no-caps,scan-directory-classes,scan-stream,candidates-store,selection-resolver,candidates-routes,job-selection-filter,runner-streaming,runner-resume,preview,legacy-scan-migration,locale-vocabulary,scale}.test.ts`, `tests/modules/data-port/adapters/transcript-paths.test.ts`, `tests/web/data-port-{selection,pages,reason-label,progress,folder-tree,candidate-list,preview,review,card,locale-parity}.test.ts(x)`.

**Modify**
- `src/modules/data-port/{types,constants,schema,ledger,service,routes,index,source-frontmatter,skill-package,apply-deps,rollback}.ts`, `scanners/{scan-path,heuristics,instructions}.ts`, `pipeline/{transform,apply}.ts`, `adapters/{types,registry,claude-code,cursor,codex,chat-export,gemini-cli,windsurf,generic}.ts`.
- `src/core/config/schema.ts`, `config/default.yaml`, `src/modules/memory/{memory-index,related-work,memory-service,index,routes,types,reflection-job}.ts`, `src/modules/memory/consolidator/{index,semantic-promoter}.ts`, `src/modules/memory/tiers/episodic-memory.ts`, `src/modules/tools/builtin/memory-tools.ts`, `src/modules/conversations/{routes,skill-gate}.ts`, `src/modules/skills/routes.ts`, `src/web/src/pages/memory/memory-dashboard.tsx`.
- `src/web/src/pages/settings/data-port-card.tsx`, `src/web/src/pages/settings/locales/{en,hu,de,es,fr,tlh}.json`, `src/web/src/pages/memory/locales/{en,hu,de,es,fr,tlh}.json`, `vitest.config.ts`.
- `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/{admin/data-port,knowledge/memory,deploy/configuration}.md`, `CHANGELOG.md`.
- Existing tests named per task.

## Waves — disjoint file sets, up to three implementers per wave

| Wave | Tasks (parallel) | Depends on |
|------|------------------|------------|
| 0 | **T1** vocabulary + six locales · **T2** schema + ledger columns · **T3** config + memory-index secrets gate | — |
| 1 | **T4** walker + directory classes · **T5** secrets heuristic + classification defaults · **T6** adapters + streaming JSONL | T1 |
| 2 | **T7** scanDirectory as an event stream · **T8** candidate store + shared selection resolver · **T10** verbatim frontmatter + skill package | T4–T6 / T1–T2 / — |
| 3 | **T9** service + routes (table-backed scans, background scan, paging, counts, preview, filter jobs, migration) · **T11** apply pipeline provenance + digests + tags · **T13** recall exclusion | T7–T8 / T3, T10 / T3 |
| 4 | **T12** streaming, resumable runner · **T14** web pure modules + vitest config · **T16** docs ×6 + CHANGELOG | T9, T11 / T1 / T1–T13 |
| 5 | **T15** web wizard components · **T17** end-to-end fixture, scale test, owner re-run, verification | T14, T9 / all |

Within a wave the file sets are disjoint; a task never edits a file another task of the same wave owns. Locale JSON files (settings **and** memory bundles) are owned by T1 only; `service.ts` is owned by T9 (scan/persist/create/list/count/preview/migrate) and then by T12 (`runJob`, queue, resume, cancel) in a later wave.

---

## Phase 0 — Contracts

### Task 1: Vocabulary contract — kinds, classes, tags, warnings, phases, constants, six locales

**Files:**
- Modify: `src/modules/data-port/types.ts`, `src/modules/data-port/constants.ts`
- Modify: `src/web/src/pages/settings/locales/{en,hu,de,es,fr,tlh}.json`
- Modify: `src/web/src/pages/memory/locales/{en,hu,de,es,fr,tlh}.json` (one key, `memory.episodic.chars` — the memory dashboard reads this bundle through `./i18n`)
- Modify: `tests/modules/data-port/reason-codes.test.ts`
- Create: `tests/modules/data-port/locale-vocabulary.test.ts`

**Interfaces:**
- Produces: `CANDIDATE_KINDS`, `DIRECTORY_CLASSES` / `DirectoryClass`, `CANDIDATE_TAG_LABELS`, `CANDIDATE_WARNINGS` / `CandidateWarning`, `SCAN_WARNING_CODES` / `ScanWarning`, `JOB_PHASES`, `reasonPrefix(code)`, `ScanCandidate` (+ `directory`, `warnings`, `tags`, `turns`, `seq`, `folder`, `importable`), `ScanResult.stats` (new shape), `ScanSummary`, `PublicCandidate`, `CandidateCounts`, `CandidateFilter`, `SelectionWire`, `JobSelection`, `ImportJob` (+ `selectionMode`, `selectionTotal`, `cursorSeq`, `startedAt`, `importMs`), `ImportJobStats` (+ `total`, `elapsedMs`, `resumed`); constants `LARGE_TEXT_WARN_BYTES`, `LARGE_CONTAINER_WARN_BYTES`, `UPLOAD_BODY_BYTES`, `SNIFF_BYTES`, `STREAM_CHUNK_BYTES`, `PROGRESS_EVERY_FILES`, `PROGRESS_EVERY_DIRS`, `SCAN_FLUSH_ROWS`, `JOB_BATCH_SIZE`, `CANDIDATE_PAGE_DEFAULT`, `CANDIDATE_PAGE_MAX`, `SELECTION_MAX_ROWS`, `SELECTION_MAX_GROUPS`, `MAX_EPISODIC_BODY_BYTES`, `STRING_LIMIT_BYTES`, `SCAN_RETENTION`.

- [ ] **Step 1: Extend the parity test and write the vocabulary test**

```ts
// tests/modules/data-port/reason-codes.test.ts — replace the spot-check case and add one
  it('holds the codes the runner and the scanner actually emit', () => {
    for (const code of [
      'unchanged', 'missing-unit', 'orphan-asset', 'not-durable', 'service-unavailable',
      'unsupported-target', 'error', 'directory-skipped', 'source-code', 'data-file', 'session-artifact', 'exceeds-string-limit',
    ]) expect(REASON_CODES).toContain(code)
  })

  it('carries no code nothing emits any more', () => {
    expect(REASON_CODES).not.toContain('too-large')
    expect(REASON_CODES).not.toContain('secrets')
  })

  it('splits a classed code at its first colon', () => {
    expect(reasonPrefix('directory-skipped:node_modules')).toBe('directory-skipped')
    expect(reasonPrefix('memory-note')).toBe('memory-note')
  })
```

```ts
// tests/modules/data-port/locale-vocabulary.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every vocabulary the wizard translates by code — kinds, directory classes,
// candidate tags, candidate warnings, scan warnings, job phases — has one flat
// key per value in all six locale files, and no key for a value that is gone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CANDIDATE_KINDS, DIRECTORY_CLASSES, CANDIDATE_TAG_LABELS, CANDIDATE_WARNINGS,
  SCAN_WARNING_CODES, JOB_PHASES,
} from '@modules/data-port/types'

const LOCALE_DIR = resolve(process.cwd(), 'src/web/src/pages/settings/locales')
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh']
const load = (lang: string) =>
  JSON.parse(readFileSync(resolve(LOCALE_DIR, `${lang}.json`), 'utf-8')) as Record<string, string>

const VOCABULARIES: Array<{ prefix: string; values: readonly string[]; extra?: string[] }> = [
  { prefix: 'settings.dataPort.wizard.kind.', values: CANDIDATE_KINDS, extra: ['all'] },
  { prefix: 'settings.dataPort.wizard.dirClass.', values: DIRECTORY_CLASSES },
  { prefix: 'settings.dataPort.wizard.tag.', values: CANDIDATE_TAG_LABELS },
  { prefix: 'settings.dataPort.wizard.warning.', values: CANDIDATE_WARNINGS },
  { prefix: 'settings.dataPort.scanWarning.', values: SCAN_WARNING_CODES, extra: ['legacy'] },
  { prefix: 'settings.dataPort.wizard.phase.', values: JOB_PHASES },
]

describe('wizard vocabularies ↔ locale keys', () => {
  for (const v of VOCABULARIES) {
    it(`${v.prefix} has one key per value in six languages and no orphan`, () => {
      const allowed = new Set([...v.values, ...(v.extra ?? [])])
      for (const lang of LANGS) {
        const bundle = load(lang)
        const present = Object.keys(bundle).filter((k) => k.startsWith(v.prefix)).map((k) => k.slice(v.prefix.length))
        const missing = [...allowed].filter((k) => typeof bundle[v.prefix + k] !== 'string' || !bundle[v.prefix + k])
        const orphan = present.filter((k) => !allowed.has(k))
        expect({ lang, prefix: v.prefix, missing, orphan }).toEqual({ lang, prefix: v.prefix, missing: [], orphan: [] })
      }
    })
  }

  it('has the episodic length label in the memory bundle, six languages', () => {
    const MEMORY_DIR = resolve(process.cwd(), 'src/web/src/pages/memory/locales')
    for (const lang of LANGS) {
      const bundle = JSON.parse(readFileSync(resolve(MEMORY_DIR, `${lang}.json`), 'utf-8')) as Record<string, string>
      expect({ lang, value: bundle['memory.episodic.chars'] }).toEqual({ lang, value: expect.stringContaining('{{count}}') })
      expect(load(lang)['memory.episodic.chars']).toBeUndefined()
    }
  })

  it('keeps every settings.dataPort.* key and its placeholders in all six languages', () => {
    const en = load('en')
    const keys = Object.keys(en).filter((k) => k.startsWith('settings.dataPort.'))
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    for (const lang of LANGS.slice(1)) {
      const bundle = load(lang)
      const missing = keys.filter((k) => typeof bundle[k] !== 'string' || !bundle[k])
      const drift = keys.filter((k) => bundle[k] && placeholders(bundle[k]).join() !== placeholders(en[k]!).join())
      const extra = Object.keys(bundle).filter((k) => k.startsWith('settings.dataPort.') && !(k in en))
      expect({ lang, missing, drift, extra }).toEqual({ lang, missing: [], drift: [], extra: [] })
    }
  })
})
```

- [ ] **Step 2: Run both tests to verify they fail**

Run: `bun vitest run tests/modules/data-port/reason-codes.test.ts tests/modules/data-port/locale-vocabulary.test.ts`
Expected: FAIL — `reasonPrefix` / `CANDIDATE_KINDS` … are not exported; `too-large` and `secrets` still listed.

- [ ] **Step 3: Write the types**

```ts
// src/modules/data-port/types.ts — additions and replacements (the rest of the file is unchanged)

export const CANDIDATE_KINDS = [
  'memory', 'index', 'session', 'skill', 'rule', 'identity', 'persona', 'knowledge', 'code', 'noise', 'unknown',
] as const
export type CandidateKind = (typeof CANDIDATE_KINDS)[number]

/** D-9: the only directory classes the walker does not enter. Each is one counted row. */
export const DIRECTORY_CLASSES = [
  'node_modules', 'vcs', 'cache', 'pycache', 'venv', 'build-output', 'browser-profile', 'trash', 'os-cache',
] as const
export type DirectoryClass = (typeof DIRECTORY_CLASSES)[number]

/** Tags a candidate may carry that the wizard shows as badges (the applied item keeps them as tags). */
export const CANDIDATE_TAG_LABELS = ['legacy', 'third-party', 'contains-secrets', 'subagent'] as const

/** Informational marks on a row; never affect `selectedByDefault`. */
export const CANDIDATE_WARNINGS = ['large-file', 'secrets-scan-head-only', 'symlink-cycle'] as const
export type CandidateWarning = (typeof CANDIDATE_WARNINGS)[number]

export const SCAN_WARNING_CODES = [
  'instructions-applied', 'home-root-mapped', 'directories-skipped', 'large-files', 'rows-passed-over',
  'symlink-cycles', 'unreadable', 'scan-failed',
] as const
export type ScanWarningCode = (typeof SCAN_WARNING_CODES)[number]
export interface ScanWarning {
  code: ScanWarningCode | 'legacy'
  params?: Record<string, string | number>
  /** English, for logs; the UI translates `settings.dataPort.scanWarning.<code>`. */
  message: string
}

export const JOB_PHASES = ['queued', 'read', 'apply', 'index', 'done', 'error', 'resuming', 'cancelled'] as const
export type JobPhase = (typeof JOB_PHASES)[number]

export const REASON_CODES = [
  // Scanner: what a file is
  'memory-note', 'memory-index', 'session-summary', 'transcript', 'session-artifact', 'skill', 'skill-package',
  'slash-command', 'rules-file', 'cursor-rule', 'persona', 'identity', 'tools-policy', 'config', 'source-code',
  'data-file', 'derived-index', 'app-state',
  // Scanner: a directory mapped as one row, never descended (D-9). Emitted as
  // `directory-skipped:<class>`; the locale key is the bare prefix.
  'directory-skipped',
  // Scanner: why a file was passed over (no text content) or labelled
  'not-durable', 'unrecognised', 'binary', 'empty', 'unreadable', 'outside-root', 'symlink-upload',
  'duplicate-content', 'orphan-asset', 'invalid-json', 'unknown-json', 'needs-bun',
  // Runner and apply
  'not-importable', 'missing-unit', 'unsupported-target', 'service-unavailable', 'not-a-persona', 'no-agent',
  'unchanged', 'error',
  // Runner: a single text file the engine cannot hold as one string (P-17) — a truthful reason, never a silent error.
  'exceeds-string-limit',
] as const
export type ReasonCode = (typeof REASON_CODES)[number]

/** `directory-skipped:node_modules` → `directory-skipped`; a plain code is itself. */
export function reasonPrefix(code: string): string {
  const at = code.indexOf(':')
  return at < 0 ? code : code.slice(0, at)
}

export interface ScanCandidate {
  id: string
  relativePath: string
  classifiedPath?: string
  scope?: string
  kind: CandidateKind
  target: CandidateTarget
  title: string
  preview: string
  /** stat size for every row, read or not; 0 for a directory row. */
  bytes: number
  confidence: number
  reason: string
  reasonCode: string
  selectedByDefault: boolean
  content?: string
  adapterId?: SourceProfile
  sourcePath?: string
  unit?: string | null
  sha256?: string
  mtime?: string
  birthtime?: string
  assets?: Array<{ relPath: string; bytes: number; sha256: string; binary: boolean; containsSecrets?: boolean }>
  notBundled?: Array<{ relPath: string; bytes: number; reason: string }>
  paths?: string[]
  sessionId?: string | null
  sessionDate?: string | null
  /** Present only on `directory-skipped:*` rows. */
  directory?: { class: DirectoryClass; files: number; dirs: number; unreadable: number }
  warnings?: CandidateWarning[]
  /** Adapter- and classifier-derived tags the applied item keeps (`legacy`, `third-party`, `contains-secrets`, `subagent`, `claude-project:<slug>` …). */
  tags?: string[]
  turns?: number | null
  /** Set by the candidate store on read: scan emission order and the row's folder. */
  seq?: number
  folder?: string
  importable?: boolean
}

export interface ScanStats {
  filesScanned: number
  filesSkipped: number
  totalBytes: number
  dirsVisited: number
  dirsSkipped: Record<DirectoryClass, number>
  filesInSkippedDirs: number
  symlinksFollowed: number
  symlinkAliases: number
  symlinkCycles: number
  unreadable: number
  largeFiles: number
  scanMs: number
}

/** Scanner-internal shape (what `scanDirectory` collects). The API answers with `ScanSummary`. */
export interface ScanResult {
  scanId: string
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  instructions: string | null
  candidates: ScanCandidate[]
  dirs: ScanDirRow[]
  stats: ScanStats
  warnings: ScanWarning[]
}

export interface ScanDirRow {
  path: string
  parent: string | null
  name: string
  depth: number
  skippedClass: DirectoryClass | null
  fileCount: number
  aliasOf: string | null
}

export type ScanStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface CountBucket { total: number; importable: number; selectedByDefault: number }
export interface CandidateCounts {
  total: number
  importable: number
  selectedByDefault: number
  byKind: Array<{ key: string; total: number; importable: number; selectedByDefault: number }>
  byReason: Array<{ key: string; total: number }>
  byFolder: Array<{ key: string; total: number; importable: number; selectedByDefault: number }>
}

export interface ScanSummary {
  scanId: string
  status: ScanStatus
  sourceProfile: SourceProfile
  detectedProfile: SourceProfile
  rootPath: string
  instructions: string | null
  stats: ScanStats & { candidateCount: number; directoriesMapped: number }
  progress: { dirsVisited: number; filesSeen: number; candidates: number; bytes: number; elapsedMs: number; currentDir: string } | null
  counts: CandidateCounts
  warnings: ScanWarning[]
}

export type PublicCandidate = Omit<ScanCandidate, 'sourcePath' | 'content'> & { seq: number; folder: string; importable: boolean }

export interface CandidateFilter {
  kind?: CandidateKind[]
  /** Exact code, or a bare prefix such as `directory-skipped` matching every classed code. */
  reason?: string[]
  folder?: string
  /** `true` = subtree (default), `false` = the folder's direct children only. */
  subtree?: boolean
  selected?: boolean
  importable?: boolean
  q?: string
  tag?: string[]
  excludeKinds?: CandidateKind[]
  excludeReasons?: string[]
  excludeFolders?: string[]
}

export interface SelectionWire {
  base: 'default' | 'all' | 'none'
  /** Ordered; the LAST matching group wins. `folder` is scan-relative at any depth, `.` = root. */
  groups: Array<{ kind?: CandidateKind; folder?: string; selected: boolean }>
  rows: Array<{ candidateId: string; selected?: boolean; target?: CandidateTarget }>
}

export interface ImportJobSelection { candidateId: string; target?: CandidateTarget }

export interface ImportJobStats {
  total: number
  processed: number
  applied: number
  skipped: number
  unchanged: number
  proposals: number
  errors: number
  aiEnriched: number
  aiFallback: number
  byKind: Record<string, number>
  skippedReasons: Record<string, number>
  elapsedMs: number
  resumed: number
}

export interface ImportJob {
  id: string
  status: JobStatus
  sourceProfile: SourceProfile
  scanId: string
  instructions: string | null
  phase: JobPhase | string
  progress: number
  stats: ImportJobStats
  error: string | null
  selectionMode: 'ids' | 'wire'
  selectionTotal: number
  cursorSeq: number
  startedAt: string | null
  importMs: number | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}
```

`SkillAsset` gains `containsSecrets?: boolean`; `SkillTransformResult` gains `containsSecrets?: boolean` and its `notBundled` comment drops "or possible secrets" (only an escaped path is ever not bundled now).

- [ ] **Step 4: Write the constants**

```ts
// src/modules/data-port/constants.ts — replace the three cap lines
/** Thresholds above which a row carries the `large-file` warning. Never a skip (R11.1). */
export const LARGE_TEXT_WARN_BYTES = 4 * 1024 * 1024
export const LARGE_CONTAINER_WARN_BYTES = 50 * 1024 * 1024
/** HTTP body limit of the upload endpoint only — a transport limit, not a scan limit. */
export const UPLOAD_BODY_BYTES = 50 * 1024 * 1024
/** Bytes sniffed for a NUL byte to tell text from binary. */
export const SNIFF_BYTES = 8_000
/** Chunk size of the streaming sha256 for files above LARGE_TEXT_WARN_BYTES. */
export const STREAM_CHUNK_BYTES = 1024 * 1024
/** Walker yields to the event loop and reports progress this often. */
export const PROGRESS_EVERY_FILES = 500
export const PROGRESS_EVERY_DIRS = 200
/** Candidate rows per scan-sink transaction. */
export const SCAN_FLUSH_ROWS = 500
/** Runner: items per ledger/progress flush and per event-loop yield. */
export const JOB_BATCH_SIZE = 100
/** One API page. Paging is unbounded; this bounds one response. */
export const CANDIDATE_PAGE_DEFAULT = 200
export const CANDIDATE_PAGE_MAX = 500
/** One selection payload. Bulk gestures are groups; these bound one request body. */
export const SELECTION_MAX_ROWS = 50_000
export const SELECTION_MAX_GROUPS = 5_000
/** A rendered session above this is stored as ordered parts — never truncated. */
export const MAX_EPISODIC_BODY_BYTES = 256 * 1024 * 1024
/**
 * The JavaScript engine's own string size (V8: ~512 MiB). Not a policy cap: a
 * text file above it is still listed, hashed and importable; the runner reports
 * it as `exceeds-string-limit` instead of failing with a generic error (P-17).
 */
export const STRING_LIMIT_BYTES = 512 * 1024 * 1024
/** Candidate rows of older scans are dropped when BOTH hold; a scan a job references is kept. */
export const SCAN_RETENTION = { keepNewest: 10, keepDays: 30 } as const
```

`MAX_SCAN_FILES`, `MAX_FILE_BYTES`, `MAX_UPLOAD_BYTES` are deleted. `HEAD_CHARS`, `MAX_CHUNK_CHARS`, `PROJECT_TYPE_AGENT_ID`, `IMPORT_TAGS`, `OWN_SKILLS_CATEGORY`, `DATA_PORT_EXPORT_VERSION` stay.

- [ ] **Step 5: Add every new key to the six locale files**

Insert after the existing `settings.dataPort.*` block. Remove `settings.dataPort.reason.too-large` and `settings.dataPort.reason.secrets` from all six files. Reword `reason.not-durable` and `reason.transcript`, `wizard.selectAll`, `wizard.kind.noise`, `wizard.pathHint` in all six.

**en.json**
```json
  "settings.dataPort.reason.directory-skipped": "Folder not searched: {{detail}}",
  "settings.dataPort.reason.source-code": "Source code file — importable, not ticked",
  "settings.dataPort.reason.data-file": "Data or configuration text — importable, not ticked",
  "settings.dataPort.reason.session-artifact": "Tool output saved with a session",
  "settings.dataPort.reason.exceeds-string-limit": "Larger than one text value the engine can hold (about 512 MiB) — listed, not filed yet",
  "settings.dataPort.reason.transcript": "Conversation transcript (imported whole)",
  "settings.dataPort.reason.not-durable": "Third-party or boilerplate text (label only)",
  "settings.dataPort.wizard.selectAll": "Select all importable",
  "settings.dataPort.wizard.selectDefault": "Back to suggested",
  "settings.dataPort.wizard.kind.code": "Source code",
  "settings.dataPort.wizard.kind.noise": "Not importable",
  "settings.dataPort.wizard.pathHint": "Absolute path on this machine — a folder or a whole home directory. Everything under it is mapped; nothing is capped or skipped in silence: every file and every folder class that is not entered is listed with its reason. Large trees take minutes to scan.",
  "settings.dataPort.wizard.dirClass.node_modules": "Dependency folder",
  "settings.dataPort.wizard.dirClass.vcs": "Version-control folder",
  "settings.dataPort.wizard.dirClass.cache": "Cache folder",
  "settings.dataPort.wizard.dirClass.pycache": "Python bytecode cache",
  "settings.dataPort.wizard.dirClass.venv": "Python virtual environment",
  "settings.dataPort.wizard.dirClass.build-output": "Build output",
  "settings.dataPort.wizard.dirClass.browser-profile": "Browser profile",
  "settings.dataPort.wizard.dirClass.trash": "Trash",
  "settings.dataPort.wizard.dirClass.os-cache": "System cache",
  "settings.dataPort.wizard.dirSkippedFiles": "{{count}} files inside, not searched",
  "settings.dataPort.wizard.tag.legacy": "Legacy memory",
  "settings.dataPort.wizard.tag.third-party": "Third-party docs",
  "settings.dataPort.wizard.tag.contains-secrets": "Contains a secret — stored, hidden from recall",
  "settings.dataPort.wizard.tag.subagent": "Sub-agent",
  "settings.dataPort.wizard.containsSecretsHint": "Imported verbatim and tagged contains-secrets. Hidden from the model's memory recall unless memory.recall.includeSecrets is on.",
  "settings.dataPort.wizard.warning.large-file": "Large file — imported whole",
  "settings.dataPort.wizard.warning.secrets-scan-head-only": "Secrets checked in the head only",
  "settings.dataPort.wizard.warning.symlink-cycle": "Symlink loop, not re-entered",
  "settings.dataPort.scanWarning.instructions-applied": "Your instructions were applied to ranking and default selection",
  "settings.dataPort.scanWarning.home-root-mapped": "Every folder under the home directory was mapped; {{skipped}} folders of excluded classes are listed as rows",
  "settings.dataPort.scanWarning.directories-skipped": "{{count}} folders were listed as one row each and not entered: {{detail}}",
  "settings.dataPort.scanWarning.large-files": "{{count}} files are larger than usual — imported whole, marked",
  "settings.dataPort.scanWarning.rows-passed-over": "{{count}} files are listed as not importable (binary, duplicate, app state, unreadable) — each with its reason",
  "settings.dataPort.scanWarning.symlink-cycles": "{{count}} symlink loops were detected and not re-entered",
  "settings.dataPort.scanWarning.unreadable": "{{count}} folders or files could not be read",
  "settings.dataPort.scanWarning.scan-failed": "The scan stopped with an error: {{detail}}. Everything mapped before it is still listed.",
  "settings.dataPort.scanWarning.legacy": "{{message}}",
  "settings.dataPort.wizard.scanning.title": "Mapping the tree…",
  "settings.dataPort.wizard.scanning.dirs": "{{count}} folders visited",
  "settings.dataPort.wizard.scanning.files": "{{count}} files seen",
  "settings.dataPort.wizard.scanning.candidates": "{{count}} rows listed",
  "settings.dataPort.wizard.scanning.current": "Now in {{dir}}",
  "settings.dataPort.wizard.scanning.failed": "The scan stopped early. What was mapped can still be reviewed.",
  "settings.dataPort.wizard.scanning.continue": "Review",
  "settings.dataPort.wizard.scanning.cancel": "Stop the scan",
  "settings.dataPort.wizard.dirsVisited": "{{count}} folders visited",
  "settings.dataPort.wizard.dirsSkipped": "{{count}} folders listed, not entered",
  "settings.dataPort.wizard.importableCount": "{{count}} importable",
  "settings.dataPort.wizard.scanTime": "Scanned in {{time}}",
  "settings.dataPort.wizard.importTime": "Imported in {{time}}",
  "settings.dataPort.wizard.filter.label": "Filter",
  "settings.dataPort.wizard.filter.searchLabel": "Search",
  "settings.dataPort.wizard.filter.searchPlaceholder": "Search path or title…",
  "settings.dataPort.wizard.filter.reason": "Reason",
  "settings.dataPort.wizard.filter.reasonAny": "Any reason",
  "settings.dataPort.wizard.filter.suggested": "Suggestion",
  "settings.dataPort.wizard.filter.suggestedAny": "All",
  "settings.dataPort.wizard.filter.suggestedYes": "Suggested by the scan",
  "settings.dataPort.wizard.filter.suggestedNo": "Not suggested",
  "settings.dataPort.wizard.filter.clear": "Clear filters",
  "settings.dataPort.wizard.filter.matches": "{{count}} of {{total}} match",
  "settings.dataPort.wizard.group.selectAll": "Select all in {{group}}",
  "settings.dataPort.wizard.group.selected": "{{selected}} of {{importable}} selected",
  "settings.dataPort.wizard.group.importable": "{{importable}} importable of {{total}}",
  "settings.dataPort.wizard.group.rootFolder": "(top level)",
  "settings.dataPort.wizard.tree.label": "Folders found by the scan",
  "settings.dataPort.wizard.tree.notSearched": "Not searched",
  "settings.dataPort.wizard.tree.aliasOf": "Same folder as {{path}}",
  "settings.dataPort.wizard.tree.whyNot": "Why not importable",
  "settings.dataPort.wizard.tree.includeSubfolders": "Include subfolders",
  "settings.dataPort.wizard.tree.loading": "Loading {{count}} more rows…",
  "settings.dataPort.wizard.tree.placeholder": "Loading…",
  "settings.dataPort.wizard.tree.expand": "Expand {{group}}",
  "settings.dataPort.wizard.tree.collapse": "Collapse {{group}}",
  "settings.dataPort.wizard.tree.keyboardHint": "Arrow keys move, Space selects, Left and Right collapse or expand a folder, Enter opens it",
  "settings.dataPort.wizard.tree.noMatches": "No rows match the current filters.",
  "settings.dataPort.wizard.list.label": "Files in the selected folder",
  "settings.dataPort.wizard.list.rangeToggled": "{{count}} rows toggled",
  "settings.dataPort.wizard.preview.title": "Preview",
  "settings.dataPort.wizard.preview.open": "Preview",
  "settings.dataPort.wizard.preview.truncated": "First {{shown}} of {{total}} shown — imported in full",
  "settings.dataPort.wizard.preview.binary": "Binary content is not shown",
  "settings.dataPort.wizard.preview.children": "First entries of this folder",
  "settings.dataPort.wizard.preview.assets": "Bundled files",
  "settings.dataPort.wizard.preview.paths": "Also found at",
  "settings.dataPort.wizard.preview.copyPath": "Copy path",
  "settings.dataPort.wizard.preview.close": "Close preview",
  "settings.dataPort.wizard.countsError": "Counts could not be loaded — the list still works.",
  "settings.dataPort.wizard.turns": "{{count}} turns",
  "settings.dataPort.wizard.sizeKiB": "{{count}} KiB",
  "settings.dataPort.wizard.stat.total": "Selected",
  "settings.dataPort.wizard.stat.elapsed": "Import time",
  "settings.dataPort.wizard.stat.resumed": "Resumed after restart",
  "settings.dataPort.wizard.resumeNotice": "This import was interrupted by a restart and is being resumed from where it stopped.",
  "settings.dataPort.wizard.cancelImport": "Stop this import",
  "settings.dataPort.wizard.cancelImportConfirm": "Stop after the current batch? Everything already filed stays and can be rolled back.",
  "settings.dataPort.wizard.progress.items": "{{processed}} of {{total}} items",
  "settings.dataPort.wizard.progress.elapsed": "Elapsed {{time}}",
  "settings.dataPort.wizard.progress.eta": "About {{time}} left",
  "settings.dataPort.wizard.progress.etaUnknown": "Estimating time left…",
  "settings.dataPort.wizard.progress.rate": "{{rate}} items/min",
  "settings.dataPort.wizard.progress.byKind": "By kind",
  "settings.dataPort.wizard.phase.queued": "Queued",
  "settings.dataPort.wizard.phase.read": "Reading sources",
  "settings.dataPort.wizard.phase.apply": "Filing items",
  "settings.dataPort.wizard.phase.index": "Rebuilding the index",
  "settings.dataPort.wizard.phase.done": "Finished",
  "settings.dataPort.wizard.phase.error": "Stopped on an error",
  "settings.dataPort.wizard.phase.resuming": "Resuming after a restart",
  "settings.dataPort.wizard.phase.cancelled": "Stopped by request",
  "settings.dataPort.wizard.duration.seconds": "{{count}} s",
  "settings.dataPort.wizard.duration.minutes": "{{count}} min",
  "settings.dataPort.wizard.duration.hours": "{{h}} h {{m}} min"
```

**hu.json**
```json
  "settings.dataPort.reason.directory-skipped": "Nem átnézett mappa: {{detail}}",
  "settings.dataPort.reason.source-code": "Forráskódfájl — importálható, nincs kijelölve",
  "settings.dataPort.reason.data-file": "Adat- vagy konfigurációs szöveg — importálható, nincs kijelölve",
  "settings.dataPort.reason.session-artifact": "Munkamenet mellé mentett eszközkimenet",
  "settings.dataPort.reason.exceeds-string-limit": "Nagyobb, mint amit a motor egy szövegértékként kezelni tud (kb. 512 MiB) — listázva, még nincs betöltve",
  "settings.dataPort.reason.transcript": "Beszélgetés-átirat (egészben importálva)",
  "settings.dataPort.reason.not-durable": "Harmadik féltől származó vagy sablonszöveg (csak címke)",
  "settings.dataPort.wizard.selectAll": "Minden importálható kijelölése",
  "settings.dataPort.wizard.selectDefault": "Vissza a javasolthoz",
  "settings.dataPort.wizard.kind.code": "Forráskód",
  "settings.dataPort.wizard.kind.noise": "Nem importálható",
  "settings.dataPort.wizard.pathHint": "Abszolút útvonal ezen a gépen — egy mappa vagy egy teljes home könyvtár. Minden alatta lévő mappa feltérképeződik; nincs korlát, semmi nem marad ki némán: minden fájl és minden be nem járt mappaosztály listázva van az okával. Nagy fákon a scan percekig tart.",
  "settings.dataPort.wizard.dirClass.node_modules": "Függőségmappa",
  "settings.dataPort.wizard.dirClass.vcs": "Verziókezelő mappa",
  "settings.dataPort.wizard.dirClass.cache": "Gyorsítótár-mappa",
  "settings.dataPort.wizard.dirClass.pycache": "Python bájtkód-gyorsítótár",
  "settings.dataPort.wizard.dirClass.venv": "Python virtuális környezet",
  "settings.dataPort.wizard.dirClass.build-output": "Build-kimenet",
  "settings.dataPort.wizard.dirClass.browser-profile": "Böngészőprofil",
  "settings.dataPort.wizard.dirClass.trash": "Kuka",
  "settings.dataPort.wizard.dirClass.os-cache": "Rendszer-gyorsítótár",
  "settings.dataPort.wizard.dirSkippedFiles": "{{count}} fájl benne, nem átnézve",
  "settings.dataPort.wizard.tag.legacy": "Örökölt memória",
  "settings.dataPort.wizard.tag.third-party": "Harmadik féltől származó dokumentáció",
  "settings.dataPort.wizard.tag.contains-secrets": "Titkot tartalmaz — tárolva, felidézésből kizárva",
  "settings.dataPort.wizard.tag.subagent": "Al-agent",
  "settings.dataPort.wizard.containsSecretsHint": "Változatlanul importálva, contains-secrets címkével. A modell memória-felidézéséből kimarad, hacsak a memory.recall.includeSecrets nincs bekapcsolva.",
  "settings.dataPort.wizard.warning.large-file": "Nagy fájl — egészben importálva",
  "settings.dataPort.wizard.warning.secrets-scan-head-only": "Titkok csak a fájl elején ellenőrizve",
  "settings.dataPort.wizard.warning.symlink-cycle": "Szimlink-hurok, nem lépett bele újra",
  "settings.dataPort.scanWarning.instructions-applied": "Az utasításaid a rangsorolásra és az alapértelmezett kijelölésre lettek alkalmazva",
  "settings.dataPort.scanWarning.home-root-mapped": "A home könyvtár minden mappája feltérképezve; {{skipped}} kizárt osztályú mappa sorként szerepel",
  "settings.dataPort.scanWarning.directories-skipped": "{{count}} mappa egy-egy sorként szerepel, nem lett bejárva: {{detail}}",
  "settings.dataPort.scanWarning.large-files": "{{count}} fájl a szokásosnál nagyobb — egészben importálva, megjelölve",
  "settings.dataPort.scanWarning.rows-passed-over": "{{count}} fájl nem importálhatóként szerepel (bináris, duplikátum, alkalmazásállapot, olvashatatlan) — mind az okával",
  "settings.dataPort.scanWarning.symlink-cycles": "{{count}} szimlink-hurok észlelve, nem lett újra bejárva",
  "settings.dataPort.scanWarning.unreadable": "{{count}} mappa vagy fájl nem volt olvasható",
  "settings.dataPort.scanWarning.scan-failed": "A scan hibával leállt: {{detail}}. Ami előtte feltérképeződött, az listázva maradt.",
  "settings.dataPort.scanWarning.legacy": "{{message}}",
  "settings.dataPort.wizard.scanning.title": "A fa feltérképezése…",
  "settings.dataPort.wizard.scanning.dirs": "{{count}} mappa bejárva",
  "settings.dataPort.wizard.scanning.files": "{{count}} fájl látva",
  "settings.dataPort.wizard.scanning.candidates": "{{count}} sor listázva",
  "settings.dataPort.wizard.scanning.current": "Most itt: {{dir}}",
  "settings.dataPort.wizard.scanning.failed": "A scan korán leállt. Ami feltérképeződött, átnézhető.",
  "settings.dataPort.wizard.scanning.continue": "Átnézés",
  "settings.dataPort.wizard.scanning.cancel": "Scan leállítása",
  "settings.dataPort.wizard.dirsVisited": "{{count}} mappa bejárva",
  "settings.dataPort.wizard.dirsSkipped": "{{count}} mappa listázva, nem bejárva",
  "settings.dataPort.wizard.importableCount": "{{count}} importálható",
  "settings.dataPort.wizard.scanTime": "Scan ideje: {{time}}",
  "settings.dataPort.wizard.importTime": "Import ideje: {{time}}",
  "settings.dataPort.wizard.filter.label": "Szűrő",
  "settings.dataPort.wizard.filter.searchLabel": "Keresés",
  "settings.dataPort.wizard.filter.searchPlaceholder": "Útvonal vagy cím keresése…",
  "settings.dataPort.wizard.filter.reason": "Ok",
  "settings.dataPort.wizard.filter.reasonAny": "Bármely ok",
  "settings.dataPort.wizard.filter.suggested": "Javaslat",
  "settings.dataPort.wizard.filter.suggestedAny": "Mind",
  "settings.dataPort.wizard.filter.suggestedYes": "A scan javasolta",
  "settings.dataPort.wizard.filter.suggestedNo": "Nem javasolt",
  "settings.dataPort.wizard.filter.clear": "Szűrők törlése",
  "settings.dataPort.wizard.filter.matches": "{{count}} / {{total}} egyezik",
  "settings.dataPort.wizard.group.selectAll": "Minden kijelölése itt: {{group}}",
  "settings.dataPort.wizard.group.selected": "{{selected}} / {{importable}} kijelölve",
  "settings.dataPort.wizard.group.importable": "{{importable}} importálható / {{total}}",
  "settings.dataPort.wizard.group.rootFolder": "(legfelső szint)",
  "settings.dataPort.wizard.tree.label": "A scan által talált mappák",
  "settings.dataPort.wizard.tree.notSearched": "Nem átnézett",
  "settings.dataPort.wizard.tree.aliasOf": "Ugyanaz a mappa, mint {{path}}",
  "settings.dataPort.wizard.tree.whyNot": "Miért nem importálható",
  "settings.dataPort.wizard.tree.includeSubfolders": "Almappákkal együtt",
  "settings.dataPort.wizard.tree.loading": "Még {{count}} sor betöltése…",
  "settings.dataPort.wizard.tree.placeholder": "Betöltés…",
  "settings.dataPort.wizard.tree.expand": "{{group}} kinyitása",
  "settings.dataPort.wizard.tree.collapse": "{{group}} becsukása",
  "settings.dataPort.wizard.tree.keyboardHint": "Nyilak: mozgás, Szóköz: kijelölés, Bal/Jobb: mappa becsukása/kinyitása, Enter: megnyitás",
  "settings.dataPort.wizard.tree.noMatches": "Nincs a szűrőknek megfelelő sor.",
  "settings.dataPort.wizard.list.label": "A kiválasztott mappa fájljai",
  "settings.dataPort.wizard.list.rangeToggled": "{{count}} sor átváltva",
  "settings.dataPort.wizard.preview.title": "Előnézet",
  "settings.dataPort.wizard.preview.open": "Előnézet",
  "settings.dataPort.wizard.preview.truncated": "Az első {{shown}} / {{total}} látszik — az import teljes",
  "settings.dataPort.wizard.preview.binary": "Bináris tartalom nem jelenik meg",
  "settings.dataPort.wizard.preview.children": "A mappa első bejegyzései",
  "settings.dataPort.wizard.preview.assets": "Csomagolt fájlok",
  "settings.dataPort.wizard.preview.paths": "Itt is megtalálható",
  "settings.dataPort.wizard.preview.copyPath": "Útvonal másolása",
  "settings.dataPort.wizard.preview.close": "Előnézet bezárása",
  "settings.dataPort.wizard.countsError": "A számlálók nem töltődtek be — a lista attól még működik.",
  "settings.dataPort.wizard.turns": "{{count}} kör",
  "settings.dataPort.wizard.sizeKiB": "{{count}} KiB",
  "settings.dataPort.wizard.stat.total": "Kijelölve",
  "settings.dataPort.wizard.stat.elapsed": "Import ideje",
  "settings.dataPort.wizard.stat.resumed": "Újraindítás után folytatva",
  "settings.dataPort.wizard.resumeNotice": "Ezt az importot egy újraindítás megszakította; onnan folytatódik, ahol megállt.",
  "settings.dataPort.wizard.cancelImport": "Import leállítása",
  "settings.dataPort.wizard.cancelImportConfirm": "Leállítás a jelenlegi köteg után? Ami már be lett töltve, megmarad és visszavonható.",
  "settings.dataPort.wizard.progress.items": "{{processed}} / {{total}} elem",
  "settings.dataPort.wizard.progress.elapsed": "Eltelt: {{time}}",
  "settings.dataPort.wizard.progress.eta": "Kb. {{time}} van hátra",
  "settings.dataPort.wizard.progress.etaUnknown": "Hátralévő idő becslése…",
  "settings.dataPort.wizard.progress.rate": "{{rate}} elem/perc",
  "settings.dataPort.wizard.progress.byKind": "Típusonként",
  "settings.dataPort.wizard.phase.queued": "Sorban áll",
  "settings.dataPort.wizard.phase.read": "Források olvasása",
  "settings.dataPort.wizard.phase.apply": "Elemek betöltése",
  "settings.dataPort.wizard.phase.index": "Index újraépítése",
  "settings.dataPort.wizard.phase.done": "Kész",
  "settings.dataPort.wizard.phase.error": "Hibával leállt",
  "settings.dataPort.wizard.phase.resuming": "Folytatás újraindítás után",
  "settings.dataPort.wizard.phase.cancelled": "Kérésre leállítva",
  "settings.dataPort.wizard.duration.seconds": "{{count}} mp",
  "settings.dataPort.wizard.duration.minutes": "{{count}} perc",
  "settings.dataPort.wizard.duration.hours": "{{h}} ó {{m}} perc"
```

**de.json**
```json
  "settings.dataPort.reason.directory-skipped": "Ordner nicht durchsucht: {{detail}}",
  "settings.dataPort.reason.source-code": "Quellcodedatei — importierbar, nicht vorausgewählt",
  "settings.dataPort.reason.data-file": "Daten- oder Konfigurationstext — importierbar, nicht vorausgewählt",
  "settings.dataPort.reason.session-artifact": "Neben einer Sitzung gespeicherte Werkzeugausgabe",
  "settings.dataPort.reason.exceeds-string-limit": "Größer als ein Textwert, den die Engine halten kann (etwa 512 MiB) — gelistet, noch nicht abgelegt",
  "settings.dataPort.reason.transcript": "Gesprächsprotokoll (ganz importiert)",
  "settings.dataPort.reason.not-durable": "Fremd- oder Boilerplate-Text (nur ein Label)",
  "settings.dataPort.wizard.selectAll": "Alles Importierbare auswählen",
  "settings.dataPort.wizard.selectDefault": "Zurück zum Vorschlag",
  "settings.dataPort.wizard.kind.code": "Quellcode",
  "settings.dataPort.wizard.kind.noise": "Nicht importierbar",
  "settings.dataPort.wizard.pathHint": "Absoluter Pfad auf diesem Rechner — ein Ordner oder ein ganzes Home-Verzeichnis. Alles darunter wird erfasst; nichts wird begrenzt oder stillschweigend übergangen: jede Datei und jede nicht betretene Ordnerklasse wird mit ihrem Grund gelistet. Große Bäume brauchen Minuten.",
  "settings.dataPort.wizard.dirClass.node_modules": "Abhängigkeits-Ordner",
  "settings.dataPort.wizard.dirClass.vcs": "Versionsverwaltungs-Ordner",
  "settings.dataPort.wizard.dirClass.cache": "Cache-Ordner",
  "settings.dataPort.wizard.dirClass.pycache": "Python-Bytecode-Cache",
  "settings.dataPort.wizard.dirClass.venv": "Virtuelle Python-Umgebung",
  "settings.dataPort.wizard.dirClass.build-output": "Build-Ausgabe",
  "settings.dataPort.wizard.dirClass.browser-profile": "Browser-Profil",
  "settings.dataPort.wizard.dirClass.trash": "Papierkorb",
  "settings.dataPort.wizard.dirClass.os-cache": "System-Cache",
  "settings.dataPort.wizard.dirSkippedFiles": "{{count}} Dateien darin, nicht durchsucht",
  "settings.dataPort.wizard.tag.legacy": "Altes Gedächtnis",
  "settings.dataPort.wizard.tag.third-party": "Fremd-Dokumentation",
  "settings.dataPort.wizard.tag.contains-secrets": "Enthält ein Geheimnis — gespeichert, vor Recall verborgen",
  "settings.dataPort.wizard.tag.subagent": "Sub-Agent",
  "settings.dataPort.wizard.containsSecretsHint": "Unverändert importiert und mit contains-secrets markiert. Für den Speicherabruf des Modells ausgeblendet, sofern memory.recall.includeSecrets nicht aktiv ist.",
  "settings.dataPort.wizard.warning.large-file": "Große Datei — ganz importiert",
  "settings.dataPort.wizard.warning.secrets-scan-head-only": "Geheimnisse nur im Dateianfang geprüft",
  "settings.dataPort.wizard.warning.symlink-cycle": "Symlink-Schleife, nicht erneut betreten",
  "settings.dataPort.scanWarning.instructions-applied": "Deine Anweisungen wurden auf Reihenfolge und Vorauswahl angewendet",
  "settings.dataPort.scanWarning.home-root-mapped": "Jeder Ordner unter dem Home-Verzeichnis wurde erfasst; {{skipped}} Ordner ausgeschlossener Klassen sind als Zeilen gelistet",
  "settings.dataPort.scanWarning.directories-skipped": "{{count}} Ordner wurden als je eine Zeile gelistet und nicht betreten: {{detail}}",
  "settings.dataPort.scanWarning.large-files": "{{count}} Dateien sind größer als üblich — ganz importiert, markiert",
  "settings.dataPort.scanWarning.rows-passed-over": "{{count}} Dateien sind als nicht importierbar gelistet (binär, Duplikat, App-Zustand, unlesbar) — jede mit ihrem Grund",
  "settings.dataPort.scanWarning.symlink-cycles": "{{count}} Symlink-Schleifen erkannt und nicht erneut betreten",
  "settings.dataPort.scanWarning.unreadable": "{{count}} Ordner oder Dateien konnten nicht gelesen werden",
  "settings.dataPort.scanWarning.scan-failed": "Der Scan brach mit einem Fehler ab: {{detail}}. Alles davor Erfasste ist weiterhin gelistet.",
  "settings.dataPort.scanWarning.legacy": "{{message}}",
  "settings.dataPort.wizard.scanning.title": "Baum wird erfasst…",
  "settings.dataPort.wizard.scanning.dirs": "{{count}} Ordner besucht",
  "settings.dataPort.wizard.scanning.files": "{{count}} Dateien gesehen",
  "settings.dataPort.wizard.scanning.candidates": "{{count}} Zeilen gelistet",
  "settings.dataPort.wizard.scanning.current": "Jetzt in {{dir}}",
  "settings.dataPort.wizard.scanning.failed": "Der Scan brach vorzeitig ab. Das Erfasste kann trotzdem geprüft werden.",
  "settings.dataPort.wizard.scanning.continue": "Prüfen",
  "settings.dataPort.wizard.scanning.cancel": "Scan anhalten",
  "settings.dataPort.wizard.dirsVisited": "{{count}} Ordner besucht",
  "settings.dataPort.wizard.dirsSkipped": "{{count}} Ordner gelistet, nicht betreten",
  "settings.dataPort.wizard.importableCount": "{{count}} importierbar",
  "settings.dataPort.wizard.scanTime": "Gescannt in {{time}}",
  "settings.dataPort.wizard.importTime": "Importiert in {{time}}",
  "settings.dataPort.wizard.filter.label": "Filter",
  "settings.dataPort.wizard.filter.searchLabel": "Suche",
  "settings.dataPort.wizard.filter.searchPlaceholder": "Pfad oder Titel suchen…",
  "settings.dataPort.wizard.filter.reason": "Grund",
  "settings.dataPort.wizard.filter.reasonAny": "Beliebiger Grund",
  "settings.dataPort.wizard.filter.suggested": "Vorschlag",
  "settings.dataPort.wizard.filter.suggestedAny": "Alle",
  "settings.dataPort.wizard.filter.suggestedYes": "Vom Scan vorgeschlagen",
  "settings.dataPort.wizard.filter.suggestedNo": "Nicht vorgeschlagen",
  "settings.dataPort.wizard.filter.clear": "Filter zurücksetzen",
  "settings.dataPort.wizard.filter.matches": "{{count}} von {{total}} passen",
  "settings.dataPort.wizard.group.selectAll": "Alles in {{group}} auswählen",
  "settings.dataPort.wizard.group.selected": "{{selected}} von {{importable}} ausgewählt",
  "settings.dataPort.wizard.group.importable": "{{importable}} importierbar von {{total}}",
  "settings.dataPort.wizard.group.rootFolder": "(oberste Ebene)",
  "settings.dataPort.wizard.tree.label": "Vom Scan gefundene Ordner",
  "settings.dataPort.wizard.tree.notSearched": "Nicht durchsucht",
  "settings.dataPort.wizard.tree.aliasOf": "Derselbe Ordner wie {{path}}",
  "settings.dataPort.wizard.tree.whyNot": "Warum nicht importierbar",
  "settings.dataPort.wizard.tree.includeSubfolders": "Unterordner einschließen",
  "settings.dataPort.wizard.tree.loading": "{{count}} weitere Zeilen werden geladen…",
  "settings.dataPort.wizard.tree.placeholder": "Wird geladen…",
  "settings.dataPort.wizard.tree.expand": "{{group}} ausklappen",
  "settings.dataPort.wizard.tree.collapse": "{{group}} einklappen",
  "settings.dataPort.wizard.tree.keyboardHint": "Pfeiltasten bewegen, Leertaste wählt, Links/Rechts klappt einen Ordner ein oder aus, Enter öffnet ihn",
  "settings.dataPort.wizard.tree.noMatches": "Keine Zeile passt zu den aktuellen Filtern.",
  "settings.dataPort.wizard.list.label": "Dateien im gewählten Ordner",
  "settings.dataPort.wizard.list.rangeToggled": "{{count}} Zeilen umgeschaltet",
  "settings.dataPort.wizard.preview.title": "Vorschau",
  "settings.dataPort.wizard.preview.open": "Vorschau",
  "settings.dataPort.wizard.preview.truncated": "Erste {{shown}} von {{total}} gezeigt — vollständig importiert",
  "settings.dataPort.wizard.preview.binary": "Binärer Inhalt wird nicht angezeigt",
  "settings.dataPort.wizard.preview.children": "Erste Einträge dieses Ordners",
  "settings.dataPort.wizard.preview.assets": "Gebündelte Dateien",
  "settings.dataPort.wizard.preview.paths": "Auch gefunden unter",
  "settings.dataPort.wizard.preview.copyPath": "Pfad kopieren",
  "settings.dataPort.wizard.preview.close": "Vorschau schließen",
  "settings.dataPort.wizard.countsError": "Zähler konnten nicht geladen werden — die Liste funktioniert trotzdem.",
  "settings.dataPort.wizard.turns": "{{count}} Beiträge",
  "settings.dataPort.wizard.sizeKiB": "{{count}} KiB",
  "settings.dataPort.wizard.stat.total": "Ausgewählt",
  "settings.dataPort.wizard.stat.elapsed": "Importdauer",
  "settings.dataPort.wizard.stat.resumed": "Nach Neustart fortgesetzt",
  "settings.dataPort.wizard.resumeNotice": "Dieser Import wurde durch einen Neustart unterbrochen und wird dort fortgesetzt, wo er stehen blieb.",
  "settings.dataPort.wizard.cancelImport": "Import anhalten",
  "settings.dataPort.wizard.cancelImportConfirm": "Nach dem aktuellen Stapel anhalten? Bereits Abgelegtes bleibt und kann zurückgerollt werden.",
  "settings.dataPort.wizard.progress.items": "{{processed}} von {{total}} Elementen",
  "settings.dataPort.wizard.progress.elapsed": "Verstrichen {{time}}",
  "settings.dataPort.wizard.progress.eta": "Noch etwa {{time}}",
  "settings.dataPort.wizard.progress.etaUnknown": "Restzeit wird geschätzt…",
  "settings.dataPort.wizard.progress.rate": "{{rate}} Elemente/min",
  "settings.dataPort.wizard.progress.byKind": "Nach Art",
  "settings.dataPort.wizard.phase.queued": "In der Warteschlange",
  "settings.dataPort.wizard.phase.read": "Quellen werden gelesen",
  "settings.dataPort.wizard.phase.apply": "Elemente werden abgelegt",
  "settings.dataPort.wizard.phase.index": "Index wird neu aufgebaut",
  "settings.dataPort.wizard.phase.done": "Fertig",
  "settings.dataPort.wizard.phase.error": "Mit Fehler gestoppt",
  "settings.dataPort.wizard.phase.resuming": "Fortsetzung nach Neustart",
  "settings.dataPort.wizard.phase.cancelled": "Auf Wunsch gestoppt",
  "settings.dataPort.wizard.duration.seconds": "{{count}} s",
  "settings.dataPort.wizard.duration.minutes": "{{count}} min",
  "settings.dataPort.wizard.duration.hours": "{{h}} h {{m}} min"
```

**es.json**
```json
  "settings.dataPort.reason.directory-skipped": "Carpeta no recorrida: {{detail}}",
  "settings.dataPort.reason.source-code": "Archivo de código fuente — importable, sin marcar",
  "settings.dataPort.reason.data-file": "Texto de datos o configuración — importable, sin marcar",
  "settings.dataPort.reason.session-artifact": "Salida de herramienta guardada junto a una sesión",
  "settings.dataPort.reason.exceeds-string-limit": "Mayor que un valor de texto que el motor puede contener (unos 512 MiB) — listado, aún no archivado",
  "settings.dataPort.reason.transcript": "Transcripción de conversación (importada entera)",
  "settings.dataPort.reason.not-durable": "Texto de terceros o plantilla (solo etiqueta)",
  "settings.dataPort.wizard.selectAll": "Seleccionar todo lo importable",
  "settings.dataPort.wizard.selectDefault": "Volver a lo sugerido",
  "settings.dataPort.wizard.kind.code": "Código fuente",
  "settings.dataPort.wizard.kind.noise": "No importable",
  "settings.dataPort.wizard.pathHint": "Ruta absoluta en esta máquina — una carpeta o un directorio home entero. Todo lo que hay debajo se mapea; nada se limita ni se omite en silencio: cada archivo y cada clase de carpeta no recorrida aparece con su motivo. Los árboles grandes tardan minutos.",
  "settings.dataPort.wizard.dirClass.node_modules": "Carpeta de dependencias",
  "settings.dataPort.wizard.dirClass.vcs": "Carpeta de control de versiones",
  "settings.dataPort.wizard.dirClass.cache": "Carpeta de caché",
  "settings.dataPort.wizard.dirClass.pycache": "Caché de bytecode de Python",
  "settings.dataPort.wizard.dirClass.venv": "Entorno virtual de Python",
  "settings.dataPort.wizard.dirClass.build-output": "Salida de compilación",
  "settings.dataPort.wizard.dirClass.browser-profile": "Perfil de navegador",
  "settings.dataPort.wizard.dirClass.trash": "Papelera",
  "settings.dataPort.wizard.dirClass.os-cache": "Caché del sistema",
  "settings.dataPort.wizard.dirSkippedFiles": "{{count}} archivos dentro, no recorridos",
  "settings.dataPort.wizard.tag.legacy": "Memoria heredada",
  "settings.dataPort.wizard.tag.third-party": "Documentación de terceros",
  "settings.dataPort.wizard.tag.contains-secrets": "Contiene un secreto — almacenado, oculto al recall",
  "settings.dataPort.wizard.tag.subagent": "Subagente",
  "settings.dataPort.wizard.containsSecretsHint": "Importado tal cual y etiquetado contains-secrets. Oculto para la recuperación de memoria del modelo salvo que memory.recall.includeSecrets esté activado.",
  "settings.dataPort.wizard.warning.large-file": "Archivo grande — importado entero",
  "settings.dataPort.wizard.warning.secrets-scan-head-only": "Secretos comprobados solo al inicio del archivo",
  "settings.dataPort.wizard.warning.symlink-cycle": "Bucle de enlace simbólico, no reentrado",
  "settings.dataPort.scanWarning.instructions-applied": "Tus instrucciones se aplicaron al orden y a la selección por defecto",
  "settings.dataPort.scanWarning.home-root-mapped": "Se mapeó cada carpeta del directorio home; {{skipped}} carpetas de clases excluidas aparecen como filas",
  "settings.dataPort.scanWarning.directories-skipped": "{{count}} carpetas aparecen como una fila cada una y no se recorrieron: {{detail}}",
  "settings.dataPort.scanWarning.large-files": "{{count}} archivos son más grandes de lo habitual — importados enteros, marcados",
  "settings.dataPort.scanWarning.rows-passed-over": "{{count}} archivos aparecen como no importables (binarios, duplicados, estado de aplicación, ilegibles) — cada uno con su motivo",
  "settings.dataPort.scanWarning.symlink-cycles": "{{count}} bucles de enlaces simbólicos detectados y no reentrados",
  "settings.dataPort.scanWarning.unreadable": "{{count}} carpetas o archivos no se pudieron leer",
  "settings.dataPort.scanWarning.scan-failed": "El scan se detuvo con un error: {{detail}}. Todo lo mapeado antes sigue listado.",
  "settings.dataPort.scanWarning.legacy": "{{message}}",
  "settings.dataPort.wizard.scanning.title": "Mapeando el árbol…",
  "settings.dataPort.wizard.scanning.dirs": "{{count}} carpetas visitadas",
  "settings.dataPort.wizard.scanning.files": "{{count}} archivos vistos",
  "settings.dataPort.wizard.scanning.candidates": "{{count}} filas listadas",
  "settings.dataPort.wizard.scanning.current": "Ahora en {{dir}}",
  "settings.dataPort.wizard.scanning.failed": "El scan se detuvo antes de tiempo. Lo mapeado aún puede revisarse.",
  "settings.dataPort.wizard.scanning.continue": "Revisar",
  "settings.dataPort.wizard.scanning.cancel": "Detener el scan",
  "settings.dataPort.wizard.dirsVisited": "{{count}} carpetas visitadas",
  "settings.dataPort.wizard.dirsSkipped": "{{count}} carpetas listadas, no recorridas",
  "settings.dataPort.wizard.importableCount": "{{count}} importables",
  "settings.dataPort.wizard.scanTime": "Escaneado en {{time}}",
  "settings.dataPort.wizard.importTime": "Importado en {{time}}",
  "settings.dataPort.wizard.filter.label": "Filtro",
  "settings.dataPort.wizard.filter.searchLabel": "Buscar",
  "settings.dataPort.wizard.filter.searchPlaceholder": "Buscar ruta o título…",
  "settings.dataPort.wizard.filter.reason": "Motivo",
  "settings.dataPort.wizard.filter.reasonAny": "Cualquier motivo",
  "settings.dataPort.wizard.filter.suggested": "Sugerencia",
  "settings.dataPort.wizard.filter.suggestedAny": "Todos",
  "settings.dataPort.wizard.filter.suggestedYes": "Sugerido por el scan",
  "settings.dataPort.wizard.filter.suggestedNo": "No sugerido",
  "settings.dataPort.wizard.filter.clear": "Quitar filtros",
  "settings.dataPort.wizard.filter.matches": "{{count}} de {{total}} coinciden",
  "settings.dataPort.wizard.group.selectAll": "Seleccionar todo en {{group}}",
  "settings.dataPort.wizard.group.selected": "{{selected}} de {{importable}} seleccionados",
  "settings.dataPort.wizard.group.importable": "{{importable}} importables de {{total}}",
  "settings.dataPort.wizard.group.rootFolder": "(nivel superior)",
  "settings.dataPort.wizard.tree.label": "Carpetas encontradas por el scan",
  "settings.dataPort.wizard.tree.notSearched": "No recorrida",
  "settings.dataPort.wizard.tree.aliasOf": "La misma carpeta que {{path}}",
  "settings.dataPort.wizard.tree.whyNot": "Por qué no es importable",
  "settings.dataPort.wizard.tree.includeSubfolders": "Incluir subcarpetas",
  "settings.dataPort.wizard.tree.loading": "Cargando {{count}} filas más…",
  "settings.dataPort.wizard.tree.placeholder": "Cargando…",
  "settings.dataPort.wizard.tree.expand": "Expandir {{group}}",
  "settings.dataPort.wizard.tree.collapse": "Contraer {{group}}",
  "settings.dataPort.wizard.tree.keyboardHint": "Las flechas mueven, Espacio selecciona, Izquierda/Derecha contrae o expande una carpeta, Intro la abre",
  "settings.dataPort.wizard.tree.noMatches": "Ninguna fila coincide con los filtros actuales.",
  "settings.dataPort.wizard.list.label": "Archivos de la carpeta seleccionada",
  "settings.dataPort.wizard.list.rangeToggled": "{{count}} filas cambiadas",
  "settings.dataPort.wizard.preview.title": "Vista previa",
  "settings.dataPort.wizard.preview.open": "Vista previa",
  "settings.dataPort.wizard.preview.truncated": "Se muestran los primeros {{shown}} de {{total}} — importado completo",
  "settings.dataPort.wizard.preview.binary": "El contenido binario no se muestra",
  "settings.dataPort.wizard.preview.children": "Primeras entradas de esta carpeta",
  "settings.dataPort.wizard.preview.assets": "Archivos empaquetados",
  "settings.dataPort.wizard.preview.paths": "También encontrado en",
  "settings.dataPort.wizard.preview.copyPath": "Copiar ruta",
  "settings.dataPort.wizard.preview.close": "Cerrar vista previa",
  "settings.dataPort.wizard.countsError": "No se pudieron cargar los recuentos — la lista sigue funcionando.",
  "settings.dataPort.wizard.turns": "{{count}} turnos",
  "settings.dataPort.wizard.sizeKiB": "{{count}} KiB",
  "settings.dataPort.wizard.stat.total": "Seleccionados",
  "settings.dataPort.wizard.stat.elapsed": "Tiempo de importación",
  "settings.dataPort.wizard.stat.resumed": "Reanudado tras reinicio",
  "settings.dataPort.wizard.resumeNotice": "Esta importación fue interrumpida por un reinicio y se reanuda desde donde se detuvo.",
  "settings.dataPort.wizard.cancelImport": "Detener esta importación",
  "settings.dataPort.wizard.cancelImportConfirm": "¿Detener tras el lote actual? Lo ya archivado se conserva y puede revertirse.",
  "settings.dataPort.wizard.progress.items": "{{processed}} de {{total}} elementos",
  "settings.dataPort.wizard.progress.elapsed": "Transcurrido {{time}}",
  "settings.dataPort.wizard.progress.eta": "Quedan unos {{time}}",
  "settings.dataPort.wizard.progress.etaUnknown": "Estimando el tiempo restante…",
  "settings.dataPort.wizard.progress.rate": "{{rate}} elementos/min",
  "settings.dataPort.wizard.progress.byKind": "Por tipo",
  "settings.dataPort.wizard.phase.queued": "En cola",
  "settings.dataPort.wizard.phase.read": "Leyendo fuentes",
  "settings.dataPort.wizard.phase.apply": "Archivando elementos",
  "settings.dataPort.wizard.phase.index": "Reconstruyendo el índice",
  "settings.dataPort.wizard.phase.done": "Terminado",
  "settings.dataPort.wizard.phase.error": "Detenido por un error",
  "settings.dataPort.wizard.phase.resuming": "Reanudando tras un reinicio",
  "settings.dataPort.wizard.phase.cancelled": "Detenido a petición",
  "settings.dataPort.wizard.duration.seconds": "{{count}} s",
  "settings.dataPort.wizard.duration.minutes": "{{count}} min",
  "settings.dataPort.wizard.duration.hours": "{{h}} h {{m}} min"
```

**fr.json**
```json
  "settings.dataPort.reason.directory-skipped": "Dossier non parcouru : {{detail}}",
  "settings.dataPort.reason.source-code": "Fichier de code source — importable, non coché",
  "settings.dataPort.reason.data-file": "Texte de données ou de configuration — importable, non coché",
  "settings.dataPort.reason.session-artifact": "Sortie d’outil enregistrée avec une session",
  "settings.dataPort.reason.exceeds-string-limit": "Plus grand qu’une valeur texte que le moteur peut contenir (environ 512 Mio) — listé, pas encore classé",
  "settings.dataPort.reason.transcript": "Transcription de conversation (importée en entier)",
  "settings.dataPort.reason.not-durable": "Texte tiers ou standard (simple étiquette)",
  "settings.dataPort.wizard.selectAll": "Tout sélectionner (importable)",
  "settings.dataPort.wizard.selectDefault": "Revenir à la suggestion",
  "settings.dataPort.wizard.kind.code": "Code source",
  "settings.dataPort.wizard.kind.noise": "Non importable",
  "settings.dataPort.wizard.pathHint": "Chemin absolu sur cette machine — un dossier ou un répertoire home entier. Tout ce qui est dessous est cartographié ; rien n’est plafonné ni ignoré en silence : chaque fichier et chaque classe de dossier non parcourue est listée avec son motif. Les gros arbres prennent des minutes.",
  "settings.dataPort.wizard.dirClass.node_modules": "Dossier de dépendances",
  "settings.dataPort.wizard.dirClass.vcs": "Dossier de gestion de versions",
  "settings.dataPort.wizard.dirClass.cache": "Dossier de cache",
  "settings.dataPort.wizard.dirClass.pycache": "Cache de bytecode Python",
  "settings.dataPort.wizard.dirClass.venv": "Environnement virtuel Python",
  "settings.dataPort.wizard.dirClass.build-output": "Sortie de build",
  "settings.dataPort.wizard.dirClass.browser-profile": "Profil de navigateur",
  "settings.dataPort.wizard.dirClass.trash": "Corbeille",
  "settings.dataPort.wizard.dirClass.os-cache": "Cache système",
  "settings.dataPort.wizard.dirSkippedFiles": "{{count}} fichiers dedans, non parcourus",
  "settings.dataPort.wizard.tag.legacy": "Mémoire héritée",
  "settings.dataPort.wizard.tag.third-party": "Documentation tierce",
  "settings.dataPort.wizard.tag.contains-secrets": "Contient un secret — stocké, masqué du rappel",
  "settings.dataPort.wizard.tag.subagent": "Sous-agent",
  "settings.dataPort.wizard.containsSecretsHint": "Importé tel quel et étiqueté contains-secrets. Masqué du rappel mémoire du modèle sauf si memory.recall.includeSecrets est activé.",
  "settings.dataPort.wizard.warning.large-file": "Fichier volumineux — importé en entier",
  "settings.dataPort.wizard.warning.secrets-scan-head-only": "Secrets vérifiés seulement en tête de fichier",
  "settings.dataPort.wizard.warning.symlink-cycle": "Boucle de lien symbolique, non réentrée",
  "settings.dataPort.scanWarning.instructions-applied": "Vos instructions ont été appliquées au classement et à la sélection par défaut",
  "settings.dataPort.scanWarning.home-root-mapped": "Chaque dossier du répertoire home a été cartographié ; {{skipped}} dossiers de classes exclues figurent comme lignes",
  "settings.dataPort.scanWarning.directories-skipped": "{{count}} dossiers figurent comme une ligne chacun et n’ont pas été parcourus : {{detail}}",
  "settings.dataPort.scanWarning.large-files": "{{count}} fichiers sont plus volumineux que d’habitude — importés en entier, marqués",
  "settings.dataPort.scanWarning.rows-passed-over": "{{count}} fichiers figurent comme non importables (binaire, doublon, état d’application, illisible) — chacun avec son motif",
  "settings.dataPort.scanWarning.symlink-cycles": "{{count}} boucles de liens symboliques détectées et non réentrées",
  "settings.dataPort.scanWarning.unreadable": "{{count}} dossiers ou fichiers n’ont pas pu être lus",
  "settings.dataPort.scanWarning.scan-failed": "Le scan s’est arrêté sur une erreur : {{detail}}. Tout ce qui a été cartographié avant reste listé.",
  "settings.dataPort.scanWarning.legacy": "{{message}}",
  "settings.dataPort.wizard.scanning.title": "Cartographie de l’arbre…",
  "settings.dataPort.wizard.scanning.dirs": "{{count}} dossiers visités",
  "settings.dataPort.wizard.scanning.files": "{{count}} fichiers vus",
  "settings.dataPort.wizard.scanning.candidates": "{{count}} lignes listées",
  "settings.dataPort.wizard.scanning.current": "Actuellement dans {{dir}}",
  "settings.dataPort.wizard.scanning.failed": "Le scan s’est arrêté prématurément. Ce qui a été cartographié reste consultable.",
  "settings.dataPort.wizard.scanning.continue": "Réviser",
  "settings.dataPort.wizard.scanning.cancel": "Arrêter le scan",
  "settings.dataPort.wizard.dirsVisited": "{{count}} dossiers visités",
  "settings.dataPort.wizard.dirsSkipped": "{{count}} dossiers listés, non parcourus",
  "settings.dataPort.wizard.importableCount": "{{count}} importables",
  "settings.dataPort.wizard.scanTime": "Scanné en {{time}}",
  "settings.dataPort.wizard.importTime": "Importé en {{time}}",
  "settings.dataPort.wizard.filter.label": "Filtre",
  "settings.dataPort.wizard.filter.searchLabel": "Recherche",
  "settings.dataPort.wizard.filter.searchPlaceholder": "Chercher un chemin ou un titre…",
  "settings.dataPort.wizard.filter.reason": "Motif",
  "settings.dataPort.wizard.filter.reasonAny": "Tout motif",
  "settings.dataPort.wizard.filter.suggested": "Suggestion",
  "settings.dataPort.wizard.filter.suggestedAny": "Tous",
  "settings.dataPort.wizard.filter.suggestedYes": "Suggéré par le scan",
  "settings.dataPort.wizard.filter.suggestedNo": "Non suggéré",
  "settings.dataPort.wizard.filter.clear": "Effacer les filtres",
  "settings.dataPort.wizard.filter.matches": "{{count}} sur {{total}} correspondent",
  "settings.dataPort.wizard.group.selectAll": "Tout sélectionner dans {{group}}",
  "settings.dataPort.wizard.group.selected": "{{selected}} sur {{importable}} sélectionnés",
  "settings.dataPort.wizard.group.importable": "{{importable}} importables sur {{total}}",
  "settings.dataPort.wizard.group.rootFolder": "(niveau supérieur)",
  "settings.dataPort.wizard.tree.label": "Dossiers trouvés par le scan",
  "settings.dataPort.wizard.tree.notSearched": "Non parcouru",
  "settings.dataPort.wizard.tree.aliasOf": "Même dossier que {{path}}",
  "settings.dataPort.wizard.tree.whyNot": "Pourquoi non importable",
  "settings.dataPort.wizard.tree.includeSubfolders": "Inclure les sous-dossiers",
  "settings.dataPort.wizard.tree.loading": "Chargement de {{count}} lignes de plus…",
  "settings.dataPort.wizard.tree.placeholder": "Chargement…",
  "settings.dataPort.wizard.tree.expand": "Déplier {{group}}",
  "settings.dataPort.wizard.tree.collapse": "Replier {{group}}",
  "settings.dataPort.wizard.tree.keyboardHint": "Les flèches déplacent, Espace sélectionne, Gauche/Droite replie ou déplie un dossier, Entrée l’ouvre",
  "settings.dataPort.wizard.tree.noMatches": "Aucune ligne ne correspond aux filtres actuels.",
  "settings.dataPort.wizard.list.label": "Fichiers du dossier sélectionné",
  "settings.dataPort.wizard.list.rangeToggled": "{{count}} lignes basculées",
  "settings.dataPort.wizard.preview.title": "Aperçu",
  "settings.dataPort.wizard.preview.open": "Aperçu",
  "settings.dataPort.wizard.preview.truncated": "Les {{shown}} premiers sur {{total}} sont affichés — importé en entier",
  "settings.dataPort.wizard.preview.binary": "Le contenu binaire n’est pas affiché",
  "settings.dataPort.wizard.preview.children": "Premières entrées de ce dossier",
  "settings.dataPort.wizard.preview.assets": "Fichiers embarqués",
  "settings.dataPort.wizard.preview.paths": "Également trouvé à",
  "settings.dataPort.wizard.preview.copyPath": "Copier le chemin",
  "settings.dataPort.wizard.preview.close": "Fermer l’aperçu",
  "settings.dataPort.wizard.countsError": "Les compteurs n’ont pas pu être chargés — la liste fonctionne quand même.",
  "settings.dataPort.wizard.turns": "{{count}} tours",
  "settings.dataPort.wizard.sizeKiB": "{{count}} Kio",
  "settings.dataPort.wizard.stat.total": "Sélectionnés",
  "settings.dataPort.wizard.stat.elapsed": "Durée d’import",
  "settings.dataPort.wizard.stat.resumed": "Repris après redémarrage",
  "settings.dataPort.wizard.resumeNotice": "Cet import a été interrompu par un redémarrage et reprend là où il s’était arrêté.",
  "settings.dataPort.wizard.cancelImport": "Arrêter cet import",
  "settings.dataPort.wizard.cancelImportConfirm": "Arrêter après le lot en cours ? Ce qui est déjà classé reste et peut être annulé.",
  "settings.dataPort.wizard.progress.items": "{{processed}} sur {{total}} éléments",
  "settings.dataPort.wizard.progress.elapsed": "Écoulé {{time}}",
  "settings.dataPort.wizard.progress.eta": "Environ {{time}} restantes",
  "settings.dataPort.wizard.progress.etaUnknown": "Estimation du temps restant…",
  "settings.dataPort.wizard.progress.rate": "{{rate}} éléments/min",
  "settings.dataPort.wizard.progress.byKind": "Par type",
  "settings.dataPort.wizard.phase.queued": "En file d’attente",
  "settings.dataPort.wizard.phase.read": "Lecture des sources",
  "settings.dataPort.wizard.phase.apply": "Classement des éléments",
  "settings.dataPort.wizard.phase.index": "Reconstruction de l’index",
  "settings.dataPort.wizard.phase.done": "Terminé",
  "settings.dataPort.wizard.phase.error": "Arrêté sur une erreur",
  "settings.dataPort.wizard.phase.resuming": "Reprise après un redémarrage",
  "settings.dataPort.wizard.phase.cancelled": "Arrêté à la demande",
  "settings.dataPort.wizard.duration.seconds": "{{count}} s",
  "settings.dataPort.wizard.duration.minutes": "{{count}} min",
  "settings.dataPort.wizard.duration.hours": "{{h}} h {{m}} min"
```

**tlh.json**
```json
  "settings.dataPort.reason.directory-skipped": "pa' nejbe'lu': {{detail}}",
  "settings.dataPort.reason.source-code": "ngoq tevwI' — tlhaplaH, wIvbe'lu'",
  "settings.dataPort.reason.data-file": "De' pagh cherwI' mu'mey — tlhaplaH, wIvbe'lu'",
  "settings.dataPort.reason.session-artifact": "qep retlhDaq pollu'bogh jan Hal",
  "settings.dataPort.reason.exceeds-string-limit": "wa' mu'mey De' 'uchlaHbogh mIqta' tIn law' (512 MiB rur) — tlheghlu', wej pollu'",
  "settings.dataPort.reason.transcript": "ja'chuq qon (naQ tlhaplu')",
  "settings.dataPort.reason.not-durable": "latlh pagh motlh mu'mey (per neH)",
  "settings.dataPort.wizard.selectAll": "Hoch tlhaplaHbogh yIwIv",
  "settings.dataPort.wizard.selectDefault": "chuplu'boghDaq yIchegh",
  "settings.dataPort.wizard.kind.code": "ngoq",
  "settings.dataPort.wizard.kind.noise": "tlhaplaHbe'",
  "settings.dataPort.wizard.pathHint": "janvamDaq He naQ — pa' pagh juH pa' naQ. bIngDaq Hoch nejlu'; 'aqroS tu'be' 'ej pagh buSHa'lu': Hoch tevwI' 'ej nejbe'lu'bogh Hoch pa' Segh meq tlhej tlheghlu'. tIn Sormey tup law' poQ.",
  "settings.dataPort.wizard.dirClass.node_modules": "nIqHom pa'",
  "settings.dataPort.wizard.dirClass.vcs": "ghItlh loD pa'",
  "settings.dataPort.wizard.dirClass.cache": "polHa' pa'",
  "settings.dataPort.wizard.dirClass.pycache": "Python bytecode polHa'",
  "settings.dataPort.wizard.dirClass.venv": "Python ghoS Daq",
  "settings.dataPort.wizard.dirClass.build-output": "chenmoH Hal",
  "settings.dataPort.wizard.dirClass.browser-profile": "browser lo'wI' De' pa'",
  "settings.dataPort.wizard.dirClass.trash": "veQ",
  "settings.dataPort.wizard.dirClass.os-cache": "pat polHa'",
  "settings.dataPort.wizard.dirSkippedFiles": "{{count}} tevwI' qoDDaq, nejbe'lu'",
  "settings.dataPort.wizard.tag.legacy": "qawHaq ngo'",
  "settings.dataPort.wizard.tag.third-party": "latlh paq",
  "settings.dataPort.wizard.tag.contains-secrets": "pegh ngaS — pollu', qaw vo' So'lu'",
  "settings.dataPort.wizard.tag.subagent": "ghoqwI' Hom",
  "settings.dataPort.wizard.containsSecretsHint": "choHbe'lu'pu' 'ej contains-secrets per. memory.recall.includeSecrets chu'be'lu'chugh, qawHaq nejwI' vaD So'lu'.",
  "settings.dataPort.wizard.warning.large-file": "tevwI' tIn — naQ tlhaplu'",
  "settings.dataPort.wizard.warning.secrets-scan-head-only": "tevwI' nachDaq neH pegh nejlu'",
  "settings.dataPort.wizard.warning.symlink-cycle": "symlink gho, 'elqa'be'lu'",
  "settings.dataPort.scanWarning.instructions-applied": "ra'meylIj lo'lu' — mIw 'ej motlh wIv",
  "settings.dataPort.scanWarning.home-root-mapped": "juH pa' bIngDaq Hoch pa' nejlu'; Segh Hutlhbogh {{skipped}} pa' tlhegh moj",
  "settings.dataPort.scanWarning.directories-skipped": "{{count}} pa' wa' tlhegh moj 'ej 'elbe'lu': {{detail}}",
  "settings.dataPort.scanWarning.large-files": "{{count}} tevwI' motlh law' tIn — naQ tlhaplu', per",
  "settings.dataPort.scanWarning.rows-passed-over": "{{count}} tevwI' tlhaplaHbe' (binary, rap, app De', laDlaHbe') — Hoch meq tlhej",
  "settings.dataPort.scanWarning.symlink-cycles": "{{count}} symlink gho tu'lu' 'ej 'elqa'be'lu'",
  "settings.dataPort.scanWarning.unreadable": "{{count}} pa' pagh tevwI' laDlaHbe'",
  "settings.dataPort.scanWarning.scan-failed": "nej Qagh mev: {{detail}}. 'oHvaD nejlu'pu'bogh Hoch tlheghlu' taH.",
  "settings.dataPort.scanWarning.legacy": "{{message}}",
  "settings.dataPort.wizard.scanning.title": "Sor nejlu'…",
  "settings.dataPort.wizard.scanning.dirs": "{{count}} pa' 'ellu'",
  "settings.dataPort.wizard.scanning.files": "{{count}} tevwI' leghlu'",
  "settings.dataPort.wizard.scanning.candidates": "{{count}} tlhegh tlheghlu'",
  "settings.dataPort.wizard.scanning.current": "DaH {{dir}}Daq",
  "settings.dataPort.wizard.scanning.failed": "nej mev. nejlu'pu'bogh Hoch leghlaH.",
  "settings.dataPort.wizard.scanning.continue": "yIlegh",
  "settings.dataPort.wizard.scanning.cancel": "nej yImev",
  "settings.dataPort.wizard.dirsVisited": "{{count}} pa' 'ellu'",
  "settings.dataPort.wizard.dirsSkipped": "{{count}} pa' tlheghlu', 'elbe'lu'",
  "settings.dataPort.wizard.importableCount": "{{count}} tlhaplaH",
  "settings.dataPort.wizard.scanTime": "{{time}} nejlu'",
  "settings.dataPort.wizard.importTime": "{{time}} tlhaplu'",
  "settings.dataPort.wizard.filter.label": "chIw",
  "settings.dataPort.wizard.filter.searchLabel": "nej",
  "settings.dataPort.wizard.filter.searchPlaceholder": "He pagh pong yInej…",
  "settings.dataPort.wizard.filter.reason": "meq",
  "settings.dataPort.wizard.filter.reasonAny": "Hoch meq",
  "settings.dataPort.wizard.filter.suggested": "chup",
  "settings.dataPort.wizard.filter.suggestedAny": "Hoch",
  "settings.dataPort.wizard.filter.suggestedYes": "nej chup",
  "settings.dataPort.wizard.filter.suggestedNo": "chupbe'lu'",
  "settings.dataPort.wizard.filter.clear": "chIw yIQaw'",
  "settings.dataPort.wizard.filter.matches": "{{total}}vo' {{count}} rap",
  "settings.dataPort.wizard.group.selectAll": "{{group}}Daq Hoch yIwIv",
  "settings.dataPort.wizard.group.selected": "{{importable}}vo' {{selected}} wIvlu'",
  "settings.dataPort.wizard.group.importable": "{{total}}vo' {{importable}} tlhaplaH",
  "settings.dataPort.wizard.group.rootFolder": "(patlh 'aqroS)",
  "settings.dataPort.wizard.tree.label": "nej tu'bogh pa'mey",
  "settings.dataPort.wizard.tree.notSearched": "nejbe'lu'",
  "settings.dataPort.wizard.tree.aliasOf": "{{path}} pa' rap",
  "settings.dataPort.wizard.tree.whyNot": "qatlh tlhaplaHbe'",
  "settings.dataPort.wizard.tree.includeSubfolders": "pa'Hommey je",
  "settings.dataPort.wizard.tree.loading": "latlh {{count}} tlhegh chenmoHlu'…",
  "settings.dataPort.wizard.tree.placeholder": "chenmoHlu'…",
  "settings.dataPort.wizard.tree.expand": "{{group}} yIpoSmoH",
  "settings.dataPort.wizard.tree.collapse": "{{group}} yISoQmoH",
  "settings.dataPort.wizard.tree.keyboardHint": "puv leng, Space wIv, poS/nIH pa' SoQmoH pagh poSmoH, Enter poSmoH",
  "settings.dataPort.wizard.tree.noMatches": "chIw rapbogh tlhegh tu'be'.",
  "settings.dataPort.wizard.list.label": "wIvlu'bogh pa' tevwI'mey",
  "settings.dataPort.wizard.list.rangeToggled": "{{count}} tlhegh choHlu'",
  "settings.dataPort.wizard.preview.title": "leghpa'",
  "settings.dataPort.wizard.preview.open": "leghpa'",
  "settings.dataPort.wizard.preview.truncated": "{{total}}vo' wa'DIch {{shown}} 'anglu' — naQ tlhaplu'",
  "settings.dataPort.wizard.preview.binary": "binary 'anglu'be'",
  "settings.dataPort.wizard.preview.children": "pa'vam wa'DIch Dochmey",
  "settings.dataPort.wizard.preview.assets": "boq tevwI'mey",
  "settings.dataPort.wizard.preview.paths": "je tu'lu'",
  "settings.dataPort.wizard.preview.copyPath": "He yIqon",
  "settings.dataPort.wizard.preview.close": "leghpa' yISoQmoH",
  "settings.dataPort.wizard.countsError": "mI' chenmoHlaHbe' — tlhegh Qap taH.",
  "settings.dataPort.wizard.turns": "{{count}} mIw",
  "settings.dataPort.wizard.sizeKiB": "{{count}} KiB",
  "settings.dataPort.wizard.stat.total": "wIvlu'",
  "settings.dataPort.wizard.stat.elapsed": "tlhap poH",
  "settings.dataPort.wizard.stat.resumed": "taghqa' tlhoS taH",
  "settings.dataPort.wizard.resumeNotice": "taghqa'mo' tlhapvam mevlu'; mevlu'boghDaq taH.",
  "settings.dataPort.wizard.cancelImport": "tlhapvam yImev",
  "settings.dataPort.wizard.cancelImportConfirm": "DaH boq tlhoS mev'a'? tlhaplu'pu'bogh Hoch ratlh 'ej cheghlaH.",
  "settings.dataPort.wizard.progress.items": "{{total}}vo' {{processed}} Doch",
  "settings.dataPort.wizard.progress.elapsed": "{{time}} lup",
  "settings.dataPort.wizard.progress.eta": "tlhoS {{time}} ratlh",
  "settings.dataPort.wizard.progress.etaUnknown": "ratlhbogh poH noHlu'…",
  "settings.dataPort.wizard.progress.rate": "{{rate}} Doch/tup",
  "settings.dataPort.wizard.progress.byKind": "Segh",
  "settings.dataPort.wizard.phase.queued": "loS",
  "settings.dataPort.wizard.phase.read": "Hal laDlu'",
  "settings.dataPort.wizard.phase.apply": "Doch pollu'",
  "settings.dataPort.wizard.phase.index": "tetlh chenqa'moHlu'",
  "settings.dataPort.wizard.phase.done": "rIn",
  "settings.dataPort.wizard.phase.error": "Qagh mev",
  "settings.dataPort.wizard.phase.resuming": "taghqa' tlhoS taH",
  "settings.dataPort.wizard.phase.cancelled": "poQmo' mev",
  "settings.dataPort.wizard.duration.seconds": "{{count}} lup",
  "settings.dataPort.wizard.duration.minutes": "{{count}} tup",
  "settings.dataPort.wizard.duration.hours": "{{h}} rep {{m}} tup"
```

**Memory bundle** — `src/web/src/pages/memory/locales/<lang>.json` (the memory dashboard imports `t` from `./i18n`, which reads this bundle, so the key must live here and not in the settings bundle). Insert after the existing `memory.episodic.*` keys, one line per file:

```json
"memory.episodic.chars": "{{count}} characters"
"memory.episodic.chars": "{{count}} karakter"
"memory.episodic.chars": "{{count}} Zeichen"
"memory.episodic.chars": "{{count}} caracteres"
"memory.episodic.chars": "{{count}} caractères"
"memory.episodic.chars": "{{count}} ngutlh"
```
(en, hu, de, es, fr, tlh in that order.)

- [ ] **Step 6: Run the tests**

Run: `bun vitest run tests/modules/data-port/reason-codes.test.ts tests/modules/data-port/locale-vocabulary.test.ts && bun run lint 2>&1 | tail -3`
Expected: both files PASS; lint error count ≤ baseline (compile errors from `MAX_SCAN_FILES` users are fixed by the later tasks that own those files — record them, they belong to T4/T7/T9).

- [ ] **Step 7: Review** — `git status --short` shows only the two source files, twelve locale files (six settings + six memory) and two test files.

---

### Task 2: Additive schema migration — candidates, scan dirs, scan/job/ledger columns

**Files:**
- Modify: `src/modules/data-port/schema.ts`, `src/modules/data-port/ledger.ts`
- Modify: `tests/modules/data-port/ledger.test.ts`
- Create: `tests/modules/data-port/candidates-store.test.ts` (migration cases only; the store tests are Task 8)

**Interfaces:**
- Produces: tables `data_port_candidates`, `data_port_scan_dirs`; columns `data_port_scans.{status, progress_json, scan_ms, finished_at, format, candidate_count, counts_json}`, `data_port_jobs.{selection_mode, selection_total, cursor_seq, started_at, import_ms, resumed_count, elapsed_ms}`, `data_port_applied.{adapter, paths_json}`; indexes; `recordApplied({ adapter?, paths? })`, `AppliedRow.{adapter, paths}`, `hasLedgerRef(db, kind, ref)`, `findLedgerRefBySha(db, kind, sha256)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/candidates-store.test.ts — migration describe (Task 8 appends the store cases)
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'

const columns = (db: any, table: string): string[] =>
  (db.all(sql.raw(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map((c) => c.name)
const indexes = (db: any): string[] =>
  (db.all(sql`SELECT name FROM sqlite_master WHERE type = 'index'`) as Array<{ name: string }>).map((r) => r.name)

describe('data-port schema migration (R11)', () => {
  it('creates the candidate and directory tables with every index, twice without error', () => {
    const db = createMemoryDb()
    createDataPortTables(db)
    createDataPortTables(db)
    expect(columns(db, 'data_port_candidates')).toEqual(expect.arrayContaining([
      'scan_id', 'id', 'seq', 'relative_path', 'folder', 'kind', 'target', 'importable', 'reason_code',
      'reason_prefix', 'selected_by_default', 'bytes', 'search_text', 'tags_json', 'warnings_json',
      'directory_json', 'source_path', 'adapter_id', 'unit', 'sha256', 'paths_json', 'assets_json',
    ]))
    expect(columns(db, 'data_port_scan_dirs')).toEqual(expect.arrayContaining([
      'scan_id', 'path', 'parent', 'name', 'depth', 'skipped_class', 'file_count', 'alias_of',
    ]))
    for (const name of [
      'idx_dpc_scan_seq', 'idx_dpc_scan_path', 'idx_dpc_scan_kind', 'idx_dpc_scan_reason', 'idx_dpc_scan_folder',
      'idx_dpc_scan_selected', 'idx_dpc_scan_source', 'idx_dpd_parent', 'idx_data_port_applied_sha',
      'idx_data_port_applied_kind_ref',
    ]) expect(indexes(db)).toContain(name)
  })

  it('adds the new columns to tables an older install already has', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE data_port_scans (id TEXT PRIMARY KEY, source_profile TEXT NOT NULL, detected_profile TEXT NOT NULL,
      root_path TEXT NOT NULL, candidates_json TEXT NOT NULL, stats_json TEXT NOT NULL, warnings_json TEXT NOT NULL, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE data_port_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, source_profile TEXT NOT NULL, scan_id TEXT NOT NULL,
      selection_json TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0, stats_json TEXT NOT NULL,
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT)`)
    db.run(sql`CREATE TABLE data_port_applied (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
      source_path TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`INSERT INTO data_port_scans VALUES ('s1','auto','generic-md','/alpha','[{"id":"c1"}]','{}','[]','2026-01-01')`)
    createDataPortTables(db)
    expect(columns(db, 'data_port_scans')).toEqual(expect.arrayContaining(['status', 'progress_json', 'scan_ms', 'finished_at', 'format', 'candidate_count', 'counts_json']))
    expect(columns(db, 'data_port_jobs')).toEqual(expect.arrayContaining(['selection_mode', 'selection_total', 'cursor_seq', 'started_at', 'import_ms', 'resumed_count', 'elapsed_ms']))
    expect(columns(db, 'data_port_applied')).toEqual(expect.arrayContaining(['sha256', 'adapter', 'paths_json']))
    const row = (db.all(sql`SELECT format, status, candidate_count FROM data_port_scans WHERE id = 's1'`) as any[])[0]
    expect(row).toEqual({ format: 1, status: 'done', candidate_count: 0 })
  })
})
```

```ts
// tests/modules/data-port/ledger.test.ts — replace the 'sha256 null for agent' case with:
  it('records the adapter, every alias path and a digest for every kind', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    for (const kind of ['vault', 'episodic', 'skill', 'skill-assets', 'agent', 'proposal'] as const) {
      recordApplied(db, { jobId: 'j1', kind, ref: `${kind}-ref`, sourcePath: '/alpha/x.md', sha256: 'a'.repeat(64), adapter: 'grok-cli', paths: ['x.md', 'link/x.md', 'copy/x.md'] })
    }
    const rows = listApplied(db, 'j1')
    expect(rows).toHaveLength(6)
    for (const r of rows) {
      expect(r.sha256).toHaveLength(64)
      expect(r.adapter).toBe('grok-cli')
      expect(r.paths).toEqual(['x.md', 'link/x.md', 'copy/x.md'])
    }
    expect(hasLedgerRef(db, 'vault', 'vault-ref')).toBe(true)
    expect(hasLedgerRef(db, 'vault', 'nope')).toBe(false)
    expect(findLedgerRefBySha(db, 'episodic', 'a'.repeat(64))).toBe('episodic-ref')
  })

  it('reads a row written before the adapter and paths columns existed', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    db.run(sql`INSERT INTO data_port_applied (id, job_id, kind, ref, source_path, sha256, created_at) VALUES ('r1','j1','agent','a1',NULL,NULL,'2026-01-01')`)
    expect(listApplied(db, 'j1')[0]).toMatchObject({ sha256: null, adapter: null, paths: [] })
  })
```

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/candidates-store.test.ts tests/modules/data-port/ledger.test.ts` → FAIL (missing tables/columns/exports).

- [ ] **Step 3: Write the migration**

```ts
// src/modules/data-port/schema.ts — append inside createDataPortTables, after the existing statements
  // ── R11: one row per candidate, one row per directory ─────────────────
  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_candidates (
    scan_id TEXT NOT NULL,
    id TEXT NOT NULL,
    seq INTEGER NOT NULL,              -- scan emission order; keyset cursor for the runner
    relative_path TEXT NOT NULL,
    classified_path TEXT,
    folder TEXT NOT NULL,              -- posix dirname, '.' at the root
    depth INTEGER NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    importable INTEGER NOT NULL,       -- target <> 'none'
    title TEXT NOT NULL,
    preview TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    confidence REAL NOT NULL,
    reason TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    reason_prefix TEXT NOT NULL,       -- 'directory-skipped' for 'directory-skipped:node_modules'
    selected_by_default INTEGER NOT NULL,
    search_text TEXT NOT NULL,         -- lower(relative_path || ' ' || title)
    scope TEXT,
    unit TEXT,
    turns INTEGER,
    session_id TEXT,
    session_date TEXT,
    adapter_id TEXT,
    source_path TEXT,                  -- absolute; NEVER returned by the API
    sha256 TEXT,
    mtime TEXT,
    birthtime TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    directory_json TEXT,               -- {class, files, dirs, unreadable} on directory-skipped rows
    paths_json TEXT,
    assets_json TEXT,
    not_bundled_json TEXT,
    PRIMARY KEY (scan_id, id)
  )`)
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_dpc_scan_seq ON data_port_candidates(scan_id, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_path ON data_port_candidates(scan_id, relative_path, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_kind ON data_port_candidates(scan_id, kind, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_reason ON data_port_candidates(scan_id, reason_prefix, reason_code)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_folder ON data_port_candidates(scan_id, folder, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_selected ON data_port_candidates(scan_id, importable, selected_by_default, seq)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpc_scan_source ON data_port_candidates(scan_id, source_path, seq)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS data_port_scan_dirs (
    scan_id TEXT NOT NULL,
    path TEXT NOT NULL,                -- '.' = root, posix, scan-relative
    parent TEXT,
    name TEXT NOT NULL,
    depth INTEGER NOT NULL,
    skipped_class TEXT,                -- NULL = entered; a DirectoryClass otherwise (D-9)
    file_count INTEGER NOT NULL,       -- direct files when entered; recursive count when skipped
    alias_of TEXT,                     -- realpath de-dupe: the path already mapped
    PRIMARY KEY (scan_id, path)
  )`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_dpd_parent ON data_port_scan_dirs(scan_id, parent)`)

  // Scans: status and progress of a background scan, plus the blob format marker.
  // `format` 1 = candidates in `candidates_json` (pre-R11), 2 = rows in the table.
  addColumnIfMissing(db, 'data_port_scans', 'status', "status TEXT NOT NULL DEFAULT 'done'")
  addColumnIfMissing(db, 'data_port_scans', 'progress_json', 'progress_json TEXT')
  addColumnIfMissing(db, 'data_port_scans', 'scan_ms', 'scan_ms INTEGER')
  addColumnIfMissing(db, 'data_port_scans', 'finished_at', 'finished_at TEXT')
  addColumnIfMissing(db, 'data_port_scans', 'format', 'format INTEGER NOT NULL DEFAULT 1')
  addColumnIfMissing(db, 'data_port_scans', 'candidate_count', 'candidate_count INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'data_port_scans', 'counts_json', 'counts_json TEXT')

  // Jobs: the selection wire, the resume cursor, timing.
  addColumnIfMissing(db, 'data_port_jobs', 'selection_mode', "selection_mode TEXT NOT NULL DEFAULT 'ids'")
  addColumnIfMissing(db, 'data_port_jobs', 'selection_total', 'selection_total INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'data_port_jobs', 'cursor_seq', 'cursor_seq INTEGER NOT NULL DEFAULT -1')
  addColumnIfMissing(db, 'data_port_jobs', 'started_at', 'started_at TEXT')
  addColumnIfMissing(db, 'data_port_jobs', 'import_ms', 'import_ms INTEGER')
  addColumnIfMissing(db, 'data_port_jobs', 'resumed_count', 'resumed_count INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'data_port_jobs', 'elapsed_ms', 'elapsed_ms INTEGER NOT NULL DEFAULT 0')

  // Ledger: provenance for every kind (R11.6) and the digest lookups (R11.8).
  addColumnIfMissing(db, 'data_port_applied', 'adapter', 'adapter TEXT')
  addColumnIfMissing(db, 'data_port_applied', 'paths_json', 'paths_json TEXT')
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_applied_sha ON data_port_applied(kind, sha256)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_data_port_applied_kind_ref ON data_port_applied(kind, ref)`)
```

```ts
// src/modules/data-port/ledger.ts — replace recordApplied/listApplied, add two lookups
export interface AppliedRow {
  id: string
  jobId: string
  kind: AppliedKind
  ref: string
  sourcePath: string | null
  /**
   * sha256 of the verbatim content this import wrote, for EVERY kind: vault and
   * episodic = the body handed to the writer; skill = the assembled skill
   * content; skill-assets = the package digest that named the asset directory;
   * agent = the system prompt; proposal = the proposed body. `null` only on a
   * row written before the column existed.
   */
  sha256: string | null
  /** The adapter that read the item (R11.6). */
  adapter: string | null
  /** Every path the content was found at; empty on a pre-R11 row. */
  paths: string[]
  createdAt: string
}

export function recordApplied(
  db: EyasDb,
  input: {
    jobId: string; kind: AppliedKind; ref: string; sourcePath?: string | null; sha256?: string | null
    adapter?: string | null; paths?: string[] | null
  },
): string {
  const id = generateId()
  db.run(sql`INSERT INTO data_port_applied (id, job_id, kind, ref, source_path, sha256, adapter, paths_json, created_at)
    VALUES (${id}, ${input.jobId}, ${input.kind}, ${input.ref}, ${input.sourcePath ?? null}, ${input.sha256 ?? null},
            ${input.adapter ?? null}, ${input.paths?.length ? JSON.stringify(input.paths) : null}, ${new Date().toISOString()})`)
  return id
}

export function listApplied(db: EyasDb, jobId: string): AppliedRow[] {
  const rows = db.all<{ id: string; job_id: string; kind: AppliedKind; ref: string; source_path: string | null; sha256: string | null; adapter: string | null; paths_json: string | null; created_at: string }>(
    sql`SELECT id, job_id, kind, ref, source_path, sha256, adapter, paths_json, created_at FROM data_port_applied WHERE job_id = ${jobId} ORDER BY created_at ASC, id ASC`,
  )
  return rows.map((r) => ({
    id: r.id, jobId: r.job_id, kind: r.kind, ref: r.ref, sourcePath: r.source_path ?? null, sha256: r.sha256 ?? null,
    adapter: r.adapter ?? null, paths: parsePaths(r.paths_json), createdAt: r.created_at,
  }))
}

function parsePaths(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}

/** Whether THIS kind/ref pair is already in the ledger (resume adoption, Task 12). */
export function hasLedgerRef(db: EyasDb, kind: AppliedKind, ref: string): boolean {
  return (db.all(sql`SELECT 1 FROM data_port_applied WHERE kind = ${kind} AND ref = ${ref} LIMIT 1`) as unknown[]).length > 0
}

/** The ref an earlier import recorded for this digest — the indexed idempotency lookup (R11.8). */
export function findLedgerRefBySha(db: EyasDb, kind: AppliedKind, sha256: string): string | null {
  const rows = db.all<{ ref: string }>(
    sql`SELECT ref FROM data_port_applied WHERE kind = ${kind} AND sha256 = ${sha256} ORDER BY created_at ASC LIMIT 1`,
  )
  return rows[0]?.ref ?? null
}
```

- [ ] **Step 4: Run** — `bun vitest run tests/modules/data-port/candidates-store.test.ts tests/modules/data-port/ledger.test.ts tests/modules/data-port/rollback.test.ts` → PASS (rollback's hand-inserted job rows are covered by the DEFAULTs).

- [ ] **Step 5: Review** — `git status --short`.

---

### Task 3: `memory.recall.includeSecrets` config and the memory-index secrets gate (D-7)

**Files:**
- Modify: `src/core/config/schema.ts`, `config/default.yaml`, `src/modules/memory/memory-index.ts`
- Modify: `tests/modules/memory/memory-index.test.ts`, `tests/core/config.test.ts`

**Interfaces:**
- Produces: `config.memory.recall.includeSecrets: boolean` (default `false`); `SECRETS_TAG`, `hasSecretsTag(tags)`, `recallIncludesSecrets(config)`, `MemoryIndexOptions.includeSecrets`, `IndexRow.tags`; `buildMemoryIndex` excludes tagged notes by default and does not count them as "not shown".

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/memory/memory-index.test.ts — append
describe('contains-secrets (D-7)', () => {
  const seed = (db: any, path: string, tags: string | null, summary: string) =>
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, file_hash, indexed_at, kind, summary)
      VALUES (${path}, ${path}, 'semantic', ${tags}, ${summary}, 'h', '2026-01-01', 'reference', ${summary})`)

  it('leaves a tagged note out of the index and out of the not-shown count', () => {
    const db = createMemoryDb(); createMemoryTables(db)
    seed(db, 'semantic/alpha.md', '["contains-secrets"]', 'alpha secret note')
    seed(db, 'semantic/bravo.md', '["imported"]', 'bravo plain note')
    const out = buildMemoryIndex(db, { projectTypeId: null })!
    expect(out.paths).toEqual(['semantic/bravo.md'])
    expect(out.content).not.toContain('alpha secret note')
    expect(out.content).not.toContain('more notes not shown')
  })

  it('shows it when includeSecrets is on', () => {
    const db = createMemoryDb(); createMemoryTables(db)
    seed(db, 'semantic/alpha.md', '["contains-secrets"]', 'alpha secret note')
    expect(buildMemoryIndex(db, { projectTypeId: null, includeSecrets: true })!.paths).toEqual(['semantic/alpha.md'])
  })

  it('treats malformed or absent tags as no tags', () => {
    expect(hasSecretsTag(null)).toBe(false)
    expect(hasSecretsTag('not json')).toBe(false)
    expect(hasSecretsTag('["contains-secrets"]')).toBe(true)
    expect(hasSecretsTag(['a', 'contains-secrets'])).toBe(true)
  })

  it('reads the config flag through one accessor', () => {
    expect(recallIncludesSecrets({ memory: { recall: { includeSecrets: true } } })).toBe(true)
    expect(recallIncludesSecrets({})).toBe(false)
  })
})
```

```ts
// tests/core/config.test.ts — append near the memory.index case
  it('defaults memory.recall.includeSecrets to false and accepts true', () => {
    expect(configSchema.parse({}).memory.recall.includeSecrets).toBe(false)
    expect(configSchema.parse({ memory: { recall: { includeSecrets: true } } }).memory.recall.includeSecrets).toBe(true)
    expect(configSchema.parse({ memory: {} }).memory.recall).toEqual({ includeSecrets: false })
  })
```

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/memory/memory-index.test.ts tests/core/config.test.ts` → FAIL.

- [ ] **Step 3: Config**

```ts
// src/core/config/schema.ts — inside `memory`, after `index`
    // Model-facing recall of notes that hold credentials (data-port R11.4 / D-7).
    // A note, episodic row or skill tagged `contains-secrets` is imported verbatim
    // but left out of the always-on memory index, related work and `search_memory`
    // unless the owner turns this on.
    recall: z.object({
      includeSecrets: z.boolean().default(false),
    }).default({}),
```

```yaml
# config/default.yaml — after the `index:` block of `memory:`
  recall:
    # Notes, episodic rows and skills tagged `contains-secrets` (files the importer
    # found credentials in, stored verbatim) are hidden from the always-on memory
    # index, related work and search_memory. Set true to let the model see them.
    includeSecrets: false
```

- [ ] **Step 4: Memory index**

```ts
// src/modules/memory/memory-index.ts — additions
/** Tag the data-port importer (and any hand-written note) uses to mark content that holds credentials. */
export const SECRETS_TAG = 'contains-secrets'

/** `tags` as stored (JSON text) or already parsed. Malformed JSON = no tags. */
export function hasSecretsTag(tags: string | string[] | null | undefined): boolean {
  if (!tags) return false
  if (Array.isArray(tags)) return tags.includes(SECRETS_TAG)
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) && parsed.includes(SECRETS_TAG)
  } catch {
    return false
  }
}

/** One reader for `memory.recall.includeSecrets`, so every accessor agrees. */
export function recallIncludesSecrets(config: unknown): boolean {
  return (config as { memory?: { recall?: { includeSecrets?: unknown } } } | null)?.memory?.recall?.includeSecrets === true
}

export interface MemoryIndexOptions {
  budgetChars?: number
  projectId?: string | null
  projectTypeId?: string | null
  /** Default false: notes tagged contains-secrets are not shown to the model. */
  includeSecrets?: boolean
}

interface IndexRow { /* … existing fields … */ tags: string | null }

// in buildMemoryIndex: add `tags` to the SELECT and filter BEFORE ranking, so an
// excluded note is neither listed nor counted in the "more notes not shown" line.
    rows = db.all(sql`SELECT path, title, tier, summary, kind, project_id, project_type_id, tags,
      substr(content_text, 1, 240) AS content_head
      FROM vault_index ORDER BY path ASC`) as IndexRow[]
  const ranked = rows
    .filter((row) => opts.includeSecrets === true || !hasSecretsTag(row.tags))
    .map((row) => ({ row, kind: inferKind(row) }))
    // … unchanged from here
```

- [ ] **Step 5: Run** — `bun vitest run tests/modules/memory/memory-index.test.ts tests/core/config.test.ts tests/modules/memory` → PASS.

- [ ] **Step 6: Review** — `git status --short`.

---
## Phase 1 — Mapping everything

### Task 4: Walker — directory classes, counted class rows, a generator with no caps (R11.1, R11.2, D-9)

**Files:**
- Create: `src/modules/data-port/scanners/directory-classes.ts`
- Modify: `src/modules/data-port/scanners/scan-path.ts` (walker half only: everything above `scanDirectory`; Task 7 owns `scanDirectory`)
- Modify: `tests/modules/data-port/scan-walk.test.ts`
- Create: `tests/modules/data-port/scan-directory-classes.test.ts`, `tests/modules/data-port/no-caps.test.ts`

**Interfaces:**
- Produces: `classifyDirectory(name, realDir, childNames, siblingNames, parentPath): DirectoryClass | null`; `countTree(dir): Generator<'tick', { files; dirs; unreadable }>` (yields every `PROGRESS_EVERY_DIRS` directories or `PROGRESS_EVERY_FILES` entries so a million-entry class directory never blocks the loop) and `collectCount(dir)` (drains it — tests and the synchronous upload path); `nameClass(name): 'text' | 'binary' | 'derived-db' | 'app-state' | 'unknown'`; `walkTree(root, opts): Generator<WalkEntry, WalkSummary>` whose `tick` carries `{ dirsVisited, filesSeen }`, whose `file` entries carry `skillRoot` (the nearest ancestor directory — the file's own included — whose listing holds `skill.md`, or `null`), and which yields `{ type: 'skill-package-done', root }` once every directory under a skill root has been processed (BFS: a per-root pending counter); `collectWalk(root, opts)`.
- Deletes: `ALLOWED_DOT_DIRS`, `SKIP_DIR_NAMES`, `SKIP_UNDER_AI_DOT`, `SESSION_DIR_KEEP`, `CLAUDE_PROJECT_DIR`, `MAX_DIRS_TO_VISIT`, `WIDE_ROOT_KEEP`, `isWideScanRoot`, `shouldSkipDir`, `priorityScore`, `walkFiles`, `isTextyName`, `WalkResult.{truncated, ignored}`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/no-caps.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// R11.1 / R11.2 regression guard: none of the old cap or keep-list machinery may come back.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd(), 'src/modules/data-port')
const FORBIDDEN = /\b(MAX_SCAN_FILES|MAX_DIRS_TO_VISIT|WIDE_ROOT_KEEP|isWideScanRoot|SKIP_UNDER_AI_DOT|SESSION_DIR_KEEP|CLAUDE_PROJECT_DIR|AI_ITEM_LIMIT|maxFiles|truncated|MAX_FILE_BYTES|MAX_UPLOAD_BYTES|SECRETS_HINT|JUNK_SKIP|isImportJunk)\b/

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (full.endsWith('.ts')) yield full
  }
}

describe('no caps, no keep-lists', () => {
  it('has no cap, keep-list or refusal symbol left under src/modules/data-port', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf-8')
      const m = FORBIDDEN.exec(text)
      if (m) hits.push(`${file.slice(ROOT.length + 1)}: ${m[1]}`)
    }
    expect(hits).toEqual([])
  })
  it("emits neither 'secrets' nor 'too-large' as a reason code", () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf-8')
      if (/reasonCode:\s*'(secrets|too-large)'/.test(text) || /'(secrets|too-large)'\)/.test(text)) hits.push(file)
    }
    expect(hits).toEqual([])
  })
})
```

```ts
// tests/modules/data-port/scan-directory-classes.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { classifyDirectory, collectCount, countTree, nameClass } from '@modules/data-port/scanners/directory-classes'
import { collectWalk, walkTree } from '@modules/data-port/scanners/scan-path'

let root: string
const mk = (rel: string, body = 'x') => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body)
}
const dir = (rel: string) => mkdirSync(join(root, rel), { recursive: true })
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dp-classes-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const cls = (name: string, children: string[] = [], siblings: string[] = [], parent = '/alpha') =>
  classifyDirectory(name, `${parent}/${name}`, children, siblings, parent)

describe('classifyDirectory (D-9, P-4)', () => {
  it('names the bare-name classes', () => {
    expect(cls('node_modules')).toBe('node_modules')
    for (const v of ['.git', '.hg', '.svn']) expect(cls(v)).toBe('vcs')
    expect(cls('.cache')).toBe('cache')
    expect(cls('__pycache__')).toBe('pycache')
    expect(cls('.venv')).toBe('venv')
    expect(cls('venv')).toBe('venv')
    expect(cls('.Trash')).toBe('trash')
    expect(cls('$RECYCLE.BIN')).toBe('trash')
    expect(cls('Trash', [], [], '/alpha/.local/share')).toBe('trash')
    expect(cls('Trash', [], [], '/alpha/Documents')).toBeNull()
    expect(cls('Caches', [], [], '/alpha/Library')).toBe('os-cache')
    expect(cls('Caches', [], [], '/alpha/Documents')).toBeNull()
  })
  it('takes build outputs only beside a build manifest', () => {
    for (const b of ['dist', 'build', 'out', '.next', '.turbo', 'target']) {
      expect(cls(b, [], ['package.json'])).toBe('build-output')
      expect(cls(b, [], ['notes.md'])).toBeNull()
    }
    expect(cls('target', [], ['Cargo.toml'])).toBe('build-output')
  })
  it('recognises browser profiles by content markers wherever they sit', () => {
    expect(cls('Default', ['Preferences', 'History'])).toBe('browser-profile')
    expect(cls('profile', ['Local State', 'Default'])).toBe('browser-profile')
    expect(cls('abc.default-release', ['prefs.js', 'places.sqlite'])).toBe('browser-profile')
    expect(cls('Default', ['Preferences'])).toBeNull()
  })
  it('classifies nothing else', () => {
    for (const n of ['Library', 'Applications', 'Downloads', 'Movies', 'Music', 'Pictures', 'vendor', 'coverage', 'GitHub', '.tox', 'relocations', 'sessions', 'plugins', '.config', '.ssh'])
      expect(cls(n)).toBeNull()
  })
})

describe('nameClass', () => {
  it('decides what is read, never what is listed', () => {
    expect(nameClass('.DS_Store')).toBe('app-state')
    expect(nameClass('notes.sqlite')).toBe('derived-db')
    expect(nameClass('logo.png')).toBe('binary')
    expect(nameClass('script')).toBe('unknown')
    expect(nameClass('.env.local')).toBe('text')
    expect(nameClass('run.log')).toBe('text')
    expect(nameClass('Makefile')).toBe('text')
    expect(nameClass('rules.mdc')).toBe('text')
  })
})

describe('countTree', () => {
  it('counts a class directory without descending it in the walk', () => {
    mk('alpha/node_modules/a/b/c.js'); mk('alpha/node_modules/d.js'); dir('alpha/node_modules/e')
    expect(collectCount(join(root, 'alpha/node_modules'))).toEqual({ files: 2, dirs: 3, unreadable: 0 })
    const { entries } = collectWalk(root)
    const skipped = entries.filter((e) => e.type === 'directory-skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ cls: 'node_modules', files: 2, dirs: 3 })
    expect(entries.some((e) => e.type === 'file' && e.path.includes('node_modules'))).toBe(false)
  })
  it('counts a symlink inside a class directory as a file and never follows it', () => {
    mk('alpha/node_modules/x.js')
    symlinkSync(join(root, 'alpha/node_modules'), join(root, 'alpha/node_modules/loop'))
    expect(collectCount(join(root, 'alpha/node_modules'))).toEqual({ files: 2, dirs: 0, unreadable: 0 })
  })
  it('ticks while counting a big class directory, before the skipped entry is yielded', () => {
    // 300 folders × 5 files: more than PROGRESS_EVERY_DIRS directories under one class root.
    for (let d = 0; d < 300; d++) for (let f = 0; f < 5; f++) mk(`alpha/node_modules/p${d}/f${f}.js`)
    mk('alpha/notes.md', '# n')
    let ticks = 0
    const g = countTree(join(root, 'alpha/node_modules'))
    let n = g.next(); while (!n.done) { ticks++; n = g.next() }
    expect(ticks).toBeGreaterThanOrEqual(1); expect(n.value).toEqual({ files: 1500, dirs: 300, unreadable: 0 })
    // The walker forwards those ticks: at least one `tick` precedes the `directory-skipped` entry.
    const seen: string[] = []
    for (const e of walkTree(root)) { seen.push(e.type); if (e.type === 'directory-skipped') break }
    expect(seen.indexOf('tick')).toBeGreaterThanOrEqual(0); expect(seen.indexOf('tick')).toBeLessThan(seen.indexOf('directory-skipped'))
  })
})

describe('skill package roots', () => {
  it('names the nearest skill root on every file and says when the package is done, whatever the listing order', () => {
    mk('.claude/skills/deploy/.env', 'x'); mk('.claude/skills/deploy/README.md', '# r'); mk('.claude/skills/deploy/SKILL.md', '# s')
    mk('.claude/skills/deploy/scripts/run.sh', 'echo'); mk('.claude/skills/deploy/nested/SKILL.md', '# inner'); mk('.claude/skills/deploy/nested/a.txt', 'a')
    mk('notes/plain.md', '# p')
    const { entries } = collectWalk(root)
    const rootOf = (rel: string) => (entries.find((e) => e.type === 'file' && (e as any).path.endsWith(rel)) as any).skillRoot
    const deploy = join(root, '.claude/skills/deploy')
    for (const rel of ['deploy/.env', 'deploy/README.md', 'deploy/SKILL.md', 'deploy/scripts/run.sh']) expect(rootOf(rel)).toBe(deploy)
    expect(rootOf('nested/a.txt')).toBe(join(deploy, 'nested'))
    expect(rootOf('notes/plain.md')).toBeNull()
    const types = entries.map((e) => e.type)
    const doneIdx = entries.findIndex((e) => e.type === 'skill-package-done' && (e as any).root === deploy)
    expect(doneIdx).toBeGreaterThan(entries.findIndex((e) => e.type === 'file' && (e as any).path.endsWith('scripts/run.sh')))
    expect(types.filter((t) => t === 'skill-package-done')).toHaveLength(2)
  })
})

describe('walker and classes', () => {
  it('never classifies the scan root', () => {
    mk('index.js')
    const nm = join(root, 'node_modules'); mkdirSync(nm); writeFileSync(join(nm, 'm.js'), 'x')
    const { entries } = collectWalk(nm)
    expect(entries.filter((e) => e.type === 'file').map((e) => e.path)).toEqual([join(nm, 'm.js')])
  })
  it('classifies a symlink by its real directory', () => {
    mk('alpha/node_modules/m/index.js'); dir('notes')
    symlinkSync(join(root, 'alpha/node_modules'), join(root, 'notes/deps'))
    const { entries } = collectWalk(root)
    expect(entries.filter((e) => e.type === 'directory-skipped').map((e) => (e as any).cls)).toEqual(['node_modules', 'node_modules'])
  })
})
```

```ts
// tests/modules/data-port/scan-walk.test.ts — rewrite against collectWalk. Keep the fixtures; replace the cases:
import { collectWalk, walkTree } from '@modules/data-port/scanners/scan-path'
const files = (root: string, opts?: { followSymlinks?: boolean }) => {
  const { entries, summary } = collectWalk(root, opts)
  return { files: entries.filter((e) => e.type === 'file').map((e) => (e as any).path), entries, summary }
}

describe('data-port walker (R11.2)', () => {
  it('walks into .claude/skills and follows symlinks', () => {
    // fixture (kept): .claude/skills/x/SKILL.md and notes/ai-memory/linked.md → a symlink to real/linked.md
    const r = files(root)
    expect(r.files.some((f) => f.endsWith('.claude/skills/x/SKILL.md'))).toBe(true)
    expect(r.files.some((f) => f.endsWith('notes/ai-memory/linked.md'))).toBe(true)
    expect(r.summary.symlinksFollowed).toBe(1)
    expect(r.entries.some((e) => e.type === 'tick')).toBe(false) // collectWalk drops ticks
  })
  it('carries the running counters on every tick', () => {
    for (let i = 0; i < 1100; i++) mk(`bulk/b${i}.md`)
    const ticks = [...walkTree(root)].filter((e) => e.type === 'tick') as Array<{ dirsVisited: number; filesSeen: number }>
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.map((t) => t.filesSeen)).toEqual([...ticks.map((t) => t.filesSeen)].sort((a, b) => a - b))
    expect(ticks.at(-1)!.filesSeen).toBeGreaterThanOrEqual(1000); expect(ticks[0]!.dirsVisited).toBeGreaterThanOrEqual(1)
  })
  it('does not follow symlinks when the caller turns them off', () => {
    const r = files(root, { followSymlinks: false })
    expect(r.entries.find((e) => e.type === 'symlink-unfollowed' && (e as any).path.endsWith('notes/ai-memory/linked.md'))).toBeTruthy()
  })
  it('lists project transcripts of a home-shaped root', () => {
    // fixture: .claude/projects/slug/memory/n.md and .claude/projects/slug/x.jsonl
    expect(files(root).files.some((f) => f.endsWith('.claude/projects/slug/x.jsonl'))).toBe(true)
  })
  it('enters every dot-directory', () => {
    for (const rel of ['.grok/relocations/a.json', '.grok/memtrace/b.json', '.config/foo/bar.toml', '.ssh/config']) mk(rel)
    const list = files(root).files
    for (const rel of ['.grok/relocations/a.json', '.grok/memtrace/b.json', '.config/foo/bar.toml', '.ssh/config']) expect(list.some((f) => f.endsWith(rel))).toBe(true)
  })
  it('maps every top-level folder of a home-shaped root', () => {
    // fixture: .claude/, .grok/memory/alpha-note.md, Documents/Vault/.obsidian/app.json + note, GitHub/alpha/pkg-N/note.md ×80, GitHub/alpha/src/README.md, Library/Caches/x, Library/Application Support/alpha/state.json
    const r = files(root)
    expect(r.files.filter((f) => /GitHub\/alpha\/pkg-\d+\/note\.md$/.test(f))).toHaveLength(80)
    expect(r.files.some((f) => f.endsWith('.grok/memory/alpha-note.md'))).toBe(true)
    expect(r.files.some((f) => f.endsWith('Library/Application Support/alpha/state.json'))).toBe(true)
    expect(r.entries.find((e) => e.type === 'directory-skipped' && (e as any).cls === 'os-cache')).toBeTruthy()
    expect(r.summary.dirsVisited).toBeGreaterThanOrEqual(84)
  })
  it('lists a non-text file everywhere, as a file entry', () => {
    mk('notes/logo.png'); mk('.claude/skills/x/SKILL.md'); mk('.claude/skills/x/logo.png')
    const list = files(root).files
    expect(list.filter((f) => f.endsWith('logo.png'))).toHaveLength(2)
  })
  it('yields .DS_Store as a file entry', () => { mk('notes/.DS_Store'); expect(files(root).files.some((f) => f.endsWith('.DS_Store'))).toBe(true) })
  it('yields a symlink cycle as an alias and terminates', () => {
    mk('a/b/n.md'); symlinkSync(join(root, 'a'), join(root, 'a/b/up'))
    const r = files(root)
    expect(r.files.filter((f) => f.endsWith('n.md'))).toHaveLength(1)
    expect(r.entries.find((e) => e.type === 'directory-alias' && (e as any).cycle)).toBeTruthy()
    expect(r.summary.symlinkCycles).toBe(1)
  })
  it('yields a broken symlink as a visible entry', () => {
    symlinkSync(join(root, 'nowhere'), join(root, 'dangling'))
    expect(files(root).entries.find((e) => e.type === 'symlink-broken')).toMatchObject({ target: join(root, 'nowhere') })
  })
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('yields an unreadable directory', () => {
    dir('locked'); mk('locked/x.md'); chmodSync(join(root, 'locked'), 0o000)
    try { expect(files(root).entries.find((e) => e.type === 'directory-unreadable')).toBeTruthy() } finally { chmodSync(join(root, 'locked'), 0o755) }
  })
  it('reaches every file of a 5-level tree with no cap', () => {
    for (let d = 0; d < 300; d++) for (let f = 0; f < 10; f++) mk(`l1/l2-${d % 10}/l3-${d}/l4/l5/f${f}.md`)
    const r = files(root)
    expect(r.files).toHaveLength(3000)
    expect(r.summary.filesSeen).toBe(3000)
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/no-caps.test.ts tests/modules/data-port/scan-directory-classes.test.ts tests/modules/data-port/scan-walk.test.ts` → FAIL.

- [ ] **Step 3: Write `directory-classes.ts`**

```ts
// src/modules/data-port/scanners/directory-classes.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-9: the ONLY directory classes the walker does not enter. A stricter marker
// makes the walker map MORE, never less (P-4). Everything else is walked.

import { readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { PROGRESS_EVERY_DIRS, PROGRESS_EVERY_FILES } from '../constants.js'
import type { DirectoryClass } from '../types.js'

const VCS = new Set(['.git', '.hg', '.svn'])
const VENV = new Set(['.venv', 'venv'])
const BUILD_DIRS = new Set(['dist', 'build', 'out', '.next', '.turbo', 'target'])
export const BUILD_MANIFESTS = new Set([
  'package.json', 'tsconfig.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'setup.cfg', 'go.mod',
  'build.gradle', 'build.gradle.kts', 'pom.xml', 'CMakeLists.txt', 'Makefile', 'deno.json',
  'bun.lockb', 'bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
])
const TRASH = new Set(['.Trash', '.Trashes', '$RECYCLE.BIN'])

function isBrowserProfile(children: Set<string>): boolean {
  if (children.has('Local State') && children.has('Default')) return true // Chromium user-data root
  if (children.has('Preferences') && (children.has('History') || children.has('Cookies') || children.has('Web Data'))) return true // Chromium profile
  if (children.has('prefs.js') && children.has('places.sqlite')) return true // Firefox profile
  return false
}

/**
 * `name` is the entry name as reached; `realDir` the resolved directory (a link
 * into node_modules is still node_modules); `childNames` its real entries;
 * `siblingNames` the parent's entries; `parentPath` the parent as reached.
 */
export function classifyDirectory(
  name: string,
  realDir: string,
  childNames: readonly string[],
  siblingNames: readonly string[],
  parentPath: string,
): DirectoryClass | null {
  const names = new Set([name, basename(realDir)])
  const children = new Set(childNames)
  const siblings = new Set(siblingNames)
  if (names.has('node_modules')) return 'node_modules'
  if ([...names].some((n) => VCS.has(n))) return 'vcs'
  if (names.has('.cache')) return 'cache'
  if (names.has('__pycache__')) return 'pycache'
  if ([...names].some((n) => VENV.has(n))) return 'venv'
  if ([...names].some((n) => BUILD_DIRS.has(n)) && [...siblings].some((s) => BUILD_MANIFESTS.has(s))) return 'build-output'
  if (isBrowserProfile(children)) return 'browser-profile'
  if ([...names].some((n) => TRASH.has(n))) return 'trash'
  if (names.has('Trash') && parentPath.replace(/\\/g, '/').endsWith('/.local/share')) return 'trash'
  if (names.has('Caches') && basename(parentPath) === 'Library') return 'os-cache'
  return null
}

export interface TreeCount { files: number; dirs: number; unreadable: number }

/**
 * Everything under a class directory, counted with readdir only — no stat, no
 * read, no symlink following (a link inside node_modules is a file to this
 * count). Iterative, so depth never matters; no cap, the cost is time (R11.1).
 * A generator: it yields `'tick'` every PROGRESS_EVERY_DIRS directories or
 * PROGRESS_EVERY_FILES entries so the walker can forward the tick and the
 * driver can yield to the event loop — a million-entry `Library/Caches` or
 * `node_modules` must never freeze the server (P-9).
 */
export function* countTree(dir: string): Generator<'tick', TreeCount> {
  const out: TreeCount = { files: 0, dirs: 0, unreadable: 0 }
  const stack = [dir]
  let dirsSinceTick = 0, entriesSinceTick = 0
  while (stack.length) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      out.unreadable++
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) { out.dirs++; stack.push(`${current}/${e.name}`) }
      else out.files++ // regular files and symlinks alike
      if (++entriesSinceTick >= PROGRESS_EVERY_FILES) { entriesSinceTick = 0; yield 'tick' }
    }
    if (++dirsSinceTick >= PROGRESS_EVERY_DIRS) { dirsSinceTick = 0; yield 'tick' }
  }
  return out
}

/** Drains `countTree` — tests and the synchronous upload path. */
export function collectCount(dir: string): TreeCount {
  const g = countTree(dir)
  let n = g.next()
  while (!n.done) n = g.next()
  return n.value
}

export const SPECIAL_TEXT_NAMES = new Set([
  'claude.md', 'agents.md', 'gemini.md', 'global_rules.md', 'skill.md', 'memory.md', 'soul.md', 'identity.md', 'tools.md',
  '.cursorrules', '.gitignore', '.editorconfig', 'makefile', 'dockerfile', 'license', 'licence', 'readme', 'copying', 'authors', 'notice',
])
const APP_STATE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '.localized'])
const DERIVED_DB_EXT = /\.(sqlite|sqlite-wal|sqlite-shm|db|ldb)$/i
const BINARY_EXTS = new Set(('png jpg jpeg gif webp heic heif bmp ico tif tiff psd ai pdf zip gz tgz bz2 xz 7z rar dmg pkg iso img exe dll so dylib o a lib class jar war wasm woff woff2 ttf otf eot mp3 m4a wav flac ogg mp4 mov mkv avi webm pyc pyo pyd pb bin dat db-journal p12 pfx xls xlsx').split(' ').map((e) => `.${e}`))
const TEXT_EXTS = new Set(('md markdown mdown txt text rst adoc org xml html htm csv tsv ini cfg conf plist mdc yaml yml toml json jsonl lock ts tsx js jsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sql css scss less vue svelte tex bib log pl lua r m gradle properties bat ps1 sh zsh bash fish env pem key crt cer map').split(' ').map((e) => `.${e}`))

/** Every regular file is a row; the name decides only whether its BYTES are read. */
export function nameClass(name: string): 'text' | 'binary' | 'derived-db' | 'app-state' | 'unknown' {
  const lower = name.toLowerCase()
  if (APP_STATE_NAMES.has(lower)) return 'app-state'
  if (SPECIAL_TEXT_NAMES.has(lower) || lower === '.env' || lower.startsWith('.env.') || lower.endsWith('.env')) return 'text'
  if (DERIVED_DB_EXT.test(lower)) return 'derived-db'
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return 'unknown'
  const ext = lower.slice(dot)
  if (BINARY_EXTS.has(ext)) return 'binary'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'unknown'
}
```

- [ ] **Step 4: Rewrite the walker as a generator**

```ts
// src/modules/data-port/scanners/scan-path.ts — replaces everything from the old constants down to (not including) `interface SkillAsset`
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { generateId } from '@shared/crypto'
import { HEAD_CHARS, LARGE_CONTAINER_WARN_BYTES, LARGE_TEXT_WARN_BYTES, PROGRESS_EVERY_DIRS, PROGRESS_EVERY_FILES, SNIFF_BYTES, STREAM_CHUNK_BYTES } from '../constants.js'
import { adapterFor, classifyFile, detectProfile } from '../adapters/registry.js'
import { compareRelPathBytes } from '../skill-package.js'
import { DIRECTORY_CLASSES, type DirectoryClass, type ScanCandidate, type ScanDirRow, type ScanResult, type ScanStats, type ScanWarning, type SourceProfile } from '../types.js'
import { looksLikeSecrets, previewOf, rootMarkerPrefix, titleFromPathAndContent } from './heuristics.js'
import { classifyDirectory, countTree, nameClass } from './directory-classes.js'

/** Directories whose files the owner wants to see first in progress reports; never an inclusion rule. */
const PRIORITY_NAME_RE = /^(ai-memory|skills|memory|agents|semantic|procedural)$/i
const PRIORITY_PATH_RE = /(ai-memory|\/skills\/|\/memory\/)/i
const toPosix = (p: string): string => p.replace(/\\/g, '/')

export type WalkEntry =
  /** `skillRoot`: the nearest directory (this file's own included) whose listing holds `skill.md`; the walker knows it from the listing, so listing order never matters. */
  | { type: 'file'; path: string; realPath: string; size: number; mtime: string; birthtime: string; viaSymlink: boolean; skillRoot: string | null; inVault: boolean }
  | { type: 'file-alias'; realPath: string; path: string }
  | { type: 'directory'; path: string; realPath: string; parent: string | null; depth: number; fileCount: number }
  | { type: 'directory-skipped'; path: string; realPath: string; parent: string; depth: number; cls: DirectoryClass; files: number; dirs: number; unreadable: number }
  | { type: 'directory-unreadable'; path: string; error: string }
  /** `firstPath`: the path this real directory was first reached at — the path its rows carry. */
  | { type: 'directory-alias'; realPath: string; path: string; firstPath: string; cycle: boolean }
  | { type: 'symlink-unfollowed'; path: string }
  | { type: 'symlink-broken'; path: string; target: string }
  /** Every directory under `root` (a directory whose listing holds `skill.md`) has been processed: the package is complete. */
  | { type: 'skill-package-done'; root: string }
  /** Running counters, so the driver reports real numbers (never zeros). */
  | { type: 'tick'; dirsVisited: number; filesSeen: number }

export interface WalkSummary {
  dirsVisited: number
  filesSeen: number
  dirsSkipped: Record<DirectoryClass, number>
  filesInSkippedDirs: number
  symlinksFollowed: number
  symlinkAliases: number
  symlinkCycles: number
  unreadable: number
  vaultRoots: string[]
  dirAliases: Map<string, string[]>
  fileAliases: Map<string, string[]>
}

const zeroClasses = (): Record<DirectoryClass, number> =>
  Object.fromEntries(DIRECTORY_CLASSES.map((c) => [c, 0])) as Record<DirectoryClass, number>

/**
 * Every directory under `root`, breadth first, every real directory entered at
 * most once (realpath de-dupe is also the cycle detector). No file cap, no
 * directory cap, no keep-list: inclusion is decided ONLY by `classifyDirectory`
 * (D-9) and the scan root itself is never classified. Yields a `tick` every
 * PROGRESS_EVERY_FILES files / PROGRESS_EVERY_DIRS directories so the driver can
 * report and yield to the event loop.
 */
export function* walkTree(root: string, opts: { followSymlinks?: boolean } = {}): Generator<WalkEntry, WalkSummary> {
  const followSymlinks = opts.followSymlinks !== false
  const rootResolved = resolve(root)
  const realRoot = safeRealpath(rootResolved) ?? rootResolved
  /** real directory → the path it was first reached at (the de-dupe set and the alias source in one). */
  const visitedDirs = new Map<string, string>()
  const seenFiles = new Set<string>()
  const summary: WalkSummary = {
    dirsVisited: 0, filesSeen: 0, dirsSkipped: zeroClasses(), filesInSkippedDirs: 0, symlinksFollowed: 0,
    symlinkAliases: 0, symlinkCycles: 0, unreadable: 0, vaultRoots: [], dirAliases: new Map(), fileAliases: new Map(),
  }
  /** realDir → its real ancestor chain, for cycle detection. */
  const ancestors = new Map<string, string[]>([[realRoot, []]])
  /**
   * Skill packages: `skillRoots` on a queue item are the ancestor directories
   * (outermost first) whose listing holds `skill.md`; the nearest is the last.
   * `pendingUnder` counts queued-but-unprocessed directories under each root
   * (the root itself included) — when it reaches 0 the package is complete and
   * `skill-package-done` is yielded, so the scanner can emit the SKILL.md row
   * with every asset attached, whatever order readdir listed them in.
   */
  type Q = { dir: string; parent: string | null; depth: number; skillRoots: string[] }
  const pendingUnder = new Map<string, number>()
  const priority: Q[] = [{ dir: rootResolved, parent: null, depth: 0, skillRoots: [] }]
  const normal: Q[] = []
  let sinceTick = 0
  let dirsSinceTick = 0
  const tick = (): Extract<WalkEntry, { type: 'tick' }> => ({ type: 'tick', dirsVisited: summary.dirsVisited, filesSeen: summary.filesSeen })
  /** A directory under these roots is finished (processed, aliased, unreadable or skipped): count it down, yield the roots that complete. */
  function* finishUnder(roots: string[]): Generator<WalkEntry> {
    for (const r of roots) {
      const left = (pendingUnder.get(r) ?? 1) - 1
      if (left > 0) pendingUnder.set(r, left)
      else { pendingUnder.delete(r); yield { type: 'skill-package-done', root: r } }
    }
  }

  while (priority.length || normal.length) {
    const item = priority.shift() ?? normal.shift()!
    const { dir, parent, depth } = item
    summary.dirsVisited++
    const realDir = safeRealpath(dir)
    if (!realDir) { summary.unreadable++; yield { type: 'directory-unreadable', path: dir, error: 'ENOENT' }; yield* finishUnder(item.skillRoots); continue }
    if (visitedDirs.has(realDir)) {
      const chain = ancestors.get(safeRealpath(parent ?? '') ?? '') ?? []
      const cycle = realDir === realRoot || chain.includes(realDir)
      if (cycle) summary.symlinkCycles++
      summary.dirAliases.set(realDir, [...(summary.dirAliases.get(realDir) ?? []), dir])
      yield { type: 'directory-alias', realPath: realDir, path: dir, firstPath: visitedDirs.get(realDir)!, cycle }
      yield* finishUnder(item.skillRoots)
      continue
    }
    visitedDirs.set(realDir, dir)
    if (parent) ancestors.set(realDir, [...(ancestors.get(safeRealpath(parent) ?? '') ?? []), safeRealpath(parent) ?? parent])

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      summary.unreadable++
      yield { type: 'directory-unreadable', path: dir, error: errnoOf(err) }
      yield* finishUnder(item.skillRoots)
      continue
    }
    const names = entries.map((e) => String(e.name))
    if (names.includes('.obsidian')) summary.vaultRoots.push(dir)
    const dirHasSkill = names.some((n) => n.toLowerCase() === 'skill.md')
    const skillRoots = dirHasSkill ? [...item.skillRoots, dir] : item.skillRoots
    if (dirHasSkill) pendingUnder.set(dir, 1) // this directory itself; children are added as they are queued
    const skillRoot = skillRoots.length ? skillRoots[skillRoots.length - 1]! : null
    const inVault = summary.vaultRoots.some((v) => dir === v || dir.startsWith(v + sep))

    let directFiles = 0
    const dirsPri: Q[] = []
    const dirsNorm: Q[] = []
    for (const entry of entries) {
      const name = String(entry.name)
      const full = join(dir, name)
      let isDir = false, isFile = false, viaSymlink = false, st
      try {
        const lst = lstatSync(full)
        if (lst.isSymbolicLink()) {
          if (!followSymlinks) { yield { type: 'symlink-unfollowed', path: full }; continue }
          viaSymlink = true
          try { st = statSync(full) } catch {
            summary.unreadable++
            yield { type: 'symlink-broken', path: full, target: safeReadlink(full) }
            continue
          }
          summary.symlinksFollowed++
        } else st = lst
        isDir = st.isDirectory(); isFile = st.isFile()
      } catch (err) {
        summary.unreadable++
        yield { type: 'directory-unreadable', path: full, error: errnoOf(err) }
        continue
      }

      if (isDir) {
        const realChild = safeRealpath(full) ?? full
        let childNames: string[]
        try { childNames = readdirSync(realChild) as string[] } catch (err) {
          summary.unreadable++
          yield { type: 'directory-unreadable', path: full, error: errnoOf(err) }
          continue
        }
        const cls = classifyDirectory(name, realChild, childNames, names, dir)
        if (cls) {
          // Cooperative count: every tick of countTree is forwarded so the driver can yield mid-count (P-9).
          const counter = countTree(realChild)
          let cn = counter.next()
          while (!cn.done) { yield tick(); cn = counter.next() }
          const counted = cn.value
          summary.dirsSkipped[cls]++
          summary.filesInSkippedDirs += counted.files
          yield { type: 'directory-skipped', path: full, realPath: realChild, parent: dir, depth: depth + 1, cls, ...counted }
          continue // a class directory is never queued, so it never counts toward a skill root
        }
        const q: Q = { dir: full, parent: dir, depth: depth + 1, skillRoots }
        for (const r of skillRoots) pendingUnder.set(r, (pendingUnder.get(r) ?? 0) + 1)
        if (PRIORITY_NAME_RE.test(name) || PRIORITY_PATH_RE.test(toPosix(full))) dirsPri.push(q); else dirsNorm.push(q)
        continue
      }
      if (!isFile) continue
      summary.filesSeen++
      directFiles++
      const key = safeRealpath(full) ?? full
      if (seenFiles.has(key)) {
        summary.symlinkAliases++
        summary.fileAliases.set(key, [...(summary.fileAliases.get(key) ?? []), full])
        yield { type: 'file-alias', realPath: key, path: full }
      } else {
        seenFiles.add(key)
        yield {
          type: 'file', path: full, realPath: key, size: st!.size, mtime: st!.mtime.toISOString(), birthtime: st!.birthtime.toISOString(),
          viaSymlink, skillRoot, inVault,
        }
      }
      if (++sinceTick >= PROGRESS_EVERY_FILES) { sinceTick = 0; yield tick() }
    }
    yield { type: 'directory', path: dir, realPath: realDir, parent, depth, fileCount: directFiles }
    priority.push(...dirsPri)
    normal.push(...dirsNorm)
    // This directory is processed and its children are queued: count it down for every skill root above it.
    yield* finishUnder(skillRoots)
    if (++dirsSinceTick >= PROGRESS_EVERY_DIRS) { dirsSinceTick = 0; yield tick() }
  }
  return summary
}

/** Drains the generator — tests and the synchronous upload path. */
export function collectWalk(root: string, opts: { followSymlinks?: boolean } = {}): { entries: WalkEntry[]; summary: WalkSummary } {
  const entries: WalkEntry[] = []
  const gen = walkTree(root, opts)
  let next = gen.next()
  while (!next.done) { if (next.value.type !== 'tick') entries.push(next.value); next = gen.next() }
  return { entries, summary: next.value }
}

function safeRealpath(p: string): string | null { try { return realpathSync(p) } catch { return null } }
function safeReadlink(p: string): string { try { return readlinkSync(p) } catch { return '' } }
function errnoOf(err: unknown): string { return (err as { code?: string })?.code ?? String(err) }
```

Termination: every real directory enters `visitedDirs` at most once; the queue is explicit; `countTree` never follows links. Depth and count caps are therefore unnecessary and absent. Package completion: a root's `pendingUnder` counter is incremented once per queued child directory (class directories are never queued) and decremented exactly once per dequeued item under it — processed, aliased or unreadable — so it reaches 0 exactly when the last directory of the package has been yielded, and `skill-package-done` follows every `file` entry of that package. `collectWalk` keeps `skill-package-done` entries (only `tick` is dropped).

- [ ] **Step 5: Run** — `bun vitest run tests/modules/data-port/no-caps.test.ts tests/modules/data-port/scan-directory-classes.test.ts tests/modules/data-port/scan-walk.test.ts` → PASS (the `no-caps` test also needs Task 5 / Task 7 to remove `SECRETS_HINT`/`JUNK_SKIP`/`MAX_*` from their files; until then it reports those names — that is expected inside Wave 1 and green at the end of Wave 2).

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 5: Secrets heuristic as a flag; every text file importable; sessions, rules, legacy and third-party defaults (R11.3, R11.4, D-8)

**Files:**
- Modify: `src/modules/data-port/scanners/heuristics.ts`, `src/modules/data-port/scanners/instructions.ts`
- Modify: `tests/modules/data-port/heuristics.test.ts`, `tests/modules/data-port/instructions.test.ts`

**Interfaces:**
- Produces: `looksLikeSecrets(rel, content)` (corrected), `classifyPath(rel, content, profile)` (never `target: 'none'` for text; tags), `isLegacyMemoryPath(p)`, `isThirdPartyDocPath(p)`, `isObsidianConfigPath(p)` (`.obsidian/**` → `knowledge`/`config`, unticked), `isBoilerplateName(base)`, `RULE_FILE_RE` (assistant rule dirs or `.mdc` only), `CODE_EXTS`, `DATA_EXTS`, `NOTE_EXTS`.
- Deletes: `SECRETS_HINT`, `JUNK_SKIP`, `JUNK_BASE`, `isImportJunk`, the `node_modules/` / `.git/` path rule, the text formats in the binary list, the `notesPick` profile gate, the 80-character selection gate.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/heuristics.test.ts — rewrite the affected cases; keep the rest
describe('looksLikeSecrets (R11.4 heuristic fix)', () => {
  it('does not flag code that looks a secret up', () => {
    for (const line of [
      'TOKEN = keychain_lookup("alpha")', 'API_KEY = os.environ["ALPHA_KEY"]', 'password = getenv("ALPHA_PW")',
      'const apiKey = process.env.ALPHA_API_KEY', 'API_KEY=process.env.ALPHA_API_KEY',
      'TOKEN=$(security find-generic-password -s alpha -w)', 'TOKEN=${ALPHA_TOKEN}', 'SECRET=config.secrets.alpha',
    ]) expect(looksLikeSecrets('a/fetch.py', line)).toBe(false)
  })
  it('does not flag documentation placeholders', () => {
    for (const line of [
      'API_KEY=<your-api-key>', 'PASSWORD="your-password-here"', 'TOKEN=xxxxxxxxxxxxxxxxxxxx',
      'OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx', 'API_KEY=************', 'SECRET=...', 'TOKEN=changeme-changeme',
    ]) expect(looksLikeSecrets('README.md', line)).toBe(false)
  })
  it('still flags a literal credential', () => {
    for (const line of [
      'API_KEY=alphabravo0123456789', "export TOKEN='alpha.bravo.charlie.delta0'", 'DB_PASSWORD=alphaalphaalpha0001',
      'ghp_alphaalphaalphaalphaalpha01', 'sk-alpha_bravo-charlie0123456789', 'AKIAALPHABRAVO123456',
      '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    ]) expect(looksLikeSecrets('notes.md', line)).toBe(true)
  })
  it('names templates as documentation and env files as credentials', () => {
    for (const f of ['.env.example', '.env.sample', 'a/.env.template', 'environment.md']) expect(looksLikeSecrets(f, '')).toBe(false)
    for (const f of ['.env', '.env.local', 'alpha.env', 'id_rsa', 'server.pem']) expect(looksLikeSecrets(f, '')).toBe(true)
  })
})

describe('classifyPath defaults (R11.3, D-8)', () => {
  it('never gives a text file target none', () => {
    for (const f of ['a.log', 'a.csv', 'a.tsv', 'a.map', 'a.min.js', 'a.pem', 'a.sh', 'a.py', 'a.yaml', 'a.toml', 'a.ts']) {
      const h = classifyPath(`alpha/${f}`, 'text\n')
      expect(h.target).not.toBe('none'); expect(h.kind).not.toBe('noise')
    }
    expect(classifyPath('alpha/bun.lock', '{}').reasonCode).toBe('derived-index')
    expect(classifyPath('alpha/a.png', '').reasonCode).toBe('binary')
  })
  it('lists source code importable but unticked, data files likewise', () => {
    expect(classifyPath('GitHub/alpha/src/main.ts', 'export {}')).toMatchObject({ kind: 'code', target: 'vault.semantic', reasonCode: 'source-code', selectedByDefault: false })
    expect(classifyPath('a/b.yaml', 'a: 1')).toMatchObject({ kind: 'knowledge', reasonCode: 'data-file', selectedByDefault: false })
    expect(classifyPath('.claude/settings.json', '{}')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', target: 'vault.semantic', selectedByDefault: false })
    expect(classifyPath('.grok/relocations/r1.json', '{}')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
  })
  it('flags secrets and keeps the real kind', () => {
    expect(classifyPath('.env', 'API_KEY=alphabravo0123456789')).toMatchObject({ kind: 'knowledge', reasonCode: 'data-file', selectedByDefault: false, tags: ['contains-secrets'] })
    expect(classifyPath('ai-memory/note.md', '---\ntype: project\n---\nAPI_KEY=alphabravo0123456789', 'claude-code')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['contains-secrets'] })
  })
  it('selects session notes of both classes', () => {
    expect(classifyPath('vault/claude-sessions/2026-08/x.md', '---\ntype: claude-session\n---\nlog', 'obsidian')).toMatchObject({ kind: 'session', target: 'episodic', reasonCode: 'session-summary', selectedByDefault: true })
    expect(classifyPath('notes/x.md', '---\ntype: grok-session\n---\nlog')).toMatchObject({ kind: 'session', selectedByDefault: true })
    expect(classifyPath('vault/claude-sessions/claude-sessions.md', '---\ntype: moc\n---\n# index').kind).not.toBe('session')
  })
  it('imports rule files anywhere as proposals', () => {
    for (const f of ['GitHub/alpha/AGENTS.md', 'GitHub/alpha/CLAUDE.md', 'GitHub/alpha/GEMINI.md', 'GitHub/alpha/.cursorrules', 'GitHub/alpha/.windsurf/rules/global_rules.md'])
      expect(classifyPath(f, '# rules')).toMatchObject({ kind: 'rule', target: 'workspace.agents', reasonCode: 'rules-file', selectedByDefault: true })
    expect(classifyPath('GitHub/alpha/.cursor/rules/py.mdc', '# py')).toMatchObject({ kind: 'rule' })
    expect(classifyPath('GitHub/alpha/.claude/rules/style.md', '# style')).toMatchObject({ kind: 'rule' })
    expect(classifyPath('alpha/rules/data.csv', 'a,b').kind).not.toBe('rule')
    // A vault folder that happens to be called `rules` holds notes, not agent rules (only assistant rule dirs and `.mdc` count).
    expect(classifyPath('Areas/rules/style.md', '# house style')).toMatchObject({ kind: 'memory' })
    expect(classifyPath('GitHub/alpha/docs/tools.md', '# tools')).toMatchObject({ kind: 'memory' })
  })
  it('lists Obsidian configuration as importable config, unticked, never as app-state', () => {
    for (const f of ['Documents/Vault/.obsidian/app.json', 'Documents/Vault/.obsidian/workspace.json', 'Documents/Vault/.obsidian/plugins/alpha/data.json', 'Documents/Vault/.obsidian/snippets/theme.css'])
      expect(classifyPath(f, '{}')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', target: 'vault.semantic', selectedByDefault: false })
  })
  it('imports any markdown under any profile and labels third-party and legacy', () => {
    expect(classifyPath('docs/howto.md', '# How to ship', 'claude-code')).toMatchObject({ kind: 'memory', target: 'vault.procedural', selectedByDefault: true })
    expect(classifyPath('notes/short.md', '# hi\n', 'generic-md').selectedByDefault).toBe(true)
    expect(classifyPath('.grok/docs/user-guide/13-memory.md', '# Cross-Session Memory')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['third-party'] })
    expect(classifyPath('GitHub/flutter/docs/howto.md', '# how to')).toMatchObject({ kind: 'memory', target: 'vault.procedural', selectedByDefault: true })
    expect(classifyPath('shop/robots.txt', 'User-agent: *')).toMatchObject({ kind: 'memory', reasonCode: 'not-durable', selectedByDefault: true })
    for (const f of ['.claude/projects/alpha/memory.local-backup-2026-05-09/project_x.md', 'vault/ai-memory/memory.old/x.md', 'notes/x.md.bak'])
      expect(classifyPath(f, 'body', 'claude-code')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['legacy'] })
  })
  it('anchors the dependency/vcs path rule on a real segment', () => {
    expect(classifyPath('alpha.git/notes.md', '# n').kind).toBe('memory')
    expect(classifyPath('alpha/.github/x.md', '# n').kind).toBe('memory')
    expect(classifyPath('alpha/.git/HEAD', 'ref: x')).toMatchObject({ kind: 'knowledge', reasonCode: 'unrecognised', selectedByDefault: false })
  })
})
```

```ts
// tests/modules/data-port/instructions.test.ts — change the base stub kind 'unknown' → 'knowledge' and add
  it('may tick a D-8 row the owner names, and never unticks a selected one', () => {
    const code = cand({ kind: 'code', reasonCode: 'source-code', relativePath: 'alpha/scripts/deploy.py', selectedByDefault: false, target: 'vault.semantic' })
    const [out] = applyInstructionHints([code], 'import my python scripts under alpha/scripts')
    expect(out.selectedByDefault).toBe(true)
    const note = cand({ kind: 'memory', selectedByDefault: true })
    expect(applyInstructionHints([note], 'only skills please')[0].selectedByDefault).toBe(true)
  })
```

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/heuristics.test.ts tests/modules/data-port/instructions.test.ts` → FAIL.

- [ ] **Step 3: Rewrite `looksLikeSecrets`**

```ts
// src/modules/data-port/scanners/heuristics.ts — replaces SECRETS_HINT + looksLikeSecrets
/** `.env.example` / `.env.sample` / `.env.template` / `.env.dist` are documentation, not credentials. */
const SECRET_NAME_TEMPLATES = /\.env\.(example|sample|template|dist)$/

/** A value that documents a secret instead of being one. */
function isSecretPlaceholder(value: string): boolean {
  const v = value.trim()
  if (/^<[^>]*>$/.test(v)) return true
  if (/^(\.{3,}|…+)$/.test(v)) return true
  if (/^(.)\1{7,}$/.test(v)) return true
  if (/(x{6,}|X{6,}|\*{4,})/.test(v)) return true
  if (/^['"]?(your|my|the|an?)[-_ ]/i.test(v)) return true
  if (/\b(your[-_]?|example|sample|dummy|placeholder|changeme|change[-_]me|redacted|todo|fixme)\b/i.test(v)) return true
  return false
}

/** Code that LOOKS UP a secret: a call, a subscript, a substitution, an env/config accessor chain. */
function isLookupExpression(value: string): boolean {
  const v = value.trim()
  if (/[()\[\]{}$`]/.test(v)) return true
  return /^(process\.env|os\.environ|os\.getenv|environ|env|ENV|Deno\.env|import\.meta\.env|System\.getenv|config|settings|secrets|vault|keychain|this|self|ctx|deps)\b/i.test(v)
}

const PRIVATE_KEY_BLOCK = /BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY/i
const PROVIDER_TOKEN = /\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/g
// NAME=value where NAME names a credential. Case-sensitive identifier (`apiKey`
// in TS is not `API_KEY` in .env); the value is captured so it can be judged.
const CREDENTIAL_ASSIGNMENT = /^[ \t]*(?:export[ \t]+|set[ \t]+)?([A-Z0-9_]*(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|TOKEN)[A-Z0-9_]*)[ \t]*=[ \t]*(['"]?)([^'"\s]{12,})\2/gm

/**
 * A FLAG, never a refusal (R11.4): the scanner tags the row `contains-secrets`
 * and recall hides it by default. Hard indicators only — a credential-shaped
 * file name, a private-key block, a provider token, a literal `KEY=value`.
 * A lookup (`keychain_lookup(...)`, `os.environ[...]`) and a placeholder
 * (`<your-key>`, `xxx`) are not secrets.
 */
export function looksLikeSecrets(relativePath: string, content: string): boolean {
  const base = posix(relativePath).split('/').pop() ?? ''
  if (!SECRET_NAME_TEMPLATES.test(base)) {
    if (
      base === '.env' || base.startsWith('.env.') || base.endsWith('.env') ||
      base === 'credentials.json' || base === 'id_rsa' || base === 'id_ed25519' || base === 'id_ecdsa' ||
      base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.p12') || base.endsWith('.pfx')
    ) return true
  }
  if (PRIVATE_KEY_BLOCK.test(content)) return true
  for (const m of content.matchAll(PROVIDER_TOKEN)) {
    if (!isSecretPlaceholder(m[1]!.replace(/^(sk-|ghp_|github_pat_|xox[baprs]-)/, ''))) return true
  }
  for (const m of content.matchAll(CREDENTIAL_ASSIGNMENT)) {
    const value = m[3]!
    if (isLookupExpression(value) || isSecretPlaceholder(value)) continue
    return true
  }
  return false
}
```

- [ ] **Step 4: Restructure `classifyPath`**

```ts
// src/modules/data-port/scanners/heuristics.ts — new predicates and the classifier skeleton
const BINARY_HINT: HeuristicHint = { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Binary file — no text to import', reasonCode: 'binary', selectedByDefault: false }
const DERIVED_HINT: HeuristicHint = { kind: 'noise', target: 'none', confidence: 0.9, reason: 'Derived index / generated state — not importable text', reasonCode: 'derived-index', selectedByDefault: false }

const BINARY_EXT = /\.(png|jpe?g|gif|webp|pdf|zip|p12|pfx|bin|exe|dll|so|dylib|o|class|wasm|xlsx?|pb)$/
const LOCKFILES = new Set(['package-lock.json', 'bun.lock', 'yarn.lock', 'pnpm-lock.yaml'])
export const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'lua', 'scala', 'dart', 'r', 'pl', 'm', 'mm', 'css', 'scss', 'less', 'vue', 'svelte', 'map', 'min.js', 'min.css'])
export const DATA_EXTS = new Set(['yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'plist', 'csv', 'tsv', 'xml', 'html', 'htm', 'svg', 'log', 'env', 'pem', 'key', 'crt', 'cer', 'properties', 'tex', 'bib'])
export const NOTE_EXTS = new Set(['md', 'markdown', 'mdown', 'txt', 'text', 'rst', 'adoc', 'org'])
const BOILERPLATE = new Set(['robots.txt', 'license', 'license.md', 'licence', 'licence.md', 'copying', 'changelog', 'changelog.md', 'contributing', 'contributing.md', 'code_of_conduct.md', 'security.md', 'authors', 'notice'])

export function isThirdPartyDocPath(p: string): boolean {
  const q = posix(p)
  return q.includes('.grok/docs/') || q.includes('/docs/user-guide/') || q.includes('/site-packages/') || q.includes('/vendor/')
}
export function isBoilerplateName(base: string): boolean {
  return BOILERPLATE.has(base) || base.startsWith('readme')
}
export function isLegacyMemoryPath(p: string): boolean {
  const q = posix(p)
  const base = q.split('/').pop() ?? q
  return /(^|\/)(memory\.local-backup[^/]*|memory\.old)\//.test(q) || base.endsWith('.bak')
}
/** Obsidian's own state (`.obsidian/**`): text, importable, unticked — the same treatment as assistant `settings.json` (R11.3, D-8). */
export function isObsidianConfigPath(p: string): boolean {
  return /(^|\/)\.obsidian\//.test(posix(p))
}
/** Agent rule folders (`.cursor/rules`, `.windsurf/rules`, `.claude/rules`, `.codeium/rules`) or any `.mdc`; a vault folder named `rules` is notes. */
const RULE_FILE_RE = /(^|\/)\.(cursor|windsurf|claude|codeium)\/rules\/[^/]+\.(md|mdc)$|\.mdc$/
const extOf = (base: string): string => {
  if (base.endsWith('.min.js')) return 'min.js'
  if (base.endsWith('.min.css')) return 'min.css'
  const dot = base.lastIndexOf('.'); return dot < 0 ? '' : base.slice(dot + 1)
}
const withTags = (hint: HeuristicHint, tags: string[]): HeuristicHint => (tags.length ? { ...hint, tags: [...new Set([...(hint.tags ?? []), ...tags])] } : hint)

/**
 * Selection rule, stated once: selected ⇔ kind ∈ {memory, session, index, skill,
 * rule, identity, persona}; `code` and `knowledge` are importable and unticked
 * (D-8); `noise` is bytes-only (binary, derived-index, app-state, empty). No text
 * row ever has `target: 'none'`. The secrets predicate only ever ADDS a tag.
 */
export function classifyPath(relativePath: string, content: string, profile?: SourceProfile): HeuristicHint {
  const hint = classifyText(relativePath, content, profile)
  return looksLikeSecrets(relativePath, content) ? withTags(hint, ['contains-secrets']) : hint
}

function classifyText(relativePath: string, content: string, profile?: SourceProfile): HeuristicHint {
  const p = posix(relativePath)
  const base = p.split('/').pop() ?? p
  const ext = extOf(base)
  const provenance = [...(isLegacyMemoryPath(p) ? ['legacy'] : []), ...(isThirdPartyDocPath(p) ? ['third-party'] : [])]

  if (isMemoryIndexFile(relativePath, content)) return withTags({ kind: 'index', target: 'vault.semantic', confidence: 0.95, reason: 'One-line memory index — imported as one note; its hooks become note summaries', reasonCode: 'memory-index', selectedByDefault: true }, provenance)
  if (/\.(sqlite|sqlite-wal|sqlite-shm|db|ldb)$/.test(base) || LOCKFILES.has(base) || base.endsWith('.lock')) return DERIVED_HINT
  if (BINARY_EXT.test(base)) return BINARY_HINT
  // Reached only for uploads extracted by hand or a scan rooted inside such a
  // directory (the walker maps the class as one row otherwise): honest label, visible.
  if (/(^|\/)(node_modules|\.git|\.hg|\.svn)\//.test(p)) return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.3, reason: 'Inside a dependency / VCS directory', reasonCode: 'unrecognised', selectedByDefault: false }
  // Obsidian state: visible, importable, unticked (D-8) — never hidden as app-state (the walker reads it like any text).
  if (isObsidianConfigPath(relativePath)) return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.85, reason: 'Obsidian configuration / state — importable, not selected', reasonCode: 'config', selectedByDefault: false }

  // Rules — anywhere under the root (R11.3): every repo's CLAUDE.md / AGENTS.md / .cursor/rules/*.mdc is a proposal.
  if (base === 'claude.md' || base === 'agents.md' || base === 'gemini.md' || base === 'global_rules.md' || base === '.cursorrules' || RULE_FILE_RE.test(p)) {
    return withTags({ kind: 'rule', target: 'workspace.agents', confidence: 0.88, reason: 'Project/agent rules file', reasonCode: 'rules-file', selectedByDefault: true }, provenance)
  }
  // Identity kinds stay gated on an assistant workspace path; outside it they are plain notes (fall through).
  if (isAssistantWorkspacePath(relativePath)) {
    if (base === 'soul.md' || base === 'soul.style.json') return { kind: 'identity', target: 'workspace.soul', confidence: 0.9, reason: 'Agent soul / persona', reasonCode: 'identity', selectedByDefault: true }
    if (base === 'identity.md') return { kind: 'identity', target: 'workspace.identity', confidence: 0.9, reason: 'Agent identity', reasonCode: 'identity', selectedByDefault: true }
    if (base === 'tools.md') return { kind: 'rule', target: 'workspace.tools', confidence: 0.85, reason: 'Tools policy', reasonCode: 'tools-policy', selectedByDefault: true }
  }
  if (base === 'skill.md' || p.endsWith('/skill.md') || isAssistantSkillPath(relativePath)) return withTags({ kind: 'skill', target: 'skill', confidence: 0.92, reason: 'Skill / procedure document', reasonCode: 'skill', selectedByDefault: true }, provenance)

  // Sessions — both classes selected (R11.3 bullet 2). `type: moc` is an index page, not a session.
  const grokSummary = /(^|\/)\.grok\/memory\/[^/]+\/sessions\//.test(p)
  const sessionByFm = /^---[\s\S]*?\btype:\s*(claude-session|grok-session|session)\b/i.test(content.slice(0, 600))
  if (isSessionDumpPath(relativePath) && !/^---[\s\S]*?\btype:\s*moc\b/i.test(content.slice(0, 600)) || grokSummary || sessionByFm) {
    return withTags({ kind: 'session', target: 'episodic', confidence: 0.85, reason: grokSummary ? 'Assistant session summary (structured memory)' : 'Session summary note', reasonCode: 'session-summary', selectedByDefault: true }, provenance)
  }
  if (/(^|\/)\.(claude|grok|agents)\/agents\/[^/]+\.md$/.test(p) || /(^|\/)\.github\/agents\/[^/]+\.agent\.md$/.test(p)) return { kind: 'persona', target: 'agent', confidence: 0.9, reason: 'Agent persona (frontmatter + prompt body)', reasonCode: 'persona', selectedByDefault: true }

  if (isDurableMemoryPath(relativePath)) return withTags({ kind: 'memory', target: 'vault.semantic', confidence: 0.8, reason: 'Long-lived memory note', reasonCode: 'memory-note', selectedByDefault: true }, provenance)
  if (p.includes('/semantic/') || /^---[\s\S]*tier:\s*semantic/i.test(content.slice(0, 400))) return withTags({ kind: 'memory', target: 'vault.semantic', confidence: 0.9, reason: 'Semantic vault note', reasonCode: 'memory-note', selectedByDefault: true }, provenance)
  if (p.includes('/procedural/') || /^---[\s\S]*tier:\s*procedural/i.test(content.slice(0, 400))) return withTags({ kind: 'memory', target: 'vault.procedural', confidence: 0.9, reason: 'Procedural vault note', reasonCode: 'memory-note', selectedByDefault: true }, provenance)

  // Notes — profile-independent, every note ticked (R11.3 'all candidates').
  if (NOTE_EXTS.has(ext) || base.endsWith('.md.bak') || (ext === 'bak' && /\.(md|markdown|txt)\.bak$/.test(base)) || base === 'robots.txt') {
    const procedural = /\b(how to|howto|runbook|checklist|procedure|lépés|útmutató)\b/i.test(content.slice(0, 500))
    const boiler = isBoilerplateName(base)
    return withTags({
      kind: 'memory', target: procedural ? 'vault.procedural' : 'vault.semantic', confidence: boiler ? 0.6 : 0.8,
      reason: boiler ? 'Boilerplate or third-party text — imported, labelled' : procedural ? 'How-to / runbook style content' : profile === 'obsidian' ? 'Obsidian note' : 'Markdown note',
      reasonCode: boiler ? 'not-durable' : 'memory-note', selectedByDefault: true,
    }, provenance)
  }
  if (CODE_EXTS.has(ext) || base === 'makefile' || base === 'dockerfile') return { kind: 'code', target: 'vault.semantic', confidence: 0.6, reason: 'Source code — importable, not selected', reasonCode: 'source-code', selectedByDefault: false }
  if (DATA_EXTS.has(ext) || base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.5, reason: 'Data or configuration text — importable, not selected', reasonCode: 'data-file', selectedByDefault: false }
  if (ext === 'json' || ext === 'jsonl') {
    if (isAssistantDotDirPath(relativePath)) return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.85, reason: 'Assistant configuration / state JSON — importable, not selected', reasonCode: 'config', selectedByDefault: false }
    return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.45, reason: 'Structured JSON — importable, not selected', reasonCode: 'unknown-json', selectedByDefault: false }
  }
  return { kind: 'knowledge', target: 'vault.semantic', confidence: 0.2, reason: 'Text of an unrecognised format — importable, not selected', reasonCode: 'unrecognised', selectedByDefault: false }
}
```

`AdapterHint` needs `tags?: string[]` — add it in `adapters/types.ts` here (Task 6 owns the rest of that file; coordinate by adding only that one line in this task, Task 6 rebases on it).

`instructions.ts`: the demotion branch keys on `c.kind === 'knowledge' || c.kind === 'code'`; add `if (hints.wantsMemory && c.kind === 'session') boost += 0.12`; the existing line `selectedByDefault = c.target !== 'none' && (c.selectedByDefault || boost >= 0.12)` already never unticks.

- [ ] **Step 5: Run** — `bun vitest run tests/modules/data-port/heuristics.test.ts tests/modules/data-port/instructions.test.ts` → PASS.

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 6: Adapters — transcripts everywhere, streaming JSONL render, selected defaults, no secrets wall (R11.3, P-5)

**Files:**
- Create: `src/modules/data-port/adapters/transcript-paths.ts`
- Modify: `src/modules/data-port/adapters/{types,registry,claude-code,cursor,codex,chat-export,gemini-cli,windsurf,generic}.ts`, `src/modules/data-port/source-frontmatter.ts` (only `readSourceNote`'s session-id fallback — Task 10 owns `splitFrontmatter`)
- Create: `tests/modules/data-port/adapters/transcript-paths.test.ts`
- Modify: `tests/modules/data-port/adapters/{registry,chat-export,codex,rule-providers}.test.ts`, `tests/modules/data-port/source-frontmatter.test.ts` (one case)

**Interfaces:**
- Produces: `CLAUDE_TRANSCRIPT_RE`, `CURSOR_TRANSCRIPT_RE`, `CODEX_ROLLOUT_RE`, `claudeTranscriptFacts(rel)`, `cursorTranscriptFacts(rel)`; `iterateJsonlLines(raw)`; `renderRoleLines(raw, { collect })` (returns `blockBytes: number[]` in both modes); `splitTurnBlocks(blockBytes, sectionBytes, maxBodyBytes)` (the one part-splitting rule); `ExpandOptions { withContent?, maxBodyBytes? }`; `ExpandedUnit.{tags, turns, contentOmitted}`; `ProviderAdapter.expand(rel, raw, sourcePath?, opts?)`; `render`/`escapeTurnText` exported.
- Deletes: the registry secrets wall (`SECRETS_HINT` import), every `selectedByDefault: false` on a transcript hint, the `app-state` answer for text under `antigravity/` and `.codeium/`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/adapters/transcript-paths.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { CLAUDE_TRANSCRIPT_RE, CURSOR_TRANSCRIPT_RE, claudeTranscriptFacts, cursorTranscriptFacts } from '@modules/data-port/adapters/transcript-paths'

const SID = '00000000-0000-4000-8000-00000000ab01'
describe('transcript paths', () => {
  it('matches top-level, sub-agent and workflow-nested Claude Code transcripts', () => {
    expect(CLAUDE_TRANSCRIPT_RE.test(`projects/alpha/${SID}.jsonl`)).toBe(true)
    expect(claudeTranscriptFacts(`projects/alpha/${SID}/subagents/agent-1a2b.jsonl`)).toEqual({ project: 'alpha', parentSession: SID, workflow: null, subagent: true })
    expect(claudeTranscriptFacts(`projects/alpha/${SID}/subagents/workflows/wf_9c80/agent-1a2b.jsonl`)).toEqual({ project: 'alpha', parentSession: SID, workflow: 'wf_9c80', subagent: true })
    for (const neg of ['projects/alpha/memory/n.md', `projects/alpha/${SID}/tool-results/t.txt`, 'foo/agent-transcripts.jsonl']) expect(CLAUDE_TRANSCRIPT_RE.test(neg)).toBe(false)
  })
  it('matches Cursor transcripts with or without a session directory and sub-agents', () => {
    expect(CURSOR_TRANSCRIPT_RE.test('agent-transcripts/x.jsonl')).toBe(true)
    expect(cursorTranscriptFacts('projects/bravo/agent-transcripts/abc/abc.jsonl')).toEqual({ project: 'bravo', parentSession: null, subagent: false })
    expect(cursorTranscriptFacts('projects/bravo/agent-transcripts/abc/subagents/x.jsonl')).toEqual({ project: 'bravo', parentSession: 'abc', subagent: true })
  })
})
```

```ts
// tests/modules/data-port/adapters/chat-export.test.ts — cases to flip/add (keep the fixtures)
  // :54 and :399 → selectedByDefault: true
  it('iterates lines without building the whole-file string', () => {
    const raw = Buffer.from(Array.from({ length: 20000 }, (_, i) => JSON.stringify({ type: 'user', message: { role: 'user', content: `alpha ${i}` }, timestamp: '2026-01-01T00:00:00Z' })).join('\r\n'))
    const spy = vi.spyOn(Buffer.prototype, 'toString')
    const r = renderRoleLines(raw)
    expect(spy.mock.calls.filter((c) => c.length === 0 || c[0] === 'utf-8').every(() => true)).toBe(true)
    expect(spy.mock.calls.some((c) => (spy.mock.instances.find(Boolean) as Buffer | undefined)?.length === raw.length)).toBe(false)
    spy.mockRestore()
    expect(r.turns).toBe(20000)
    expect(r.content.startsWith('**user:** alpha 0')).toBe(true)
  })
  it('counts and titles without collecting when asked', () => {
    const raw = Buffer.from([
      JSON.stringify({ type: 'summary', summary: 'Ship alpha' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Alpha shipping' }),
      JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'injected' } }),
      JSON.stringify({ type: 'system', content: 'system line' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'sk-alpha_bravo-charlie0123456789 is my key' } }),
      JSON.stringify({ type: 'permission-mode', mode: 'x' }),
    ].join('\n'))
    const full = renderRoleLines(raw)
    const counted = renderRoleLines(raw, { collect: false })
    expect(counted.content).toBe('')
    expect(counted.turns).toBe(full.turns)
    expect(counted.bytes).toBe(Buffer.byteLength(full.content))
    expect(counted.title).toBe('Alpha shipping')
    expect(full.content).toContain('**meta:** injected')
    expect(full.content).toContain('**system:** system line')
    expect(full.metaLines).toBe(1)
    expect(full.secrets).toBe(true)
  })
  it('splits an oversized session into ordered parts whose concatenation is the full render', () => {
    const raw = Buffer.from(Array.from({ length: 50 }, (_, i) => JSON.stringify({ type: 'user', message: { role: 'user', content: 'alpha '.repeat(20) + i } })).join('\n'))
    const units = chatExportAdapter.expand!('x/a.jsonl', raw, undefined, { maxBodyBytes: 800 })
    expect(units.length).toBeGreaterThan(1)
    expect(units.map((u) => u.unit)).toEqual(units.map((_, i) => `transcript#${i + 1}`))
    expect(units.map((u) => u.content).join('\n\n')).toBe(renderRoleLines(raw).content)
    expect(units[0].data).toMatchObject({ part: { n: 1, of: units.length } })
  })
  it('counts malformed lines once, so the count-only pass and the collect pass agree on the parts', () => {
    const turns = Array.from({ length: 30 }, (_, i) => JSON.stringify({ type: 'user', message: { role: 'user', content: 'alpha '.repeat(30) + i } }))
    const raw = Buffer.from([turns[0], '{not json', ...turns.slice(1, 15), 'also not json}', ...turns.slice(15)].join('\n'))
    const full = renderRoleLines(raw)
    const counted = renderRoleLines(raw, { collect: false })
    expect(full.unparsed).toHaveLength(2)
    expect(counted.bytes).toBe(Buffer.byteLength(full.content))
    const ids = (withContent: boolean) => chatExportAdapter.expand!('x/a.jsonl', raw, undefined, { withContent, maxBodyBytes: 900 }).map((u) => u.unit)
    expect(ids(false)).toEqual(ids(true))
    expect(ids(true).length).toBeGreaterThan(1)
  })
```

Registry: rewrite `describe('adapter registry secrets wall')` → `'a key inside an assistant file is a flag, not a refusal'`: for the same paths `hint.kind` is the adapter's own kind, `hint.tags` contains `'contains-secrets'`; `.codex/auth.json` → `{ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false }` with the tag; `vaultSession.hint.selectedByDefault === true`, `reasonCode 'session-summary'`; the bare transcript at depth 0 `selectedByDefault: true`; `classifyFile('.grok/docs/user-guide/13-memory.md', '# Cross-Session Memory', 'grok-cli')` → adapterId `grok-cli`, memory, selected, tags `['third-party']`; `classifyFile('.claude/projects/-alpha/memory.local-backup-2026-05-09/project_x.md', 'x', 'claude-code')` → memory, selected, tags `['legacy']`, adapterId `claude-code`.
Codex: every rollout `selectedByDefault: true`; `auth.json` → `knowledge`/`config`/tags `contains-secrets`; `config.toml`, `history.jsonl` → `knowledge`/`config`; invalid rollout unit → `{ kind: 'knowledge', reasonCode: 'invalid-json', selectedByDefault: false }` with `content` = raw text; new fixture lines `reasoning` / `function_call` / `function_call_output` / `event_msg` render as `**reasoning:**` / `**tool:**` / `**assistant:**`; a turn starting with `**assistant:**` is escaped.
Rule providers: Cursor transcript `selectedByDefault: true`; `GitHub/alpha/.cursor/rules/py.mdc` → cursor rule with scope under profile `obsidian`; `.gemini/antigravity/notes.md` → memory selected, `.pb` stays app-state; `.codeium/windsurf/state.json` → `knowledge`/`config`, `.codeium/windsurf/notes/x.txt` → memory selected.
Source-frontmatter: `2026-08-09_0928_topic_g019fe56c.md` with no frontmatter id → `sessionId: '019fe56c'`; frontmatter wins; `2026-04-09_1330_topic.md` → null.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/adapters tests/modules/data-port/source-frontmatter.test.ts` → FAIL.

- [ ] **Step 3: `transcript-paths.ts`**

```ts
// src/modules/data-port/adapters/transcript-paths.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// One place for the provider transcript path shapes, so chat-export's refusal
// list and the provider adapters' claims cannot drift.

/** Below the `.claude/` marker. Groups: slug, parent session, workflow id, file stem. */
export const CLAUDE_TRANSCRIPT_RE = /^projects\/([^/]+)\/(?:([^/]+)\/subagents\/(?:workflows\/([^/]+)\/)?)?([^/]+)\.jsonl$/
/** Segment-anchored. Groups: project (when present), transcript id, file stem. */
export const CURSOR_TRANSCRIPT_RE = /(?:^|\/)(?:projects\/([^/]+)\/)?agent-transcripts\/(?:([^/]+)\/)?(?:(subagents)\/)?([^/]+)\.jsonl$/
export const CODEX_ROLLOUT_RE = /rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-([^/]+)\.jsonl$/
/** Tool output saved beside a session — output, not memory (P-5). */
export const CLAUDE_TOOL_RESULT_RE = /^projects\/[^/]+\/[^/]+\/tool-results\/[^/]+\.txt$/

export function claudeTranscriptFacts(belowMarker: string): { project: string; parentSession: string | null; workflow: string | null; subagent: boolean } | null {
  const m = CLAUDE_TRANSCRIPT_RE.exec(belowMarker)
  if (!m) return null
  return { project: m[1]!, parentSession: m[2] ?? null, workflow: m[3] ?? null, subagent: Boolean(m[2]) }
}

export function cursorTranscriptFacts(rel: string): { project: string | null; parentSession: string | null; subagent: boolean } | null {
  const m = CURSOR_TRANSCRIPT_RE.exec(rel)
  if (!m) return null
  const subagent = Boolean(m[3])
  return { project: m[1] ?? null, parentSession: subagent ? (m[2] ?? null) : null, subagent }
}

/** Everything chat-export must refuse so the provider adapters keep their own transcripts. */
export const PROVIDER_TRANSCRIPTS: RegExp[] = [
  /(^|\/)\.claude\/projects\/.+\.jsonl$/,
  /(^|\/)agent-transcripts\/.+\.jsonl$/,
  /(^|\/)\.codex\/.*rollout-.*\.jsonl$/,
  /(^|\/)sessions\/.*rollout-.*\.jsonl$/,
]
```

- [ ] **Step 4: `chat-export.ts` — line iterator, count-only render, meta/system lines, secrets flag, parts**

```ts
// src/modules/data-port/adapters/chat-export.ts — additions / replacements
export interface ExpandOptions { withContent?: boolean; maxBodyBytes?: number }

/** One decoded line at a time: the whole-file string and the line array never exist. */
export function* iterateJsonlLines(raw: Buffer): Generator<string> {
  let from = 0
  while (from < raw.length) {
    let nl = raw.indexOf(0x0a, from)
    if (nl < 0) nl = raw.length
    let end = nl
    if (end > from && raw[end - 1] === 0x0d) end--
    if (end > from) yield raw.toString('utf-8', from, end)
    from = nl + 1
  }
}

export interface RenderedRoleLines {
  content: string
  turns: number
  parsed: number
  unparsed: string[]
  metaLines: number
  sessionId: string | null
  messageId: string | null
  sessionDate: string | null
  title: string | null
  bytes: number
  preview: string
  cwd: string | null
  gitBranch: string | null
  /** The secrets predicate hit at least one line (R11.4 tag, never a skip). */
  secrets: boolean
}

const RENDERED_ROLE_TYPES = new Set(['user', 'assistant', 'human', 'system'])
const META_ONLY_TYPES = new Set(['mode', 'permission-mode', 'last-prompt', 'file-history-delta', 'task_reminder', 'attachment', 'hook', 'progress', 'queue-operation'])

export function renderRoleLines(raw: Buffer, opts: { collect?: boolean } = {}): RenderedRoleLines {
  const collect = opts.collect !== false
  const parts: string[] = []
  const unparsed: string[] = []
  let bytes = 0, turns = 0, parsed = 0, metaLines = 0
  let sessionId: string | null = null, messageId: string | null = null, sessionDate: string | null = null
  let aiTitle: string | null = null, summary: string | null = null, firstUser: string | null = null
  let cwd: string | null = null, gitBranch: string | null = null, secrets = false, preview = ''
  const push = (block: string) => {
    if (turns > 0) bytes += 2 // the '\n\n' separator render() puts between turns
    bytes += Buffer.byteLength(block)
    if (collect) parts.push(block)
    if (!preview) preview = previewWith(block, '')
    turns++
  }
  for (const line of iterateJsonlLines(raw)) {
    if (!line.trim()) continue
    let entry: Record<string, any>
    // An unparsed line is counted ONCE, through the rendered `unparsedSection` below — never here as well.
    try { entry = JSON.parse(line) } catch { unparsed.push(line); continue }
    parsed++
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    if (sessionId === null) for (const key of ['sessionId', 'session_id']) { const v = entry[key]; if (typeof v === 'string' && v.trim()) { sessionId = v.trim(); break } }
    if (messageId === null && typeof entry.id === 'string' && entry.id.trim()) messageId = entry.id.trim()
    if (sessionDate === null) for (const key of ['timestamp', 'created_at']) { const s = iso(entry[key]); if (s) { sessionDate = s; break } }
    if (cwd === null && typeof entry.cwd === 'string') cwd = entry.cwd
    if (gitBranch === null && typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch
    const type = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : null
    if (type === 'ai-title' && typeof entry.aiTitle === 'string') { aiTitle = entry.aiTitle.trim(); continue }
    if (type === 'summary' && typeof entry.summary === 'string') { summary = summary ?? entry.summary.trim(); continue }
    if (type !== null && META_ONLY_TYPES.has(type)) { metaLines++; continue }
    if (type !== null && !RENDERED_ROLE_TYPES.has(type)) { metaLines++; continue }
    let role = roleOfLine(entry)
    if (type === 'system') role = 'system'
    if (!role) continue
    if (role === 'user' && entry.isMeta === true) role = 'meta'
    const body = typeof entry.message === 'string' ? entry.message : (entry.message?.content ?? entry.message?.parts ?? entry.content ?? entry.parts ?? entry.text)
    const text = textOf(body)
    if (!text.trim()) continue
    if (role === 'user' && firstUser === null) firstUser = text.replace(/<user_query>|<\/user_query>/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? null
    if (!secrets && looksLikeSecrets('transcript.jsonl', text)) secrets = true
    push(renderTurn({ role, text }))
  }
  const section = unparsedSection(unparsed)
  if (section) bytes += (turns > 0 ? 2 : 0) + Buffer.byteLength(section)
  return {
    content: collect ? [parts.join('\n\n'), section].filter((p) => p.trim()).join('\n\n') : '',
    turns, parsed, unparsed, metaLines, sessionId, messageId, sessionDate,
    title: aiTitle ?? summary ?? firstUser, bytes, preview, cwd, gitBranch, secrets,
  }
}
```

`renderTurn(turn)` is `render([turn])` for one turn; `render` and `escapeTurnText` become exports (Codex reuses them). `transcriptUnit(rel, rendered, reason, opts)` sets `title: rendered.title ?? name`, `preview: rendered.preview`, `bytes: rendered.bytes`, `content: rendered.content`, `turns`, `contentOmitted: !collect`, `tags: rendered.secrets ? ['contains-secrets'] : []`, `data: { turns, metaLines, unparsed: rendered.unparsed.length, cwd, gitBranch }`. Part splitting: ONE shared function decides the cut points for both modes — `splitTurnBlocks(blockBytes: number[], sectionBytes: number, maxBodyBytes): Array<{ from: number; to: number }>` walks the per-turn byte sizes (plus the 2-byte separators and the trailing unparsed section, which belongs to the last part) and returns the turn ranges of each part. The count-only render records `blockBytes` (numbers only, no text); the collect render records the same numbers and the blocks. When `rendered.bytes` exceeds `opts.maxBodyBytes ?? MAX_EPISODIC_BODY_BYTES`, `expand` calls `splitTurnBlocks` on either list and returns `N` units `transcript#n` with `data.part = { n, of }` — so `expand(…, { withContent: false })` and `expand(…, { withContent: true })` always agree on `N` and on every unit id (the runner's `missing-unit` skip can never come from a counting difference). `jsonlTranscriptUnit(rel, raw, reason, opts)` threads `opts`. `SESSION_HINT.selectedByDefault = true`; `UNKNOWN_HINT` → `{ kind: 'knowledge', target: 'vault.semantic', confidence: 0.8, reasonCode: 'unknown-json', selectedByDefault: false }`; `INVALID_HINT` → `{ kind: 'knowledge', target: 'vault.semantic', confidence: 0.9, reasonCode: 'invalid-json', selectedByDefault: false }` and its unit carries `content: raw.toString('utf-8')` (`textUnit`, not `noiseUnit`). `EMPTY_HINT` stays noise. `PROVIDER_TRANSCRIPTS` is imported from `transcript-paths.ts`.

- [ ] **Step 5: Provider adapters**

`claude-code.ts`: `TRANSCRIPT` → `CLAUDE_TRANSCRIPT_RE`; `TRANSCRIPT_HINT.selectedByDefault = true`; new rule before `AUTO_MEMORY`: `CLAUDE_TOOL_RESULT_RE` → `{ kind: 'session', target: 'episodic', confidence: 0.6, reason: 'Tool output saved beside a Claude Code session', reasonCode: 'session-artifact', selectedByDefault: false }`; `LEGACY_MEMORY = /^(projects\/[^/]+\/)?(memory\.local-backup[^/]*|memory\.old)\/[^/]+\.(md|bak)$/` → `autoMemoryHint(cp)` plus `tags: ['legacy']`; `expand(rel, raw, _sourcePath, opts)` → `jsonlTranscriptUnit(rel, raw, TRANSCRIPT_REASON, opts)` enriched with `facts = claudeTranscriptFacts(belowMarker(posix(rel)))`: `tags: [...unit.tags, 'claude-project:' + facts.project, ...(facts.subagent ? ['subagent', 'parent-session:' + facts.parentSession] : []), ...(facts.workflow ? ['workflow:' + facts.workflow] : [])]`, `data: { ...unit.data, project, parentSession, workflow, subagent }`.
`cursor.ts`: `TRANSCRIPT` → `CURSOR_TRANSCRIPT_RE`; hint `selectedByDefault: true`; `expand` adds `cursor-project:<project>` and `subagent` / `parent-session:` tags from `cursorTranscriptFacts`.
`codex.ts`: `ROLLOUT_HINT.selectedByDefault = true`; `renderRollout` rewritten on `iterateJsonlLines` + the exported `render`/`escapeTurnText`: `response_item`/`message` → role turn; `reasoning` → role `reasoning` (summary/content text parts, else fenced JSON); `function_call`, `function_call_output`, `custom_tool_call*`, `local_shell_call*`, `web_search_call` → role `tool` with fenced JSON; `event_msg` `user_message`/`agent_message` → user/assistant with `payload.message`; anything else typed → `metaLines++`; `auth.json` → `{ kind: 'knowledge', target: 'vault.semantic', confidence: 0.95, reason: 'Codex OAuth credentials — stored verbatim, hidden from recall', reasonCode: 'config', selectedByDefault: false, tags: ['contains-secrets'] }`; `config.toml`, `version.json`, `history.jsonl` → `knowledge`/`config` unselected; `.sqlite-wal/-shm/.lock` stay `derived-index`; the invalid rollout unit → `knowledge`/`invalid-json` with `content: raw.toString('utf-8')`; `expand` honours `opts.withContent`.
`gemini-cli.ts`: only `/\.(pb|lock|db|sqlite)$/` under `/antigravity/` stays `app-state`; text falls to `classifyPath(rel, head, 'gemini-cli')`.
`windsurf.ts`: every non-rule path → `classifyPath(rel, head, 'windsurf')`.
`generic.ts`: doc comment rewritten (memory/knowledge for every text file, noise only for bytes-only formats).
`registry.ts`: delete the wall and the `SECRETS_HINT` import; after the adapter chain: `if (looksLikeSecrets(rel, head)) hint = { ...hint, tags: [...new Set([...(hint.tags ?? []), 'contains-secrets'])] }`.
`adapters/types.ts`: `ExpandedUnit.{tags?, turns?, contentOmitted?}`; `expand?(rel, raw, sourcePath?, opts?: ExpandOptions)`; `SourceNote.body` comment → "Everything after the leading frontmatter, byte for byte".
`source-frontmatter.ts` `readSourceNote`: session-id fallback `/_g?([0-9a-f]{8})\.md$/i` on the basename when frontmatter declares none.

- [ ] **Step 6: Run** — `bun vitest run tests/modules/data-port/adapters tests/modules/data-port/source-frontmatter.test.ts tests/modules/data-port/scan-rooted.test.ts` → PASS (scan-rooted's `selectedByDefault: true` for sessions/transcripts is asserted there; its `await` changes come with Task 7).

- [ ] **Step 7: Review** — `git status --short`.

---
## Phase 2 — Streams and stores

### Task 7: `scanDirectory` as an event stream — no size caps, tags, warnings, directory rows, stats (R11.1, R11.2, R11.7)

**Files:**
- Modify: `src/modules/data-port/scanners/scan-path.ts` (everything from `interface SkillAsset` down)
- Modify: `tests/modules/data-port/scan-units.test.ts`, `tests/modules/data-port/scan-rooted.test.ts`
- Create: `tests/modules/data-port/scan-stream.test.ts`

**Interfaces:**
- Produces: `scanDirectoryEvents(opts): Generator<ScanEvent>` with `ScanEvent = { type: 'dir'; row: ScanDirRow } | { type: 'candidate'; candidate: ScanCandidate } | { type: 'candidate-patch'; id; addPath } | { type: 'dir-alias'; realRel; aliasRel } | { type: 'progress'; dirsVisited; filesSeen; candidates; bytes; currentDir } | { type: 'done'; result: Omit<ScanResult, 'candidates' | 'dirs'> }`; `scanDirectory(opts): Promise<ScanResult>` (async collect, applies patches and dir aliases to its array, yields to the event loop on every `progress`); `addPathTo(row, path)`; `opts.onProgress?` receives the walker's real counters; no `maxFiles`.
- Row rules: every walker `file` entry becomes exactly one row (or one row per unit); `directory-skipped` → one `noise` row `reasonCode: 'directory-skipped:<class>'` with `directory: {class, files, dirs, unreadable}`, `bytes: 0`; `directory-unreadable` / `symlink-broken` → `noise`/`unreadable`; `symlink-unfollowed` → `symlink-upload`; binary/derived/app-state **names** are never read (row from stat) — `.obsidian/**` is ordinary text and classifies to `knowledge`/`config` (Task 5), never `app-state`; size above the threshold → `warnings: ['large-file']`, streamed sha256 with a progress event every 16 chunks, head-only classification, `warnings: ['secrets-scan-head-only']` for non-container text; containers are read whole; `tags` copied from the hint onto the row; `contains-secrets` per unit for containers; skill assets flagged, never dropped for secrets.
- Streaming finalize (P-18) — nothing runs over a collected row list:
  - **Duplicates inline.** `firstByIdentity: Map<identity, { id, relativePath, realKey }>` (identity = `sha256`, or for a skill the digest of `sha256` + every bundled asset's `relPath`/`sha256`). A complete row whose identity is already listed at a *different* real file is emitted at once as `noise`/`duplicate-content` (counted in `filesSkipped`) and the first row gains the path through `candidate-patch`; units of one container share the file and its hash and are never duplicates.
  - **Skill packages buffered per package.** A `file` entry with `skillRoot` is either the package document (`skill.md` in the root itself) or an asset. Assets are hashed, sniffed and flagged into `packages.get(root).assets` — never a row of their own. The document row is built like any file but held in `bufferedDocs` (by id) until the walker yields `skill-package-done` for that root; then `assets` (sorted), `notBundled`, the `(+N bundled files)` reason suffix and the `contains-secrets` tag (any flagged asset) are attached, the identity is computed and the row is emitted (or emitted as a duplicate, with every asset as an `orphan-asset` row saying `Duplicate content of …`). A document that became no skill (empty, binary, classified otherwise) is emitted at once and remembered as `docOutcome`; its assets become `orphan-asset` rows at package-done, naming that reason. Nested packages: the nearest root owns a file (A7.8).
  - **Alias paths as events.** `file-alias` → `candidate-patch { id, addPath }` for every row of that real file (a buffered document is patched in place). Directory aliases are collected as `(firstRel, aliasRel)` pairs from the walker's `directory-alias` entries and emitted as `dir-alias` events after the walk and before `done`; the consumer adds `aliasRel + rel.slice(firstRel.length)` to every row at or under `firstRel`.
  - The generator therefore holds ids, digests, paths and at most one package's asset descriptors — never rows.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/scan-stream.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanDirectory, scanDirectoryEvents } from '@modules/data-port/scanners/scan-path'
import { DIRECTORY_CLASSES } from '@modules/data-port/types'

let root: string
const put = (rel: string, body: string | Buffer = 'x') => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body) }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dp-stream-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('scanDirectory (R11)', () => {
  it('imports a 5 MiB note and a flagged .env file, each as a visible importable row', async () => {
    put('ai-memory/huge.md', '---\ntype: reference\n---\n' + 'alpha '.repeat(1024 * 1024))
    put('.claude/.env', 'TOKEN=alphabravocharlie0001\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const huge = r.candidates.find((c) => c.relativePath === 'ai-memory/huge.md')!
    expect(huge).toMatchObject({ kind: 'memory', selectedByDefault: true, warnings: ['large-file'] })
    expect(huge.bytes).toBeGreaterThan(4 * 1024 * 1024)
    expect(huge.sha256).toHaveLength(64)
    const env = r.candidates.find((c) => c.relativePath === '.claude/.env')!
    expect(env).toMatchObject({ kind: 'knowledge', reasonCode: 'data-file', selectedByDefault: false, tags: ['contains-secrets'] })
    expect(env.target).not.toBe('none')
    expect(r.stats.largeFiles).toBe(1)
    expect(r.warnings.find((w) => w.code === 'large-files')?.params).toMatchObject({ count: 1 })
    expect(r.stats.filesSkipped).toBe(r.candidates.filter((c) => c.kind === 'noise').length)
  })
  it('lists a class directory as one counted row and nothing below it', async () => {
    put('alpha/node_modules/pkg/index.js'); put('alpha/node_modules/pkg/README.md'); put('alpha/node_modules/x.js'); put('alpha/notes.md', '# n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const row = r.candidates.find((c) => c.reasonCode === 'directory-skipped:node_modules')!
    expect(row).toMatchObject({ kind: 'noise', target: 'none', selectedByDefault: false, bytes: 0, directory: { class: 'node_modules', files: 3, dirs: 1, unreadable: 0 } })
    expect(row.relativePath).toBe('alpha/node_modules')
    expect(r.candidates.some((c) => c.relativePath.startsWith('alpha/node_modules/'))).toBe(false)
    expect(r.stats.dirsSkipped.node_modules).toBe(1)
    expect(r.stats.filesInSkippedDirs).toBe(3)
    expect(Object.keys(r.stats.dirsSkipped).sort()).toEqual([...DIRECTORY_CLASSES].sort())
    expect(r.dirs.find((d) => d.path === 'alpha/node_modules')).toMatchObject({ skippedClass: 'node_modules', fileCount: 3, parent: 'alpha' })
    expect(r.warnings.find((w) => w.code === 'directories-skipped')?.params).toMatchObject({ count: 1 })
  })
  it('never reads a binary-named file', async () => {
    put('notes/diagram.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const read = vi.spyOn(fs, 'readFileSync'); const open = vi.spyOn(fs, 'openSync')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const png = r.candidates.find((c) => c.relativePath === 'notes/diagram.png')!
    expect(png).toMatchObject({ kind: 'noise', reasonCode: 'binary', bytes: 4 })
    expect(png.sha256).toBeUndefined()
    expect(read.mock.calls.some((c) => String(c[0]).endsWith('diagram.png'))).toBe(false)
    expect(open.mock.calls.some((c) => String(c[0]).endsWith('diagram.png'))).toBe(false)
    read.mockRestore(); open.mockRestore()
  })
  it('lists .DS_Store as an app-state row without reading it', async () => {
    put('notes/.DS_Store', Buffer.alloc(16))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => c.relativePath === 'notes/.DS_Store')).toMatchObject({ kind: 'noise', reasonCode: 'app-state', bytes: 16 })
  })
  it('lists project transcripts of a home scan, selected, with sub-agent tags', async () => {
    const SID = '00000000-0000-4000-8000-00000000ab01'
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'ship alpha' }, sessionId: SID, timestamp: '2026-01-02T10:00:00Z' })
    put(`.claude/projects/slug/${SID}.jsonl`, line + '\n'); put(`.claude/projects/slug/${SID}/subagents/agent-1.jsonl`, line + '\n')
    put(`.claude/projects/slug/${SID}/tool-results/t1.txt`, 'output')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    const top = r.candidates.find((c) => c.relativePath === `.claude/projects/slug/${SID}.jsonl`)!
    expect(top).toMatchObject({ kind: 'session', selectedByDefault: true, adapterId: 'claude-code', turns: 1 })
    expect(top.tags).toContain('claude-project:slug')
    const sub = r.candidates.find((c) => c.relativePath.endsWith('subagents/agent-1.jsonl'))!
    expect(sub.tags).toEqual(expect.arrayContaining(['subagent', `parent-session:${SID}`]))
    expect(r.candidates.find((c) => c.relativePath.endsWith('tool-results/t1.txt'))).toMatchObject({ kind: 'session', reasonCode: 'session-artifact', selectedByDefault: false })
    expect(r.warnings.some((w) => /transcript/i.test(w.message))).toBe(false)
    expect(top.content).toBeUndefined()
  })
  it('bundles an oversized and a flagged skill asset instead of dropping them', async () => {
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    put('.claude/skills/deploy/references/dump.md', 'a'.repeat(5 * 1024 * 1024))
    put('.claude/skills/deploy/.env', 'OPENAI_API_KEY=sk-alpha_bravo-charlie0123456789\n')
    put('.claude/skills/deploy/scripts/fetch.py', 'password = keychain_lookup("alpha-db")\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill.notBundled).toBeUndefined()
    expect(skill.assets!.map((a) => a.relPath)).toEqual(['.env', 'references/dump.md', 'scripts/fetch.py'])
    expect(skill.assets!.find((a) => a.relPath === '.env')!.containsSecrets).toBe(true)
    expect(skill.assets!.find((a) => a.relPath === 'scripts/fetch.py')!.containsSecrets).toBeUndefined()
    expect(skill.tags).toContain('contains-secrets')
    expect(skill.reason).toContain('(+3 bundled files)')
    expect(r.candidates.some((c) => c.relativePath.endsWith('references/dump.md'))).toBe(false)
  })
  it('bundles assets whatever order the listing gives them (assets created before the document)', async () => {
    put('.claude/skills/deploy/.env', 'TOKEN=alphabravocharlie0001\n'); put('.claude/skills/deploy/README.md', '# readme')
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skill = r.candidates.find((c) => c.kind === 'skill')!
    expect(skill.assets!.map((a) => a.relPath)).toEqual(['.env', 'README.md'])
    expect(r.candidates.filter((c) => c.relativePath.startsWith('.claude/skills/deploy/'))).toHaveLength(1)
  })
  it('strands the package of a duplicate SKILL.md as orphan rows that say why', async () => {
    put('.claude/skills/alpha/SKILL.md', '# same\n'); put('.claude/skills/alpha/run.sh', 'echo a\n')
    put('.claude/skills/bravo/SKILL.md', '# same\n'); put('.claude/skills/bravo/run.sh', 'echo a\n')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'claude-code' })
    const skills = r.candidates.filter((c) => c.kind === 'skill')
    expect(skills).toHaveLength(1)
    expect([...skills[0]!.paths!].sort()).toEqual(['.claude/skills/alpha/SKILL.md', '.claude/skills/bravo/SKILL.md'])
    const dup = r.candidates.find((c) => c.reasonCode === 'duplicate-content')!
    expect(dup.relativePath).not.toBe(skills[0]!.relativePath)
    const orphan = r.candidates.find((c) => c.reasonCode === 'orphan-asset')!
    expect(orphan.relativePath).toBe(`${dup.relativePath.replace(/SKILL\.md$/, '')}run.sh`)
    expect(orphan.reason).toMatch(/Duplicate content of/)
    expect(r.stats.filesSkipped).toBe(2)
  })
  it('emits duplicates and alias paths as events, never by mutating a row it already yielded', async () => {
    put('a/x.md', '# same body\n'); put('b/x.md', '# same body\n'); put('real/n.md', '# n')
    symlinkSync(join(root, 'real'), join(root, 'link'))
    // Listing order is the filesystem's: whichever of a/b (or real/link) is reached first is the kept row; assert order-agnostically.
    const events = [...scanDirectoryEvents({ rootPath: root, sourceProfile: 'auto' })]
    const xs = events.filter((e) => e.type === 'candidate' && /^(a|b)\/x\.md$/.test(e.candidate.relativePath)) as any[]
    const kept = xs.find((e) => e.candidate.kind !== 'noise')!, dup = xs.find((e) => e.candidate.kind === 'noise')!
    expect(dup.candidate).toMatchObject({ reasonCode: 'duplicate-content' })
    expect(events.find((e) => e.type === 'candidate-patch')).toMatchObject({ id: kept.candidate.id, addPath: dup.candidate.relativePath })
    expect(kept.candidate.paths).toBeUndefined() // the yielded object was not touched afterwards
    const aliasAt = events.findIndex((e) => e.type === 'dir-alias'); const doneAt = events.findIndex((e) => e.type === 'done')
    const alias = events[aliasAt] as any
    expect([alias.realRel, alias.aliasRel].sort()).toEqual(['link', 'real']); expect(aliasAt).toBeLessThan(doneAt)
    expect(events.filter((e) => e.type === 'candidate' && e.candidate.relativePath.endsWith('n.md'))).toHaveLength(1)
    // The collector applies both.
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.find((c) => /x\.md$/.test(c.relativePath) && c.kind !== 'noise')!.paths!.sort()).toEqual(['a/x.md', 'b/x.md'])
    expect(r.candidates.find((c) => c.relativePath.endsWith('n.md'))!.paths!.sort()).toEqual(['link/n.md', 'real/n.md'])
  })
  it('flags only the unit that holds a key inside a container', async () => {
    put('chat/conversations.json', JSON.stringify([
      { uuid: 'u1', name: 'alpha', chat_messages: [{ sender: 'human', text: 'hi' }] },
      { uuid: 'u2', name: 'bravo', chat_messages: [{ sender: 'human', text: 'API_KEY=alphabravo0123456789' }] },
    ]))
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'chat-export' })
    const units = r.candidates.filter((c) => c.relativePath === 'chat/conversations.json')
    expect(units.map((u) => u.tags?.includes('contains-secrets') ?? false)).toEqual([false, true])
  })
  it('keeps the units of one container contiguous in emission order', async () => {
    put('chat/conversations.json', JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ uuid: `u${i}`, name: `alpha ${i}`, chat_messages: [{ sender: 'human', text: 'x' }] }))))
    put('notes/a.md', '# a'); put('notes/z.md', '# z')
    const seqs: number[] = []
    let i = 0
    for (const ev of scanDirectoryEvents({ rootPath: root, sourceProfile: 'chat-export' })) {
      if (ev.type === 'candidate') { if (ev.candidate.relativePath === 'chat/conversations.json') seqs.push(i); i++ }
    }
    expect(seqs).toEqual(Array.from({ length: 5 }, (_, k) => seqs[0]! + k))
  })
  it('yields to the event loop and reports progress on a large tree', async () => {
    for (let i = 0; i < 1200; i++) put(`notes/n${i}.md`, `# ${i}`)
    const progress: number[] = []; const dirs: number[] = []
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto', onProgress: (p) => { progress.push(p.files); dirs.push(p.dirs) } })
    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress).toEqual([...progress].sort((a, b) => a - b))
    expect(progress.at(-1)).toBeGreaterThanOrEqual(1000); expect(Math.max(...dirs)).toBeGreaterThanOrEqual(1) // real walker counters, never zeros
    expect(r.candidates).toHaveLength(1200)
    expect(r.stats.scanMs).toBeGreaterThanOrEqual(0)
    expect(r.stats.dirsVisited).toBe(2)
  })
  it('maps a home-shaped root completely and warns about the classes, not the size', async () => {
    for (let i = 0; i < 80; i++) put(`GitHub/alpha/pkg-${i}/note.md`, `# ${i}`)
    put('GitHub/alpha/.git/HEAD', 'ref: x'); put('GitHub/alpha/node_modules/m/index.js'); put('Library/Caches/x', 'c'); put('Library/Application Support/alpha/state.json', '{}')
    put('.grok/relocations/r1.json', '{}'); put('Documents/Vault/.obsidian/app.json', '{}'); put('Documents/Vault/projects/alpha.md', '# alpha')
    const r = await scanDirectory({ rootPath: root, sourceProfile: 'auto' })
    expect(r.candidates.filter((c) => /GitHub\/alpha\/pkg-\d+\/note\.md/.test(c.relativePath))).toHaveLength(80)
    expect(r.candidates.filter((c) => c.reasonCode.startsWith('directory-skipped:')).map((c) => c.directory!.class).sort()).toEqual(['node_modules', 'os-cache', 'vcs'])
    expect(r.candidates.find((c) => c.relativePath === '.grok/relocations/r1.json')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(r.candidates.find((c) => c.relativePath === 'Documents/Vault/projects/alpha.md')).toMatchObject({ kind: 'memory', selectedByDefault: true })
    // Obsidian state is text: visible, importable, unticked (D-8) — never hidden as app-state.
    expect(r.candidates.find((c) => c.relativePath === 'Documents/Vault/.obsidian/app.json')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
    expect(r.candidates.find((c) => c.relativePath === 'Documents/Vault/.obsidian/app.json')!.target).not.toBe('none')
    expect(r.warnings.map((w) => w.code)).toContain('directories-skipped')
    expect(r.warnings.map((w) => w.code)).not.toContain('home-root-mapped')
    expect(r.warnings.every((w) => typeof w.message === 'string' && !/smaller folder|scan cap/i.test(w.message))).toBe(true)
  })
})
```

`tests/modules/data-port/scan-units.test.ts`: every `scanDirectory(...)` → `await scanDirectory(...)`; delete the cap warning case; the too-large cases become large-file cases (`warnings: ['large-file']`, still importable, both `paths` kept); the orphan-asset case uses a byte-identical duplicate `SKILL.md` (`duplicate-content`) as the reason the document became no skill; 'unrecognised JSON under an assistant dot-dir' → `{ kind: 'knowledge', reasonCode: 'config', target: 'vault.semantic', selectedByDefault: false }`; the transcript-warning cases are deleted; the symlinked-project case asserts the transcript is listed with both `paths`; 'says how many rows were skipped' → `r.warnings.find((w) => w.code === 'rows-passed-over')?.params.count === r.stats.filesSkipped`; a `.grok/docs/user-guide/x.md` row carries `tags: ['third-party']` and a `memory.local-backup-1/x.md` row `tags: ['legacy']`. `scan-rooted.test.ts`: `await` only, plus `expect(rows.filter((c) => c.target === 'none' && c.kind !== 'noise')).toEqual([])` per root.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/scan-stream.test.ts tests/modules/data-port/scan-units.test.ts tests/modules/data-port/scan-rooted.test.ts` → FAIL.

- [ ] **Step 3: Write the event generator**

```ts
// src/modules/data-port/scanners/scan-path.ts — replaces scanDirectory
export type ScanEvent =
  | { type: 'dir'; row: ScanDirRow }
  | { type: 'candidate'; candidate: ScanCandidate }
  /** A row already yielded gains an alias path (file alias or content duplicate). Applied by id — the row may be flushed already. */
  | { type: 'candidate-patch'; id: string; addPath: string }
  /** Every row at or under `realRel` is also reachable at `aliasRel` (a symlinked directory). Emitted after the walk, before `done`. */
  | { type: 'dir-alias'; realRel: string; aliasRel: string }
  | { type: 'progress'; dirsVisited: number; filesSeen: number; candidates: number; bytes: number; currentDir: string }
  | { type: 'done'; result: Omit<ScanResult, 'candidates' | 'dirs'> }

const CONTAINER_EXT = /\.(json|jsonl|sqlite)$/i
/** Chunks between two yields of the streamed hash: 16 × STREAM_CHUNK_BYTES = 16 MiB of reading before the loop gets a turn. */
const HASH_CHUNKS_PER_TICK = 16

/** `paths` = every path the content was found at; starts with the row's own path. Shared with the collector and the tests. */
export function addPathTo(row: ScanCandidate, path: string): void {
  const paths = row.paths ?? [row.relativePath]
  if (!paths.includes(path)) paths.push(path)
  row.paths = paths
}

/** sha256 of a file read through an fd in STREAM_CHUNK_BYTES chunks, yielding every HASH_CHUNKS_PER_TICK chunks; the head is returned for classification. */
function* hashStreamed(path: string, headBytes: number): Generator<'tick', { sha256: string; head: Buffer }> {
  const fd = openSync(path, 'r')
  try {
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(STREAM_CHUNK_BYTES)
    let head: Buffer = Buffer.alloc(0)
    let n: number, chunks = 0
    while ((n = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      const slice = chunk.subarray(0, n)
      hash.update(slice)
      if (head.length < headBytes) head = Buffer.concat([head, slice.subarray(0, headBytes - head.length)])
      if (++chunks % HASH_CHUNKS_PER_TICK === 0) yield 'tick'
    }
    return { sha256: hash.digest('hex'), head }
  } finally {
    closeSync(fd)
  }
}

/** A skill is its SKILL.md AND the files bundled with it (A11.4): two packages whose documents match but whose scripts differ are two packages. */
function skillIdentity(docSha: string, assets: readonly SkillAsset[]): string {
  if (!assets.length) return docSha
  const digest = createHash('sha256').update(docSha)
  for (const a of assets) digest.update(`\n${a.relPath}\n${a.sha256}`)
  return digest.digest('hex')
}

interface PackageBuffer {
  /** The SKILL.md row, held until `skill-package-done`; null when the document became no skill. */
  doc: ScanCandidate | null
  docRealKey: string
  /** Why the document is not a skill row (empty, binary, classified otherwise) — the orphan rows say it. */
  docOutcome: string | null
  assets: SkillAsset[]
  notBundled: Array<{ relPath: string; bytes: number; reason: string }>
}

export function* scanDirectoryEvents(opts: {
  rootPath: string
  sourceProfile: SourceProfile
  followSymlinks?: boolean
  /** The header row's id when the service drives the scan in the background (Task 9); fresh otherwise. */
  scanId?: string
}): Generator<ScanEvent> {
  const started = performance.now()
  const root = resolve(opts.rootPath)
  if (!existsSync(root)) throw new Error(`Path does not exist: ${root}`)
  if (!statSync(root).isDirectory()) throw new Error(`Path is not a directory: ${root}`)
  const followSymlinks = opts.followSymlinks !== false
  const markerPrefix = rootMarkerPrefix(root)
  const marked = (rel: string): string => (markerPrefix ? `${markerPrefix}/${rel}` : rel)
  const marks = (rel: string): Partial<ScanCandidate> => (markerPrefix ? { classifiedPath: marked(rel) } : {})
  const relOf = (full: string): string => { const r = toPosix(relative(root, full)); return r === '' ? '.' : r }

  // Profile: decided from the root listing + marker files up front (cheap), per-row `adapterId` is the provenance (R11.6).
  const topNames = readdirSync(root).map(String)
  const probe = topNames.map((n) => marked(n))
  if (existsSync(join(root, '.obsidian')) || basename(root).toLowerCase().includes('obsidian')) probe.push('.obsidian/app.json')
  const detected = opts.sourceProfile === 'auto' ? detectProfile(probe) : opts.sourceProfile

  // ── identity, never rows (P-18) ─────────────────────────────────────────
  const firstByIdentity = new Map<string, { id: string; relativePath: string; realKey: string }>()
  const rowIdsByRealFile = new Map<string, string[]>()
  const bufferedDocs = new Map<string, ScanCandidate>()
  const packages = new Map<string, PackageBuffer>()
  const dirAliasPairs: Array<[string, string]> = []
  const packageOf = (rootDir: string): PackageBuffer => {
    let p = packages.get(rootDir)
    if (!p) { p = { doc: null, docRealKey: '', docOutcome: null, assets: [], notBundled: [] }; packages.set(rootDir, p) }
    return p
  }
  const stats = { filesSkipped: 0, totalBytes: 0, largeFiles: 0 }
  let emittedCount = 0
  let counters = { dirsVisited: 0, filesSeen: 0 }
  let currentDir = root
  const progress = (): ScanEvent => ({ type: 'progress', dirsVisited: counters.dirsVisited, filesSeen: counters.filesSeen, candidates: emittedCount, bytes: stats.totalBytes, currentDir: relOf(currentDir) })
  const emit = (row: ScanCandidate, realKey?: string): ScanEvent => {
    emittedCount++
    if (realKey) rowIdsByRealFile.set(realKey, [...(rowIdsByRealFile.get(realKey) ?? []), row.id])
    return { type: 'candidate', candidate: row }
  }
  const skipRow = (rel: string, bytes: number, reason: string, code: string, title?: string, extra: Partial<ScanCandidate> = {}, realKey?: string): ScanEvent => {
    stats.filesSkipped++
    return emit(noiseRow(rel, bytes, reason, code, title, extra), realKey)
  }
  /** An alias path for a row: patched in place while the row is still buffered, an event once it has been yielded. */
  function* addPath(id: string, path: string): Generator<ScanEvent> {
    const buffered = bufferedDocs.get(id)
    if (buffered) { addPathTo(buffered, path); return }
    yield { type: 'candidate-patch', id, addPath: path }
  }
  /** Identical bytes at two real files: one candidate, the other a visible duplicate row (inline, the moment the row is complete). */
  function* placed(row: ScanCandidate, identity: string, realKey: string): Generator<ScanEvent> {
    const first = firstByIdentity.get(identity)
    if (!first) { firstByIdentity.set(identity, { id: row.id, relativePath: row.relativePath, realKey }); yield emit(row, realKey); return }
    // Several units of one container share the file and its hash — not duplicates.
    if (first.realKey === realKey) { yield emit(row, realKey); return }
    yield* addPath(first.id, row.relativePath)
    yield skipRow(row.relativePath, row.bytes, `Duplicate content of ${first.relativePath}`, 'duplicate-content', row.title, {
      sourcePath: row.sourcePath, sha256: row.sha256, adapterId: row.adapterId, mtime: row.mtime, birthtime: row.birthtime,
      ...(row.classifiedPath ? { classifiedPath: row.classifiedPath } : {}),
    }, realKey)
  }
  /** Bytes for classification: containers and small text whole; large text streamed, with a progress event between chunk groups. */
  function* hashed(full: string, large: boolean, isContainer: boolean): Generator<ScanEvent, { raw: Buffer | null; head: Buffer; sha256: string }> {
    if (isContainer || !large) { const raw = readFileSync(full); return { raw, head: raw, sha256: createHash('sha256').update(raw).digest('hex') } }
    const h = hashStreamed(full, HEAD_CHARS * 4)
    let n = h.next()
    while (!n.done) { yield progress(); n = h.next() }
    return { raw: null, ...n.value }
  }

  const gen = walkTree(root, { followSymlinks })
  let next = gen.next()
  while (!next.done) {
    const e = next.value
    switch (e.type) {
      case 'tick':
        counters = { dirsVisited: e.dirsVisited, filesSeen: e.filesSeen }
        yield progress()
        break
      case 'directory':
        currentDir = e.path
        yield { type: 'dir', row: { path: relOf(e.path), parent: e.parent ? relOf(e.parent) : null, name: basename(e.path), depth: e.depth, skippedClass: null, fileCount: e.fileCount, aliasOf: null } }
        break
      case 'directory-alias': {
        const firstRel = relOf(e.firstPath), aliasRel = relOf(e.path)
        yield { type: 'dir', row: { path: aliasRel, parent: relOf(dirname(e.path)), name: basename(e.path), depth: aliasRel.split('/').length, skippedClass: null, fileCount: 0, aliasOf: firstRel } }
        dirAliasPairs.push([firstRel, aliasRel])
        break
      }
      case 'directory-skipped': {
        const rel = relOf(e.path)
        yield { type: 'dir', row: { path: rel, parent: relOf(e.parent), name: basename(e.path), depth: e.depth, skippedClass: e.cls, fileCount: e.files, aliasOf: null } }
        yield skipRow(rel, 0, `${e.cls}: ${e.files} files in ${e.dirs} folders — not descended`, `directory-skipped:${e.cls}`, basename(e.path), {
          directory: { class: e.cls, files: e.files, dirs: e.dirs, unreadable: e.unreadable }, sourcePath: e.path, ...marks(rel),
        })
        break
      }
      case 'directory-unreadable':
        yield skipRow(relOf(e.path), 0, `Unreadable (${e.error})`, 'unreadable', undefined, { sourcePath: e.path, ...marks(relOf(e.path)) })
        break
      case 'symlink-broken':
        yield skipRow(relOf(e.path), 0, `Broken symlink → ${e.target}`, 'unreadable', undefined, { sourcePath: e.path, ...marks(relOf(e.path)) })
        break
      case 'symlink-unfollowed':
        yield skipRow(relOf(e.path), 0, 'Symlink inside an upload — not followed', 'symlink-upload', undefined, marks(relOf(e.path)))
        break
      case 'file-alias':
        for (const id of rowIdsByRealFile.get(e.realPath) ?? []) yield* addPath(id, relOf(e.path))
        break
      case 'file':
        yield* fileRows(e)
        break
      case 'skill-package-done':
        yield* closePackage(e.root)
        break
    }
    next = gen.next()
  }
  const summary = next.value
  for (const rootDir of [...packages.keys()]) yield* closePackage(rootDir) // never reached after a complete walk; a guard, not a pass
  // Directory aliases: every row at or under the first path is also at the alias path. Rows may be flushed already — the consumer applies it.
  for (const [realRel, aliasRel] of dirAliasPairs) yield { type: 'dir-alias', realRel, aliasRel }

  const dirsSkippedTotal = Object.values(summary.dirsSkipped).reduce((a, b) => a + b, 0)
  const scanMs = Math.round(performance.now() - started)
  const warnings: ScanWarning[] = []
  if (resolve(root) === resolve(homedir())) warnings.push({ code: 'home-root-mapped', params: { dirsVisited: summary.dirsVisited, skipped: dirsSkippedTotal }, message: `Every folder under the home directory was mapped; ${dirsSkippedTotal} folders of excluded classes are listed as rows` })
  if (dirsSkippedTotal > 0) {
    const detail = Object.entries(summary.dirsSkipped).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${c}`).join(', ')
    warnings.push({ code: 'directories-skipped', params: { count: dirsSkippedTotal, detail }, message: `${dirsSkippedTotal} folders were listed as one row each and not entered: ${detail}` })
  }
  if (stats.largeFiles > 0) warnings.push({ code: 'large-files', params: { count: stats.largeFiles }, message: `${stats.largeFiles} files are larger than usual — imported whole, marked` })
  if (stats.filesSkipped > 0) warnings.push({ code: 'rows-passed-over', params: { count: stats.filesSkipped }, message: `${stats.filesSkipped} files are listed as not importable (binary, duplicate, app state, unreadable) — each with its reason` })
  if (summary.symlinkCycles > 0) warnings.push({ code: 'symlink-cycles', params: { count: summary.symlinkCycles }, message: `${summary.symlinkCycles} symlink loops were detected and not re-entered` })
  if (summary.unreadable > 0) warnings.push({ code: 'unreadable', params: { count: summary.unreadable }, message: `${summary.unreadable} folders or files could not be read` })

  yield {
    type: 'done',
    result: {
      scanId: opts.scanId ?? generateId(), sourceProfile: opts.sourceProfile, detectedProfile: detected, rootPath: root, instructions: null,
      stats: {
        filesScanned: summary.filesSeen, filesSkipped: stats.filesSkipped, totalBytes: stats.totalBytes, dirsVisited: summary.dirsVisited,
        dirsSkipped: summary.dirsSkipped, filesInSkippedDirs: summary.filesInSkippedDirs, symlinksFollowed: summary.symlinksFollowed,
        symlinkAliases: summary.symlinkAliases, symlinkCycles: summary.symlinkCycles, unreadable: summary.unreadable, largeFiles: stats.largeFiles, scanMs,
      },
      warnings,
    },
  }

  // ── a skill package is complete: its document leaves the buffer with every asset attached ──
  function* closePackage(rootDir: string): Generator<ScanEvent> {
    const pkg = packages.get(rootDir)
    packages.delete(rootDir)
    if (!pkg) return
    const docRel = relOf(join(rootDir, 'SKILL.md'))
    function* orphans(why: string): Generator<ScanEvent> {
      for (const a of pkg!.assets) {
        const assetFull = join(rootDir, a.relPath)
        const assetRel = relOf(assetFull)
        yield skipRow(assetRel, a.bytes, `Bundled with ${docRel}, which did not become a skill: ${why}`, 'orphan-asset', undefined, { sha256: a.sha256, sourcePath: assetFull, ...marks(assetRel) }, safeRealpath(assetFull) ?? undefined)
      }
    }
    const doc = pkg.doc
    if (!doc) { yield* orphans(pkg.docOutcome ?? 'it was not listed'); return }
    bufferedDocs.delete(doc.id)
    const assets = [...pkg.assets].sort(byPathBytes)
    if (assets.length) {
      doc.assets = assets
      doc.reason = `${doc.reason} (+${assets.length} bundled files)`
      if (assets.some((a) => a.containsSecrets)) doc.tags = [...new Set([...(doc.tags ?? []), 'contains-secrets'])]
    }
    if (pkg.notBundled.length) { doc.notBundled = [...pkg.notBundled].sort(byPathBytes); doc.reason = `${doc.reason} (${pkg.notBundled.length} not bundled)` }
    const identity = skillIdentity(doc.sha256!, assets)
    const first = firstByIdentity.get(identity)
    yield* placed(doc, identity, pkg.docRealKey)
    if (first && first.realKey !== pkg.docRealKey) yield* orphans(`Duplicate content of ${first.relativePath}`)
  }

  // ── per-file rows ─────────────────────────────────────────────────────
  function* fileRows(e: Extract<WalkEntry, { type: 'file' }>): Generator<ScanEvent> {
    const full = e.path
    const rel = relOf(full)
    const classifyRel = marked(rel)
    const name = basename(full)
    const shared = (extra: Partial<ScanCandidate> = {}): Partial<ScanCandidate> => ({ sourcePath: full, mtime: e.mtime, birthtime: e.birthtime, ...marks(rel), ...extra })
    const pkg = e.skillRoot ? packageOf(e.skillRoot) : null
    const isDoc = pkg !== null && name.toLowerCase() === 'skill.md' && dirname(full) === e.skillRoot
    /** A SKILL.md that becomes something other than a skill row: the package's assets become orphans, and they say why. */
    const docIs = (why: string) => { if (isDoc && pkg) pkg.docOutcome = why }

    if (e.size <= 0) { docIs('Empty file'); yield skipRow(rel, 0, 'Empty file', 'empty', undefined, shared(), e.realPath); return }
    const cls = nameClass(name)
    // Rows the NAME already settles: listed from stat, NEVER read (R11.2/R11.3). Everything else — `.obsidian/**` included — is text and is read.
    if (cls === 'binary' || cls === 'derived-db' || cls === 'app-state') {
      const code = cls === 'app-state' ? 'app-state' : cls === 'derived-db' ? 'derived-index' : 'binary'
      const reason = code === 'app-state' ? 'Application state — not a note' : code === 'derived-index' ? 'Derived index / database file — not importable text' : 'Binary file — no text to import'
      docIs(reason); yield skipRow(rel, e.size, reason, code, undefined, shared(), e.realPath); return
    }
    stats.totalBytes += e.size
    const isContainer = CONTAINER_EXT.test(rel)
    const threshold = isContainer ? LARGE_CONTAINER_WARN_BYTES : LARGE_TEXT_WARN_BYTES
    const large = e.size > threshold
    if (large) stats.largeFiles++
    const warnings: ScanCandidate['warnings'] = large ? ['large-file'] : []

    // Package assets: every file under a skill root except the root's own SKILL.md. Hashed, sniffed, flagged for secrets,
    // never dropped for size or secrets, never a row of their own — they ride on the document at `skill-package-done`.
    if (pkg && !isDoc) {
      const { sha256, head } = yield* hashed(full, large, false)
      const binary = head.subarray(0, SNIFF_BYTES).includes(0)
      const flagged = !binary && looksLikeSecrets(rel, head.toString('utf-8'))
      pkg.assets.push({ relPath: toPosix(relative(e.skillRoot!, full)), bytes: e.size, sha256, binary, ...(flagged ? { containsSecrets: true } : {}), ...(large ? { large: true } : {}) })
      return
    }

    // Bytes: containers whole (the adapter's expand takes a Buffer); text under the threshold whole; larger text streamed with a head for classification.
    const { raw, head, sha256 } = yield* hashed(full, large, isContainer)
    if (!raw) warnings.push('secrets-scan-head-only')
    const binary = head.subarray(0, SNIFF_BYTES).includes(0)
    if (binary) { docIs('Binary file — no text to import'); yield skipRow(rel, e.size, 'Binary file — no text to import', 'binary', undefined, shared({ sha256 }), e.realPath); return }
    const headText = head.subarray(0, HEAD_CHARS * 4).toString('utf-8').slice(0, HEAD_CHARS)
    const { hint, adapterId } = classifyFile(classifyRel, headText, detected, { inVault: e.inVault })
    // Full-text secrets scan for what is in hand; the head for streamed files (warned above) and containers (checked per unit below).
    const fullText = raw && !isContainer ? raw.toString('utf-8') : headText
    const fileTags = new Set<string>(hint.tags ?? [])
    if (hint.kind !== 'noise' && looksLikeSecrets(rel, fullText)) fileTags.add('contains-secrets')
    const base = shared({ sha256, adapterId, ...(warnings.length ? { warnings } : {}) })

    if (hint.kind === 'noise') { docIs(hint.reason); yield skipRow(rel, e.size, hint.reason, hint.reasonCode, titleFromPathAndContent(rel, headText), base, e.realPath); return }

    const units = raw ? adapterFor(adapterId).expand?.(classifyRel, raw, full, { withContent: false }) : undefined
    if (units && units.length) {
      for (const u of units) {
        const tags = new Set([...fileTags, ...(u.tags ?? [])])
        if (u.hint.kind === 'noise') { yield skipRow(rel, u.bytes, u.hint.reason, u.hint.reasonCode, u.title, { ...base, unit: u.unit }, e.realPath); continue }
        // A key inside one conversation flags THAT unit, not the whole export.
        if (u.content && looksLikeSecrets(rel, u.content)) tags.add('contains-secrets')
        const row: ScanCandidate = {
          id: generateId(), relativePath: rel, kind: u.hint.kind, target: u.hint.target, title: u.title, preview: u.preview, bytes: u.bytes,
          confidence: u.hint.confidence, reason: u.hint.reason, reasonCode: u.hint.reasonCode,
          selectedByDefault: u.hint.selectedByDefault && u.hint.target !== 'none',
          ...(u.hint.scope ? { scope: u.hint.scope } : {}), unit: u.unit, turns: u.turns ?? null,
          sessionId: u.sessionId ?? null, sessionDate: u.sessionDate ?? null, ...(tags.size ? { tags: [...tags] } : {}), ...base,
        }
        yield* placed(row, sha256, e.realPath)
      }
      return
    }
    const row: ScanCandidate = {
      id: generateId(), relativePath: rel, kind: hint.kind, target: hint.target, title: titleFromPathAndContent(rel, headText), preview: previewOf(headText),
      bytes: e.size, confidence: hint.confidence, reason: hint.reason, reasonCode: hint.reasonCode,
      selectedByDefault: hint.selectedByDefault && hint.target !== 'none', ...(hint.scope ? { scope: hint.scope } : {}), unit: null,
      ...(fileTags.size ? { tags: [...fileTags] } : {}), ...base,
    }
    if (isDoc && hint.kind === 'skill') {
      // Held until `skill-package-done`: emitted then with its assets, tags and identity (whatever order readdir listed the package in).
      pkg!.doc = row; pkg!.docRealKey = e.realPath; bufferedDocs.set(row.id, row)
      return
    }
    if (isDoc) docIs(`it was listed as ${hint.kind}, not a skill`)
    yield* placed(row, sha256, e.realPath)
  }
}

/** Collects the stream and applies its patches; yields to the event loop on every progress event so a home walk never freezes the server. */
export async function scanDirectory(opts: {
  rootPath: string
  sourceProfile: SourceProfile
  followSymlinks?: boolean
  onProgress?: (p: { dirs: number; files: number; rows: number; elapsedMs: number }) => void
}): Promise<ScanResult> {
  const started = Date.now()
  const candidates: ScanCandidate[] = []
  const byId = new Map<string, ScanCandidate>()
  const dirs: ScanDirRow[] = []
  for (const ev of scanDirectoryEvents(opts)) {
    if (ev.type === 'candidate') { candidates.push(ev.candidate); byId.set(ev.candidate.id, ev.candidate) }
    else if (ev.type === 'candidate-patch') { const row = byId.get(ev.id); if (row) addPathTo(row, ev.addPath) }
    else if (ev.type === 'dir-alias') {
      for (const row of candidates) {
        const under = ev.realRel === '.' || row.relativePath === ev.realRel || row.relativePath.startsWith(ev.realRel + '/')
        if (under) addPathTo(row, ev.realRel === '.' ? `${ev.aliasRel}/${row.relativePath}` : `${ev.aliasRel}${row.relativePath.slice(ev.realRel.length)}`)
      }
    }
    else if (ev.type === 'dir') dirs.push(ev.row)
    else if (ev.type === 'progress') {
      opts.onProgress?.({ dirs: ev.dirsVisited, files: ev.filesSeen, rows: ev.candidates, elapsedMs: Date.now() - started })
      await new Promise<void>((r) => setImmediate(r))
    } else return { ...ev.result, candidates, dirs }
  }
  throw new Error('scan ended without a done event')
}
```

`dedupeByContent`, `applyDirAliases`, `attachSkillAssets`, `identityOf` and the private `addPath(row, rel)` are **deleted** — their intent lives in `placed`, `closePackage`, the `candidate-patch` / `dir-alias` events and the exported `addPathTo`. `noiseRow` and `byPathBytes` stay. `notBundled` stays on the buffer for the type's sake; no path can escape a package as reached, so the scanner never fills it. Every `skip(...)`/`noiseRow` call that used `too-large` or `secrets` is gone. The collector's `dir-alias` loop over `candidates` is the collect path only (uploads, tests); the table path applies it in SQL (Task 9).

- [ ] **Step 4: Run** — `bun vitest run tests/modules/data-port/scan-stream.test.ts tests/modules/data-port/scan-units.test.ts tests/modules/data-port/scan-rooted.test.ts tests/modules/data-port/no-caps.test.ts` → PASS (`no-caps` is fully green from here).

- [ ] **Step 5: Review** — `git status --short`.

---

### Task 8: Candidate store and the shared selection resolver (R11.7, P-10)

**Files:**
- Create: `src/modules/data-port/candidates-store.ts`, `src/modules/data-port/selection.ts`, `tests/fixtures/data-port/selection-cases.json`
- Modify: `tests/modules/data-port/candidates-store.test.ts` (append the store cases)
- Create: `tests/modules/data-port/selection-resolver.test.ts`

**Interfaces:**
- `candidates-store.ts`: `folderOf(rel)`, `insertCandidates(db, scanId, rows, startSeq)`, `insertDirs(db, scanId, rows)`, `whereFor(scanId, filter)`, `listCandidates(db, scanId, filter, page)`, `countCandidates`, `candidateCounts`, `listDirs(db, scanId, parent, filter)`, `getCandidate`, `getCandidatesByIds` (chunk 500), `iterateCandidates(db, scanId, filter, batch, fromSeq)` (keyset), `deleteScanRows`, `pruneScans(db, retention)`, `toPublicCandidate`, `rowToStored`.
- `selection.ts`: `normaliseSelection(input): SelectionWire`, `compileSelection(wire): { resolve(row): boolean; target(row): CandidateTarget; key: string }`, `SELECTION_MAX_*` enforcement (`throws RangeError`).

- [ ] **Step 1: Write the shared fixture and the failing tests**

`tests/fixtures/data-port/selection-cases.json` — pure JSON (no comment line: both test files `JSON.parse` it), read by the server resolver test AND `tests/web/data-port-selection.test.ts`:

```json
{
  "rows": [
    { "id": "r1", "kind": "memory",  "folder": "alpha",          "target": "vault.semantic", "importable": true,  "selectedByDefault": true  },
    { "id": "r2", "kind": "memory",  "folder": "alpha/deep",     "target": "vault.semantic", "importable": true,  "selectedByDefault": true  },
    { "id": "r3", "kind": "code",    "folder": "alpha/src",      "target": "vault.semantic", "importable": true,  "selectedByDefault": false },
    { "id": "r4", "kind": "noise",   "folder": "alpha",          "target": "none",           "importable": false, "selectedByDefault": false },
    { "id": "r5", "kind": "session", "folder": "bravo",          "target": "episodic",       "importable": true,  "selectedByDefault": true  },
    { "id": "r6", "kind": "memory",  "folder": "alpha-2",        "target": "vault.semantic", "importable": true,  "selectedByDefault": true  },
    { "id": "r7", "kind": "rule",    "folder": ".",              "target": "workspace.agents","importable": true, "selectedByDefault": true  }
  ],
  "cases": [
    { "name": "default base follows the scan",            "wire": { "base": "default", "groups": [], "rows": [] },                                                   "expect": { "r1": true, "r2": true, "r3": false, "r4": false, "r5": true, "r6": true, "r7": true } },
    { "name": "all base ticks every importable row",      "wire": { "base": "all", "groups": [], "rows": [] },                                                       "expect": { "r1": true, "r2": true, "r3": true, "r4": false, "r5": true, "r6": true, "r7": true } },
    { "name": "none base unticks everything",             "wire": { "base": "none", "groups": [], "rows": [] },                                                      "expect": { "r1": false, "r2": false, "r3": false, "r4": false, "r5": false, "r6": false, "r7": false } },
    { "name": "folder group matches the subtree only",    "wire": { "base": "default", "groups": [{ "folder": "alpha", "selected": false }], "rows": [] },          "expect": { "r1": false, "r2": false, "r3": false, "r4": false, "r5": true, "r6": true, "r7": true } },
    { "name": "kind group",                               "wire": { "base": "none", "groups": [{ "kind": "memory", "selected": true }], "rows": [] },               "expect": { "r1": true, "r2": true, "r3": false, "r4": false, "r5": false, "r6": true, "r7": false } },
    { "name": "kind and folder together",                 "wire": { "base": "none", "groups": [{ "kind": "memory", "folder": "alpha/deep", "selected": true }], "rows": [] }, "expect": { "r1": false, "r2": true, "r3": false, "r4": false, "r5": false, "r6": false, "r7": false } },
    { "name": "last matching group wins",                 "wire": { "base": "default", "groups": [{ "folder": "alpha", "selected": false }, { "folder": "alpha/deep", "selected": true }], "rows": [] }, "expect": { "r1": false, "r2": true, "r3": false, "r4": false, "r5": true, "r6": true, "r7": true } },
    { "name": "later broader group shadows earlier deeper one", "wire": { "base": "default", "groups": [{ "folder": "alpha/deep", "selected": true }, { "folder": "alpha", "selected": false }], "rows": [] }, "expect": { "r1": false, "r2": false, "r3": false, "r4": false, "r5": true, "r6": true, "r7": true } },
    { "name": "row override beats groups",                "wire": { "base": "none", "groups": [{ "folder": "alpha", "selected": false }], "rows": [{ "candidateId": "r3", "selected": true }] }, "expect": { "r1": false, "r2": false, "r3": true, "r4": false, "r5": false, "r6": false, "r7": false } },
    { "name": "importable gate beats everything",         "wire": { "base": "all", "groups": [{ "kind": "noise", "selected": true }], "rows": [{ "candidateId": "r4", "selected": true }] }, "expect": { "r1": true, "r2": true, "r3": true, "r4": false, "r5": true, "r6": true, "r7": true } },
    { "name": "root folder group matches everything",     "wire": { "base": "default", "groups": [{ "folder": ".", "selected": false }], "rows": [] },              "expect": { "r1": false, "r2": false, "r3": false, "r4": false, "r5": false, "r6": false, "r7": false } },
    { "name": "target-only row keeps the resolved selection", "wire": { "base": "default", "groups": [], "rows": [{ "candidateId": "r1", "target": "vault.procedural" }] }, "expect": { "r1": true, "r2": true, "r3": false, "r4": false, "r5": true, "r6": true, "r7": true }, "targets": { "r1": "vault.procedural", "r2": "vault.semantic" } }
  ],
  "legacy": { "input": [{ "candidateId": "r3" }, { "candidateId": "r1", "target": "vault.procedural" }], "expect": { "r1": true, "r2": false, "r3": true, "r4": false, "r5": false, "r6": false, "r7": false }, "targets": { "r1": "vault.procedural" } }
}
```

```ts
// tests/modules/data-port/selection-resolver.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileSelection, normaliseSelection } from '@modules/data-port/selection'

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/data-port/selection-cases.json'), 'utf-8'))

describe('selection resolver (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const sel = compileSelection(c.wire)
      const got = Object.fromEntries(fixture.rows.map((r: any) => [r.id, sel.resolve(r)]))
      expect(got).toEqual(c.expect)
      for (const [id, target] of Object.entries(c.targets ?? {})) expect(sel.target(fixture.rows.find((r: any) => r.id === id))).toBe(target)
    })
  }
  it('normalises the legacy id array', () => {
    const sel = compileSelection(normaliseSelection(fixture.legacy.input))
    expect(Object.fromEntries(fixture.rows.map((r: any) => [r.id, sel.resolve(r)]))).toEqual(fixture.legacy.expect)
    expect(sel.target(fixture.rows[0])).toBe('vault.procedural')
  })
  it('refuses a payload over the transport limits', () => {
    expect(() => compileSelection({ base: 'all', groups: Array.from({ length: 5001 }, () => ({ kind: 'memory', selected: true })), rows: [] })).toThrow(RangeError)
    expect(() => compileSelection({ base: 'all', groups: [], rows: Array.from({ length: 50001 }, (_, i) => ({ candidateId: `c${i}`, selected: true })) })).toThrow(RangeError)
  })
  it('gives the same key for the same wire, whatever the object key order', () => {
    expect(compileSelection({ base: 'all', groups: [{ folder: 'a', selected: true }], rows: [] }).key)
      .toBe(compileSelection({ rows: [], groups: [{ selected: true, folder: 'a' }], base: 'all' } as any).key)
  })
})
```

```ts
// tests/modules/data-port/candidates-store.test.ts — append
import { candidateCounts, countCandidates, folderOf, getCandidate, getCandidatesByIds, insertCandidates, insertDirs, iterateCandidates, listCandidates, listDirs, pruneScans, toPublicCandidate } from '@modules/data-port/candidates-store'

const synth = (n: number): ScanCandidate[] => Array.from({ length: n }, (_, i) => {
  const kind = (['memory', 'session', 'code', 'knowledge', 'noise', 'rule', 'skill'] as const)[i % 7]
  const target = kind === 'noise' ? 'none' : kind === 'session' ? 'episodic' : 'vault.semantic'
  return {
    id: `c${i}`, relativePath: `notes/${['alpha', 'bravo', 'charlie'][i % 3]}/d${i % 11}/n${i}.md`, kind, target, title: `note ${i}`, preview: '', bytes: i,
    confidence: 0.5, reason: 'r', reasonCode: i % 13 === 0 ? 'directory-skipped:node_modules' : 'memory-note', selectedByDefault: i % 5 !== 0 && target !== 'none',
    sourcePath: `/srv/${i}`, unit: i % 3 === 0 ? `u${i}` : null, tags: i % 17 === 0 ? ['contains-secrets'] : [],
  } as ScanCandidate
})

describe('candidates store', () => {
  it('derives folders', () => {
    expect(folderOf('a.md')).toBe('.'); expect(folderOf('x/a.md')).toBe('x'); expect(folderOf('.alpha/projects/slug/deep/f.jsonl')).toBe('.alpha/projects/slug/deep')
  })
  it('inserts 30 000 rows fast and pages them stably', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    const t0 = performance.now()
    insertCandidates(db, 's1', synth(30_000), 0)
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(countCandidates(db, 's1', {})).toBe(30_000)
    const page = listCandidates(db, 's1', {}, { offset: 29_900, limit: 200, order: 'path' })
    expect(page.items).toHaveLength(100); expect(page.total).toBe(30_000)
    const a = listCandidates(db, 's1', {}, { offset: 100, limit: 50, order: 'path' }).items.map((c) => c.id)
    const b = listCandidates(db, 's1', {}, { offset: 100, limit: 50, order: 'path' }).items.map((c) => c.id)
    expect(a).toEqual(b)
    expect(page.items[0]).toMatchObject({ seq: expect.any(Number), folder: expect.any(String), importable: expect.any(Boolean) })
    expect('sourcePath' in page.items[0]!).toBe(false)
  })
  it('iterates by keyset, every id once, seq strictly increasing', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(1234), 0)
    const seen: number[] = []
    let batches = 0
    for (const batch of iterateCandidates(db, 's1', {}, 500)) { batches++; for (const r of batch) seen.push(r.seq!) }
    expect(batches).toBe(3); expect(seen).toHaveLength(1234); expect(seen).toEqual([...seen].sort((x, y) => x - y)); expect(new Set(seen).size).toBe(1234)
    expect([...iterateCandidates(db, 's1', {}, 500, 1200)].flat().map((r) => r.seq)).toEqual([1201, 1202, 1203, 1204, 1205, 1206, 1207, 1208, 1209, 1210, 1211, 1212, 1213, 1214, 1215, 1216, 1217, 1218, 1219, 1220, 1221, 1222, 1223, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1231, 1232, 1233])
  })
  it('filters like a JS filter does', () => {
    const rows = synth(3000); const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', rows, 0)
    const js = (f: (c: ScanCandidate) => boolean) => rows.filter(f).length
    expect(countCandidates(db, 's1', { kind: ['memory', 'code'] })).toBe(js((c) => c.kind === 'memory' || c.kind === 'code'))
    expect(countCandidates(db, 's1', { folder: 'notes/alpha' })).toBe(js((c) => c.relativePath.startsWith('notes/alpha/')))
    expect(countCandidates(db, 's1', { folder: 'notes/alpha/d3', subtree: false })).toBe(js((c) => folderOf(c.relativePath) === 'notes/alpha/d3'))
    expect(countCandidates(db, 's1', { selected: true })).toBe(js((c) => c.selectedByDefault))
    expect(countCandidates(db, 's1', { importable: true })).toBe(js((c) => c.target !== 'none'))
    expect(countCandidates(db, 's1', { reason: ['directory-skipped'] })).toBe(js((c) => c.reasonCode.startsWith('directory-skipped')))
    expect(countCandidates(db, 's1', { tag: ['contains-secrets'] })).toBe(js((c) => c.tags?.includes('contains-secrets') ?? false))
    expect(countCandidates(db, 's1', { q: 'note 12' })).toBe(js((c) => c.title.includes('note 12')))
    expect(countCandidates(db, 's1', { q: '100%_x' })).toBe(0)
    expect(countCandidates(db, 's1', { excludeFolders: ['notes/alpha', 'notes/bravo'] })).toBe(js((c) => c.relativePath.startsWith('notes/charlie/')))
  })
  it('counts by kind, reason and folder consistently', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(700), 0)
    const c = candidateCounts(db, 's1', {})
    expect(c.byKind.reduce((a, b) => a + b.total, 0)).toBe(c.total)
    expect(c.byReason.reduce((a, b) => a + b.total, 0)).toBe(c.total)
    expect(c.byFolder.reduce((a, b) => a + b.total, 0)).toBe(c.total)
    expect(c.selectedByDefault).toBeLessThanOrEqual(c.importable)
  })
  it('lists directory children with subtree aggregates', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(300), 0)
    insertDirs(db, 's1', [
      { path: '.', parent: null, name: '.', depth: 0, skippedClass: null, fileCount: 0, aliasOf: null },
      { path: 'notes', parent: '.', name: 'notes', depth: 1, skippedClass: null, fileCount: 0, aliasOf: null },
      { path: 'notes/alpha', parent: 'notes', name: 'alpha', depth: 2, skippedClass: null, fileCount: 100, aliasOf: null },
      { path: 'notes/bravo', parent: 'notes', name: 'bravo', depth: 2, skippedClass: null, fileCount: 100, aliasOf: null },
      { path: 'notes/charlie', parent: 'notes', name: 'charlie', depth: 2, skippedClass: null, fileCount: 100, aliasOf: null },
      { path: 'notes/node_modules', parent: 'notes', name: 'node_modules', depth: 2, skippedClass: 'node_modules', fileCount: 42, aliasOf: null },
    ])
    const kids = listDirs(db, 's1', 'notes', {})
    expect(kids.map((k) => k.name)).toEqual(['alpha', 'bravo', 'charlie', 'node_modules'])
    expect(kids[0]!.subtree.total).toBe(100)
    expect(kids[3]).toMatchObject({ skippedClass: 'node_modules', fileCount: 42 })
    expect(kids[0]!.byKind.memory).toBeGreaterThan(0)
  })
  it('gets by id in the caller order, chunked', () => {
    const db = createMemoryDb(); createDataPortTables(db); insertCandidates(db, 's1', synth(1200), 0)
    const ids = ['c1100', 'c7', 'c999', 'nope']
    expect(getCandidatesByIds(db, 's1', ids).map((c) => c.id)).toEqual(['c1100', 'c7', 'c999'])
    expect(getCandidate(db, 's1', 'c7')?.sourcePath).toBe('/srv/7')
    expect(getCandidate(db, 'other', 'c7')).toBeNull()
  })
  it('prunes candidate rows of old scans but never their header rows', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    for (let i = 0; i < 4; i++) {
      db.run(sql`INSERT INTO data_port_scans (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json, created_at, format)
        VALUES (${'s' + i}, 'auto', 'generic-md', '/x', '[]', '{}', '[]', ${`2026-0${i + 1}-01T00:00:00.000Z`}, 2)`)
      insertCandidates(db, 's' + i, synth(5), 0)
    }
    pruneScans(db, { keepNewest: 2, keepDays: 0 })
    expect(countCandidates(db, 's0', {})).toBe(0); expect(countCandidates(db, 's3', {})).toBe(5)
    expect((db.all(sql`SELECT count(*) AS n FROM data_port_scans`) as any[])[0].n).toBe(4)
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/selection-resolver.test.ts tests/modules/data-port/candidates-store.test.ts` → FAIL.

- [ ] **Step 3: `selection.ts`**

```ts
// src/modules/data-port/selection.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE resolver for what a selection means. The web app carries a verbatim copy
// (src/web/src/pages/settings/data-port-selection.ts); both run
// tests/fixtures/data-port/selection-cases.json. Change one, change both.

import { SELECTION_MAX_GROUPS, SELECTION_MAX_ROWS } from './constants.js'
import type { CandidateTarget, ImportJobSelection, SelectionWire } from './types.js'

export interface SelectableRow { id: string; kind: string; folder: string; target: CandidateTarget | string; importable: boolean; selectedByDefault: boolean }

export function normaliseSelection(input: SelectionWire | ImportJobSelection[]): SelectionWire {
  if (Array.isArray(input)) {
    return { base: 'none', groups: [], rows: input.map((s) => ({ candidateId: s.candidateId, selected: true, ...(s.target ? { target: s.target } : {}) })) }
  }
  return { base: input.base ?? 'default', groups: input.groups ?? [], rows: input.rows ?? [] }
}

const folderMatches = (rowFolder: string, groupFolder: string): boolean =>
  groupFolder === '.' || rowFolder === groupFolder || rowFolder.startsWith(groupFolder + '/')

export function compileSelection(wire: SelectionWire) {
  if (wire.groups.length > SELECTION_MAX_GROUPS) throw new RangeError(`selection.groups over ${SELECTION_MAX_GROUPS}`)
  if (wire.rows.length > SELECTION_MAX_ROWS) throw new RangeError(`selection.rows over ${SELECTION_MAX_ROWS}`)
  const rowSel = new Map<string, boolean>()
  const rowTarget = new Map<string, CandidateTarget>()
  for (const r of wire.rows) {
    if (typeof r.selected === 'boolean') rowSel.set(r.candidateId, r.selected)
    if (r.target) rowTarget.set(r.candidateId, r.target)
  }
  const groups = wire.groups
  const canon = JSON.stringify({ base: wire.base, groups: groups.map((g) => [g.kind ?? '*', g.folder ?? '*', g.selected]), rows: [...wire.rows].map((r) => [r.candidateId, r.selected ?? null, r.target ?? null]).sort() })
  return {
    key: canon,
    resolve(row: SelectableRow): boolean {
      if (!row.importable) return false
      const forced = rowSel.get(row.id)
      if (forced !== undefined) return forced
      for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i]!
        if (g.kind !== undefined && g.kind !== row.kind) continue
        if (g.folder !== undefined && !folderMatches(row.folder, g.folder)) continue
        return g.selected
      }
      return wire.base === 'all' ? true : wire.base === 'default' ? row.selectedByDefault : false
    },
    target(row: SelectableRow): CandidateTarget {
      return rowTarget.get(row.id) ?? (row.target as CandidateTarget)
    },
  }
}
```

- [ ] **Step 4: `candidates-store.ts`**

```ts
// src/modules/data-port/candidates-store.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Every SQL statement touching data_port_candidates / data_port_scan_dirs.
// Dynamic WHERE via sql.join, LIMIT/OFFSET via sql.raw(String(int)) after
// clamping (memory-service.ts precedent). Never string-concatenate user input.

import { sql, type SQL } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { CANDIDATE_PAGE_MAX, SCAN_RETENTION } from './constants.js'
import { reasonPrefix, type CandidateCounts, type CandidateFilter, type DirectoryClass, type PublicCandidate, type ScanCandidate, type ScanDirRow } from './types.js'

export type StoredCandidate = ScanCandidate & { seq: number; folder: string; importable: boolean }

export function folderOf(relativePath: string): string {
  const p = relativePath.replace(/\\/g, '/')
  const at = p.lastIndexOf('/')
  return at < 0 ? '.' : p.slice(0, at)
}

const INSERT_CHUNK = 200 // × 34 columns = 6 800 params < 32 766 (better-sqlite3)
const IN_CHUNK = 500
const b = (v: boolean) => (v ? 1 : 0)
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v))

function withTransaction(db: EyasDb, fn: () => void): void {
  let began = false
  try { db.run(sql.raw('BEGIN IMMEDIATE')); began = true } catch (err) {
    if (!/within a transaction/i.test(String((err as Error)?.message ?? err))) throw err
  }
  try { fn(); if (began) db.run(sql.raw('COMMIT')) } catch (err) {
    if (began) { try { db.run(sql.raw('ROLLBACK')) } catch { /* gone */ } }
    throw err
  }
}

export function insertCandidates(db: EyasDb, scanId: string, rows: ScanCandidate[], startSeq: number): number {
  let seq = startSeq
  withTransaction(db, () => {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK)
      const values = chunk.map((c) => {
        const folder = folderOf(c.relativePath)
        return sql`(${scanId}, ${c.id}, ${seq++}, ${c.relativePath}, ${c.classifiedPath ?? null}, ${folder}, ${folder === '.' ? 0 : folder.split('/').length},
          ${c.kind}, ${c.target}, ${b(c.target !== 'none')}, ${c.title}, ${c.preview}, ${c.bytes}, ${c.confidence}, ${c.reason}, ${c.reasonCode}, ${reasonPrefix(c.reasonCode)},
          ${b(c.selectedByDefault)}, ${`${c.relativePath} ${c.title}`.toLowerCase()}, ${c.scope ?? null}, ${c.unit ?? null}, ${c.turns ?? null}, ${c.sessionId ?? null}, ${c.sessionDate ?? null},
          ${c.adapterId ?? null}, ${c.sourcePath ?? null}, ${c.sha256 ?? null}, ${c.mtime ?? null}, ${c.birthtime ?? null},
          ${JSON.stringify(c.tags ?? [])}, ${JSON.stringify(c.warnings ?? [])}, ${j(c.directory)}, ${j(c.paths)}, ${j(c.assets)}, ${j(c.notBundled)})`
      })
      db.run(sql`INSERT INTO data_port_candidates (scan_id, id, seq, relative_path, classified_path, folder, depth, kind, target, importable, title, preview, bytes, confidence,
        reason, reason_code, reason_prefix, selected_by_default, search_text, scope, unit, turns, session_id, session_date, adapter_id, source_path, sha256, mtime, birthtime,
        tags_json, warnings_json, directory_json, paths_json, assets_json, not_bundled_json) VALUES ${sql.join(values, sql`, `)}`)
    }
  })
  return seq
}

export function insertDirs(db: EyasDb, scanId: string, rows: ScanDirRow[]): void {
  withTransaction(db, () => {
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const values = rows.slice(i, i + INSERT_CHUNK).map((d) =>
        sql`(${scanId}, ${d.path}, ${d.parent}, ${d.name}, ${d.depth}, ${d.skippedClass}, ${d.fileCount}, ${d.aliasOf})`)
      db.run(sql`INSERT OR REPLACE INTO data_port_scan_dirs (scan_id, path, parent, name, depth, skipped_class, file_count, alias_of) VALUES ${sql.join(values, sql`, `)}`)
    }
  })
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)
const folderClause = (f: string): SQL => (f === '.' ? sql`1 = 1` : sql`(folder = ${f} OR folder LIKE ${escapeLike(f) + '/%'} ESCAPE '\\')`)

export function whereFor(scanId: string, filter: CandidateFilter, extra: { idsIn?: string[]; seqAfter?: number } = {}): SQL {
  const parts: SQL[] = [sql`scan_id = ${scanId}`]
  if (filter.kind?.length) parts.push(sql`kind IN (${sql.join(filter.kind.map((k) => sql`${k}`), sql`, `)})`)
  if (filter.excludeKinds?.length) parts.push(sql`kind NOT IN (${sql.join(filter.excludeKinds.map((k) => sql`${k}`), sql`, `)})`)
  if (filter.reason?.length) parts.push(sql`(${sql.join(filter.reason.map((r) => (r.includes(':') ? sql`reason_code = ${r}` : sql`reason_prefix = ${r}`)), sql` OR `)})`)
  if (filter.excludeReasons?.length) parts.push(sql`NOT (${sql.join(filter.excludeReasons.map((r) => (r.includes(':') ? sql`reason_code = ${r}` : sql`reason_prefix = ${r}`)), sql` OR `)})`)
  if (filter.folder !== undefined) parts.push(filter.subtree === false ? sql`folder = ${filter.folder}` : folderClause(filter.folder))
  if (filter.excludeFolders?.length) for (const f of filter.excludeFolders) parts.push(sql`NOT ${folderClause(f)}`)
  if (filter.selected !== undefined) parts.push(sql`selected_by_default = ${b(filter.selected)}`)
  if (filter.importable !== undefined) parts.push(sql`importable = ${b(filter.importable)}`)
  if (filter.tag?.length) for (const t of filter.tag) parts.push(sql`tags_json LIKE ${`%${JSON.stringify(t)}%`}`)
  if (filter.q) parts.push(sql`search_text LIKE ${'%' + escapeLike(filter.q.toLowerCase()) + '%'} ESCAPE '\\'`)
  if (extra.idsIn) parts.push(sql`id IN (${sql.join(extra.idsIn.map((i) => sql`${i}`), sql`, `)})`)
  if (extra.seqAfter !== undefined) parts.push(sql`seq > ${extra.seqAfter}`)
  return sql.join(parts, sql` AND `)
}

const COLS = sql`scan_id, id, seq, relative_path, classified_path, folder, kind, target, importable, title, preview, bytes, confidence, reason, reason_code, selected_by_default, scope, unit, turns, session_id, session_date, adapter_id, source_path, sha256, mtime, birthtime, tags_json, warnings_json, directory_json, paths_json, assets_json, not_bundled_json`

export function rowToStored(r: any): StoredCandidate {
  const parse = (s: string | null) => (s ? JSON.parse(s) : undefined)
  return {
    id: r.id, seq: r.seq, relativePath: r.relative_path, ...(r.classified_path ? { classifiedPath: r.classified_path } : {}), folder: r.folder, kind: r.kind, target: r.target,
    importable: r.importable === 1, title: r.title, preview: r.preview, bytes: r.bytes, confidence: r.confidence, reason: r.reason, reasonCode: r.reason_code,
    selectedByDefault: r.selected_by_default === 1, ...(r.scope ? { scope: r.scope } : {}), unit: r.unit ?? null, turns: r.turns ?? null,
    sessionId: r.session_id ?? null, sessionDate: r.session_date ?? null, ...(r.adapter_id ? { adapterId: r.adapter_id } : {}),
    ...(r.source_path ? { sourcePath: r.source_path } : {}), ...(r.sha256 ? { sha256: r.sha256 } : {}), ...(r.mtime ? { mtime: r.mtime } : {}), ...(r.birthtime ? { birthtime: r.birthtime } : {}),
    tags: parse(r.tags_json) ?? [], warnings: parse(r.warnings_json) ?? [], ...(r.directory_json ? { directory: parse(r.directory_json) } : {}),
    ...(r.paths_json ? { paths: parse(r.paths_json) } : {}), ...(r.assets_json ? { assets: parse(r.assets_json) } : {}), ...(r.not_bundled_json ? { notBundled: parse(r.not_bundled_json) } : {}),
  }
}

export function toPublicCandidate(c: StoredCandidate): PublicCandidate {
  const { sourcePath: _s, content: _c, ...rest } = c
  return rest
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number.isFinite(n) ? n : lo)))

export function listCandidates(db: EyasDb, scanId: string, filter: CandidateFilter, page: { offset: number; limit: number; order: 'path' | 'seq' }): { items: PublicCandidate[]; total: number } {
  const where = whereFor(scanId, filter)
  const order = page.order === 'seq' ? sql`seq ASC` : sql`relative_path ASC, seq ASC`
  const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE ${where} ORDER BY ${order} LIMIT ${sql.raw(String(clamp(page.limit, 1, CANDIDATE_PAGE_MAX)))} OFFSET ${sql.raw(String(clamp(page.offset, 0, Number.MAX_SAFE_INTEGER)))}`) as any[]
  return { items: rows.map((r) => toPublicCandidate(rowToStored(r))), total: countCandidates(db, scanId, filter) }
}

export function countCandidates(db: EyasDb, scanId: string, filter: CandidateFilter): number {
  return Number((db.all(sql`SELECT count(*) AS n FROM data_port_candidates WHERE ${whereFor(scanId, filter)}`) as any[])[0]?.n ?? 0)
}

export function candidateCounts(db: EyasDb, scanId: string, filter: CandidateFilter = {}): CandidateCounts {
  const where = whereFor(scanId, filter)
  const totals = (db.all(sql`SELECT count(*) AS total, coalesce(sum(importable), 0) AS importable, coalesce(sum(selected_by_default), 0) AS selected FROM data_port_candidates WHERE ${where}`) as any[])[0]
  const group = (col: SQL) => db.all(sql`SELECT ${col} AS key, count(*) AS total, coalesce(sum(importable), 0) AS importable, coalesce(sum(selected_by_default), 0) AS selectedByDefault FROM data_port_candidates WHERE ${where} GROUP BY key ORDER BY total DESC, key ASC`) as any[]
  return {
    total: Number(totals.total), importable: Number(totals.importable), selectedByDefault: Number(totals.selected),
    byKind: group(sql`kind`), byReason: group(sql`reason_code`).map(({ key, total }) => ({ key, total })), byFolder: group(sql`folder`),
  }
}

export interface DirNode extends ScanDirRow { subtree: { total: number; importable: number; selectedByDefault: number }; byKind: Record<string, number>; byReason: Record<string, number>; hasChildren: boolean }

/** Children of `parent` with subtree aggregates under the current filter — one GROUP BY over the parent's subtree, keyed by next segment. */
export function listDirs(db: EyasDb, scanId: string, parent: string, filter: CandidateFilter): DirNode[] {
  const dirs = db.all(sql`SELECT path, parent, name, depth, skipped_class, file_count, alias_of, EXISTS(SELECT 1 FROM data_port_scan_dirs c WHERE c.scan_id = d.scan_id AND c.parent = d.path) AS has_children
    FROM data_port_scan_dirs d WHERE scan_id = ${scanId} AND parent = ${parent} ORDER BY name ASC`) as any[]
  const prefixLen = parent === '.' ? 0 : parent.length + 1
  const segment = parent === '.' ? sql`substr(folder, 1, instr(folder || '/', '/') - 1)` : sql`substr(folder, ${prefixLen + 1}, instr(substr(folder, ${prefixLen + 1}) || '/', '/') - 1)`
  const where = whereFor(scanId, { ...filter, folder: parent })
  const agg = db.all(sql`SELECT ${segment} AS seg, kind, reason_prefix, count(*) AS total, sum(importable) AS importable, sum(selected_by_default) AS selected
    FROM data_port_candidates WHERE ${where} GROUP BY seg, kind, reason_prefix`) as any[]
  const bySeg = new Map<string, DirNode>()
  for (const d of dirs) bySeg.set(d.name, { path: d.path, parent: d.parent, name: d.name, depth: d.depth, skippedClass: d.skipped_class as DirectoryClass | null, fileCount: d.file_count, aliasOf: d.alias_of, subtree: { total: 0, importable: 0, selectedByDefault: 0 }, byKind: {}, byReason: {}, hasChildren: d.has_children === 1 })
  for (const a of agg) {
    const node = bySeg.get(a.seg); if (!node) continue
    node.subtree.total += Number(a.total); node.subtree.importable += Number(a.importable); node.subtree.selectedByDefault += Number(a.selected)
    node.byKind[a.kind] = (node.byKind[a.kind] ?? 0) + Number(a.total)
    node.byReason[a.reason_prefix] = (node.byReason[a.reason_prefix] ?? 0) + Number(a.total)
  }
  return [...bySeg.values()]
}

export function getCandidate(db: EyasDb, scanId: string, id: string): StoredCandidate | null {
  const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE scan_id = ${scanId} AND id = ${id}`) as any[]
  return rows.length ? rowToStored(rows[0]) : null
}

export function getCandidatesByIds(db: EyasDb, scanId: string, ids: string[]): StoredCandidate[] {
  const found = new Map<string, StoredCandidate>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE ${whereFor(scanId, {}, { idsIn: ids.slice(i, i + IN_CHUNK) })}`) as any[]
    for (const r of rows) found.set(r.id, rowToStored(r))
  }
  return ids.map((id) => found.get(id)).filter((c): c is StoredCandidate => Boolean(c))
}

/** Keyset paging on seq — never OFFSET; the table is immutable once the scan is done. */
export function* iterateCandidates(db: EyasDb, scanId: string, filter: CandidateFilter, batch = 500, fromSeq = -1): Generator<StoredCandidate[]> {
  let last = fromSeq
  for (;;) {
    const rows = db.all(sql`SELECT ${COLS} FROM data_port_candidates WHERE ${whereFor(scanId, filter, { seqAfter: last })} ORDER BY seq ASC LIMIT ${sql.raw(String(clamp(batch, 1, 5000)))}`) as any[]
    if (!rows.length) return
    const out = rows.map(rowToStored)
    last = out[out.length - 1]!.seq
    yield out
  }
}

export function deleteScanRows(db: EyasDb, scanId: string): void {
  db.run(sql`DELETE FROM data_port_candidates WHERE scan_id = ${scanId}`)
  db.run(sql`DELETE FROM data_port_scan_dirs WHERE scan_id = ${scanId}`)
}

/** Drops candidate/dir rows of scans outside the newest N AND older than D days, never one a pending/running job references. */
export function pruneScans(db: EyasDb, retention: { keepNewest: number; keepDays: number } = SCAN_RETENTION): number {
  const cutoff = new Date(Date.now() - retention.keepDays * 86_400_000).toISOString()
  const victims = db.all(sql`SELECT id FROM data_port_scans s WHERE created_at < ${cutoff}
    AND id NOT IN (SELECT id FROM data_port_scans ORDER BY created_at DESC LIMIT ${sql.raw(String(clamp(retention.keepNewest, 0, 1000)))})
    AND NOT EXISTS (SELECT 1 FROM data_port_jobs j WHERE j.scan_id = s.id AND j.status IN ('pending', 'running'))
    AND EXISTS (SELECT 1 FROM data_port_candidates c WHERE c.scan_id = s.id)`) as Array<{ id: string }>
  for (const v of victims) { deleteScanRows(db, v.id); db.run(sql`UPDATE data_port_scans SET candidate_count = 0 WHERE id = ${v.id}`) }
  return victims.length
}
```

- [ ] **Step 5: Run** — `bun vitest run tests/modules/data-port/selection-resolver.test.ts tests/modules/data-port/candidates-store.test.ts` → PASS.

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 10: Whitespace byte for byte — frontmatter reader and skill package (R11.5, P-13)

**Files:**
- Modify: `src/modules/data-port/source-frontmatter.ts` (`splitFrontmatter` only), `src/modules/data-port/skill-package.ts`
- Modify: `tests/modules/data-port/source-frontmatter.test.ts`, `tests/modules/data-port/skill-package.test.ts`, `tests/modules/data-port/transform.test.ts` (the one `.trim()` expectation)

**Interfaces:**
- Produces: `splitFrontmatter` returns the body verbatim; `legacyBody(body)` (the pre-amendment trimming, for idempotency fallbacks only); `assembleSkillContent` / `appendSourceFrontmatter` verbatim; `assembleSkillContentLegacy` / `appendSourceFrontmatterLegacy` (pre-amendment shape, exported for the fallback digest); `buildSkillFromPackage({ containsSecrets? })` and `SkillTransformResult.containsSecrets`.
- Deletes: `trimTail`, `dropLeadingBlankLines`, every `.trimEnd()` in `skill-package.ts` except inside the `*Legacy` twins.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/source-frontmatter.test.ts — replace `expect(r.body).toBe(raw.trim())` with `toBe(raw)` and add
  it('keeps leading and trailing blank lines, indentation and CRLF byte for byte', () => {
    expect(splitFrontmatter('---\na: 1\n---\n\n\n  indented\n\n\n').body).toBe('\n\n  indented\n\n\n')
    expect(splitFrontmatter('---\r\na: 1\r\n---\r\nline\r\n').body).toBe('line\r\n')
    expect(splitFrontmatter('---\na: 1\n---').body).toBe('')
    expect(splitFrontmatter('no frontmatter\n\n').body).toBe('no frontmatter\n\n')
  })
  it('drops only a leading BOM (documented exception)', () => {
    expect(splitFrontmatter('﻿---\na: 1\n---\nx').hadFrontmatter).toBe(true)
  })
  it('reproduces the pre-amendment trimming for the idempotency fallback', () => {
    expect(legacyBody('\n\n  indented\n\n\n')).toBe('  indented')
  })
```

```ts
// tests/modules/data-port/skill-package.test.ts — add / rewrite
  it('keeps the SKILL.md body byte for byte before the bundled-files section', () => {
    const out = assembleSkillContent('\n# Deploy\n\ntext\n\n', [{ relPath: 'a.sh', content: 'echo\n' }], null)
    expect(out.startsWith('\n# Deploy\n\ntext\n\n\n---\n')).toBe(true)
    expect(out.endsWith('```\n')).toBe(true)
  })
  it('inlines a flagged asset verbatim and marks the package', () => {
    const r = buildSkillFromPackage({ relativePath: 'x/SKILL.md', raw: '---\nname: x\n---\n# x\n', assets: [{ relPath: '.env', content: 'API_KEY=alphabravo0123456789\n', containsSecrets: true }] })
    expect(r.containsSecrets).toBe(true)
    expect(assembleSkillContent(r.content, r.assets, null)).toContain('### .env')
    expect(buildSkillFromPackage({ relativePath: 'x/SKILL.md', raw: '# x', assets: [] }).containsSecrets).toBeUndefined()
  })
  it('clips only the inline copy and names the complete on-disk file in the marker', () => {
    const big = 'a'.repeat(MAX_INLINE_ASSET_CHARS + 10)
    const out = assembleSkillContent('# x\n', [{ relPath: 'references/dump.md', content: big }], 'skills/imported/x-0123')
    expect(out).toContain('the complete file is skills/imported/x-0123/references/dump.md')
    expect(out).not.toContain('a'.repeat(MAX_INLINE_ASSET_CHARS + 1))
  })
  it('legacy assembly reproduces the pre-amendment body on a fixed input', () => {
    const legacy = assembleSkillContentLegacy('\n# Deploy\n\ntext\n\n', [{ relPath: 'a.sh', content: 'echo\n' }], null)
    expect(legacy.startsWith('# Deploy\n\ntext\n\n---\n')).toBe(true)
    expect(legacy.endsWith('```')).toBe(true)
  })
```

`transform.test.ts`: `expectedBody` is the raw body without `.trim()`.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/source-frontmatter.test.ts tests/modules/data-port/skill-package.test.ts tests/modules/data-port/transform.test.ts` → FAIL.

- [ ] **Step 3: Write the code**

```ts
// src/modules/data-port/source-frontmatter.ts — replaces trimTail/dropLeadingBlankLines and splitFrontmatter's body lines
/** The pre-amendment normalisation. Used ONLY by idempotency fallbacks (R11.8), never by a writer. */
export function legacyBody(body: string): string {
  return body.replace(/^(?:\r?\n)+/, '').replace(/\s+$/, '')
}

export function splitFrontmatter(raw: string): SplitFrontmatter {
  // A leading byte-order mark is an encoding signature, not text: the one
  // documented normalisation besides the vault writer's trailing newline (R11.5).
  raw = raw.replace(/^﻿/, '')
  const none = { data: {}, body: raw, hadFrontmatter: false, frontmatterRaw: null, parseError: null }
  if (!raw.startsWith('---')) return none
  const m = FRONTMATTER_RE.exec(raw)
  if (!m) return none
  // FRONTMATTER_RE consumes the closing delimiter's own line terminator, so the
  // body starts at the first byte after it: leading blank lines, indentation,
  // trailing blank lines, CRLF and the final newline all survive.
  const body = raw.slice(m[0].length)
  // … the rest of the function is unchanged (parseBlock, fallbackFields)
```

```ts
// src/modules/data-port/skill-package.ts — verbatim assembly + legacy twins
const endsWithNewline = (s: string) => s.endsWith('\n')

/** The clip marker names the complete on-disk copy (P-15, P-20): the inline copy is a rendering, the file is the record. */
export const truncationMarker = (onDiskPath: string | null, relPath: string): string =>
  `… (inline copy clipped at ${MAX_INLINE_ASSET_CHARS} characters — the complete file is ${onDiskPath ? `${onDiskPath}/${relPath}` : relPath})`

function inlineText(content: string | Buffer, onDiskDir: string | null, relPath: string): string {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content
  if (text.length <= MAX_INLINE_ASSET_CHARS) return text
  const points = Array.from(text)
  if (points.length <= MAX_INLINE_ASSET_CHARS) return text
  return `${points.slice(0, MAX_INLINE_ASSET_CHARS).join('')}\n${truncationMarker(onDiskDir, relPath)}`
}

/** Fenced verbatim: the closing fence lands on its own line whether or not the file ends with one. */
function fenced(text: string, lang: string): string {
  const fence = fenceFor(text)
  return `${fence}${lang}\n${text}${endsWithNewline(text) ? '' : '\n'}${fence}\n`
}

export function assembleSkillContent(body: string, assets: SkillAsset[], onDiskDir: string | null, notBundled: ReadonlyArray<{ relPath: string; bytes: number; reason: string }> = []): string {
  if (!assets.length && !notBundled.length) return body
  const parts = [`${body}${endsWithNewline(body) ? '' : '\n'}`, '---', '']
  // … sections as before, each asset via `fenced(inlineText(a.content, onDiskDir, a.relPath), fenceLanguage(a.relPath))`; no `.trimEnd()` anywhere
  return parts.join('\n')
}

export function appendSourceFrontmatter(body: string, data: Record<string, unknown>): string {
  // … unchanged except: `${body}${endsWithNewline(body) ? '' : '\n'}\n## Source frontmatter\n\n${fence}yaml\n${yaml}\n${fence}\n`
}

/** Pre-amendment shapes, kept ONLY to recognise packages imported before R11.5 (P-13). */
export function assembleSkillContentLegacy(body: string, assets: SkillAsset[], onDiskDir: string | null, notBundled: ReadonlyArray<{ relPath: string; bytes: number; reason: string }> = []): string { /* the previous implementation, verbatim */ }
export function appendSourceFrontmatterLegacy(body: string, data: Record<string, unknown>): string { /* the previous implementation, verbatim */ }

export function buildSkillFromPackage(input: { relativePath: string; raw: string; assets: SkillAsset[]; notBundled?: …; containsSecrets?: boolean }): SkillTransformResult {
  // … unchanged, plus:
  const containsSecrets = input.containsSecrets || input.assets.some((a) => a.containsSecrets) || undefined
  return { …, ...(containsSecrets ? { containsSecrets: true } : {}) }
}
```

- [ ] **Step 4: Run** — `bun vitest run tests/modules/data-port/source-frontmatter.test.ts tests/modules/data-port/skill-package.test.ts tests/modules/data-port/transform.test.ts` → PASS. (`apply-memory`/`scan-and-apply` may now fail on identity comparisons — Task 11 owns those.)

- [ ] **Step 5: Review** — `git status --short`.

---
## Phase 3 — Filing and recalling

### Task 9: Service and routes — table-backed scans, background scan, paging, counts, selection count, preview, filter jobs, migration, retention (R11.7, P-9..P-12)

**Files:**
- Modify: `src/modules/data-port/service.ts` (everything except `runJob`, the queue and the resume sweep — Task 12), `src/modules/data-port/routes.ts`, `src/modules/data-port/index.ts`
- Modify: `tests/modules/data-port/scan-and-apply.test.ts` (scan-side assertions and the `allCandidates` helper), `tests/modules/data-port/proposals.test.ts` (route harness only if it posts a job)
- Create: `tests/modules/data-port/candidates-routes.test.ts`, `tests/modules/data-port/job-selection-filter.test.ts`, `tests/modules/data-port/preview.test.ts`, `tests/modules/data-port/legacy-scan-migration.test.ts`

**Interfaces:**
- Service: `scanPath(profile, path, instructions): ScanSummary` (202-shaped, `status: 'running'`, background drive), `scanUpload(...)` (sync, `status: 'done'`), `getScan(id): ScanSummary | null`, `listCandidates(id, filter, page)`, `countCandidates`, `candidateCounts`, `listDirs(id, parent, filter)`, `selectionCount(id, wire, filter?, folders?)`, `preview(id, candidateId, bytes)`, `cancelScan(id)`, `createJob({ scanId, sourceProfile, selection: SelectionWire | ImportJobSelection[], instructions?, enrich? })`, `migrateLegacyScans()`.
- Routes: `POST /import/scan` → 202 `ScanSummary`; `GET /import/scans/:id`; `DELETE /import/scans/:id`; `GET /import/scans/:id/tree?parent=&<filter>`; `GET /import/scans/:id/candidates?<filter>&offset=&limit=&order=`; `GET /import/scans/:id/counts?<filter>`; `POST /import/scans/:id/selection/count`; `GET /import/scans/:id/candidates/:cid/preview?bytes=`; `POST /import/jobs` accepts `SelectionWire` or the legacy array, 409 while the scan runs.
- Deletes: `scanCache`, `cacheScan`, `SCAN_CACHE_LIMIT`, `loadScanCandidates`, the `finalizeScan` sort, `MAX_UPLOAD_BYTES` (→ `UPLOAD_BODY_BYTES`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/candidates-routes.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createDataPortRoutes } from '@modules/data-port/routes'

let root: string, db: any, service: ReturnType<typeof createDataPortService>, app: Hono
const put = (rel: string, body = '# n') => { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body) }
const wait = async (done: () => boolean, ms = 10_000) => { const t = Date.now(); while (!done() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)) }
const get = (path: string) => app.request(`/api/v1/data-port${path}`)
const post = (path: string, body: unknown) => app.request(`/api/v1/data-port${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'dp-routes-')); db = createMemoryDb(); createDataPortTables(db)
  for (let i = 0; i < 30; i++) put(`notes/${i % 2 ? 'alpha' : 'bravo'}/n${i}.md`, `# note ${i}`)
  for (let i = 0; i < 5; i++) put(`GitHub/alpha/src/f${i}.ts`, 'export {}')
  put('GitHub/alpha/node_modules/m/index.js', 'x'); put('notes/logo.png', Buffer.from([0x89, 0x50]) as any); put('notes/alpha/deep/d.md', '# deep')
  service = createDataPortService({ db, modelCtx: { model: undefined, logger: console } as any, applyDepsFactory: () => ({ createProposal: () => 'p', resolveDefaultAgentId: () => null }) as any, dataDir: join(root, 'data') })
  app = new Hono(); app.use('*', async (c, next) => { (c as any).set('ability', { can: () => true }); await next() }); createDataPortRoutes(app, { service })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

async function scanned(): Promise<string> {
  const res = await post('/import/scan', { path: root, sourceProfile: 'auto' })
  expect(res.status).toBe(202)
  const body = await res.json() as any
  expect(body.status).toBe('running'); expect(body.candidates).toBeUndefined()
  await wait(() => service.getScan(body.scanId)?.status === 'done')
  return body.scanId
}

describe('scan status and candidates API', () => {
  it('reports the finished scan with counts, stats and no absolute path', async () => {
    const id = await scanned()
    const res = await get(`/import/scans/${id}`); const s = await res.json() as any
    expect(s.status).toBe('done'); expect(s.stats.candidateCount).toBe(38); expect(s.counts.total).toBe(38)
    expect(s.stats.scanMs).toBeGreaterThanOrEqual(0); expect(s.stats.directoriesMapped).toBeGreaterThan(0)
    expect(JSON.stringify(s)).not.toContain(root)
  })
  it('pages, filters and never leaks the server path', async () => {
    const id = await scanned()
    const all = await (await get(`/import/scans/${id}/candidates`)).json() as any
    expect(all.items).toHaveLength(38); expect(all.total).toBe(38); expect(all.items[0]).toHaveProperty('seq'); expect(all.items[0]).toHaveProperty('folder')
    expect(JSON.stringify(all)).not.toContain(root)
    expect(((await (await get(`/import/scans/${id}/candidates?limit=5&offset=36`)).json()) as any).items).toHaveLength(2)
    const kinds = await (await get(`/import/scans/${id}/candidates?kind=memory,code`)).json() as any
    expect(kinds.items.every((c: any) => c.kind === 'memory' || c.kind === 'code')).toBe(true)
    const sub = await (await get(`/import/scans/${id}/candidates?folder=notes/alpha`)).json() as any
    expect(sub.items.some((c: any) => c.relativePath === 'notes/alpha/deep/d.md')).toBe(true)
    const direct = await (await get(`/import/scans/${id}/candidates?folder=notes/alpha&subtree=false`)).json() as any
    expect(direct.items.some((c: any) => c.relativePath === 'notes/alpha/deep/d.md')).toBe(false)
    expect(((await (await get(`/import/scans/${id}/candidates?selected=false`)).json()) as any).items.every((c: any) => !c.selectedByDefault)).toBe(true)
    expect(((await (await get(`/import/scans/${id}/candidates?reason=directory-skipped`)).json()) as any).items).toHaveLength(1)
    expect(((await (await get(`/import/scans/${id}/candidates?q=note 1`)).json()) as any).items.every((c: any) => /note 1/.test(c.title))).toBe(true)
    for (const bad of ['limit=0', 'limit=5000', 'offset=-1', 'kind=bogus', 'reason=Has Space', 'order=x']) expect((await get(`/import/scans/${id}/candidates?${bad}`)).status).toBe(400)
    expect((await get('/import/scans/nope/candidates')).status).toBe(404)
  })
  it('answers counts and a folder tree', async () => {
    const id = await scanned()
    const c = await (await get(`/import/scans/${id}/counts`)).json() as any
    expect(c.byKind.reduce((a: number, b: any) => a + b.total, 0)).toBe(c.total)
    const tree = await (await get(`/import/scans/${id}/tree?parent=.`)).json() as any
    expect(tree.dirs.map((d: any) => d.name).sort()).toEqual(['GitHub', 'notes'])
    const gh = await (await get(`/import/scans/${id}/tree?parent=GitHub/alpha`)).json() as any
    expect(gh.dirs.find((d: any) => d.name === 'node_modules')).toMatchObject({ skippedClass: 'node_modules', fileCount: 1 })
    expect(gh.dirs.find((d: any) => d.name === 'src').subtree.total).toBe(5)
  })
  it('resolves a selection count server-side', async () => {
    const id = await scanned()
    const r = await (await post(`/import/scans/${id}/selection/count`, { selection: { base: 'default', groups: [{ folder: 'notes/bravo', selected: false }], rows: [] }, folders: ['notes/alpha', 'notes/bravo'] })).json() as any
    expect(r.selected).toBe(16); expect(r.byFolder['notes/bravo']).toBe(0); expect(r.byFolder['notes/alpha']).toBe(16)
    expect((await post(`/import/scans/${id}/selection/count`, { selection: { base: 'all', groups: Array.from({ length: 5001 }, () => ({ selected: true })), rows: [] } })).status).toBe(400)
  })
  it('creates jobs from a wire, from the legacy array, refuses noise-only and a running scan', async () => {
    const id = await scanned()
    const wire = await post('/import/jobs', { scanId: id, sourceProfile: 'auto', selection: { base: 'none', groups: [{ kind: 'memory', selected: true }], rows: [] } })
    expect(wire.status).toBe(201); const j = (await wire.json() as any).job; expect(j.selectionMode).toBe('wire'); expect(j.selectionTotal).toBe(31)
    const first = (await (await get(`/import/scans/${id}/candidates?kind=memory&limit=1`)).json() as any).items[0]
    const legacy = await post('/import/jobs', { scanId: id, sourceProfile: 'auto', selection: [{ candidateId: first.id }] })
    expect(legacy.status).toBe(201); expect((await legacy.json() as any).job.selectionTotal).toBe(1)
    expect((await post('/import/jobs', { scanId: id, sourceProfile: 'auto', selection: { base: 'none', groups: [{ kind: 'noise', selected: true }], rows: [] } })).status).toBe(400)
    expect((await post('/import/jobs', { scanId: id, sourceProfile: 'auto', selection: { base: 'bogus', groups: [], rows: [] } })).status).toBe(400)
    // The drive starts on the next tick and runs until its first progress event (500 files); a 3 000-file tree is still `running` when the job is posted.
    for (let i = 0; i < 3000; i++) put(`bulk/b${i}.md`, '# b')
    const running = await (await post('/import/scan', { path: root, sourceProfile: 'auto' })).json() as any
    expect(running.status).toBe('running')
    expect((await post('/import/jobs', { scanId: running.scanId, sourceProfile: 'auto', selection: { base: 'all', groups: [], rows: [] } })).status).toBe(409)
    await wait(() => service.getScan(running.scanId)?.status === 'done')
  })
  it('answers 400 for a missing path and a file path before any header is written', async () => {
    expect((await post('/import/scan', { path: join(root, 'nowhere'), sourceProfile: 'auto' })).status).toBe(400)
    put('plain.md', '# p')
    expect((await post('/import/scan', { path: join(root, 'plain.md'), sourceProfile: 'auto' })).status).toBe(400)
    expect((db.all(sql`SELECT count(*) AS n FROM data_port_scans`) as any[])[0].n).toBe(0) // no header row for a refused path
  })
  it('stores alias paths, duplicates, skill assets and orphan rows through the background drive (P-18)', async () => {
    put('a/x.md', '# same body\n'); put('b/x.md', '# same body\n'); put('real/n.md', '# n')
    symlinkSync(join(root, 'real'), join(root, 'link'))
    put('.claude/skills/deploy/.env', 'TOKEN=alphabravocharlie0001\n'); put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    put('.claude/skills/alpha/SKILL.md', '# same skill\n'); put('.claude/skills/bravo/SKILL.md', '# same skill\n'); put('.claude/skills/bravo/run.sh', 'echo\n')
    const id = await scanned()
    const rows = (await (await get(`/import/scans/${id}/candidates?limit=500`)).json() as any).items as any[]
    const by = (rel: string) => rows.find((c) => c.relativePath === rel)
    const xs = rows.filter((c) => /^(a|b)\/x\.md$/.test(c.relativePath))
    expect(xs.find((c) => c.kind !== 'noise')!.paths.sort()).toEqual(['a/x.md', 'b/x.md'])
    expect(xs.find((c) => c.kind === 'noise')).toMatchObject({ reasonCode: 'duplicate-content', importable: false })
    expect(rows.find((c) => c.relativePath.endsWith('n.md'))!.paths.sort()).toEqual(['link/n.md', 'real/n.md'])
    expect(rows.filter((c) => c.relativePath.endsWith('n.md'))).toHaveLength(1)
    const skill = by('.claude/skills/deploy/SKILL.md')
    expect(skill.assets.map((a: any) => a.relPath)).toEqual(['.env']); expect(skill.assets[0].containsSecrets).toBe(true); expect(skill.tags).toContain('contains-secrets')
    expect(rows.filter((c) => c.kind === 'skill' && /skills\/(alpha|bravo)\//.test(c.relativePath))).toHaveLength(1)
    expect(by('.claude/skills/bravo/run.sh')).toMatchObject({ kind: 'noise', reasonCode: 'orphan-asset' })
    const s = service.getScan(id)!
    expect(s.stats.filesSkipped).toBe(rows.filter((c) => c.kind === 'noise').length)
  })
  it('previews a file by id, cuts on a UTF-8 boundary, refuses unknown ids', async () => {
    put('notes/alpha/u.md', '# é'.repeat(40_000))
    const id = await scanned()
    const row = (await (await get(`/import/scans/${id}/candidates?q=u.md`)).json() as any).items[0]
    const p = await (await get(`/import/scans/${id}/candidates/${row.id}/preview?bytes=65536`)).json() as any
    expect(p.truncated).toBe(true); expect(p.head).not.toContain('�'); expect(Buffer.byteLength(p.head)).toBeLessThanOrEqual(65_536)
    expect(p.candidate).not.toHaveProperty('sourcePath')
    expect((await get(`/import/scans/${id}/candidates/nope/preview`)).status).toBe(404)
    const dir = (await (await get(`/import/scans/${id}/candidates?reason=directory-skipped`)).json() as any).items[0]
    expect((await (await get(`/import/scans/${id}/candidates/${dir.id}/preview`)).json() as any).children).toContain('m')
  })
  it('cancels a running scan and purges its rows', async () => {
    for (let i = 0; i < 3000; i++) put(`bulk/b${i}.md`, '# b')
    const s = await (await post('/import/scan', { path: root, sourceProfile: 'auto' })).json() as any
    expect((await app.request(`/api/v1/data-port/import/scans/${s.scanId}`, { method: 'DELETE' })).status).toBe(200)
    await wait(() => ['cancelled', 'done'].includes(service.getScan(s.scanId)?.status ?? ''))
    expect(service.getScan(s.scanId)?.status).toBe('cancelled')
    expect(service.countCandidates(s.scanId, {})).toBe(0)
  })
  it('purges a finished scan on DELETE too', async () => {
    const id = await scanned()
    expect(service.countCandidates(id, {})).toBe(38)
    expect((await app.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(service.countCandidates(id, {})).toBe(0)
    expect(service.getScan(id)).toMatchObject({ status: 'cancelled', stats: expect.objectContaining({ candidateCount: 0 }) })
  })
})
```

`job-selection-filter.test.ts`: a 1 200-note alpha/bravo/charlie tree; wire `{ base: 'none', groups: [{ kind: 'memory', folder: 'notes/alpha', selected: true }], rows: [{ candidateId: <one alpha id>, selected: false }, { candidateId: <another alpha id>, target: 'vault.procedural' }] }` → `selectionTotal === alphaCount - 1`, job completes with `applied === selectionTotal`, no ledger row for the excluded file, the overridden note's ledger kind is `vault` with a `procedural/` ref; a row id from another scan in `rows` changes nothing; `selection_json` under 2 000 bytes; the legacy array gives the same ledger. (The job-run half of these assertions passes once Task 12 lands; write them now, mark the run half `it.todo` until Task 12 flips them.)
`preview.test.ts`: binary row → `encoding: 'binary'`, no head; secrets-tagged row → verbatim head and `candidate.tags` contains `contains-secrets`.
`legacy-scan-migration.test.ts`: seed a `format = 1` scan row with a hand-built `candidates_json` of 3 candidates (one with `sourcePath`) → after `service.migrateLegacyScans()` the table holds 3 rows with `seq` 0..2, the scan reads `format 2`, `candidates_json = '[]'`, `candidate_count 3`; a scan whose blob is `not json` → `status 'failed'` with a `legacy` warning; running the migration twice is a no-op.
`scan-and-apply.test.ts`: add `const allCandidates = (scanId: string) => { const out = []; for (let off = 0; ; off += 500) { const p = service.listCandidates(scanId, {}, { offset: off, limit: 500, order: 'seq' }); out.push(...p.items); if (out.length >= p.total) return out } }`; replace every `scan.candidates` read with `allCandidates(scan.scanId)` after `await wait(() => service.getScan(scan.scanId)?.status === 'done')`; 'never hands the caller a body or an absolute path' → the summary has no `candidates`, `SELECT source_path FROM data_port_candidates WHERE scan_id = ?` has ≥ 1 absolute path, `candidates_json` is `'[]'`, `candidate_count` equals the store count; `service.createJob` calls pass `selection` as either shape.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/candidates-routes.test.ts tests/modules/data-port/preview.test.ts tests/modules/data-port/legacy-scan-migration.test.ts` → FAIL.

- [ ] **Step 3: Service — scans**

```ts
// src/modules/data-port/service.ts — scan side (replaces persistScan/finalizeScan/loadScanCandidates/scanPath/scanUpload/createJob)
import { candidateCounts, countCandidates, deleteScanRows, escapeLike, getCandidate, getCandidatesByIds, insertCandidates, insertDirs, iterateCandidates, listCandidates, listDirs, pruneScans, toPublicCandidate } from './candidates-store.js'
import { compileSelection, normaliseSelection } from './selection.js'
import { addPathTo, scanDirectory, scanDirectoryEvents } from './scanners/scan-path.js'
import { SCAN_FLUSH_ROWS, UPLOAD_BODY_BYTES } from './constants.js'

  /** Scans this process is driving, so a DELETE can stop one cooperatively. */
  const running = new Map<string, { cancelled: boolean }>()

  function insertScanHeader(result: Omit<ScanResult, 'candidates' | 'dirs'> & { status: ScanStatus }, sourceProfile: SourceProfile, instructions: string | null): void {
    const now = new Date().toISOString()
    deps.db.run(sql`INSERT INTO data_port_scans
      (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json, instructions, created_at, status, progress_json, format, candidate_count)
      VALUES (${result.scanId}, ${sourceProfile}, ${result.detectedProfile}, ${result.rootPath}, '[]', ${JSON.stringify(result.stats)}, ${JSON.stringify(result.warnings)},
              ${instructions}, ${now}, ${result.status}, NULL, 2, 0)`)
  }

  function finishScan(scanId: string, result: Omit<ScanResult, 'candidates' | 'dirs'>, instructions: string | null, status: ScanStatus): void {
    const warnings = [...result.warnings]
    if (instructions) warnings.unshift({ code: 'instructions-applied', message: 'User instructions applied to ranking and default selection' })
    const count = countCandidates(deps.db, scanId, {})
    deps.db.run(sql`UPDATE data_port_scans SET status = ${status}, detected_profile = ${result.detectedProfile}, stats_json = ${JSON.stringify(result.stats)},
      warnings_json = ${JSON.stringify(warnings)}, scan_ms = ${result.stats.scanMs}, finished_at = ${new Date().toISOString()}, candidate_count = ${count},
      counts_json = ${JSON.stringify(candidateCounts(deps.db, scanId, {}))}, progress_json = NULL WHERE id = ${scanId}`)
    pruneScans(deps.db)
  }

  /**
   * Drives the generator in the background: SCAN_FLUSH_ROWS rows per
   * `BEGIN IMMEDIATE`, a `setImmediate` between flushes, progress on the row.
   * Instruction hints are applied per flushed batch (they only ever promote).
   */
  async function driveScan(scanId: string, gen: Generator<ScanEvent>, sourceProfile: SourceProfile, instructions: string | null, rootPath: string): Promise<void> {
    const state = { cancelled: false }
    running.set(scanId, state)
    const started = Date.now()
    let seq = 0, rows: ScanCandidate[] = [], dirs: ScanDirRow[] = [], bytes = 0
    /** Rows not yet flushed, by id — a patch for one of them is applied in memory, a patch for a flushed row by UPDATE. */
    const pending = new Map<string, ScanCandidate>()
    const flush = () => {
      if (rows.length) { seq = insertCandidates(deps.db, scanId, applyInstructionHints(rows, instructions), seq); rows = []; pending.clear() }
      if (dirs.length) { insertDirs(deps.db, scanId, dirs); dirs = [] }
    }
    // JSON1 (built into bun:sqlite and better-sqlite3): append one path to `paths_json`, seeding it with the row's own path.
    const patchPath = (id: string, path: string) => {
      const row = pending.get(id)
      if (row) { addPathTo(row, path); return }
      deps.db.run(sql`UPDATE data_port_candidates SET paths_json = json_insert(coalesce(paths_json, json_array(relative_path)), '$[#]', ${path}) WHERE scan_id = ${scanId} AND id = ${id}`)
    }
    const aliasDir = (realRel: string, aliasRel: string) => {
      if (realRel === '.') {
        deps.db.run(sql`UPDATE data_port_candidates SET paths_json = json_insert(coalesce(paths_json, json_array(relative_path)), '$[#]', ${aliasRel + '/'} || relative_path) WHERE scan_id = ${scanId}`)
        return
      }
      deps.db.run(sql`UPDATE data_port_candidates SET paths_json = json_insert(coalesce(paths_json, json_array(relative_path)), '$[#]', ${aliasRel} || substr(relative_path, ${realRel.length + 1}))
        WHERE scan_id = ${scanId} AND (relative_path = ${realRel} OR relative_path LIKE ${escapeLike(realRel) + '/%'} ESCAPE '\\')`)
    }
    try {
      for (const ev of gen) {
        if (state.cancelled) { flush(); deleteScanRows(deps.db, scanId); deps.db.run(sql`UPDATE data_port_scans SET status = 'cancelled', candidate_count = 0, finished_at = ${new Date().toISOString()} WHERE id = ${scanId}`); return }
        if (ev.type === 'candidate') { rows.push(ev.candidate); pending.set(ev.candidate.id, ev.candidate); bytes += ev.candidate.bytes; if (rows.length >= SCAN_FLUSH_ROWS) flush() }
        else if (ev.type === 'candidate-patch') patchPath(ev.id, ev.addPath)
        else if (ev.type === 'dir-alias') { flush(); aliasDir(ev.realRel, ev.aliasRel) }
        else if (ev.type === 'dir') dirs.push(ev.row)
        else if (ev.type === 'progress') {
          flush()
          // The walker's own counters (files seen, folders visited) — never the row counter in their place.
          deps.db.run(sql`UPDATE data_port_scans SET progress_json = ${JSON.stringify({ dirsVisited: ev.dirsVisited, filesSeen: ev.filesSeen, candidates: ev.candidates, bytes, elapsedMs: Date.now() - started, currentDir: ev.currentDir })} WHERE id = ${scanId}`)
          await new Promise<void>((r) => setImmediate(r))
        } else { flush(); finishScan(scanId, ev.result, instructions, 'done') }
      }
    } catch (err) {
      flush()
      const message = err instanceof Error ? err.message : String(err)
      deps.logger?.warn?.({ scanId, err: message }, 'data-port: scan failed — everything mapped so far stays listed')
      const warnings: ScanWarning[] = [{ code: 'scan-failed', params: { detail: message }, message: `The scan stopped with an error: ${message}` }]
      deps.db.run(sql`UPDATE data_port_scans SET status = 'failed', warnings_json = ${JSON.stringify(warnings)}, finished_at = ${new Date().toISOString()}, candidate_count = ${countCandidates(deps.db, scanId, {})}, counts_json = ${JSON.stringify(candidateCounts(deps.db, scanId, {}))} WHERE id = ${scanId}`)
    } finally {
      running.delete(scanId)
    }
  }

  function rowToSummary(row: any): ScanSummary {
    const stats = JSON.parse(row.stats_json || '{}')
    const counts = row.counts_json ? JSON.parse(row.counts_json) : candidateCounts(deps.db, row.id, {})
    const dirsMapped = Number((deps.db.all(sql`SELECT count(*) AS n FROM data_port_scan_dirs WHERE scan_id = ${row.id}`) as any[])[0]?.n ?? 0)
    // A pre-R11 warning list is string[]; the card prints a string element verbatim.
    const warnings = (JSON.parse(row.warnings_json || '[]') as Array<ScanWarning | string>).map((w) => (typeof w === 'string' ? { code: 'legacy' as const, params: { message: w }, message: w } : w))
    return {
      scanId: row.id, status: row.status ?? 'done', sourceProfile: row.source_profile, detectedProfile: row.detected_profile, rootPath: row.root_path,
      instructions: row.instructions ?? null, stats: { ...stats, candidateCount: row.candidate_count ?? 0, directoriesMapped: dirsMapped, scanMs: row.scan_ms ?? stats.scanMs ?? 0 },
      progress: row.progress_json ? JSON.parse(row.progress_json) : null, counts, warnings,
    }
  }
```

`scanPath(profile, path, instructions)`: validates **eagerly** — `const root = resolve(path); if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(...)` (route → 400; a generator body does not run until `next()`, so the generator's own checks would only surface as a `failed` scan after a 202) — then `const scanId = generateId()`, `insertScanHeader({ scanId, status: 'running', … })`, and starts the drive on the **next tick**: `setImmediate(() => void driveScan(scanId, scanDirectoryEvents({ rootPath: root, sourceProfile: profile }), profile, instructions, root))` — so the returned `rowToSummary(...)` is `status: 'running'` for every tree size (a 38-file tree must not finish inside the request). `scanDirectoryEvents` takes the id: `opts.scanId` is used for `result.scanId` instead of a fresh `generateId()` (Task 7: `scanId: opts.scanId ?? generateId()`). `scanUpload` keeps `if (file.buffer.byteLength > UPLOAD_BODY_BYTES) throw …`, collects with `await scanDirectory({ …, followSymlinks: false })`, inserts header + rows + dirs, `finishScan(..., 'done')`, returns the summary. `getScan(id)` → `rowToSummary` or null. `cancelScan(id)`: when the scan is running here, sets `running.get(id).cancelled = true` and returns `true` (the drive purges its rows at the next event); otherwise — `done`, `failed`, or a scan another process drove — it purges directly (`deleteScanRows`, `UPDATE … SET status = 'cancelled', candidate_count = 0, counts_json = NULL, progress_json = NULL, finished_at = now`) and returns `false`; either way the documented purge holds for every state. `listCandidates` / `countCandidates` / `candidateCounts` / `listDirs` delegate to the store. `selectionCount(scanId, wire, filter, folders)`: `const sel = compileSelection(normaliseSelection(wire))`; iterate `iterateCandidates(db, scanId, { ...filter, importable: true }, 5000)`; count `selected`, `byKind`, and `byFolder` for each requested folder (`row.folder === f || row.folder.startsWith(f + '/')`), never materialising ids; one in-flight per scan (newest wins — keep a `Map<scanId, Promise>` and let a later call supersede). `preview(scanId, candidateId, bytes)`: row from `getCandidate` (404 when null); directory row → `children: readdirSync(row.sourcePath).slice(0, 50)`; binary/derived/app-state → `{ encoding: 'binary' }`; else open the fd, read `min(bytes, 1 MiB)`, cut back to the last complete UTF-8 sequence, `truncated = size > read`, `frontmatter: splitFrontmatter(head).data` when it had one; `candidate: toPublicCandidate(row)`.

`createJob(input)`: `getScan` → throw `'Scan not found or expired'` when null or `candidateCount === 0`; throw `'Scan is still running'` (route → 409) when `status === 'running'`; `const wire = normaliseSelection(input.selection)`; `const sel = compileSelection(wire)` (RangeError → 400); `selectionTotal` = one streaming pass over `iterateCandidates(db, scanId, { importable: true }, 5000)` counting `sel.resolve(row)`; throw `'No items selected'` at 0; INSERT with `selection_mode = Array.isArray(input.selection) ? 'ids' : 'wire'`, `selection_json = JSON.stringify(wire)`, `selection_total`, `cursor_seq = -1`; then `enqueue(id)` (Task 12; until then `void runJob(id)`). `rowToJob` maps the new columns.

`migrateLegacyScans()`: `SELECT id, candidates_json FROM data_port_scans WHERE format = 1 AND candidates_json <> '[]'`; per row `JSON.parse` → `insertCandidates(db, id, rows, 0)` + `insertDirs` from the distinct `folderOf` values (no skipped classes) → `UPDATE … SET format = 2, candidates_json = '[]', candidate_count = ?, counts_json = ?`; a parse failure → `status = 'failed'`, warnings `[{ code: 'legacy', params: { message }, message: 'stored candidate list could not be read — re-scan' }]`, `format = 2, candidates_json = '[]'`. Returns `{ migrated, failed }`. `index.ts` calls it after the interrupted-jobs sweep and logs the counts.

- [ ] **Step 4: Routes**

```ts
// src/modules/data-port/routes.ts — schemas and new routes
import { CANDIDATE_KINDS, CANDIDATE_TARGETS } from './types.js'
import { CANDIDATE_PAGE_DEFAULT, CANDIDATE_PAGE_MAX, SELECTION_MAX_GROUPS, SELECTION_MAX_ROWS } from './constants.js'

const reasonToken = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,63}$/)
const csv = (schema: z.ZodTypeAny) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v), z.array(schema).max(50).optional())
const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional())
const candidateFilterQuery = z.object({
  kind: csv(z.enum(CANDIDATE_KINDS)), reason: csv(reasonToken), folder: z.string().max(1024).optional(), subtree: bool, selected: bool,
  q: z.string().max(200).optional(), tag: csv(z.string().max(64)), excludeKinds: csv(z.enum(CANDIDATE_KINDS)), excludeReasons: csv(reasonToken),
  excludeFolders: csv(z.string().max(1024)),
})
const pageQuery = candidateFilterQuery.extend({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(CANDIDATE_PAGE_MAX).default(CANDIDATE_PAGE_DEFAULT),
  order: z.enum(['path', 'seq']).default('path'),
})
const selectionWireSchema = z.object({
  base: z.enum(['default', 'all', 'none']),
  groups: z.array(z.object({ kind: z.enum(CANDIDATE_KINDS).optional(), folder: z.string().max(1024).optional(), selected: z.boolean() })).max(SELECTION_MAX_GROUPS),
  rows: z.array(z.object({ candidateId: z.string().min(1), selected: z.boolean().optional(), target: z.enum(CANDIDATE_TARGETS).optional() })).max(SELECTION_MAX_ROWS),
})
const legacySelectionSchema = z.array(z.object({ candidateId: z.string().min(1), target: z.enum(CANDIDATE_TARGETS).optional() })).min(1)
const createJobSchema = z.object({ scanId: z.string().min(1), sourceProfile: sourceProfileSchema, instructions: instructionsSchema, enrich: z.boolean().optional().default(false), selection: z.union([selectionWireSchema, legacySelectionSchema]) })

  app.post('/api/v1/data-port/import/scan', requirePermission('create', 'DataPort'), async (c) => {
    // … parse as before …
    try { return c.json(service.scanPath(...), 202) } catch (err) { return c.json({ error: msg(err) }, 400) }
  })
  app.get('/api/v1/data-port/import/scans/:id', requirePermission('read', 'DataPort'), (c) => {
    const s = service.getScan(c.req.param('id')); return s ? c.json(s) : c.json({ error: 'Scan not found' }, 404)
  })
  app.delete('/api/v1/data-port/import/scans/:id', requirePermission('create', 'DataPort'), (c) => {
    const id = c.req.param('id'); if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
    // Running → cooperative cancel (the drive purges); any other state → purged right here. `ok` is true in both cases.
    const cancelling = service.cancelScan(id); return c.json({ ok: true, cancelling })
  })
  app.get('/api/v1/data-port/import/scans/:id/tree', requirePermission('read', 'DataPort'), (c) => {
    const id = c.req.param('id'); if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
    const parsed = candidateFilterQuery.extend({ parent: z.string().max(1024).default('.') }).safeParse(c.req.query())
    if (!parsed.success) return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
    const { parent, ...filter } = parsed.data
    return c.json({ parent, dirs: service.listDirs(id, parent, filter), files: service.candidateCounts(id, { ...filter, folder: parent, subtree: false }) })
  })
  app.get('/api/v1/data-port/import/scans/:id/candidates', requirePermission('read', 'DataPort'), (c) => {
    const id = c.req.param('id'); if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
    const parsed = pageQuery.safeParse(c.req.query()); if (!parsed.success) return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
    const { offset, limit, order, ...filter } = parsed.data
    return c.json({ ...service.listCandidates(id, filter, { offset, limit, order }), offset, limit })
  })
  app.get('/api/v1/data-port/import/scans/:id/counts', requirePermission('read', 'DataPort'), (c) => {
    const id = c.req.param('id'); if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
    const parsed = candidateFilterQuery.safeParse(c.req.query()); if (!parsed.success) return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
    return c.json(service.candidateCounts(id, parsed.data))
  })
  app.post('/api/v1/data-port/import/scans/:id/selection/count', requirePermission('read', 'DataPort'), async (c) => {
    const id = c.req.param('id'); if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
    const parsed = z.object({ selection: z.union([selectionWireSchema, legacySelectionSchema]), filter: candidateFilterQuery.optional(), folders: z.array(z.string().max(1024)).max(500).optional() }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Invalid selection', details: parsed.error.issues }, 400)
    try { return c.json(await service.selectionCount(id, parsed.data.selection, parsed.data.filter, parsed.data.folders)) } catch (err) { return c.json({ error: msg(err) }, err instanceof RangeError ? 400 : 500) }
  })
  app.get('/api/v1/data-port/import/scans/:id/candidates/:cid/preview', requirePermission('create', 'DataPort'), (c) => {
    const bytes = z.coerce.number().int().min(1024).max(1024 * 1024).default(65_536).parse(c.req.query('bytes') ?? undefined)
    const p = service.preview(c.req.param('id'), c.req.param('cid'), bytes)
    return p ? c.json(p) : c.json({ error: 'Candidate not found' }, 404)
  })
  // POST /import/jobs: 409 when the message is 'Scan is still running', 400 otherwise.
```

- [ ] **Step 5: Run** — `bun vitest run tests/modules/data-port/candidates-routes.test.ts tests/modules/data-port/preview.test.ts tests/modules/data-port/legacy-scan-migration.test.ts tests/modules/data-port/scan-and-apply.test.ts tests/modules/data-port/proposals-service.test.ts` → PASS except the job-run halves marked `it.todo`.

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 11: Apply pipeline — provenance on every item, digests for every kind, tags, legacy-tolerant idempotency, raw rollback reader, no embedding on import (R11.4, R11.5, R11.6, R11.8)

**Files:**
- Modify: `src/modules/data-port/pipeline/{transform,apply}.ts`, `src/modules/data-port/apply-deps.ts`, `src/modules/data-port/rollback.ts`, `src/modules/data-port/rollback-deps.ts`, `src/modules/memory/tiers/episodic-memory.ts`, `src/modules/memory/types.ts`
- Modify: `tests/modules/data-port/{transform,apply-memory,apply-deps,skill-package,persona,proposals,rollback}.test.ts`, `tests/modules/memory/episodic-memory.test.ts` (or the nearest tier test)

**Interfaces:**
- `transform.ts`: `NormalizeOptions.{adapterId?, tags?, containsSecrets?}`; `normalizeMemory` writes `source.adapter`, pushes `opts.tags` and `SECRETS_TAG`; `RESERVED_TAGS` += `legacy`, `third-party` (a source may not forge provenance) — `contains-secrets` deliberately NOT reserved (a source may only hide itself); `enrichMemory` filters `SECRETS_TAG` out of model tags.
- `apply.ts`: `contentSha(text)` (no trim; `noteBodySha` becomes an alias of it for rollback), `baseTags(sourceProfile, jobId, adapterId)` → `source:<adapterId ?? profile>` + `source-profile:<profile>` when they differ; every apply function takes `adapterId?`; `ApplyResult.applied` gains `sha256` for every kind + `assetsSha256` for skills; `unchanged` gains `importJobId` **and `sha256`** (the digest the hit was matched on — the verbatim one when it matched, else the legacy one — so an adopted row (Task 12) is never recorded without a digest, R11.6) and, for skills, `assetsSha256`; `proposal` gains `sha256`; vault identity compare `legacyBody(read) === legacyBody(body)`; episodic lookup `findImported(sha) ?? findImported(contentSha(legacyBody(body)))`, create with `embed: false`; skill lookup verbatim digest then `assembleSkillContentLegacy` digest; skill capabilities += `SECRETS_TAG` when `t.containsSecrets`; persona tags += `SECRETS_TAG` when input says so, returns `sha256: contentSha(p.systemPrompt)`; proposal pending compare via `legacyBody` on both sides, returns `sha256: contentSha(proposed)`, title gains ` [contains-secrets]` when flagged.
- `apply-deps.ts`: `findImported` ledger-first (`findLedgerRefBySha(db, 'episodic', sha)` + row-exists check) returning `{ id, sourceId }`; the `tags LIKE '%"sha:…"%'` fallback runs **only when legacy episodic rows exist** — decided once per `buildApplyDeps()` call (= once per job), never per item; `findByContentSha`/`findByName` return `capabilities`; `agents.get` returns `tags`; `findPendingProposal({ agentId, workspaceFile, proposedBody })` compares `legacyBody`; `vault.read` returns `{ content, frontmatter: { tags? } }`.
- `episodic-memory.ts` / `memory/types.ts`: `CreateEpisodicInput.embed?: boolean` (default true); `create` fires `onCreated` only when `embed !== false`.
- `rollback.ts` / `rollback-deps.ts`: `RollbackDeps.vault.readRaw?(path): string | null`; `vaultNoteEdited` compares `contentSha(rawBody)`, `contentSha(rawBody without one trailing \n)`, `contentSha(legacyBody(rawBody))` **and `contentSha(rawBody.trim())`** (the pre-amendment vault digest was `sha256(body.trim())`, which differs from `legacyBody` for a body whose first line starts with whitespace) against the record.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/apply-memory.test.ts — additions (vault)
  it('writes a body with leading and trailing blank lines byte for byte and returns its verbatim digest', async () => {
    const body = '\n\nBody.\n\n\n'
    const r = await applyMemoryItem(deps, { jobId: 'j', sourceProfile: 'claude-code', adapterId: 'grok-cli', target: 'vault.semantic', transformed: transformed({ body, tags: ['legacy'] }), relativePath: 'x.md' })
    expect(r).toMatchObject({ status: 'applied', sha256: sha256(body) })
    expect(written[0].content).toBe(body)
    expect(written[0].fm.tags).toEqual(expect.arrayContaining(['source:grok-cli', 'source-profile:claude-code', 'legacy']))
    expect(written[0].fm.source.adapter).toBe('grok-cli')
  })
  it('recognises a note an earlier import wrote trimmed as unchanged and names its job', async () => {
    vaultFiles.set('semantic/x.md', { content: 'Body.', frontmatter: { tags: ['import-job:old'] } })
    const r = await applyMemoryItem(deps, { jobId: 'j', sourceProfile: 'obsidian', target: 'vault.semantic', transformed: transformed({ body: '\n\nBody.\n\n\n' }), relativePath: 'x.md' })
    expect(r).toMatchObject({ status: 'unchanged', ref: 'semantic/x.md', importJobId: 'old' })
  })
  it('tags contains-secrets on the vault note and the episodic row', async () => {
    const v = await applyMemoryItem(deps, { jobId: 'j', sourceProfile: 'obsidian', target: 'vault.semantic', transformed: transformed({ body: 'k', tags: ['contains-secrets'] }), relativePath: 'k.md' })
    expect(written.at(-1)!.fm.tags).toContain('contains-secrets')
    await applyMemoryItem(deps, { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: transformed({ body: 'k2', tags: ['contains-secrets'] }) })
    expect(episodicCalls.at(-1)!.tags).toContain('contains-secrets')
    expect(episodicCalls.at(-1)!.embed).toBe(false)
  })
  // episodic
  it('falls back to the legacy trimmed digest and tags the verbatim one on a new row', async () => {
    const legacySha = sha256('Body.'); const verbatim = sha256('\nBody.\n')
    findImported.mockImplementation((s: string) => (s === legacySha ? { id: 'e1', sourceId: 'import:old' } : null))
    expect(await applyMemoryItem(deps, { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: transformed({ body: '\nBody.\n' }) })).toMatchObject({ status: 'unchanged', ref: 'e1', importJobId: 'old' })
    findImported.mockReturnValue(null)
    const r = await applyMemoryItem(deps, { jobId: 'j', sourceProfile: 'obsidian', target: 'episodic', transformed: transformed({ body: '\nBody.\n' }), kindTag: 'transcript', part: { n: 1, of: 2 } })
    expect(r).toMatchObject({ status: 'applied', sha256: verbatim })
    expect(episodicCalls.at(-1)!.tags).toEqual(expect.arrayContaining([`sha:${verbatim}`, 'transcript', 'session-part:1/2']))
  })
```

`transform.test.ts`: `source.adapter === 'grok-cli'` when `adapterId` given, else the profile; `tags: ['legacy']` reaches `out.tags`; a source note declaring `tags: [legacy]` has it stripped into `strippedTags`; `containsSecrets: true` → `contains-secrets` in tags; a source-declared `contains-secrets` survives; `isReservedTag('contains-secrets') === false`; `enrichMemory` never adds `contains-secrets` from a model answer.
`skill-package.test.ts` (apply side): a package imported before the amendment (mock `findByContentSha` answering only the legacy digest) → `unchanged`; `applySkillItem` with `transformed.containsSecrets: true` → capabilities contain `contains-secrets`, assets written including the flagged one, content contains its body verbatim; the result carries `sha256` and `assetsSha256`; `source:<adapterId>` wins over the profile.
`persona.test.ts`: `applyPersonaItem({ …, containsSecrets: true })` → `agents.create` tags contain `contains-secrets`; result has `sha256`.
`proposals.test.ts`: returns `sha256`; a pending card written trimmed before the amendment dedups; a flagged rule's title ends with ` [contains-secrets]`.
`apply-deps.test.ts`: `findImported` answers from the ledger first (one `data_port_applied` row kind `episodic` + the episodic row without a `sha:` tag → found; episodic row deleted → null; legacy `sha:` tag without a ledger row → found via LIKE); **the LIKE fallback is gated**: with every import-sourced episodic row covered by a digest-bearing ledger row, a `db.all` spy sees no query containing `tags LIKE` across 50 `findImported` misses; with one legacy row (import-sourced, no ledger row) the LIKE runs; `findByContentSha` returns `capabilities`; `findPendingProposal` tolerant compare.
`rollback.test.ts`: rewrite the three edited-note cases against `readRaw`; add 'tolerates the writer's appended newline', 'still recognises a digest recorded before the amendment' (recorded `sha256(legacyBody(body))`) and 'still recognises the pre-amendment trimmed digest of an indented body' (body `'  two spaces first\nline\n'`, recorded `sha256(body.trim())` → not edited, rollback removes the note).
Episodic tier test: `create({ …, embed: false })` does not fire `onCreated`; the default does.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/transform.test.ts tests/modules/data-port/apply-memory.test.ts tests/modules/data-port/apply-deps.test.ts tests/modules/data-port/rollback.test.ts tests/modules/data-port/persona.test.ts tests/modules/data-port/proposals.test.ts` → FAIL.

- [ ] **Step 3: `transform.ts`**

```ts
import { SECRETS_TAG } from '@modules/memory/memory-index.js'

export interface NormalizeOptions {
  // … existing …
  /** The adapter that read the file — provenance (R11.6); defaults to the job profile. */
  adapterId?: SourceProfile
  /** Adapter/classifier tags the item keeps: `legacy`, `third-party`, `claude-project:<slug>`, `subagent` … */
  tags?: string[]
  /** The scanner flagged a credential: the note is tagged so recall hides it (R11.4). */
  containsSecrets?: boolean
}
// in normalizeMemory, after `if (opts.sourceChanged) tags.push('source-changed')`:
  for (const t of opts.tags ?? []) tags.push(t)
  if (opts.containsSecrets) tags.push(SECRETS_TAG)
// in `source`: `adapter: opts.adapterId ?? opts.sourceProfile,` after `profile`.
// RESERVED_TAGS: add 'legacy', 'third-party'. NOT 'contains-secrets' — see the comment:
//   A source file that declares `contains-secrets` can only HIDE itself from recall, never expose anything, and an Obsidian
//   note hand-tagged that way must keep working; so it is the one importer-read tag a source may declare.
// enrichMemory: `.filter((t) => !isReservedTag(t) && t !== SECRETS_TAG)` on model tags.
```

- [ ] **Step 4: `apply.ts`**

```ts
import { SECRETS_TAG } from '@modules/memory/memory-index.js'
import { legacyBody } from '../source-frontmatter.js'
import { assembleSkillContent, assembleSkillContentLegacy, sortAssetsByPath } from '../skill-package.js'

export type ApplyResult =
  | { status: 'applied'; kind: string; ref: string; assetsDir?: string; sha256: string; assetsSha256?: string }
  /** `sha256`: the digest the hit was matched on — the runner records it when it adopts the row (R11.6: a digest for every ledger row). */
  | { status: 'unchanged'; ref: string; assetsDir?: string; reasonCode?: ReasonCode; importJobId?: string | null; sha256: string; assetsSha256?: string }
  | { status: 'proposal'; proposalId: string; workspaceFile: string; sha256: string }
  | { status: 'skipped'; reason: string; reasonCode?: ReasonCode }
  | { status: 'error'; error: string; reasonCode?: ReasonCode }

/** sha256 over the text exactly as written — no trim (R11.5). */
export function contentSha(text: string): string { return createHash('sha256').update(text).digest('hex') }
/** @deprecated alias kept for rollback callers; identical to contentSha. */
export const noteBodySha = contentSha

function baseTags(sourceProfile: SourceProfile, jobId: string, adapterId?: SourceProfile | null): string[] {
  const adapter = adapterId ?? sourceProfile
  return [
    IMPORT_TAGS.imported, `${IMPORT_TAGS.sourcePrefix}${adapter}`, `${IMPORT_TAGS.jobPrefix}${jobId}`,
    ...(adapter !== sourceProfile ? [`source-profile:${sourceProfile}`] : []),
  ]
}
const jobOf = (tags: readonly string[] | undefined): string | null => {
  const hit = (tags ?? []).find((t) => t.startsWith(IMPORT_TAGS.jobPrefix)); return hit ? hit.slice(IMPORT_TAGS.jobPrefix.length) : null
}

// applyMemoryItem input gains: adapterId?, kindTag?: string | null, part?: { n: number; of: number } | null
//   tags: [...baseTags(input.sourceProfile, input.jobId, input.adapterId), ...t.tags, index?, session:<id>?, kindTag?, `session-part:${n}/${of}`?]
//   episodic:
      const sha = contentSha(t.body)
      const already = deps.episodic.findImported?.(sha) ?? deps.episodic.findImported?.(contentSha(legacyBody(t.body)))
      if (already) return { status: 'unchanged', ref: already.id, importJobId: already.sourceId?.startsWith('import:') ? already.sourceId.slice(7) : null, sha256: sha }
      const mem = deps.episodic.create({ content: t.body, sourceType: 'system', sourceId: `import:${input.jobId}`, tags: [...tags, `sha:${sha}`], ...(input.sessionDate ? { validFrom: input.sessionDate } : {}), embed: false })
      return { status: 'applied', kind: 'episodic', ref: mem.id, sha256: sha }
//   vault collision probe:
        (candidate) => {
          if (!vault.exists(candidate)) return { taken: false }
          const read = vault.read?.(candidate)
          const same = read !== undefined && read !== null && legacyBody(read.content) === legacyBody(body)
          return same ? { taken: true, hit: { path: candidate, jobId: jobOf(read.frontmatter?.tags) } } : { taken: true }
        }
      if (walk.hit) return { status: 'unchanged', ref: walk.hit.path, importJobId: walk.hit.jobId, sha256: contentSha(body) }
//   vault write unchanged (body verbatim); return { status: 'applied', kind: `vault.${tier}`, ref: path, sha256: contentSha(body) }

// applySkillItem input gains adapterId?; after `sorted`:
    const content = assembleSkillContent(t.content, sorted, assetsDir, notBundled)
    const sha = contentSha(content)
    const legacySha = contentSha(assembleSkillContentLegacy(t.content, sorted, assetsDir, notBundled))
    const prior = skills.findByContentSha?.(sha) ?? skills.findByContentSha?.(legacySha) ?? null
    const digest = packageDigest(t, sorted)
    if (prior) return { status: 'unchanged', ref: prior.id, importJobId: jobOf(prior.capabilities), sha256: sha, assetsSha256: digest, ...(assetsDir ? { assetsDir } : {}) }
    const existing = skills.findByName?.(t.name) ?? null
    if (existing && legacyBody(existing.content) === legacyBody(content)) return { status: 'unchanged', ref: existing.id, importJobId: jobOf(existing.capabilities), sha256: sha, assetsSha256: digest, ...(assetsDir ? { assetsDir } : {}) }
    // capabilities: [...declared, ...baseTags(profile, jobId, adapterId), `content-sha:${sha}`, ...(t.containsSecrets ? [SECRETS_TAG] : []), ...]
    return { status: 'applied', kind: 'skill', ref: skill.id, sha256: sha, assetsSha256: packageDigest(t, sorted), ...(assetsDir ? { assetsDir } : {}) }
// `packageDigest(t, sorted)` is the digest `assetDirName` already computes — export it and reuse it.
// stripReservedCapabilities: `contains-secrets` is NOT reserved (same reasoning as transform.ts) — one comment line.

// applyPersonaItem input gains adapterId?, containsSecrets?; tags += SECRETS_TAG when set; return { status: 'applied', kind: 'agent', ref: created.id, sha256: contentSha(p.systemPrompt) };
//   unchanged carries importJobId: jobOf(agents.get(candidate)?.tags) and sha256: contentSha(p.systemPrompt).

// applyWorkspaceProposal input gains containsSecrets?; title += ' [contains-secrets]' when set; frontmatterYaml used as captured (no .trim());
//   duplicate = deps.findPendingProposal?.({ agentId, workspaceFile: file, proposedBody: proposed }) → { status: 'unchanged', ref: duplicate.id, reasonCode: 'unchanged', importJobId: duplicate.jobId, sha256: contentSha(proposed) }
//   return { status: 'proposal', proposalId, workspaceFile: file, sha256: contentSha(proposed) }
// Counting convention (the runner, Task 12, and every test follow it): a re-run reports a still-pending proposal as `unchanged`
// (it is neither re-created nor counted under `proposals`), so a second identical run shows `unchanged = applied + proposals` of the first.
```

- [ ] **Step 5: `apply-deps.ts`, episodic tier, rollback**

```ts
// apply-deps.ts
import { findLedgerRefBySha } from './ledger.js'
          // Decided ONCE per buildApplyDeps() call (= once per job): are there import-sourced episodic rows the ledger
          // does not cover with a digest? Only then is the tag LIKE scan ever run — otherwise every new row would pay
          // a full-table scan (O(N²) over a 17 000-transcript import at the amendment's 10× target).
          hasLegacyEpisodic: lazy(() => (host.db.all(sql`SELECT 1 FROM episodic_memories e WHERE e.source_id LIKE 'import:%'
              AND NOT EXISTS (SELECT 1 FROM data_port_applied a WHERE a.kind = 'episodic' AND a.ref = e.id AND a.sha256 IS NOT NULL) LIMIT 1`) as unknown[]).length > 0),
          findImported: (sha) => {
            const ref = findLedgerRefBySha(host.db, 'episodic', sha)
            if (ref) {
              const row = (host.db.all(sql`SELECT id, source_id FROM episodic_memories WHERE id = ${ref} LIMIT 1`) as Array<{ id: string; source_id: string | null }>)[0]
              if (row) return { id: row.id, sourceId: row.source_id ?? null }
            }
            if (!episodicDeps.hasLegacyEpisodic()) return null
            // Rows written before the ledger carried a digest: the tag scan, only while such rows exist.
            return (host.db.all(sql`SELECT id, source_id FROM episodic_memories WHERE source_id LIKE 'import:%' AND tags LIKE ${`%"sha:${sha}"%`} LIMIT 1`) as any[])
              .map((r) => ({ id: r.id, sourceId: r.source_id ?? null }))[0] ?? null
          },
          // `lazy(fn)` memoises fn's first answer for the life of these deps; `episodicDeps` is the object literal these members live on.
          create: (input) => memory.episodic!.create({ ...input, embed: false }),
// skills.findByContentSha / findByName: SELECT id, content, capabilities … → parse capabilities JSON.
// agents.get: pass `tags` through.
// findPendingProposal({ agentId, workspaceFile, proposedBody }): rows WHERE status='pending' …; return the first whose legacyBody(proposed_body) === legacyBody(proposedBody) as { id, jobId: row.job_id }.
// vault.read: (path) => memory.vault!.read(path) — the real service already returns { content, frontmatter }.

// memory/types.ts: CreateEpisodicInput gains `/** Default true. The importer passes false: no model call in the import path. */ embed?: boolean`
// episodic-memory.ts create(): `if (input.embed !== false) { try { hooks.onCreated?.(memory) } catch {} }`

// rollback-deps.ts: vault.readRaw = (path) => { try { return readFileSync(join(dataDir, 'vault', path), 'utf-8') } catch { return null } }
// rollback.ts vaultNoteEdited:
    const raw = deps.vault?.readRaw?.(posixPath)
    if (typeof raw === 'string') {
      const rest = splitFrontmatter(raw).body
      // verbatim · without the writer's newline · pre-R11 legacyBody · pre-R11 vault digest (sha256(body.trim()), apply.ts:264 before the amendment)
      const candidates = [rest, rest.replace(/\n$/, ''), legacyBody(rest), rest.trim()]
      return !candidates.some((c) => contentSha(c) === recorded)
    }
    // … existing parsed-content fallback
```

- [ ] **Step 6: Run** — `bun vitest run tests/modules/data-port tests/modules/memory` → PASS except the runner tests that Task 12 owns (`scan-and-apply` end-to-end ledger assertions on `adapter`/`sha256` for every kind land in Task 12, which passes the new fields through `record()`).

- [ ] **Step 7: Review** — `git status --short`.

---

### Task 13: Recall exclusion of `contains-secrets` — related work, search, tool, HTTP, episodic list preview, reflection, consolidator, skill matcher (D-7, P-19, R11.7 recall guard)

**Files:**
- Create: `src/modules/skills/recallable.ts`
- Modify: `src/modules/memory/related-work.ts`, `src/modules/memory/memory-service.ts`, `src/modules/memory/index.ts`, `src/modules/memory/routes.ts`, `src/modules/memory/reflection-job.ts`, `src/modules/memory/consolidator/index.ts`, `src/modules/memory/consolidator/semantic-promoter.ts`, `src/modules/tools/builtin/memory-tools.ts`, `src/modules/conversations/routes.ts`, `src/modules/conversations/skill-gate.ts`, `src/modules/skills/routes.ts`, `src/web/src/pages/memory/memory-dashboard.tsx`
- Modify: `tests/modules/memory/related-work.test.ts`, `tests/modules/memory/search-scope.test.ts`, `tests/modules/memory/memory-index-wiring.test.ts`, `tests/modules/memory/related-work-wiring.test.ts`, `tests/modules/memory/reflection-job.test.ts` (or the nearest reflection test), `tests/modules/memory/consolidator.test.ts` (or the nearest consolidator test), `tests/contracts/tool-service/memory-tools.contract.test.ts`, the memory routes test, `tests/modules/skills/skill-match-secrets.test.ts` (create), `tests/modules/conversations/skill-gate.test.ts` (one case)

**Interfaces:**
- `RelatedWorkOptions.includeSecrets`; `ftsVault`/`ftsEpisodic` select `tags`; both hit lists filtered by `hasSecretsTag` unless included.
- **Every model-facing consumer** (P-19): the reflection job filters `recentMemories` with `hasSecretsTag`; the consolidator's Phase 2 drops flagged episodic rows before clustering (they are neither summarised nor invalidated) and, when the flag is on and a promoted cluster held a flagged member, the promoter writes the note with `contains-secrets` in its tags; the skill matcher never sees a skill whose `capabilities` include `contains-secrets` (both call sites: `src/modules/conversations/routes.ts` skill gate and `POST /skills/match`) unless the flag is on, and `SkillMatchSummary` gains `containsSecrets: boolean` so the proposal card can say so.
- `MemoryServiceDeps.recall?: () => { includeSecrets: boolean }`; `MemorySearchOptions.includeSecrets?`; `search()` filters episodic/archive/vault FTS hits and vault vector hits; an episodic hit longer than 4 000 chars is returned as a ±1 500-char excerpt around the first match with `metadata.truncated = true` and `metadata.contentLength`.
- `memory/index.ts`: passes `recall`, `includeSecrets: opts?.includeSecrets ?? recallIncludesSecrets(ctx.config)` to `memoryIndex` and `relatedWork`.
- `search_memory`: description names the exclusion; input schema gains **no** `includeSecrets`; execute never forwards one.
- `GET /api/v1/memory/search?includeSecrets=true` → explicit owner override; `GET /api/v1/memory/episodic` returns `preview` (400 chars) + `contentLength` instead of `content`; the dashboard renders both (`memory.episodic.chars`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/memory/related-work.test.ts — append
describe('contains-secrets (D-7)', () => {
  it('leaves tagged vault and episodic hits out by default and shows them on request', () => {
    const db = seedScene()
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, file_hash, indexed_at) VALUES ('semantic/alpha-key.md', 'k', 'semantic', '["contains-secrets"]', ${MNB_BODY}, 'h', '2026-01-01')`)
    db.run(sql`INSERT INTO episodic_memories (id, content, source_type, salience, access_count, valid_from, tags, created_at) VALUES ('ep-secret', ${MNB_BODY}, 'system', 1, 0, '2026-01-01', '["contains-secrets"]', '2026-01-01')`)
    const hidden = buildRelatedWork(db, { query: MNB_QUERY, conversationId: 'c1', projectTypeId: null })!
    expect(hidden.ids).not.toContain('vt:semantic/alpha-key.md'); expect(hidden.ids).not.toContain('ep:ep-secret')
    const shown = buildRelatedWork(db, { query: MNB_QUERY, conversationId: 'c1', projectTypeId: null, includeSecrets: true })!
    expect(shown.ids).toEqual(expect.arrayContaining(['vt:semantic/alpha-key.md', 'ep:ep-secret']))
  })
})
```

```ts
// tests/modules/memory/search-scope.test.ts — append
describe('contains-secrets recall', () => {
  it('hides tagged rows from search unless the config or an explicit call says otherwise', async () => {
    vault.write('semantic/alpha-key.md', { title: 'k', tags: ['contains-secrets'], tier: 'semantic' }, 'zxq alpha credential body')
    indexer.indexAll()
    episodic.create({ content: 'zxq alpha credential row', sourceType: 'system', tags: ['contains-secrets'] })
    expect(await memory.search({ query: 'zxq alpha credential' })).toEqual([])
    expect((await memory.search({ query: 'zxq alpha credential', includeSecrets: true })).length).toBe(2)
    const open = createMemoryService({ ...depsOf(memory), recall: () => ({ includeSecrets: true }) })
    expect((await open.search({ query: 'zxq alpha credential' })).length).toBe(2)
    expect(await open.search({ query: 'zxq alpha credential', includeSecrets: false })).toEqual([])
  })
  it('excerpts an oversized episodic hit instead of returning the whole body', async () => {
    episodic.create({ content: `${'alpha '.repeat(30_000)} zxq-needle ${'bravo '.repeat(30_000)}`, sourceType: 'system' })
    const [hit] = await memory.search({ query: 'zxq-needle', tiers: ['episodic'] })
    expect(hit.content.length).toBeLessThan(3200); expect(hit.content).toContain('zxq-needle'); expect(hit.metadata.truncated).toBe(true)
  })
})
```

Contract test: `search_memory` input schema has no `includeSecrets` property; calling the tool with `{ query: 'x', includeSecrets: true }` forwards no `includeSecrets` key to `memory.search`. Wiring tests: with `{ memory: { recall: { includeSecrets: false } } }` the system prompt lacks a tagged note's line; with `true` it has it. Routes test: `/api/v1/memory/search?query=…` omits a tagged note; `&includeSecrets=true` returns it; `/api/v1/memory/episodic` items have `preview` and `contentLength` and no `content`; `/episodic/:id` still returns `content`.

```ts
// tests/modules/memory/reflection-job.test.ts — append (harness: the existing reflection test's ctx with a `complete` spy)
  it('never hands a contains-secrets episodic row to the reflection prompt', async () => {
    episodic.create({ content: 'zxq DB_PASSWORD=alphaalphaalpha0001', sourceType: 'system', tags: ['contains-secrets'] })
    episodic.create({ content: 'zxq plain row', sourceType: 'system' })
    await runReflection(ctx)
    const prompts = JSON.stringify(complete.mock.calls)
    expect(prompts).toContain('zxq plain row'); expect(prompts).not.toContain('alphaalphaalpha0001')
  })
```

```ts
// tests/modules/memory/consolidator.test.ts — append (harness: the existing consolidator test with a promoter spy)
  it('leaves a flagged episodic cluster out of semantic promotion and keeps its rows valid', async () => {
    for (let i = 0; i < 3; i++) episodic.create({ content: `zxq secret cluster ${i} TOKEN=alphabravocharlie0001`, sourceType: 'system', tags: ['contains-secrets'], validFrom: OLD })
    const promote = vi.fn(async () => ({ path: 'semantic/x.md' }))
    await createConsolidator({ ...deps, semanticPromoter: { promoteCluster: promote } }).run()
    expect(promote).not.toHaveBeenCalled()
    expect(episodic.list({ validOnly: true, limit: 10 }).filter((m) => m.tags.includes('contains-secrets'))).toHaveLength(3)
    expect(vault.list().some((p) => p === 'semantic/x.md')).toBe(false)
  })
  it('propagates the tag onto the promoted note when the owner opened recall', async () => {
    for (let i = 0; i < 3; i++) episodic.create({ content: `zxq open cluster ${i} TOKEN=alphabravocharlie0001`, sourceType: 'system', tags: ['contains-secrets'], validFrom: OLD })
    await createConsolidator({ ...deps, includeSecrets: true, semanticPromoter: createSemanticPromoter({ ...promoterDeps }) }).run()
    const written = vault.list().find((p) => p.startsWith('semantic/'))!
    expect(vault.read(written)!.frontmatter.tags).toContain('contains-secrets')
  })
```

```ts
// tests/modules/skills/skill-match-secrets.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// D-7 on the skill side: a skill whose asset held a credential (capability `contains-secrets`) is never proposed to a turn
// unless memory.recall.includeSecrets is on — one 'apply' click would put the inlined key into the system prompt otherwise.
import { describe, it, expect } from 'vitest'
import { recallableSkills } from '@modules/skills/recallable'
const flagged = { id: 's1', name: 'alpha deploy', capabilities: ['imported', 'contains-secrets'] } as any
const plain = { id: 's2', name: 'bravo deploy', capabilities: ['imported'] } as any
describe('recallableSkills', () => {
  it('drops a flagged skill by default and keeps it when the flag is on', () => {
    expect(recallableSkills([flagged, plain], false).map((s) => s.id)).toEqual(['s2'])
    expect(recallableSkills([flagged, plain], true).map((s) => s.id)).toEqual(['s1', 's2'])
  })
})
```

`skill-gate.test.ts`: `resolveSkillForTurn` with a `summary.containsSecrets: true` keeps the summary intact (the card renders the tag); the conversations route test (or the skill gate test's route case) asserts that with `includeSecrets` off a flagged enabled skill is never in the list handed to `matcher.match` (spy on `skillsService.matcher.match`, assert `calls[0][1].every((s) => !s.capabilities.includes('contains-secrets'))`), and `POST /skills/match` with a flagged skill returns no match for it by default and does with `{ memory: { recall: { includeSecrets: true } } }`.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/memory tests/contracts/tool-service/memory-tools.contract.test.ts` → FAIL.

- [ ] **Step 3: Write the code**

```ts
// related-work.ts
import { hasSecretsTag, resolveProjectTypeId, vaultNoteInScope } from './memory-index.js'
export interface RelatedWorkOptions { /* … */ includeSecrets?: boolean }
// ftsVault SELECT adds `vi.tags AS tags`; ftsEpisodic adds `em.tags AS tags`; row types gain `tags: string | null`.
  const includeSecrets = opts.includeSecrets === true
  const vaultHits = ftsVault(db, fts, fetchLimit)
    .filter((row) => vaultNoteInScope(row, { projectId, projectTypeId, scope: 'current' }))
    .filter((row) => includeSecrets || !hasSecretsTag(row.tags))
    // … unchanged
  const episodicHits = ftsEpisodic(db, fts, fetchLimit, projectId)
    .filter((row) => includeSecrets || !hasSecretsTag(row.tags))
    // … unchanged

// memory-service.ts
import { hasSecretsTag, SECRETS_TAG } from './memory-index.js'
interface MemoryServiceDeps { /* … */ recall?: () => { includeSecrets: boolean } }
export interface MemorySearchOptions extends MemorySearchQuery { agentId?: string; includeShared?: boolean; /** Explicit owner override; the model-facing tool never sets it. */ includeSecrets?: boolean }
const EXCERPT_CHARS = 3_000
function excerpt(content: string, query: string): { content: string; truncated: boolean } {
  if (content.length <= 4_000) return { content, truncated: false }
  const needle = query.split(/\s+/).find((t) => t.length > 2)?.toLowerCase() ?? ''
  const at = needle ? content.toLowerCase().indexOf(needle) : -1
  const start = at < 0 ? 0 : Math.max(0, at - 1_500)
  return { content: `${start > 0 ? '…' : ''}${content.slice(start, start + EXCERPT_CHARS)}…`, truncated: true }
}
// in search():
      const includeSecrets = query.includeSecrets ?? deps.recall?.().includeSecrets ?? false
      const recallable = (tags: string[]) => includeSecrets || !tags.includes(SECRETS_TAG)
      const episodicFtsRaw = (wantEpisodic ? ftsEpisodic(…) : []).filter((e) => recallable(e.tags))
      const archiveRaw = (wantArchive ? ftsArchive(…) : []).filter((a) => recallable(a.tags))
      const vaultFiltered = vaultFtsRaw.filter((v) => tiers.includes(v.tier as any)).filter(noteInScope).filter((v) => recallable(v.tags))
      // vector vault hits: run the `known`/vault_index lookup whenever `query.scope === 'current' || !includeSecrets`, SELECT tags too, drop a hit whose tags fail `recallable` (malformed → keep).
      // Episodic vector hits need no filter: hydration only emits ids present in contentMap, which the filtered FTS lists populate — comment this at the hydration loop.
      // episodic contentMap entries: const ex = excerpt(e.content, query.query); metadata: { …, ...(ex.truncated ? { truncated: true, contentLength: e.content.length } : {}) }, content: ex.content

// memory/index.ts: createMemoryService({ …, recall: () => ({ includeSecrets: recallIncludesSecrets(ctx.config) }) });
//   memoryIndex accessor passes includeSecrets: opts?.includeSecrets ?? recallIncludesSecrets(ctx.config); relatedWork passes includeSecrets: recallIncludesSecrets(ctx.config).
//   One-line comments at agent/conversation-runner.ts:463 and capture/index.ts:83: "no config → default false = the exclusion".

// memory-tools.ts: description += ' Notes tagged contains-secrets are left out unless memory.recall.includeSecrets is on.'; a comment above the service.search call: the exclusion is owned by config, never by tool input.

// reflection-job.ts (:70): the rows handed to ctx.model.complete are filtered first —
//   const includeSecrets = recallIncludesSecrets(ctx.config)
//   recentMemories = episodic.list({ limit: 40 }).filter((m: any) => includeSecrets || !hasSecretsTag(m.tags)).slice(0, 20).map((m: any) => String(m.content)).filter(Boolean)
//   (fetch 40, keep 20: a burst of freshly imported flagged transcripts must not empty the prompt).

// consolidator/index.ts Phase 2 (:126-135): `ConsolidatorDeps.includeSecrets?: boolean` (memory/index.ts passes recallIncludesSecrets(ctx.config));
//   const episodic = deps.memory.episodic.list({ validOnly: true, limit: 10_000 }).filter((m) => deps.includeSecrets || !hasSecretsTag(m.tags))
//   — a flagged row is neither clustered, summarised by the promoter, nor invalidated; it stays a valid episodic row and stays hidden.
// consolidator/semantic-promoter.ts (:132): tags: ['auto-consolidated', 'semantic', ...(members.some((m) => hasSecretsTag(m.tags)) ? [SECRETS_TAG] : [])]
//   — reachable only with includeSecrets on; the LLM summary of a flagged cluster is itself flagged, never laundered into a recallable note.

// skills/recallable.ts (create, 6 lines): export const recallableSkills = <T extends { capabilities?: string[] }>(skills: T[], includeSecrets: boolean): T[] =>
//   includeSecrets ? skills : skills.filter((s) => !(s.capabilities ?? []).includes(SECRETS_TAG))
// conversations/routes.ts (:903): const enabledSkills = recallableSkills(skillsService.loader.list(true), recallIncludesSecrets(ctx.config))
//   and the summary (:912) gains containsSecrets: top.skill.capabilities.includes(SECRETS_TAG) (only ever true with the flag on).
// conversations/skill-gate.ts: SkillMatchSummary.containsSecrets: boolean (rendered as the same tag badge + hint the wizard uses).
// skills/routes.ts (:133): const allSkills = recallableSkills(services.loader.list(true), services.recall?.().includeSecrets ?? false)
//   — `SkillsServices.recall?: () => { includeSecrets: boolean }`, wired from the module context the same way memory-service gets it.

// routes.ts: search reads `const includeSecrets = c.req.query('includeSecrets') === 'true' ? true : undefined` and forwards it;
//   GET /episodic maps rows to `{ ...rest, preview: content.replace(/\s+/g, ' ').slice(0, 400), contentLength: content.length }` (no `content`).
// memory-dashboard.tsx: the episodic list renders `mem.preview` and `t('memory.episodic.chars', { count: mem.contentLength })`; the detail view (by id) is unchanged.
```

- [ ] **Step 4: Run** — `bun vitest run tests/modules/memory tests/modules/skills tests/modules/conversations tests/contracts/tool-service/memory-tools.contract.test.ts` → PASS.

- [ ] **Step 5: Review** — `git status --short`.

---
## Phase 4 — Running at scale

### Task 12: Streaming, resumable runner — keyset batches, one open container, per-100 flush, cursor, queue, cancel, adoption, secrets never to a model (R11.7, R11.8, P-6..P-8)

**Files:**
- Modify: `src/modules/data-port/service.ts` (`runJob`, `enqueue`/`drain`, `resumeInterruptedJobs`, `cancelJob`, `updateJob`), `src/modules/data-port/routes.ts` (`POST /import/jobs/:id/cancel`), `src/modules/data-port/index.ts` (call `resumeInterruptedJobs`)
- Create: `tests/modules/data-port/runner-streaming.test.ts`, `tests/modules/data-port/runner-resume.test.ts`
- Modify: `tests/modules/data-port/scan-and-apply.test.ts` (ledger/provenance assertions; the interrupted-job case), `tests/modules/data-port/job-selection-filter.test.ts` (flip the `it.todo` halves)

**Interfaces:**
- `runJob(jobId)` streams `iterateCandidates(db, scanId, { importable: true }, 500, cursorSeq)`, resolves each row through `compileSelection`, keeps one container open, flushes the ledger + job row per `JOB_BATCH_SIZE` in one `BEGIN IMMEDIATE`, yields per batch, reindexes once, records `import_ms`; `record()` passes `adapter`, `paths`, `sha256` for every kind; adoption rule for `unchanged` hits of this job with no ledger row — the ledger kind is derived from the branch that produced the result (`WORKSPACE_TARGETS.has(target) → 'proposal'`, persona/agent → `'agent'`, episodic → `'episodic'`, skill → `'skill'` **plus `'skill-assets'`** when the result carries `assetsDir`, else `'vault'`) and the row is recorded with the result's `sha256`, never `null`; `enrichMemory` never runs on a `contains-secrets` candidate, and it has **no item cap** (`AI_ITEM_LIMIT` is deleted — enrichment is opt-in and per item, its cost is time); a text file the engine cannot hold as one string (`raw.length > STRING_LIMIT_BYTES`) is skipped as `exceeds-string-limit` (P-17), never `error`.
- Counting convention: a still-pending proposal found on a re-run is `unchanged` (counted under `stats.unchanged` and `skippedReasons.unchanged`, not under `proposals`) — so the second identical run reports `unchanged = applied + proposals` of the first.
- `enqueue(id)` / `drain()` — one job at a time per process. `resumeInterruptedJobs()` replaces `sweepInterruptedJobs()`: every `running`/`pending` job is re-enqueued oldest first, but only a job that had **started** (`status = 'running'` or `cursor_seq >= 0`) is marked `phase = 'resuming'` with `resumed_count + 1`; a `pending` job that never ran is a plain re-enqueue (the wizard must not say "Resumed after restart" for a queued job); the `rolling_back` release stays. `cancelJob(id)` sets a flag observed at the next batch boundary → status `cancelled`, phase `cancelled`, `cursor_seq` at the last flushed batch.
- `updateJob` patch gains `cursorSeq`, `startedAt`, `importMs`, `elapsedMs`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/data-port/runner-streaming.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
// … harness identical to scan-and-apply.test.ts (real vault, episodic, skills, buildApplyDeps) …

describe('streaming runner (R11.7)', () => {
  it('imports 5 200 items from one container and 200 notes with one open container, per-100 flushes and one reindex', async () => {
    put('chat/conversations.json', JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ uuid: `u${i}`, name: `alpha ${i}`, chat_messages: [{ sender: 'human', text: `turn ${i}` }] }))))
    for (let i = 0; i < 200; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scan = service.scanPath('chat-export', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const readSpy = vi.spyOn(fs, 'readFileSync'); const indexSpy = vi.spyOn(indexer, 'indexAll')
    const updates: number[] = []
    const origRun = db.run.bind(db); vi.spyOn(db, 'run').mockImplementation((q: any) => { if (String(q?.queryChunks ?? q).includes('UPDATE data_port_jobs')) updates.push(1); return origRun(q) })
    const heapBefore = process.memoryUsage().heapUsed
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'chat-export', selection: { base: 'default', groups: [], rows: [] } })
    expect(job.selectionTotal).toBe(5200)
    await wait(() => ['completed', 'failed'].includes(service.getJob(job.id)!.status), 120_000)
    const done = service.getJob(job.id)!
    expect(done.status).toBe('completed'); expect(done.stats.applied).toBe(5200); expect(done.stats.total).toBe(5200)
    expect(indexSpy).toHaveBeenCalledTimes(1)
    expect(readSpy.mock.calls.filter((c) => String(c[0]).endsWith('conversations.json'))).toHaveLength(1)
    expect(updates.length).toBeLessThanOrEqual(Math.ceil(5200 / 100) + 5)
    expect(done.importMs).toBeGreaterThan(0); expect(done.stats.elapsedMs).toBeGreaterThan(0); expect(done.cursorSeq).toBeGreaterThan(0)
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(200 * 1024 * 1024)
    const ledger = listApplied(db, job.id)
    expect(ledger).toHaveLength(5200)
    expect(ledger.every((r) => r.sha256?.length === 64 && r.adapter)).toBe(true)
    expect(new Set(ledger.map((r) => r.adapter))).toEqual(new Set(['chat-export', 'generic-md']))
    // second run: everything unchanged, no new rows, no `-2` siblings, and no tag scan (every ledger row carries a digest)
    const queries: string[] = []
    const origAll = db.all.bind(db); vi.spyOn(db, 'all').mockImplementation((q: any) => { queries.push(String(q?.queryChunks?.map((c: any) => c?.value ?? c).join(' ') ?? q)); return origAll(q) })
    const again = service.createJob({ scanId: scan.scanId, sourceProfile: 'chat-export', selection: { base: 'default', groups: [], rows: [] } })
    await wait(() => service.getJob(again.id)!.status === 'completed', 120_000)
    expect(service.getJob(again.id)!.stats).toMatchObject({ unchanged: 5200, applied: 0 })
    expect(listApplied(db, again.id)).toEqual([])
    expect(queries.filter((q) => /tags LIKE/i.test(q))).toEqual([])
  }, 240_000)

  it('releases a container even when a unit in the middle is excluded', async () => {
    put('chat/conversations.json', JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ uuid: `u${i}`, name: `alpha ${i}`, chat_messages: [{ sender: 'human', text: `turn ${i}` }] }))))
    const scan = service.scanPath('chat-export', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const middle = service.listCandidates(scan.scanId, { q: 'alpha 2500' }, { offset: 0, limit: 10, order: 'seq' }).items.find((c) => c.title === 'alpha 2500')!
    const readSpy = vi.spyOn(fs, 'readFileSync')
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'chat-export', selection: { base: 'default', groups: [], rows: [{ candidateId: middle.id, selected: false }] } })
    expect(job.selectionTotal).toBe(4999)
    await wait(() => ['completed', 'failed'].includes(service.getJob(job.id)!.status), 120_000)
    expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 4999, errors: 0 })
    expect(readSpy.mock.calls.filter((c) => String(c[0]).endsWith('conversations.json'))).toHaveLength(1)
    expect(listApplied(db, job.id).some((r) => r.ref.includes('alpha-2500'))).toBe(false)
  }, 240_000)

  it('names the engine string limit as the reason instead of a generic error', async () => {
    put('notes/ok.md', '# ok\n')
    const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    // Simulate a > STRING_LIMIT_BYTES file without writing one: the runner's readSource consults `statSync(path).size` before reading.
    const realStat = fs.statSync
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(((p: any, ...rest: any[]) => {
      const st = realStat(p, ...rest)
      return String(p).endsWith('ok.md') ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 600 * 1024 * 1024 }) : st
    }) as any)
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'all', groups: [], rows: [] } })
    await wait(() => ['completed', 'failed'].includes(service.getJob(job.id)!.status))
    statSpy.mockRestore()
    expect(service.getJob(job.id)!.stats).toMatchObject({ errors: 0, skipped: 1, skippedReasons: { 'exceeds-string-limit': 1 } })
  })

  it('never hands a contains-secrets note to the model even when enrichment is on', async () => {
    put('ai-memory/key.md', '---\ntype: project\n---\nDB_PASSWORD=alphaalphaalpha0001\n'); put('ai-memory/plain.md', 'plain note body long enough to be enriched\n')
    const complete = vi.fn(async () => ({ content: '{"summary_one_line":"x","tags":[]}' }))
    service = createDataPortService({ …, modelCtx: { model: { complete, listProviders: () => [{}] }, logger: console } as any })
    const scan = service.scanPath('claude-code', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'claude-code', selection: { base: 'default', groups: [], rows: [] }, enrich: true })
    await wait(() => service.getJob(job.id)!.status === 'completed')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(complete.mock.calls[0])).not.toContain('alphaalphaalpha0001')
  })

  it('runs queued jobs one at a time and can be cancelled at a batch boundary', async () => {
    for (let i = 0; i < 600; i++) put(`notes/n${i}.md`, `# ${i}`)
    const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const a = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'all', groups: [], rows: [] } })
    const b = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'all', groups: [], rows: [] } })
    expect(service.getJob(b.id)!.status).toBe('pending')
    expect(service.cancelJob(a.id)).toBe(true)
    await wait(() => service.getJob(a.id)!.status === 'cancelled')
    expect(service.getJob(a.id)!.stats.processed % 100).toBe(0)
    await wait(() => service.getJob(b.id)!.status === 'completed')
  })
})
```

```ts
// tests/modules/data-port/runner-resume.test.ts
describe('resume after a restart (P-8)', () => {
  it('resumes from the last committed batch, duplicating nothing', async () => {
    for (let i = 0; i < 350; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    // A deterministic "crash": stop svc1 at a batch boundary once 250 items are processed (a thrown vault.write would
    // be caught per item as `error` and the job would simply finish — that is not an interruption).
    const svc1 = createDataPortService({ …, applyDepsFactory })
    const job = svc1.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'all', groups: [], rows: [] } })
    await wait(() => svc1.getJob(job.id)!.stats.processed >= 250)
    expect(svc1.cancelJob(job.id)).toBe(true)
    await wait(() => svc1.getJob(job.id)!.status === 'cancelled')
    const stopped = svc1.getJob(job.id)!
    expect(stopped.stats.processed % 100).toBe(0); expect(stopped.cursorSeq).toBeGreaterThan(0)
    const ledgerBefore = listApplied(db, job.id).length
    expect(ledgerBefore).toBe(stopped.stats.processed)
    // "Restart": the row looks like a job the process died in the middle of; a new service over the same db picks it up.
    db.run(sql`UPDATE data_port_jobs SET status = 'running', phase = 'apply', finished_at = NULL WHERE id = ${job.id}`)
    const svc2 = createDataPortService({ …, applyDepsFactory })
    const r = svc2.resumeInterruptedJobs()
    expect(r.resumed).toBe(1)
    // enqueue → drain → runJob runs synchronously up to its first await, so the row may already be `running`.
    const afterResume = svc2.getJob(job.id)!
    expect(afterResume.phase).toBe('resuming'); expect(['pending', 'running']).toContain(afterResume.status)
    await wait(() => svc2.getJob(job.id)!.status === 'completed', 30_000)
    const done = svc2.getJob(job.id)!
    expect(done.stats.processed).toBe(350); expect(done.stats.resumed).toBe(1); expect(done.stats.errors).toBe(0)
    const ledger = listApplied(db, job.id)
    expect(ledger).toHaveLength(350); expect(new Set(ledger.map((l) => l.ref)).size).toBe(350)
    expect(ledger.every((l) => l.sha256?.length === 64)).toBe(true)
    expect(fs.readdirSync(join(dataDir, 'vault', 'semantic')).filter((f) => f.endsWith('-2.md'))).toEqual([])
  })
  it('adopts artifacts of an interrupted batch that lost their ledger rows, under their own ledger kinds', async () => {
    for (let i = 0; i < 16; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    put('.grok/memory/p1/sessions/2026-01-01_alpha.md', '---\ntype: grok-session\n---\nlog\n')
    put('GitHub/alpha/AGENTS.md', '# rules\n')
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n'); put('.claude/skills/deploy/run.sh', 'echo\n')
    const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'default', groups: [], rows: [] } })
    await wait(() => service.getJob(job.id)!.status === 'completed')
    const before = listApplied(db, job.id)
    expect(new Set(before.map((r) => r.kind))).toEqual(new Set(['vault', 'episodic', 'proposal', 'skill', 'skill-assets']))
    const victims = [
      ...before.filter((r) => r.kind === 'vault').slice(0, 3), before.find((r) => r.kind === 'episodic')!,
      before.find((r) => r.kind === 'proposal')!, before.find((r) => r.kind === 'skill')!, before.find((r) => r.kind === 'skill-assets')!,
    ]
    for (const v of victims) db.run(sql`DELETE FROM data_port_applied WHERE id = ${v.id}`)
    db.run(sql`UPDATE data_port_jobs SET status = 'running', cursor_seq = -1, finished_at = NULL WHERE id = ${job.id}`)
    const svc2 = createDataPortService({ …, applyDepsFactory })
    svc2.resumeInterruptedJobs()
    await wait(() => svc2.getJob(job.id)!.status === 'completed')
    const after = listApplied(db, job.id)
    expect(after).toHaveLength(before.length)
    for (const v of victims) {
      const adopted = after.find((r) => r.ref === v.ref)!
      expect(adopted.kind).toBe(v.kind) // a proposal comes back as `proposal`, never `vault`; the skill's asset dir as `skill-assets`
      expect(adopted.sha256).toHaveLength(64)
    }
    expect(svc2.getJob(job.id)!.stats).toMatchObject({ applied: victims.length, unchanged: before.length - victims.length, errors: 0 })
  })
  it('resumes an import the server was killed in the middle of, so nothing is duplicated and the undo stays reachable', async () => {
    // Replaces scan-and-apply's 'closes an import the server was killed in the middle of'.
    for (let i = 0; i < 120; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'all', groups: [], rows: [] } })
    await wait(() => service.getJob(job.id)!.status === 'completed')
    const ledger = listApplied(db, job.id)
    db.run(sql`UPDATE data_port_jobs SET status = 'running', phase = 'apply', finished_at = NULL WHERE id = ${job.id}`) // killed after the last batch, before `completed`
    const svc2 = createDataPortService({ …, applyDepsFactory })
    svc2.resumeInterruptedJobs()
    await wait(() => svc2.getJob(job.id)!.status === 'completed')
    expect(svc2.getJob(job.id)!.stats).toMatchObject({ applied: 0, unchanged: 120, errors: 0, resumed: 1 })
    expect(listApplied(db, job.id).map((r) => r.id).sort()).toEqual(ledger.map((r) => r.id).sort())
    await svc2.rollback(job.id, rollbackDeps) // rollbackDeps built as scan-and-apply.test.ts builds them
    expect(svc2.getJob(job.id)!.status).toBe('rolled_back'); expect(fs.readdirSync(join(dataDir, 'vault', 'semantic'))).toEqual([])
  })
  it('re-enqueues a queued job without calling it resumed', async () => {
    put('notes/n.md', '# n')
    const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
    const id = 'queued-1'
    db.run(sql`INSERT INTO data_port_jobs (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at, selection_mode, selection_total, cursor_seq)
      VALUES (${id}, 'pending', 'auto', ${scan.scanId}, '{"base":"all","groups":[],"rows":[]}', 'queued', 0, '{}', '2026-01-01', '2026-01-01', 'wire', 1, -1)`)
    const svc2 = createDataPortService({ …, applyDepsFactory })
    svc2.resumeInterruptedJobs()
    await wait(() => svc2.getJob(id)!.status === 'completed')
    expect(svc2.getJob(id)!.stats.resumed).toBe(0)
  })
})
```

`scan-and-apply.test.ts` 'imports every selected kind verbatim … records the ledger': every ledger row has a 64-char `sha256` and an `adapter`; the Grok summary row has `adapter === 'grok-cli'` under the auto-detected `claude-code` job; the skill-assets row's `sha256` equals `packageDigest`; the `MEMORY.md` index row carries `paths`; the `.claude/.env` row is now importable (`knowledge`, unticked) and when ticked lands as a vault note tagged `contains-secrets`; `job-selection-filter.test.ts` `it.todo` halves become `it`.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/modules/data-port/runner-streaming.test.ts tests/modules/data-port/runner-resume.test.ts` → FAIL.

- [ ] **Step 3: Write the runner**

```ts
// src/modules/data-port/service.ts — runJob and its companions (replaces the old loop)
import { JOB_BATCH_SIZE } from './constants.js'
import { hasLedgerRef, recordApplied, type AppliedKind } from './ledger.js'

  /** One import at a time per process: the memory bound is process-wide, never per job. */
  const queue: string[] = []
  let active: string | null = null
  const cancelRequested = new Set<string>()
  function enqueue(id: string): void { queue.push(id); void drain() }
  async function drain(): Promise<void> {
    if (active || !queue.length) return
    active = queue.shift()!
    try { await runJob(active) } finally { active = null; void drain() }
  }

  async function runJob(jobId: string): Promise<void> {
    const job = getJob(jobId)
    if (!job) return
    const row = (deps.db.all(sql`SELECT selection_json, enrich, cursor_seq, resumed_count, elapsed_ms FROM data_port_jobs WHERE id = ${jobId}`) as any[])[0]
    const scan = getScan(job.scanId)
    if (!scan || scan.candidateCount === 0) { updateJob(jobId, { status: 'failed', phase: 'error', error: 'Scan data expired or missing — re-scan and try again', finishedAt: new Date().toISOString() }); return }
    const sel = compileSelection(normaliseSelection(JSON.parse(row.selection_json)))
    const enrichRequested = Number(row.enrich ?? 0) === 1
    const stats: ImportJobStats = { ...job.stats, total: job.selectionTotal || job.stats.total || 0, resumed: Number(row.resumed_count ?? 0) }
    const runStarted = Date.now()
    const elapsedBefore = Number(row.elapsed_ms ?? 0)
    let cursor = Number(row.cursor_seq ?? -1)
    const startedAt = job.startedAt ?? new Date().toISOString()
    updateJob(jobId, { status: 'running', phase: cursor >= 0 ? 'resuming' : 'read', progress: stats.total ? 0.05 + (0.95 * stats.processed) / stats.total : 0.05, stats, startedAt })

    const applyDeps = deps.applyDepsFactory()
    const profile: SourceProfile = job.sourceProfile === 'auto' ? scan.detectedProfile : job.sourceProfile
    // Opt-in, per item, no cap (R11.1): the owner asked for it; the cost is time. `AI_ITEM_LIMIT` is deleted (no-caps guard).
    const useAi = enrichRequested && Boolean(deps.modelCtx.model?.complete) && hasProvider()

    // Pre-pass: hooks from every selected index file (small set: kind = 'index' only).
    const hooks = new Map<string, IndexEntry>(); const indexCounts = new Map<string, number>()
    for (const batch of iterateCandidates(deps.db, job.scanId, { importable: true, kind: ['index'] }, 500)) for (const c of batch) { if (!sel.resolve(c) || !c.sourcePath) continue; /* parseMemoryIndex as before */ }

    /** ONE container in memory: released when the next row's sourcePath differs. */
    let open: { path: string; raw: Buffer; sha256: string; units: ExpandedUnit[] | null } | null = null
    /** null = unreadable; 'exceeds-string-limit' = the engine cannot hold this file as one string (P-17) — a truthful skip, not an error. */
    const readSource = (path: string): typeof open | 'exceeds-string-limit' | null => {
      if (open?.path === path) return open
      open = null
      let size: number; try { size = statSync(path).size } catch { return null }
      if (size > STRING_LIMIT_BYTES) return 'exceeds-string-limit'
      let raw: Buffer; try { raw = readFileSync(path) } catch { return null }
      open = { path, raw, sha256: createHash('sha256').update(raw).digest('hex'), units: null }
      return open
    }

    /** Ledger rows of the current batch; flushed with the job row in one transaction. */
    let pendingLedger: Array<Parameters<typeof recordApplied>[1]> = []
    const record = (kind: AppliedKind, ref: string, c: ScanCandidate, sha256: string | null) => {
      pendingLedger.push({ jobId, kind, ref, sourcePath: c.sourcePath ?? null, sha256, adapter: c.adapterId ?? profile, paths: c.paths ?? [c.relativePath] })
    }
    const flush = (phase: string, finalProgress?: number) => {
      const patch = { phase, progress: finalProgress ?? (stats.total ? 0.05 + (0.95 * stats.processed) / stats.total : 1), stats: { ...stats, elapsedMs: elapsedBefore + (Date.now() - runStarted) }, cursorSeq: cursor, elapsedMs: elapsedBefore + (Date.now() - runStarted) }
      const rows = pendingLedger; pendingLedger = []
      let began = false
      try { deps.db.run(sql.raw('BEGIN IMMEDIATE')); began = true } catch (err) { if (!/within a transaction/i.test(String((err as Error).message))) throw err }
      try {
        for (const r of rows) recordApplied(deps.db, r)
        updateJob(jobId, patch)
        if (began) deps.db.run(sql.raw('COMMIT'))
      } catch (err) {
        if (began) { try { deps.db.run(sql.raw('ROLLBACK')) } catch { /* gone */ } }
        // One bad row must not cost 99 ledger entries: retry row by row, log the one that fails.
        for (const r of rows) { try { recordApplied(deps.db, r) } catch (e) { deps.logger?.warn?.({ err: String(e), ref: r.ref }, 'data-port: ledger row could not be written') } }
        updateJob(jobId, patch)
        deps.logger?.warn?.({ jobId, err: String(err) }, 'data-port: batch flush fell back to per-row writes')
      }
    }

    let sinceFlush = 0
    try {
      for (const batch of iterateCandidates(deps.db, job.scanId, { importable: true }, 500, cursor)) {
        for (const candidate of batch) {
          cursor = candidate.seq
          if (!sel.resolve(candidate)) continue
          const target = sel.target(candidate)
          stats.processed++
          const kind = candidate.kind
          try {
            const entry = candidate.sourcePath ? readSource(candidate.sourcePath) : null
            if (entry === 'exceeds-string-limit') { skipWith('exceeds-string-limit'); continue }
            if (!entry) { failWith('unreadable'); continue }
            const note = noteFor(candidate, entry) // unchanged; overlays unit.tags onto note.tags; expands with { withContent: true }
            if (!note) { skipWith('missing-unit'); continue }
            const sourceChanged = Boolean(candidate.sha256 && candidate.sha256 !== entry.sha256)
            const flagged = candidate.tags?.includes('contains-secrets') === true
            const adapterId = candidate.adapterId ?? profile
            let result: ApplyResult
            if (WORKSPACE_TARGETS.has(target)) {
              result = await applyWorkspaceProposal(applyDeps, { jobId, target, title: note.title, body: note.body, sourcePath: candidate.relativePath, scope: candidate.scope ?? null, frontmatterYaml: note.hadFrontmatter ? (note.frontmatterRaw ?? stringifyYaml(note.data)) : null, sourceChanged, containsSecrets: flagged })
            } else if (target === 'agent' || kind === 'persona') {
              result = await applyPersonaItem(applyDeps, { jobId, sourceProfile: profile, adapterId, relativePath: candidate.relativePath, raw: entry.raw.toString('utf-8'), sourceChanged, containsSecrets: flagged })
            } else if (target === 'skill' || kind === 'skill') {
              result = await applySkillItem(applyDeps, { jobId, sourceProfile: profile, adapterId, transformed: buildSkillFromPackage({ relativePath: candidate.relativePath, raw: entry.raw.toString('utf-8'), assets: readSkillAssets(candidate), containsSecrets: flagged, ...(candidate.notBundled?.length ? { notBundled: candidate.notBundled } : {}) }), sourceChanged })
            } else if (MEMORY_TARGETS.has(target)) {
              let transformed = normalizeMemory(note, { relativePath: candidate.relativePath, sourceProfile: profile, adapterId, hooks: hooks.get(basename(candidate.relativePath).replace(/\.md$/i, '')) ?? null, sha256: entry.sha256, mtime: candidate.mtime, paths: candidate.paths, unit: candidate.unit ?? null, sourceChanged, fileSlug: slugFromSource(candidate.relativePath, note.title, candidate.unit ?? null), tags: candidate.tags?.filter((t) => t !== 'contains-secrets'), containsSecrets: flagged, … })
              // A file that holds a credential is never handed to a model, even when the owner opted into enrichment (R11.4).
              if (useAi && note.declaredKind === null && target !== 'episodic' && !flagged) { /* enrichMemory as before */ } else if (useAi && flagged) stats.aiFallback++
              const unit = candidate.unit && entry.units ? entry.units.find((u) => u.unit === candidate.unit) : null
              result = await applyMemoryItem(applyDeps, {
                jobId, sourceProfile: profile, adapterId, target, transformed, relativePath: candidate.relativePath, unit: candidate.unit ?? null,
                sessionId: candidate.sessionId ?? note.sessionId, sessionDate: candidate.sessionDate ?? note.sessionDate ?? candidate.birthtime ?? candidate.mtime ?? null,
                kindTag: candidate.reasonCode === 'transcript' || candidate.reasonCode === 'session-summary' || candidate.reasonCode === 'session-artifact' ? candidate.reasonCode : null,
                part: (unit?.data as any)?.part ?? null, scope: { projectId: note.project, projectTypeId: note.projectType },
              })
            } else { skipWith('unsupported-target'); continue }

            if (result.status === 'applied') {
              stats.applied++
              record(ledgerKind(result.kind), result.ref, candidate, result.sha256)
              if (result.kind === 'skill' && result.assetsDir) record('skill-assets', result.assetsDir, candidate, result.assetsSha256 ?? null)
            } else if (result.status === 'unchanged') {
              // Adoption: a hit THIS job wrote before an interrupted batch lost its ledger row is this job's work, not an
              // earlier import's. The ledger kind follows the branch that produced the result (a proposal is a `proposal`
              // row keyed by proposal id — never a `vault` row that rollback would try to delete as a note).
              const ledgerKindOf: AppliedKind = WORKSPACE_TARGETS.has(target) ? 'proposal'
                : kind === 'persona' || target === 'agent' ? 'agent'
                : target === 'episodic' ? 'episodic'
                : target === 'skill' || kind === 'skill' ? 'skill'
                : 'vault'
              if (result.importJobId === jobId && !hasLedgerRef(deps.db, ledgerKindOf, result.ref)) {
                stats.applied++
                record(ledgerKindOf, result.ref, candidate, result.sha256)
                if (ledgerKindOf === 'skill' && result.assetsDir && !hasLedgerRef(deps.db, 'skill-assets', result.assetsDir)) record('skill-assets', result.assetsDir, candidate, result.assetsSha256 ?? null)
              } else { stats.unchanged++; countReason('unchanged') }
            } else if (result.status === 'proposal') { stats.proposals++; record('proposal', result.proposalId, candidate, result.sha256) }
            else if (result.status === 'skipped') skipWith(result.reasonCode ?? skipCodeFor(result.reason))
            else failWith(result.reasonCode ?? 'error')
          } catch (err) { failWith('error'); deps.logger?.warn?.({ err: String(err), path: candidate.relativePath }, 'data-port item failed') }
          finally {
            stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1
            if (++sinceFlush >= JOB_BATCH_SIZE) { sinceFlush = 0; flush('apply'); await new Promise<void>((r) => setImmediate(r)); if (stats.processed % 2000 === 0) deps.logger?.info?.({ jobId, processed: stats.processed, total: stats.total, rss: process.memoryUsage().rss }, 'data-port: job progress') }
          }
          if (cancelRequested.has(jobId) && sinceFlush === 0) { cancelRequested.delete(jobId); open = null; flush('cancelled'); updateJob(jobId, { status: 'cancelled', phase: 'cancelled', finishedAt: new Date().toISOString(), importMs: elapsedBefore + (Date.now() - runStarted) }); return }
        }
        // A page of unselected rows still moves the cursor and the clock.
        flush('apply'); await new Promise<void>((r) => setImmediate(r))
      }
      open = null
      flush('index')
      reindex()
      updateJob(jobId, { status: 'completed', phase: 'done', progress: 1, stats: { ...stats, elapsedMs: elapsedBefore + (Date.now() - runStarted) }, finishedAt: new Date().toISOString(), error: null, importMs: elapsedBefore + (Date.now() - runStarted) })
    } catch (err) {
      flush('error')
      updateJob(jobId, { status: 'failed', phase: 'error', error: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString() })
    }
  }

  function cancelJob(id: string): boolean {
    const j = getJob(id); if (!j || !['pending', 'running'].includes(j.status)) return false
    if (j.status === 'pending' && active !== id) { const at = queue.indexOf(id); if (at >= 0) queue.splice(at, 1); updateJob(id, { status: 'cancelled', phase: 'cancelled', finishedAt: new Date().toISOString() }); return true }
    cancelRequested.add(id); return true
  }

  function resumeInterruptedJobs(): { resumed: number; released: number } {
    const now = new Date().toISOString()
    const stuck = deps.db.all(sql`SELECT id, status, cursor_seq FROM data_port_jobs WHERE status IN ('running', 'pending') ORDER BY created_at ASC`) as Array<{ id: string; status: string; cursor_seq: number }>
    // Only a job that had STARTED is "resumed" (phase, counter); a queued job that never ran is simply queued again.
    const started = stuck.filter((s) => s.status === 'running' || s.cursor_seq >= 0).map((s) => s.id)
    for (const id of started) deps.db.run(sql`UPDATE data_port_jobs SET status = 'pending', phase = 'resuming', error = NULL, finished_at = NULL, resumed_count = resumed_count + 1, updated_at = ${now} WHERE id = ${id}`)
    for (const s of stuck) enqueue(s.id)
    // … the rolling_back release exactly as sweepInterruptedJobs did it …
    return { resumed: started.length, released: claimed.length }
  }
```

`runJob`'s `updateJob(jobId, { status: 'running', phase: cursor >= 0 ? 'resuming' : 'read', … })` keeps `resuming` for the first batch of a resumed job and the phase moves to `apply` at the first flush. Imports: `STRING_LIMIT_BYTES` from `./constants.js`, `statSync` from `node:fs`, `type AppliedKind` from `./ledger.js`.

`readSkillAssets` loses its secrets refusal; it pushes `containsSecrets: asset.containsSecrets` through. `createJob` calls `enqueue(id)`. `index.ts`: `service.resumeInterruptedJobs()` then `service.migrateLegacyScans()`, both logged. Route: `POST /api/v1/data-port/import/jobs/:id/cancel` (`update` on DataPort) → 200 `{ ok: true }` / 404 / 409 when not cancellable.

- [ ] **Step 4: Run** — `bun vitest run tests/modules/data-port` → PASS (whole module).

- [ ] **Step 5: Review** — `git status --short`.

---

### Task 14: Web pure modules — types, selection copy, pages, reason labels, progress; vitest config for `@tanstack/react-virtual`

**Files:**
- Create: `src/web/src/pages/settings/data-port-types.ts`, `data-port-selection.ts`, `data-port-pages.ts`, `data-port-reason-label.ts`, `data-port-progress.ts`
- Modify: `vitest.config.ts`
- Create: `tests/web/data-port-selection.test.ts`, `tests/web/data-port-pages.test.ts`, `tests/web/data-port-reason-label.test.ts`, `tests/web/data-port-progress.test.ts`, `tests/web/data-port-locale-parity.test.ts`

**Interfaces:**
- `data-port-types.ts`: `ScanSummary`, `PublicCandidate`, `CandidateCounts`, `CandidateFilter`, `SelectionWire`, `DirNode`, `CandidatePage`, `ImportJob`, `WorkspaceProposal`, `RollbackResult`, `CandidateTarget`, `RULE_TARGETS`, `KIND_ORDER` (`…, 'knowledge', 'code', 'unknown', 'noise'`).
- `data-port-selection.ts`: verbatim copy of `compileSelection`/`normaliseSelection` + `applyGesture(wire, gesture)` (appends a group, prunes shadowed earlier groups with the same kind and a folder equal to or under the new one; `setBase` resets groups/rows but keeps targets), `groupState(wire, node)` → `'all' | 'none' | 'mixed' | 'inherit'`.
- `data-port-pages.ts`: `PAGE_SIZE = 200`, `MAX_PAGES_PER_GROUP = 20`, `pagesForRange`, `createPageCache` (LRU), `buildCandidatesQuery`, `buildCountsQuery`, `buildTreeQuery`.
- `data-port-reason-label.ts`: `splitReasonCode`, `reasonLabel`, `tagLabel`, `warningLabel`, `kindLabel`, `dirClassLabel`, `scanWarningText`.
- `data-port-progress.ts`: `progressSummary(job, nowMs)`, `formatDuration(ms)`, `formatBytes(bytes, lang)`, `dateLocale(lang)`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/web/data-port-selection.test.ts — runs the SAME fixture as the server
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyGesture, compileSelection, groupState, normaliseSelection } from '@/pages/settings/data-port-selection'
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/data-port/selection-cases.json'), 'utf-8'))
describe('web selection resolver = server resolver', () => {
  for (const c of fixture.cases) it(c.name, () => { const sel = compileSelection(c.wire); expect(Object.fromEntries(fixture.rows.map((r: any) => [r.id, sel.resolve(r)]))).toEqual(c.expect) })
  it('normalises the legacy array', () => {
    const sel = compileSelection(normaliseSelection(fixture.legacy.input))
    expect(Object.fromEntries(fixture.rows.map((r: any) => [r.id, sel.resolve(r)]))).toEqual(fixture.legacy.expect)
    expect(sel.target(fixture.rows[0])).toBe('vault.procedural')
  })
  it('prunes shadowed gestures', () => {
    let wire = normaliseSelection({ base: 'default', groups: [], rows: [] })
    wire = applyGesture(wire, { folder: 'alpha/deep', selected: true })
    wire = applyGesture(wire, { folder: 'alpha', selected: false })
    expect(wire.groups).toEqual([{ folder: 'alpha', selected: false }])
    wire = applyGesture(wire, { kind: 'memory', selected: true })
    expect(wire.groups).toHaveLength(2)
  })
  it('reports a group state', () => {
    const wire = { base: 'default' as const, groups: [{ folder: 'alpha', selected: false }], rows: [] }
    expect(groupState(wire, { path: 'alpha', subtree: { total: 3, importable: 3, selectedByDefault: 2 } })).toBe('none')
    expect(groupState(wire, { path: 'bravo', subtree: { total: 3, importable: 3, selectedByDefault: 2 } })).toBe('mixed')
    expect(groupState({ ...wire, groups: [] }, { path: 'bravo', subtree: { total: 3, importable: 3, selectedByDefault: 3 } })).toBe('all')
  })
})
```

```ts
// tests/web/data-port-locale-parity.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { KIND_ORDER } from '@/pages/settings/data-port-types'
const LOCALES = ['en', 'hu', 'de', 'es', 'fr', 'tlh']
const DIR = resolve(process.cwd(), 'src/web/src/pages/settings/locales')
const load = (lang: string) => JSON.parse(readFileSync(resolve(DIR, `${lang}.json`), 'utf-8')) as Record<string, string>
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join()
it('keeps every settings.dataPort.* key and placeholder set in all six languages', () => {
  const en = load('en')
  const keys = Object.keys(en).filter((k) => k.startsWith('settings.dataPort.'))
  for (const lang of LOCALES.slice(1)) {
    const bundle = load(lang)
    const missing = keys.filter((k) => typeof bundle[k] !== 'string' || !bundle[k])
    const drift = keys.filter((k) => bundle[k] && placeholders(bundle[k]) !== placeholders(en[k]!))
    const extra = Object.keys(bundle).filter((k) => k.startsWith('settings.dataPort.') && !(k in en))
    expect({ lang, missing, drift, extra }).toEqual({ lang, missing: [], drift: [], extra: [] })
  }
  for (const k of KIND_ORDER) expect(typeof en[`settings.dataPort.wizard.kind.${k}`]).toBe('string')
})
```

`data-port-pages.test.ts`: `pagesForRange(0, 150)` → `[0]`, `(180, 420)` → `[0, 1, 2]`; LRU evicts the least-recently touched at 21 pages; `buildCandidatesQuery('s', { q: 'a & b', folder: 'Documents/Notes' }, 0, 200)` encodes both and omits empties; `subtree=false` only when asked. `data-port-reason-label.test.ts`: `splitReasonCode('directory-skipped:node_modules')` → `{ code: 'directory-skipped', detail: 'node_modules' }`; `reasonLabel(...)` interpolates `{{detail}}` with the English key; unknown code with detail → `fallback (detail)`; `kindLabel('code')` and every KIND_ORDER entry resolve to a non-key string; `scanWarningText({ code: 'legacy', params: { message: 'old text' }, message: 'old text' })` → `'old text'`. `data-port-progress.test.ts`: eta null under 20 processed; eta = elapsed/processed × remaining; finished job uses `finishedAt`; pct clamps and falls back to `job.progress` when total is 0; `formatDuration` thresholds (< 90 s seconds, < 90 min minutes, else h+m); invalid `createdAt` → elapsed 0.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/web/data-port-selection.test.ts tests/web/data-port-pages.test.ts tests/web/data-port-reason-label.test.ts tests/web/data-port-progress.test.ts tests/web/data-port-locale-parity.test.ts` → FAIL.

- [ ] **Step 3: Write the modules**

`data-port-selection.ts` is `src/modules/data-port/selection.ts` copied verbatim (header comment says so and names the fixture) with the two constants inlined (`50_000`, `5_000`) plus:

```ts
export type Gesture = { kind?: string; folder?: string; selected: boolean }
const covers = (outer: Gesture, inner: Gesture) =>
  (outer.kind === undefined || outer.kind === inner.kind) && (outer.folder === undefined || inner.folder === undefined ? outer.folder === undefined : inner.folder === outer.folder || inner.folder.startsWith(outer.folder + '/') || outer.folder === '.')
export function applyGesture(wire: SelectionWire, g: Gesture): SelectionWire {
  const groups = wire.groups.filter((old) => !covers(g, old))
  const rows = wire.rows.filter((r) => r.selected === undefined) // a gesture wipes row overrides it covers; target-only rows survive
  return { ...wire, groups: [...groups, g], rows }
}
export function setBase(wire: SelectionWire, base: SelectionWire['base']): SelectionWire {
  return { base, groups: [], rows: wire.rows.filter((r) => r.selected === undefined) }
}
export function groupState(wire: SelectionWire, node: { path: string; subtree: { total: number; importable: number; selectedByDefault: number } }): 'all' | 'none' | 'mixed' | 'inherit' {
  if (node.subtree.importable === 0) return 'none'
  for (let i = wire.groups.length - 1; i >= 0; i--) {
    const g = wire.groups[i]!
    if (g.kind !== undefined) continue
    if (g.folder === undefined || g.folder === '.' || node.path === g.folder || node.path.startsWith(g.folder + '/')) return g.selected ? 'all' : 'none'
  }
  if (wire.base === 'all') return 'all'
  if (wire.base === 'none') return 'none'
  return node.subtree.selectedByDefault === node.subtree.importable ? 'all' : node.subtree.selectedByDefault === 0 ? 'none' : 'mixed'
}
```

```ts
// data-port-reason-label.ts
import { t, tOr } from './i18n'
export function splitReasonCode(code: string): { code: string; detail?: string } { const at = code.indexOf(':'); return at < 0 ? { code } : { code: code.slice(0, at), detail: code.slice(at + 1) } }
export function reasonLabel(reasonCode: string | undefined, fallback: string): string {
  if (!reasonCode) return fallback
  const { code, detail } = splitReasonCode(reasonCode)
  const vars = detail ? { detail: tOr(`settings.dataPort.wizard.dirClass.${detail}`, detail) } : undefined
  const out = tOr(`settings.dataPort.reason.${code}`, '', vars)
  return out || (detail ? `${fallback} (${detail})` : fallback)
}
export const kindLabel = (kind: string) => tOr(`settings.dataPort.wizard.kind.${kind}`, kind)
export const tagLabel = (tag: string) => tOr(`settings.dataPort.wizard.tag.${tag}`, tag)
export const warningLabel = (w: string) => tOr(`settings.dataPort.wizard.warning.${w}`, w)
export const dirClassLabel = (cls: string) => tOr(`settings.dataPort.wizard.dirClass.${cls}`, cls)
export function scanWarningText(w: { code: string; params?: Record<string, string | number>; message: string } | string): string {
  if (typeof w === 'string') return w
  return tOr(`settings.dataPort.scanWarning.${w.code}`, w.message, w.params)
}
```

`data-port-progress.ts`: `progressSummary(job, nowMs) → { processed, total, pct, elapsedMs, etaMs, ratePerMin }` (`etaMs = null` when `processed < 20 || !total`; elapsed from `job.stats.elapsedMs` when present, else `nowMs − Date.parse(createdAt)`, clamped ≥ 0, `finishedAt − createdAt` when finished); `formatDuration(ms)` → `t('settings.dataPort.wizard.duration.seconds'|'.minutes'|'.hours', …)`; `formatBytes(bytes, lang)` via `Intl.NumberFormat(dateLocale(lang))` (moved from the card). `data-port-pages.ts` as specified in the interfaces (`buildTreeQuery(scanId, parent, filter)`).

`vitest.config.ts`: add `/@tanstack\/react-virtual/, /@tanstack\/virtual-core/` to `server.deps.inline` and `'@tanstack/react-virtual': resolve(__dirname, 'src/web/node_modules/@tanstack/react-virtual')` to `resolve.alias` (same reason as `@tanstack/react-router`: installed only under `src/web/node_modules`, calls React hooks).

- [ ] **Step 4: Run** — `bun vitest run tests/web/data-port-*.test.ts` → PASS.

- [ ] **Step 5: Review** — `git status --short`.

---

### Task 16: Documentation in six languages and the CHANGELOG (no version bump)

**Files:**
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/admin/data-port.md`, `{en,hu,de,es,fr,tlh}/knowledge/memory.md`, `{en,hu,de,es,fr,tlh}/deploy/configuration.md`, `CHANGELOG.md`

- [ ] **Step 1: `admin/data-port.md` ×6**

Replace the home-directory keep-list paragraph (en line 40 and its five translations): the scan walks every directory under the path with no file-count, file-size or total-size cap — a tree ten times larger than a typical home directory is listed and imported in full; the cost is time and disk, never omission. Only directory classes that can never hold memory are not entered — `node_modules`, `.git`/`.hg`/`.svn`, `.cache`, `__pycache__`, `.venv`/`venv`, build outputs beside a build manifest (`dist`, `build`, `out`, `.next`, `.turbo`, `target`), browser profile roots (Chrome/Chromium/Firefox/Antigravity, recognised by their marker files), `.Trash`, `Library/Caches` — and each appears as **one row** with its file count and the reason `Folder not searched: <class>`, so nothing is hidden. Symlinked directories are followed once (real path de-duplicated); loops are reported. `.DS_Store` is listed as application state.
Sessions row (en line 46): summaries, session notes (`type: claude-session` / `grok-session`) and transcripts (Claude Code `*.jsonl` including sub-agent transcripts, Cursor agent transcripts, Codex rollouts, ChatGPT / Claude.ai exports) → one episodic row per session (very long sessions in ordered parts), verbatim turns, **all selected by default** — untick the Sessions group if unwanted; tool outputs saved beside a session are listed but unticked.
New rows: legacy memory folders (`memory.local-backup-*`, `memory.old`, `*.bak`) → vault note tagged `legacy` (a taken name gets a `-2` sibling); your own documents anywhere under the root → vault note, kind from `type:` else `reference`; third-party product docs → vault note tagged `third-party`, selected; rule files inside repositories (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) → proposal; source-code files → listed, importable, **not** ticked; data/configuration text (`.yaml`, `.toml`, `.csv`, `.log`, assistant `settings.json` …) → listed, importable, not ticked.
"Nothing is clipped" paragraph (en line 51): drop "(up to 4 MiB)"; a text file over 4 MiB (50 MiB for a chat export) is imported whole and only carries a size marker on its row. Bodies are written byte for byte, leading and trailing blank lines included; the vault writer's single trailing newline and a dropped UTF-8 byte-order mark are the only changes. Every applied item records the adapter that read it (`source.adapter`, tag `source:<adapter>` — a Grok summary found under an auto-detected Claude Code job is tagged `grok-cli`), every path the content was found at, and its content sha256 in the ledger, for every kind.
New **Secrets** section: a file the secrets heuristic flags (a private key block, a provider token, a `KEY=value` literal, a `.env`-shaped name) is imported verbatim like every other file and tagged `contains-secrets` (note tag, skill capability, episodic tag, `[contains-secrets]` in a proposal title); the wizard marks such rows; code that looks a secret up (`keychain_lookup(...)`, `os.environ[...]`, `getenv(...)`) and placeholders (`<your-key>`, `xxx`, `.env.example`) are not flagged; such notes are hidden from the model's memory index, related work and `search_memory` unless `memory.recall.includeSecrets: true` (link to the configuration page). Credential-shaped files (`.env`, `credentials.json`, key files) are listed unticked; a note that merely contains a key stays ticked.
New **Scale** section: every candidate is one row in the database; the review step is a folder tree (every folder mapped, classes not entered shown with their counts and "why not importable"), a virtualised list and a preview; **Select all importable**, **Back to suggested**, per-folder toggles and a per-kind row (one click unticks every transcript in every folder); the scan runs in the background and the tree fills in while it walks; the import streams items in batches of 100, commits each batch, reports progress every 100 items, rebuilds the index once at the end, can be stopped after the current batch, and resumes from its last committed batch after a restart; scan time and import time are shown. Re-running the same scan and import adds only what is new; everything already present reports **Unchanged**. Two engine facts, stated so nothing surprises: a bundled skill file over 200 000 characters is inlined into the skill body up to that point with a marker naming the complete copy — the copy under the skill's asset directory is byte-exact and complete (P-15/P-20); and a single text file larger than one text value the engine can hold (about 512 MiB) is listed, hashed and selectable like any other but reported with the reason *Larger than one text value the engine can hold* instead of being filed — the row says why (P-17).
Reason-code table: remove `too-large` and `secrets`; `transcript` → "Conversation transcript (imported whole)"; `not-durable` → "Third-party or boilerplate text — label only"; add `directory-skipped` ("Folder class never entered — one counted row"), `source-code`, `data-file`, `session-artifact`, `exceeds-string-limit` ("Larger than one text value the engine can hold — listed, not filed yet"). Fields table: **Select all importable**, **Back to suggested**, folder tree, preview, stop buttons, scan/import time.
Translations: Hungarian (`Cél-agent` register, "Minden importálható kijelölése", "Nem átnézett mappa", "Titkot tartalmaz — tárolva, felidézésből kizárva"), German, Spanish, French, Klingon (A17.8 vocabulary: `tevwI'` file, `tetlh` index, `tlhap` import, `qawHaq` memory, `pa'` folder, `ghItlhHom` note, `pegh` secret) — the same sections in each file, never an English copy.

- [ ] **Step 2: `knowledge/memory.md` ×6** — after the `memory.index.budgetChars` paragraph insert **Imported secrets stay out of recall** (hu "Az importált titkok kimaradnak a felidézésből", de "Importierte Geheimnisse bleiben aus dem Recall", es "Los secretos importados quedan fuera del recall", fr "Les secrets importés restent hors du rappel", tlh "tlhaplu'bogh peghmey qaw vo' ratlh"): the importer never drops a file for holding a secret; the item carries `contains-secrets`; by default it is left out of the always-on index, `search_memory` and related work; the Memory page still shows it; `memory.recall.includeSecrets: true` in `config/local.yaml` (restart) opens it; `legacy` and `third-party` are ordinary recallable notes; every imported item carries `source:<adapter>`; a hand-written Obsidian note may declare `contains-secrets` itself.

- [ ] **Step 3: `deploy/configuration.md` ×6** — heading "Memory index" → "Memory index and recall" and a row after `memory.index.budgetChars`: `| memory.recall.includeSecrets | **false** | Whether notes, episodic rows and skills tagged contains-secrets (files the importer found credentials in, stored verbatim) are shown to the model in the memory index, related work and search_memory. Off, they are stored and visible on the Memory page but never reach a prompt. Needs a restart. |` — translated in the register of the existing row in each file.

- [ ] **Step 4: `CHANGELOG.md`** — under `## [Unreleased]`, after the lossless-import block:

```markdown
### Data port — no limits

- The scan has no caps: the file-count cap is gone, the 4 MiB / 50 MiB per-file limits are markers on the row instead of skips, and there is no total-size cap. A tree ten times larger than a typical home directory is listed and imported in full; the cost is time and disk, never omission.
- The walker maps everything under the root — the home-directory keep-list is gone. Only directory classes that can never hold memory (`node_modules`, `.git`/`.hg`/`.svn`, `.cache`, `__pycache__`, `.venv`/`venv`, build outputs beside a build manifest, browser profile roots, `.Trash`, `Library/Caches`) are not entered, and each is still one visible row with its file count (`directory-skipped:<class>`). Symlinked directories are followed once; loops and unreadable folders are reported, never silently dropped.
- Everything with text content is a candidate and is selected by default: assistant `*.jsonl` transcripts (sub-agent transcripts included), Cursor and Codex sessions, Obsidian session notes (`type: claude-session` / `grok-session`), legacy memory folders (`memory.local-backup-*`, `memory.old`, `*.bak` → tagged `legacy`), your own documents anywhere under the root, third-party product docs (tagged `third-party`) and rule files inside repositories (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md` → proposals). `not-durable` and `transcript` are labels only. Source-code and data/configuration files are listed and importable but not ticked.
- Secrets are stored, never dropped: a flagged file is imported verbatim and tagged `contains-secrets`; such notes, episodic rows and skills are hidden from every model-facing recall path by default — the always-on index, `search_memory`, related work, the reflection job, the nightly consolidator and the skill matcher — and `memory.recall.includeSecrets` (default `false`) opens them. The heuristic no longer flags lookups (`keychain_lookup(...)`, `os.environ[...]`, `getenv(...)`) or placeholders (`your-…`, `<…>`, `xxx`, `.env.example`). A flagged note is never handed to the optional enrichment model.
- A bundled skill file over 200 000 characters is inlined into the skill body up to that point with a marker naming the complete on-disk copy under the skill's asset directory, which is byte-exact. A single text file larger than one text value the engine can hold (about 512 MiB) is listed, hashed and selectable but reported as `exceeds-string-limit` instead of being filed — the row says why.
- Bodies are written byte for byte, leading and trailing blank lines included; the vault writer's single trailing newline and a dropped UTF-8 BOM are the only changes. Earlier imports are still recognised as **Unchanged**.
- Provenance on every item: `source.adapter` / `source:<adapter>` tag, every alias path, and the content sha256 in the ledger for vault, episodic, skill, skill-assets, agent and proposal rows alike.
- Scale: candidates live in `data_port_candidates` (one row each, indexed by scan, kind, reason, folder and path) and folders in `data_port_scan_dirs`; the scan runs in the background, reports progress and yields to the server even inside a million-entry folder count or a multi-gigabyte file hash; the API pages and filters candidates and returns per-kind / per-folder / per-reason counts and a folder tree; the wizard renders a folder tree, a virtualised list and a preview with **Select all importable**, per-folder toggles and a per-kind row, and never loads the whole list; the runner streams items, keeps one container open, commits the ledger per 100 items, yields to the event loop, rebuilds the index once at the end, can be stopped after the current batch and resumes from its last committed batch after a restart. Scan and import times are reported. Imported episodic rows are not embedded during the import (no model call in the import path).
- Idempotent and additive: re-running a scan and import after this change adds only what is new; earlier imports are not rolled back. Scans made before this change are migrated into the table at startup.
```

- [ ] **Step 5: Verify**

Run: `grep -nE '4 MiB|4 Mio|home directory|Home-Scan|scan de \*\*home|juH\*\* nej|transcripts are not|az átiratok nem|Transkripte nicht|las transcripciones no|pas les transcriptions' packages/docs/src/content/docs/*/admin/data-port.md` → no cap / keep-list / default-off wording left.
Run: `grep -c includeSecrets packages/docs/src/content/docs/*/knowledge/memory.md packages/docs/src/content/docs/*/deploy/configuration.md` → ≥ 1 in all twelve files.
Run: `bun run docs:build 2>&1 | tail -3` → success. `grep -n '"version"' package.json src/web/package.json` → both `0.8.23-beta`.

- [ ] **Step 6: Review** — `git status --short`.

---
## Phase 5 — The wizard and the proof

### Task 15: Web wizard — scanning step, folder tree, virtualised candidate list, preview sheet, running and done steps (R11.7)

**Files:**
- Create: `src/web/src/pages/settings/data-port-folder-tree.tsx`, `data-port-candidate-list.tsx`, `data-port-preview.tsx`, `data-port-review.tsx`
- Modify: `src/web/src/pages/settings/data-port-card.tsx`
- Create: `tests/web/data-port-folder-tree.test.tsx`, `tests/web/data-port-candidate-list.test.tsx`, `tests/web/data-port-preview.test.tsx`, `tests/web/data-port-review.test.tsx`, `tests/web/data-port-card.test.tsx`

**Interfaces:**
- `DataPortCard` steps: `source → scanning → review → running → done`. Scanning polls `GET /scans/:id` every 1 s, shows `wizard.scanning.*` counters and the current folder, offers **Stop the scan** (`DELETE /scans/:id`), enables **Review** on `done` (and on `failed` with the `scan-failed` warning shown).
- `DataPortReview` props `{ scan: ScanSummary; wire: SelectionWire; onWireChange; onResolvedCount; enrich; onEnrichChange; treeProps? }` — owns filter state, `counts` (`GET /counts?<filter>`), tree nodes (`GET /tree?parent=`, fetched on expand, cached), the focused folder, pages (`GET /candidates?folder=&subtree=&…&offset=&limit=`, LRU 20 pages of 200), the resolved counts (`POST /selection/count` with the expanded folders, debounced 200 ms, `aria-busy` while in flight), the preview sheet.
- **Kind row** (R11.7 "per-kind toggles" — the amendment's own example is "untick all transcripts"): a horizontal strip above the tree, one `TriStateCheckbox` per entry of `counts.byKind` in `KIND_ORDER` (disabled at `importable === 0`, `noise` shown as a count only), label `kindLabel(kind)`, count `${resolved.byKind[kind] ?? selectedByDefault} / ${importable}` from the last `/selection/count` answer (`group.selected`); state from `groupState`-like logic over the kind groups of the wire (last matching kind-only group → all/none, else base/default → mixed when `0 < selected < importable`); a click calls `onWireChange(applyGesture(wire, { kind, selected }))` — one click unticks every transcript in every project folder.
- `FolderTree` (`role="tree"`, one `useVirtualizer` over the flattened visible nodes): chevron / dashed "not searched" icon, `TriStateCheckbox` (`indeterminate`, `aria-checked="mixed"`, disabled at `importable === 0`), name (`group.rootFolder` for `.`), `group.selected` from the last `/selection/count`, a 6-px stacked kind bar (CSS-variable colours), a reason popover (`tree.whyNot`: top `byReason` entries via `reasonLabel`; class rows say `dirSkippedFiles`), alias rows (`tree.aliasOf`). Keyboard: Up/Down, Right expand / first child, Left collapse / parent, Space toggles, Enter focuses the folder, Home/End, type-ahead.
- `CandidateList` (`role="listbox"` `aria-multiselectable`, one `useVirtualizer` over `total` rows, `PlaceholderRow` with `aria-busy` for unloaded indices): checkbox (disabled + lock at `!importable`), title, path (folder muted / filename strong), kind badge, reason via `reasonLabel`, tags via `tagLabel` (`contains-secrets` with `containsSecretsHint` as `title`), warnings via `warningLabel`, `+N bundled files`, session date, `turns`, `sizeKiB`, part `n/of`, rule-row target `<select>`; selected state = `compileSelection(wire).resolve(row)` client-side; Shift+click range toggle over loaded rows (`list.rangeToggled` announced).
- `PreviewSheet` (shadcn `Sheet` at every breakpoint): header (title, path + copy, kind/target/reason/tags, size, mtime, alias paths), body `<pre>` head from `GET …/preview`, `preview.truncated`, directory children, bundled assets, `preview.binary`; the row's checkbox and target mirrored in the header.
- Running step: `progressSummary` → `role="progressbar"`, `progress.items/elapsed/eta/rate/byKind`, `phase.<phase>` via `tOr`, `resumeNotice` when `stats.resumed > 0`, **Stop this import** (`POST /jobs/:id/cancel` after `cancelImportConfirm`). `progressFingerprint` gains `stats.total`, `stats.elapsedMs`, `cursorSeq`, `updatedAt`. Done step: sixth tile `stat.total`, `importTime`, `scanTime`, `progress.byKind`, `stat.elapsed`, `stat.resumed`; skipped reasons via `reasonLabel`; scan warnings via `scanWarningText`.
- `startImport` posts `{ scanId, sourceProfile, instructions?, enrich?, selection: wire }`; the Import button is `disabled={resolvedCount === 0}` and labelled `startImport` with `count: resolvedCount`.

- [ ] **Step 1: Write the failing tests** (jsdom; `vi.mock('@/lib/api')` with a path router as in `tests/web/scheduler-page.test.tsx`; `vi.mock('@/components/docs/contextual-help')`; fake timers for debounces and polls; `virtualize={false}` through `treeProps`/`listProps` for behaviour cases; one virtualised smoke case per component with `HTMLElement.prototype.getBoundingClientRect` mocked to `{ height: 600, width: 800 }` and `initialRect` passed)

```tsx
// tests/web/data-port-review.test.tsx — the contract the components must meet
const scan: ScanSummary = { scanId: 's1', status: 'done', sourceProfile: 'auto', detectedProfile: 'claude-code', rootPath: '<root>', instructions: null,
  stats: { …zeros, candidateCount: 40, directoriesMapped: 6, scanMs: 1200, dirsVisited: 6, dirsSkipped: { node_modules: 1, … }, largeFiles: 1, filesSkipped: 4 },
  progress: null, counts: { total: 40, importable: 36, selectedByDefault: 30, byKind: [{ key: 'memory', total: 30, importable: 30, selectedByDefault: 30 }, …], byReason: [], byFolder: [] }, warnings: [{ code: 'directories-skipped', params: { count: 1, detail: '1 node_modules' }, message: 'x' }] }
// Router stub: `api.get` answers by path — `/tree?parent=.` → { dirs: [notes(subtree 30/30/24, byKind {memory:30}), GitHub(subtree 6/5/0, hasChildren)] },
// `/tree?parent=notes` → { dirs: [alpha, bravo, deep] }, `/candidates?…` → 200-row pages built from `rowsFor(folder)`, `/counts` → scan.counts,
// `…/preview` → { head: 'alpha body', truncated: true, candidate: { …, tags: ['contains-secrets'] } }; `api.post('/selection/count')` → { selected, byFolder, byKind }.
const flush = async () => { await act(async () => { await vi.runOnlyPendingTimersAsync() }) }
it('mounts with one tree request and no candidate request', async () => { render(<DataPortReview scan={scan} … />); await flush(); expect(api.get).toHaveBeenCalledWith('/data-port/import/scans/s1/tree?parent=.'); expect(api.get.mock.calls.some((c) => c[0].includes('/candidates'))).toBe(false) })
it('expands a folder and focuses it', async () => {
  render(<DataPortReview scan={scan} wire={emptyWire} onWireChange={onWire} onResolvedCount={vi.fn()} enrich={false} onEnrichChange={vi.fn()} treeProps={{ virtualize: false }} listProps={{ virtualize: false }} />); await flush()
  fireEvent.click(screen.getByRole('button', { name: t('settings.dataPort.wizard.tree.expand', { group: 'notes' }) })); await flush()
  expect(api.get).toHaveBeenCalledWith('/data-port/import/scans/s1/tree?parent=notes')
  fireEvent.click(screen.getByText('notes')); await flush()
  expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/candidates\?folder=notes&subtree=true&offset=0&limit=200/))
  expect(screen.getAllByRole('option')).toHaveLength(30)
})
it('sends a folder gesture to the server count and shows the resolved numbers', async () => {
  const { rerender } = render(<DataPortReview … wire={emptyWire} onWireChange={onWire} />); await flush()
  fireEvent.click(screen.getByRole('button', { name: t('settings.dataPort.wizard.tree.expand', { group: 'notes' }) })); await flush()
  fireEvent.click(within(screen.getByRole('treeitem', { name: /alpha/ })).getByRole('checkbox'))
  expect(onWire).toHaveBeenLastCalledWith(expect.objectContaining({ groups: [{ folder: 'notes/alpha', selected: false }] }))
  rerender(<DataPortReview … wire={onWire.mock.calls.at(-1)![0]} />); await flush()
  const body = api.post.mock.calls.find((c) => c[0].endsWith('/selection/count'))![1]
  expect(body.selection.groups).toEqual([{ folder: 'notes/alpha', selected: false }]); expect(body.folders).toEqual(expect.arrayContaining(['.', 'notes']))
  expect(screen.getByText(t('settings.dataPort.wizard.group.selected', { selected: 16, importable: 30 }))).toBeTruthy()
})
it('unticks a kind group and posts the gesture', async () => {
  render(<DataPortReview … wire={emptyWire} onWireChange={onWire} />); await flush()
  const sessions = within(screen.getByRole('group', { name: t('settings.dataPort.wizard.progress.byKind') })).getByRole('checkbox', { name: new RegExp(kindLabel('session')) })
  fireEvent.click(sessions)
  expect(onWire).toHaveBeenLastCalledWith(expect.objectContaining({ groups: [{ kind: 'session', selected: false }] }))
})
it('filters refetch counts and tree and invalidate pages', async () => {
  render(<DataPortReview … />); await flush(); api.get.mockClear()
  fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.filter.searchLabel')), { target: { value: 'alpha' } }); await flush()
  expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/counts\?.*q=alpha/)); expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/tree\?parent=\.&.*q=alpha/))
  fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.filter.reason')), { target: { value: 'directory-skipped' } }); await flush()
  expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/counts\?.*reason=directory-skipped/))
})
it('shows countsError when counts fail and keeps the list working', async () => {
  api.get.mockImplementation(async (p: string) => { if (p.includes('/counts')) throw new Error('boom'); return route(p) })
  render(<DataPortReview … treeProps={{ virtualize: false }} listProps={{ virtualize: false }} />); await flush()
  expect(screen.getByText(t('settings.dataPort.wizard.countsError'))).toBeTruthy()
  fireEvent.click(screen.getByText('notes')); await flush()
  expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
})
it('opens the preview sheet for a row', async () => {
  render(<DataPortReview … listProps={{ virtualize: false }} />); await flush(); fireEvent.click(screen.getByText('notes')); await flush()
  fireEvent.click(screen.getAllByRole('button', { name: t('settings.dataPort.wizard.preview.open') })[0]!); await flush()
  expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/\/candidates\/[^/]+\/preview\?bytes=65536$/))
  expect(screen.getByText('alpha body')).toBeTruthy(); expect(screen.getByText(/imported in full/)).toBeTruthy()
  expect(screen.getByTitle(t('settings.dataPort.wizard.containsSecretsHint'))).toBeTruthy()
})
it('renders a directory-skipped row with its file count and a not-importable lock', async () => {
  render(<DataPortReview … listProps={{ virtualize: false }} />); await flush(); fireEvent.click(screen.getByText('GitHub')); await flush()
  const row = screen.getByRole('option', { name: /node_modules/ })
  expect(within(row).getByText(t('settings.dataPort.wizard.dirSkippedFiles', { count: 1 }))).toBeTruthy()
  expect(within(row).getByRole('checkbox')).toHaveProperty('disabled', true)
})
it('LRU: after 21 pages the first page renders placeholders again and is refetched on return', async () => {
  // rowsFor('big') = 4 400 rows (22 pages); the list is virtualised with a 600-px viewport mocked through getBoundingClientRect.
  render(<DataPortReview … />); await flush(); fireEvent.click(screen.getByText('big')); await flush()
  const list = screen.getByRole('listbox').parentElement!
  for (let page = 1; page <= 21; page++) { fireEvent.scroll(list, { target: { scrollTop: page * 200 * 78 } }); await flush() }
  api.get.mockClear()
  fireEvent.scroll(list, { target: { scrollTop: 0 } }); await flush()
  expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/folder=big&subtree=true&offset=0&limit=200/))
})
```

```tsx
// tests/web/data-port-card.test.tsx (same api stub; fake timers)
it('walks source → scanning → review on a 202 scan and polls until done', async () => {
  api.post.mockResolvedValueOnce({ scanId: 's1', status: 'running', progress: { dirsVisited: 3, filesSeen: 120, candidates: 100, bytes: 1, elapsedMs: 10, currentDir: 'notes' }, counts: emptyCounts, stats: zeroStats, warnings: [] })
  api.get.mockImplementation(async (p: string) => (p === '/data-port/import/scans/s1' ? (polls++ < 1 ? runningSummary : doneSummary) : route(p)))
  render(<DataPortCard />); fireEvent.change(screen.getByLabelText(t('settings.dataPort.wizard.path')), { target: { value: '/alpha' } }); fireEvent.click(screen.getByText(t('settings.dataPort.wizard.scan'))); await flush()
  expect(screen.getByText(t('settings.dataPort.wizard.scanning.files', { count: 120 }))).toBeTruthy()
  expect(screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.continue') })).toHaveProperty('disabled', true)
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
  expect(polls).toBe(2); expect(screen.getByRole('button', { name: t('settings.dataPort.wizard.scanning.continue') })).toHaveProperty('disabled', false)
})
it('stops a running scan', async () => { /* same start */ fireEvent.click(screen.getByText(t('settings.dataPort.wizard.scanning.cancel'))); await flush(); expect(api.delete).toHaveBeenCalledWith('/data-port/import/scans/s1') })
it('posts the selection wire, never an id array, and disables Import at zero', async () => {
  /* reach review with doneSummary; the stubbed /selection/count answers selected: 0 first */
  const importBtn = screen.getByRole('button', { name: t('settings.dataPort.wizard.startImport', { count: 0 }) }); expect(importBtn).toHaveProperty('disabled', true)
  /* then selected: 30 → enabled; click */
  const body = api.post.mock.calls.find((c) => c[0] === '/data-port/import/jobs')![1]
  expect(body.selection).toMatchObject({ base: 'default', groups: expect.any(Array), rows: expect.any(Array) }); expect(Array.isArray(body.selection)).toBe(false)
})
it('shows items, elapsed, eta, a progressbar and the by-kind list while running, and stops on request', async () => {
  /* job poll → { status: 'running', phase: 'apply', stats: { total: 400, processed: 120, elapsedMs: 60_000, byKind: { memory: 120 } } } */
  expect(screen.getByRole('progressbar')).toBeTruthy(); expect(screen.getByText(t('settings.dataPort.wizard.progress.items', { processed: 120, total: 400 }))).toBeTruthy()
  expect(screen.getByText(new RegExp(t('settings.dataPort.wizard.progress.byKind')))).toBeTruthy()
  vi.spyOn(window, 'confirm').mockReturnValue(true); fireEvent.click(screen.getByText(t('settings.dataPort.wizard.cancelImport'))); await flush()
  expect(api.post).toHaveBeenCalledWith('/data-port/import/jobs/j1/cancel', expect.anything())
})
it('keeps the stall timer alive on a poll that only changes cursorSeq/updatedAt', async () => {
  /* job polls alternate cursorSeq 100/200 with the same stats */ await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000) })
  expect(screen.queryByText(t('settings.dataPort.wizard.pollTimeout'))).toBeNull()
})
it('shows total, import time and scan time on the done step and translates scan warnings', async () => {
  /* job → completed, importMs 65_000, stats.total 400; scan.stats.scanMs 1200; warnings [{ code: 'directories-skipped', params: { count: 1, detail: '1 node_modules' } }] */
  expect(screen.getByText(t('settings.dataPort.wizard.importTime', { time: t('settings.dataPort.wizard.duration.minutes', { count: 1 }) }))).toBeTruthy()
  expect(screen.getByText(t('settings.dataPort.wizard.scanTime', { time: t('settings.dataPort.wizard.duration.seconds', { count: 1 }) }))).toBeTruthy()
  expect(screen.getByText(t('settings.dataPort.scanWarning.directories-skipped', { count: 1, detail: '1 node_modules' }))).toBeTruthy()
})
```

The `/* … */` fragments inside the card cases name the stub answers each case starts from (the same `route(p)` router); every case ends in real assertions — none is a comment-only body.

- [ ] **Step 2: Run to verify they fail** — `bun vitest run tests/web/data-port-review.test.tsx tests/web/data-port-card.test.tsx tests/web/data-port-folder-tree.test.tsx tests/web/data-port-candidate-list.test.tsx tests/web/data-port-preview.test.tsx` → FAIL.

- [ ] **Step 3: Build the components**

```tsx
// src/web/src/pages/settings/data-port-candidate-list.tsx — the virtualised list skeleton (folder tree follows the same shape)
import { useVirtualizer } from '@tanstack/react-virtual'
export function CandidateList({ total, rowAt, onRangeRendered, wire, onToggleRow, onSetTarget, onPreview, virtualize = true, initialRect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const sel = useMemo(() => compileSelection(wire), [wire])
  const v = useVirtualizer({ count: total, getScrollElement: () => parentRef.current, estimateSize: () => 78, overscan: 16, ...(initialRect ? { initialRect } : {}) })
  const items = v.getVirtualItems()
  useEffect(() => { if (items.length) onRangeRendered(items[0]!.index, items[items.length - 1]!.index) }, [items[0]?.index, items[items.length - 1]?.index])
  const row = (index: number) => {
    const c = rowAt(index)
    if (!c) return <PlaceholderRow key={index} />
    const selected = sel.resolve({ id: c.id, kind: c.kind, folder: c.folder, target: c.target, importable: c.importable, selectedByDefault: c.selectedByDefault })
    return <CandidateRow key={c.id} c={c} selected={selected} onToggle={(v) => onToggleRow(c, v)} onSetTarget={onSetTarget} onPreview={onPreview} />
  }
  if (!virtualize) return <div role="listbox" aria-multiselectable aria-label={t('settings.dataPort.wizard.list.label')}>{Array.from({ length: total }, (_, i) => row(i))}</div>
  return (
    <div ref={parentRef} role="presentation" className="flex-1 min-h-0 overflow-auto">
      <div role="listbox" aria-multiselectable aria-label={t('settings.dataPort.wizard.list.label')} className="relative w-full" style={{ height: v.getTotalSize() }}>
        {items.map((it) => (
          <div key={it.key} role="presentation" ref={v.measureElement} data-index={it.index} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${it.start}px)` }}>{row(it.index)}</div>
        ))}
      </div>
    </div>
  )
}
```

`KindRow`: `role="group" aria-label={t('settings.dataPort.wizard.progress.byKind')}` holding one `TriStateCheckbox` per `counts.byKind` entry in `KIND_ORDER` with `aria-label={kindLabel(kind)}` and the `group.selected` count text; `onChange → onWireChange(applyGesture(wire, { kind, selected }))`.
`CandidateRow`: `role="option" aria-selected={selected}`; lock = `!c.importable`; badges: `kindLabel(c.kind)`, `reasonLabel(c.reasonCode, c.reason)`, `(c.tags ?? []).map(tagLabel)` (the `contains-secrets` badge gets `title={t('settings.dataPort.wizard.containsSecretsHint')}` and `bg-destructive/10 text-destructive`), `(c.warnings ?? []).map(warningLabel)`, `c.directory && t('settings.dataPort.wizard.dirSkippedFiles', { count: c.directory.files })`, `c.turns != null && t('settings.dataPort.wizard.turns', { count: c.turns })`, `t('settings.dataPort.wizard.sizeKiB', { count: Math.round(c.bytes / 1024) })`, `c.unit?.startsWith('transcript#') && c.unit.slice(11)` part badge; the rule target `<select>` from `RULE_TARGETS` (existing markup). `FolderTree` flattens the expanded node map into `{ node, level, setSize, posInSet }[]`, virtualises it the same way, renders `TriStateCheckbox` with `state = groupState(wire, node)` and `count = resolved.byFolder[node.path]`. `PreviewSheet` uses `@/components/ui/sheet`. `DataPortReview` composes the three with `ResizablePanel`-free flex (`w-[30%] min-w-[240px]` tree, flex-1 list) and the toolbar/filter bar described in the interfaces; `applyGesture` / `setBase` from `data-port-selection.ts` update the wire; every wire change schedules the debounced `/selection/count` and calls `onResolvedCount(selected)` with the answer. `DataPortCard` shrinks to the shell: `runScan` sets `scan` to the 202 summary and `step = 'scanning'`; the scanning effect polls `GET /scans/:id` every 1 000 ms until `status !== 'running'`; `startImport` posts the wire; the review dialog body is `overflow-hidden` so the panes own their scrollbars.

- [ ] **Step 4: Run** — `bun vitest run tests/web/data-port-*.test.ts tests/web/data-port-*.test.tsx && bun run build:web 2>&1 | tail -3` → PASS, build succeeds.

- [ ] **Step 5: Hand check on the dev instance** — `bun run dev` (:3100), Settings → Data portability → Import, path = a synthetic tree from Task 17 Step 2: the scanning step counts up, the tree shows `node_modules` as a dashed row with its count and a "why not importable" popover, unticking a folder drops the header count within a second, Preview opens a 64 KiB head, Import runs with items/elapsed/eta, Stop works, the done step shows both times. Stop the dev server.

- [ ] **Step 6: Review** — `git status --short`.

---

### Task 17: End-to-end fixture, 5 000-item and 10×-owner scale tests, the owner's rooted re-run, verification checklist

**Files:**
- Modify: `tests/modules/data-port/scan-and-apply.test.ts` (fixture extension + the R11 end-to-end case)
- Create: `tests/modules/data-port/scale.test.ts` (opt-in via `EYAS_SCALE_TESTS=1`)

- [ ] **Step 1: Extend `writeFixture` (alpha/bravo/charlie only) and add the end-to-end case**

Fixture additions (detection keys on `claude-sessions/` and `type:`, never on a vault folder name — no tenant vault folder names in committed tests): `Documents/Vault/meta/claude-sessions/2026-08/2026-08-01_1200_alpha-session.md` (`type: claude-session`, `date: 2026-08-01`, `time: '12:00'`), `…/2026-08-02_0900_bravo_g01a070d1.md` (`type: grok-session`), `.claude/projects/-alpha/00000000-0000-4000-8000-00000000ab01.jsonl` (two turns) + `…/00000000-0000-4000-8000-00000000ab01/subagents/agent-1.jsonl` (one turn) + `…/tool-results/t1.txt`, `.claude/projects/-alpha/memory.local-backup-2026-01-01/feedback_alpha_rule.md` (same name as the live note, different body), `.claude/projects/-alpha/memory.old/user_profile.md` (`type: user`), `ai-memory/notes.md.bak`, `ai-memory/project_alpha_env.md` (`---\ntype: project\n---\nDB_PASSWORD=alphaalphaalpha0001\n`), `.claude/skills/deploy/scripts/fetch.py` (`password = keychain_lookup("alpha-db")\n`), `.claude/skills/deploy/.env` (`OPENAI_API_KEY=sk-alpha_bravo-charlie0123456789\n`), `GitHub/alpha/.cursor/rules/alpha.mdc` (`globs: src/**/*.ts`), `GitHub/alpha/AGENTS.md`, `GitHub/alpha/node_modules/pkg/{index.js,README.md}`, `GitHub/alpha/.cache/x.txt`, `GitHub/alpha/src/index.ts`, `.grok/docs/user-guide/13-memory.md`, `.grok/relocations/r1.json`, `Desktop/TODO.md`, `ai-memory/spaced.md` (`---\ntype: reference\n---\n\n\nBody.\n\n\n`), `notes/logo.png` (binary).

```ts
it('R11 end to end: everything mapped, everything text selected, secrets tagged, bodies verbatim, provenance everywhere, idempotent', async () => {
  const scan = service.scanPath('auto', src); await wait(() => service.getScan(scan.scanId)?.status === 'done')
  const rows = allCandidates(scan.scanId)
  const by = (rel: string) => rows.find((c) => c.relativePath === rel)!
  // mapped
  expect(rows.filter((c) => c.reasonCode.startsWith('directory-skipped:')).map((c) => c.directory!.class).sort()).toEqual(['cache', 'node_modules'])
  expect(by('GitHub/alpha/node_modules').directory).toMatchObject({ files: 2 })
  expect(rows.some((c) => c.relativePath.startsWith('GitHub/alpha/node_modules/'))).toBe(false)
  expect(rows.filter((c) => c.kind !== 'noise' && c.target === 'none')).toEqual([])
  // defaults (R11.3, D-8, P-2, P-3)
  expect(by('Documents/Vault/meta/claude-sessions/2026-08/2026-08-01_1200_alpha-session.md')).toMatchObject({ kind: 'session', reasonCode: 'session-summary', selectedByDefault: true })
  expect(by('.claude/projects/-alpha/00000000-0000-4000-8000-00000000ab01.jsonl')).toMatchObject({ kind: 'session', reasonCode: 'transcript', selectedByDefault: true, adapterId: 'claude-code' })
  expect(by('.claude/projects/-alpha/00000000-0000-4000-8000-00000000ab01/subagents/agent-1.jsonl').tags).toEqual(expect.arrayContaining(['subagent']))
  expect(by('.claude/projects/-alpha/00000000-0000-4000-8000-00000000ab01/tool-results/t1.txt')).toMatchObject({ reasonCode: 'session-artifact', selectedByDefault: false })
  expect(by('.claude/projects/-alpha/memory.local-backup-2026-01-01/feedback_alpha_rule.md')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: expect.arrayContaining(['legacy']) })
  expect(by('.grok/docs/user-guide/13-memory.md')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: expect.arrayContaining(['third-party']) })
  expect(by('GitHub/alpha/.cursor/rules/alpha.mdc')).toMatchObject({ kind: 'rule', scope: 'src/**/*.ts', selectedByDefault: true })
  expect(by('GitHub/alpha/AGENTS.md')).toMatchObject({ kind: 'rule', selectedByDefault: true })
  expect(by('GitHub/alpha/src/index.ts')).toMatchObject({ kind: 'code', selectedByDefault: false })
  expect(by('.grok/relocations/r1.json')).toMatchObject({ kind: 'knowledge', reasonCode: 'config', selectedByDefault: false })
  expect(by('Desktop/TODO.md')).toMatchObject({ kind: 'memory', selectedByDefault: true })
  expect(by('.claude/.env')).toMatchObject({ kind: 'knowledge', selectedByDefault: false, tags: ['contains-secrets'] })
  expect(by('ai-memory/project_alpha_env.md')).toMatchObject({ kind: 'memory', selectedByDefault: true, tags: ['contains-secrets'] })
  expect(by('notes/logo.png')).toMatchObject({ kind: 'noise', reasonCode: 'binary' })
  const skill = rows.find((c) => c.kind === 'skill')!
  expect(skill.assets!.find((a) => a.relPath === '.env')!.containsSecrets).toBe(true)
  expect(skill.assets!.find((a) => a.relPath === 'scripts/fetch.py')!.containsSecrets).toBeUndefined()
  // import the default selection
  const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'default', groups: [], rows: [] } })
  await wait(() => service.getJob(job.id)!.status === 'completed', 30_000)
  const done = service.getJob(job.id)!
  expect(done.stats.errors).toBe(0)
  // verbatim (R11.5) — the writer's own trailing newline is the one permitted difference
  expect(readFileSync(join(dataDir, 'vault', 'semantic', 'spaced.md'), 'utf-8').split('\n---\n')[1]).toBe('\n\n\nBody.\n\n\n')
  // legacy sibling, never dropped
  expect(existsSync(join(dataDir, 'vault', 'procedural', 'feedback_alpha_rule-2.md'))).toBe(true)
  expect(readFileSync(join(dataDir, 'vault', 'procedural', 'feedback_alpha_rule-2.md'), 'utf-8')).toMatch(/tags:[\s\S]*legacy[\s\S]*conflict-with:/)
  // secrets stored, tagged, hidden (R11.4 / D-7)
  const secretNote = readFileSync(join(dataDir, 'vault', 'semantic', 'project_alpha_env.md'), 'utf-8')
  expect(secretNote).toContain('DB_PASSWORD=alphaalphaalpha0001'); expect(secretNote).toMatch(/contains-secrets/)
  indexer.indexAll()
  expect(buildMemoryIndex(db, { projectTypeId: null })!.paths).not.toContain('semantic/project_alpha_env.md')
  expect(buildMemoryIndex(db, { projectTypeId: null, includeSecrets: true })!.paths).toContain('semantic/project_alpha_env.md')
  const imported = skills.getByName('deploy')!
  expect(imported.content).toContain('### .env'); expect(imported.content).toContain('sk-alpha_bravo'); expect(imported.content).toContain('keychain_lookup')
  expect(imported.capabilities).toContain('contains-secrets'); expect(imported.capabilities.some((c: string) => c.startsWith('skipped-unsafe-asset'))).toBe(false)
  expect(existsSync(join(dataDir, 'skills', 'imported', … , '.env'))).toBe(true)
  // sessions → episodic, one per session, dated, provenance per adapter (R11.6)
  const eps = episodic.list({ limit: 100 })
  expect(eps.filter((e) => e.tags.includes('session-summary'))).toHaveLength(3)
  expect(eps.filter((e) => e.tags.includes('transcript'))).toHaveLength(2)
  expect(eps.find((e) => e.validFrom.startsWith('2026-08-01T12:00'))!.tags).toContain('source:obsidian')
  expect(eps.find((e) => e.tags.includes('subagent'))!.tags).toEqual(expect.arrayContaining(['source:claude-code', 'parent-session:00000000-0000-4000-8000-00000000ab01']))
  expect(eps.every((e) => e.embeddingHash === null)).toBe(true)
  // ledger: digest + adapter + paths for every kind
  const ledger = listApplied(db, job.id)
  expect(ledger.every((r) => r.sha256?.length === 64 && r.adapter && r.paths.length >= 1)).toBe(true)
  expect(ledger.find((r) => r.sourcePath?.endsWith('_g01a070d1.md'))!.adapter).toBe('obsidian')
  expect(new Set(ledger.map((r) => r.kind))).toEqual(new Set(['vault', 'episodic', 'skill', 'skill-assets', 'agent', 'proposal']))
  expect(done.stats.proposals).toBe(4) // CLAUDE.md + AGENTS.md + .mdc + .claude/CLAUDE.md
  // idempotent (R11.8) — a still-pending proposal is reported as `unchanged` on a re-run (Task 12 convention), so unchanged = applied + proposals
  const again = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'default', groups: [], rows: [] } })
  await wait(() => service.getJob(again.id)!.status === 'completed', 30_000)
  expect(service.getJob(again.id)!.stats).toMatchObject({ applied: 0, unchanged: done.stats.applied + done.stats.proposals, proposals: 0 })
  expect(service.getJob(again.id)!.stats.skippedReasons.unchanged).toBe(done.stats.applied + done.stats.proposals)
  expect(listApplied(db, again.id)).toEqual([])
  expect(readdirSync(join(dataDir, 'vault', 'semantic')).filter((f) => /-3\.md$/.test(f))).toEqual([])
})
```

- [ ] **Step 2: The opt-in scale test**

```ts
// tests/modules/data-port/scale.test.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Skipped unless EYAS_SCALE_TESTS=1 — it writes ~200 MB and runs minutes.
// Run: EYAS_SCALE_TESTS=1 bun vitest run tests/modules/data-port/scale.test.ts
import { describe, it, expect } from 'vitest'
describe.skipIf(process.env.EYAS_SCALE_TESTS !== '1')('data-port at scale (R11.7)', () => {
  it('scans, reviews and imports a 5 000-item synthetic tree within bounds, twice', async () => {
    // tree: 3 000 markdown notes (`---\ntype: reference\n---\n` + 20 KB body) across 300 folders,
    //       900 `.grok/memory/p<N>/sessions/*.md` summaries, 80 role-per-line `.jsonl` transcripts of ~1.2 MB,
    //       20 SKILL.md packages with scripts/, 2 000 files under GitHub/alpha/node_modules, one 60 MiB conversations.json (5 000 conversations)
    //       — alpha/bravo/charlie names only; ≈ 190 MB.
    const rssBefore = process.memoryUsage().rss
    const scan = service.scanPath('auto', src)
    await wait(() => service.getScan(scan.scanId)?.status === 'done', 600_000)
    const s = service.getScan(scan.scanId)!
    expect(s.stats.candidateCount).toBe(3000 + 900 + 80 + 20 + 5000 + 1) // + the node_modules row
    expect(s.stats.dirsSkipped.node_modules).toBe(1); expect(s.stats.filesInSkippedDirs).toBe(2000); expect(s.stats.scanMs).toBeGreaterThan(0)
    expect(service.listCandidates(scan.scanId, {}, { offset: 0, limit: 500, order: 'path' }).items).toHaveLength(500)
    expect((await service.selectionCount(scan.scanId, { base: 'default', groups: [], rows: [] })).selected).toBe(3000 + 900 + 80 + 20 + 5000)
    const job = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'default', groups: [], rows: [] } })
    const rssSamples: number[] = []
    const t = setInterval(() => rssSamples.push(process.memoryUsage().rss), 1000)
    await wait(() => ['completed', 'failed'].includes(service.getJob(job.id)!.status), 1_800_000)
    clearInterval(t)
    const done = service.getJob(job.id)!
    expect(done.status).toBe('completed'); expect(done.stats.applied).toBe(9000); expect(done.stats.errors).toBe(0)
    expect(done.importMs).toBeGreaterThan(0); expect(done.stats.elapsedMs).toBeGreaterThan(0)
    expect(Math.max(...rssSamples) - rssBefore).toBeLessThan(512 * 1024 * 1024)
    expect(listApplied(db, job.id).every((r) => r.sha256 && r.adapter)).toBe(true)
    const again = service.createJob({ scanId: scan.scanId, sourceProfile: 'auto', selection: { base: 'default', groups: [], rows: [] } })
    await wait(() => service.getJob(again.id)!.status === 'completed', 1_800_000)
    expect(service.getJob(again.id)!.stats).toMatchObject({ unchanged: 9000, applied: 0 })
  }, 3_600_000)

  it('maps a tree ten times the owner\'s — 260 000 text files, a 500 000-entry class directory — in the background, responsive, cancellable', async () => {
    // The amendment's explicit bar (R11.1: "ten times larger than the owner's"). Tree: 260 000 tiny notes (`# n<i>\n`) across
    // 20 000 folders (`tree/f<0..19999>/n<0..12>.md`), plus `GitHub/alpha/node_modules` holding 500 000 entries
    // (2 000 dirs × 250 empty files) — alpha/bravo/charlie names only. Written with a streaming loop (no array of paths).
    const FILES = 260_000, FOLDERS = 20_000, NM_DIRS = 2_000, NM_FILES = 250
    writeBigTree(src, { FILES, FOLDERS, NM_DIRS, NM_FILES })
    // The harness mounts the routes on a Hono app (`app`) exactly as candidates-routes.test.ts does.
    const rssBefore = process.memoryUsage().rss
    const rssSamples: number[] = []; const progressAt: number[] = []
    const scan = service.scanPath('auto', src)
    expect(scan.status).toBe('running')
    const t0 = Date.now(); let lastProgress = ''
    const sampler = setInterval(() => {
      rssSamples.push(process.memoryUsage().rss)
      const p = JSON.stringify(service.getScan(scan.scanId)?.progress ?? null); if (p !== lastProgress) { lastProgress = p; progressAt.push(Date.now() - t0) }
    }, 1000)
    // Responsiveness while the scan runs: every endpoint answers within 2 s even in the middle of the walk.
    await wait(() => (service.getScan(scan.scanId)?.progress?.filesSeen ?? 0) > 50_000, 600_000)
    for (const path of [`/import/scans/${scan.scanId}/tree?parent=.`, `/import/scans/${scan.scanId}/counts`]) {
      const t = Date.now(); expect((await app.request(`/api/v1/data-port${path}`)).status).toBe(200); expect(Date.now() - t).toBeLessThan(2000)
    }
    await wait(() => service.getScan(scan.scanId)?.status === 'done', 3_600_000)
    clearInterval(sampler)
    const s = service.getScan(scan.scanId)!
    expect(s.stats.candidateCount).toBe(FILES + 1) // every note + the one node_modules row
    expect(s.stats.dirsSkipped.node_modules).toBe(1); expect(s.stats.filesInSkippedDirs).toBe(NM_DIRS * NM_FILES)
    expect(s.stats.dirsVisited).toBeGreaterThanOrEqual(FOLDERS + 3)
    expect(Math.max(...rssSamples) - rssBefore).toBeLessThan(512 * 1024 * 1024)
    // ≥ 1 progress update per 5 s of wall time (the count of a 500 000-entry class directory included).
    for (let i = 1; i < progressAt.length; i++) expect(progressAt[i]! - progressAt[i - 1]!).toBeLessThan(5000)
    for (const path of [`/import/scans/${scan.scanId}/tree?parent=.`, `/import/scans/${scan.scanId}/counts`]) {
      const t = Date.now(); expect((await app.request(`/api/v1/data-port${path}`)).status).toBe(200); expect(Date.now() - t).toBeLessThan(2000)
    }
    const t = Date.now()
    expect((await service.selectionCount(scan.scanId, { base: 'default', groups: [{ folder: 'tree/f7', selected: false }], rows: [] })).selected).toBe(FILES - 13)
    expect(Date.now() - t).toBeLessThan(2000)
    // A cancel issued mid-scan is observed within 5 s.
    const second = service.scanPath('auto', src)
    await wait(() => (service.getScan(second.scanId)?.progress?.filesSeen ?? 0) > 20_000, 600_000)
    const tc = Date.now(); expect(service.cancelScan(second.scanId)).toBe(true)
    await wait(() => service.getScan(second.scanId)?.status === 'cancelled', 5000)
    expect(Date.now() - tc).toBeLessThan(5000); expect(service.countCandidates(second.scanId, {})).toBe(0)
  }, 7_200_000)
})
```

Run: `EYAS_SCALE_TESTS=1 bun vitest run tests/modules/data-port/scale.test.ts` once on the dev machine; record wall time, `scanMs`, `importMs`, peak RSS and the 10× case's scan wall time in the hand-off note. The 10× case writes ≈ 760 000 files; it needs ~1.5 GB of free disk and runs for tens of minutes — it is the proof that findings about retained rows and blocking counts cannot come back.

- [ ] **Step 3: Whole-suite verification**

Run: `bun run test 2>&1 | tail -15` → green (name any pre-existing failures from the memory notes: anomaly-job, fixture drift).
Run: `bun run lint 2>&1 | tail -3` → error count ≤ the baseline recorded before Task 1.
Run: `bun run build:web 2>&1 | tail -3` → success. `bun run docs:build 2>&1 | tail -3` → success.
Run: `bun vitest run tests/modules/data-port/no-caps.test.ts tests/modules/data-port/reason-codes.test.ts tests/modules/data-port/locale-vocabulary.test.ts tests/web/data-port-locale-parity.test.ts tests/modules/data-port/selection-resolver.test.ts tests/web/data-port-selection.test.ts` → green (caps, vocabulary, six languages, resolver parity).
Run: `grep -rniE 'odoo|eyssen-erp|99_meta|10_projects|20_areas|/Users/' src/modules/data-port src/web/src/pages/settings/data-port-*.ts* tests/modules/data-port tests/web/data-port-* tests/fixtures/data-port` → empty (no tenant vault folder names, no machine paths).
Run: `grep -rn 'AI_ITEM_LIMIT' src/modules/data-port` → empty (enrichment has no item cap).
Run: `grep -rn 'trimTail\|dropLeadingBlankLines\|\.trimEnd()' src/modules/data-port | grep -v Legacy` → empty.
Run: `grep -rn 'gray-matter' src/modules/data-port` → empty; `git diff --stat bun.lock package.json src/web/package.json` → no dependency change, versions untouched.
Run: `grep -rn "embed: false" src/modules/data-port` → the two importer create sites; `grep -rn "enrichMemory" src/modules/data-port/service.ts` → guarded by `!flagged`.
Run: `grep -n 'Data port — no limits' CHANGELOG.md` → present under `[Unreleased]`.

- [ ] **Step 4: The owner's rooted re-run on the real folders (read-only description — the owner does this, nothing is committed)**

On the dev instance (`bun run dev`, :3100, its own `data/`): open Settings → Data portability → Import, path `~`, profile *Auto-detect*, and let the scanning step finish (expect minutes; `~/Library` is walked). Compare with `.superpowers/sdd/2026-09-06-data-port-lossless-import/live-reimport-verification-2026-09-07.md`: the folder tree shows `.grok/relocations` (≈587 rows) and `.grok/memtrace` (≈359) as `knowledge / config`, unticked; ≈848 session notes under the vault's `claude-sessions` folder listed as `session`, selected; ≈1 766 Claude Code transcripts under `.claude/projects/*` listed as `session / transcript`, selected, sub-agent transcripts tagged; ≈82 legacy notes under `memory.local-backup-*` / `memory.old` tagged `legacy`; both `.cursor/rules/*.mdc` files under `GitHub/` listed as rules; `~/.claude/docs`, Desktop and Documents markdown listed as memory; every `node_modules`, `.git`, `Library/Caches` and browser-profile folder present as one dashed row with its count; no warning tells the owner to point at a smaller folder; scan time reported. Untick nothing; press **Import** with the default selection; watch items/elapsed/eta; stop the server mid-way once (Ctrl+C), restart it, and confirm the job resumes (`phase: resuming`) and completes with `errors: 0` and no `-3.md` siblings. Then, in a conversation on the dev instance, ask the assistant to `search_memory` for a known client database password: nothing is returned; set `memory.recall.includeSecrets: true` in `config/local.yaml`, restart, repeat: the note is returned. Restore the flag to `false`. Run the same import a second time: every item `Unchanged`. The live instance (`~/eyas`, :3000) is **not** touched in this wave; the owner decides on the dev → live update and the live re-import.

- [ ] **Step 5: Hand-off**

`git status --short` and `git diff --stat` → report the file list, the scale-test numbers (wall time, `scanMs`, `importMs`, peak RSS), the lint baseline delta and the owner-machine findings. **Do not commit.**
