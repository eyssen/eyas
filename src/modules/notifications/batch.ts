// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { NotificationChannel, NotificationPayload, NotificationRecord } from './router.js'
import { mapNotificationRow } from './router.js'
import { generateId } from '@shared/crypto.js'
import type { TemplateEngine } from './templates.js'

export interface BatchConfig {
  /** Time window in ms to collect notifications before sending digest (default: 5 min) */
  windowMs: number
  /** Channels that support batching (email, webhook) */
  batchableChannels: Set<string>
}

export interface BatchEngine {
  /** Add a notification to the batch queue instead of sending immediately */
  enqueue(userId: string, channel: string, eventPattern: string, notification: NotificationPayload): void
  /** Process all due batches — call periodically */
  processDue(channels: Map<string, NotificationChannel>, templates?: TemplateEngine): Promise<number>
  /** Check if a channel supports batching */
  isBatchable(channel: string): boolean
  /** Stop the processor interval */
  stop(): void
}

const DEFAULT_WINDOW_MS = 5 * 60_000 // 5 minutes

/**
 * Batch/digest engine — groups notifications by user+channel+event pattern
 * within a configurable time window, then sends a single digest.
 *
 * Useful for email (avoid spamming 10 emails in 5 minutes) and webhook
 * (reduce HTTP calls). Real-time channels (web, telegram) skip batching.
 */
export function createBatchEngine(deps: {
  db: EyasDb
  logger: Logger
  config?: Partial<BatchConfig>
}): BatchEngine {
  const { db, logger } = deps
  const windowMs = deps.config?.windowMs ?? DEFAULT_WINDOW_MS
  const batchableChannels = deps.config?.batchableChannels ?? new Set(['email', 'webhook'])
  let timer: ReturnType<typeof setInterval> | null = null

  function enqueue(userId: string, channel: string, eventPattern: string, notification: NotificationPayload) {
    // Check if there's an existing pending batch for this user+channel+pattern
    const existing = ((db as any).all(
      sql`SELECT id, notification_ids FROM notification_batch_queue
          WHERE user_id = ${userId} AND channel = ${channel} AND event_pattern = ${eventPattern}
          AND sent_at IS NULL
          ORDER BY created_at DESC LIMIT 1`
    ) as any[])[0]

    if (existing) {
      // Append to existing batch
      const ids: string[] = JSON.parse(existing.notification_ids)
      ids.push(notification.id)
      ;(db as any).run(
        sql`UPDATE notification_batch_queue SET notification_ids = ${JSON.stringify(ids)} WHERE id = ${existing.id}`
      )
      logger.debug({ batchId: existing.id, count: ids.length }, 'Notification added to existing batch')
    } else {
      // Create new batch
      const id = generateId()
      const scheduledAt = new Date(Date.now() + windowMs).toISOString()

      ;(db as any).run(
        sql`INSERT INTO notification_batch_queue (id, user_id, channel, event_pattern, notification_ids, scheduled_at)
            VALUES (${id}, ${userId}, ${channel}, ${eventPattern}, ${JSON.stringify([notification.id])}, ${scheduledAt})`
      )
      logger.debug({ batchId: id, channel, scheduledAt }, 'New notification batch created')
    }
  }

  async function processDue(channels: Map<string, NotificationChannel>, templates?: TemplateEngine): Promise<number> {
    const now = new Date().toISOString()
    const batches = (db as any).all(
      sql`SELECT * FROM notification_batch_queue
          WHERE sent_at IS NULL AND scheduled_at <= ${now}
          ORDER BY scheduled_at ASC LIMIT 20`
    ) as any[]

    let processed = 0

    for (const batch of batches) {
      const channel = channels.get(batch.channel)
      if (!channel) {
        ;(db as any).run(sql`UPDATE notification_batch_queue SET sent_at = ${now} WHERE id = ${batch.id}`)
        continue
      }

      const notificationIds: string[] = JSON.parse(batch.notification_ids)

      // Load the actual notifications from DB (raw snake_case → NotificationRecord)
      const notifications: NotificationRecord[] = []
      for (const nid of notificationIds) {
        const rows = (db as any).all(
          sql`SELECT * FROM notifications WHERE id = ${nid}`
        ) as any[]
        if (rows[0]) notifications.push(mapNotificationRow(rows[0]))
      }

      if (notifications.length === 0) {
        ;(db as any).run(sql`UPDATE notification_batch_queue SET sent_at = ${now} WHERE id = ${batch.id}`)
        continue
      }

      // Build digest payload
      const digestPayload: NotificationPayload = {
        id: batch.id,
        event: `digest.${batch.event_pattern}`,
        severity: getHighestSeverity(notifications),
        title: `${notifications.length} notification${notifications.length > 1 ? 's' : ''} — ${batch.event_pattern}`,
        body: templates
          ? templates.renderDigest(batch.channel, notifications)
          : notifications.map(n => `• ${n.title}`).join('\n'),
        data: { count: notifications.length, notificationIds, isDigest: true },
        createdAt: now,
      }

      try {
        await channel.send(batch.user_id, digestPayload)
        ;(db as any).run(sql`UPDATE notification_batch_queue SET sent_at = ${now} WHERE id = ${batch.id}`)
        logger.info({ batchId: batch.id, channel: batch.channel, count: notifications.length }, 'Batch digest sent')
      } catch (err) {
        logger.error({ err, batchId: batch.id }, 'Batch digest send failed')
      }

      processed++
    }

    return processed
  }

  return {
    enqueue,
    processDue,
    isBatchable(channel: string) {
      return batchableChannels.has(channel)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}

type SeverityLevel = 'info' | 'warning' | 'error' | 'critical'
const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, error: 2, critical: 3 }

function getHighestSeverity(notifications: any[]): SeverityLevel {
  let max = 0
  for (const n of notifications) {
    const rank = SEVERITY_RANK[n.severity] ?? 0
    if (rank > max) max = rank
  }
  return (['info', 'warning', 'error', 'critical'] as SeverityLevel[])[max]
}
