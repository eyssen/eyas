// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createDocumentsTables } from '../../../src/modules/documents/schema'
import { sql } from 'drizzle-orm'

describe('documents schema', () => {
  let db: any
  let cleanup: () => void

  beforeEach(() => {
    const testDb = createTestDb('documents-schema')
    db = testDb.open()
    cleanup = testDb.cleanup
    createDocumentsTables(db)
  })

  afterEach(() => cleanup())

  it('creates the documents table', () => {
    const rows = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='documents'`)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('documents')
  })

  it('creates the document_retention_rules table', () => {
    const rows = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='document_retention_rules'`)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('document_retention_rules')
  })

  it('creates the document_links table', () => {
    const rows = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='document_links'`)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('document_links')
  })

  it('creates required indexes on documents', () => {
    const indexes = db.all(sql`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='documents'`)
    const names = indexes.map((r: any) => r.name)
    expect(names).toContain('idx_documents_owner')
    expect(names).toContain('idx_documents_remote_status')
    expect(names).toContain('idx_documents_retention')
  })

  it('creates required indexes on document_links', () => {
    const indexes = db.all(sql`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='document_links'`)
    const names = indexes.map((r: any) => r.name)
    expect(names).toContain('idx_document_links_owner')
    expect(names).toContain('idx_document_links_doc')
  })

  it('can insert a document record and defaults work', () => {
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key)
      VALUES ('doc-1', 'report.pdf', 'application/pdf', 12345, 'abc123hash', 'uploads/doc-1/report.pdf')`)

    const rows = db.all(sql`SELECT * FROM documents WHERE id = 'doc-1'`)
    expect(rows).toHaveLength(1)
    const doc = rows[0]
    expect(doc.filename).toBe('report.pdf')
    expect(doc.mime_type).toBe('application/pdf')
    expect(doc.size_bytes).toBe(12345)
    expect(doc.remote_status).toBe('pending')
    expect(doc.metadata).toBe('{}')
    expect(doc.created_at).toBeTruthy()
    expect(doc.updated_at).toBeTruthy()
    expect(doc.deleted_at).toBeNull()
  })

  it('enforces UNIQUE constraint on storage_key', () => {
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key)
      VALUES ('doc-2', 'file.txt', 'text/plain', 100, 'hash1', 'uploads/unique-key')`)

    expect(() => {
      db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key)
        VALUES ('doc-3', 'other.txt', 'text/plain', 200, 'hash2', 'uploads/unique-key')`)
    }).toThrow()
  })

  it('enforces UNIQUE constraint on document_links (document_id, owner_module, owner_id)', () => {
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key)
      VALUES ('doc-link-1', 'file.txt', 'text/plain', 100, 'hash1', 'key-link-1')`)

    db.run(sql`INSERT INTO document_links (id, document_id, owner_module, owner_id)
      VALUES ('link-1', 'doc-link-1', 'conversations', 'conv-1')`)

    expect(() => {
      db.run(sql`INSERT INTO document_links (id, document_id, owner_module, owner_id)
        VALUES ('link-2', 'doc-link-1', 'conversations', 'conv-1')`)
    }).toThrow()
  })

  it('allows same document linked to different owners', () => {
    db.run(sql`INSERT INTO documents (id, filename, mime_type, size_bytes, checksum_sha256, storage_key)
      VALUES ('doc-multi', 'file.txt', 'text/plain', 100, 'hash1', 'key-multi')`)

    db.run(sql`INSERT INTO document_links (id, document_id, owner_module, owner_id)
      VALUES ('link-a', 'doc-multi', 'conversations', 'conv-1')`)
    db.run(sql`INSERT INTO document_links (id, document_id, owner_module, owner_id)
      VALUES ('link-b', 'doc-multi', 'knowledge', 'page-1')`)

    const rows = db.all(sql`SELECT * FROM document_links WHERE document_id = 'doc-multi'`)
    expect(rows).toHaveLength(2)
  })

  it('can insert a retention rule', () => {
    db.run(sql`INSERT INTO document_retention_rules (id, trigger_type, local_days)
      VALUES ('rule-1', 'stage_change', 30)`)

    const rows = db.all(sql`SELECT * FROM document_retention_rules WHERE id = 'rule-1'`)
    expect(rows).toHaveLength(1)
    const rule = rows[0]
    expect(rule.trigger_type).toBe('stage_change')
    expect(rule.local_days).toBe(30)
    expect(rule.enabled).toBe(1)
    expect(rule.created_at).toBeTruthy()
  })

  it('retention rule defaults to enabled=1', () => {
    db.run(sql`INSERT INTO document_retention_rules (id, trigger_type, local_days)
      VALUES ('rule-2', 'event', 7)`)

    const rows = db.all(sql`SELECT enabled FROM document_retention_rules WHERE id = 'rule-2'`)
    expect(rows[0].enabled).toBe(1)
  })

  it('is idempotent — createDocumentsTables can be called twice without error', () => {
    expect(() => createDocumentsTables(db)).not.toThrow()
  })
})
