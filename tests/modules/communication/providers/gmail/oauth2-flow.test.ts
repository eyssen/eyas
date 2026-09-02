// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import {
  base64UrlEncode,
  buildAuthorizationUrl,
  createPkcePair,
  defaultPkceGenerator,
  exchangeCodeForTokens,
  refreshAccessToken,
  TokenManager,
} from '../../../../../src/modules/communication/providers/gmail/oauth2-flow.js'
import type { GmailOAuthConfig, SecretsStore } from '../../../../../src/modules/communication/providers/gmail/types.js'

const logger = pino({ level: 'silent' })

function makeMemorySecrets(): SecretsStore {
  const m = new Map<string, string>()
  return {
    async get(k) { return m.get(k) },
    async set(k, v) { m.set(k, v) },
    async delete(k) { m.delete(k) },
  }
}

const oauth: GmailOAuthConfig = {
  clientId: 'client-id',
  redirectUri: 'http://localhost:53682/callback',
}

describe('PKCE primitives', () => {
  it('base64UrlEncode strips padding and uses URL-safe alphabet', () => {
    const enc = base64UrlEncode(new Uint8Array([255, 239, 190, 231]))
    expect(enc).not.toMatch(/[+/=]/)
  })

  it('default verifier is 43+ url-safe chars', () => {
    const v = defaultPkceGenerator().generateVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('deriveChallenge is SHA-256(verifier) base64url', async () => {
    const gen = defaultPkceGenerator()
    const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const c = await gen.deriveChallenge(v)
    // Known RFC 7636 appendix-B example challenge
    expect(c).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('createPkcePair returns verifier and matching S256 challenge', async () => {
    const pair = await createPkcePair()
    expect(pair.method).toBe('S256')
    const rederive = await defaultPkceGenerator().deriveChallenge(pair.verifier)
    expect(rederive).toBe(pair.challenge)
  })
})

describe('buildAuthorizationUrl', () => {
  it('includes required query params and PKCE challenge', async () => {
    const pair = await createPkcePair()
    const url = buildAuthorizationUrl(oauth, { pkce: pair, state: 'xyz' })
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('client_id')).toBe('client-id')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('code_challenge')).toBe(pair.challenge)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe('xyz')
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('scope')).toContain('gmail.send')
  })

  it('adds login_hint when provided', async () => {
    const pair = await createPkcePair()
    const url = buildAuthorizationUrl(oauth, { pkce: pair, state: 's', loginHint: 'a@b.c' })
    expect(new URL(url).searchParams.get('login_hint')).toBe('a@b.c')
  })
})

describe('exchangeCodeForTokens', () => {
  it('posts authorization_code grant with PKCE verifier', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        access_token: 'a', refresh_token: 'r', expires_in: 3600,
        scope: 'gmail.readonly', token_type: 'Bearer',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const tokens = await exchangeCodeForTokens(
      { oauth, fetchImpl, logger },
      'auth-code',
      'verifier-123',
    )
    expect(tokens.accessToken).toBe('a')
    expect(tokens.refreshToken).toBe('r')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())

    const call = fetchImpl.mock.calls[0]
    expect(call[0]).toBe('https://oauth2.googleapis.com/token')
    const bodyParams = new URLSearchParams(call[1].body as string)
    expect(bodyParams.get('code')).toBe('auth-code')
    expect(bodyParams.get('code_verifier')).toBe('verifier-123')
    expect(bodyParams.get('grant_type')).toBe('authorization_code')
  })

  it('rejects when response lacks refresh_token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'a', expires_in: 3600, scope: 's', token_type: 'Bearer' }), { status: 200 }),
    )
    await expect(
      exchangeCodeForTokens({ oauth, fetchImpl, logger }, 'c', 'v'),
    ).rejects.toThrow(/refresh_token/)
  })

  it('redacts tokens in thrown error body', async () => {
    const body = JSON.stringify({ error: 'invalid_grant', refresh_token: 'LEAKED-VALUE' })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 400 }))
    await expect(
      exchangeCodeForTokens({ oauth, fetchImpl }, 'c', 'v'),
    ).rejects.toThrow(/<redacted>/)
  })
})

describe('refreshAccessToken', () => {
  it('keeps old refresh_token if server does not rotate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-a', expires_in: 3600, scope: 's', token_type: 'Bearer',
    }), { status: 200 }))
    const t = await refreshAccessToken({ oauth, fetchImpl }, 'old-refresh')
    expect(t.accessToken).toBe('new-a')
    expect(t.refreshToken).toBe('old-refresh')
  })

  it('adopts rotated refresh_token when issued', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-a', refresh_token: 'rotated-r', expires_in: 3600, scope: 's', token_type: 'Bearer',
    }), { status: 200 }))
    const t = await refreshAccessToken({ oauth, fetchImpl }, 'old-r')
    expect(t.refreshToken).toBe('rotated-r')
  })
})

describe('TokenManager mutex', () => {
  it('serialises concurrent refreshes to a single exchange', async () => {
    const secrets = makeMemorySecrets()
    await secrets.set('gmail:tokens', JSON.stringify({
      accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000,
      scope: 's', tokenType: 'Bearer',
    }))
    let exchanges = 0
    const fetchImpl = vi.fn(async () => {
      exchanges += 1
      // simulate network latency
      await new Promise((r) => setTimeout(r, 5))
      return new Response(JSON.stringify({
        access_token: `new-${exchanges}`, expires_in: 3600, scope: 's', token_type: 'Bearer',
      }), { status: 200 })
    })
    const tm = new TokenManager({ secrets, secretKey: 'gmail:tokens', oauth, fetchImpl, logger })
    const tokens = await Promise.all([
      tm.getAccessToken(),
      tm.getAccessToken(),
      tm.getAccessToken(),
    ])
    expect(exchanges).toBe(1)
    expect(new Set(tokens).size).toBe(1)
  })

  it('returns cached token when not close to expiry', async () => {
    const secrets = makeMemorySecrets()
    await secrets.set('gmail:tokens', JSON.stringify({
      accessToken: 'live', refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000,
      scope: 's', tokenType: 'Bearer',
    }))
    const fetchImpl = vi.fn()
    const tm = new TokenManager({ secrets, secretKey: 'gmail:tokens', oauth, fetchImpl })
    expect(await tm.getAccessToken()).toBe('live')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('throws when no tokens are stored', async () => {
    const secrets = makeMemorySecrets()
    const tm = new TokenManager({ secrets, secretKey: 'gmail:tokens', oauth })
    await expect(tm.getAccessToken()).rejects.toThrow(/no tokens stored/)
  })

  it('forceRefresh triggers exchange regardless of expiry', async () => {
    const secrets = makeMemorySecrets()
    await secrets.set('gmail:tokens', JSON.stringify({
      accessToken: 'live', refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000,
      scope: 's', tokenType: 'Bearer',
    }))
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'forced', expires_in: 3600, scope: 's', token_type: 'Bearer',
    }), { status: 200 }))
    const tm = new TokenManager({ secrets, secretKey: 'gmail:tokens', oauth, fetchImpl })
    expect(await tm.forceRefresh()).toBe('forced')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
