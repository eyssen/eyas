// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb, EyasBus } from '@core/types'
import { generateId } from '@shared/crypto.js'

// ─── Types ────────────────────────────────────────────

export type Severity = 'info' | 'warning' | 'error' | 'critical'

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
}

export interface NotifyEvent {
  event: string
  severity: Severity
  userId: string
  title: string
  body?: string
  data?: Record<string, unknown>
}

export interface NotificationPayload {
  id: string
  event: string
  severity: Severity
  title: string
  body?: string
  data?: Record<string, unknown>
  createdAt: string
}

export type DeliveryMode = 'immediate' | 'batched'

export interface NotificationPreference {
  userId: string
  eventPattern: string
  channel: string
  minSeverity: Severity
  quietHours: { from: string; to: string } | null
  /** 'immediate' (default) dispatches right away. 'batched' queues into the digest engine. */
  deliveryMode?: DeliveryMode
}

export interface NotificationChannel {
  id: string
  send(userId: string, payload: NotificationPayload): Promise<boolean>
}

export interface NotificationRecord {
  id: string
  userId: string
  event: string
  severity: Severity
  title: string
  body: string | null
  data: string | null
  readAt: string | null
  channelsSent: string | null
  createdAt: string
}

/** Minimal interface the router needs from the batch engine. */
export interface BatchEngineLike {
  enqueue(userId: string, channel: string, eventPattern: string, notification: NotificationPayload): void
  isBatchable(channel: string): boolean
}

/** Minimal interface the router needs from the retry engine. */
export interface RetryEngineLike {
  enqueue(notificationId: string, userId: string, channel: string, payload: NotificationPayload): void
}

export interface PendingConfirmation {
  id: string
  userId: string
  agentId: string | null
  title: string
  body: string | null
  status: 'pending' | 'acked' | 'declined' | 'timeout'
  timeoutAt: string
  createdAt: string
  resolvedAt: string | null
}

export interface NotificationRouter {
  /** Process a notification event through the routing pipeline */
  notify(event: NotifyEvent): Promise<string>
  /** Register a channel adapter */
  registerChannel(channel: NotificationChannel): void
  /** Expose the channel map (read-only view by reference, for batch/retry processors). */
  getChannels(): Map<string, NotificationChannel>
  /** Attach an optional batch engine. If present, preferences with deliveryMode='batched' route through it. */
  setBatchEngine(engine: BatchEngineLike | null): void
  /** Attach an optional retry engine. If present, failed dispatches are enqueued for retry. */
  setRetryEngine(engine: RetryEngineLike | null): void
  /** List notifications for a user */
  list(userId: string, opts?: { unreadOnly?: boolean; limit?: number; offset?: number }): NotificationRecord[]
  /** Count unread notifications */
  countUnread(userId: string): number
  /** Mark a notification as read */
  markRead(notificationId: string): void
  /** Mark all notifications as read for a user */
  markAllRead(userId: string): void
  /** Get user preferences */
  getPreferences(userId: string): NotificationPreference[]
  /** Update user preferences (upsert) */
  setPreference(pref: NotificationPreference): void
  /** Delete a preference */
  deletePreference(userId: string, eventPattern: string, channel: string): void
  /** Start listening on the bus */
  startBusListener(bus: EyasBus): void
  /**
   * Ask a human user to confirm an action. Blocks (via Promise) until the user
   * acks (true), declines (false), or the timeout elapses (false).
   */
  requestConfirmation(input: {
    userId: string
    title: string
    body?: string
    timeoutMs: number
    agentId?: string
  }): Promise<boolean>
  /** Ack a pending confirmation. Returns true if the row existed and was pending; false otherwise. */
  ackConfirmation(id: string): boolean
  /** Decline a pending confirmation. Returns true if the row existed and was pending; false otherwise. */
  declineConfirmation(id: string): boolean
  /** List all pending (status='pending') confirmations for a user, newest first. */
  listPendingConfirmations(userId: string): PendingConfirmation[]
}

// ─── Glob Matching ────────────────────────────────────

/**
 * Simple glob matcher for event patterns.
 * Supports `*` as a single-segment wildcard and `budget.*` style patterns.
 * Uses segment-based comparison instead of dynamic RegExp to avoid ReDoS.
 */
