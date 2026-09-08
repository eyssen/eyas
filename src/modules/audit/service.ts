// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'

// ─── Types ──────────────────────────────────────────────

export interface AuditEntry {
  id: string
  timestamp: string
  userId: string | null
  action: string
  module: string
  target: string | null
  details: unknown | null
  result: 'success' | 'error' | 'denied' | 'rolled-back'
  snapshotId: string | null
  reversible: boolean
  costUsd: number | null
}

export interface AuditSnapshot {
  id: string
  auditEntryId: string
  type: 'file' | 'db_record' | 'config' | 'git_state'
  originalData: string
  path: string
  restorable: boolean
  restoredAt: string | null
  createdAt: string
}

export interface LogEntryInput {
  userId?: string | null
  action: string
  module: string
  target?: string | null
  details?: unknown | null
  result?: 'success' | 'error' | 'denied' | 'rolled-back'
  reversible?: boolean
  costUsd?: number | null
}

export interface SnapshotInput {
  type: 'file' | 'db_record' | 'config' | 'git_state'
  originalData: string
  path: string
  restorable?: boolean
}

export interface AuditQueryFilters {
  userId?: string
  action?: string
  module?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface AuditStats {
  totalEntries: number
  actionsPerDay: number
  topModules: Array<{ module: string; count: number }>
  totalCostUsd: number
}

export interface AuditEntryWithSnapshot extends AuditEntry {
  snapshot: AuditSnapshot | null
}

export interface AuditService {
  log(input: LogEntryInput): AuditEntry
  snapshot(entryId: string, input: SnapshotInput): AuditSnapshot
  rollback(entryId: string): AuditEntry
  query(filters: AuditQueryFilters): { entries: AuditEntry[]; total: number }
  getById(id: string): AuditEntryWithSnapshot | null
  getStats(): AuditStats
}

// ─── Mappers ────────────────────────────────────────────

function toEntry(raw: any): AuditEntry {
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    userId: raw.user_id ?? null,
    action: raw.action,
    module: raw.module,
    target: raw.target ?? null,
    details: raw.details ? JSON.parse(raw.details) : null,
    result: raw.result,
    snapshotId: raw.snapshot_id ?? null,
    reversible: raw.reversible === 1,
    costUsd: raw.cost_usd ?? null,
  }
}

function toSnapshot(raw: any): AuditSnapshot {
  return {
    id: raw.id,
    auditEntryId: raw.audit_entry_id,
    type: raw.type,
    originalData: raw.original_data,
    path: raw.path,
    restorable: raw.restorable === 1,
    restoredAt: raw.restored_at ?? null,
    createdAt: raw.created_at,
  }
}

// ─── Service ────────────────────────────────────────────

