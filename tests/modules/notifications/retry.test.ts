import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createRetryEngine } from '@modules/notifications/retry'
import { createNotificationTables } from '@modules/notifications/schema'
import type { NotificationChannel, NotificationPayload } from '@modules/notifications/router'

const testDb = createTestDb('notifications-retry')
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

function flakyChannel(id: string, results: (boolean | Error)[]): NotificationChannel & { attempts: number } {
  let i = 0
  const ch: any = {
    id,
    attempts: 0,
    async send(_u: string, _p: NotificationPayload) {
      ch.attempts++
      const r = results[Math.min(i++, results.length - 1)]
      if (r instanceof Error) throw r
      return r
    },
  }
  return ch
}

const mkPayload = (id = 'n1'): NotificationPayload => ({
  id, event: 'budget.warning', severity: 'warning',
  title: 't', createdAt: new Date().toISOString(),
})

describe('createRetryEngine', () => {
  it('enqueues a retry row with pending status', () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())

    const rows = (db as any).all(sql`SELECT * FROM notification_retry_queue`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].attempts).toBe(0)
    expect(rows[0].max_attempts).toBe(3)
    expect(rows[0].channel).toBe('webhook')
    expect(JSON.parse(rows[0].payload).id).toBe('n1')
  })

  it('processDue sends and marks row as sent on success', async () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())

    // Force due-now
    ;(db as any).run(sql`UPDATE notification_retry_queue SET next_attempt_at = ${new Date(0).toISOString()}`)

    const ch = flakyChannel('webhook', [true])
    const processed = await engine.processDue(new Map([['webhook', ch]]))
    expect(processed).toBe(1)
    expect(ch.attempts).toBe(1)

    const rows = (db as any).all(sql`SELECT * FROM notification_retry_queue`) as any[]
    expect(rows[0].status).toBe('sent')
    expect(rows[0].attempts).toBe(1)
  })

  it('reschedules with backoff on failure', async () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())
    ;(db as any).run(sql`UPDATE notification_retry_queue SET next_attempt_at = ${new Date(0).toISOString()}`)

    const ch = flakyChannel('webhook', [false])
    await engine.processDue(new Map([['webhook', ch]]))

    const rows = (db as any).all(sql`SELECT * FROM notification_retry_queue`) as any[]
    expect(rows[0].status).toBe('pending')
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].last_error).toBe('Channel returned false')
    const scheduled = new Date(rows[0].next_attempt_at).getTime()
    expect(scheduled).toBeGreaterThan(Date.now())
  })

  it('captures exception message as last_error on throw', async () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())
    ;(db as any).run(sql`UPDATE notification_retry_queue SET next_attempt_at = ${new Date(0).toISOString()}`)

    const ch = flakyChannel('webhook', [new Error('connection refused')])
    await engine.processDue(new Map([['webhook', ch]]))

    const rows = (db as any).all(sql`SELECT * FROM notification_retry_queue`) as any[]
    expect(rows[0].last_error).toBe('connection refused')
    expect(rows[0].status).toBe('pending')
  })

  it('moves to failed status after max_attempts exceeded', async () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())
    // Simulate 2 prior failures, so next failure → dead letter (3 = max)
    ;(db as any).run(sql`UPDATE notification_retry_queue SET attempts = 2, next_attempt_at = ${new Date(0).toISOString()}`)

    const ch = flakyChannel('webhook', [false])
    await engine.processDue(new Map([['webhook', ch]]))

    const rows = (db as any).all(sql`SELECT * FROM notification_retry_queue`) as any[]
    expect(rows[0].status).toBe('failed')
    expect(rows[0].attempts).toBe(3)
  })

  it('marks row failed when channel is unregistered', async () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())
    ;(db as any).run(sql`UPDATE notification_retry_queue SET next_attempt_at = ${new Date(0).toISOString()}`)

    await engine.processDue(new Map()) // no channels

    const rows = (db as any).all(sql`SELECT * FROM notification_retry_queue`) as any[]
    expect(rows[0].status).toBe('failed')
    expect(rows[0].last_error).toContain('Channel not registered')
  })

  it('stats counts pending and failed', () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())
    engine.enqueue('n2', 'u1', 'webhook', mkPayload('n2'))
    ;(db as any).run(sql`UPDATE notification_retry_queue SET status = 'failed' WHERE notification_id = 'n2'`)

    const stats = engine.stats()
    expect(stats.pending).toBe(1)
    expect(stats.failed).toBe(1)
  })

  it('does not pick up rows whose next_attempt_at is in the future', async () => {
    const engine = createRetryEngine({ db: db as any, logger: logger() })
    engine.enqueue('n1', 'u1', 'webhook', mkPayload())
    // Default backoff places next_attempt_at ~30s in the future

    const ch = flakyChannel('webhook', [true])
    const processed = await engine.processDue(new Map([['webhook', ch]]))
    expect(processed).toBe(0)
    expect(ch.attempts).toBe(0)
  })
})
