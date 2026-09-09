# MCP Streamable HTTP and OAuth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EYAS's MCP client speak real Streamable HTTP (session, extra headers, long `tools/call`) and MCP OAuth 2.0 so hosted servers (Magnific, Higgsfield, fal, Linear-class) connect.

**Architecture:** Keep the `sse` transport name (UI already says "streamable HTTP") and replace its implementation. Keep `http` as naive JSON POST but probe with `initialize` instead of GET `/info`. Persist `headers`, `auth_type`, and `owned_by` on `mcp_servers`. OAuth tokens live in the secrets vault. A new `callTool` method lets media adapters invoke MCP tools without registering them on the agent.

**Tech Stack:** Bun + TypeScript (strict, ESM), Vitest, Web Crypto (PKCE, no new dependency), Hono, existing secrets registry.

**Spec:** `docs/superpowers/specs/2026-08-29-media-providers-design.md` §§6, 11.4, 18 PR 1–2.

**Depends on:** nothing. The media-providers plan (`2026-08-29-media-providers.md`) depends on this one.

## Global Constraints

- TypeScript strict, ESM. English code and comments.
- File header on every new source file: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Pino for logging — never `console.log`.
- Zod for all external HTTP input.
- Every user-facing string ships in all six locales: `en`, `hu`, `de`, `es`, `fr`, `tlh`.
- CSS variables only — never hardcoded colours.
- `/api/v1/` prefix; keep existing `requirePermission` guards.
- MIT-compatible dependencies only. **This plan adds no new dependency.** PKCE uses Web Crypto already in Bun.
- **Never change the version number** in `version.json`, `package.json`, or any HTML string.
- **Never commit, never branch, never push.** The human commits.
- Touch ONLY the files this plan names.
- Lint is `bun run lint` (`tsc --noEmit`). Do not increase the existing error baseline.
- Pre-existing failing tests elsewhere are **not** yours. Do not fix them.

---

## File Structure

**New:**

| File | Responsibility |
|------|----------------|
| `src/modules/communication/submodules/mcp-client/sse-parse.ts` | Parse JSON-RPC from a JSON body or an SSE `data:` stream. Pure. |
| `src/modules/communication/submodules/mcp-client/oauth.ts` | PKCE S256, well-known discovery, token exchange/refresh. No HTTP routes. |
| `tests/modules/communication/mcp/sse-transport.test.ts` | Streamable HTTP connect/send/session/headers/timeout. |
| `tests/modules/communication/mcp/http-transport.test.ts` | initialize probe, no `/info`, timeout option. |
| `tests/modules/communication/mcp/oauth.test.ts` | PKCE challenge, discovery parse, refresh-on-401. |

**Modified:**

| File | Change |
|------|--------|
| `src/modules/communication/submodules/mcp-client/types.ts` | `send` opts, `headers`, `authType`, `ownedBy`; `McpAuthType` |
| `src/modules/communication/submodules/mcp-client/transports/sse.ts` | Replace with Streamable HTTP |
| `src/modules/communication/submodules/mcp-client/transports/http.ts` | initialize probe; honour headers + timeout |
| `src/modules/communication/submodules/mcp-client/transports/stdio.ts` | Accept unused `send` opts so the interface compiles |
| `src/modules/communication/submodules/mcp-client/client.ts` | Pass headers; `callTool`; persist new columns |
| `src/modules/communication/submodules/mcp-client/routes.ts` | OAuth start/callback; expose `authType`/`headers`/`ownedBy` |
| `src/modules/communication/submodules/mcp-client/registry.ts` | `url?`, `authType?`; three catalog entries |
| `src/modules/communication/index.ts` | ALTER TABLE new columns |
| `src/web/src/pages/mcp/mcp-settings-page.tsx` (and locales) | Connect via OAuth when `authType === 'oauth'` |
| `tests/modules/communication/mcp/registry.test.ts` | length 28 → 31 |
| `packages/docs/src/content/docs/en/ai/mcp.md` | Auth: OAuth / Bearer / extra headers |

