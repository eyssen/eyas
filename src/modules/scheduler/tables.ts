// Part of eYssen. See LICENSE file for full copyright and licensing details.
// The single definition of the scheduler's tables. Production bootstrap and
// every test fixture call this, so a column added here cannot drift out of a
// fixture and fail later as "no such column".

import { sql } from 'drizzle-orm'

interface MinimalLogger {
  warn: (...args: any[]) => void
}

export function ensureSchedulerTables(db: any, logger?: MinimalLogger): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    trigger_config TEXT NOT NULL,
    handler TEXT NOT NULL,
    handler_config TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    consecutive_fails INTEGER NOT NULL DEFAULT 0,
    chain_next_job_id TEXT,
    chain_on_error TEXT DEFAULT 'stop',
    source TEXT NOT NULL DEFAULT 'system',
    kind TEXT NOT NULL DEFAULT 'handler',
    owner_agent_id TEXT,
    created_by TEXT,
    category TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    max_consecutive_fails INTEGER NOT NULL DEFAULT 5,
    last_result_summary TEXT,
    muted_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS job_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    error TEXT,
    result TEXT,
    scheduled_for TEXT,
    skip_reason TEXT,
    actor TEXT
  )`)

  db.run(sql`CREATE TABLE IF NOT EXISTS scheduler_locks (
    lock_key TEXT PRIMARY KEY,
    holder_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL
  )`)

  const tryAlter = (stmt: ReturnType<typeof sql>) => {
    try {
      db.run(stmt)
    } catch {
      /* column exists */
    }
  }
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN consecutive_fails INTEGER NOT NULL DEFAULT 0`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'system'`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'handler'`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN owner_agent_id TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN created_by TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN category TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN max_consecutive_fails INTEGER NOT NULL DEFAULT 5`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN last_result_summary TEXT`)
  tryAlter(sql`ALTER TABLE scheduled_jobs ADD COLUMN muted_until TEXT`)
  tryAlter(sql`ALTER TABLE job_executions ADD COLUMN scheduled_for TEXT`)
  tryAlter(sql`ALTER TABLE job_executions ADD COLUMN skip_reason TEXT`)
  tryAlter(sql`ALTER TABLE job_executions ADD COLUMN actor TEXT`)

  try {
    db.run(sql`CREATE TABLE IF NOT EXISTS job_admin_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      event TEXT NOT NULL,
      actor TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    )`)
    db.run(sql`CREATE INDEX IF NOT EXISTS idx_job_admin_events_job ON job_admin_events(job_id)`)
  } catch (err) {
    logger?.warn({ err }, 'scheduler: job_admin_events init failed')
  }

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_job_executions_job_id ON job_executions(job_id)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_job_executions_started ON job_executions(started_at)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_scheduler_locks_heartbeat ON scheduler_locks(heartbeat_at)`)
}
