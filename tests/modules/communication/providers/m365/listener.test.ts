// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GraphClient } from '@modules/communication/providers/m365/graph-client'
import { DeltaListener } from '@modules/communication/providers/m365/listener'
import { OAuth2Flow } from '@modules/communication/providers/m365/oauth2-flow'
import {
  REQUIRED_SCOPES,
  SECRETS_KEY_DELTA_LINK,
  SECRETS_KEY_TOKEN_BUNDLE,
  type SecretsLike,
} from '@modules/communication/providers/m365/types'
import type { InboundEmail } from '@modules/communication/providers/email-common/types'

function makeSecrets(initialDeltaLink?: string): SecretsLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  if (initialDeltaLink) store.set(SECRETS_KEY_DELTA_LINK, initialDeltaLink)
  store.set(
    SECRETS_KEY_TOKEN_BUNDLE,
    JSON.stringify({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 10 * 60_000,
      scope: REQUIRED_SCOPES.join(' '),
      tokenType: 'Bearer',
    }),
  )
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildClient(fetchImpl: typeof fetch, secrets: SecretsLike): GraphClient {
  const flow = new OAuth2Flow({
    clientId: 'c',
    tenantId: 'common',
    secrets,
    fetch: fetchImpl,
  })
  return new GraphClient({ oauth: flow, fetch: fetchImpl })
}

describe('DeltaListener', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('first cycle uses delta endpoint and persists deltaLink; yields messages', async () => {
    const secrets = makeSecrets()
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/me/mailFolders/Inbox/messages/delta')) {
        return jsonResponse({
          value: [
            {
              id: 'm1',
              subject: 'First',
              from: { emailAddress: { address: 'a@b' } },
              toRecipients: [{ emailAddress: { address: 'c@d' } }],
              body: { contentType: 'text', content: 'hello' },
              receivedDateTime: '2026-01-01T00:00:00Z',
            },
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=DELTA_TOKEN',
        })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    const received: InboundEmail[] = []
    const listener = new DeltaListener({
      graph: buildClient(fetchMock, secrets),
      secrets,
      pollIntervalMs: 60_000,
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
    })

    const stop = await listener.start(async (m) => {
      received.push(m)
    })
    try {
      expect(received.length).toBe(1)
      expect(received[0]?.id).toBe('m1')
      expect(secrets.store.get(SECRETS_KEY_DELTA_LINK)).toContain('DELTA_TOKEN')
    } finally {
      await stop()
    }
  })

  it('subsequent cycle reuses stored delta link', async () => {
    const stored = 'https://graph.microsoft.com/v1.0/delta?token=OLD'
    const secrets = makeSecrets(stored)
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('token=OLD')
      return jsonResponse({
        value: [],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=NEW',
      })
    }) as unknown as typeof fetch

    const listener = new DeltaListener({
      graph: buildClient(fetchMock, secrets),
      secrets,
    })
    await listener.cycle(() => undefined)
    expect(secrets.store.get(SECRETS_KEY_DELTA_LINK)).toContain('NEW')
  })

  it('follows @odata.nextLink pagination before persisting deltaLink', async () => {
    const secrets = makeSecrets()
    let step = 0
    const fetchMock = vi.fn(async () => {
      step++
      if (step === 1) {
        return jsonResponse({
          value: [
            {
              id: 'p1-m1',
              from: { emailAddress: { address: 'a@b' } },
              toRecipients: [{ emailAddress: { address: 'c@d' } }],
              body: { contentType: 'text', content: '' },
              receivedDateTime: '2026-01-01T00:00:00Z',
              subject: 's1',
            },
          ],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next?page=2',
        })
      }
      return jsonResponse({
        value: [
          {
            id: 'p2-m1',
            from: { emailAddress: { address: 'a@b' } },
            toRecipients: [{ emailAddress: { address: 'c@d' } }],
            body: { contentType: 'text', content: '' },
            receivedDateTime: '2026-01-01T00:00:00Z',
            subject: 's2',
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=FINAL',
      })
    }) as unknown as typeof fetch

    const received: InboundEmail[] = []
    const listener = new DeltaListener({
      graph: buildClient(fetchMock, secrets),
      secrets,
    })
    await listener.cycle((m) => {
      received.push(m)
    })
    expect(received.map((m) => m.id)).toEqual(['p1-m1', 'p2-m1'])
    expect(secrets.store.get(SECRETS_KEY_DELTA_LINK)).toContain('FINAL')
  })

  it('respects configured polling interval via injected timers', async () => {
    const secrets = makeSecrets()
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        value: [],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=X',
      }),
    ) as unknown as typeof fetch

    type Handle = { fn: () => void; ms: number }
    const pending: Handle[] = []
    const listener = new DeltaListener({
      graph: buildClient(fetchMock, secrets),
      secrets,
      pollIntervalMs: 30_000,
      timers: {
        setTimeout: (fn, ms) => {
          const h: Handle = { fn, ms }
          pending.push(h)
          return h
        },
        clearTimeout: (h) => {
          const idx = pending.indexOf(h as Handle)
          if (idx !== -1) pending.splice(idx, 1)
        },
      },
    })
    const stop = await listener.start(() => undefined)
    try {
      // Initial cycle ran, then exactly one timer should be queued at the
      // configured interval.
      expect(pending.length).toBe(1)
      expect(pending[0]?.ms).toBe(30_000)
    } finally {
      await stop()
      // Stop should have cleared the pending timer.
      expect(pending.length).toBe(0)
    }
  })

  it('warns when attachments exceed size cap and only yields remaining ones', async () => {
    const secrets = makeSecrets()
    const warnSpy = vi.fn()
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        value: [
          {
            id: 'big',
            subject: 'big one',
            from: { emailAddress: { address: 'a@b' } },
            toRecipients: [{ emailAddress: { address: 'c@d' } }],
            body: { contentType: 'text', content: '' },
            receivedDateTime: '2026-01-01T00:00:00Z',
            hasAttachments: true,
            attachments: [
              { id: '1', name: 'small', contentType: 'x', size: 100 },
              { id: '2', name: 'big', contentType: 'x', size: 999_999_999 },
            ],
          },
        ],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta?token=X',
      }),
    ) as unknown as typeof fetch

    const listener = new DeltaListener({
      graph: buildClient(fetchMock, secrets),
      secrets,
      logger: { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() },
      maxAttachmentSizeBytes: 1024,
    })
    const received: InboundEmail[] = []
    await listener.cycle((m) => {
      received.push(m)
    })
    expect(received[0]?.attachments.length).toBe(1)
    expect(warnSpy).toHaveBeenCalled()
  })
})
