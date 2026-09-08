import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createBatchEngine } from '@modules/notifications/batch'
import { createTemplateEngine } from '@modules/notifications/templates'
import { createNotificationTables } from '@modules/notifications/schema'
import type { NotificationChannel, NotificationPayload } from '@modules/notifications/router'

const testDb = createTestDb('notifications-batch')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  createNotificationTables(db as any)
})
afterEach(() => testDb.cleanup())

function logger() {
  return {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: () => logger(),
  } as any
}

function mockChannel(id: string): NotificationChannel & { calls: NotificationPayload[] } {
  const calls: NotificationPayload[] = []
  return {
    id,
    calls,
    async send(_u, payload) { calls.push(payload); return true },
  }
}

function storeNotification(id: string, userId: string, severity = 'info', title = 'Test', body = 'body') {
  ;(db as any).run(
    sql`INSERT INTO notifications (id, user_id, event, severity, title, body, data, channels_sent, created_at)
        VALUES (${id}, ${userId}, 'budget.warning', ${severity}, ${title}, ${body}, NULL, NULL, ${new Date().toISOString()})`
  )
}

describe('createBatchEngine', () => {
  it('isBatchable returns true for email and webhook by default', () => {
    const engine = createBatchEngine({ db: db as any, logger: logger() })
    expect(engine.isBatchable('email')).toBe(true)
    expect(engine.isBatchable('webhook')).toBe(true)
    expect(engine.isBatchable('telegram')).toBe(false)
    expect(engine.isBatchable('web')).toBe(false)
  })

  it('honours custom batchable channel set', () => {
    const engine = createBatchEngine({
      db: db as any,
      logger: logger(),
      config: { windowMs: 1000, batchableChannels: new Set(['telegram']) },
    })
    expect(engine.isBatchable('telegram')).toBe(true)
    expect(engine.isBatchable('email')).toBe(false)
  })

  it('creates a new batch row on first enqueue', () => {
    const engine = createBatchEngine({ db: db as any, logger: logger() })
    const payload: NotificationPayload = {
      id: 'n1', event: 'budget.warning', severity: 'warning',
      title: 'a', body: 'b', createdAt: new Date().toISOString(),
    }
    engine.enqueue('u1', 'email', 'budget.*', payload)

    const rows = (db as any).all(sql`SELECT * FROM notification_batch_queue`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].channel).toBe('email')
    expect(rows[0].user_id).toBe('u1')
    expect(JSON.parse(rows[0].notification_ids)).toEqual(['n1'])
    expect(rows[0].sent_at).toBeNull()
  })

  it('appends to existing pending batch for same user+channel+pattern', () => {
    const engine = createBatchEngine({ db: db as any, logger: logger() })
    const mkPayload = (id: string): NotificationPayload => ({
      id, event: 'budget.warning', severity: 'warning',
      title: id, createdAt: new Date().toISOString(),
    })

    engine.enqueue('u1', 'email', 'budget.*', mkPayload('n1'))
    engine.enqueue('u1', 'email', 'budget.*', mkPayload('n2'))
    engine.enqueue('u1', 'email', 'budget.*', mkPayload('n3'))

    const rows = (db as any).all(sql`SELECT * FROM notification_batch_queue`) as any[]
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].notification_ids)).toEqual(['n1', 'n2', 'n3'])
  })

  it('does not append after the batch has been sent (creates new batch)', () => {
    const engine = createBatchEngine({ db: db as any, logger: logger() })
    const payload: NotificationPayload = {
      id: 'n1', event: 'budget.warning', severity: 'warning',
      title: 't', createdAt: new Date().toISOString(),
    }
    engine.enqueue('u1', 'email', 'budget.*', payload)
    ;(db as any).run(sql`UPDATE notification_batch_queue SET sent_at = ${new Date().toISOString()}`)

    engine.enqueue('u1', 'email', 'budget.*', { ...payload, id: 'n2' })
    const rows = (db as any).all(sql`SELECT * FROM notification_batch_queue`) as any[]
    expect(rows).toHaveLength(2)
  })

  it('processDue sends a digest for due batches and marks sent_at', async () => {
    const engine = createBatchEngine({ db: db as any, logger: logger(), config: { windowMs: 0 } })
    storeNotification('n1', 'u1', 'info', 'First')
    storeNotification('n2', 'u1', 'warning', 'Second')

    engine.enqueue('u1', 'email', 'budget.*', {
      id: 'n1', event: 'budget.warning', severity: 'info',
      title: 'First', createdAt: new Date().toISOString(),
    })
    engine.enqueue('u1', 'email', 'budget.*', {
      id: 'n2', event: 'budget.warning', severity: 'warning',
      title: 'Second', createdAt: new Date().toISOString(),
    })

    const email = mockChannel('email')
    const templates = createTemplateEngine()
    const processed = await engine.processDue(new Map([['email', email]]), templates)

    expect(processed).toBe(1)
    expect(email.calls).toHaveLength(1)
    expect(email.calls[0].data?.isDigest).toBe(true)
    expect(email.calls[0].data?.count).toBe(2)

    const rows = (db as any).all(sql`SELECT * FROM notification_batch_queue`) as any[]
    expect(rows[0].sent_at).not.toBeNull()
  })

  it('uses highest severity for digest payload', async () => {
    const engine = createBatchEngine({ db: db as any, logger: logger(), config: { windowMs: 0 } })
    storeNotification('a', 'u1', 'info')
    storeNotification('b', 'u1', 'critical')

    const payload: NotificationPayload = {
      id: 'a', event: 'budget.warning', severity: 'info',
      title: 'a', createdAt: new Date().toISOString(),
    }
    engine.enqueue('u1', 'email', 'budget.*', payload)
    engine.enqueue('u1', 'email', 'budget.*', { ...payload, id: 'b' })

    const email = mockChannel('email')
    await engine.processDue(new Map([['email', email]]), createTemplateEngine())
    expect(email.calls[0].severity).toBe('critical')
  })

  it('skips batches whose channel is no longer registered (but marks them sent)', async () => {
    const engine = createBatchEngine({ db: db as any, logger: logger(), config: { windowMs: 0 } })
    storeNotification('n1', 'u1')
    engine.enqueue('u1', 'email', 'budget.*', {
      id: 'n1', event: 'budget.warning', severity: 'info',
      title: 't', createdAt: new Date().toISOString(),
    })

    const processed = await engine.processDue(new Map([['web', mockChannel('web')]]))
    expect(processed).toBe(0)

    const rows = (db as any).all(sql`SELECT * FROM notification_batch_queue`) as any[]
    expect(rows[0].sent_at).not.toBeNull()
  })

  it('does not process batches whose scheduled_at is still in the future', async () => {
    const engine = createBatchEngine({ db: db as any, logger: logger() })
    engine.enqueue('u1', 'email', 'budget.*', {
      id: 'n1', event: 'budget.warning', severity: 'info',
      title: 't', createdAt: new Date().toISOString(),
    })

    const email = mockChannel('email')
    const processed = await engine.processDue(new Map([['email', email]]), createTemplateEngine())
    expect(processed).toBe(0)
    expect(email.calls).toHaveLength(0)
  })
})
