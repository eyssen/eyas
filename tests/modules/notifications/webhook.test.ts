import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createWebhookChannel } from '@modules/notifications/channels/webhook'
import type { NotificationPayload } from '@modules/notifications/router'

function logger() {
  return {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: () => logger(),
  } as any
}

const mkPayload = (): NotificationPayload => ({
  id: 'n1',
  event: 'budget.warning',
  severity: 'warning',
  title: 'title',
  body: 'body',
  data: { foo: 'bar' },
  createdAt: '2026-04-17T10:00:00Z',
})

let originalFetch: typeof fetch

beforeEach(() => {
  originalFetch = globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('createWebhookChannel', () => {
  it('returns false if user has no webhook configured', async () => {
    const channel = createWebhookChannel({
      resolveWebhook: () => null,
      logger: logger(),
    })
    const ok = await channel.send('u1', mkPayload())
    expect(ok).toBe(false)
  })

  it('POSTs JSON body with correct headers to configured URL', async () => {
    let capturedUrl = ''
    let capturedInit: any = null
    globalThis.fetch = (async (url: any, init: any) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response('ok', { status: 200 })
    }) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({ url: 'https://example.com/hook' }),
      logger: logger(),
    })
    const ok = await channel.send('u1', mkPayload())
    expect(ok).toBe(true)
    expect(capturedUrl).toBe('https://example.com/hook')
    expect(capturedInit.method).toBe('POST')
    expect(capturedInit.headers['Content-Type']).toBe('application/json')
    expect(capturedInit.headers['User-Agent']).toContain('EYAS-Notifications')

    const body = JSON.parse(capturedInit.body)
    expect(body.title).toBe('title')
    expect(body.event).toBe('budget.warning')
    expect(body.data).toEqual({ foo: 'bar' })
  })

  it('adds HMAC-SHA256 signature header when a secret is configured', async () => {
    let capturedHeaders: any = null
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedHeaders = init.headers
      return new Response('ok', { status: 200 })
    }) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({ url: 'https://example.com/hook', secret: 'shhh' }),
      logger: logger(),
    })
    await channel.send('u1', mkPayload())

    expect(capturedHeaders['X-EYAS-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('does not include signature header when secret is absent', async () => {
    let capturedHeaders: any = null
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedHeaders = init.headers
      return new Response('ok', { status: 200 })
    }) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({ url: 'https://example.com/hook' }),
      logger: logger(),
    })
    await channel.send('u1', mkPayload())
    expect(capturedHeaders['X-EYAS-Signature']).toBeUndefined()
  })

  it('merges user-provided headers with defaults', async () => {
    let captured: any = null
    globalThis.fetch = (async (_url: any, init: any) => {
      captured = init.headers
      return new Response('ok', { status: 200 })
    }) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({
        url: 'https://example.com/hook',
        headers: { 'X-Custom': 'yes', 'Content-Type': 'application/json' },
      }),
      logger: logger(),
    })
    await channel.send('u1', mkPayload())
    expect(captured['X-Custom']).toBe('yes')
    expect(captured['Content-Type']).toBe('application/json')
  })

  it('returns false on non-2xx response', async () => {
    globalThis.fetch = (async () => new Response('bad', { status: 500 })) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({ url: 'https://example.com/hook' }),
      logger: logger(),
    })
    const ok = await channel.send('u1', mkPayload())
    expect(ok).toBe(false)
  })

  it('returns false on fetch error', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED') }) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({ url: 'https://example.com/hook' }),
      logger: logger(),
    })
    const ok = await channel.send('u1', mkPayload())
    expect(ok).toBe(false)
  })

  it('produces deterministic HMAC across runs for identical payload', async () => {
    const collected: string[] = []
    globalThis.fetch = (async (_url: any, init: any) => {
      collected.push(init.headers['X-EYAS-Signature'])
      return new Response('ok', { status: 200 })
    }) as any

    const channel = createWebhookChannel({
      resolveWebhook: () => ({ url: 'https://example.com/hook', secret: 'shhh' }),
      logger: logger(),
    })
    const p = mkPayload()
    await channel.send('u1', p)
    await channel.send('u1', p)
    expect(collected[0]).toBe(collected[1])
  })
})
