// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// P-12 — a scan taken before R11 kept its candidates as one JSON blob on the
// scan row. Nothing reads that blob any more, so an old scan the owner left
// open would show an empty list. The migration reads it once, into the table,
// and marks the row `format = 2`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import type { ScanCandidate } from '@modules/data-port/types'

let dataDir: string
let db: any
let service: ReturnType<typeof createDataPortService>

const candidate = (over: Partial<ScanCandidate>): ScanCandidate => ({
  id: `c-${over.relativePath}`,
  relativePath: 'ai-memory/alpha.md',
  kind: 'memory',
  target: 'vault.semantic',
  title: 'Alpha',
  preview: 'Alpha note',
  bytes: 12,
  confidence: 0.8,
  reason: 'Markdown note',
  reasonCode: 'memory-note',
  selectedByDefault: true,
  ...over,
})

/** A pre-R11 row: `format = 1`, the whole candidate list in `candidates_json`. */
function seedLegacyScan(
  id: string,
  blob: string,
  createdAt = '2026-01-02T03:04:05.000Z',
): void {
  db.run(sql`INSERT INTO data_port_scans
    (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json,
     instructions, created_at, status, progress_json, format, candidate_count)
    VALUES (${id}, 'auto', 'claude-code', '/home/owner/notes', ${blob},
            ${JSON.stringify({ filesScanned: 3, scanMs: 11 })}, '["scan warning as a bare string"]',
            NULL, ${createdAt}, 'done', NULL, 1, 0)`)
}

const scanRow = (id: string): any =>
  (db.all(sql`SELECT * FROM data_port_scans WHERE id = ${id}`) as any[])[0]

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dp-legacy-'))
  db = createMemoryDb()
  createDataPortTables(db)
  service = createDataPortService({
    db,
    modelCtx: { model: undefined, logger: console } as any,
    applyDepsFactory: () => ({ createProposal: () => 'p', resolveDefaultAgentId: () => null }) as any,
    dataDir,
  })
})

afterEach(() => rmSync(dataDir, { recursive: true, force: true }))

describe('legacy scan migration', () => {
  it('moves a stored candidate list into the table and marks the row migrated', () => {
    const rows = [
      candidate({ relativePath: 'ai-memory/alpha.md', sourcePath: '/home/owner/notes/ai-memory/alpha.md' }),
      candidate({ relativePath: 'ai-memory/bravo.md', kind: 'memory' }),
      candidate({ relativePath: 'charlie.md', kind: 'knowledge', target: 'vault.semantic', selectedByDefault: false }),
    ]
    seedLegacyScan('s-old', JSON.stringify(rows))

    expect(service.migrateLegacyScans()).toEqual({ migrated: 1, failed: 0 })

    const stored = service.listCandidates('s-old', {}, { offset: 0, limit: 500, order: 'seq' })
    expect(stored.total).toBe(3)
    expect(stored.items.map((c) => c.seq)).toEqual([0, 1, 2])
    expect(stored.items.map((c) => c.relativePath)).toEqual([
      'ai-memory/alpha.md',
      'ai-memory/bravo.md',
      'charlie.md',
    ])
    // The absolute path travelled into the row, where the runner reads it —
    // and out of the API answer, where it never belonged.
    expect(stored.items.every((c) => !('sourcePath' in c))).toBe(true)
    expect(
      (db.all(sql`SELECT source_path FROM data_port_candidates WHERE scan_id = 's-old' AND id = 'c-ai-memory/alpha.md'`) as any[])[0]
        .source_path,
    ).toBe('/home/owner/notes/ai-memory/alpha.md')

    const row = scanRow('s-old')
    expect(row.format).toBe(2)
    expect(row.candidates_json).toBe('[]')
    expect(row.candidate_count).toBe(3)

    const summary = service.getScan('s-old')!
    expect(summary.status).toBe('done')
    expect(summary.stats.candidateCount).toBe(3)
    expect(summary.counts.total).toBe(3)
    // A pre-R11 warning list is `string[]`; it is shown under `legacy` rather
    // than rendered as an empty card.
    expect(summary.warnings[0]).toMatchObject({ code: 'legacy', message: 'scan warning as a bare string' })
  })

  it('rebuilds the folder tree the old blob never carried', () => {
    seedLegacyScan(
      's-tree',
      JSON.stringify([
        candidate({ relativePath: 'notes/alpha/deep/one.md' }),
        candidate({ relativePath: 'notes/bravo/two.md' }),
        candidate({ relativePath: 'top.md' }),
      ]),
    )
    service.migrateLegacyScans()
    expect(service.listDirs('s-tree', '.', {}).map((d) => d.name).sort()).toEqual(['notes'])
    expect(service.listDirs('s-tree', 'notes', {}).map((d) => d.name).sort()).toEqual(['alpha', 'bravo'])
    expect(service.listDirs('s-tree', 'notes/alpha', {})[0]).toMatchObject({
      name: 'deep',
      skippedClass: null,
    })
    expect(service.getScan('s-tree')!.stats.directoriesMapped).toBeGreaterThan(0)
  })

  it('normalises a legacy timestamp so retention can compare it (A-20)', () => {
    seedLegacyScan('s-time', JSON.stringify([candidate({})]), '2026-01-02 03:04:05')
    service.migrateLegacyScans()
    expect(scanRow('s-time').created_at).toBe(new Date('2026-01-02 03:04:05').toISOString())
  })

  it('marks a blob it cannot read as failed instead of leaving an empty scan open', () => {
    seedLegacyScan('s-broken', 'not json')
    expect(service.migrateLegacyScans()).toEqual({ migrated: 0, failed: 1 })

    const row = scanRow('s-broken')
    expect(row.status).toBe('failed')
    expect(row.format).toBe(2)
    expect(row.candidates_json).toBe('[]')
    const summary = service.getScan('s-broken')!
    expect(summary.status).toBe('failed')
    expect(summary.warnings[0]).toMatchObject({ code: 'legacy' })
    expect(summary.warnings[0]!.message).toContain('re-scan')
  })

  it('is a no-op the second time, and leaves an already-migrated scan alone', () => {
    seedLegacyScan('s-once', JSON.stringify([candidate({}), candidate({ relativePath: 'b.md' })]))
    seedLegacyScan('s-bad', 'not json')
    expect(service.migrateLegacyScans()).toEqual({ migrated: 1, failed: 1 })
    expect(service.migrateLegacyScans()).toEqual({ migrated: 0, failed: 0 })
    expect(service.countCandidates('s-once', {})).toBe(2)
  })
})
