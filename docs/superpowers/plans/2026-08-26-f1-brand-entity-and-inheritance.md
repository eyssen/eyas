# F1 — Brand Entity & Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stored brand (colours, typography, shape, logo, tone) that attaches to a project, is inherited by every conversation in it, and reaches every model call as a budgeted prompt section plus a verbatim-values tool.

**Architecture:** A new `brand` module owns a `design_systems` table indexing a file tree under `<dataDir>/brands/<id>/`, laid out exactly like a Claude Design design-system project (`@dsCard`-marked component previews compiled into `_ds_manifest.json`). Resolution is live in the prompt assembler via a new `resolveBrand` dep, rendered into a `brand-context` prefix section whose 800-token budget is carved out of `projectCascade`. Exact values reach the model through a `brand_get` tool in the shared registry, so CLI providers get them through the MCP bridge.

**Tech Stack:** TypeScript 5.9 strict ESM, Bun, Hono, Drizzle + SQLite, Zod, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-08-26-design-and-brand-system-design.md` (§5.2, §5.4, §6 F1, §8, §9, §11)
**Predecessor:** `docs/superpowers/plans/2026-08-26-f0-foundation-repair.md` — F1 depends on F0 being complete.

## Global Constraints

- Every source file starts with `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Imports use `@core/*`, `@modules/*`, `@shared/*`; relative ESM imports carry `.js`.
- IDs via `generateId()` (ULID) from `@shared/crypto`. Logging via the injected pino logger.
- Timestamps: `TEXT NOT NULL DEFAULT (datetime('now'))`, ISO-8601. Columns snake_case. JSON as TEXT.
- `db.get()` is unreliable with multiple bound params — use `db.all(q)[0]`.
- Routes are created in `onStart`, never `onRegister`. Declare `dependencies: ['permissions', 'auth']`.
- Add the auth+CSRF middleware pair for `/api/v1/brands/*` in `src/modules/auth/routes.ts`. Do **not** add to `CSRF_PAIRING_DEBT_BASELINE`.
- Every user-facing string in all six locales: `en, hu, de, es, fr, tlh`. Keys prefixed `brand.`.
- Prompt text stays **English and language-neutral**.
- New budget is **carved out**, never added. `DEFAULT_BUDGET_FULL` must still total 8400.
- New dependencies MIT/BSD/ISC/Apache-2.0 only.
- **Do not change any version number.** **Do not commit and do not push** without an explicit request.
- Baseline to measure against: `bun run test` → 58 failed / 9 files; `bun run lint` → 51 errors. Neither may grow.

---

## Design decisions locked before coding

**Brand token schema (`brand.json`, Zod-validated).** Modelled on Claude Design's
"colours, typography, component patterns" plus the token surface the app's own
`[data-template]` skins already expose, so an app-chrome adapter stays possible
in F6 without a schema change.

```ts
{
  version: 1,
  name: string,
  palette: {                       // hex strings, validated /^#[0-9a-fA-F]{6}$/
    background, foreground,
    primary, primaryForeground,
    secondary, secondaryForeground,
    accent, accentForeground,
    muted, mutedForeground,
    border,
    danger, success, warning,
  },
  typography: {
    display: { family: string, stack: string[], weights: number[] },
    body:    { family: string, stack: string[], weights: number[] },
    mono:    { family: string, stack: string[], weights: number[] },
    scale:   { basePx: number, ratio: number },
  },
  shape: { radiusPx: number, borderWidthPx: number, spacingUnitPx: number },
  logo:  { light?: string, dark?: string, mark?: string, favicon?: string },  // brand_assets ids
  tone:  { oneLiner: string, rules: string[] },                               // rules: max 8
  links: { website?: string },
}
```

**Why a file tree and not a JSON column.** Three reasons, all load-bearing:
the T2 executor edits brands with ordinary file tools; a version is a directory
snapshot, so it diffs and exports; and `_ds_manifest.json` is *derived* from
the files, exactly as Claude Design derives it, which keeps the two formats
interchangeable with no translation layer.

