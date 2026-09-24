import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createAuditService, type AuditService } from '@modules/audit/service'
import { createAuditTables } from '@modules/audit/schema'
import { runRetention } from '@modules/audit/retention-service'
import { sql } from 'drizzle-orm'

const testDb = createTestDb('audit')
let db: ReturnType<typeof testDb.open>
let svc: AuditService

beforeEach(() => {
  db = testDb.open()
  createAuditTables(db)
  svc = createAuditService(db)
})
afterEach(() => testDb.cleanup())

describe('AuditService', () => {
  describe('log', () => {
    it('creates an audit entry with required fields', () => {
      const entry = svc.log({
        action: 'board.task.created',
        module: 'board',
        userId: 'user-1',
      })

      expect(entry.id).toBeTruthy()
      expect(entry.action).toBe('board.task.created')
      expect(entry.module).toBe('board')
      expect(entry.userId).toBe('user-1')
      expect(entry.result).toBe('success')
      expect(entry.reversible).toBe(false)
      expect(entry.timestamp).toBeTruthy()
    })

    it('stores details as JSON', () => {
      const details = { taskId: 'task-1', title: 'Test task' }
      const entry = svc.log({
        action: 'board.task.created',
        module: 'board',
        details,
      })

      expect(entry.details).toEqual(details)
    })

    it('stores cost_usd', () => {
      const entry = svc.log({
        action: 'model.complete',
        module: 'model',
        costUsd: 0.0042,
      })

      expect(entry.costUsd).toBe(0.0042)
    })

    it('supports error result', () => {
      const entry = svc.log({
        action: 'agent.execute',
        module: 'agent',
        result: 'error',
      })

      expect(entry.result).toBe('error')
    })
  })

  describe('snapshot', () => {
    it('creates a snapshot linked to an entry', () => {
      const entry = svc.log({ action: 'config.update', module: 'config', reversible: true })

      const snap = svc.snapshot(entry.id, {
        type: 'config',
        originalData: JSON.stringify({ key: 'old-value' }),
        path: 'config/default.yaml',
      })

      expect(snap.id).toBeTruthy()
      expect(snap.auditEntryId).toBe(entry.id)
      expect(snap.type).toBe('config')
      expect(snap.originalData).toContain('old-value')
      expect(snap.restorable).toBe(true)
      expect(snap.restoredAt).toBeNull()

      // Verify entry has snapshot linked
      const updated = svc.getById(entry.id)
      expect(updated?.snapshotId).toBe(snap.id)
      expect(updated?.snapshot).toBeTruthy()
    })
  })

  describe('rollback', () => {
    it('marks entry as rolled-back and snapshot as restored', () => {
      const entry = svc.log({ action: 'config.update', module: 'config', reversible: true })
      svc.snapshot(entry.id, {
        type: 'config',
        originalData: '{"old": true}',
        path: 'config/test.yaml',
      })

      const rolledBack = svc.rollback(entry.id)

      expect(rolledBack.result).toBe('rolled-back')

      const detail = svc.getById(entry.id)
      expect(detail?.snapshot?.restoredAt).toBeTruthy()
    })

    it('throws when entry not found', () => {
      expect(() => svc.rollback('nonexistent')).toThrow('Audit entry not found')
    })

    it('throws when no snapshot exists', () => {
      const entry = svc.log({ action: 'test', module: 'test' })
      expect(() => svc.rollback(entry.id)).toThrow('No snapshot')
    })

    it('throws when already restored', () => {
      const entry = svc.log({ action: 'test', module: 'test', reversible: true })
      svc.snapshot(entry.id, {
        type: 'db_record',
        originalData: '{}',
        path: 'test/record',
      })

      svc.rollback(entry.id)
      expect(() => svc.rollback(entry.id)).toThrow('already restored')
    })

    it('throws when snapshot not restorable', () => {
      const entry = svc.log({ action: 'test', module: 'test', reversible: true })
      svc.snapshot(entry.id, {
        type: 'git_state',
        originalData: '{}',
        path: 'git/state',
        restorable: false,
      })

      expect(() => svc.rollback(entry.id)).toThrow('not restorable')
    })
  })

  describe('query', () => {
    it('returns all entries with default pagination', () => {
      svc.log({ action: 'a', module: 'mod-a' })
      svc.log({ action: 'b', module: 'mod-b' })
      svc.log({ action: 'c', module: 'mod-c' })

      const result = svc.query({})
      expect(result.entries).toHaveLength(3)
      expect(result.total).toBe(3)
    })

    it('filters by module', () => {
      svc.log({ action: 'a', module: 'board' })
      svc.log({ action: 'b', module: 'agent' })
      svc.log({ action: 'c', module: 'board' })

      const result = svc.query({ module: 'board' })
      expect(result.entries).toHaveLength(2)
      expect(result.entries.every(e => e.module === 'board')).toBe(true)
    })

    it('filters by userId', () => {
      svc.log({ action: 'a', module: 'test', userId: 'user-1' })
      svc.log({ action: 'b', module: 'test', userId: 'user-2' })

      const result = svc.query({ userId: 'user-1' })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].userId).toBe('user-1')
    })

    it('supports pagination', () => {
      for (let i = 0; i < 10; i++) {
        svc.log({ action: `action-${i}`, module: 'test' })
      }

      const page1 = svc.query({ limit: 3, offset: 0 })
      expect(page1.entries).toHaveLength(3)
      expect(page1.total).toBe(10)

      const page2 = svc.query({ limit: 3, offset: 3 })
      expect(page2.entries).toHaveLength(3)
    })

    it('filters by action pattern', () => {
      svc.log({ action: 'board.task.created', module: 'board' })
      svc.log({ action: 'board.task.updated', module: 'board' })
      svc.log({ action: 'agent.execute', module: 'agent' })

      const result = svc.query({ action: 'board.task' })
      expect(result.entries).toHaveLength(2)
    })
  })

  describe('getById', () => {
    it('returns entry with snapshot', () => {
      const entry = svc.log({ action: 'test', module: 'test' })
      svc.snapshot(entry.id, {
        type: 'db_record',
        originalData: '{"key":"val"}',
        path: 'table/row',
      })

      const detail = svc.getById(entry.id)
      expect(detail).toBeTruthy()
      expect(detail!.snapshot).toBeTruthy()
      expect(detail!.snapshot!.type).toBe('db_record')
    })

    it('returns null for nonexistent id', () => {
      expect(svc.getById('nonexistent')).toBeNull()
    })
  })

  describe('getStats', () => {
    it('returns summary statistics', () => {
      svc.log({ action: 'a', module: 'board', costUsd: 0.01 })
      svc.log({ action: 'b', module: 'board', costUsd: 0.02 })
      svc.log({ action: 'c', module: 'agent', costUsd: 0.05 })

      const stats = svc.getStats()
      expect(stats.totalEntries).toBe(3)
      expect(stats.totalCostUsd).toBeCloseTo(0.08)
      expect(stats.topModules).toHaveLength(2)
      expect(stats.topModules[0].module).toBe('board')
      expect(stats.topModules[0].count).toBe(2)
      expect(stats.actionsPerDay).toBeGreaterThan(0)
    })

    it('returns zero stats for empty db', () => {
      const stats = svc.getStats()
      expect(stats.totalEntries).toBe(0)
      expect(stats.totalCostUsd).toBe(0)
      expect(stats.topModules).toHaveLength(0)
    })
  })
})

