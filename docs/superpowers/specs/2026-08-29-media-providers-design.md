# Media Providers — Design

**Date:** 2026-08-29
**Status:** Draft for review
**Modules:** new `media`; upgrades `communication.mcp-client`; touches `tools`, `documents`, `conversations`, `connections`, `secrets`, `permissions`, `bootstrap`, frontend Settings/MCP/conversations
**Predecessor (decisions, not re-litigated):**
- Prefer MCP over custom adapters (`project_eyas_mcp_over_custom`)
- Vendor-neutral, never default a named SaaS (`feedback_eyas_vendor_neutral`, Architecture Rule 1)
- Fireflies fail-closed unconfigured provider (`src/modules/meeting/`)

---

## 1. Problem

EYAS can talk, write files, and attach documents. It cannot generate, upscale, or
wait on images/video/audio through a first-class, user-chosen backend.

Three hosted creative platforms are in scope for the first wave:

| Vendor | Hosted MCP | REST | Auth on MCP |
|--------|------------|------|-------------|
| Magnific (ex-Freepik) | `https://mcp.magnific.com` | `https://api.magnific.com` (`x-magnific-api-key`) | OAuth 2.0 |
| Higgsfield | `https://mcp.higgsfield.ai/mcp` | `https://api.higgsfield.ai` (`Authorization: Key id:secret`) | OAuth 2.0 |
| fal | `https://mcp.fal.ai/mcp` | fal Model APIs (`Authorization: Bearer FAL_KEY`) | Bearer key (OAuth not yet) |

Dumping each vendor's raw MCP tool list onto the agent is the wrong product:

- 30 + ~15 + 11 tools in one prompt. The model picks the wrong one.
- Results are CDN URLs. Higgsfield output URLs expire in **7 days**.
- EYAS MCP client cannot speak their transports today (see §3).
- Magnific in-app Agents / Spaces / Flows are a competing orchestrator, not an API.

The user must be able to enable **none, one, or several** backends, set per-kind
defaults, and run the same prompt on more than one at once.

## 2. Scope

In scope:

1. Upgrade the MCP client so hosted Streamable HTTP servers work: session,
   extra headers, OAuth, long `tools/call`.
2. A new `media` core module (`required: false`) with a provider gateway,
   job store, five unified tools, and local ingest into documents + the
   producing chat turn.
3. Three provider submodules: `media.magnific`, `media.higgsfield`, `media.fal`.
   Each is independently toggleable. Zero configured providers = fail-closed
   empty state (Fireflies pattern).
4. Settings → Media: connect, routing, budget, expert-mode raw MCP tools.
5. Catalog entries (MCP + Connections) so discovery matches other SaaS.
6. A `media-creative` skill. Six-language i18n on every user-facing string.

Out of scope (explicit):

- Hosting Magnific Spaces, Flows, or in-app Agents inside EYAS.
- One EYAS tool per vendor model (Kling, Flux, Mystic, …). The catalog is
  the vendor's; we expose kinds + optional `model`.
- Replicate, local Stable Diffusion, ComfyUI as v1 adapters (the interface
  is built so they can be added later).
- A first-class Media studio page (gallery beyond documents + conversation
  attachments). Jobs list lives on the Media settings page.
- Using Magnific stock download as a default path (REST-only, licensing).
  Allowed later behind the Magnific adapter, not in the five tools.

## 3. Verified evidence

Every claim below was read from this repository, not inferred.

### 3.1 — MCP client cannot talk to these servers

`src/modules/communication/submodules/mcp-client/types.ts` transports:
`stdio | http | sse`. Auth is a single optional `apiKey` stored on
`mcp_servers.api_key`, sent as `Authorization: Bearer`.

`transports/http.ts`: `connect()` GETs `${url}/info` (Magnific/Higgsfield/fal
have no such path), then POSTs JSON with a **30s** `AbortSignal.timeout`.

