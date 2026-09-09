# Media Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a vendor-neutral `media` module so the owner can enable Magnific, Higgsfield, fal, or several at once, and the agent generates/upscales/waits through five unified tools whose results land in documents and the producing chat turn.

**Architecture:** `MediaGateway` registers adapters (Fireflies fail-closed). Routing is per-kind (default / fallback / alsoRunOn). Adapters call vendor MCP via `McpClient.callTool` from the MCP plan — they do not dump 50 tools onto the agent. Ingest writes `media_jobs.document_ids`; the conversation runner merges jobs since `turnStartedMs` into `attachmentIds`.

**Tech Stack:** Bun + TypeScript (strict, ESM), Drizzle/bun:sqlite, Hono, Zod, Vitest, React 19 + Tailwind + TanStack Router, module-local i18n (six languages). No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-08-29-media-providers-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-29-mcp-streamable-http-and-oauth.md` (Tasks 1–5 at minimum: Streamable HTTP, `callTool`, OAuth, catalog URLs). Do not start this plan until those MCP tests are green.

## Global Constraints

- TypeScript strict, ESM. English code and comments. Hungarian only in `hu.json` (and user-facing copy via `t()`).
- File header on every new source file: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Pino — never `console.log`.
- Zod on every HTTP body.
- User-facing strings in **all six** locales: `en`, `hu`, `de`, `es`, `fr`, `tlh`.
- CSS variables only.
- `/api/v1/` prefix. CASL subject `Media` (`read` / `create` / `manage`).
- MIT-compatible deps only. **No new dependency.**
- **Never change the version number.**
- **Never commit, never branch, never push.**
- Touch ONLY the files this plan names (plus files the MCP plan already changed).
- Do not host Magnific Spaces/Agents. Do not add one tool per vendor model.
- Zero configured providers → structured error, never mock pixels.
- WS topics go through `WS_TOPICS` — the contract test bans string literals.

---

## File Structure

**New:**

| File | Responsibility |
|------|----------------|
| `src/modules/media/types.ts` | `MediaKind`, `MediaProvider`, `MediaJob`, `MediaSettings`, … |
| `src/modules/media/schema.ts` | `createMediaTables(db)` |
| `src/modules/media/settings-store.ts` | load/save `media_settings` JSON |
| `src/modules/media/routing.ts` | resolve provider ids for a generate call |
| `src/modules/media/budget.ts` | daily/monthly cap check |
| `src/modules/media/gateway.ts` | register, generate, status, listJobs, ingest hook |
| `src/modules/media/ingest.ts` | URL → documents.upload + link |
| `src/modules/media/tools.ts` | five `ToolImplementation`s |
| `src/modules/media/routes.ts` | `/api/v1/media/*` |
| `src/modules/media/index.ts` | `EyasModule` |
| `src/modules/media/fake-provider.ts` | in-process provider for tests only — **do not register in production** |
| `src/modules/media/submodules/magnific/{manifest.ts,adapter.ts}` | Magnific MCP adapter |
| `src/modules/media/submodules/higgsfield/{manifest.ts,adapter.ts}` | Higgsfield MCP adapter |
| `src/modules/media/submodules/fal/{manifest.ts,adapter.ts}` | fal MCP adapter |
| `src/web/src/pages/media/*` | `/media` settings-style page + i18n |
| `src/web/src/routes/media.tsx` | TanStack route (do **not** hand-edit `routeTree.gen.ts`) |
| `config/skills/integrations/media-creative.md` | skill |
| `packages/docs/src/content/docs/en/ai/media.md` | user docs (and locale siblings that exist) |
| `tests/modules/media/*.test.ts` | unit/route/ingest/adapter tests |
| `tests/manual/media-smoke.md` | optional live checklist, no CI |

**Modified:** `src/core/bootstrap.ts`, `src/modules/tools/index.ts` (optional: `media`), `src/modules/documents/document-service.ts` (wire `_moduleOverrides.media.maxFileSizeMb = 200` at the documents module start), `src/modules/conversations/index.ts` + `routes.ts` (listJobs merge), `src/shared/ws-topics.ts`, `src/web/src/components/layout/sidebar.tsx` + six `nav.media` keys, `src/modules/connections/catalog.ts`, `CHANGELOG.md`, `docs/eyas-architecture.md`, `Claude.md` current-state one-liner only if the architecture doc is updated in the same task.

**Ordering:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11.

---

### Task 1: Types, tables, fake provider, gateway register/generate/listJobs

**Files:**
- Create: `src/modules/media/types.ts`, `schema.ts`, `fake-provider.ts`, `gateway.ts`
- Test: `tests/modules/media/gateway.test.ts`

**Interfaces:**
- Produces (copy these names exactly — later tasks import them):

```ts
export type MediaKind = 'image' | 'video' | 'audio' | 'upscale' | 'edit' | '3d'
export type MediaJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface MediaModel {
  id: string
  label: string
  kind: MediaKind
  providerId: string
}

export interface MediaBalance {
  providerId: string
  credits: number | null
  unit: string
  raw?: Record<string, unknown>
}

export interface MediaGenerateRequest {
  kind: MediaKind
  prompt: string
  model?: string
  references?: Array<{ url?: string; documentId?: string }>
  options?: Record<string, unknown>
  conversationId?: string
  agentId?: string
  userId?: string
}

export interface MediaJob { /* spec §7.2 exactly */ }