describe('Retention', () => {
  it('deletes entries older than 365 days', () => {
    // Insert an old entry directly
    db.run(sql`INSERT INTO audit_entries (id, timestamp, action, module, result)
      VALUES ('old-1', datetime('now', '-400 days'), 'old.action', 'test', 'success')`)

    svc.log({ action: 'recent', module: 'test' })

    const result = runRetention(db)
    expect(result.deleted).toBe(1)

    // Verify only recent entry remains
    const remaining = svc.query({})
    expect(remaining.total).toBe(1)
    expect(remaining.entries[0].action).toBe('recent')
  })

  it('archives details for entries 90-365 days old', () => {
    db.run(sql`INSERT INTO audit_entries (id, timestamp, action, module, result, details)
      VALUES ('cold-1', datetime('now', '-100 days'), 'cold.action', 'test', 'success', '{"large":"data"}')`)

    const result = runRetention(db)
    expect(result.archived).toBe(1)

    const entry = svc.getById('cold-1')
    expect(entry?.details).toBe('[archived]')
  })

  it('compresses verbose details for entries 30-90 days old', () => {
    const longValue = 'x'.repeat(300)
    const details = JSON.stringify({ longField: longValue, shortField: 'ok', listField: [1, 2, 3] })

    db.run(sql`INSERT INTO audit_entries (id, timestamp, action, module, result, details)
      VALUES ('warm-1', datetime('now', '-45 days'), 'warm.action', 'test', 'success', ${details})`)

    const result = runRetention(db)
    expect(result.compressed).toBe(1)

    const entry = svc.getById('warm-1')
    const d = entry?.details as Record<string, any>
    expect(d.shortField).toBe('ok')
    expect(d.longField).toContain('...')
    expect(d.listField).toBe('[3 items]')
  })

  it('skips entries that are already archived', () => {
    db.run(sql`INSERT INTO audit_entries (id, timestamp, action, module, result, details)
      VALUES ('cold-2', datetime('now', '-100 days'), 'cold.action', 'test', 'success', '"[archived]"')`)

    const result = runRetention(db)
    expect(result.archived).toBe(0)
  })

  it('deletes associated snapshots when deleting old entries', () => {
    db.run(sql`INSERT INTO audit_entries (id, timestamp, action, module, result, snapshot_id)
      VALUES ('old-snap', datetime('now', '-400 days'), 'old', 'test', 'success', 'snap-1')`)
    db.run(sql`INSERT INTO audit_snapshots (id, audit_entry_id, type, original_data, path)
      VALUES ('snap-1', 'old-snap', 'config', '{}', 'test')`)

    const result = runRetention(db)
    expect(result.deleted).toBe(1)

    // Verify snapshot is also deleted
    const snapRows = (db as any).all(sql`SELECT * FROM audit_snapshots WHERE id = 'snap-1'`) as any[]
    expect(snapRows).toHaveLength(0)
  })
})