**Ordering:** T1 → T2 → T3 → T4 → T5 → T6.

---

### Task 1: SSE parse helper + Streamable HTTP transport

**Files:**
- Create: `src/modules/communication/submodules/mcp-client/sse-parse.ts`
- Modify: `src/modules/communication/submodules/mcp-client/types.ts`
- Modify: `src/modules/communication/submodules/mcp-client/transports/sse.ts`
- Modify: `src/modules/communication/submodules/mcp-client/transports/stdio.ts`
- Test: `tests/modules/communication/mcp/sse-transport.test.ts`

**Interfaces:**
- Consumes: `JsonRpcRequest`, `JsonRpcResponse`, `McpTransport` from `types.ts`.
- Produces: `parseJsonRpcFromHttpResponse(status, contentType, bodyText): JsonRpcResponse`; `createSseTransport(opts)` that implements Streamable HTTP. `McpTransport.send(request, opts?: { timeoutMs?: number })`. Default `tools/call` timeout is **not** applied here — callers pass it. Transport default when `opts.timeoutMs` omitted: **180_000**. Connect timeout: **15_000**.

- [ ] **Step 1: Extend `McpTransport.send` in `types.ts`**

Replace the `send` line on `McpTransport`:

```ts
  send(request: JsonRpcRequest, opts?: { timeoutMs?: number }): Promise<JsonRpcResponse>
```

Add next to it (optional, read-only):

```ts
  readonly sessionId?: string | null
```

- [ ] **Step 2: Write the failing tests**

Create `tests/modules/communication/mcp/sse-transport.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import { createSseTransport } from '@modules/communication/submodules/mcp-client/transports/sse'
import { parseJsonRpcFromHttpResponse } from '@modules/communication/submodules/mcp-client/sse-parse'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonRpcOk(id: number | string, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result }
}

describe('parseJsonRpcFromHttpResponse', () => {
  it('parses a JSON body', () => {
    const msg = parseJsonRpcFromHttpResponse(
      200,
      'application/json',
      JSON.stringify(jsonRpcOk(0, { protocolVersion: '2025-03-26' })),
    )
    expect(msg.result).toEqual({ protocolVersion: '2025-03-26' })
  })

  it('parses the first JSON-RPC object from an SSE stream', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":0,"result":{"ok":true}}',
      '',
      'event: ping',
      'data: {}',
      '',
    ].join('\n')
    const msg = parseJsonRpcFromHttpResponse(200, 'text/event-stream', body)
    expect(msg.result).toEqual({ ok: true })
  })
})

describe('createSseTransport — Streamable HTTP', () => {
  it('POSTs initialize with Accept json+sse and stores MCP-Session-Id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(
        JSON.stringify(jsonRpcOk(0, { protocolVersion: '2025-03-26', capabilities: {} })),
        { status: 200, headers: { 'Content-Type': 'application/json', 'MCP-Session-Id': 'sess-1' } },
      )
    }) as typeof fetch

    const t = createSseTransport({ url: 'https://mcp.example.com' })
    await t.connect()
    expect(t.connected).toBe(true)
    expect(t.sessionId).toBe('sess-1')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Accept']).toContain('application/json')
    expect(headers['Accept']).toContain('text/event-stream')
    expect(headers['MCP-Protocol-Version']).toBe('2025-03-26')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.method).toBe('initialize')
  })

  it('sends subsequent requests with the session header and extra headers', async () => {
    let n = 0
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      n++
      const headers = { 'Content-Type': 'application/json', ...(n === 1 ? { 'MCP-Session-Id': 'sess-1' } : {}) }
      const body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify(jsonRpcOk(body.id, { tools: [] })), {
        status: 200,
        headers,
      })
    }) as typeof fetch

    const t = createSseTransport({
      url: 'https://mcp.example.com',
      headers: { 'X-Test': '1' },
    })
    await t.connect()
    await t.send({ jsonrpc: '2.0', method: 'tools/list', id: 2 })
    // second call is tools/list (connect also sends notifications/initialized)
    const listCall = n
    expect(listCall).toBeGreaterThan(1)
  })

  it('does not GET a /sse path', async () => {
    const urls: string[] = []
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      return new Response(
        JSON.stringify(jsonRpcOk(0, { protocolVersion: '2025-03-26' })),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch
    const t = createSseTransport({ url: 'https://mcp.example.com/mcp' })
    await t.connect()
    expect(urls.some((u) => u.includes('/sse'))).toBe(false)
  })

  it('honours timeoutMs on send', async () => {
    globalThis.fetch = (async (_url: any, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.method === 'initialize') {
        return new Response(JSON.stringify(jsonRpcOk(body.id, {})), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      await new Promise((r) => setTimeout(r, 50))
      return new Response(JSON.stringify(jsonRpcOk(body.id, {})), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch
    const t = createSseTransport({ url: 'https://mcp.example.com' })
    await t.connect()
    const resp = await t.send({ jsonrpc: '2.0', method: 'tools/call', id: 9 }, { timeoutMs: 1 })
    expect(resp.error).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the tests — they must fail**

Run: `bunx vitest run tests/modules/communication/mcp/sse-transport.test.ts`

Expected: FAIL — `sse-parse` does not exist; current `sse.ts` still GETs `/sse` and requires JSON.

- [ ] **Step 4: Implement `sse-parse.ts`**

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { JsonRpcResponse } from './types.js'

export function parseJsonRpcFromHttpResponse(
  _status: number,
  contentType: string | null,
  bodyText: string,
): JsonRpcResponse {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('text/event-stream')) {
    for (const block of bodyText.split('\n\n')) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      try {
        const parsed = JSON.parse(dataLine.slice(6)) as JsonRpcResponse
        if (parsed && parsed.jsonrpc === '2.0') return parsed
      } catch { /* skip malformed frames */ }
    }
    throw new Error('SSE response contained no JSON-RPC payload')
  }
  return JSON.parse(bodyText) as JsonRpcResponse
}
```