`transports/sse.ts`: `connect()` POSTs `initialize` and **requires JSON**.
SSE is a best-effort GET to `${url}/sse`. No `MCP-Session-Id`, no
`Accept: text/event-stream` on the request POST, no OAuth.

UI copy already calls SSE "streamable HTTP"
(`packages/docs/src/content/docs/en/ai/mcp.md`). The implementation is not.

Tool registration (`client.ts` `registerToolsInRegistry`): every discovered
tool becomes `mcp_${serverName}_${tool.name}`, category `custom`, risk
`yellow`. There is no ingest, no credit UI, no per-call timeout.

### 3.2 — Model gateway is the right analog

`src/modules/model/gateway.ts` + `submodules/*/manifest.ts`: providers
register on start only when enabled **and** a secret exists; otherwise they
stay silent. `provider-config-service` persists enablement. Frontend:
`src/web/src/pages/providers/`.

### 3.3 — Documents + conversation attachments already exist

`DocumentService.upload` + `link(documentId, ownerModule, ownerId, source)`.
`source` includes `'ai'`. Default limit 50 MB (`document-service.ts`
`DEFAULT_LIMITS`). `_moduleOverrides` is accepted and unused.

Assistant turns already attach produced files via `attachmentIds`
(`conversations/routes.ts` ~1165–1187, `workspace-outputs.ts`). Media
ingest must join that list; documents-only linking is not enough (the
user looks at the message).

`MessageAttachments` renders images inline and other MIME types as chips.

### 3.4 — Meeting/Fireflies is the fail-closed SaaS pattern

`src/modules/meeting/index.ts`: missing secret → provider `configured: false`,
empty lists, no mock data.

### 3.5 — No OAuth client for MCP

Gmail/M365 store refresh tokens as secrets. There is no generic OAuth
authorization-code + PKCE helper, and no `/oauth/callback` for MCP.

### 3.6 — Bootstrap and permissions

Modules register in `src/core/bootstrap.ts`. CASL subjects are registered in
module `onRegister` (`permissions.registerSubject`). Tools register from the
owning module (or `register-builtins.ts` with a lazy `getService` hook —
binding at `onRegister` captures `undefined`).

## 4. Architecture

```
Agent / UI
    │
    ▼
media_generate / media_wait / media_catalog / media_balance / media_history
    │
    ▼
MediaGateway
    │  resolve provider(s) from call + routing settings
    ├─ media.magnific     ──► Magnific MCP (OAuth)  [REST only for stock/analytics later]
    ├─ media.higgsfield   ──► Higgsfield MCP (OAuth) [REST Key:Secret fallback]
    └─ media.fal          ──► fal MCP (Bearer FAL_KEY)
    │
    ▼
media_jobs row (queued → running → completed | failed | cancelled)
    │
    ▼
ingest: download bytes → documents.upload → link(conversations, id, 'ai')
      → media_jobs.document_ids → runner listJobs(since turn start)
      → assistant message attachmentIds
```

Key principle: **the agent never sees vendor tool names by default.** Adapters
call Magnific `images_upscale` / fal `run_model` internally. Expert mode
(settings) additionally registers the raw MCP tools on the ToolRegistry.

The Magnific/Higgsfield/fal in-app agent runtimes stay out. EYAS agents call
EYAS media tools.