**Fallback order for `resolveBrand`.** conversation override → conversation's
project → walk `parent_conversation_id` via `getAncestry()` → instance default
(a single `brand.default_id` config row) → unbranded. Live on every call, never
snapshotted: a brand edit must reach conversations that already exist.

---

## File structure

| File | Responsibility |
|---|---|
| `src/modules/brand/brand-schema.ts` | the Zod schema for `brand.json` + `DEFAULT_BRAND` |
| `src/modules/brand/schema.ts` | `createBrandTables(db)` — `design_systems`, `design_system_versions`, `brand_assets` |
| `src/modules/brand/brand-store.ts` | the file tree: read/write/list/snapshot/restore under `<dataDir>/brands/<id>/` |
| `src/modules/brand/ds-manifest.ts` | derive `_ds_manifest.json` from first-line `@dsCard` markers |
| `src/modules/brand/brand-service.ts` | CRUD over table + store, versioning, resolution |
| `src/modules/brand/brand-resolver.ts` | `resolveBrand(conversationId, projectId)` with the fallback chain |
| `src/modules/brand/brand-card.ts` | render the ~600-token prompt card from `brand.json` |
| `src/modules/brand/brand-assets.ts` | asset ingest: hash, store, small-logo variant, data-URI |
| `src/modules/brand/brand-tools.ts` | the `brand_get` registry tool |
| `src/modules/brand/routes.ts` | `createBrandRoutes(app, deps)` |
| `src/modules/brand/index.ts` | the `EyasModule` |
| `src/modules/prompt-wizard/cache-prefix-builder.ts` | modified — the `brand-context` section |
| `src/modules/prompt-wizard/token-budget.ts` | modified — `brandContext: 800`, `projectCascade: 2200` |
| `src/modules/prompt-wizard/assembler.ts` | modified — `resolveBrand` dep + `BuildOptions` pass-through |
| `src/modules/prompt-wizard/index.ts` | modified — wire the resolver lazily |
| `src/modules/board/index.ts` | modified — `ALTER TABLE projects ADD COLUMN design_system_id TEXT` |
| `src/modules/board/routes.ts` | modified — `designSystemId` in the seed-project PATCH allow-list |
| `src/modules/conversations/index.ts` | modified — `ALTER TABLE conversations ADD COLUMN design_system_id TEXT` |
| `src/modules/conversations/schema.ts` | modified — drizzle mirror column |
| `src/modules/conversations/conversation-service.ts` | modified — `ConversationUpdate` + `UPDATE_FIELD_MAP` |
| `src/core/bootstrap.ts` | modified — register `brandModule` |
| `src/modules/auth/routes.ts` | modified — auth + CSRF pair for `/api/v1/brands/*` |
| `src/web/src/pages/settings/brand-tab.tsx` | new Settings tab |
| `src/web/src/pages/settings/locales/*.json` | six locales |

---

## Task 1: Brand token schema

**Files:** Create `src/modules/brand/brand-schema.ts`; Test `tests/modules/brand/brand-schema.test.ts`

**Produces:** `brandJsonSchema` (Zod), `type BrandJson`, `DEFAULT_BRAND: BrandJson`, `HEX_RE`.

Acceptance: a valid brand parses; a bad hex, a 9-rule tone, a negative radius and
an unknown top-level key are each rejected with a useful issue path. `DEFAULT_BRAND`
parses against its own schema (guards drift between the two).

## Task 2: Tables and the file store

**Files:** Create `src/modules/brand/schema.ts`, `src/modules/brand/brand-store.ts`;
Test `tests/modules/brand/brand-store.test.ts`

`createBrandTables(db)` creates the three tables from spec §8 with
`CREATE TABLE IF NOT EXISTS` and indexes on `design_system_versions(design_system_id)`
and `brand_assets(design_system_id)`.

`createBrandStore(rootDir)` exposes `read(id, path)`, `write(id, path, content)`,
`list(id)`, `remove(id, path)`, `snapshot(id, version)`, `restore(id, version)`,
`assetPath(id, sha, ext)`. Every path is validated with the same traversal guard
as `public-assets.ts` — reject `..`, absolute paths and anything resolving
outside `<rootDir>/<id>/`.