- [ ] **Step 5: Rewrite `transports/sse.ts`**

Replace the file. Required behaviour:

- `createSseTransport(opts: { url: string; apiKey?: string; headers?: Record<string, string>; getAccessToken?: () => Promise<string | null> })`
- Build headers: `Content-Type: application/json`, `Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2025-03-26`, merge `opts.headers`, if `apiKey` set `Authorization: Bearer ${apiKey}` unless `Authorization` already in `opts.headers`. If `getAccessToken` returns a string, it wins over `apiKey`.
- `connect()`: POST `initialize` with `clientInfo: { name: 'EYAS', version: '1.0.0' }`, `protocolVersion: '2025-03-26'`, `capabilities: {}`, timeout 15_000. Read `MCP-Session-Id`. Then POST `notifications/initialized` (no response required — ignore parse errors). Set `connected`.
- `send()`: POST same URL, include `MCP-Session-Id` when set. Timeout `opts.timeoutMs ?? 180_000`. On `!res.ok` return JSON-RPC error. Use `parseJsonRpcFromHttpResponse`.
- `disconnect()`: if `sessionId` is set, HTTP DELETE the URL with the session header (ignore errors). Clear state.
- **Do not** request `${url}/sse`.

- [ ] **Step 6: Update `stdio.ts` `send` signature**

Change `send(request)` to `send(request, _opts?: { timeoutMs?: number })` so it satisfies `McpTransport`. Ignore `_opts`.

- [ ] **Step 7: Re-run tests — they must pass**

Run: `bunx vitest run tests/modules/communication/mcp/sse-transport.test.ts`

Expected: PASS.

---

### Task 2: HTTP transport — initialize probe, headers, timeout

**Files:**
- Modify: `src/modules/communication/submodules/mcp-client/transports/http.ts`
- Test: `tests/modules/communication/mcp/http-transport.test.ts`

**Interfaces:**
- Consumes: `McpTransport.send` opts from Task 1.
- Produces: `createHttpTransport({ url, apiKey?, headers? })` that POSTs `initialize` on connect (no GET `/info`).