export function createAuditService(db: EyasDb): AuditService {
  return {
    log(input: LogEntryInput): AuditEntry {
      const id = generateId()
      const detailsJson = input.details != null ? JSON.stringify(input.details) : null
      const result = input.result ?? 'success'
      const reversible = input.reversible ? 1 : 0
      const costUsd = input.costUsd ?? null

      db.run(sql`INSERT INTO audit_entries (id, user_id, action, module, target, details, result, reversible, cost_usd)
        VALUES (${id}, ${input.userId ?? null}, ${input.action}, ${input.module}, ${input.target ?? null}, ${detailsJson}, ${result}, ${reversible}, ${costUsd})`)

      const rows = (db as any).all(sql`SELECT * FROM audit_entries WHERE id = ${id}`) as any[]
      return toEntry(rows[0])
    },

    snapshot(entryId: string, input: SnapshotInput): AuditSnapshot {
      const id = generateId()
      const restorable = input.restorable !== false ? 1 : 0

      db.run(sql`INSERT INTO audit_snapshots (id, audit_entry_id, type, original_data, path, restorable)
        VALUES (${id}, ${entryId}, ${input.type}, ${input.originalData}, ${input.path}, ${restorable})`)

      // Link snapshot to entry
      db.run(sql`UPDATE audit_entries SET snapshot_id = ${id} WHERE id = ${entryId}`)

      const rows = (db as any).all(sql`SELECT * FROM audit_snapshots WHERE id = ${id}`) as any[]
      return toSnapshot(rows[0])
    },

    rollback(entryId: string): AuditEntry {
      const entryRows = (db as any).all(sql`SELECT * FROM audit_entries WHERE id = ${entryId}`) as any[]
      if (entryRows.length === 0) throw new Error(`Audit entry not found: ${entryId}`)

      const entry = toEntry(entryRows[0])
      if (!entry.snapshotId) throw new Error(`No snapshot for audit entry: ${entryId}`)

      const snapRows = (db as any).all(sql`SELECT * FROM audit_snapshots WHERE id = ${entry.snapshotId}`) as any[]
      if (snapRows.length === 0) throw new Error(`Snapshot not found: ${entry.snapshotId}`)

      const snap = toSnapshot(snapRows[0])
      if (!snap.restorable) throw new Error(`Snapshot is not restorable: ${snap.id}`)
      if (snap.restoredAt) throw new Error(`Snapshot already restored at: ${snap.restoredAt}`)

      // Mark snapshot as restored
      const now = new Date().toISOString()
      db.run(sql`UPDATE audit_snapshots SET restored_at = ${now} WHERE id = ${snap.id}`)

      // Mark entry as rolled-back
      db.run(sql`UPDATE audit_entries SET result = 'rolled-back' WHERE id = ${entryId}`)

      const updatedRows = (db as any).all(sql`SELECT * FROM audit_entries WHERE id = ${entryId}`) as any[]
      return toEntry(updatedRows[0])
    },

    query(filters: AuditQueryFilters): { entries: AuditEntry[]; total: number } {
      const lim = filters.limit ?? 50
      const off = filters.offset ?? 0

      // Build WHERE with drizzle sql template chunks
      const chunks: ReturnType<typeof sql>[] = [sql`1=1`]

      if (filters.userId) {
        chunks.push(sql`AND user_id = ${filters.userId}`)
      }
      if (filters.action) {
        chunks.push(sql`AND action LIKE ${'%' + filters.action + '%'}`)
      }
      if (filters.module) {
        chunks.push(sql`AND module = ${filters.module}`)
      }
      if (filters.from) {
        chunks.push(sql`AND timestamp >= ${filters.from}`)
      }
      if (filters.to) {
        chunks.push(sql`AND timestamp <= ${filters.to}`)
      }

      const where = sql.join(chunks, sql` `)

      const countRows = (db as any).all(
        sql`SELECT COUNT(*) as cnt FROM audit_entries WHERE ${where}`
      ) as any[]
      const total = countRows[0]?.cnt ?? 0

      const dataRows = (db as any).all(
        sql`SELECT * FROM audit_entries WHERE ${where} ORDER BY timestamp DESC LIMIT ${lim} OFFSET ${off}`
      ) as any[]

      return {
        entries: dataRows.map(toEntry),
        total,
      }
    },

    getById(id: string): AuditEntryWithSnapshot | null {
      const entryRows = (db as any).all(sql`SELECT * FROM audit_entries WHERE id = ${id}`) as any[]
      if (entryRows.length === 0) return null

      const entry = toEntry(entryRows[0])
      let snapshot: AuditSnapshot | null = null

      if (entry.snapshotId) {
        const snapRows = (db as any).all(sql`SELECT * FROM audit_snapshots WHERE id = ${entry.snapshotId}`) as any[]
        if (snapRows.length > 0) snapshot = toSnapshot(snapRows[0])
      }

      return { ...entry, snapshot }
    },

    getStats(): AuditStats {
      const totalRows = (db as any).all(sql`SELECT COUNT(*) as cnt FROM audit_entries`) as any[]
      const totalEntries = totalRows[0]?.cnt ?? 0

      const costRows = (db as any).all(sql`SELECT COALESCE(SUM(cost_usd), 0) as total FROM audit_entries`) as any[]
      const totalCostUsd = costRows[0]?.total ?? 0

      // Average actions per day (over last 30 days)
      const avgRows = (db as any).all(sql`SELECT COUNT(*) as cnt FROM audit_entries WHERE timestamp >= datetime('now', '-30 days')`) as any[]
      const last30 = avgRows[0]?.cnt ?? 0
      const actionsPerDay = Math.round((last30 / 30) * 100) / 100

      // Top modules
      const moduleRows = (db as any).all(sql`SELECT module, COUNT(*) as cnt FROM audit_entries GROUP BY module ORDER BY cnt DESC LIMIT 10`) as any[]
      const topModules = moduleRows.map((r: any) => ({ module: r.module, count: r.cnt }))

      return { totalEntries, actionsPerDay, topModules, totalCostUsd }
    },
  }
}
