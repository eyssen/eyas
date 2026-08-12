// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { GmailClient, GmailHttpError } from '../../../../../src/modules/communication/providers/gmail/gmail-client.js'
import { TokenManager } from '../../../../../src/modules/communication/providers/gmail/oauth2-flow.js'
import type { FetchLike, GmailOAuthConfig, SecretsStore } from '../../../../../src/modules/communication/providers/gmail/types.js'

const logger = pino({ level: 'silent' })
const oauth: GmailOAuthConfig = { clientId: 'c', redirectUri: 'http://cb' }

function memorySecrets(initial: Record<string, string> = {}): SecretsStore {
  const m = new Map(Object.entries(initial))
  return {
    async get(k) { return m.get(k) },
    async set(k, v) { m.set(k, v) },
    async delete(k) { m.delete(k) },
  }
}

function makeTokens(secrets: SecretsStore, fetchImpl?: FetchLike): TokenManager {
  return new TokenManager({ secrets, secretKey: 'gmail:tokens', oauth, fetchImpl, logger })
}

function liveTokenSecrets(): SecretsStore {
  return memorySecrets({
    'gmail:tokens': JSON.stringify({
      accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 10 * 60_000,
      scope: 's', tokenType: 'Bearer',
    }),
  })
}

describe('GmailClient base URL enforcement', () => {
  it('listUnread calls the fixed gmail.googleapis.com base', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    )
    const tokens = makeTokens(liveTokenSecrets(), fetchImpl)
    const client = new GmailClient({ tokens, fetchImpl, logger })
    await client.listUnread()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/gmail\.googleapis\.com\//)
  })

  it('rejects invalid message id to guard against path injection', async () => {
    const tokens = makeTokens(liveTokenSecrets(), vi.fn())
    const client = new GmailClient({ tokens, fetchImpl: vi.fn(), logger })
    await expect(client.getMessage('../evil')).rejects.toThrow(/invalid message id/)
  })
})

describe('GmailClient 401 handling', () => {
  it('forces one refresh and retries on 401', async () => {
    const secrets = memorySecrets({
      'gmail:tokens': JSON.stringify({
        accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000,
        scope: 's', tokenType: 'Bearer',
      }),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('unauth', { status: 401 }))
      // refresh exchange
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'new', expires_in: 3600, scope: 's', token_type: 'Bearer',
      }), { status: 200 }))
      // retry of original request
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
    const tokens = makeTokens(secrets, fetchImpl)
    const client = new GmailClient({ tokens, fetchImpl, logger })
    const res = await client.listUnread()
    expect(res.messages).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/token')
  })

  it('surfaces 401 after a single refresh attempt', async () => {
    const secrets = memorySecrets({
      'gmail:tokens': JSON.stringify({
        accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() + 10 * 60_000,
        scope: 's', tokenType: 'Bearer',
      }),
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('unauth', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'new', expires_in: 3600, scope: 's', token_type: 'Bearer',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('still unauth', { status: 401 }))
    const tokens = makeTokens(secrets, fetchImpl)
    const client = new GmailClient({ tokens, fetchImpl, logger })
    await expect(client.listUnread()).rejects.toBeInstanceOf(GmailHttpError)
  })
})

describe('GmailClient 429/5xx backoff', () => {
  it('retries on 429 with exponential backoff and honours Retry-After', async () => {
    const sleep = vi.fn(async (_ms: number) => {})
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('slow', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('bad', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }))
    const tokens = makeTokens(liveTokenSecrets(), fetchImpl)
    const client = new GmailClient({ tokens, fetchImpl, logger, sleep, jitter: () => 0 })
    await client.listUnread()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
    // First backoff from Retry-After: 2s
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(2000)
  })

  it('gives up after maxRetries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad', { status: 503 }))
    const tokens = makeTokens(liveTokenSecrets(), fetchImpl)
    const client = new GmailClient({
      tokens, fetchImpl, logger,
      sleep: async () => {}, jitter: () => 0, maxRetries: 1,
    })
    await expect(client.listUnread()).rejects.toBeInstanceOf(GmailHttpError)
    expect(fetchImpl).toHaveBeenCalledTimes(2) // original + 1 retry
  })
})

describe('GmailClient attachment cap', () => {
  it('rejects attachments larger than 25MB', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ size: 30 * 1024 * 1024, data: 'AA' }), { status: 200 }),
    )
    const tokens = makeTokens(liveTokenSecrets(), fetchImpl)
    const client = new GmailClient({ tokens, fetchImpl, logger })
    await expect(client.getAttachment('msg1', 'att1')).rejects.toThrow(/cap/)
  })
})

describe('GmailClient send', () => {
  it('posts raw base64url body to /messages/send', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }))
    const tokens = makeTokens(liveTokenSecrets(), fetchImpl)
    const client = new GmailClient({ tokens, fetchImpl, logger })
    const res = await client.sendRaw('abc_base64url')
    expect(res.id).toBe('m1')
    const call = fetchImpl.mock.calls[0]
    expect(call[0]).toContain('/messages/send')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ raw: 'abc_base64url' })
  })
})