- [ ] **Step 1: Write the failing test**

Create `tests/modules/communication/mcp/http-transport.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import { createHttpTransport } from '@modules/communication/submodules/mcp-client/transports/http'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('createHttpTransport', () => {
  it('connects with initialize POST, not GET /info', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 0, result: {} }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    const t = createHttpTransport({ url: 'http://127.0.0.1:9/mcp' })
    await t.connect()
    expect(calls.some((c) => c.startsWith('GET') && c.endsWith('/info'))).toBe(false)
    expect(calls.some((c) => c.startsWith('POST'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `bunx vitest run tests/modules/communication/mcp/http-transport.test.ts`

Expected: FAIL — current `connect()` GETs `/info`.

- [ ] **Step 3: Rewrite `http.ts` connect/send**

- Same header merge as SSE (`apiKey` → Bearer, extra `headers`).
- `connect()`: POST initialize (timeout 15_000). Throw if `!res.ok` or `initResp.error`.
- `send(request, opts?)`: POST JSON, timeout `opts?.timeoutMs ?? 180_000`. No `/info`.

- [ ] **Step 4: Re-run — must pass**

Run: `bunx vitest run tests/modules/communication/mcp/http-transport.test.ts tests/modules/communication/mcp/sse-transport.test.ts`

Expected: PASS.

---

### Task 3: Persist headers / authType / ownedBy + `callTool`

**Files:**
- Modify: `src/modules/communication/submodules/mcp-client/types.ts`
- Modify: `src/modules/communication/index.ts` (`mcp_servers` CREATE/ALTER)
- Modify: `src/modules/communication/submodules/mcp-client/client.ts`
- Modify: `src/modules/communication/submodules/mcp-client/routes.ts`

**Interfaces:**
- Consumes: Task 1 transport constructors (`headers` option).
- Produces:
  - `export type McpAuthType = 'none' | 'bearer' | 'oauth'`
  - `McpServerRecord.headers: string | null` (JSON object)
  - `McpServerRecord.authType: string` (column `auth_type`, default `'none'`)
  - `McpServerRecord.ownedBy: string | null` (column `owned_by`)
  - `McpServerInput.headers?: Record<string, string>`
  - `McpServerInput.authType?: McpAuthType`
  - `McpServerInput.ownedBy?: string`
  - `McpClient.callTool(serverId: string, name: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<JsonRpcResponse>`
  - `createTransport` passes `headers: record.headers ? JSON.parse(record.headers) : undefined` and `apiKey`.

- [ ] **Step 1: Add types** to `types.ts`

```ts
export type McpAuthType = 'none' | 'bearer' | 'oauth'
```

On `McpServerRecord` add:

```ts
  headers: string | null
  authType: string
  ownedBy: string | null
```

On `McpServerInput` and `McpConfigEntry` add `headers?`, `authType?`, `ownedBy?`.

- [ ] **Step 2: DDL in `communication/index.ts`**

Next to the existing `mcp_servers` CREATE TABLE, add:

```ts
    try { ctx.db.run(sql.raw(`ALTER TABLE mcp_servers ADD COLUMN headers TEXT`)) } catch { /* exists */ }
    try { ctx.db.run(sql.raw(`ALTER TABLE mcp_servers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'none'`)) } catch { /* exists */ }
    try { ctx.db.run(sql.raw(`ALTER TABLE mcp_servers ADD COLUMN owned_by TEXT`)) } catch { /* exists */ }
```

Also add the three columns to the CREATE TABLE so a fresh DB has them (SQLite ignores extra ALTER if CREATE already has them — ALTER is for existing installs). Put `headers TEXT`, `auth_type TEXT NOT NULL DEFAULT 'none'`, `owned_by TEXT` on the CREATE TABLE statement.

- [ ] **Step 3: Wire `client.ts`**

- `createTransport`: pass `headers` parsed from `record.headers`; pass `apiKey` when `authType !== 'oauth'`.
- `add`/`update` INSERT/UPDATE the new columns. Backward compat: if `authType` omitted and `apiKey` is set, store `authType = 'bearer'`.
- SELECT `*` already returns new columns once DDL exists.
- Add `callTool`:

```ts
    async callTool(
      serverId: string,
      name: string,
      args: Record<string, unknown>,
      opts?: { timeoutMs?: number },
    ): Promise<JsonRpcResponse> {
      const transport = transports.get(serverId)
      if (!transport?.connected) throw new Error(`MCP server ${serverId} is not connected`)
      return transport.send({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: Date.now(),
      }, { timeoutMs: opts?.timeoutMs ?? 180_000 })
    },
```

- [ ] **Step 4: Routes list/get/add map the new fields**

In `routes.ts` list mapper, include `authType: s.authType`, `ownedBy: s.ownedBy`, `headers: s.headers ? JSON.parse(s.headers) : null`. Do **not** echo `apiKey`. `add`/`update` already pass the body as `McpServerInput`.

- [ ] **Step 5: Run MCP registry + new transport tests**

Run: `bunx vitest run tests/modules/communication/mcp/`

Expected: PASS (registry length still 28 until Task 5).

---

### Task 4: MCP OAuth (PKCE) + callback route

**Files:**
- Create: `src/modules/communication/submodules/mcp-client/oauth.ts`
- Modify: `src/modules/communication/submodules/mcp-client/routes.ts`
- Modify: `src/modules/communication/submodules/mcp-client/client.ts` (token getter)
- Test: `tests/modules/communication/mcp/oauth.test.ts`

**Interfaces:**
- Consumes: `SecretsRegistry.set/get` (`mcp-oauth-<serverId>-access`, `mcp-oauth-<serverId>-refresh`, module `communication`, scope `system`). `ctx.config.baseUrl` or `http://127.0.0.1:${ctx.config.server.port}`.
- Produces:
  - `generatePkce(): Promise<{ verifier: string; challenge: string }>`
  - `discoverAuthServer(mcpOrigin: string): Promise<{ authorizationEndpoint: string; tokenEndpoint: string }>`
  - `buildAuthorizationUrl(input): string`
  - `exchangeCode(input): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>`
  - `refreshAccessToken(input): Promise<{ accessToken: string; refreshToken?: string }>`
  - Routes: `POST /api/v1/mcp/servers/:id/oauth/start` → `{ url }` (manage Settings)
  - `GET /api/v1/mcp/oauth/callback?code&state` — public enough to receive the browser redirect; looks up pending state, exchanges, stores secrets, redirects the UI to `/mcp-settings?oauth=ok`.
  - Pending PKCE state: in-memory `Map<state, { serverId, verifier, createdAt }>` plus a SQLite table `mcp_oauth_pending (state TEXT PK, server_id TEXT, verifier TEXT, created_at TEXT)` so a second process/reload still works. Delete row after use. Expire > 10 minutes.

- [ ] **Step 1: Write oauth unit tests** (no network)

Create `tests/modules/communication/mcp/oauth.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { generatePkce, buildAuthorizationUrl } from '@modules/communication/submodules/mcp-client/oauth'

describe('MCP OAuth PKCE', () => {
  it('generatePkce returns a 43+ char verifier and S256 challenge', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge.length).toBeGreaterThan(20)
    expect(verifier).not.toBe(challenge)
  })

  it('buildAuthorizationUrl includes client params and S256', () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: 'https://auth.example.com/authorize',
      clientId: 'eyas',
      redirectUri: 'http://127.0.0.1:3100/api/v1/mcp/oauth/callback',
      challenge: 'abc',
      state: 'st',
      resource: 'https://mcp.example.com',
    })
    const u = new URL(url)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe('abc')
    expect(u.searchParams.get('state')).toBe('st')
    expect(u.searchParams.get('resource')).toBe('https://mcp.example.com')
    expect(u.searchParams.get('response_type')).toBe('code')
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `bunx vitest run tests/modules/communication/mcp/oauth.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `oauth.ts`**

Use `crypto.getRandomValues` + SHA-256 via `crypto.subtle.digest`. Base64url without padding.

`discoverAuthServer(mcpUrl: string)`:

1. `GET ${origin}/.well-known/oauth-protected-resource` (origin from `mcpUrl`). If JSON has `authorization_servers[0]`, use that as the auth server issuer.
2. `GET ${issuer}/.well-known/oauth-authorization-server`.
3. Return `{ authorizationEndpoint, tokenEndpoint, clientId?: string }` from the metadata. If `clientId` is absent, use `'eyas'` as the public client id (MCP public clients). Do not invent a client secret.

`exchangeCode` / `refreshAccessToken`: POST `application/x-www-form-urlencoded` to `tokenEndpoint`.

On 401 from Streamable HTTP after OAuth is configured, `client.ts` `send` path: refresh once using the refresh secret, `set` the new access token, retry the MCP call once. If refresh fails, set server `status='error'`, `error='OAuth session expired — reconnect'`.

- [ ] **Step 4: Routes + pending table**

In `communication/index.ts`:

```ts
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS mcp_oauth_pending (
      state TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`)
