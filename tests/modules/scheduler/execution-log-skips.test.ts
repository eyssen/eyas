// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { createMemoryDb } from '../../helpers/test-db'
import type { Logger } from 'pino'

export const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

describe('job_executions schema', () => {
  it('has skip_reason and actor columns', () => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    const cols = (db.all(sql`PRAGMA table_info(job_executions)`) as any[]).map(
      (r: any) => r.name ?? r[1],
    )
    expect(cols).toContain('skip_reason')
    expect(cols).toContain('actor')
  })

  // Existing installations get the columns through the additive ALTER path.
  it('adds the columns to a pre-existing table without them', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE job_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL
    )`)
    ensureSchedulerTables(db)
    const cols = (db.all(sql`PRAGMA table_info(job_executions)`) as any[]).map(
      (r: any) => r.name ?? r[1],
    )
    expect(cols).toContain('skip_reason')
    expect(cols).toContain('actor')
  })
})

import { createSchedulerService } from '@modules/scheduler/scheduler-service'

function svc(db: any, options: Parameters<typeof createSchedulerService>[2] = {}) {
  ensureSchedulerTables(db)
  return createSchedulerService(db, mockLogger, options)
}

/** next_run_at is planted far in the past, so any value that is not this
 *  sentinel proves refreshNextRun() ran on the path under test. A relative
 *  before/after comparison cannot: two refreshes milliseconds apart produce
 *  timestamps that satisfy `>=` whether the second one happened or not. */
const SENTINEL_NEXT_RUN = '2000-01-01T00:00:00.000Z'

function plantSentinel(db: any, jobId: string): void {
  db.run(sql`UPDATE scheduled_jobs SET next_run_at = ${SENTINEL_NEXT_RUN} WHERE id = ${jobId}`)
}

function execRows(db: any, jobId: string): any[] {
  return db.all(sql`SELECT * FROM job_executions WHERE job_id = ${jobId} ORDER BY id ASC`) as any[]
}

describe('missing handler is recorded', () => {
  it('writes exactly one skipped row with skip_reason=no_handler', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${j.id}`)

    await scheduler.run(j.id, 'tester')

    const rows = execRows(db, j.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('skipped')
    expect(rows[0].skip_reason).toBe('no_handler')
    expect(rows[0].actor).toBe('tester')
  })

  // A persistent condition is a state, not an event. A '* * * * *' job with a
  // disabled module would otherwise write ~129,600 rows per retention window.
  it('does not write a second row on a repeat fire', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${j.id}`)

    await scheduler.run(j.id)
    await scheduler.run(j.id)
    await scheduler.run(j.id)

    expect(execRows(db, j.id)).toHaveLength(1)
  })

  // update() can repoint a job at another handler. A user fixing a broken job by
  // typing a second wrong name must still get a row, or the log goes quiet
  // exactly when they are trying to work out what is wrong.
  it('logs again when the job is repointed at a different missing handler', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.one' WHERE id = ${j.id}`)
    await scheduler.run(j.id)
    await scheduler.run(j.id)
    expect(execRows(db, j.id)).toHaveLength(1)

    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.two' WHERE id = ${j.id}`)
    await scheduler.run(j.id)

    const rows = execRows(db, j.id)
    expect(rows).toHaveLength(2)
    expect(rows[1].error).toContain('gone.two')
  })

  it('advances next_run_at on every fire, including the deduped ones', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 60_000 }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${j.id}`)
    plantSentinel(db, j.id)

    await scheduler.run(j.id)
    expect(scheduler.get(j.id)!.nextRunAt).not.toBe(SENTINEL_NEXT_RUN)

    // Re-plant before the SECOND fire, which the dedup suppresses. Only a
    // refreshNextRun() that sits OUTSIDE the dedup block can move it off the
    // sentinel again — moving that line inside, the mistake the production
    // comment warns against, leaves it untouched.
    plantSentinel(db, j.id)
    await scheduler.run(j.id)
    const second = scheduler.get(j.id)!.nextRunAt!
    expect(second).not.toBe(SENTINEL_NEXT_RUN)
    expect(Date.parse(second)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'))

    // The dedup itself must still be intact — one row, not two.
    expect(execRows(db, j.id)).toHaveLength(1)
  })
})

// Spec §6: next_run_at answers "when is the next run declared for", so it has to
// stay true on every early exit, not just the happy path. The no_handler exit is
// covered above; these are the other two.
describe('next_run_at advances on the transient early exits', () => {
  it('advances on the concurrency-limit skip', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db, { maxConcurrent: 1 })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    scheduler.registerHandler('slow.handler', async () => { await gate; return 'ok' })

    const occupier = scheduler.create({
      name: 'Occupier', triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 60_000 }),
      handler: 'slow.handler',
    })
    const blocked = scheduler.create({
      name: 'Blocked', triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 60_000 }),
      handler: 'slow.handler',
    })
    plantSentinel(db, blocked.id)

    // Not awaited: this occupies the single concurrency slot for the duration.
    const inFlight = scheduler.run(occupier.id)
    await scheduler.run(blocked.id)

    const rows = execRows(db, blocked.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].skip_reason).toBe('concurrency')
    expect(scheduler.get(blocked.id)!.nextRunAt).not.toBe(SENTINEL_NEXT_RUN)

    release()
    await inFlight
  })

  it('advances on the lock_held skip', async () => {
    const db = createMemoryDb()
    // A lock service that never grants: stands in for another node holding the
    // per-job lock, which is unreachable from a single in-process test.
    const scheduler = svc(db, {
      lockService: {
        tryAcquire: () => false,
        renew: () => true,
        release: () => {},
        inspect: () => null,
      },
    })
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Locked', triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 60_000 }),
      handler: 'real.handler',
    })
    plantSentinel(db, j.id)

    await scheduler.run(j.id)

    const rows = execRows(db, j.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].skip_reason).toBe('lock_held')
    expect(scheduler.get(j.id)!.nextRunAt).not.toBe(SENTINEL_NEXT_RUN)
  })
})

describe('actor on normal executions', () => {
  it('records the caller on a successful run', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Fine', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })

    await scheduler.run(j.id, 'alice')
    expect(execRows(db, j.id)[0].actor).toBe('alice')
  })

  // Spec §5.1 reserves 'system' for "a timer fired it". run() is manual by
  // definition, so an unbound caller is a user we cannot name — not a timer.
  // Recording 'system' here would recreate the very ambiguity the column
  // removes: a hand-pressed Run Now indistinguishable from a scheduled fire.
  it('defaults an actorless manual run to user, not system', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Fine', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })

    await scheduler.run(j.id)
    expect(execRows(db, j.id)[0].actor).toBe('user')
  })

  it('still records system when a timer fires the job', async () => {
    vi.useFakeTimers()
    try {
      const db = createMemoryDb()
      const scheduler = svc(db)
      scheduler.registerHandler('real.handler', async () => 'ok')
      const j = scheduler.create({
        name: 'Ticker', triggerType: 'interval',
        triggerConfig: JSON.stringify({ intervalMs: 1000 }),
        handler: 'real.handler',
      })
      // start() takes leadership and arms the timer; the interval callback is
      // the only production path that reaches executeJob with no actor at all.
      scheduler.start()
      await vi.advanceTimersByTimeAsync(1100)
      scheduler.stop()

      const rows = execRows(db, j.id)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0].actor).toBe('system')
    } finally {
      vi.useRealTimers()
    }
  })
})