## 5. Key decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | New `media` core module, `required: false`. Not `src/modules/magnific/`. | Same shape as `model`. Vendor-neutral. Optional. |
| D2 | Five unified tools, not vendor MCP dumps. | Token cost, routing, ingest, budget. |
| D3 | MCP is the adapter transport. REST is fallback/extension, not the agent path. | Prefer-MCP decision + each vendor's own split. |
| D4 | Upgrade existing `sse` transport to real Streamable HTTP. Keep `http` as naive JSON POST. Do not add a fourth transport enum value. | UI already labels SSE as streamable HTTP; fewer migrations. |
| D5 | OAuth tokens live in the secrets vault (`mcp-oauth-<serverId>-access/refresh`), never in `mcp_servers.api_key`. | Secrets module is the only secret store. |
| D6 | Extra request headers persist as JSON on `mcp_servers.headers` (fal Bearer). | fal has no OAuth; header auth is the supported path. |
| D7 | Zero providers configured → tools return a structured error naming which settings to open. Never mock media. | Fireflies. |
| D8 | Parallel run only when the call has `providers[]` or the kind's `alsoRunOn` is non-empty. Default is one provider. | Credits are money. |
| D9 | Always ingest completed binaries into documents. Vendor URLs are not the product. | Higgsfield 7-day expiry; conversation reload. |
| D10 | Per-kind routing defaults are **suggestions** applied only when that provider is connected. No vendor is a global default. | Vendor-neutral. |
| D11 | Strength hints when the user has not pinned a kind: upscale → Magnific; Soul/character → Higgsfield; model-discovery → fal. Overridable. | Efficiency without lock-in. |
| D12 | Expert-mode raw MCP tools default **off**. | Context pollution. |
| D13 | `media_generate` risk `yellow`. Credit spend + data egress. | Security-gate / approval policy. |
| D14 | No new npm SDK for vendors in v1. HTTP + MCP only. | MIT-compatible, no extra license surface. |
| D15 | First wave ships all three adapters. UI can enable any subset. | User requirement: Magnific and/or Higgsfield and/or fal. |

## 6. MCP client upgrade

Owned by `communication.mcp-client`. Required before any media adapter is useful.
This work is generic — Linear-class hosted MCP servers benefit too.

### 6.1 Streamable HTTP (`sse` transport)

Replace `transports/sse.ts` with MCP Streamable HTTP (spec 2025-03-26):

- Single URL (e.g. `https://mcp.magnific.com` or `https://mcp.fal.ai/mcp`).
- `connect()`: POST `initialize` with
  `Accept: application/json, text/event-stream`,
  `Content-Type: application/json`,
  `MCP-Protocol-Version: 2025-03-26`.
- Parse either a JSON body **or** an SSE stream (`data:` frames).
- Persist `MCP-Session-Id` from the response header for subsequent requests.
- `notifications/initialized` after a successful initialize.
- `send()`: same Accept headers; if the server returns SSE, read until the
  matching JSON-RPC id (or error) arrives. Do **not** assume `/sse` as a
  separate path.
- Timeouts: `connect` 15s; `tools/list` 15s; `tools/call` **default 180s**,
  overridable per call (media adapters pass 10 minutes for video wait tools).
  Remove the hard 30s abort on all transports.
- `disconnect()`: HTTP DELETE to the endpoint with the session id if the
  server advertised session support; otherwise drop locally.

`http` transport stays as simple JSON POST for local/legacy servers, but
**stop requiring GET `/info`**. Probe with `initialize` instead, same as SSE.

### 6.2 Headers

Add `headers TEXT` (JSON object) on `mcp_servers`. Merge into every request.

`McpServerInput.headers?: Record<string, string>`.

fal catalog install sets
`Authorization: Bearer <vault FAL_KEY>` at connect time from secrets, not by
asking the user to paste the key into the headers field.

### 6.3 OAuth 2.0 (MCP)

New helper `src/modules/communication/submodules/mcp-client/oauth.ts`.

Flow:

1. Client hits the MCP URL without a token → `401` +
   `WWW-Authenticate` resource metadata (or GET
   `/.well-known/oauth-protected-resource` on the MCP origin).
2. Discover the authorization server
   (`/.well-known/oauth-authorization-server`).
3. PKCE S256 authorization-code grant. Redirect URI:
   `{publicBaseUrl}/api/v1/mcp/oauth/callback`
   where `publicBaseUrl` is `http://127.0.0.1:<port>` locally, or the
   ingress public URL when set.
4. Callback route exchanges the code, stores tokens in secrets:
   - `mcp-oauth-<serverId>-access`
   - `mcp-oauth-<serverId>-refresh`
   module `communication`, scope `system`.