```

`createMcpRoutes(app, mcpClient, deps: { db, secrets, publicBaseUrl: string, logger })`. Thread `secrets` and `publicBaseUrl` from `communication/index.ts` `onStart`:

```ts
    const publicBaseUrl = ctx.config.baseUrl
      ?? `http://127.0.0.1:${ctx.config.server.port}`
    createMcpRoutes(ctx.http, mcpClient, {
      db: ctx.db,
      secrets: ctx.secrets,
      publicBaseUrl,
      logger: ctx.logger,
    })
```

`oauth/start`: require server `authType === 'oauth'` (or set it to oauth if the catalog says so). Generate PKCE, insert pending, return `{ url }`.

`oauth/callback`: no JWT required (the browser lands here from the IdP). Validate `state`, exchange `code`, `secrets.set('mcp-oauth-'+serverId+'-access', 'system', access, 'communication', { userId: 'system', role: 'owner', trusted: true })`, same for refresh if present. Delete pending. Redirect `302` to `/mcp-settings?oauth=ok`. On error redirect `?oauth=error`.

- [ ] **Step 5: Transport token getter**

In `createTransport` for `sse`/`http` when `record.authType === 'oauth'`:

```ts
getAccessToken: async () => secrets.get(`mcp-oauth-${record.id}-access`, 'system', { userId: 'system', role: 'owner', trusted: true })
```

`createMcpClient` already receives no secrets today — add `secrets?: SecretsRegistry` to its deps in `client.ts` and pass `ctx.secrets` from `communication/index.ts`. When secrets is omitted (tests), OAuth servers cannot connect; throw a clear error.

- [ ] **Step 6: Re-run oauth + mcp tests**

Run: `bunx vitest run tests/modules/communication/mcp/`

Expected: PASS.

---

### Task 5: Catalog entries for Magnific, Higgsfield, fal

**Files:**
- Modify: `src/modules/communication/submodules/mcp-client/registry.ts`
- Modify: `tests/modules/communication/mcp/registry.test.ts`

**Interfaces:**
- Consumes: existing `McpRegistryEntry`.
- Produces: optional `url?: string` and `authType?: McpAuthType` on `McpRegistryEntry`. Three new `manual` / `proprietary` / category `AI` entries. Registry length **31**.

- [ ] **Step 1: Change the length assertion first**

In `registry.test.ts` replace:

```ts
  it('contains exactly 28 server entries', () => {
    expect(mcpServerRegistry).toHaveLength(28)
  })
