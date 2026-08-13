# Microsoft 365 Email Provider

Email provider for EYAS that speaks [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/overview) over OAuth2 device-code flow.

## Features

- Device-code OAuth2 (no embedded browser; user completes sign-in in any browser)
- Refresh token rotation with concurrent-refresh mutex
- Delta-query listener for near-real-time inbox updates (~60 s poll)
- Send/receive with attachments (≤ 25 MB, configurable)
- Pure fetch-based HTTP client — no Graph SDK dependency
- SSRF protection: base URL hardcoded to `https://graph.microsoft.com`
- Bearer tokens redacted in all log output

## Azure AD App Registration

1. Sign in to <https://entra.microsoft.com>.
2. Go to **Identity → Applications → App registrations → New registration**.
3. Name: `EYAS Mail Client` (or any label).
4. Supported account types: choose one of
   - **Single tenant** — if EYAS runs inside your org only.
   - **Multi-tenant** — if you plan to allow any M365 tenant.
5. Redirect URI: leave blank (device-code flow does not use redirects).
6. After creation, copy:
   - **Application (client) ID** → `config.clientId`
   - **Directory (tenant) ID** → `config.tenantId` (or use `"common"` for multi-tenant personal apps)
7. **Authentication** tab → enable **Allow public client flows** (required for device-code).
8. **API permissions** tab → **Add a permission → Microsoft Graph → Delegated permissions**, then add:
   - `Mail.Read`
   - `Mail.ReadWrite`
   - `Mail.Send`
   - `offline_access`
9. Click **Grant admin consent** (or have a tenant admin do it).

No client secret is needed — this is a public client.

## OAuth2 Scopes

| Scope             | Purpose                                               |
| ----------------- | ----------------------------------------------------- |
| `Mail.Read`       | List and read messages                                 |
| `Mail.ReadWrite`  | Mark as read, move to Archive                          |
| `Mail.Send`       | Send messages via `/me/sendMail`                       |
| `offline_access`  | Obtain a refresh token for long-running operation      |

## Setup Flow (to be wired into the Setup Wizard)

```ts
import { createM365EmailProvider, OAuth2Flow } from '@modules/communication/providers/m365'

// 1. Initial device-code flow (run once per account, usually during setup)
const oauth = new OAuth2Flow({ clientId, tenantId, secrets })
const deviceCode = await oauth.startDeviceCode()
console.log(deviceCode.message) // "To sign in, visit https://microsoft.com/devicelogin and enter code XXX-XXX"
await oauth.pollDeviceCode(deviceCode)

// 2. Runtime: build the provider using the stored token bundle
const provider = createM365EmailProvider({
  config: { clientId, tenantId },
  secrets,
  logger,
})
await provider.init()

// 3. Receive mail
const stop = await provider.startListener(async (msg) => {
  console.log('New mail:', msg.subject, 'from', msg.from.address)
})

// 4. Send mail
await provider.send({
  to: [{ address: 'user@example.com' }],
  subject: 'Hello',
  bodyText: 'This is a test.',
})

// 5. Cleanup
await stop()
```

## Token & Delta Storage

Tokens and delta links are persisted via the `SecretsLike` interface injected
by the host module. The provider never writes to disk directly.

| Key                      | Value                                |
| ------------------------ | ------------------------------------ |
| `email-m365:token-bundle`| JSON `{ accessToken, refreshToken, expiresAt, scope, tokenType }` |
| `email-m365:delta-link`  | Opaque `@odata.deltaLink` URL        |

## Security Measures

- **SSRF guard** — only `https://graph.microsoft.com` is accepted as base URL; anything else throws.
- **Strict timeouts** — 30 s default on every HTTP request, enforced via `AbortController`.
- **Token redaction** — bearer tokens are never logged; any `access_token` / `refresh_token` / `code` / `id_token` query params are replaced with `[REDACTED]` before logging.
- **Attachment size cap** — default 25 MB. Larger attachments are skipped with a warning rather than loaded into memory.
- **Content-type validation** — binary attachment responses honor the Graph-reported content type; upstream consumers decide whether to accept it.
- **Refresh mutex** — concurrent Graph calls share a single token refresh request, preventing thundering-herd on Azure AD.
- **Retry hygiene** — 401 triggers exactly one refresh + retry. 429 honors `Retry-After`. 5xx uses capped exponential backoff.

## Configuration Reference

```ts
interface M365ProviderConfig {
  clientId: string           // Azure AD application (client) id
  tenantId: string           // tenant id or 'common'
  pollIntervalMs?: number    // default 60_000
  maxAttachmentSizeBytes?: number // default 26_214_400 (25 MB)
  httpTimeoutMs?: number     // default 30_000
  baseUrl?: string           // optional; must be https://graph.microsoft.com/*
}
```

## Tests

```
bun vitest run tests/modules/communication/providers/m365/
```

All tests use mocked `fetch`; no real Graph calls are made.

## Router Integration (later session)

`createM365EmailProvider(deps)` returns an object that satisfies
`EmailProvider` from `../email-common/types.ts`. The communication router
can instantiate this alongside the existing SMTP/IMAP adapter and choose a
provider per channel-config at dispatch time.
