// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Google OAuth2 Installed-App flow with PKCE (RFC 7636).
 *
 * Design choice — PKCE over service-account:
 *   - Installed/desktop apps cannot safely ship a client_secret. PKCE removes the
 *     need for one by binding the authorization code to a cryptographic verifier.
 *   - Service-account flow requires domain-wide delegation and only works for
 *     Google Workspace tenants — not a fit for general users. We document the
 *     service-account alternative in README.md but do not implement it here.
 *
 * Refresh semantics:
 *   - Google issues a long-lived refresh_token. We persist it via ctx.secrets and
 *     reuse it to mint short-lived access_tokens. Google MAY rotate the
 *     refresh_token; we always overwrite the stored value when a new one is returned.
 *   - A mutex serialises refresh so that parallel 401 retries do not cause a
 *     thundering herd of token exchange calls.
 */

import type { Logger } from 'pino'
import {
  GMAIL_OAUTH_AUTH_URL,
  GMAIL_OAUTH_TOKEN_URL,
  GMAIL_SCOPES,
  HTTP_TIMEOUT_MS,
  type FetchLike,
  type GmailOAuthConfig,
  type GmailTokens,
  type PkceGenerator,
  type SecretsStore,
} from './types.js'

/**
 * RFC 7636 §4.1 — code_verifier is 43-128 chars of [A-Z a-z 0-9 -._~]
 */
export function defaultPkceGenerator(): PkceGenerator {
  return {
    generateVerifier(): string {
      // 32 random bytes → 43-char base64url string
      const bytes = new Uint8Array(32)
      // crypto is globally available in Bun and modern Node
      crypto.getRandomValues(bytes)
      return base64UrlEncode(bytes)
    },
    async deriveChallenge(verifier: string): Promise<string> {
      const enc = new TextEncoder().encode(verifier)
      const digest = await crypto.subtle.digest('SHA-256', enc)
      return base64UrlEncode(new Uint8Array(digest))
    },
  }
}

export function base64UrlEncode(buf: Uint8Array): string {
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
  method: 'S256'
}

export async function createPkcePair(gen: PkceGenerator = defaultPkceGenerator()): Promise<PkcePair> {
  const verifier = gen.generateVerifier()
  const challenge = await gen.deriveChallenge(verifier)
  return { verifier, challenge, method: 'S256' }
}

export interface AuthUrlParams {
  pkce: PkcePair
  state: string
  /** Forces a refresh_token on first consent */
  prompt?: 'consent' | 'none' | 'select_account'
  /** Default 'offline' to obtain refresh_token */
  accessType?: 'offline' | 'online'
  scopes?: readonly string[]
  loginHint?: string
}

export function buildAuthorizationUrl(oauth: GmailOAuthConfig, params: AuthUrlParams): string {
  const q = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: oauth.redirectUri,
    response_type: 'code',
    scope: (params.scopes ?? oauth.scopes ?? GMAIL_SCOPES).join(' '),
    code_challenge: params.pkce.challenge,
    code_challenge_method: params.pkce.method,
    state: params.state,
    access_type: params.accessType ?? 'offline',
    prompt: params.prompt ?? 'consent',
    include_granted_scopes: 'true',
  })
  if (params.loginHint) q.set('login_hint', params.loginHint)
  return `${GMAIL_OAUTH_AUTH_URL}?${q.toString()}`
}