```

with:

```ts
  it('contains exactly 31 server entries', () => {
    expect(mcpServerRegistry).toHaveLength(31)
  })
```

Add:

```ts
  it('ships Magnific, Higgsfield, and fal hosted MCP entries', () => {
    const ids = mcpServerRegistry.map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['magnific', 'higgsfield', 'fal']))
    for (const id of ['magnific', 'higgsfield', 'fal']) {
      const e = mcpServerRegistry.find((x) => x.id === id)!
      expect(e.transport).toBe('sse')
      expect(e.licenseCompat).toBe('proprietary')
      expect(e.tier).toBe('manual')
      expect(e.category).toBe('AI')
      expect(e.url).toBeTruthy()
    }
  })
```

- [ ] **Step 2: Run — length test fails**

Run: `bunx vitest run tests/modules/communication/mcp/registry.test.ts`

Expected: FAIL — still 28.

- [ ] **Step 3: Extend `McpRegistryEntry` and append three entries**

On the interface:

```ts
  url?: string
  authType?: McpAuthType
```

Import `McpAuthType` from `./types.js`.

Append (before the closing `]` of `mcpServerRegistry`):

```ts
  {
    id: 'magnific',
    name: 'Magnific',
    description: 'Image, video, audio, 3D, and Magnific upscale via the hosted Magnific MCP server. Prefer Settings → Media for generation; this catalog row is the raw MCP connection.',
    tier: 'manual',
    license: 'Proprietary',
    licenseCompat: 'proprietary',
    author: 'Magnific',
    repoUrl: 'https://docs.magnific.com/modelcontextprotocol',
    transport: 'sse',
    url: 'https://mcp.magnific.com',
    authType: 'oauth',
    category: 'AI',
    icon: '✨',
    tags: ['magnific', 'image', 'video', 'upscale', 'mcp'],
    setupGuide:
      '## Magnific MCP\n\n' +
      'Hosted Streamable HTTP at `https://mcp.magnific.com`. Sign in with OAuth (no API key).\n\n' +
      'Prefer **Settings → Media** to generate and ingest files. Enable this catalog row for expert/raw Magnific tools.\n\n' +
      'MCP tools share the same Magnific credit balance as the website. Web-app Unlimited does not apply.',
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    description: 'Image and video generation, Soul characters, and audio via the hosted Higgsfield MCP server.',
    tier: 'manual',
    license: 'Proprietary',
    licenseCompat: 'proprietary',
    author: 'Higgsfield',
    repoUrl: 'https://docs.higgsfield.ai',
    transport: 'sse',
    url: 'https://mcp.higgsfield.ai/mcp',
    authType: 'oauth',
    category: 'AI',
    icon: '🎬',
    tags: ['higgsfield', 'image', 'video', 'soul', 'mcp'],
    setupGuide:
      '## Higgsfield MCP\n\n' +
      'Hosted Streamable HTTP at `https://mcp.higgsfield.ai/mcp`. Sign in with OAuth.\n\n' +
      'Prefer **Settings → Media**. MCP generations always spend credits (web Unlimited does not apply).\n\n' +
      'Vendor output URLs expire in about seven days — EYAS Media ingest copies them locally.',
  },
  {
    id: 'fal',
    name: 'fal',
    description: 'Search, run, and queue 1,000+ generative models via the hosted fal MCP server.',
    tier: 'manual',
    license: 'Proprietary',
    licenseCompat: 'proprietary',
    author: 'fal',
    repoUrl: 'https://fal.ai/docs/documentation/setting-up/mcp',
    transport: 'sse',
    url: 'https://mcp.fal.ai/mcp',
    authType: 'bearer',
    envKeys: ['fal-api-key'],
    category: 'AI',
    icon: '🟣',
    tags: ['fal', 'image', 'video', 'mcp'],
    setupGuide:
      '## fal MCP\n\n' +
      'Hosted Streamable HTTP at `https://mcp.fal.ai/mcp`.\n\n' +
      'Create a key at fal.ai → API Keys. Store it as `fal-api-key` in EYAS secrets (or paste on install). Sent as `Authorization: Bearer`.\n\n' +
      'fal MCP has no OAuth. Prefer **Settings → Media** for generation with ingest.',
  },