5. Subsequent MCP requests send `Authorization: Bearer <access>`.
   On 401, refresh once, retry once, else mark server `error` and surface
   "Reconnect" in UI.

`McpServerRecord.authType`: `'none' | 'bearer' | 'oauth'` (new column,
default `'none'`; if `api_key` is set and authType empty, treat as `bearer`
for backward compatibility).

OAuth is **not** implemented as a generic "log into any website" browser
tool. It is MCP-only, using the well-known documents the server publishes.

### 6.4 Catalog entries

Add three **manual / proprietary** entries to `mcpServerRegistry`
(category `AI`):

- Magnific — transport `sse`, URL `https://mcp.magnific.com`, OAuth,
  license Proprietary.
- Higgsfield — transport `sse`, URL `https://mcp.higgsfield.ai/mcp`, OAuth,
  license Proprietary.
- fal — transport `sse`, URL `https://mcp.fal.ai/mcp`, env/secret `fal-api-key`,
  license Proprietary.

Setup guides state: prefer Settings → Media for generation; this catalog
row is for expert/raw MCP or for non-media MCP use. Installing from the
catalog **does** create a usable MCP server; Media settings will adopt it
if the URL matches a known provider (see §9.3).

Connections catalog: three rows, `adapter: 'mcp'`, pointing at those
server names, for health inventory.

## 7. Media module

### 7.1 Shape

```
src/modules/media/
  index.ts              # EyasModule
  types.ts
  schema.ts             # media_jobs, media_settings (JSON blob)
  gateway.ts            # register/resolve/generate/wait
  tools.ts              # five tools
  ingest.ts             # URL/bytes → documents + producedDocumentIds
  routing.ts            # kind → provider(s)
  budget.ts             # per-provider daily/monthly cap
  routes.ts             # /api/v1/media/*
  settings-store.ts
  submodules/
    magnific/manifest.ts + adapter.ts
    higgsfield/manifest.ts + adapter.ts
    fal/manifest.ts + adapter.ts
```

`type: 'core'`, `required: false`,
`dependencies: ['secrets']`,
`optional: ['documents', 'conversations', 'communication', 'tools', 'audit']`.

Register in `bootstrap.ts` after `documents` and `communication` (MCP client
must exist before adapters connect). Tools register in `media.onStart` with
lazy `getGateway` — same trap-avoidance as `register-builtins.ts`.

Frontend: dedicated `/media` route, settings-style (provider cards +
routing + recent jobs), sidebar next to Providers. Not a creative studio
and not a second copy under Settings. `frontend.settings` may still
register a short cut that routes to `/media`.

CASL subject `Media`, actions `read | create | manage`.
Defaults: owner/admin all; user `read`+`create`; agent `create`; guest none.

### 7.2 Provider interface

```ts
export type MediaKind = 'image' | 'video' | 'audio' | 'upscale' | 'edit' | '3d'

export interface MediaProvider {
  id: string                    // 'magnific' | 'higgsfield' | 'fal'
  name: string
  capabilities: readonly MediaKind[]
  configured: boolean           // secrets/oauth present and last connect ok
  connect(): Promise<void>      // no-op if already connected; never throws to boot
  catalog(kind?: MediaKind): Promise<MediaModel[]>
  generate(req: MediaGenerateRequest): Promise<MediaJob>
  status(jobId: string): Promise<MediaJob>
  cancel(jobId: string): Promise<void>
  balance(): Promise<MediaBalance | null>
}

export interface MediaGenerateRequest {
  kind: MediaKind
  prompt: string
  model?: string
  references?: Array<{ url?: string; documentId?: string }>
  options?: Record<string, unknown>  // aspect, duration, scale, mode (creative|precision), …
  webhookHint?: string               // unused in v1 MCP path
}

export interface MediaJob {
  id: string                 // EYAS id
  providerId: string
  providerJobId: string      // vendor task/request id
  kind: MediaKind
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  prompt: string
  model: string | null
  error: string | null
  resultUrls: string[]       // vendor CDNs, ephemeral
  documentIds: string[]      // after ingest
  credits: number | null
  conversationId: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface MediaModel {
  id: string
  label: string
  kind: MediaKind
  providerId: string
}

export interface MediaBalance {
  providerId: string
  credits: number | null
  unit: string               // 'credits' | 'usd'
  raw?: Record<string, unknown>
}
```

