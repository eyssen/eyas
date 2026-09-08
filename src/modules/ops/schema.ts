// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

/**
 * Ops module schema.
 *
 * ops_incidents: observations raised by observers, deduplicated by (kind,
 *   namespace, resource) at the service layer. Signed-metrics record is kept
 *   base64 for later re-verification.
 *
 * ops_actions: proposals/applied actions, one-to-many from incidents.
 *   payload is JSON (kubectl command + args, helm values, PR diff, ...).
 *
 * ops_runbooks: runbook cache loaded from the bundled YAML dir at startup;
 *   persisted so the UI can list/edit without touching disk.
 */
export function createOpsTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS ops_incidents (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    severity TEXT NOT NULL,
    kind TEXT NOT NULL,
    namespace TEXT NOT NULL,
    resource TEXT NOT NULL,
    summary TEXT NOT NULL,
    details TEXT NOT NULL,
    signed_record TEXT,
    verified INTEGER,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ops_incidents_status
    ON ops_incidents(status, severity, created_at DESC)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ops_incidents_kind
    ON ops_incidents(kind, namespace, resource)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS ops_actions (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    approval_queue_id TEXT,
    approved_by TEXT,
    approved_at INTEGER,
    applied_at INTEGER,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  // Migration: add approval_queue_id to a DB created before this column
  // existed (e.g. a local dev DB from an earlier iteration of this staged
  // feature). Idempotent — no-op once the column is present.
  try {
    db.run(sql`ALTER TABLE ops_actions ADD COLUMN approval_queue_id TEXT`)
  } catch { /* column already exists */ }

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ops_actions_incident
    ON ops_actions(incident_id, created_at DESC)`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ops_actions_pending
    ON ops_actions(applied_at, approved_at)`)

  db.run(sql`CREATE TABLE IF NOT EXISTS ops_runbooks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    matcher TEXT NOT NULL,
    diagnosis_template TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    severity TEXT NOT NULL,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    last_updated INTEGER NOT NULL
  )`)

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ops_runbooks_kind
    ON ops_runbooks(kind)`)
}
