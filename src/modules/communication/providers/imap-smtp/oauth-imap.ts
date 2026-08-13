// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * XOAUTH2 helper for IMAP/SMTP providers that support OAuth2 (Gmail,
 * Microsoft 365, Yahoo). This is a minimal helper that formats the
 * SASL XOAUTH2 string; the actual OAuth2 token refresh is delegated
 * to the caller (typically the `secrets` module).
 *
 * Format (RFC 7628):
 *   `user={email}\x01auth=Bearer {access_token}\x01\x01` then base64 encoded.
 *
 * For fully integrated OAuth flows (device-code, refresh token management)
 * see `providers/m365/` which uses Microsoft Graph + MSAL.
 */

export interface XOAuth2Credentials {
  user: string
  accessToken: string
}

export interface OAuthTokenProvider {
  /** Return a fresh access token for the given user, refreshing if needed. */
  getAccessToken(user: string): Promise<string>
  /** Optional: called when the token is rejected by the IMAP server. */
  onAuthFailure?(user: string): Promise<void>
}

/**
 * Build the XOAUTH2 SASL string (base64-encoded) for IMAP/SMTP AUTH.
 */
export function buildXOAuth2String(creds: XOAuth2Credentials): string {
  const raw = `user=${creds.user}\x01auth=Bearer ${creds.accessToken}\x01\x01`
  return toBase64(raw)
}

/**
 * Placeholder: retry a callback with a refreshed token on auth failure.
 *
 * ```ts
 * await withRefresh(tokenProvider, 'me@example.com', async (token) => {
 *   await imapClient.authenticate({ xoauth2: buildXOAuth2String({ user, accessToken: token }) })
 * })
 * ```
 */
export async function withRefresh<T>(
  provider: OAuthTokenProvider,
  user: string,
  op: (token: string) => Promise<T>,
): Promise<T> {
  let token = await provider.getAccessToken(user)
  try {
    return await op(token)
  } catch (err) {
    if (!isAuthFailure(err)) throw err
    await provider.onAuthFailure?.(user)
    token = await provider.getAccessToken(user)
    return await op(token)
  }
}

function isAuthFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { code?: string; response?: string; responseCode?: number }
  if (e.responseCode === 535 || e.responseCode === 534) return true
  if (typeof e.response === 'string' && /AUTHENTICATE failed|invalid_grant|invalid_token/i.test(e.response)) {
    return true
  }
  if (e.code === 'AUTH' || e.code === 'EAUTH') return true
  return false
}

function toBase64(s: string): string {
  const g = globalThis as Record<string, unknown>
  const btoaFn = g.btoa as ((input: string) => string) | undefined
  if (typeof btoaFn === 'function') return btoaFn(s)
  const Buf = g.Buffer as { from(input: string, enc: string): { toString(enc: string): string } } | undefined
  if (Buf) return Buf.from(s, 'latin1').toString('base64')
  throw new Error('No base64 encoder available')
}