Adapters **must not throw in `onStart`**. `configured: false` + log warn.

### 7.3 Persistence

`media_jobs` — one row per provider invocation (a fan-out of two providers
= two rows, same `batchId`).

```
id TEXT PK
batch_id TEXT
provider_id TEXT NOT NULL
provider_job_id TEXT NOT NULL
kind TEXT NOT NULL
status TEXT NOT NULL
prompt TEXT
model TEXT
error TEXT
result_urls TEXT          -- JSON array
document_ids TEXT         -- JSON array
credits REAL
conversation_id TEXT
agent_id TEXT
user_id TEXT
created_at TEXT
updated_at TEXT
completed_at TEXT
```

`media_settings` — single-row JSON (or key/value) blob:

```ts
interface MediaSettings {
  routing: Record<MediaKind, {
    defaultProviderId: string | null
    fallbackProviderId: string | null
    alsoRunOn: string[]          // extra provider ids
  }>
  budget: Record<string, {       // keyed by provider id
    dailyCredits: number | null
    monthlyCredits: number | null
  }>
  expertRawMcpTools: boolean     // default false
}
```

Secrets (vault, module `media`, scope `system`):

| Name | Provider |
|------|----------|
| `magnific-api-key` | Magnific REST (optional v1; MCP uses OAuth) |
| `higgsfield-api-key` + `higgsfield-api-secret` | Higgsfield REST fallback |
| `fal-api-key` | fal MCP Bearer |

OAuth tokens stay under `communication` / `mcp-oauth-*` (D5).

## 8. Tools

All five: `category: 'custom'` (so CLI MCP bridges forward them — same reason
as `design_*`), `riskTier: 'yellow'` except `media_catalog` / `media_history`
which are `green`.

Input schemas are Zod-validated at the HTTP boundary and JSON Schema on the
tool definition.

### 8.1 `media_generate`

```
kind: image | video | audio | upscale | edit | 3d   (required)
prompt: string                                      (required except upscale-from-ref)
provider?: string                                   // magnific | higgsfield | fal
providers?: string[]                                // fan-out; overrides provider
model?: string
documentId?: string                                 // existing EYAS doc as input
imageUrl?: string
options?: {
  aspect?: string
  durationSec?: number
  scale?: 2 | 4 | 8 | 16
  mode?: 'creative' | 'precision'   // Magnific upscale
}
```

Resolution:

1. If `providers` non-empty → those (must all be configured).
2. Else if `provider` set → that one.
3. Else routing for `kind`: default, then fallback on failure, plus `alsoRunOn`.
4. Else if exactly one configured provider supports `kind` → that one.
5. Else error: list configured providers and which kinds they support.

Returns immediately with job id(s) and `status: queued|running`. The adapter
**does not** block the tool call for a 90s 4K render. The agent is expected
to call `media_wait`. (Adapters may complete synchronously if the vendor
returns the file in < 3s; then status is already `completed` and ingest has
run.)

### 8.2 `media_wait`

```
jobId: string
timeoutMs?: number   // default 180000, max 600000
```

Polls the adapter + job row until terminal or timeout. On `completed`,
ingest if `document_ids` still empty. Returns the job including
`documentIds` and conversation-relative attachment hint.

### 8.3 `media_catalog`

Optional `kind`, optional `provider`. Union of `catalog()` from configured
providers. Empty configured set → `{ providers: [], models: [], hint: '…' }`.

### 8.4 `media_balance`