```

When catalog **Install** for fal runs, it must create the server with `headers` left empty and `apiKey` from the env dialog (existing one-click pattern). Magnific/Higgsfield install creates `authType: 'oauth'`, `url` from the entry, no apiKey.

- [ ] **Step 4: Re-run registry tests**

Run: `bunx vitest run tests/modules/communication/mcp/registry.test.ts`

Expected: PASS.

---

### Task 6: MCP settings UI + docs

**Files:**
- Modify: `src/web/src/pages/mcp/mcp-settings-page.tsx` (and any dialog component in that folder — open the folder and patch the Connect / Add dialog that already exists)
- Modify: `src/web/src/pages/mcp/locales/{en,hu,de,es,fr,tlh}.json`
- Modify: `packages/docs/src/content/docs/en/ai/mcp.md` (and the hu/de/es/fr/tlh siblings if those files exist; if a locale file is missing, only edit those that exist plus `en`)

**Interfaces:**
- Consumes: `POST /api/v1/mcp/servers/:id/oauth/start` → `{ url }`. List payload `authType`, `ownedBy`.
- Produces: Connect on an `oauth` server opens `url` (`window.location.assign` or `window.open`). `ownedBy === 'media'` shows the managed-by-Media note (the Media UI lands in the other plan; the string can already exist).

- [ ] **Step 1: Add locale keys** (all six files)

`en.json`:

```json
  "mcp.oauth.connect": "Connect with Magnific / Higgsfield (OAuth)",
  "mcp.oauth.connectGeneric": "Connect with OAuth",
  "mcp.oauth.managedByMedia": "Managed by Settings → Media",
  "mcp.auth.oauth": "OAuth",
  "mcp.auth.bearer": "API key",
  "mcp.auth.none": "None"