export interface TokenExchangeOptions {
  oauth: GmailOAuthConfig
  fetchImpl?: FetchLike
  logger?: Logger
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

async function postToken(
  body: Record<string, string>,
  opts: TokenExchangeOptions,
): Promise<RawTokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetchImpl(GMAIL_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Gmail OAuth token endpoint ${res.status}: ${redactTokenErrorBody(text)}`)
    }
    return (await res.json()) as RawTokenResponse
  } finally {
    clearTimeout(timer)
  }
}

/** Never leak the raw response — some error bodies echo submitted refresh_tokens. */
function redactTokenErrorBody(body: string): string {
  return body
    .replace(/("?refresh_token"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/("?access_token"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/("?code"?\s*[:=]\s*)"[^"]*"/gi, '$1"<redacted>"')
}

export async function exchangeCodeForTokens(
  opts: TokenExchangeOptions,
  code: string,
  codeVerifier: string,
): Promise<GmailTokens> {
  const body: Record<string, string> = {
    code,
    client_id: opts.oauth.clientId,
    redirect_uri: opts.oauth.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  }
  if (opts.oauth.clientSecret) body.client_secret = opts.oauth.clientSecret
  const raw = await postToken(body, opts)
  if (!raw.refresh_token) {
    throw new Error('Gmail OAuth: authorization_code response missing refresh_token — request prompt=consent and access_type=offline')
  }
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt: Date.now() + raw.expires_in * 1000,
    scope: raw.scope,
    tokenType: raw.token_type,
  }
}

export async function refreshAccessToken(
  opts: TokenExchangeOptions,
  refreshToken: string,
): Promise<GmailTokens> {
  const body: Record<string, string> = {
    client_id: opts.oauth.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }
  if (opts.oauth.clientSecret) body.client_secret = opts.oauth.clientSecret
  const raw = await postToken(body, opts)
  return {
    accessToken: raw.access_token,
    // Google may or may not rotate the refresh_token — prefer the new one if issued.
    refreshToken: raw.refresh_token ?? refreshToken,
    expiresAt: Date.now() + raw.expires_in * 1000,
    scope: raw.scope,
    tokenType: raw.token_type,
  }
}

/**
 * Keeps a persisted Gmail token set fresh. Serialises refreshes through a mutex so
 * that concurrent 401 retries from parallel requests share a single token exchange.
 */
export class TokenManager {
  private readonly secrets: SecretsStore
  private readonly secretKey: string
  private readonly oauth: GmailOAuthConfig
  private readonly fetchImpl?: FetchLike
  private readonly logger?: Logger
  /** Refresh slightly early so a request that starts just before expiry does not race. */
  private readonly earlyRefreshMs: number
  private cached: GmailTokens | null = null
  private refreshPromise: Promise<GmailTokens> | null = null

  constructor(params: {
    secrets: SecretsStore
    secretKey: string
    oauth: GmailOAuthConfig
    fetchImpl?: FetchLike
    logger?: Logger
    earlyRefreshMs?: number
  }) {
    this.secrets = params.secrets
    this.secretKey = params.secretKey
    this.oauth = params.oauth
    this.fetchImpl = params.fetchImpl
    this.logger = params.logger
    this.earlyRefreshMs = params.earlyRefreshMs ?? 60_000
  }

  async load(): Promise<GmailTokens | null> {
    if (this.cached) return this.cached
    const stored = await this.secrets.get(this.secretKey)
    if (!stored) return null
    try {
      this.cached = JSON.parse(stored) as GmailTokens
      return this.cached
    } catch {
      return null
    }
  }

  async save(tokens: GmailTokens): Promise<void> {
    this.cached = tokens
    await this.secrets.set(this.secretKey, JSON.stringify(tokens))
  }

  async clear(): Promise<void> {
    this.cached = null
    await this.secrets.delete(this.secretKey)
  }

  /** Returns a live access token, refreshing under a mutex if needed. */
  async getAccessToken(now: number = Date.now()): Promise<string> {
    const existing = await this.load()
    if (!existing) throw new Error('Gmail: no tokens stored — complete the OAuth flow first')
    if (existing.expiresAt - this.earlyRefreshMs > now) return existing.accessToken

    if (this.refreshPromise) {
      const next = await this.refreshPromise
      return next.accessToken
    }
    this.refreshPromise = (async () => {
      try {
        this.logger?.debug('Gmail: refreshing access token')
        const next = await refreshAccessToken(
          { oauth: this.oauth, fetchImpl: this.fetchImpl, logger: this.logger },
          existing.refreshToken,
        )
        await this.save(next)
        return next
      } finally {
        this.refreshPromise = null
      }
    })()
    const refreshed = await this.refreshPromise
    return refreshed.accessToken
  }

  /** Force a refresh even if the current token looks live — used on a 401 response. */
  async forceRefresh(): Promise<string> {
    const existing = await this.load()
    if (!existing) throw new Error('Gmail: no tokens stored — cannot force refresh')
    if (this.refreshPromise) {
      const next = await this.refreshPromise
      return next.accessToken
    }
    this.refreshPromise = (async () => {
      try {
        const next = await refreshAccessToken(
          { oauth: this.oauth, fetchImpl: this.fetchImpl, logger: this.logger },
          existing.refreshToken,
        )
        await this.save(next)
        return next
      } finally {
        this.refreshPromise = null
      }
    })()
    const refreshed = await this.refreshPromise
    return refreshed.accessToken
  }
}