All configured providers. Missing `balance()` → `{ credits: null }`.

### 8.5 `media_history`

Local `media_jobs` for this conversation (or `limit` recent). Never the
vendor dashboard.

### 8.6 Attaching to the producing turn

Do **not** mutate `ToolContext` for this. Claude Code's MCP bridge (and
the Grok/Kimi CLI bridge) can construct a fresh context per `tools/call`,
so an in-context array would drop.

Single path: ingest writes `document_ids` on `media_jobs` (already
required). The conversation runner, in the same block as
`collectWorkspaceOutputs` (`conversations/routes.ts` ~1165), calls
`ctx.media.listJobs({ conversationId, since: turnStartedMs })` and
concatenates every job's `documentIds` into `producedIds` /
`attachmentIds`. Jobs from a previous turn have `created_at` before
`turnStartedMs` and are ignored.

This works for in-process tools and for CLI-bridge tools: both go through
the gateway, both persist jobs, both are visible to the runner at save.

## 9. Routing and budget

`routing.ts` implements D8/D10/D11.

Suggested (not applied until the provider is `configured`):

| Kind | Suggested default |
|------|-------------------|
| upscale | magnific |
| image | magnific |
| edit | magnific |
| video | higgsfield |
| audio | fal |
| 3d | fal |

If the suggested provider is not configured, the next configured provider
that lists the kind wins. User pins override suggestions permanently.

Budget: before `generate`, `budget.ts` sums `media_jobs.credits` for the
provider in the UTC day/month. If the cap would be exceeded → tool error,
no vendor call. Unknown credit (`null`) does not block; log warn. Caps are
optional.

## 10. Ingest

`ingest.ts`:

1. For each `resultUrl`, `fetch` the bytes (timeout 60s, max 200 MB).
2. `documents.upload({ file, filename, createdBy, metadata: { mediaJobId, providerId, kind } })`.
3. `documents.link(id, 'conversations', conversationId, 'ai')`.
4. Record `document_ids` on the job (the runner reads them at turn save, §8.6).
5. Failures: job stays `completed` with `result_urls` and `error` noting
   ingest failure; tool result includes the vendor URL as last resort.

Wire `DocumentService` `_moduleOverrides.media = { maxFileSizeMb: 200 }`
(the parameter exists and is unused today). Videos over 200 MB: skip
upload, keep URL, warn.

Do **not** JPEG-re-encode. Pass through the vendor bytes. Magnific docs
explicitly warn against `canvas.toDataURL('image/jpeg')` for later
upscales.

Reference inputs: if `documentId` is set, download from documents and
either (a) pass a short-lived EYAS URL if ingress is up, or (b) base64
the original file as the vendor accepts. Never recompress.

## 11. Adapters

Each submodule: `onStart` reads secrets / finds-or-creates the MCP server
row / `connect()` / `ctx.media.registerProvider(adapter)`.

Adapters share a small `callMcpTool(serverId, name, args)` helper on the
MCP client (new public method — today execute is closed inside
`registerToolsInRegistry`).

### 11.1 Magnific

MCP tools used internally (names from Magnific docs, live `tools/list`
wins):

| Kind | MCP tool |
|------|----------|
| image | `images_generate` |
| upscale | `images_upscale` (`mode` creative vs precision → vendor params) |
| edit | `images_generate` with references, or vendor edit tool if listed |
| video | `video_generate` |
| audio | `audio_tts` |
| 3d | `models3d_generate` |
| catalog | `images_models_list` / `video_models_list` |
| wait | `creations_wait` / `creation_status` |
| balance | `account_balance` |

Do not wrap Soul training, Spaces, folders, stock in v1 unified tools.
Those remain expert-mode raw MCP.

REST (`x-magnific-api-key`) is **not** required for v1 generate. Keep the
secret slot for a later stock/analytics path.

### 11.2 Higgsfield