Acceptance: writing then reading round-trips; a `..` path is refused; a snapshot
copies the tree and `restore` brings it back byte-identical; `list` skips the
`versions/` directory.

## Task 3: `_ds_manifest.json` derivation

**Files:** Create `src/modules/brand/ds-manifest.ts`; Test `tests/modules/brand/ds-manifest.test.ts`

`deriveManifest(files: Record<string,string>): DsManifest` scans the **first line**
of every `components/*.html` entry for `<!-- @dsCard group="…" name="…" subtitle="…" width="…" height="…" -->`
and emits `{ cards: [{ name, subtitle?, path, group, viewport: { width, height } }] }`,
sorted by group then name. A file without the marker is skipped, not an error.
`name` defaults to the filename stem; `group` defaults to `"Components"`.

Acceptance: a marked file produces a card with the parsed group; an unmarked file
is skipped; a marker not on the first line is ignored (Claude Design reads the
first line only); malformed attributes fall back to defaults rather than throwing.

## Task 4: Brand service + versioning

**Files:** Create `src/modules/brand/brand-service.ts`, `src/modules/brand/types.ts`;
Test `tests/modules/brand/brand-service.test.ts`

`create`, `get`, `list`, `updateTokens`, `writeFile`, `deleteFile`, `versions`,
`restore`, `remove`. Every mutation bumps `current_version`, snapshots the tree
and appends a `design_system_versions` row with `created_by` and `change_note`.
Writing any `components/*.html` re-derives `_ds_manifest.json` before the snapshot.

Acceptance: two edits produce versions 2 and 3 with a monotonic `UNIQUE(design_system_id, version)`;
`restore(id, 2)` makes the tree equal to the version-2 snapshot and appends a
version 4 rather than rewinding the counter; `updateTokens` rejects an invalid
`brand.json` without touching the tree.

## Task 5: The prompt card

**Files:** Create `src/modules/brand/brand-card.ts`; Test `tests/modules/brand/brand-card.test.ts`

`renderBrandCard(brand: BrandJson, manifest?: DsManifest): string` produces the
English, language-neutral block that goes in the prompt. It must:

- name the brand and state that everything produced must follow it;
- list palette roles with literal hex values;
- give the three font stacks and the type scale;
- give radius / border width / spacing unit;
- list the tone one-liner and up to eight rules verbatim;
- list component card names and groups (names only, no markup);
- end with the sentence telling the model to call `brand_get` for exact values it
  must reproduce rather than recalling them.

Acceptance: the rendered card for `DEFAULT_BRAND` is under 800 estimated tokens
(assert with `estimateTokens`); every palette hex appears literally; the card
contains no Hungarian and no `{{`-style placeholders.

## Task 6: Budget carve-out and the assembler section

**Files:** Modify `src/modules/prompt-wizard/token-budget.ts`,
`src/modules/prompt-wizard/cache-prefix-builder.ts`,
`src/modules/prompt-wizard/assembler.ts`;
Test `tests/modules/prompt-wizard/brand-section.test.ts`

- `SectionBudget` gains `brandContext: number`. `DEFAULT_BUDGET_FULL` sets
  `projectCascade: 2200` and `brandContext: 800`. **`totalBudget(DEFAULT_BUDGET_FULL)`
  must still equal 8400** — assert it in the test.
- `shrinkForContextWindow`'s scaled branch scales `brandContext` proportionally,
  like `projectCascade`.
- `CachePrefixInput` gains `brand?: { card: string; brandId: string } | null`.
  `buildCachePrefix` pushes it as section key `brand-context` with
  `sourceRef = brandId`, **immediately after** `project-context`.
- `AssemblerDeps` gains
  `resolveBrand?: (o: { conversationId: string | null; projectId: string | null }) => Promise<{ card: string; brandId: string } | null>`,
  awaited inside the existing `Promise.all` and **wrapped so it can never
  reject** — the F0 lesson: one throwing resolver empties the whole prompt.

