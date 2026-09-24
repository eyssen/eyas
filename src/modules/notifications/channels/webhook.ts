// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { NotificationChannel, NotificationPayload } from '../router.js'

export interface WebhookConfig {
  url: string
  secret?: string
  headers?: Record<string, string>
}

/**
 * Webhook notification channel — sends POST requests to user-configured URLs.
 * Signs payloads with HMAC-SHA256 if a shared secret is configured.
 * Enables integrations with n8n, Zapier, Home Assistant, etc.
 */
export function createWebhookChannel(deps: {
  /** Resolve user ID → webhook config. Returns null if user has no webhook configured */
  resolveWebhook: (userId: string) => WebhookConfig | null
  logger: Logger
}): NotificationChannel {
  const { resolveWebhook, logger } = deps

  return {
    id: 'webhook',

    async send(userId: string, payload: NotificationPayload): Promise<boolean> {
      const config = resolveWebhook(userId)
      if (!config) return false

      const body = JSON.stringify({
        event: payload.event,
        severity: payload.severity,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        createdAt: payload.createdAt,
        notificationId: payload.id,
      })

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'EYAS-Notifications/1.0',
        ...config.headers,
      }

      // HMAC-SHA256 signature if secret is configured
      if (config.secret) {
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(config.secret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        )
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
        const hex = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
        headers['X-EYAS-Signature'] = `sha256=${hex}`
      }

      try {
        const res = await fetch(config.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        })

        if (!res.ok) {
          logger.warn({ userId, url: config.url, status: res.status }, 'Webhook returned non-OK status')
          return false
        }

        return true
      } catch (err) {
        logger.error({ err, userId, url: config.url }, 'Webhook notification send failed')
        return false
      }
    },
  }
}
