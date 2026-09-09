// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import type { NotificationChannel, NotificationPayload } from './router.js'
import { generateId } from '@shared/crypto.js'

export interface RetryEngine {
  /** Enqueue a failed dispatch for retry */
  enqueue(notificationId: string, userId: string, channel: string, payload: NotificationPayload): void
  /** Process due retries — call periodically (e.g. every 30s) */
  processDue(channels: Map<string, NotificationChannel>): Promise<number>
  /** Get retry stats */
  stats(): { pending: number; failed: number }
  /** Stop the processor interval */
  stop(): void
}

const BACKOFF_BASE_MS = 30_000 // 30 seconds
const MAX_ATTEMPTS = 3

/**
 * Retry engine with exponential backoff for failed notification dispatches.
 *
 * Schedule: attempt 1 → +30s, attempt 2 → +60s, attempt 3 → +120s
 * After max attempts, status moves to 'failed' (dead letter).
 */
export function createRetryEngine(deps: {
  db: EyasDb
  logger: Logger
  intervalMs?: number
}): RetryEngine {
  const { db, logger, intervalMs = 30_000 } = deps
  let timer: ReturnType<typeof setInterval> | null = null

  function enqueue(notificationId: string, userId: string, channel: string, payload: NotificationPayload) {
    const id = generateId()
    const nextAttempt = new Date(Date.now() + BACKOFF_BASE_MS).toISOString()

    ;(db as any).run(
      sql`INSERT INTO notification_retry_queue (id, notification_id, user_id, channel, payload, attempts, max_attempts, next_attempt_at, status)
          VALUES (${id}, ${notificationId}, ${userId}, ${channel}, ${JSON.stringify(payload)}, ${0}, ${MAX_ATTEMPTS}, ${nextAttempt}, ${'pending'})`
    )

    logger.debug({ id, notificationId, channel }, 'Notification retry enqueued')
  }

  async function processDue(channels: Map<string, NotificationChannel>): Promise<number> {
    const now = new Date().toISOString()
    const rows = (db as any).all(
      sql`SELECT * FROM notification_retry_queue
          WHERE status = 'pending' AND next_attempt_at <= ${now}
          ORDER BY next_attempt_at ASC LIMIT 50`
    ) as any[]

    let processed = 0

    for (const row of rows) {
      const channel = channels.get(row.channel)
      if (!channel) {
        // Channel no longer registered — mark as failed
        ;(db as any).run(
          sql`UPDATE notification_retry_queue SET status = 'failed', last_error = 'Channel not registered' WHERE id = ${row.id}`
        )
        continue
      }

      const payload: NotificationPayload = JSON.parse(row.payload)
      const attempts = row.attempts + 1

      try {
        const sent = await channel.send(row.user_id, payload)
        if (sent) {
          ;(db as any).run(
            sql`UPDATE notification_retry_queue SET status = 'sent', attempts = ${attempts} WHERE id = ${row.id}`
          )
          logger.info({ id: row.id, channel: row.channel, attempts }, 'Retry succeeded')
        } else {
          handleFailedAttempt(row, attempts, 'Channel returned false')
        }
      } catch (err: any) {
        handleFailedAttempt(row, attempts, err.message ?? 'Unknown error')
      }

      processed++
    }

    return processed
  }

  function handleFailedAttempt(row: any, attempts: number, error: string) {
    if (attempts >= row.max_attempts) {
      ;(db as any).run(
        sql`UPDATE notification_retry_queue SET status = 'failed', attempts = ${attempts}, last_error = ${error} WHERE id = ${row.id}`
      )
      logger.warn({ id: row.id, channel: row.channel, attempts }, 'Retry exhausted — moved to dead letter')
    } else {
      // Exponential backoff: 30s * 2^attempts
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempts)
      const nextAttempt = new Date(Date.now() + backoffMs).toISOString()

      ;(db as any).run(
        sql`UPDATE notification_retry_queue SET attempts = ${attempts}, next_attempt_at = ${nextAttempt}, last_error = ${error} WHERE id = ${row.id}`
      )
      logger.debug({ id: row.id, channel: row.channel, attempts, nextAttempt }, 'Retry rescheduled')
    }
  }

  function stats(): { pending: number; failed: number } {
    const pending = ((db as any).all(
      sql`SELECT COUNT(*) as count FROM notification_retry_queue WHERE status = 'pending'`
    ) as any[])[0]?.count ?? 0

    const failed = ((db as any).all(
      sql`SELECT COUNT(*) as count FROM notification_retry_queue WHERE status = 'failed'`
    ) as any[])[0]?.count ?? 0

    return { pending, failed }
  }

  return {
    enqueue,
    processDue,
    stats,

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