Acceptance: `totalBudget(DEFAULT_BUDGET_FULL) === 8400`; with a brand the prefix
contains a `brand-context` section positioned after `project-context`; with no
brand no section is emitted; a rejecting `resolveBrand` yields a prompt with
every other section intact.

## Task 7: The resolver

**Files:** Create `src/modules/brand/brand-resolver.ts`; Test `tests/modules/brand/brand-resolver.test.ts`

`createBrandResolver(deps)` implements the fallback chain from the decisions
section. It is memoised per `(conversationId, projectId)` for the lifetime of a
single call only — never cached across calls, or a brand edit stops propagating.

Acceptance: conversation override beats project; project is used when there is no
override; a child conversation with `project_id = NULL` inherits through
`getAncestry()`; a cycle in the ancestry terminates; unknown ids resolve to null
rather than throwing.

## Task 8: The `brand_get` tool

**Files:** Create `src/modules/brand/brand-tools.ts`; Test `tests/modules/brand/brand-tools.test.ts`

One tool, `brand_get`, `category: 'custom'` (so both MCP bridges pass it through
to CLI providers), `riskTier` green, read-only. Input:
`{ section: 'palette' | 'typography' | 'shape' | 'logo' | 'tone' | 'components' | 'all' }`.
It resolves the brand from `ctx.projectId` / `ctx.conversationId`, never from
model-supplied ids. Registration is guarded with `if (!registry.has(name))`
inside try/catch — `registry.register()` throws on a duplicate and kills boot.

Acceptance: returns literal hex values for `palette`; returns a
`data:` URI for `logo`; returns a clear "no brand is configured" result rather
than an error when nothing resolves; the tool definition's category is not
`'shell'` or `'browser'`.

## Task 9: Asset ingest and serving

**Files:** Create `src/modules/brand/brand-assets.ts`; Test `tests/modules/brand/brand-assets.test.ts`

`ingestAsset({ brandId, kind, bytes, mime })` → sha256, extension from an
allow-list of `png/jpg/jpeg/webp` (**no SVG in v1** — spec §11.7), write to
`<dataDir>/public/brand/<brandId>/<sha>.<ext>` so F0's `tryServePublicAsset`
serves it, insert a `brand_assets` row, and generate a ≤80 KB variant for email
embedding. `toDataUri(assetId)` returns the bare `data:` URI.

Downsampling has no image library in the dependency tree and none is being added
in F1: if the source is already ≤80 KB it is used as-is; otherwise the variant is
skipped and `toDataUri` returns null with a logged warning. F5 adds real
resampling with the browser pipeline.

Acceptance: an SVG upload is rejected; the same bytes twice produce one file and
two rows or one row (choose and assert); a stored asset is reachable through
`tryServePublicAsset`; `toDataUri` returns null, not a broken URI, when no small
variant exists.

## Task 10: Module skeleton, routes, CASL, bootstrap

**Files:** Create `src/modules/brand/index.ts`, `src/modules/brand/routes.ts`;
Modify `src/core/bootstrap.ts`, `src/modules/auth/routes.ts`;
Test `tests/modules/brand/routes.test.ts`

Routes per spec §9 (`/brands` group). `registerSubject('Brand', …)` in
`onRegister` inside try/catch, actions `read/create/update/delete/manage`,
defaults owner+admin `manage`, user `read,create,update,delete`, agent `read`,
guest `read`. `requirePermission(action, 'Brand')` on every route.

Register in `bootstrap.ts` after `artifacts`, guarded with `hasModule`. Add the
auth + CSRF pair for `/api/v1/brands/*` in `auth/routes.ts` next to the
`/api/v1/home/*` block.

Acceptance: `tests/contracts/api-auth-coverage.contract.test.ts` passes with no
new debt entry; a request without permission gets 403, without a session 401.

## Task 11: Project and conversation binding

**Files:** Modify `src/modules/board/index.ts`, `src/modules/board/routes.ts`,
`src/modules/conversations/index.ts`, `src/modules/conversations/schema.ts`,
`src/modules/conversations/conversation-service.ts`;
Test `tests/modules/brand/binding.test.ts`

