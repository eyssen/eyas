// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDb } from '../../helpers/test-db'
import { createDocumentsTables } from '../../../src/modules/documents/schema'
import { createLocalProvider } from '../../../src/modules/documents/providers/local-provider'
import { createRetentionService } from '../../../src/modules/documents/retention-service'

// ─── Mock bus ─────────────────────────────────────────

const mockBus = {
  emit: () => {},
  on: () => ({ unsubscribe: () => {} }),
  off: () => {},
}

// ─── Helpers ──────────────────────────────────────────

function insertDoc(db: any, id: string, overrides: Record<string, any> = {}) {
  const now = new Date().toISOString()
  const filename = overrides.filename ?? `${id}.txt`
  const mime_type = overrides.mime_type ?? 'text/plain'
  const size_bytes: number = overrides.size_bytes ?? 4
  const checksum_sha256 = overrides.checksum_sha256 ?? 'abc'
  const storage_key = overrides.storage_key ?? id
  const local_path = 'local_path' in overrides ? overrides.local_path : `/fake/path/${id}`
  const remote_provider = overrides.remote_provider ?? null
  const remote_status = overrides.remote_status ?? 'pending'
  const retain_local_until = overrides.retain_local_until ?? null
  const metadata = overrides.metadata ?? '{}'
  const created_by = overrides.created_by ?? null
  const created_at = overrides.created_at ?? now
  const updated_at = overrides.updated_at ?? now
  const deleted_at = overrides.deleted_at ?? null

  db.run(sql`INSERT INTO documents (
    id, owner_module, owner_id, filename, mime_type, size_bytes,
    checksum_sha256, storage_key, local_path, remote_provider,
    remote_status, retain_local_until, metadata, created_by,
    created_at, updated_at, deleted_at
  ) VALUES (
    ${id}, ${null}, ${null}, ${filename}, ${mime_type}, ${size_bytes},
    ${checksum_sha256}, ${storage_key}, ${local_path}, ${remote_provider},
    ${remote_status}, ${retain_local_until}, ${metadata}, ${created_by},
    ${created_at}, ${updated_at}, ${deleted_at}
  )`)
}

function linkDoc(db: any, docId: string, ownerModule: string, ownerId: string) {
  const linkId = `link-${docId}-${ownerModule}-${ownerId}`
  db.run(sql`INSERT INTO document_links (id, document_id, owner_module, owner_id)
             VALUES (${linkId}, ${docId}, ${ownerModule}, ${ownerId})`)
}

// ─── Tests ────────────────────────────────────────────

describe('createRetentionService', () => {
  let db: any
  let cleanup: () => void
  let baseDir: string
  let provider: ReturnType<typeof createLocalProvider>
  let service: ReturnType<typeof createRetentionService>

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'eyas-retention-'))
    const testDb = createTestDb('retention')
    db = testDb.open()
    cleanup = testDb.cleanup
    createDocumentsTables(db)

    provider = createLocalProvider(baseDir)
    service = createRetentionService(db, provider, mockBus as any)
  })

  afterEach(async () => {
    cleanup()
    await rm(baseDir, { recursive: true, force: true })
  })

  // ─── cleanupExpired ───────────────────────────────

  it('cleanupExpired: cleans up local file when remote is synced', async () => {
    const key = 'doc-synced-001'

    // Place an actual file via the local provider
    await provider.put(key, Buffer.from('data'), { filename: `${key}.txt`, mimeType: 'text/plain', sizeBytes: 4 })
    expect(await provider.exists(key)).toBe(true)

    // Insert doc with a past retain_local_until and synced remote
    insertDoc(db, key, {
      storage_key: key,
      local_path: `/fake/path/${key}`,
      remote_status: 'synced',
      retain_local_until: '2000-01-01T00:00:00.000Z', // clearly in the past
    })

    const count = await service.cleanupExpired()

    expect(count).toBe(1)
    expect(await provider.exists(key)).toBe(false)

    const rows = (db as any).all(sql`SELECT local_path FROM documents WHERE id = ${key}`)
    expect(rows[0].local_path).toBeNull()
  })

  it('cleanupExpired: skips document when remote is NOT synced', async () => {
    const key = 'doc-pending-002'

    await provider.put(key, Buffer.from('data'), { filename: `${key}.txt`, mimeType: 'text/plain', sizeBytes: 4 })
    expect(await provider.exists(key)).toBe(true)

    insertDoc(db, key, {
      storage_key: key,
      local_path: `/fake/path/${key}`,
      remote_status: 'pending',
      retain_local_until: '2000-01-01T00:00:00.000Z',
    })

    const count = await service.cleanupExpired()

    expect(count).toBe(0)
    expect(await provider.exists(key)).toBe(true)

    const rows = (db as any).all(sql`SELECT local_path FROM documents WHERE id = ${key}`)
    expect(rows[0].local_path).not.toBeNull()
  })

  // ─── applyLifecycleRule ───────────────────────────

  it('applyLifecycleRule: sets retain_local_until via document_links junction', () => {
    const localDays = 30
    const id1 = 'doc-lifecycle-001'
    const id2 = 'doc-lifecycle-002'

    insertDoc(db, id1, { local_path: '/fake/path/1' })
    insertDoc(db, id2, { local_path: '/fake/path/2' })

    // Link both docs to the same owner via document_links
    linkDoc(db, id1, 'board', 'task-42')
    linkDoc(db, id2, 'board', 'task-42')

    const before = Date.now()
    service.applyLifecycleRule('board', 'task-42', localDays)
    const after = Date.now()

    const rows = (db as any).all(
      sql`SELECT retain_local_until FROM documents WHERE id IN ('doc-lifecycle-001', 'doc-lifecycle-002')`,
    ) as Array<{ retain_local_until: string }>

    expect(rows).toHaveLength(2)

    for (const row of rows) {
      expect(row.retain_local_until).not.toBeNull()
      const ts = new Date(row.retain_local_until).getTime()
      // SQLite datetime('now') may differ from JS Date.now() due to timezone handling
      const toleranceMs = 24 * 60 * 60 * 1000 // 1 day tolerance
      const expectedMin = before + localDays * 24 * 60 * 60 * 1000 - toleranceMs
      const expectedMax = after + localDays * 24 * 60 * 60 * 1000 + toleranceMs
      expect(ts).toBeGreaterThanOrEqual(expectedMin)
      expect(ts).toBeLessThanOrEqual(expectedMax)
    }
  })

  it('applyLifecycleRule: does not update docs without local_path', () => {
    const id = 'doc-no-local-001'
    insertDoc(db, id, { local_path: null })
    linkDoc(db, id, 'board', 'task-99')

    service.applyLifecycleRule('board', 'task-99', 7)

    const rows = (db as any).all(sql`SELECT retain_local_until FROM documents WHERE id = ${id}`)
    expect(rows[0].retain_local_until).toBeNull()
  })

  it('applyLifecycleRule: does not update deleted docs', () => {
    const id = 'doc-deleted-001'
    insertDoc(db, id, {
      local_path: '/fake/path/deleted',
      deleted_at: '2020-01-01T00:00:00.000Z',
    })
    linkDoc(db, id, 'board', 'task-77')

    service.applyLifecycleRule('board', 'task-77', 7)

    const rows = (db as any).all(sql`SELECT retain_local_until FROM documents WHERE id = ${id}`)
    expect(rows[0].retain_local_until).toBeNull()
  })
})
