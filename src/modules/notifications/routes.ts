// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { requirePermission } from '@modules/permissions/middleware'
import type { EyasDb } from '@core/types'
import type { NotificationRouter, Severity, DeliveryMode, PendingConfirmation } from './router.js'
import type { RetryEngine } from './retry.js'

interface RoutesDeps {
  router: NotificationRouter
  retryEngine?: RetryEngine
  db: EyasDb
}

/**
 * Strict URL validator for webhook endpoints.
 * Blocks non-http(s) schemes, localhost, and RFC1918/loopback hosts to mitigate
 * SSRF from arbitrary user-supplied URLs.
 */
function validateWebhookUrl(url: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only http(s) schemes allowed' }
  }
  const host = parsed.hostname.toLowerCase()
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254', // cloud metadata
  ]
  if (blocked.includes(host)) {
    return { ok: false, reason: 'Host blocked (SSRF guard)' }
  }
  if (host.endsWith('.localhost') || host.endsWith('.internal')) {
    return { ok: false, reason: 'Internal host blocked' }
  }
  return { ok: true, url: parsed }
}

export function createNotificationRoutes(app: Hono, deps: RoutesDeps | NotificationRouter) {
  // Backward-compatible call: accept bare router
  const normalized: RoutesDeps = 'router' in (deps as any)
    ? (deps as RoutesDeps)
    : { router: deps as NotificationRouter, db: undefined as unknown as EyasDb }

  const { router, retryEngine, db } = normalized
  const api = new Hono()

  // List notifications (with optional ?unread=true, ?limit=50, ?offset=0)
  api.get('/notifications', requirePermission('read', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    const unreadOnly = c.req.query('unread') === 'true'
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200)
    const offset = Number(c.req.query('offset') ?? 0)

    const notifications = router.list(userId, { unreadOnly, limit, offset })
    const unreadCount = router.countUnread(userId)

    return c.json({ notifications, unreadCount })
  })

  // Mark single notification as read
  api.post('/notifications/:id/read', requirePermission('update', 'Notification'), (c: any) => {
    const id = c.req.param('id')
    router.markRead(id)
    return c.json({ message: 'Marked as read' })
  })

  // Mark all notifications as read
  api.post('/notifications/read-all', requirePermission('update', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    router.markAllRead(userId)
    return c.json({ message: 'All marked as read' })
  })

  // Get notification preferences
  api.get('/notification-preferences', requirePermission('read', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    const preferences = router.getPreferences(userId)
    return c.json({ preferences })
  })

  // Update notification preferences (upsert)
  api.patch('/notification-preferences', requirePermission('update', 'Notification'), async (c: any) => {
    const userId = c.get('userId') as string
    const body = await c.req.json() as {
      eventPattern: string
      channel: string
      minSeverity?: Severity
      quietHours?: { from: string; to: string } | null
      deliveryMode?: DeliveryMode
    }

    router.setPreference({
      userId,
      eventPattern: body.eventPattern,
      channel: body.channel,
      minSeverity: body.minSeverity ?? 'info',
      quietHours: body.quietHours ?? null,
      deliveryMode: body.deliveryMode ?? 'immediate',
    })

    return c.json({ message: 'Preference updated' })
  })

  // Delete a preference — query params so browser/fetch DELETE can omit a body
  api.delete('/notification-preferences', requirePermission('update', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    const eventPattern = c.req.query('eventPattern')
    const channel = c.req.query('channel')
    if (!eventPattern || !channel) {
      return c.json({ error: 'eventPattern and channel query params required' }, 400)
    }
    router.deletePreference(userId, eventPattern, channel)
    return c.json({ message: 'Preference deleted' })
  })

  // ─── Pending Confirmations ─────────────────────────
  // List pending confirmations for the authenticated user
  api.get('/notifications/confirmations', requirePermission('read', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    const confirmations: PendingConfirmation[] = router.listPendingConfirmations(userId)
    return c.json({ confirmations })
  })

  // Ack a pending confirmation
  api.post('/notifications/confirmations/:id/ack', requirePermission('update', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    const id = c.req.param('id') as string

    // Scope check: only the target user can ack (do not leak existence to others)
    const pending = router.listPendingConfirmations(userId)
    const owned = pending.some(p => p.id === id)
    if (!owned) return c.json({ error: 'Not found' }, 404)

    const ok = router.ackConfirmation(id)
    if (!ok) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
  })

  // Decline a pending confirmation
  api.post('/notifications/confirmations/:id/decline', requirePermission('update', 'Notification'), (c: any) => {
    const userId = c.get('userId') as string
    const id = c.req.param('id') as string

    const pending = router.listPendingConfirmations(userId)
    const owned = pending.some(p => p.id === id)
    if (!owned) return c.json({ error: 'Not found' }, 404)

    const ok = router.declineConfirmation(id)
    if (!ok) return c.json({ error: 'Not found' }, 404)
    return c.json({ ok: true })
  })

  // Retry queue stats — ops visibility
  api.get('/notifications/retry-stats', requirePermission('read', 'Notification'), (c: any) => {
    if (!retryEngine) return c.json({ pending: 0, failed: 0, enabled: false })
    return c.json({ ...retryEngine.stats(), enabled: true })
  })

  // ─── Webhook config (per-user) ──────────────────────
  if (db) {
    api.get('/notification-webhooks', requirePermission('read', 'Notification'), (c: any) => {
      const userId = c.get('userId') as string
      const rows = (db as any).all(
        sql`SELECT user_id, url, secret, headers, enabled, created_at, updated_at
            FROM notification_webhooks WHERE user_id = ${userId}`
      ) as any[]
      const row = rows[0]
      if (!row) return c.json({ webhook: null })
      return c.json({
        webhook: {
          url: row.url,
          // Do not leak the full secret — just indicate presence
          hasSecret: !!row.secret,
          headers: row.headers ? JSON.parse(row.headers) : {},
          enabled: !!row.enabled,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      })
    })

    api.put('/notification-webhooks', requirePermission('update', 'Notification'), async (c: any) => {
      const userId = c.get('userId') as string
      const body = await c.req.json() as {
        url: string
        secret?: string
        headers?: Record<string, string>
        enabled?: boolean
      }
      const validated = validateWebhookUrl(body.url ?? '')
      if (!validated.ok) {
        return c.json({ error: validated.reason }, 400)
      }
      const now = new Date().toISOString()
      const headersJson = body.headers ? JSON.stringify(body.headers) : null
      ;(db as any).run(
        sql`INSERT INTO notification_webhooks (user_id, url, secret, headers, enabled, created_at, updated_at)
            VALUES (${userId}, ${validated.url.toString()}, ${body.secret ?? null}, ${headersJson},
                    ${body.enabled === false ? 0 : 1}, ${now}, ${now})
            ON CONFLICT(user_id) DO UPDATE SET
              url = excluded.url,
              secret = excluded.secret,
              headers = excluded.headers,
              enabled = excluded.enabled,
              updated_at = excluded.updated_at`
      )
      return c.json({ message: 'Webhook saved' })
    })

    api.delete('/notification-webhooks', requirePermission('update', 'Notification'), (c: any) => {
      const userId = c.get('userId') as string
      ;(db as any).run(sql`DELETE FROM notification_webhooks WHERE user_id = ${userId}`)
      return c.json({ message: 'Webhook deleted' })
    })
  }

  app.route('/api/v1', api)
}
