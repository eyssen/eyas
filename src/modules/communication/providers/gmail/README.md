# Gmail Provider

EYAS Gmail email provider for the communication module. Uses the Gmail v1 REST
API with OAuth2 (installed-app flow + PKCE).

## Google Cloud setup

1. Go to <https://console.cloud.google.com/> and create a new project (or reuse an
   existing one).
2. Enable the **Gmail API** under *APIs & Services → Library*.
3. Configure the OAuth consent screen:
   - User type: *External* (for consumer accounts) or *Internal* (Workspace).
   - Scopes: add the four `https://www.googleapis.com/auth/gmail.*` scopes listed
     in the provider manifest.
   - Add your Gmail address as a test user while the app is in *Testing* state.
4. Create an **OAuth 2.0 Client ID**:
   - Application type: **Desktop app** (recommended for self-hosted EYAS).
   - Name: `EYAS Gmail provider` (or your choice).
   - Copy the **Client ID** and optionally the **Client secret**.
5. Configure a redirect URI that EYAS will listen on during the authorization
   flow. For a local install the default is `http://localhost:53682/callback`.

## Scopes

The provider requests these scopes (see `types.ts`):

- `gmail.readonly` — list and read messages
- `gmail.send` — send new messages
- `gmail.modify` — mark read, archive, label changes
- `gmail.labels` — manage labels

## OAuth flow (PKCE)

1. Call `buildAuthorizationUrl()` with a fresh PKCE pair and a random `state`.
2. Open the URL in a browser, let the user consent.
3. The redirect delivers `code` and `state` to your callback handler.
4. Call `exchangeCodeForTokens()` with the received `code` and the verifier to
   obtain `{ accessToken, refreshToken, expiresAt }`.
5. Persist the token set via `TokenManager.save()` — storage is plugged in via
   the `SecretsStore` (EYAS injects `ctx.secrets`). Tokens are **never** logged.

Subsequent runs reuse the stored refresh token; the `TokenManager` refreshes
access tokens with a mutex so parallel 401 retries share a single exchange.

### Why PKCE and not service-account?

- Installed/desktop apps cannot safely ship a `client_secret`; PKCE (RFC 7636)
  removes that requirement by binding each authorization code to a short-lived
  cryptographic verifier.
- Service-account flow requires *domain-wide delegation* in Google Workspace and
  cannot be used for consumer `@gmail.com` accounts. It is a better fit for
  enterprise tenants that already operate a Workspace admin, but EYAS is aimed
  at individual and small-team use — PKCE is the general-purpose choice.
- The service-account alternative is documented but **not** implemented here.
  Open an issue on the main EYAS tracker if you need it.

## Runtime

- `EmailProvider.init()` loads the stored tokens (if any).
- `listUnread()` runs `messages?q=is:unread` and expands every message with
  `format=full`.
- `startListener()` polls `/history.list` every `pollIntervalMs` (default 60s)
  and delivers `InboundEmail` instances to the registered handler.
- `send()` assembles an RFC 822 message, base64url-encodes it, and posts to
  `/messages/send`.

## Security notes

- Base URL is hardcoded to `https://gmail.googleapis.com` — the HTTP client
  refuses any URL outside that origin (SSRF defense).
- Fetch calls use a 30-second timeout via `AbortController`.
- Attachment downloads are capped at 25 MB.
- Tokens live only inside `TokenManager` and the injected `SecretsStore`; error
  bodies from the token endpoint are scrubbed before being raised.
- Outbound message construction rejects header values containing CR/LF to
  prevent header injection.

## Tests

Run the provider unit tests with:

```
bun vitest run tests/modules/communication/providers/gmail/
```

All tests are fully mocked — they never reach `gmail.googleapis.com`.
