// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Create notifications and notification_preferences tables.
 */
export function createNotificationTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    event TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    body TEXT,
    data TEXT,
    read_at TEXT,
    channels_sent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(user_id, read_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT NOT NULL,
    event_pattern TEXT NOT NULL,
    channel TEXT NOT NULL,
    min_severity TEXT NOT NULL DEFAULT 'info',
    quiet_hours TEXT,
    PRIMARY KEY (user_id, event_pattern, channel)
  )`)

  // Batch/digest queue — groups notifications within a time window per user+channel+pattern
  db.run(sql`CREATE TABLE IF NOT EXISTS notification_batch_queue (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    event_pattern TEXT NOT NULL,
    notification_ids TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notif_batch_due
              ON notification_batch_queue(sent_at, scheduled_at)`)

  // Retry queue — dead-letter friendly, exponential backoff
  db.run(sql`CREATE TABLE IF NOT EXISTS notification_retry_queue (
    id TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_notif_retry_due
              ON notification_retry_queue(status, next_attempt_at)`)

  // Webhook endpoints per user (for webhook channel)
  db.run(sql`CREATE TABLE IF NOT EXISTS notification_webhooks (
    user_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    secret TEXT,
    headers TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  // Interactive confirmation requests — agent asks human; Promise blocks until ack/decline/timeout.
  // NOTE: in-memory waiters are per-process. If the server restarts while a confirmation is
  // 'pending', the DB row stays as 'pending' indefinitely. A background reaper is out of scope
  // for MVP — callers should treat stale rows as implicitly declined after they expire.
  db.run(sql`CREATE TABLE IF NOT EXISTS pending_confirmations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id TEXT,
    title TEXT NOT NULL,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    timeout_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_pending_conf_user
              ON pending_confirmations(user_id, status)`)
}