MCP `https://mcp.higgsfield.ai/mcp`, OAuth. Map generate/wait/catalog/balance
to whatever `tools/list` returns (their hosted set is generate + Soul +
history + audio; exact names from live list at implement time — snapshot
them in a fixture test, do not hardcode 40 model endpoints).

REST fallback: `Authorization: Key ${id}:${secret}`, POST model endpoint,
poll `status_url`. Use only if MCP is unconfigured but REST secrets exist.

### 11.3 fal

MCP `https://mcp.fal.ai/mcp` with header `Authorization: Bearer <fal-api-key>`.

| Kind | Strategy |
|------|----------|
| catalog | `search_models` + `recommend_model` |
| generate (short) | `run_model` |
| generate (video/3d) | `submit_job` then `media_wait` → `check_job` + `get_job_result` |
| references | `upload_file` first if the schema wants a fal CDN URL |
| balance | not on Run MCP — return `null` unless Platform MCP is added later |

Default models when `model` omitted (overridable in settings later, hardcoded
v1 fallbacks): image `fal-ai/flux/dev`; upscale a current fal upscaler from
`search_models query=upscale`; video via `recommend_model`.

### 11.4 MCP server ownership

On first Connect from Media settings, create (or reuse URL-matched)
`mcp_servers` row:

- `name`: `magnific` / `higgsfield` / `fal` (stable; unified tools depend on it)
- `transport`: `sse`
- `auto_start`: 1
- tag via new column `owned_by TEXT` default null, `'media'` for these

MCP Servers UI: show them, but copy says "Managed by Settings → Media".
Deleting from MCP Servers disconnects the adapter (`configured: false`).

Expert mode (`expertRawMcpTools`): call existing
`registerToolsInRegistry` for that server. Off: adapters still call MCP
internally; tools are **not** duplicated onto the agent.

## 12. HTTP API