export function matchEventPattern(pattern: string, event: string): boolean {
  if (pattern === '*') return true
  if (pattern === event) return true

  const patternParts = pattern.split('.')
  const eventParts = event.split('.')

  if (patternParts.length !== eventParts.length) return false

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === '*') continue
    if (patternParts[i] !== eventParts[i]) return false
  }

  return true
}

// ─── Quiet Hours ──────────────────────────────────────

/**
 * Check if the current time falls within quiet hours.
 * Uses HH:MM format. Handles overnight ranges (e.g. 22:00 → 07:00).
 */
export function isInQuietHours(quietHours: { from: string; to: string } | null, now?: Date): boolean {
  if (!quietHours) return false

  const current = now ?? new Date()
  const currentMinutes = current.getHours() * 60 + current.getMinutes()

  const [fromH, fromM] = quietHours.from.split(':').map(Number)
  const [toH, toM] = quietHours.to.split(':').map(Number)
  const fromMinutes = fromH * 60 + fromM
  const toMinutes = toH * 60 + toM

  if (fromMinutes <= toMinutes) {
    // Same-day range (e.g., 09:00-17:00)
    return currentMinutes >= fromMinutes && currentMinutes < toMinutes
  }
  // Overnight range (e.g., 22:00-07:00)
  return currentMinutes >= fromMinutes || currentMinutes < toMinutes
}

// ─── Rate Limiter ─────────────────────────────────────

export function createRateLimiter(maxPerHour: number) {
  const timestamps = new Map<string, number[]>()

  return {
    check(userId: string): boolean {
      const now = Date.now()
      const hourAgo = now - 3600_000
      const userTs = timestamps.get(userId) ?? []
      const recent = userTs.filter(t => t > hourAgo)
      timestamps.set(userId, recent)
      return recent.length < maxPerHour
    },

    record(userId: string) {
      const userTs = timestamps.get(userId) ?? []
      userTs.push(Date.now())
      timestamps.set(userId, userTs)
    },

    /** Reset for testing */
    reset() {
      timestamps.clear()
    },
  }
}

// ─── Router Factory ───────────────────────────────────

