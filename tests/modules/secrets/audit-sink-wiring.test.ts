// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import pino from 'pino'
import { createTestDb } from '../../helpers/test-db'
import { createSecretsAuditSink } from '@modules/secrets/audit-sink'
import { createSecretsRegistry } from '@modules/secrets/registry'
import { generateMasterKey } from '@modules/secrets/crypto'
import { ScopeDeniedError, type Requester } from '@modules/secrets/types'
import { createAuditTables } from '@modules/audit/schema'
import { createAuditService } from '@modules/audit/service'

const testDb = createTestDb('secrets-audit-sink')
let db: ReturnType<typeof testDb.open>
beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('createSecretsAuditSink', () => {
  it('writes denied accesses to audit_entries with result=denied, module=secrets', async () => {
    createAuditTables(db)
    const audit = createAuditService(db)
    const ctx = { audit, logger: pino({ level: 'silent' }) } as any
    const key = await generateMasterKey()
    const registry = createSecretsRegistry(db, key, createSecretsAuditSink(ctx))
    await registry.set('key-b', 'user:bob', 'bob-val')
    const alice: Requester = { userId: 'alice', role: 'user' }
    await expect(registry.get('key-b', 'user:bob', alice)).rejects.toBeInstanceOf(ScopeDeniedError)
    const { entries, total } = audit.query({ module: 'secrets' })
    expect(total).toBe(1)
    expect(entries[0].action).toBe('secrets.get')
    expect(entries[0].result).toBe('denied')
    expect(entries[0].userId).toBe('alice')
    expect(entries[0].target).toBe('key-b')
    expect(JSON.stringify(entries[0].details)).not.toContain('bob-val')
  })

  it('falls back to the logger when the audit module is unavailable (never silent, never throws)', () => {
    const warn = vi.fn()
    const ctx = { logger: { warn, info: vi.fn() } } as any
    const sink = createSecretsAuditSink(ctx)
    expect(() => sink.logDenied({ userId: 'alice', action: 'secrets.get', target: 'k', details: { scope: 'user:bob' } })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('resolves the audit service lazily (service attached AFTER sink creation still receives entries)', () => {
    createAuditTables(db)
    const ctx = { logger: pino({ level: 'silent' }) } as any
    const sink = createSecretsAuditSink(ctx)
    ctx.audit = createAuditService(db)
    sink.logPrivileged({ userId: 'owner-1', action: 'secrets.get', target: 'sys-key', details: { scope: 'system' } })
    expect(ctx.audit.query({ module: 'secrets' }).total).toBe(1)
  })
})