export interface MediaProvider {
  id: string
  name: string
  capabilities: readonly MediaKind[]
  configured: boolean
  connect(): Promise<void>
  catalog(kind?: MediaKind): Promise<MediaModel[]>
  generate(req: MediaGenerateRequest): Promise<MediaJob>
  status(jobId: string): Promise<MediaJob>
  cancel(jobId: string): Promise<void>
  balance(): Promise<MediaBalance | null>
}

export interface MediaKindRouting {
  defaultProviderId: string | null
  fallbackProviderId: string | null
  alsoRunOn: string[]
}
export interface MediaSettings {
  routing: Record<MediaKind, MediaKindRouting>
  budget: Record<string, { dailyCredits: number | null; monthlyCredits: number | null }>
  expertRawMcpTools: boolean
}

export interface MediaGateway {
  registerProvider(provider: MediaProvider): void
  unregisterProvider(id: string): void
  listProviders(): Array<Pick<MediaProvider, 'id' | 'name' | 'capabilities' | 'configured'>>
  getProvider(id: string): MediaProvider | undefined
  generate(input: MediaGenerateRequest & { providerId: string; batchId?: string }): Promise<MediaJob>
  status(jobId: string): Promise<MediaJob>
  cancel(jobId: string): Promise<void>
  listJobs(filter: { conversationId?: string; since?: number; status?: MediaJobStatus; limit?: number }): MediaJob[]
  saveJob(job: MediaJob): void
}
```

`createMediaGateway(deps: { db; logger; now?: () => Date; ingest?: (job: MediaJob) => Promise<MediaJob> })`

`createFakeMediaProvider(over?: Partial<MediaProvider> & { id?: string }): MediaProvider` — `configured: true` by default, `generate` returns a completed job with `resultUrls: ['https://example.test/out.png']` unless overridden.

- [ ] **Step 1: Write `tests/modules/media/gateway.test.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createMediaTables } from '@modules/media/schema'
import { createMediaGateway } from '@modules/media/gateway'
import { createFakeMediaProvider } from '@modules/media/fake-provider'
import pino from 'pino'

