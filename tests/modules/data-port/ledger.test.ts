// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { recordApplied, listApplied, deleteApplied, hasLedgerRef, findLedgerRefBySha } from '@modules/data-port/ledger'

describe('data-port ledger', () => {
  it('records, lists in insertion order, and deletes per job', () => {
    const db = createMemoryDb()
    createDataPortTables(db)
    recordApplied(db, { jobId: 'j1', kind: 'vault', ref: 'semantic/a.md', sourcePath: '/src/a.md' })
    recordApplied(db, { jobId: 'j1', kind: 'skill', ref: 'sk1', sourcePath: '/src/SKILL.md' })
    recordApplied(db, { jobId: 'j2', kind: 'vault', ref: 'semantic/b.md', sourcePath: '/src/b.md' })
    expect(listApplied(db, 'j1').map((r) => [r.kind, r.ref])).toEqual([['vault', 'semantic/a.md'], ['skill', 'sk1']])
    deleteApplied(db, 'j1')
    expect(listApplied(db, 'j1')).toEqual([])
    expect(listApplied(db, 'j2')).toHaveLength(1)
  })

  it('records the adapter, every alias path and a digest for every kind', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    for (const kind of ['vault', 'episodic', 'skill', 'skill-assets', 'agent', 'proposal'] as const) {
      recordApplied(db, { jobId: 'j1', kind, ref: `${kind}-ref`, sourcePath: '/alpha/x.md', sha256: 'a'.repeat(64), adapter: 'grok-cli', paths: ['x.md', 'link/x.md', 'copy/x.md'] })
    }
    const rows = listApplied(db, 'j1')
    expect(rows).toHaveLength(6)
    for (const r of rows) {
      expect(r.sha256).toHaveLength(64)
      expect(r.adapter).toBe('grok-cli')
      expect(r.paths).toEqual(['x.md', 'link/x.md', 'copy/x.md'])
    }
    expect(hasLedgerRef(db, 'vault', 'vault-ref')).toBe(true)
    expect(hasLedgerRef(db, 'vault', 'nope')).toBe(false)
    expect(findLedgerRefBySha(db, 'episodic', 'a'.repeat(64))).toBe('episodic-ref')
  })

  it('reads a row written before the adapter and paths columns existed', () => {
    const db = createMemoryDb(); createDataPortTables(db)
    db.run(sql`INSERT INTO data_port_applied (id, job_id, kind, ref, source_path, sha256, created_at) VALUES ('r1','j1','agent','a1',NULL,NULL,'2026-01-01')`)
    expect(listApplied(db, 'j1')[0]).toMatchObject({ sha256: null, adapter: null, paths: [] })
  })
})

describe('data-port schema migration', () => {
  /**
   * An install that predates a column has to gain it in place: the ledger and
   * the job rows of every import already made are the only thing a rollback has
   * to go on, so recreating the tables is not an option.
   */
  it('adds the new columns to tables an older install already has', () => {
    const db = createMemoryDb()
    // Exactly the shape shipped before this wave.
    db.run(sql`CREATE TABLE data_port_jobs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, source_profile TEXT NOT NULL, scan_id TEXT NOT NULL,
      selection_json TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'queued', progress REAL NOT NULL DEFAULT 0,
      stats_json TEXT NOT NULL, error TEXT, instructions TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT)`)
    db.run(sql`CREATE TABLE data_port_applied (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
      source_path TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`INSERT INTO data_port_jobs (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at)
      VALUES ('old-job', 'completed', 'claude-code', 's1', '[]', 'done', 1, '{}', '2026-01-01', '2026-01-01')`)
    db.run(sql`INSERT INTO data_port_applied (id, job_id, kind, ref, source_path, created_at)
      VALUES ('old-row', 'old-job', 'vault', 'semantic/old.md', '/src/old.md', '2026-01-01')`)

    createDataPortTables(db)

    // The earlier import is still there, and still rollbackable.
    const rows = listApplied(db, 'old-job')
    expect(rows).toHaveLength(1)
    // No digest was recorded then; rollback reads that as "cannot tell", not as
    // "unchanged", and falls back to the tag check.
    expect(rows[0]!.sha256).toBeNull()
    // The new columns are usable straight away.
    recordApplied(db, { jobId: 'old-job', kind: 'vault', ref: 'semantic/new.md', sha256: 'def456' })
    expect(listApplied(db, 'old-job')[1]!.sha256).toBe('def456')
    const jobs = db.all(sql`SELECT enrich FROM data_port_jobs WHERE id = 'old-job'`) as Array<{ enrich: number }>
    // A job made before the switch existed asks for no model call.
    expect(Number(jobs[0]!.enrich)).toBe(0)
  })

  it('is safe to run twice over a database that already has the columns', () => {
    const db = createMemoryDb()
    createDataPortTables(db)
    recordApplied(db, { jobId: 'j1', kind: 'vault', ref: 'semantic/a.md', sha256: 'abc123' })
    expect(() => createDataPortTables(db)).not.toThrow()
    expect(listApplied(db, 'j1')[0]!.sha256).toBe('abc123')
  })
})
