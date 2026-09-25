// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  createSchedulerLockService,
  DEFAULT_LOCK_TTL_MS,
} from '@modules/scheduler/scheduler-lock'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { createMemoryDb } from '../../helpers/test-db'
import type { Logger } from 'pino'

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

describe('SchedulerLockService — distributed advisory locks', () => {
  let db: ReturnType<typeof createMemoryDb>

  beforeEach(() => {
    db = createMemoryDb()
    ensureSchedulerTables(db)
    vi.clearAllMocks()
  })

  describe('tryAcquire', () => {
    it('allows only one of two simulated processes to win the same lock', () => {
      const lockA = createSchedulerLockService(db, mockLogger)
      const lockB = createSchedulerLockService(db, mockLogger)

      const wonA = lockA.tryAcquire('job:abc', 'holder-A')
      const wonB = lockB.tryAcquire('job:abc', 'holder-B')

      expect(wonA).toBe(true)
      expect(wonB).toBe(false)

      const state = lockA.inspect('job:abc')
      expect(state).not.toBeNull()
      expect(state!.holderId).toBe('holder-A')
    })

    it('allows different lock keys to be held independently', () => {
      const lock = createSchedulerLockService(db, mockLogger)
      expect(lock.tryAcquire('job:one', 'holder-A')).toBe(true)
      expect(lock.tryAcquire('job:two', 'holder-B')).toBe(true)
      expect(lock.tryAcquire('job:one', 'holder-B')).toBe(false)
      expect(lock.tryAcquire('job:two', 'holder-A')).toBe(false)
    })

    it('expired locks can be taken over by another holder', () => {
      // Short TTL so we can simulate expiry without real sleeps.
      const lockA = createSchedulerLockService(db, mockLogger, { ttlMs: 50 })
      const lockB = createSchedulerLockService(db, mockLogger, { ttlMs: 50 })

      const wonA = lockA.tryAcquire('job:short', 'holder-A')
      expect(wonA).toBe(true)

      // Force expiry: rewrite heartbeat to be well in the past.
      const staleTime = Date.now() - 10_000
      db.run(
        sql`UPDATE scheduler_locks SET heartbeat_at = ${staleTime} WHERE lock_key = ${'job:short'}`
      )

      const wonB = lockB.tryAcquire('job:short', 'holder-B')
      expect(wonB).toBe(true)

      const state = lockB.inspect('job:short')
      expect(state!.holderId).toBe('holder-B')
    })

    it('default TTL is 5 minutes', () => {
      expect(DEFAULT_LOCK_TTL_MS).toBe(5 * 60 * 1000)
    })
  })

  describe('renew (heartbeat)', () => {
    it('refreshes heartbeat while owned', async () => {
      const lock = createSchedulerLockService(db, mockLogger)
      lock.tryAcquire('job:renew', 'holder-A')
      const before = lock.inspect('job:renew')!

      // Small sleep so that Date.now() advances past ms boundaries.
      await new Promise(resolve => setTimeout(resolve, 5))

      const renewed = lock.renew('job:renew', 'holder-A')
      expect(renewed).toBe(true)

      const after = lock.inspect('job:renew')!
      expect(after.heartbeatAt).toBeGreaterThanOrEqual(before.heartbeatAt)
      expect(after.expiresAt).toBeGreaterThanOrEqual(before.expiresAt)
    })

    it('renew fails for a holder that does not own the lock', () => {
      const lock = createSchedulerLockService(db, mockLogger)
      lock.tryAcquire('job:renew2', 'holder-A')

      const renewed = lock.renew('job:renew2', 'holder-B')
      expect(renewed).toBe(false)
    })

    it('heartbeat prevents takeover while job is running', () => {
      // Short TTL — but continuous heartbeats keep the lock fresh.
      const lockA = createSchedulerLockService(db, mockLogger, { ttlMs: 100 })
      const lockB = createSchedulerLockService(db, mockLogger, { ttlMs: 100 })

      expect(lockA.tryAcquire('job:long', 'holder-A')).toBe(true)

      // Simulate a heartbeat that moves heartbeatAt forward — this is what the
      // scheduler's per-job setInterval does while a long job runs.
      lockA.renew('job:long', 'holder-A')

      // Holder B tries to acquire before the heartbeat expires — should fail.
      expect(lockB.tryAcquire('job:long', 'holder-B')).toBe(false)

      const state = lockA.inspect('job:long')
      expect(state!.holderId).toBe('holder-A')
    })
  })

  describe('release', () => {
    it('clears the lock when released by the owner', () => {
      const lock = createSchedulerLockService(db, mockLogger)
      lock.tryAcquire('job:release', 'holder-A')
      expect(lock.inspect('job:release')).not.toBeNull()

      lock.release('job:release', 'holder-A')
      expect(lock.inspect('job:release')).toBeNull()
    })

    it('release is a no-op for a non-owner', () => {
      const lock = createSchedulerLockService(db, mockLogger)
      lock.tryAcquire('job:release2', 'holder-A')

      lock.release('job:release2', 'holder-B')
      expect(lock.inspect('job:release2')).not.toBeNull()

      // Original owner can still release.
      lock.release('job:release2', 'holder-A')
      expect(lock.inspect('job:release2')).toBeNull()
    })

    it('release on a missing key silently succeeds', () => {
      const lock = createSchedulerLockService(db, mockLogger)
      expect(() => lock.release('job:ghost', 'holder-A')).not.toThrow()
    })

    it('released lock can be immediately acquired by a new holder', () => {
      const lockA = createSchedulerLockService(db, mockLogger)
      const lockB = createSchedulerLockService(db, mockLogger)

      expect(lockA.tryAcquire('job:cycle', 'holder-A')).toBe(true)
      lockA.release('job:cycle', 'holder-A')
      expect(lockB.tryAcquire('job:cycle', 'holder-B')).toBe(true)
    })
  })

  describe('SchedulerService integration', () => {
    beforeEach(() => {
      db = createMemoryDb()
      ensureSchedulerTables(db)
    })

    it('only one of two scheduler instances executes a concurrently-triggered job', async () => {
      // Both instances share the same DB (simulating two replicas).
      const schedulerA = createSchedulerService(db, mockLogger, { holderId: 'replica-A' })
      const schedulerB = createSchedulerService(db, mockLogger, { holderId: 'replica-B' })

      let runCount = 0
      let resolveGate!: () => void
      const gate = new Promise<void>(resolve => {
        resolveGate = resolve
      })
      const slowHandler = async () => {
        runCount++
        // First concurrent invocation waits so that the second call races against
        // a real held lock rather than one that was immediately released.
        await gate
        return { ran: runCount }
      }

      schedulerA.registerHandler('shared.handler', slowHandler)
      schedulerB.registerHandler('shared.handler', slowHandler)

      const job = schedulerA.create({
        name: 'Shared Job',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'shared.handler',
      })

      // Kick both off "simultaneously". B should skip because A holds the lock.
      const pA = schedulerA.run(job.id)
      const pB = schedulerB.run(job.id)

      // Release the gate so A finishes.
      resolveGate()
      await Promise.all([pA, pB])

      expect(runCount).toBe(1)

      // B's attempt should have recorded a 'skipped' execution.
      const executions = schedulerA.getExecutions(job.id)
      const statuses = executions.map(e => e.status)
      expect(statuses).toContain('completed')
      expect(statuses).toContain('skipped')
    })

    it('releases the job lock after a successful run', async () => {
      const scheduler = createSchedulerService(db, mockLogger, { holderId: 'replica-solo' })
      scheduler.registerHandler('ok.handler', async () => 'ok')

      const job = scheduler.create({
        name: 'Solo',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'ok.handler',
      })

      await scheduler.run(job.id)

      // Lock should be gone.
      const rows = db.all(
        sql`SELECT * FROM scheduler_locks WHERE lock_key = ${'job:' + job.id}`
      ) as any[]
      expect(rows).toHaveLength(0)
    })

    it('releases the job lock after a failed run', async () => {
      const scheduler = createSchedulerService(db, mockLogger, { holderId: 'replica-solo' })
      scheduler.registerHandler('boom.handler', async () => {
        throw new Error('boom')
      })

      const job = scheduler.create({
        name: 'Boom',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'boom.handler',
      })

      await scheduler.run(job.id)

      const rows = db.all(
        sql`SELECT * FROM scheduler_locks WHERE lock_key = ${'job:' + job.id}`
      ) as any[]
      expect(rows).toHaveLength(0)
    })

    it('elects a single leader across two instances on start', () => {
      const schedulerA = createSchedulerService(db, mockLogger, { holderId: 'replica-A' })
      const schedulerB = createSchedulerService(db, mockLogger, { holderId: 'replica-B' })

      schedulerA.start()
      schedulerB.start()

      // Exactly one should be leader.
      const leaders = [schedulerA.isLeader, schedulerB.isLeader].filter(Boolean)
      expect(leaders).toHaveLength(1)

      schedulerA.stop()
      schedulerB.stop()
    })

    it('releases the leader lock on stop', () => {
      const scheduler = createSchedulerService(db, mockLogger, { holderId: 'replica-solo' })
      scheduler.start()
      expect(scheduler.isLeader).toBe(true)

      scheduler.stop()
      expect(scheduler.isLeader).toBe(false)

      const rows = db.all(
        sql`SELECT * FROM scheduler_locks WHERE lock_key = 'scheduler:leader'`
      ) as any[]
      expect(rows).toHaveLength(0)
    })
  })
})
