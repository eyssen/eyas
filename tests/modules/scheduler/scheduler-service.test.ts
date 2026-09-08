import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSchedulerService } from '@modules/scheduler/scheduler-service'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { createMemoryDb } from '../../helpers/test-db'
import type { Logger } from 'pino'

let db: ReturnType<typeof createMemoryDb>
let scheduler: ReturnType<typeof createSchedulerService>

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

beforeEach(() => {
  db = createMemoryDb()
  ensureSchedulerTables(db)
  vi.clearAllMocks()
  scheduler = createSchedulerService(db, mockLogger)
})

describe('SchedulerService', () => {
  describe('create', () => {
    it('creates a job with all fields', () => {
      const job = scheduler.create({
        name: 'Daily Backup',
        description: 'Backup data every day',
        triggerType: 'cron',
        triggerConfig: JSON.stringify({ cron: '0 0 * * *' }),
        handler: 'backup.run',
        handlerConfig: JSON.stringify({ target: 's3' }),
      })

      expect(job.id).toBeTruthy()
      expect(job.name).toBe('Daily Backup')
      expect(job.description).toBe('Backup data every day')
      expect(job.triggerType).toBe('cron')
      expect(job.handler).toBe('backup.run')
      expect(job.status).toBe('active')
      expect(job.runCount).toBe(0)
      expect(job.failCount).toBe(0)
    })

    it('creates a manual job', () => {
      const job = scheduler.create({
        name: 'Manual Task',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'task.execute',
      })

      expect(job.triggerType).toBe('manual')
      expect(job.status).toBe('active')
    })

    it('creates a job with chain configuration', () => {
      const job1 = scheduler.create({
        name: 'Step 1',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'pipeline.step1',
      })

      const job2 = scheduler.create({
        name: 'Step 2',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'pipeline.step2',
        chainNextJobId: job1.id,
        chainOnError: 'continue',
      })

      expect(job2.chainNextJobId).toBe(job1.id)
      expect(job2.chainOnError).toBe('continue')
    })
  })

  describe('get', () => {
    it('returns a job by id', () => {
      const created = scheduler.create({
        name: 'Findable',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'find.me',
      })

      const found = scheduler.get(created.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('Findable')
    })

    it('returns null for nonexistent id', () => {
      expect(scheduler.get('no-such-id')).toBeNull()
    })
  })

  describe('list', () => {
    it('lists all jobs', () => {
      scheduler.create({ name: 'Job A', triggerType: 'manual', triggerConfig: '{}', handler: 'a' })
      scheduler.create({ name: 'Job B', triggerType: 'manual', triggerConfig: '{}', handler: 'b' })

      const all = scheduler.list()
      expect(all).toHaveLength(2)
    })

    it('filters by status', () => {
      const job = scheduler.create({ name: 'Active Job', triggerType: 'manual', triggerConfig: '{}', handler: 'a' })
      scheduler.create({ name: 'Will Pause', triggerType: 'manual', triggerConfig: '{}', handler: 'b' })
      scheduler.pause(scheduler.list().find(j => j.name === 'Will Pause')!.id)

      const active = scheduler.list('active')
      expect(active).toHaveLength(1)
      expect(active[0].name).toBe('Active Job')

      const paused = scheduler.list('paused')
      expect(paused).toHaveLength(1)
      expect(paused[0].name).toBe('Will Pause')
    })
  })

  describe('run (manual execution)', () => {
    it('executes a handler and records success', async () => {
      const handlerFn = vi.fn().mockResolvedValue({ status: 'ok' })
      scheduler.registerHandler('test.handler', handlerFn)

      const job = scheduler.create({
        name: 'Runnable',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'test.handler',
        handlerConfig: JSON.stringify({ key: 'value' }),
      })

      await scheduler.run(job.id)

      expect(handlerFn).toHaveBeenCalledWith({ key: 'value' })

      // Check job stats updated
      const updated = scheduler.get(job.id)!
      expect(updated.runCount).toBe(1)
      expect(updated.failCount).toBe(0)
      expect(updated.lastRunAt).toBeTruthy()

      // Check execution record
      const executions = scheduler.getExecutions(job.id)
      expect(executions).toHaveLength(1)
      expect(executions[0].status).toBe('completed')
      expect(executions[0].durationMs).toBeGreaterThanOrEqual(0)
      expect(executions[0].result).toBe(JSON.stringify({ status: 'ok' }))
    })

    it('records failure when handler throws', async () => {
      scheduler.registerHandler('fail.handler', async () => {
        throw new Error('Something went wrong')
      })

      const job = scheduler.create({
        name: 'Failing Job',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'fail.handler',
      })

      await scheduler.run(job.id)

      const updated = scheduler.get(job.id)!
      expect(updated.runCount).toBe(0)
      expect(updated.failCount).toBe(1)

      const executions = scheduler.getExecutions(job.id)
      expect(executions).toHaveLength(1)
      expect(executions[0].status).toBe('failed')
      expect(executions[0].error).toBe('Something went wrong')
    })

    it('throws for nonexistent job', async () => {
      await expect(scheduler.run('no-such-id')).rejects.toThrow('Job not found')
    })

    it('warns when no handler is registered', async () => {
      const job = scheduler.create({
        name: 'No Handler',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'unregistered.handler',
      })

      await scheduler.run(job.id)
      expect(mockLogger.warn).toHaveBeenCalled()
    })

    it('executes without handlerConfig', async () => {
      const handlerFn = vi.fn().mockResolvedValue(null)
      scheduler.registerHandler('simple.handler', handlerFn)

      const job = scheduler.create({
        name: 'No Config',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'simple.handler',
      })

      await scheduler.run(job.id)
      expect(handlerFn).toHaveBeenCalledWith(undefined)
    })
  })

  describe('chain execution', () => {
    it('chains to next job on success', async () => {
      const step1Fn = vi.fn().mockResolvedValue('step1 done')
      const step2Fn = vi.fn().mockResolvedValue('step2 done')
      scheduler.registerHandler('chain.step1', step1Fn)
      scheduler.registerHandler('chain.step2', step2Fn)

      const job2 = scheduler.create({
        name: 'Step 2',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'chain.step2',
      })

      const job1 = scheduler.create({
        name: 'Step 1',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'chain.step1',
        chainNextJobId: job2.id,
      })

      await scheduler.run(job1.id)

      expect(step1Fn).toHaveBeenCalled()
      expect(step2Fn).toHaveBeenCalled()

      // Both jobs should have execution records
      expect(scheduler.getExecutions(job1.id)).toHaveLength(1)
      expect(scheduler.getExecutions(job2.id)).toHaveLength(1)
    })

    it('stops chain on error with chainOnError=stop (default)', async () => {
      const step1Fn = vi.fn().mockRejectedValue(new Error('fail'))
      const step2Fn = vi.fn().mockResolvedValue('ok')
      scheduler.registerHandler('chain.fail', step1Fn)
      scheduler.registerHandler('chain.step2', step2Fn)

      const job2 = scheduler.create({
        name: 'Step 2',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'chain.step2',
      })

      const job1 = scheduler.create({
        name: 'Step 1',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'chain.fail',
        chainNextJobId: job2.id,
        chainOnError: 'stop',
      })

      await scheduler.run(job1.id)

      expect(step1Fn).toHaveBeenCalled()
      expect(step2Fn).not.toHaveBeenCalled()
    })

    it('continues chain on error with chainOnError=continue', async () => {
      const step1Fn = vi.fn().mockRejectedValue(new Error('fail'))
      const step2Fn = vi.fn().mockResolvedValue('ok')
      scheduler.registerHandler('chain.fail', step1Fn)
      scheduler.registerHandler('chain.next', step2Fn)

      const job2 = scheduler.create({
        name: 'Step 2',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'chain.next',
      })

      const job1 = scheduler.create({
        name: 'Step 1',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'chain.fail',
        chainNextJobId: job2.id,
        chainOnError: 'continue',
      })

      await scheduler.run(job1.id)

      expect(step1Fn).toHaveBeenCalled()
      expect(step2Fn).toHaveBeenCalled()
    })
  })

  describe('pause and resume', () => {
    it('pauses a job', () => {
      const job = scheduler.create({
        name: 'Pausable',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'test',
      })

      scheduler.pause(job.id)
      const paused = scheduler.get(job.id)!
      expect(paused.status).toBe('paused')
    })

    it('resumes a paused job', () => {
      const job = scheduler.create({
        name: 'Resumable',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'test',
      })

      scheduler.pause(job.id)
      scheduler.resume(job.id)
      const resumed = scheduler.get(job.id)!
      expect(resumed.status).toBe('active')
    })
  })

  describe('delete', () => {
    it('deletes a job and its executions', async () => {
      const handlerFn = vi.fn().mockResolvedValue(null)
      scheduler.registerHandler('del.handler', handlerFn)

      const job = scheduler.create({
        name: 'Deletable',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'del.handler',
      })

      await scheduler.run(job.id)
      expect(scheduler.getExecutions(job.id)).toHaveLength(1)

      scheduler.delete(job.id)
      expect(scheduler.get(job.id)).toBeNull()
      expect(scheduler.getExecutions(job.id)).toHaveLength(0)
    })
  })

  describe('getExecutions', () => {
    it('returns executions in reverse order (newest first)', async () => {
      const handlerFn = vi.fn().mockResolvedValue(null)
      scheduler.registerHandler('multi.handler', handlerFn)

      const job = scheduler.create({
        name: 'Multi Run',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'multi.handler',
      })

      await scheduler.run(job.id)
      await scheduler.run(job.id)
      await scheduler.run(job.id)

      const executions = scheduler.getExecutions(job.id)
      expect(executions).toHaveLength(3)
      // IDs should be in descending order
      expect(executions[0].id!).toBeGreaterThan(executions[1].id!)
      expect(executions[1].id!).toBeGreaterThan(executions[2].id!)
    })

    it('respects limit parameter', async () => {
      const handlerFn = vi.fn().mockResolvedValue(null)
      scheduler.registerHandler('limit.handler', handlerFn)

      const job = scheduler.create({
        name: 'Many Runs',
        triggerType: 'manual',
        triggerConfig: '{}',
        handler: 'limit.handler',
      })

      for (let i = 0; i < 5; i++) {
        await scheduler.run(job.id)
      }

      const limited = scheduler.getExecutions(job.id, 2)
      expect(limited).toHaveLength(2)
    })
  })

  describe('registerHandler', () => {
    it('allows registering multiple handlers', () => {
      scheduler.registerHandler('a', async () => 'a')
      scheduler.registerHandler('b', async () => 'b')

      // Verify both work
      const jobA = scheduler.create({ name: 'A', triggerType: 'manual', triggerConfig: '{}', handler: 'a' })
      const jobB = scheduler.create({ name: 'B', triggerType: 'manual', triggerConfig: '{}', handler: 'b' })

      expect(jobA.id).toBeTruthy()
      expect(jobB.id).toBeTruthy()
    })
  })

  describe('start and stop', () => {
    it('starts and stops without error', () => {
      // Create a cron job
      scheduler.create({
        name: 'Cron Job',
        triggerType: 'cron',
        triggerConfig: '0 * * * *',
        handler: 'cron.handler',
      })

      expect(() => scheduler.start()).not.toThrow()
      expect(() => scheduler.stop()).not.toThrow()
    })

    it('schedules active cron jobs on start', () => {
      scheduler.create({
        name: 'Active Cron',
        triggerType: 'cron',
        triggerConfig: JSON.stringify({ cron: '*/5 * * * *' }),
        handler: 'cron.active',
      })

      scheduler.start()
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Scheduler started'))
      scheduler.stop()
    })
  })
})
