// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuth2Flow } from '@modules/communication/providers/m365/oauth2-flow'
import {
  REQUIRED_SCOPES,
  SECRETS_KEY_TOKEN_BUNDLE,
  type SecretsLike,
  type TokenBundle,
} from '@modules/communication/providers/m365/types'

function makeSecrets(): SecretsLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
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

describe('OAuth2Flow', () => {
  let secrets: ReturnType<typeof makeSecrets>

  beforeEach(() => {
    vi.useFakeTimers()
    secrets = makeSecrets()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('startDeviceCode returns a device code response', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        user_code: 'ABC-123',
        device_code: 'dev-xyz',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
        message: 'go visit the URL',
      }),
    ) as unknown as typeof fetch

    const flow = new OAuth2Flow({
      clientId: 'test-client',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })
    const dc = await flow.startDeviceCode()
    expect(dc.user_code).toBe('ABC-123')
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      '/common/oauth2/v2.0/devicecode',
    )
    const body = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string
    // URLSearchParams uses + rather than %20 for spaces; check decoded form.
    const parsed = new URLSearchParams(body)
    expect(parsed.get('scope')).toBe(REQUIRED_SCOPES.join(' '))
  })

  it('pollDeviceCode polls until success and persists bundle', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls++
      if (calls < 3) {
        return jsonResponse({ error: 'authorization_pending' }, { status: 400 })
      }
      return jsonResponse({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        expires_in: 3600,
        scope: REQUIRED_SCOPES.join(' '),
        token_type: 'Bearer',
      })
    }) as unknown as typeof fetch

    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })

    const promise = flow.pollDeviceCode({
      user_code: 'U',
      device_code: 'D',
      verification_uri: 'https://x',
      expires_in: 900,
      interval: 1,
      message: 'go',
    })
    // Advance through the two pending polls.
    await vi.advanceTimersByTimeAsync(5000)
    const bundle = await promise
    expect(bundle.accessToken).toBe('at-1')
    expect(bundle.refreshToken).toBe('rt-1')
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3)
    expect(secrets.store.get(SECRETS_KEY_TOKEN_BUNDLE)).toContain('at-1')
  })

  it('pollDeviceCode throws on non-pending errors', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'access_denied' }, { status: 400 }),
    ) as unknown as typeof fetch

    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })

    await expect(
      flow.pollDeviceCode({
        user_code: 'U',
        device_code: 'D',
        verification_uri: 'https://x',
        expires_in: 900,
        interval: 1,
        message: 'go',
      }),
    ).rejects.toThrow(/Device code polling failed/)
  })

  it('getAccessToken returns cached token when not expired', async () => {
    const future = Date.now() + 10 * 60_000
    const bundle: TokenBundle = {
      accessToken: 'valid-at',
      refreshToken: 'rt',
      expiresAt: future,
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    }
    await secrets.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify(bundle))
    const fetchMock = vi.fn() as unknown as typeof fetch
    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })
    const token = await flow.getAccessToken()
    expect(token).toBe('valid-at')
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('getAccessToken refreshes when near expiry and rotates refresh_token', async () => {
    const expiring: TokenBundle = {
      accessToken: 'old-at',
      refreshToken: 'old-rt',
      expiresAt: Date.now() + 5000, // within skew window
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    }
    await secrets.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify(expiring))

    const fetchMock = vi.fn(async () =>
      jsonResponse({
        access_token: 'new-at',
        refresh_token: 'new-rt',
        expires_in: 3600,
        scope: REQUIRED_SCOPES.join(' '),
        token_type: 'Bearer',
      }),
    ) as unknown as typeof fetch

    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })
    const token = await flow.getAccessToken()
    expect(token).toBe('new-at')
    const stored = JSON.parse(secrets.store.get(SECRETS_KEY_TOKEN_BUNDLE) as string) as TokenBundle
    expect(stored.refreshToken).toBe('new-rt')
  })

  it('concurrent getAccessToken calls share one refresh request (mutex)', async () => {
    const expiring: TokenBundle = {
      accessToken: 'old',
      refreshToken: 'old-rt',
      expiresAt: Date.now() + 5000,
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    }
    await secrets.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify(expiring))

    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          // Small delay simulates network.
          setTimeout(
            () =>
              resolve(
                jsonResponse({
                  access_token: 'fresh',
                  refresh_token: 'fresh-rt',
                  expires_in: 3600,
                  scope: REQUIRED_SCOPES.join(' '),
                  token_type: 'Bearer',
                }),
              ),
            50,
          )
        }),
    ) as unknown as typeof fetch

    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })

    const p1 = flow.getAccessToken()
    const p2 = flow.getAccessToken()
    const p3 = flow.getAccessToken()
    await vi.advanceTimersByTimeAsync(100)
    const [t1, t2, t3] = await Promise.all([p1, p2, p3])
    expect(t1).toBe('fresh')
    expect(t2).toBe('fresh')
    expect(t3).toBe('fresh')
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('preserves existing refresh_token when Graph does not rotate it', async () => {
    const expiring: TokenBundle = {
      accessToken: 'old',
      refreshToken: 'sticky-rt',
      expiresAt: Date.now() + 5000,
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    }
    await secrets.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify(expiring))
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        access_token: 'new-at',
        // no refresh_token field
        expires_in: 3600,
        scope: REQUIRED_SCOPES.join(' '),
        token_type: 'Bearer',
      }),
    ) as unknown as typeof fetch

    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
      fetch: fetchMock,
    })
    await flow.refreshBundle()
    const stored = JSON.parse(secrets.store.get(SECRETS_KEY_TOKEN_BUNDLE) as string) as TokenBundle
    expect(stored.refreshToken).toBe('sticky-rt')
  })

  it('logout clears persisted bundle', async () => {
    await secrets.set(SECRETS_KEY_TOKEN_BUNDLE, JSON.stringify({ accessToken: 'a' }))
    const flow = new OAuth2Flow({
      clientId: 'c',
      tenantId: 'common',
      secrets,
    })
    await flow.logout()
    expect(secrets.store.get(SECRETS_KEY_TOKEN_BUNDLE)).toBeUndefined()
  })
})
