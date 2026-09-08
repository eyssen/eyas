// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GraphClient,
  redactUrlToken,
  validateBaseUrl,
} from '@modules/communication/providers/m365/graph-client'
import { OAuth2Flow } from '@modules/communication/providers/m365/oauth2-flow'
import {
  REQUIRED_SCOPES,
  SECRETS_KEY_TOKEN_BUNDLE,
  type SecretsLike,
  type TokenBundle,
} from '@modules/communication/providers/m365/types'

function makeSecrets(initial?: TokenBundle): SecretsLike {
  const store = new Map<string, string>()
  if (initial) store.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify(initial))
  return {
    async get(k: string) {
      return store.get(k) ?? null
    },
    async set(k: string, v: string) {
      store.set(k, v)
    },
    async delete(k: string) {
      store.delete(k)
    },
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function makeFlow(fetchImpl: typeof fetch, bundle?: TokenBundle): OAuth2Flow {
  const secrets = makeSecrets(
    bundle ?? {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 10 * 60_000,
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    },
  )
  return new OAuth2Flow({
    clientId: 'cid',
    tenantId: 'common',
    secrets,
    fetch: fetchImpl,
  })
}

describe('validateBaseUrl', () => {
  it('accepts https://graph.microsoft.com', () => {
    expect(validateBaseUrl('https://graph.microsoft.com/v1.0')).toBe(
      'https://graph.microsoft.com/v1.0',
    )
  })

  it('rejects http://', () => {
    expect(() => validateBaseUrl('http://graph.microsoft.com/v1.0')).toThrow()
  })

  it('rejects other hosts (SSRF guard)', () => {
    expect(() => validateBaseUrl('https://evil.example.com/v1.0')).toThrow()
    expect(() => validateBaseUrl('https://graph.microsoft.com.evil.com/v1.0')).toThrow()
  })

  it('rejects nonsense', () => {
    expect(() => validateBaseUrl('not a url')).toThrow()
  })
})

describe('redactUrlToken', () => {
  it('replaces access_token with [REDACTED]', () => {
    const out = redactUrlToken('https://graph.microsoft.com/foo?access_token=secret')
    expect(out).not.toContain('secret')
    expect(out).toContain('REDACTED')
  })
  it('passes unchanged if no sensitive params', () => {
    const url = 'https://graph.microsoft.com/foo?x=1'
    expect(redactUrlToken(url)).toBe(url)
  })
})

describe('GraphClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds Authorization header and uses the graph.microsoft.com base', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch
    const flow = makeFlow(fetchMock)
    const client = new GraphClient({ oauth: flow, fetch: fetchMock })
    await client.request({ path: '/me' })
    const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
    const [url, init] = calls[0] as [string, RequestInit]
    expect(new URL(url).origin).toBe('https://graph.microsoft.com')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer at')
  })

  it('refreshes exactly once on 401 and retries', async () => {
    let call = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      call++
      const headers = (init?.headers ?? {}) as Record<string, string>
      // Token refresh call (distinguished by body with grant_type=refresh_token)
      if (typeof init?.body === 'string' && init.body.includes('grant_type=refresh_token')) {
        return jsonResponse({
          access_token: 'new-at',
          refresh_token: 'new-rt',
          expires_in: 3600,
          scope: REQUIRED_SCOPES.join(' '),
          token_type: 'Bearer',
        })
      }
      if (headers.Authorization === 'Bearer at') {
        return new Response('unauthorized', { status: 401 })
      }
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    // Expired-in-window so the first call uses old token; after 401 it refreshes.
    const flow = makeFlow(fetchMock, {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 10 * 60_000,
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    })
    const client = new GraphClient({ oauth: flow, fetch: fetchMock, maxRetries: 1 })

    const out = await client.request<{ ok: boolean }>({ path: '/me' })
    expect(out.ok).toBe(true)
    expect(call).toBeGreaterThanOrEqual(3)
  })

  it('honors Retry-After on 429 and eventually succeeds', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async () => {
      attempts++
      if (attempts === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '1' },
        })
      }
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch

    const flow = makeFlow(fetchMock)
    const client = new GraphClient({ oauth: flow, fetch: fetchMock, maxRetries: 3 })
    const promise = client.request<{ ok: boolean }>({ path: '/me' })
    await vi.advanceTimersByTimeAsync(2000)
    const out = await promise
    expect(out.ok).toBe(true)
    expect(attempts).toBe(2)
  })

  it('retries 5xx with backoff and succeeds', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async () => {
      attempts++
      if (attempts < 3) return new Response('boom', { status: 503 })
      return jsonResponse({ ok: true })
    }) as unknown as typeof fetch
    const flow = makeFlow(fetchMock)
    const client = new GraphClient({ oauth: flow, fetch: fetchMock, maxRetries: 5 })
    const p = client.request<{ ok: boolean }>({ path: '/me' })
    await vi.advanceTimersByTimeAsync(10_000)
    const out = await p
    expect(out.ok).toBe(true)
    expect(attempts).toBe(3)
  })

  it('throws on non-retryable 4xx', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('bad request', { status: 400 }),
    ) as unknown as typeof fetch
    const flow = makeFlow(fetchMock)
    const client = new GraphClient({ oauth: flow, fetch: fetchMock })
    await expect(client.request({ path: '/me' })).rejects.toThrow(/400/)
  })

  it('rejects absolute URLs to disallowed hosts (SSRF via nextLink)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch
    const flow = makeFlow(fetchMock)
    const client = new GraphClient({ oauth: flow, fetch: fetchMock })
    await expect(
      client.request({ path: '', absoluteUrl: 'https://evil.example.com/v1.0/x' }),
    ).rejects.toThrow()
  })
})
