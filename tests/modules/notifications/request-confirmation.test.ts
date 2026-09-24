// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createNotificationRouter } from '@modules/notifications/router'
import { createNotificationTables } from '@modules/notifications/schema'

// ─── Test DB Setup ────────────────────────────────────

const testDb = createTestDb('notifications-confirmations')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  createNotificationTables(db as any)
})
afterEach(() => testDb.cleanup())

// ─── Helpers ──────────────────────────────────────────

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => createMockLogger(),
  } as any
}

function createFakeBus() {
  const events: Array<{ event: string; data: unknown }> = []
  return {
    emit: (event: string, data: unknown) => { events.push({ event, data }) },
    on: () => {},
    events,
  } as any
}

// ─── requestConfirmation tests ────────────────────────

describe('requestConfirmation', () => {
  it('ackConfirmation resolves the Promise to true and marks row acked', async () => {
    const bus = createFakeBus()
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger(), bus })

    const promise = router.requestConfirmation({
      userId: 'user1',
      title: 'Add contact?',
      timeoutMs: 5000,
    })

    const pending = router.listPendingConfirmations('user1')
    expect(pending).toHaveLength(1)
    const id = pending[0].id

    const ackResult = router.ackConfirmation(id)
    expect(ackResult).toBe(true)

    const result = await promise
    expect(result).toBe(true)

    // Row should now be 'acked'
    const afterAck = router.listPendingConfirmations('user1')
    expect(afterAck).toHaveLength(0) // no longer 'pending'
  })

  it('declineConfirmation resolves to false and marks row declined', async () => {
    const bus = createFakeBus()
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger(), bus })

    const promise = router.requestConfirmation({
      userId: 'user1',
      title: 'Delete data?',
      timeoutMs: 5000,
    })

    const [conf] = router.listPendingConfirmations('user1')
    const declineResult = router.declineConfirmation(conf.id)
    expect(declineResult).toBe(true)

    const result = await promise
    expect(result).toBe(false)

    // Row should no longer appear in pending list
    expect(router.listPendingConfirmations('user1')).toHaveLength(0)
  })

  it('timeout resolves Promise to false and marks row as timeout', async () => {
    const bus = createFakeBus()
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger(), bus })

    const result = await router.requestConfirmation({
      userId: 'user1',
      title: 'Timed out action',
      timeoutMs: 50,
    })

    expect(result).toBe(false)
    // Row should no longer be in the pending list (status is now 'timeout')
    expect(router.listPendingConfirmations('user1')).toHaveLength(0)
  }, 2000)

  it('ackConfirmation("unknown-id") returns false', () => {
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger() })
    expect(router.ackConfirmation('does-not-exist')).toBe(false)
  })

  it('ackConfirmation after a previous ack returns false (status no longer pending)', async () => {
    const bus = createFakeBus()
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger(), bus })

    const promise = router.requestConfirmation({
      userId: 'user1',
      title: 'Double ack test',
      timeoutMs: 5000,
    })

    const [conf] = router.listPendingConfirmations('user1')
    router.ackConfirmation(conf.id) // first ack
    await promise                   // drain the promise

    // Second ack should return false — status is now 'acked', not 'pending'
    expect(router.ackConfirmation(conf.id)).toBe(false)
  })

  it('bus emits notifications.confirmation_requested with expected payload', () => {
    const bus = createFakeBus()
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger(), bus })

    router.requestConfirmation({
      userId: 'user1',
      title: 'Check bus event',
      body: 'Some details',
      timeoutMs: 5000,
      agentId: 'agent-42',
    })

    // Clean up the pending timer to avoid test leaks
    const [conf] = router.listPendingConfirmations('user1')
    router.declineConfirmation(conf.id)

    const emitted = bus.events.find((e: any) => e.event === 'notifications.confirmation_requested')
    expect(emitted).toBeDefined()
    expect(emitted.data).toMatchObject({
      id: conf.id,
      userId: 'user1',
      title: 'Check bus event',
      body: 'Some details',
      agentId: 'agent-42',
    })
    expect(typeof (emitted.data as any).expiresAt).toBe('string')
  })

  it('listPendingConfirmations returns only pending rows scoped to user', async () => {
    const bus = createFakeBus()
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger(), bus })

    // Create two confirmations for user1
    const p1 = router.requestConfirmation({ userId: 'user1', title: 'A', timeoutMs: 5000 })
    const p2 = router.requestConfirmation({ userId: 'user1', title: 'B', timeoutMs: 5000 })
    // One for user2
    const p3 = router.requestConfirmation({ userId: 'user2', title: 'C', timeoutMs: 5000 })

    const user1Pending = router.listPendingConfirmations('user1')
    expect(user1Pending).toHaveLength(2)
    expect(user1Pending.every(c => c.userId === 'user1')).toBe(true)

    const user2Pending = router.listPendingConfirmations('user2')
    expect(user2Pending).toHaveLength(1)
    expect(user2Pending[0].title).toBe('C')

    // Ack all to clean up timers
    for (const c of user1Pending) router.ackConfirmation(c.id)
    await p1
    await p2
    for (const c of user2Pending) router.ackConfirmation(c.id)
    await p3
  })

  it('declineConfirmation on unknown id returns false', () => {
    const router = createNotificationRouter({ db: db as any, logger: createMockLogger() })
    expect(router.declineConfirmation('ghost-id')).toBe(false)
  })
})