Prefix `/api/v1/media`. CASL `Media`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/providers` | id, name, capabilities, configured, balance? |
| POST | `/providers/:id/connect` | start OAuth or validate key |
| POST | `/providers/:id/disconnect` | drop session; keep secrets unless `forget=1` |
| GET | `/settings` | routing + budget + expert flag |
| PUT | `/settings` | Zod-validated replace |
| GET | `/catalog` | query `kind`, `provider` |
| POST | `/generate` | same body as the tool (UI / tests) |
| GET | `/jobs` | list, filter conversationId/status |
| GET | `/jobs/:id` | |
| POST | `/jobs/:id/wait` | |
| POST | `/jobs/:id/cancel` | |

WebSocket topic `media.jobs` (or bus `eyas.media.job.updated`) so the
settings jobs list and the chat rail can refresh. Do not invent a new
WS protocol; follow existing `bus` → websocket fan-out.

## 13. Frontend

Dedicated `/media` route (`src/web/src/pages/media/`), settings-style,
sidebar next to Providers — same pattern as `/providers`. Not a studio.

Cards: Connect / Test / Disconnect, capability badges, balance, last error.
Routing table: one row per `MediaKind`. Budget fields. Expert toggle.
Recent jobs list on the same page.

Conversation: no new chrome. Images/video chips come from `attachmentIds`
after the runner merge in §8.6. A "generating…" placeholder driven by WS
is out of scope for v1.

All copy through `t()`; locales `en hu de es fr tlh`.

## 14. Skill

`config/skills/media-creative.md` (or `config/skills/integrations/media-creative.md`):

- Use `media_catalog` before inventing model ids.
- Prefer `media_generate` + `media_wait`; never raw vendor MCP unless expert
  mode is on.
- Upscale: Magnific `precision` for logos/UI/text; `creative` for art.
- Send original bytes/URL for references; do not JPEG.
- Credits cost money; do not fan-out unless asked.
- Provider URLs expire; rely on returned `documentIds`.

Matcher: generation / upscale / image-to-video language.

## 15. Privacy, security, audit

- Privacy module: connecting a media provider is egress. Surface the same
  class of notice as other SaaS (Fireflies/meeting). No new privacy engine.
- Security-gate: yellow tools already flow through it.
- Audit: every `generate` / `cancel` / ingest write an audit row
  (provider, kind, job id, conversation id). Never log secrets or raw
  image bytes.
- Images leave the box. That is inherent. Do not silently `--no-sandbox`
  anything; this is HTTPS to a named vendor.

## 16. Testing

Must-have (Vitest):

- MCP streamable HTTP transport: JSON initialize, SSE initialize, session
  header round-trip, extra headers, 401→refresh hook (mocked fetch).
- Gateway routing: pin, suggestion, fallback, alsoRunOn, fan-out, zero
  providers, kind not supported.
- Budget cap blocks the vendor call (mock provider).
- Ingest: fake URL → documents.upload + link + job.documentIds
  (temp documents service). Runner merge: jobs since turn start
  appear on the assistant `attachmentIds`.
- Adapter mapping unit tests with recorded `tools/list` fixtures per vendor.
- Tool Zod/JSON schema: missing kind, empty prompt, unknown provider.
- Fireflies-style: magnific adapter with no OAuth → `configured: false`,
  `media_generate` error, no network.

No live vendor calls in CI. Optional manual: `tests/manual/media-smoke.md`.

## 17. Docs and version

- User docs: `packages/docs/src/content/docs/{en,hu,…}/ai/media.md` (or
  under integrations). Link from MCP and Tools pages.
- `CHANGELOG.md` entry on the wave that ships it.
- Architecture `docs/eyas-architecture.md` short section: media module +
  provider list, status DONE when shipped.

No dependency additions unless OAuth/PKCE cannot be done with Web Crypto
already in Bun. If a library is required, MIT/Apache/BSD/ISC only —
check license before adding.

## 18. PR plan

Independently reviewable, each leaves main green.

| PR | Title | Depends | Contents |
|----|-------|---------|----------|
| 1 | MCP Streamable HTTP + headers + timeouts | — | `sse.ts` rewrite, `http.ts` initialize probe, `headers` column, catalog types, tests |
| 2 | MCP OAuth for hosted servers | 1 | `oauth.ts`, callback route, secrets, MCP UI Connect with OAuth, Magnific/Higgsfield/fal catalog entries |
| 3 | Media module skeleton | 1 | module, schema, gateway, five tools (fake in-process provider for tests), ingest, routes, bootstrap, CASL, i18n keys |
| 4 | Magnific + fal + Higgsfield adapters | 2, 3 | three submodules, Connect from settings, routing suggestions, budget |
| 5 | Media settings UI + conversation attach | 4 | `/media` page, six locales, runner `listJobs` merge into `attachmentIds`, WS job updates |
| 6 | Skill, product docs, architecture, CHANGELOG | 5 | `media-creative` skill, Starlight page, architecture paragraph |

PR 4 may split per adapter if review size hurts; order Magnific, fal,
Higgsfield (OAuth shared, Magnific upscale is the highest-value first
connect).

## 19. Open questions

None that block implementation. Settled in the approved chat:

- Multi-vendor, user-chosen, simultaneous OK → D1, D8, D15.
- Efficient Magnific use → unified tools + strength hint, not 30 MCP tools.
- Magnific in-app Agents out of scope → §2.

If OAuth redirect on a remote EYAS without ingress fails, Connect UI
must show the remedy (enable Ingress or paste a public base URL), not
hang. That is an error path, not an open product question.

## 20. Spec self-review

- Placeholders: none. Live Higgsfield MCP tool names are taken from
  `tools/list` at implement time and snapshotted in fixtures (called out
  in §11.2).
- Attachment path is single: `media_jobs.document_ids` + runner
  `listJobs({ since: turnStartedMs })` (§8.6). No ToolContext mutation.
- Scope: one capability (generate media via N providers) + the MCP
  client prerequisite it actually needs. No studio, no stock, no Spaces.
)
