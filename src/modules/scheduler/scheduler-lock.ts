// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'

/**
 * Distributed advisory lock service backed by the `scheduler_locks` SQLite table.
 *
 * Guarantees:
 *   - Only one holder can own a given `lockKey` at any time (SQLite enforces this
 *     via `INSERT OR IGNORE` on the primary key).
 *   - Fresh heartbeats prevent other holders from taking over.
 *   - Expired locks (heartbeat older than TTL) can be stolen by a new holder,
 *     preventing orphaned locks from crashed processes blocking execution forever.
 *
 * Typical usage:
 *   const ok = lockService.tryAcquire('job:abc', holderId)
 *   if (!ok) return
 *   const heartbeat = setInterval(() => lockService.renew('job:abc', holderId), 10_000)
 *   try { ...run job... } finally {
 *     clearInterval(heartbeat)
 *     lockService.release('job:abc', holderId)
 *   }
 */

export interface SchedulerLockOptions {
  /** Lock TTL in milliseconds. Heartbeats older than this are considered expired. Default: 5 min. */
  ttlMs?: number
}

export interface SchedulerLockService {
  /** Attempt to acquire the lock. Returns true on success, false if a fresh lock exists. */
  tryAcquire(lockKey: string, holderId: string): boolean
  /** Refresh heartbeat on a lock we own. Returns true if still owned. */
  renew(lockKey: string, holderId: string): boolean
  /** Release a lock we own. Silently succeeds if lock doesn't exist. */
  release(lockKey: string, holderId: string): void
  /** Inspect current lock state (used primarily by tests). */
  inspect(lockKey: string): LockRow | null
}

export interface LockRow {
  lockKey: string
  holderId: string
  acquiredAt: number
  expiresAt: number
  heartbeatAt: number
}

export const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000 // 5 min

function toRow(raw: any): LockRow {
  return {
    lockKey: raw.lock_key,
    holderId: raw.holder_id,
    acquiredAt: raw.acquired_at,
    expiresAt: raw.expires_at,
    heartbeatAt: raw.heartbeat_at,
  }
}

export function createSchedulerLockService(
  db: any,
  logger: Logger,
  options: SchedulerLockOptions = {}
): SchedulerLockService {
  const ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS

  function inspect(lockKey: string): LockRow | null {
    const rows = db.all(
      sql`SELECT * FROM scheduler_locks WHERE lock_key = ${lockKey}`
    ) as any[]
    return rows.length > 0 ? toRow(rows[0]) : null
  }

  function tryAcquire(lockKey: string, holderId: string): boolean {
    const now = Date.now()
    const expiresAt = now + ttlMs

    // Fast path: nothing exists yet, insert wins atomically.
    const insert = db.run(
      sql`INSERT OR IGNORE INTO scheduler_locks
          (lock_key, holder_id, acquired_at, expires_at, heartbeat_at)
          VALUES (${lockKey}, ${holderId}, ${now}, ${expiresAt}, ${now})`
    )
    // better-sqlite3 returns `changes`, bun:sqlite the same. Fall back to inspect.
    const changes = (insert as any)?.changes
    if (changes === 1) {
      logger.debug({ lockKey, holderId }, 'scheduler lock acquired (new)')
      return true
    }

    // Slow path: an existing row blocks us. Check if the heartbeat has gone stale.
    const existing = inspect(lockKey)
    if (!existing) {
      // Race: row vanished between INSERT and SELECT. Retry once.
      const retry = db.run(
        sql`INSERT OR IGNORE INTO scheduler_locks
            (lock_key, holder_id, acquired_at, expires_at, heartbeat_at)
            VALUES (${lockKey}, ${holderId}, ${now}, ${expiresAt}, ${now})`
      )
      const retryChanges = (retry as any)?.changes
      if (retryChanges === 1) {
        logger.debug({ lockKey, holderId }, 'scheduler lock acquired (retry)')
        return true
      }
      return false
    }

    // A fresh heartbeat means someone is actively holding the lock — back off.
    if (existing.heartbeatAt + ttlMs > now) {
      return false
    }

    // Stale lock: take it over with a conditional UPDATE. The WHERE clause prevents
    // a race where someone else already refreshed the lock.
    const takeover = db.run(
      sql`UPDATE scheduler_locks
          SET holder_id = ${holderId},
              acquired_at = ${now},
              expires_at = ${expiresAt},
              heartbeat_at = ${now}
          WHERE lock_key = ${lockKey}
            AND heartbeat_at = ${existing.heartbeatAt}
            AND holder_id = ${existing.holderId}`
    )
    const takeoverChanges = (takeover as any)?.changes
    if (takeoverChanges === 1) {
      logger.debug(
        { lockKey, holderId, previousHolder: existing.holderId },
        'scheduler lock taken over (previous holder expired)'
      )
      return true
    }
    return false
  }

  function renew(lockKey: string, holderId: string): boolean {
    const now = Date.now()
    const expiresAt = now + ttlMs
    const result = db.run(
      sql`UPDATE scheduler_locks
          SET heartbeat_at = ${now}, expires_at = ${expiresAt}
          WHERE lock_key = ${lockKey} AND holder_id = ${holderId}`
    )
    const changes = (result as any)?.changes ?? 0
    return changes === 1
  }

  function release(lockKey: string, holderId: string): void {
    const result = db.run(
      sql`DELETE FROM scheduler_locks
          WHERE lock_key = ${lockKey} AND holder_id = ${holderId}`
    )
    const changes = (result as any)?.changes ?? 0
    if (changes > 0) {
      logger.debug({ lockKey, holderId }, 'scheduler lock released')
    }
  }

  return { tryAcquire, renew, release, inspect }
}