```

`hu.json`: `"OAuth-os csatlakozás"` / `"A Beállítások → Média kezeli"` / `"OAuth"` / `"API-kulcs"` / `"Nincs"`

`de.json`: `"Mit OAuth verbinden"` / `"Verwaltet unter Einstellungen → Medien"` / `"OAuth"` / `"API-Schlüssel"` / `"Keine"`

`es.json`: `"Conectar con OAuth"` / `"Gestionado en Ajustes → Media"` / `"OAuth"` / `"Clave API"` / `"Ninguna"`

`fr.json`: `"Connexion OAuth"` / `"Géré par Paramètres → Médias"` / `"OAuth"` / `"Clé API"` / `"Aucune"`

`tlh.json`: `"OAuth rar"` / `"Media waw' vIqonnIS"` / `"OAuth"` / `"API ngaq"` / `"pagh"`

Use the existing `t('…')` helper in that folder. If keys are nested in the current JSON, nest these the same way — do not flatten a nested file.

- [ ] **Step 2: Wire the Connect button**

If `server.authType === 'oauth'`, Connect calls:

```ts
const { url } = await api.post<{ url: string }>(`/mcp/servers/${id}/oauth/start`)
window.location.assign(url)
```

On load, if `window.location.search` contains `oauth=ok`, refresh the server list; if `oauth=error`, show the existing error toast/copy pattern on that page.

If `server.ownedBy === 'media'`, render `t('mcp.oauth.managedByMedia')` on the card.

- [ ] **Step 3: Docs**

In `packages/docs/src/content/docs/en/ai/mcp.md` Authentication row, replace "API Key (optional) Bearer token" with three methods: none / Bearer API key / OAuth (browser). Mention Streamable HTTP is the `sse` transport, no `/sse` suffix, session header handled by EYAS.

- [ ] **Step 4: Run MCP tests once more**

Run: `bunx vitest run tests/modules/communication/mcp/`

Expected: PASS.

---

## Spec coverage (this plan)

| Spec section | Task |
|--------------|------|
| §6.1 Streamable HTTP | T1 |
| §6.1 http initialize, timeouts | T1, T2 |
| §6.2 headers column | T3 |
| §6.3 OAuth | T4, T6 |
| §6.4 catalog entries | T5 |
| `callTool` for adapters (§11) | T3 |
| `owned_by` (§11.4) | T3, T6 |
| PR 1–2 | this plan |
| Media module, adapters, UI `/media` | **other plan** |

## Placeholder scan

None. Higgsfield/Magnific well-known OAuth URLs are discovered at runtime, not hardcoded beyond the MCP URLs in the catalog.
)