export function createNotificationRouter(deps: {
  db: EyasDb
  logger: Logger
  bus?: EyasBus
  rateLimit?: number
}): NotificationRouter {
  const { db, logger, rateLimit = 20 } = deps
  let bus: EyasBus | undefined = deps.bus
  const channels = new Map<string, NotificationChannel>()
  const rateLimiter = createRateLimiter(rateLimit)
  let batchEngine: BatchEngineLike | null = null
  let retryEngine: RetryEngineLike | null = null

  // In-memory map of active confirmation waiters.
  // NOTE: cleared on process restart — orphaned DB rows stay 'pending' indefinitely.
  // A background reaper is intentionally out of scope for MVP.
  const confirmationWaiters = new Map<string, {
    resolve: (value: boolean) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  // Idempotent schema migration for an older preferences table without delivery_mode
  try {
    ;(db as any).run(sql`ALTER TABLE notification_preferences ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'immediate'`)
  } catch {
    // Column already exists — ignore
  }

  function loadPreferences(userId: string): NotificationPreference[] {
    const rows = (db as any).all(
      sql`SELECT user_id, event_pattern, channel, min_severity, quiet_hours, delivery_mode
          FROM notification_preferences WHERE user_id = ${userId}`
    ) as any[]

    return rows.map((r: any) => ({
      userId: r.user_id,
      eventPattern: r.event_pattern,
      channel: r.channel,
      minSeverity: r.min_severity as Severity,
      quietHours: r.quiet_hours ? JSON.parse(r.quiet_hours) : null,
      deliveryMode: (r.delivery_mode ?? 'immediate') as DeliveryMode,
    }))
  }

  function matchingPreferences(userId: string, event: string): NotificationPreference[] {
    const all = loadPreferences(userId)
    return all.filter(p => matchEventPattern(p.eventPattern, event))
  }

  return {
    registerChannel(channel: NotificationChannel) {
      channels.set(channel.id, channel)
      logger.debug({ channelId: channel.id }, 'Notification channel registered')
    },

    getChannels() {
      return channels
    },

    setBatchEngine(engine: BatchEngineLike | null) {
      batchEngine = engine
    },

    setRetryEngine(engine: RetryEngineLike | null) {
      retryEngine = engine
    },

    async notify(event: NotifyEvent): Promise<string> {
      const { userId, severity } = event

      // Rate limit check
      if (!rateLimiter.check(userId)) {
        logger.warn({ userId, event: event.event }, 'Notification rate limited')
        // Still store but don't dispatch
        const id = generateId()
        const now = new Date().toISOString()
        ;(db as any).run(
          sql`INSERT INTO notifications (id, user_id, event, severity, title, body, data, channels_sent, created_at)
              VALUES (${id}, ${userId}, ${event.event}, ${severity}, ${event.title},
                      ${event.body ?? null}, ${event.data ? JSON.stringify(event.data) : null},
                      ${JSON.stringify(['rate_limited'])}, ${now})`
        )
        return id
      }

      rateLimiter.record(userId)

      // Find matching preferences
      const prefs = matchingPreferences(userId, event.event)
      const channelsSent: string[] = []
      const id = generateId()
      const now = new Date().toISOString()

      const payload: NotificationPayload = {
        id,
        event: event.event,
        severity: event.severity,
        title: event.title,
        body: event.body,
        data: event.data,
        createdAt: now,
      }

      for (const pref of prefs) {
        // Severity filter
        if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[pref.minSeverity]) continue

        // Quiet hours (critical bypasses)
        if (severity !== 'critical' && isInQuietHours(pref.quietHours)) continue

        // Channel dispatch
        const channel = channels.get(pref.channel)
        if (!channel) continue

        // Batched delivery path — enqueue into the digest engine instead of dispatching now.
        // 'critical' severity bypasses batching to guarantee real-time delivery.
        if (
          batchEngine
          && pref.deliveryMode === 'batched'
          && batchEngine.isBatchable(pref.channel)
          && severity !== 'critical'
        ) {
          batchEngine.enqueue(userId, pref.channel, pref.eventPattern, payload)
          channelsSent.push(`${pref.channel}:batched`)
          continue
        }

        // Immediate dispatch — any failure (throw or false) is enqueued for retry when available
        try {
          const sent = await channel.send(userId, payload)
          if (sent) {
            channelsSent.push(pref.channel)
          } else if (retryEngine) {
            retryEngine.enqueue(id, userId, pref.channel, payload)
          }
        } catch (err) {
          logger.error({ err, channel: pref.channel, userId }, 'Channel dispatch failed')
          if (retryEngine) {
            retryEngine.enqueue(id, userId, pref.channel, payload)
          }
        }
      }

      // Store notification
      ;(db as any).run(
        sql`INSERT INTO notifications (id, user_id, event, severity, title, body, data, channels_sent, created_at)
            VALUES (${id}, ${userId}, ${event.event}, ${severity}, ${event.title},
                    ${event.body ?? null}, ${event.data ? JSON.stringify(event.data) : null},
                    ${JSON.stringify(channelsSent)}, ${now})`
      )

      logger.debug({ id, event: event.event, channels: channelsSent }, 'Notification dispatched')
      return id
    },

    list(userId, opts = {}) {
      const { unreadOnly = false, limit = 50, offset = 0 } = opts

      if (unreadOnly) {
        return (db as any).all(
          sql`SELECT id, user_id, event, severity, title, body, data, read_at, channels_sent, created_at
              FROM notifications WHERE user_id = ${userId} AND read_at IS NULL
              ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
        ).map(mapRow) as NotificationRecord[]
      }

      return (db as any).all(
        sql`SELECT id, user_id, event, severity, title, body, data, read_at, channels_sent, created_at
            FROM notifications WHERE user_id = ${userId}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
      ).map(mapRow) as NotificationRecord[]
    },

    countUnread(userId) {
      const rows = (db as any).all(
        sql`SELECT COUNT(*) as count FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`
      ) as any[]
      return rows[0]?.count ?? 0
    },

    markRead(notificationId) {
      const now = new Date().toISOString()
      ;(db as any).run(
        sql`UPDATE notifications SET read_at = ${now} WHERE id = ${notificationId}`
      )
    },

    markAllRead(userId) {
      const now = new Date().toISOString()
      ;(db as any).run(
        sql`UPDATE notifications SET read_at = ${now} WHERE user_id = ${userId} AND read_at IS NULL`
      )
    },

    getPreferences(userId) {
      return loadPreferences(userId)
    },

    setPreference(pref) {
      const quietJson = pref.quietHours ? JSON.stringify(pref.quietHours) : null
      const deliveryMode = pref.deliveryMode ?? 'immediate'
      ;(db as any).run(
        sql`INSERT OR REPLACE INTO notification_preferences (user_id, event_pattern, channel, min_severity, quiet_hours, delivery_mode)
            VALUES (${pref.userId}, ${pref.eventPattern}, ${pref.channel}, ${pref.minSeverity}, ${quietJson}, ${deliveryMode})`
      )
    },

    deletePreference(userId, eventPattern, channel) {
      ;(db as any).run(
        sql`DELETE FROM notification_preferences WHERE user_id = ${userId}
            AND event_pattern = ${eventPattern} AND channel = ${channel}`
      )
    },

    requestConfirmation(input) {
      const { userId, title, body, timeoutMs, agentId } = input
      const id = generateId()
      const timeoutAt = new Date(Date.now() + timeoutMs).toISOString()
      const now = new Date().toISOString()

      ;(db as any).run(
        sql`INSERT INTO pending_confirmations (id, user_id, agent_id, title, body, status, timeout_at, created_at)
            VALUES (${id}, ${userId}, ${agentId ?? null}, ${title}, ${body ?? null}, 'pending', ${timeoutAt}, ${now})`
      )

      bus?.emit('notifications.confirmation_requested', {
        id,
        userId,
        title,
        body: body ?? null,
        agentId: agentId ?? null,
        expiresAt: timeoutAt,
      })

      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          if (!confirmationWaiters.has(id)) return
          confirmationWaiters.delete(id)
          const resolvedAt = new Date().toISOString()
          ;(db as any).run(
            sql`UPDATE pending_confirmations SET status = 'timeout', resolved_at = ${resolvedAt}
                WHERE id = ${id} AND status = 'pending'`
          )
          logger.debug({ id, userId }, 'Confirmation timed out')
          resolve(false)
        }, timeoutMs)

        confirmationWaiters.set(id, { resolve, timer })
      })
    },

    ackConfirmation(id) {
      const rows = (db as any).all(
        sql`SELECT id, status FROM pending_confirmations WHERE id = ${id}`
      ) as any[]
      const row = rows[0]
      if (!row || row.status !== 'pending') return false

      const resolvedAt = new Date().toISOString()
      ;(db as any).run(
        sql`UPDATE pending_confirmations SET status = 'acked', resolved_at = ${resolvedAt}
            WHERE id = ${id}`
      )

      const waiter = confirmationWaiters.get(id)
      if (waiter) {
        clearTimeout(waiter.timer)
        confirmationWaiters.delete(id)
        waiter.resolve(true)
      }

      return true
    },

    declineConfirmation(id) {
      const rows = (db as any).all(
        sql`SELECT id, status FROM pending_confirmations WHERE id = ${id}`
      ) as any[]
      const row = rows[0]
      if (!row || row.status !== 'pending') return false

      const resolvedAt = new Date().toISOString()
      ;(db as any).run(
        sql`UPDATE pending_confirmations SET status = 'declined', resolved_at = ${resolvedAt}
            WHERE id = ${id}`
      )

      const waiter = confirmationWaiters.get(id)
      if (waiter) {
        clearTimeout(waiter.timer)
        confirmationWaiters.delete(id)
        waiter.resolve(false)
      }

      return true
    },

    listPendingConfirmations(userId) {
      const rows = (db as any).all(
        sql`SELECT id, user_id, agent_id, title, body, status, timeout_at, created_at, resolved_at
            FROM pending_confirmations
            WHERE user_id = ${userId} AND status = 'pending'
            ORDER BY created_at DESC`
      ) as any[]

      return rows.map((r: any): PendingConfirmation => ({
        id: r.id,
        userId: r.user_id,
        agentId: r.agent_id,
        title: r.title,
        body: r.body,
        status: r.status,
        timeoutAt: r.timeout_at,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      }))
    },

    startBusListener(busArg) {
      bus = busArg
      busArg.on('eyas.notify', async (data) => {
        const event = data as NotifyEvent
        if (!event.userId || !event.event || !event.title) {
          logger.warn({ data }, 'Invalid notification event — missing required fields')
          return
        }
        await this.notify({
          ...event,
          severity: event.severity ?? 'info',
        })
      })
      logger.info('Notification bus listener started')
    },
  }
}

export function mapNotificationRow(r: any): NotificationRecord {
  return {
    id: r.id,
    userId: r.user_id,
    event: r.event,
    severity: r.severity,
    title: r.title,
    body: r.body,
    data: r.data,
    readAt: r.read_at,
    channelsSent: r.channels_sent,
    createdAt: r.created_at,
  }
}

const mapRow = mapNotificationRow