`ALTER TABLE projects ADD COLUMN design_system_id TEXT` and the same on
`conversations`, both in try/catch. Add `designSystemId` to the seed-project PATCH
allow-list in `board/routes.ts:116-124` — without it the column is unsettable on
`general-general`, where most conversations land. Add `designSystemId` to
`ConversationUpdate` **and** `UPDATE_FIELD_MAP` (with `presence: 'in'` so it can
be cleared) **and** the drizzle mirror in `conversations/schema.ts`, or the
contract test fails and the field is silently dropped.

Acceptance: setting a brand on `general-general` through PATCH persists; clearing
the conversation override with `{ designSystemId: null }` persists as NULL; the
drizzle-mirror contract test passes.

## Task 12: The four origins

**Files:** Create `src/modules/brand/brand-origins.ts`; Test `tests/modules/brand/brand-origins.test.ts`

- **manual** — `create()` seeded from `DEFAULT_BRAND`.
- **import** — accept a zip or a `Record<path, content>` of a Claude Design
  design-system tree; validate paths, derive the manifest, reject anything above
  the file/entry caps.
- **extract** — from a codebase path (read `tokens.css` / `theme.*` /
  `tailwind.config.*` when present), or from an uploaded PDF (`pdf-parse`, already
  a dependency) or image (through the model gateway's vision path). Output is a
  candidate `brand.json` the user reviews — never written without confirmation.
- **generate** — from a brief, through `runCheapModelPass`-style fail-open
  prompting; the model returns JSON only, which is regex-extracted, `JSON.parse`d
  in try/catch and `safeParse`d against `brandJsonSchema` — the house pattern,
  since no provider offers structured output.

All four converge on `brandJsonSchema.safeParse`; nothing reaches the store
unvalidated. Extraction from a **live URL** is explicitly F5 — it needs the
browser pipeline.

Acceptance: a malformed model response yields a rejected result with the Zod
issues, not a partially written brand; import refuses a `..` path; extraction
from a fixture `tokens.css` produces a palette with the file's literal hexes.

## Task 13: Frontend

**Files:** Create `src/web/src/pages/settings/brand-tab.tsx` and supporting
components; Modify the settings page's tab list and
`src/web/src/pages/settings/locales/{en,hu,de,es,fr,tlh}.json`;
Modify the project settings UI for the brand picker.

A brand list, a token editor (colour inputs, font stacks, numeric shape fields),
a logo uploader using the existing `<UploadZone>` pointed at the brand endpoint,
a component-card gallery from `_ds_manifest.json`, a version list with restore,
and the "create from…" flow covering the four origins. Styling with the existing
`.glass-card` / `.page-title` classes and CSS variables only.

Acceptance: `tests/contracts/web-i18n-parity.contract.test.ts` passes — six
locales, identical key sets, identical placeholders. `bun run build:web`
type-checks.

## Task 14: Docs and architecture

**Files:** `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/…/brand.md`,
`packages/docs/OUTLINE.md`, `generate-skeleton.mjs` `SECTIONS`,
`generate-full-docs.mjs` `PAGE_MAP` + `META`, `help-map.json`,
`docs/eyas-architecture.md` (new numbered section + TOC entry at line 72),
`CLAUDE.md` (`brand` in Implemented Modules), `CHANGELOG.md`.

Run `bun run full-docs` then `bun run docs:build`. Do not touch version numbers.

---

## F1 exit criteria

1. `bun run test` shows no more than the 58 baseline failures, and `bun run lint`
   no more than 51 baseline errors.
2. `totalBudget(DEFAULT_BUDGET_FULL) === 8400`.
3. A conversation in a project that has a brand records a `context_compositions`
   row containing a `brand-context` section whose `source_ref` is the brand id —
   on the interactive path **and** on the delegated and channel paths F0 opened.
4. `brand_get` returns literal hex values to a CLI provider through the MCP bridge.
5. A logo uploaded through the brand endpoint is fetchable at
   `/assets/brand/<id>/<sha>.png` with `Cross-Origin-Resource-Policy: cross-origin`.
6. All six locales present with identical key sets.
7. No version number changed.
