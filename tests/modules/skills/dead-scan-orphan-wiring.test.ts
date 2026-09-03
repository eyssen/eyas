// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fix round 1 addition: runSkillScan (Task 15's orphan detector) had zero
// call sites in src/ — orphan evidence never reached production. The
// skills.deadScan weekly handler (skills/index.ts) now rescans the CORE root
// (config/skills) first and feeds its `orphans` result into runDeadSkillScan
// as orphanIds. These tests drive the REAL handler registered by the real
// skillsModule.onStart, mocking runSkillScan/runDeadSkillScan so they can
// control the rescan outcome without touching the real config/skills/
// directory on disk (~222 real bundled skill files live there).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'

const { runSkillScanMock, runDeadSkillScanMock } = vi.hoisted(() => ({
  runSkillScanMock: vi.fn(),
  runDeadSkillScanMock: vi.fn(),
}))

vi.mock('@modules/skills/skill-inventory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modules/skills/skill-inventory.js')>()
  return { ...actual, runSkillScan: runSkillScanMock }
})

vi.mock('@modules/skills/dead-skill-detector.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modules/skills/dead-skill-detector.js')>()
  return { ...actual, runDeadSkillScan: runDeadSkillScanMock }
})

const { skillsModule } = await import('@modules/skills/index.js')

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

// Mirrors the real DDL in src/modules/skills/index.ts's onRegister — driven
// for real by skillsModule.onRegister below, this is just documentation of
// what that call needs present ahead of it (nothing; onRegister creates its
// own tables). Kept for parity with other onStart-wiring test files.
function fakeScheduler() {
  const handlers = new Map<string, () => Promise<unknown>>()
  const jobs: Array<{ handler: string }> = []
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    create: (job: { handler: string }) => { jobs.push(job) },
    list: () => jobs,
    has: (name: string) => handlers.has(name),
    run: (name: string) => handlers.get(name)!(),
  }
}

function buildCtx() {
  const db = createMemoryDb()
  const scheduler = fakeScheduler()
  const ctx: any = {
    db,
    http: new Hono(),
    logger: noopLogger,
    config: {},
    scheduler,
    bus: { on: () => {}, emit: () => {} },
  }
  return { ctx, db, scheduler }
}

beforeEach(() => {
  runSkillScanMock.mockReset()
  runDeadSkillScanMock.mockReset()
  runDeadSkillScanMock.mockResolvedValue({ proposed: 0, skipped: 0 })
})

describe('skills.deadScan — core-root orphan wiring (fix round 1)', () => {
  it('feeds a non-empty orphanIds through when the core rescan finds a vanished source file', async () => {
    runSkillScanMock.mockResolvedValue({
      inserted: 0, updated: 5, shadowed: 0, complete: true,
      orphans: ['vanished-skill'], orphanDetectionSkipped: false,
    })
    const { ctx, scheduler } = buildCtx()
    await skillsModule.onRegister(ctx)
    await skillsModule.onStart(ctx)

    await scheduler.run('skills.deadScan')

    expect(runSkillScanMock).toHaveBeenCalledWith(ctx.db, expect.anything(), 'config/skills', 'config/skills')
    expect(runDeadSkillScanMock).toHaveBeenCalledTimes(1)
    expect(runDeadSkillScanMock.mock.calls[0][0]).toMatchObject({ orphanIds: ['vanished-skill'] })
  })

  it('feeds an empty orphanIds through when the rescan is incomplete', async () => {
    runSkillScanMock.mockResolvedValue({
      inserted: 0, updated: 0, shadowed: 0, complete: false,
      orphans: [], orphanDetectionSkipped: true, error: 'boom',
    })
    const { ctx, scheduler } = buildCtx()
    await skillsModule.onRegister(ctx)
    await skillsModule.onStart(ctx)

    await scheduler.run('skills.deadScan')

    expect(runDeadSkillScanMock.mock.calls[0][0]).toMatchObject({ orphanIds: [] })
  })

  it('still runs the detector (with an empty orphanIds) when the rescan itself throws', async () => {
    runSkillScanMock.mockRejectedValue(new Error('ENOENT or similar'))
    const { ctx, scheduler } = buildCtx()
    await skillsModule.onRegister(ctx)
    await skillsModule.onStart(ctx)

    await scheduler.run('skills.deadScan') // must not throw — if it does, this test fails right here

    expect(runDeadSkillScanMock).toHaveBeenCalledTimes(1)
    expect(runDeadSkillScanMock.mock.calls[0][0]).toMatchObject({ orphanIds: [] })
  })
})
