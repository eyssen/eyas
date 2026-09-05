// Part of eYssen. See LICENSE file for full copyright and licensing details.

const DISCOVERY_TIMEOUT_MS = 15_000
const DEFAULT_CLIENT_ID = 'eyas'

export interface PkcePair {
  verifier: string
  challenge: string
}

export interface AuthServerMetadata {
  authorizationEndpoint: string
  tokenEndpoint: string
  clientId: string
}

export interface BuildAuthorizationUrlInput {
  authorizationEndpoint: string
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  resource: string
}

export interface ExchangeCodeInput {
  tokenEndpoint: string
  clientId: string
  redirectUri: string
  code: string
  verifier: string
  resource?: string
}

export interface RefreshAccessTokenInput {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
  resource?: string
}

export interface TokenResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

/** RFC 7636 base64url without padding. */
export function base64UrlEncode(buf: Uint8Array): string {
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** 32 random bytes → 43-char verifier; S256 challenge via Web Crypto. */
export async function generatePkce(): Promise<PkcePair> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const verifier = base64UrlEncode(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(new Uint8Array(digest))
  return { verifier, challenge }
}

export function buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const u = new URL(input.authorizationEndpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', input.clientId)
  u.searchParams.set('redirect_uri', input.redirectUri)
  u.searchParams.set('code_challenge', input.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', input.state)
  u.searchParams.set('resource', input.resource)
  return u.toString()
}

/** RFC 8707 resource indicator: the MCP endpoint URI (full URL), not its origin. */
export function mcpResourceUrl(mcpUrl: string): string {
  return mcpUrl.trim()
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function originOf(url: string): string {
  return new URL(url).origin
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function readClientId(...sources: Array<Record<string, unknown> | null>): string {
  for (const src of sources) {
    const id = src?.client_id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return DEFAULT_CLIENT_ID
}

/**
 * RFC 9728 protected-resource metadata, then RFC 8414 authorization-server
 * metadata. Public client id is `'eyas'` when the metadata omits `client_id`.
 */
export async function discoverAuthServer(mcpUrl: string): Promise<AuthServerMetadata> {
  const origin = originOf(mcpUrl)
  const protectedResource = await getJson(`${origin}/.well-known/oauth-protected-resource`)
  const authServers = protectedResource?.authorization_servers
  const issuer = Array.isArray(authServers) && typeof authServers[0] === 'string' && authServers[0]
    ? stripSlash(authServers[0])
    : origin

  const asMeta = await getJson(`${issuer}/.well-known/oauth-authorization-server`)
  const authorizationEndpoint = asMeta?.authorization_endpoint
  const tokenEndpoint = asMeta?.token_endpoint
  if (typeof authorizationEndpoint !== 'string' || !authorizationEndpoint) {
    throw new Error('OAuth discovery: missing authorization_endpoint')
  }
  if (typeof tokenEndpoint !== 'string' || !tokenEndpoint) {
    throw new Error('OAuth discovery: missing token_endpoint')
  }

  return {
    authorizationEndpoint,
    tokenEndpoint,
    clientId: readClientId(asMeta, protectedResource),
  }
}

async function postTokenForm(
  tokenEndpoint: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    const err = typeof json.error === 'string' ? json.error : res.statusText
    throw new Error(`OAuth token request failed: ${res.status} ${err}`)
  }
  return json
}

function parseTokenResult(json: Record<string, unknown>): TokenResult {
  const accessToken = json.access_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('OAuth token response missing access_token')
  }
  const result: TokenResult = { accessToken }
  if (typeof json.refresh_token === 'string' && json.refresh_token) {
    result.refreshToken = json.refresh_token
  }
  if (typeof json.expires_in === 'number' && Number.isFinite(json.expires_in)) {
    result.expiresIn = json.expires_in
  }
  return result
}

export async function exchangeCode(input: ExchangeCodeInput): Promise<TokenResult> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier,
  }
  if (input.resource) body.resource = input.resource
  return parseTokenResult(await postTokenForm(input.tokenEndpoint, body))
}

export async function refreshAccessToken(input: RefreshAccessTokenInput): Promise<TokenResult> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  }
  if (input.resource) body.resource = input.resource
  return parseTokenResult(await postTokenForm(input.tokenEndpoint, body))
}