describe('MediaGateway', () => {
  let db: any
  let cleanup: () => void

  beforeEach(() => {
    const t = createTestDb('media-gateway')
    db = t.open()
    cleanup = t.cleanup
    createMediaTables(db)
  })

  afterEach(() => cleanup())

  it('lists nothing until a provider is registered', () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    expect(gw.listProviders()).toEqual([])
  })

  it('generate persists a job and listJobs({ since }) returns it', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    gw.registerProvider(createFakeMediaProvider({ id: 'fake' }))
    const before = Date.now() - 1000
    const job = await gw.generate({
      providerId: 'fake',
      kind: 'image',
      prompt: 'a lamp',
      conversationId: 'c1',
    })
    expect(job.id).toBeTruthy()
    expect(job.providerId).toBe('fake')
    const listed = gw.listJobs({ conversationId: 'c1', since: before })
    expect(listed.map((j) => j.id)).toContain(job.id)
    expect(gw.listJobs({ conversationId: 'c1', since: Date.now() + 60_000 })).toEqual([])
  })

  it('generate throws when the provider is missing', async () => {
    const gw = createMediaGateway({ db, logger: pino({ enabled: false }) })
    await expect(gw.generate({ providerId: 'nope', kind: 'image', prompt: 'x' }))
      .rejects.toThrow(/nope/)
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `bunx vitest run tests/modules/media/gateway.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement types, schema, fake provider, gateway**

`schema.ts` — `CREATE TABLE IF NOT EXISTS media_jobs` with the columns in spec §7.3, plus `CREATE TABLE IF NOT EXISTS media_settings (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)` with a single row id `'default'`. Index on `(conversation_id, created_at)`.

`gateway.generate`: call `provider.generate`, then `saveJob`. If `ingest` is provided and status is `completed` with empty `documentIds` and nonempty `resultUrls`, `job = await ingest(job)` then save again.

`listJobs`: SQL filter. `since` is epoch ms compared to `created_at` (ISO). Use `new Date(row.created_at).getTime() >= since`.

`status`: load row; if not terminal, `provider.status(providerJobId)` (adapter.status takes **EYAS job id** per spec — keep spec: `status(jobId: string)` on the provider uses the **vendor** id internally; the gateway looks up the row and passes `row.provider_job_id` into a provider method. To avoid the spec/impl clash, define on `MediaProvider`:

```ts
  status(providerJobId: string): Promise<Pick<MediaJob, 'status' | 'resultUrls' | 'error' | 'credits'>>
```

Gateway `status(eyasJobId)` loads the row, calls `provider.status(row.providerJobId)`, merges, saves, ingests on transition to `completed`.

- [ ] **Step 4: Re-run — must pass**

Run: `bunx vitest run tests/modules/media/gateway.test.ts`

Expected: PASS.

---

### Task 2: Routing + budget

**Files:**
- Create: `src/modules/media/settings-store.ts`, `routing.ts`, `budget.ts`
- Test: `tests/modules/media/routing.test.ts`

**Interfaces:**
- Consumes: `MediaKind`, `MediaSettings`, `MediaKindRouting` from `types.ts` (Task 1).
- Produces:

```ts
export function defaultMediaSettings(): MediaSettings  // every kind: all null / [] / false

export function suggestedProviderId(kind: MediaKind): string
// upscale|image|edit → magnific; video → higgsfield; audio|3d → fal

export function resolveProviders(input: {
  kind: MediaKind
  provider?: string
  providers?: string[]
  settings: MediaSettings
  configuredIds: string[]          // providers with configured === true that list this kind
}): string[]  // may be empty — caller turns that into the tool error
```

`budget.ts`:

```ts
export function assertBudget(input: {
  providerId: string
  settings: MediaSettings
  spentDaily: number
  spentMonthly: number
}): void  // throws Error with message starting 'budget:' when exceeded
```

- [ ] **Step 1: Tests**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { defaultMediaSettings, resolveProviders, suggestedProviderId } from '@modules/media/routing'
import { assertBudget } from '@modules/media/budget'
import type { MediaSettings } from '@modules/media/types'

function settings(over: Partial<MediaSettings> = {}): MediaSettings {
  return { ...defaultMediaSettings(), ...over, routing: { ...defaultMediaSettings().routing, ...(over.routing ?? {}) } }
}

describe('resolveProviders', () => {
  it('uses providers[] when set', () => {
    expect(resolveProviders({
      kind: 'image', providers: ['fal', 'magnific'], settings: settings(), configuredIds: ['fal', 'magnific'],
    })).toEqual(['fal', 'magnific'])
  })

  it('rejects an unconfigured pin', () => {
    expect(resolveProviders({
      kind: 'image', provider: 'magnific', settings: settings(), configuredIds: ['fal'],
    })).toEqual([])
  })

  it('falls back to the only configured provider that supports the kind', () => {
    expect(resolveProviders({
      kind: 'image', settings: settings(), configuredIds: ['fal'],
    })).toEqual(['fal'])
  })

  it('uses the suggestion when that provider is configured and nothing is pinned', () => {
    expect(suggestedProviderId('upscale')).toBe('magnific')
    expect(resolveProviders({
      kind: 'upscale', settings: settings(), configuredIds: ['magnific', 'fal'],
    })).toEqual(['magnific'])
  })

  it('includes alsoRunOn', () => {
    const s = settings()
    s.routing.image.defaultProviderId = 'magnific'
    s.routing.image.alsoRunOn = ['fal']
    expect(resolveProviders({
      kind: 'image', settings: s, configuredIds: ['magnific', 'fal'],
    })).toEqual(['magnific', 'fal'])
  })
})

describe('assertBudget', () => {
  it('throws when daily cap would be exceeded', () => {
    expect(() => assertBudget({
      providerId: 'fal',
      settings: { ...defaultMediaSettings(), budget: { fal: { dailyCredits: 10, monthlyCredits: null } } },
      spentDaily: 10,
      spentMonthly: 10,
    })).toThrow(/budget:/)
  })

  it('allows unknown spend (null credits do not block — caller passes 0)', () => {
    expect(() => assertBudget({
      providerId: 'fal',
      settings: defaultMediaSettings(),
      spentDaily: 999,
      spentMonthly: 999,
    })).not.toThrow()
  })
})
```

`spentDaily` is computed by the gateway from `SUM(credits)` where credits is NOT NULL. Unknown (`null`) credits are skipped in the SUM (do not block — spec D).

- [ ] **Step 2: Run — fail**

Run: `bunx vitest run tests/modules/media/routing.test.ts`

- [ ] **Step 3: Implement `routing.ts`, `budget.ts`, `settings-store.ts`**

`settings-store`: `load(db): MediaSettings` (missing row → `defaultMediaSettings()`, insert it), `save(db, settings)`.

`resolveProviders` order (spec §8.1): `providers[]` → `provider` → settings default + fallback-on-empty-configured + alsoRunOn → single configured id → `[]`.

Filter every id against `configuredIds`. Dedup, preserve order.

- [ ] **Step 4: Re-run — pass**

Run: `bunx vitest run tests/modules/media/routing.test.ts tests/modules/media/gateway.test.ts`

---

### Task 3: Ingest

**Files:**
- Create: `src/modules/media/ingest.ts`
- Modify: `src/modules/documents/index.ts` — pass `{ media: { maxFileSizeMb: 200 } }` as the 5th argument to `createDocumentService` (today `_moduleOverrides` is unused — **implement it**: if `input.metadata?.module === 'media'` or a new `UploadInput.module` field `'media'`, apply override). Add `module?: string` to `UploadInput` in `documents/types.ts`. In `upload`, `const limits = (input.module && _moduleOverrides?.[input.module]) ? { ...effectiveLimits, ..._moduleOverrides[input.module] } : effectiveLimits`.
- Test: `tests/modules/media/ingest.test.ts` plus one assertion in `tests/modules/documents/document-service.test.ts` that `module: 'media'` allows a file over 50MB when override is 200.

**Interfaces:**

```ts
export function createIngest(deps: {
  documents: { upload: DocumentService['upload']; link: DocumentService['link'] }
  fetchImpl?: typeof fetch
  maxBytes?: number  // default 200 * 1024 * 1024
}): (job: MediaJob) => Promise<MediaJob>
```

- [ ] **Step 1: Write ingest test** using the 1×1 PNG from `document-service.test.ts` served via mock fetch.

```ts
it('uploads bytes, links to the conversation as ai, sets documentIds', async () => {
  // mock fetch → PNG_1X1
  const ingest = createIngest({ documents: service, fetchImpl: mockFetch })
  const next = await ingest({
    ...jobStub,
    conversationId: 'c1',
    resultUrls: ['https://cdn.example/out.png'],
    documentIds: [],
  })
  expect(next.documentIds).toHaveLength(1)
  expect(service.listByOwner('conversations', 'c1')).toHaveLength(1)
})
```

A second test: fetch throws → job stays completed, `error` mentions ingest, `resultUrls` preserved.

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement ingest**

For each URL: fetch 60s timeout, cap `maxBytes`, `documents.upload({ file, filename: basename or `media-${job.id}${ext}`, createdBy: job.userId ?? 'agent', metadata: { mediaJobId: job.id, providerId: job.providerId, kind: job.kind }, module: 'media' })`, then `link(id, 'conversations', job.conversationId, 'ai')` when `conversationId` is set. Never JPEG-re-encode.

- [ ] **Step 4: Pass**

Run: `bunx vitest run tests/modules/media/ingest.test.ts tests/modules/documents/document-service.test.ts`

---

### Task 4: Five tools

**Files:**
- Create: `src/modules/media/tools.ts`
- Test: `tests/modules/media/tools.test.ts`

**Interfaces:**

```ts
export function createMediaTools(deps: {
  getGateway: () => MediaGateway | undefined
  getSettings: () => MediaSettings
  sumCredits: (providerId: string, sinceIso: string) => number
}): ToolImplementation[]
```

Tools: `media_generate`, `media_wait`, `media_catalog`, `media_balance`, `media_history`.

`media_generate` / `media_wait`: `category: 'custom'`, `riskTier: 'yellow'`.
`media_catalog` / `media_history` / `media_balance`: `category: 'custom'`, `riskTier: 'green'`.

Zero providers / unconfigured pin: return `{ error: 'No media provider configured for this kind. Open /media and connect Magnific, Higgsfield, or fal.' }` — never throw out of `execute`.

Fan-out: `resolveProviders` → for each id `assertBudget` then `gateway.generate`. Return `{ jobs: MediaJob[] }`.

`media_wait`: `gateway.status` in a loop every 2s until terminal or `timeoutMs` (default 180000, max 600000). After terminal completed, gateway ingest already ran in `status()`.

- [ ] **Step 1: Test generate with fake provider via gateway; test empty-provider error string.**

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement tools.ts** — JSON Schema `inputSchema` matching spec §8.

- [ ] **Step 4: Pass**

Run: `bunx vitest run tests/modules/media/tools.test.ts`

---

### Task 5: Module, routes, CASL, bootstrap

**Files:**
- Create: `src/modules/media/routes.ts`, `index.ts`
- Modify: `src/core/bootstrap.ts` — `import { mediaModule } from '@modules/media/index'` and `register` **after** `communicationModule` (MCP client) and `documentsModule`.
- Modify: `src/modules/tools/index.ts` — add `'media'` to `optional`.
- Test: `tests/modules/media/routes.test.ts` (copy the MCP routes test's auth harness from `tests/modules/communication/mcp/registry.test.ts` — the Hono + `createAuthMiddleware` + owner token pattern).

**Interfaces:**
- `createMediaRoutes(app: Hono, gw: MediaGateway, settings: { load(): MediaSettings; save(s: MediaSettings): void })`
- Paths from spec §12. Zod bodies. `requirePermission('read'|'create'|'manage', 'Media')`.
- `index.ts`: `id: 'media'`, `type: 'core'`, `required: false`, `dependencies: ['secrets']`, `optional: ['documents', 'conversations', 'communication', 'tools', 'audit']`, `submodules: [magnificManifest, higgsfieldManifest, falManifest]` — **stub manifests** that no-op `onStart` until T6–T8, but files must exist:

```ts
export const magnificManifest: SubmoduleManifest = {
  id: 'media.magnific', name: 'Magnific', parentModule: 'media', enabled: true,
  async onStart() { /* T6 */ },
}
```

Same for higgsfield, fal.

`onRegister`: `createMediaTables`, `registerSubject('Media', { actions: ['read','create','manage'], defaults: { owner: ['manage'], admin: ['manage'], user: ['read','create'], agent: ['create'], guest: [] } })`.

`onStart`: `createMediaGateway`, attach ingest if `ctx.documents`, `(ctx as any).media = gateway` **and** `{ gateway, settings, generate: gateway.generate.bind(gateway), listJobs: gateway.listJobs.bind(gateway) }` so conversations can call `ctx.media.listJobs`. Register tools onto `ctx.tools.registry` if present. `createMediaRoutes`. Bus emit `eyas.media.job.updated` on save; WS `WS_TOPICS.media` ping (add the key in T9 together with the page — **until T9**, emit on the bus only, do **not** add a WS topic yet, or the contract test fails for a one-sided topic).

- [ ] **Step 1: Route test GET `/api/v1/media/providers` as owner → `{ providers: [] }`.**

- [ ] **Step 2: Fail / implement / pass.**

Run: `bunx vitest run tests/modules/media/`

---

### Task 6: Magnific adapter

**Files:**
- Modify: `src/modules/media/submodules/magnific/adapter.ts`, `manifest.ts`
- Test: `tests/modules/media/magnific-adapter.test.ts`

**Interfaces:**

```ts
export function createMagnificAdapter(deps: {
  mcp: Pick<McpClient, 'callTool' | 'list' | 'add' | 'connect' | 'get'>
  secrets: Pick<SecretsRegistry, 'get'>
  logger: Logger
}): MediaProvider  // id: 'magnific'
```

`configured`: true when an `mcp_servers` row named `magnific` is `status === 'connected'` **or** oauth access secret exists. `connect()`: find-or-add MCP server `{ name: 'magnific', transport: 'sse', url: 'https://mcp.magnific.com', authType: 'oauth', ownedBy: 'media', autoStart: true }` then `mcp.connect(id)`. Never throw out of `onStart`.

Tool map (spec §11.1). Snapshot fixture `tests/modules/media/fixtures/magnific-tools.json` as `[{ "name": "images_generate" }, { "name": "images_upscale" }, …]` matching the spec table. Adapter `generate` for `kind: 'upscale'` calls `images_upscale` with `mode` from `req.options.mode` (`creative` | `precision`). `kind: 'image'` → `images_generate`. Wait/status → `creation_status` / `creations_wait`. Balance → `account_balance`.

If `callTool` returns `{ error }`, job `failed` with that message.

- [ ] **Step 1: Test with a fake `callTool` that records name+args and returns `{ result: { content: [{ type: 'text', text: '{"task_id":"t1","status":"COMPLETED","url":"https://cdn/x.png"}' }] } }`.** Parse vendor payload defensively (JSON in text content **or** structured `result`).

- [ ] **Step 2–4:** fail / implement / pass.

`manifest.onStart`: build adapter, `await adapter.connect()` (catch + log), `ctx.media.registerProvider(adapter)` if `ctx.media.registerProvider` exists.

---

### Task 7: fal adapter

**Files:** `src/modules/media/submodules/fal/{adapter.ts,manifest.ts}`, `tests/modules/media/fal-adapter.test.ts`

Same `MediaProvider` shape, `id: 'fal'`. MCP URL `https://mcp.fal.ai/mcp`, `authType: 'bearer'`. `connect()` reads `fal-api-key` from secrets (`system`, trusted) and `add`/`update` the MCP row with `apiKey` (the transport sends Bearer).

Generate: image → `run_model` with default `endpoint_id: 'fal-ai/flux/dev'` when `model` omitted. Video/3d → `submit_job`. Status → `check_job` + `get_job_result`. Catalog → `search_models`. Balance → `null`.

Fixture: `tests/modules/media/fixtures/fal-tools.json` listing the 11 tool names from the spec.

---

### Task 8: Higgsfield adapter

**Files:** `src/modules/media/submodules/higgsfield/{adapter.ts,manifest.ts}`, `tests/modules/media/higgsfield-adapter.test.ts`, fixture `higgsfield-tools.json`.

`id: 'higgsfield'`. URL `https://mcp.higgsfield.ai/mcp`, OAuth, `ownedBy: 'media'`.

**Do not hardcode 40 model endpoints.** On first `catalog()`/`generate()`, `callTool` `tools/list` analogue: use whatever names exist in the fixture. Implementation: `const TOOL = { generate: pick(list, [/generat/, /image/, /video/]), wait: pick(list, [/wait/, /status/]), balance: pick(list, [/balance/, /credit/]) }` with explicit overrides if the live names from docs are known (`generate_image` etc.). Snapshot the fixture from a recorded `tools/list` **once**; until a live capture exists, put:

```json
[
  { "name": "generate_image" },
  { "name": "generate_video" },
  { "name": "creations_wait" },
  { "name": "account_balance" }
]
```

and map `kind: 'image' → generate_image`, `video → generate_video`. REST Key:Secret fallback only when MCP row is disconnected **and** both `higgsfield-api-key` and `higgsfield-api-secret` exist: POST `https://api.higgsfield.ai/...` is **out of the first adapter cut** if MCP works. Skip REST in v1 of this task unless MCP `configured` is false and both secrets exist — then `configured` stays true and `generate` throws `'Higgsfield REST fallback is not implemented in v1 — connect MCP via /media'`. (YAGNI vs spec §11.2 REST fallback: spec allows REST if MCP unconfigured. Implement a **stub error**, not a second HTTP client, unless the MCP tests cannot cover generate. Prefer MCP-only.)

---

### Task 9: `/media` UI + nav + WS topic + connections catalog

**Files:**
- Create: `src/web/src/pages/media/media-page.tsx`, `i18n.ts`, `locales/{en,hu,de,es,fr,tlh}.json`
- Create: `src/web/src/routes/media.tsx` (copy `providers.tsx`; **do not** edit `routeTree.gen.ts` — Vite plugin regenerates it)
- Modify: `src/web/src/components/layout/sidebar.tsx` — add `{ path: '/media', labelKey: 'nav.media', icon: ImageIcon }` immediately after `/providers` in `nav.group.aiModel`
- Modify: six `src/web/src/components/layout/locales/*.json` — `nav.media`
- Modify: `src/shared/ws-topics.ts` — `media: 'media'`
- Modify: `src/modules/media/gateway.ts` (or `index.ts`) — after saveJob, `(ctx as any).wsRegistry?.broadcast(WS_TOPICS.media, { type: 'refetch' })`
- Modify: `src/modules/connections/catalog.ts` — three rows `id: 'magnific'|'higgsfield'|'fal'`, `adapter: 'mcp'`, category AI / Integrations
- Test: `tests/contracts/ws-topics.contract.test.ts` will fail if only one side uses the key — the page **must** `import { WS_TOPICS } from '@/lib/ws-topics'` and `subscribe(WS_TOPICS.media, ...)`.

**Locales — `nav.media`:**

| File | Value |
|------|--------|
| en | Media |
| hu | Média |
| de | Medien |
| es | Media |
| fr | Médias |
| tlh | nagh beQ |

**Page `en.json`** (flat keys, matching providers page style if nested follow that file):

```json
{
  "media.title": "Media",
  "media.subtitle": "Connect Magnific, Higgsfield, or fal. The agent uses one set of tools; you choose the backends.",
  "media.connect": "Connect",
  "media.disconnect": "Disconnect",
  "media.test": "Test",
  "media.configured": "Connected",
  "media.unconfigured": "Not connected",
  "media.balance": "Balance",
  "media.routing": "Routing",
  "media.routing.kind": "Kind",
  "media.routing.default": "Default",
  "media.routing.fallback": "Fallback",
  "media.routing.also": "Also run on",
  "media.budget": "Budget",
  "media.budget.daily": "Daily credit cap",
  "media.budget.monthly": "Monthly credit cap",
  "media.expert": "Expose raw vendor MCP tools to agents",
  "media.jobs": "Recent jobs",
  "media.empty": "No media provider connected. Connect one below to generate images, video, or upscales.",
  "media.kind.image": "Image",
  "media.kind.video": "Video",
  "media.kind.audio": "Audio",
  "media.kind.upscale": "Upscale",
  "media.kind.edit": "Edit",
  "media.kind.3d": "3D",
  "media.oauth.redirect": "Continue in the browser to sign in, then return here."
}
```

Mirror every key in hu/de/es/fr/tlh (do not leave English in non-en files).

hu: Csatlakozás / Leválasztás / Teszt / Csatlakozva / Nincs csatlakoztatva / Egyenleg / Útválasztás / Típus / Alapértelmezett / Tartalék / Ezen is futtasd / Keret / Napi kreditplafon / Havi kreditplafon / Nyers vendor-MCP toolok az ágenseken / Legutóbbi feladatok / Nincs média-provider. Csatlakoztass egyet a kép, videó vagy upscale generáláshoz. / Kép / Videó / Hang / Nagyítás / Szerkesztés / 3D / Folytasd a böngészőben a belépést, aztán gyere vissza.

de/es/fr/tlh: full translations of the same keys (German: Verbinden/Trennen/Testen/Verbunden/Nicht verbunden/…; Spanish: Conectar/Desconectar/…; French: Connecter/Déconnecter/…; Klingon: rar / wI'ol / nID / rarchu' / rarbe' / …).

Page behaviour: GET `/media/providers`, cards, Connect → POST `/media/providers/:id/connect` (backend starts OAuth or validates key; if response `{ url }` then `window.location.assign`). Routing table PUT `/media/settings`. Jobs GET `/media/jobs`. Subscribe `WS_TOPICS.media` and refetch.

- [ ] **Step 1: Add `nav.media` + WS key + page + route.** Run `bunx vitest run tests/contracts/ws-topics.contract.test.ts tests/core/i18n-parity.test.ts` if the latter exists.

- [ ] **Step 2:** If i18n-parity fails, add the missing keys. If ws-topics fails, the page is not importing `WS_TOPICS.media` or backend is not broadcasting it.

---

### Task 10: Conversation attachment merge

**Files:**
- Modify: `src/modules/conversations/routes.ts` — in the `collectWorkspaceOutputs` block (~1165), after that try/catch, also:

```ts
                  const media = getMedia?.()
                  if (media?.listJobs) {
                    try {
                      const jobs = media.listJobs({ conversationId: id, since: turnStartedMs })
                      for (const job of jobs) {
                        for (const docId of job.documentIds ?? []) {
                          if (!producedIds.includes(docId)) producedIds.push(docId)
                        }
                      }
                    } catch { /* attaching media must never cost the turn its answer */ }
                  }
```

- Modify: `src/modules/conversations/index.ts` — pass `getMedia: () => (ctx as any).media` as a new last argument (or into the existing factory). **Update every test** that calls `createConversationRoutes` with a long positional list: add `undefined` for `getMedia` if they break on arity (JS extra args are fine; missing is also fine if the param is last and optional). Grep `createConversationRoutes(` and fix compile errors only.
- Test: `tests/modules/media/turn-attach.test.ts` — unit-test a tiny helper instead of the whole route if the route harness is heavy:

Extract in `src/modules/media/turn-attach.ts`:

```ts
export function collectMediaDocumentIds(
  jobs: Array<{ documentIds: string[] }>,
  already: string[],
): string[] {
  const out = [...already]
  for (const job of jobs) {
    for (const id of job.documentIds ?? []) {
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}
```

Use that helper in the route. Test the helper. The route change is a 10-line call.

- [ ] **Step 1–4:** test helper / implement helper + route call / pass `tests/modules/media/turn-attach.test.ts`.

---

### Task 11: Skill, product docs, architecture, CHANGELOG

**Files:**
- Create: `config/skills/integrations/media-creative.md`
- Create: `packages/docs/src/content/docs/en/ai/media.md` (if the docs site uses per-locale folders, add `hu/ai/media.md` with Hungarian; other locales at least English stub **only if the repo already stubs missing locales that way** — otherwise add the same six-language requirement as UI by writing all locale files that the docs tree already has for `ai/mcp.md`)
- Modify: `packages/docs/src/content/docs/en/ai/mcp.md` — one sentence linking to Media
- Modify: `packages/docs/src/content/docs/en/automation/tools.md` — mention the five `media_*` tools
- Modify: `docs/eyas-architecture.md` — short **Media module** paragraph (DONE, extra/core `required: false`, three adapters, five tools)
- Modify: `CHANGELOG.md` — bullets under the current `[0.8.16-beta]` section **without** bumping the version (or a new `## [Unreleased]` section if that heading already exists; if not, add `## [Unreleased]` at the top)

**Skill body (frontmatter + rules from spec §14):**

```md
---
name: media-creative
description: Generate and upscale images, video, and audio through EYAS media providers (Magnific, Higgsfield, fal)
type: integration
trigger_patterns:
  - "generate an image"
  - "upscale"
  - "image to video"
  - "text to image"
  - "magnific"
  - "higgsfield"
  - "fal.ai"
capabilities:
  - media-generation
version: "1.0.0"
---
# Media generation

Use `media_catalog` before inventing model ids. Use `media_generate` then `media_wait`. Do not call raw vendor MCP tools unless the owner enabled expert mode.

Upscale: Magnific `precision` for logos, UI, and text; `creative` for art. Send original bytes or documentId for references — never JPEG recompress. Credits cost money; do not set `providers` unless the user asked for more than one backend. Vendor URLs expire; rely on returned `documentIds`.
```

**CHANGELOG Unreleased bullets (English, past tense, user voice — match existing style):**

- Agents can generate, upscale, and wait on images/video through five `media_*` tools.
- Magnific, Higgsfield, and fal are optional backends; none is default; several can run at once.
- Completed files are stored in Documents and attached to the turn that produced them.

- [ ] **Step 1:** Add the files. Run `bunx vitest run tests/modules/media/ tests/modules/communication/mcp/ tests/contracts/ws-topics.contract.test.ts`

Expected: PASS.

---

## Spec coverage

| Spec | Task |
|------|------|
| D1 media module | T5 |
| D2 five tools | T4 |
| D3 MCP transport | MCP plan |
| D7 fail-closed | T4, T5 |
| D8 fan-out / alsoRunOn | T2, T4 |
| D9 ingest | T3, T10 |
| D10–D11 routing suggestions | T2 |
| D12 expert flag | T9 (toggle + settings); wiring raw MCP tools = `mcpClient` `refresh` + existing `registerToolsInRegistry` when flag is true — implement in T5 `onStart` watching settings |
| D13 yellow risk | T4 |
| D14 no SDK | all adapters |
| D15 three adapters | T6 T7 T8 |
| §8.6 turn attach | T10 |
| §12 HTTP | T5 |
| §13 UI | T9 |
| §14 skill | T11 |
| §15 audit | T5: `ctx.audit?.log` on generate/cancel if audit exists; skip if not |
| §16 tests | T1–T8, T10 |
| §17 docs | T11 |
| Connections catalog | T9 |

## Expert-mode wiring (folded into T5)

When `settings.expertRawMcpTools` is true, for each media-owned MCP server (`ownedBy === 'media'`) call the same `registerToolsInRegistry` path the MCP client uses on connect. When false, do not register `mcp_magnific_*` tools. Toggling via PUT `/settings` reconnects those servers.

## Placeholder scan

Higgsfield live tool names are fixture-driven (T8). REST fallback for Higgsfield is an explicit stub error, not a hidden TODO.
)
