// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { Hono } from 'hono'
import pino from 'pino'
import { createWhatsAppAdapter, verifyWhatsAppSignature } from '../../../src/modules/communication/submodules/whatsapp/adapter.js'

const logger = pino({ level: 'silent' })

const APP_SECRET = 'super-secret-app-secret'

function sign(body: string, secret = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

const SAMPLE_PAYLOAD = JSON.stringify({
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: 'pn1' },
    messages: [{ type: 'text', id: 'wamid.1', from: '15551234567', text: { body: 'hello' }, timestamp: '1700000000' }],
  } }] }],
})

describe('WhatsApp adapter', () => {
  it('creates channel with correct id, type, name', () => {
    const adapter = createWhatsAppAdapter({ logger })
    expect(adapter.id).toBe('whatsapp')
    expect(adapter.type).toBe('whatsapp')
    expect(adapter.name).toBe('WhatsApp Business')
  })

  it('connected is false initially', () => {
    const adapter = createWhatsAppAdapter({ logger })
    expect(adapter.connected).toBe(false)
  })

  it('isConfigured is false without credentials', () => {
    const adapter = createWhatsAppAdapter({ logger })
    expect(adapter.isConfigured).toBe(false)
  })

  it('isConfigured is true when all credentials are provided', () => {
    const adapter = createWhatsAppAdapter({
      phoneNumberId: '123456789',
      accessToken: 'EAA...',
      verifyToken: 'my-verify-token',
      logger,
    })
    expect(adapter.isConfigured).toBe(true)
  })

  it('onMessage registers handlers without error', () => {
    const adapter = createWhatsAppAdapter({ logger })
    expect(() => {
      adapter.onMessage(async (_msg) => {})
    }).not.toThrow()
  })
})

describe('verifyWhatsAppSignature', () => {
  it('accepts a correct HMAC-SHA256 signature', () => {
    expect(verifyWhatsAppSignature(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD), APP_SECRET)).toBe(true)
  })

  it('rejects a signature computed with the wrong secret', () => {
    expect(verifyWhatsAppSignature(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD, 'wrong'), APP_SECRET)).toBe(false)
  })

  it('rejects a tampered body', () => {
    const sig = sign(SAMPLE_PAYLOAD)
    expect(verifyWhatsAppSignature(SAMPLE_PAYLOAD + ' ', sig, APP_SECRET)).toBe(false)
  })

  it('fails closed when no app secret is configured', () => {
    expect(verifyWhatsAppSignature(SAMPLE_PAYLOAD, sign(SAMPLE_PAYLOAD), undefined)).toBe(false)
  })

  it('rejects a missing or malformed header', () => {
    expect(verifyWhatsAppSignature(SAMPLE_PAYLOAD, undefined, APP_SECRET)).toBe(false)
    expect(verifyWhatsAppSignature(SAMPLE_PAYLOAD, 'deadbeef', APP_SECRET)).toBe(false)
  })
})

describe('WhatsApp webhook POST — signature gate', () => {
  function mount(appSecret?: string) {
    const http = new Hono()
    const received: any[] = []
    const adapter = createWhatsAppAdapter({
      phoneNumberId: 'pn1', accessToken: 'tok', verifyToken: 'vt', appSecret, logger, http: http as any,
    })
    adapter.onMessage(async (msg) => { received.push(msg) })
    // connect() registers the webhook routes (adapter is fully configured)
    return { http, adapter, received }
  }

  it('dispatches a message when the signature is valid', async () => {
    const { http, adapter, received } = mount(APP_SECRET)
    await adapter.connect()
    const res = await http.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(SAMPLE_PAYLOAD) },
      body: SAMPLE_PAYLOAD,
    })
    expect(res.status).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0].senderId).toBe('15551234567')
    expect(received[0].content).toBe('hello')
  })

  it('rejects (403) and dispatches nothing when the signature is invalid', async () => {
    const { http, adapter, received } = mount(APP_SECRET)
    await adapter.connect()
    const res = await http.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(SAMPLE_PAYLOAD, 'wrong') },
      body: SAMPLE_PAYLOAD,
    })
    expect(res.status).toBe(403)
    expect(received).toHaveLength(0)
  })

  it('rejects (403) when no signature header is present', async () => {
    const { http, adapter, received } = mount(APP_SECRET)
    await adapter.connect()
    const res = await http.request('/api/v1/webhooks/whatsapp', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: SAMPLE_PAYLOAD,
    })
    expect(res.status).toBe(403)
    expect(received).toHaveLength(0)
  })

  it('fails closed (403) when no app secret is configured, even with a header', async () => {
    const { http, adapter, received } = mount(undefined)
    await adapter.connect()
    const res = await http.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(SAMPLE_PAYLOAD) },
      body: SAMPLE_PAYLOAD,
    })
    expect(res.status).toBe(403)
    expect(received).toHaveLength(0)
  })
})
