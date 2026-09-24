// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0'

/**
 * Verify Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the RAW request body
 * keyed with the WhatsApp app secret, compared in constant time.
 * Returns false (fail-closed) when the secret is missing, the header is absent
 * or malformed, or the digests differ.
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret) return false
  if (!header || !header.startsWith('sha256=')) return false
  const provided = header.slice('sha256='.length)
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  // Both are lowercase hex of the same length (64) on a valid signature; a
  // length mismatch means it can't match — bail before timingSafeEqual throws.
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/**
 * WhatsApp Business Cloud API adapter.
 * Receives messages via webhook (GET verify + POST events),
 * sends messages via Meta Graph API REST calls.
 */
export function createWhatsAppAdapter(config: {
  phoneNumberId?: string
  accessToken?: string
  verifyToken?: string
  appSecret?: string
  logger: Logger
  http?: any // Hono app instance for webhook registration
}): Channel & { isConfigured: boolean } {
  const { phoneNumberId, accessToken, verifyToken, appSecret, logger, http } = config
  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let connected = false

  const isConfigured = !!(phoneNumberId && accessToken && verifyToken)

  function registerWebhook() {
    if (!http) return

    // Webhook verification (GET)
    http.get('/api/v1/webhooks/whatsapp', (c: any) => {
      const mode = c.req.query('hub.mode')
      const token = c.req.query('hub.verify_token')
      const challenge = c.req.query('hub.challenge')
      if (mode === 'subscribe' && token === verifyToken) {
        logger.info('WhatsApp webhook verified')
        return c.text(challenge ?? '')
      }
      return c.text('Forbidden', 403)
    })

    // Incoming messages (POST)
    http.post('/api/v1/webhooks/whatsapp', async (c: any) => {
      try {
        // This webhook is on the public (unauthenticated) allowlist, so the ONLY
        // thing proving the payload came from Meta is the X-Hub-Signature-256
        // HMAC over the raw body. Verify it before parsing/dispatching. Missing
        // app secret ⇒ fail closed (reject), never fail open.
        const rawBody = await c.req.text()
        const signature = c.req.header('x-hub-signature-256')
        if (!verifyWhatsAppSignature(rawBody, signature, appSecret)) {
          logger.warn({ hasSecret: !!appSecret, hasSignature: !!signature }, 'WhatsApp: rejected webhook with invalid/missing signature')
          return c.text('Forbidden', 403)
        }
        const body = JSON.parse(rawBody)
        const entry = body?.entry?.[0]
        const changes = entry?.changes?.[0]?.value
        const messages = changes?.messages
        if (!Array.isArray(messages)) return c.json({ ok: true })

        for (const msg of messages) {
          if (msg.type !== 'text') continue
          const channelMsg: ChannelMessage = {
            id: msg.id,
            channelType: 'whatsapp',
            channelId: changes.metadata?.phone_number_id ?? phoneNumberId ?? 'whatsapp',
            senderId: msg.from,
            senderName: changes.contacts?.find((c: any) => c.wa_id === msg.from)?.profile?.name,
            content: msg.text?.body ?? '',
            timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
          }
          for (const handler of handlers) {
            try { await handler(channelMsg) }
            catch (err) { logger.error({ err }, 'WhatsApp: handler error') }
          }
        }
      } catch (err) {
        logger.error({ err }, 'WhatsApp: webhook processing error')
      }
      return c.json({ ok: true })
    })

    logger.info('WhatsApp webhook routes registered at /api/v1/webhooks/whatsapp')
  }

  return {
    id: 'whatsapp',
    type: 'whatsapp',
    name: 'WhatsApp Business',
    get connected() { return connected },
    isConfigured,

    async connect() {
      if (!isConfigured) {
        logger.debug('WhatsApp: not configured (missing phoneNumberId, accessToken, or verifyToken)')
        return
      }
      registerWebhook()
      connected = true
      logger.info({ phoneNumberId }, 'WhatsApp adapter connected')
    },

    async disconnect() {
      connected = false
      logger.info('WhatsApp adapter disconnected')
    },

    async send(to: string, content: ChannelContent) {
      if (!connected || !phoneNumberId || !accessToken) return
      try {
        const res = await fetch(`${GRAPH_API_URL}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: content.text ?? '' },
          }),
        })
        if (!res.ok) {
          const err = await res.text()
          logger.error({ status: res.status, err, to }, 'WhatsApp: send failed')
        }
      } catch (err) {
        logger.error({ err, to }, 'WhatsApp: send error')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      await this.send(originalMsg.senderId, content)
    },

    onMessage(handler) {
      handlers.push(handler)
    },
  }
}
