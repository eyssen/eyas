// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { registerFlushJob, FLUSH_JOB_NAME, FLUSH_HANDLER_KEY, FLUSH_JOB_CRON } from '@modules/memory/v2/flush-job'

function fakeScheduler(existing: Array<{ name: string }> = []) {
  const handlers = new Map<string, () => Promise<unknown>>()
  const created: any[] = []
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    list: () => existing,
    create: vi.fn((job: any) => { created.push(job); return job }),
    run: (name: string) => handlers.get(name)!(),
    created,
    handlers,
  }
}

describe('memory.v2.flush scheduler job', () => {
  it('registers the handler and seeds a one-minute cron job', async () => {
    const scheduler = fakeScheduler()
    const ingest = { sweepIdle: vi.fn(() => 2) }
    registerFlushJob(scheduler, ingest)

    expect(scheduler.handlers.has(FLUSH_HANDLER_KEY)).toBe(true)
    expect(scheduler.created).toHaveLength(1)
    expect(scheduler.created[0]).toMatchObject({
      name: FLUSH_JOB_NAME, triggerType: 'cron', handler: FLUSH_HANDLER_KEY,
      triggerConfig: JSON.stringify({ cron: FLUSH_JOB_CRON }),
    })
    await expect(scheduler.run(FLUSH_HANDLER_KEY)).resolves.toEqual({ flushed: 2 })
    expect(ingest.sweepIdle).toHaveBeenCalledTimes(1)
  })

  it('does not create a second job on restart', () => {
    const scheduler = fakeScheduler([{ name: FLUSH_JOB_NAME }])
    registerFlushJob(scheduler, { sweepIdle: () => 0 })
    expect(scheduler.create).not.toHaveBeenCalled()
  })
})
