// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fix: completed-runs.ts's listCompletedSessions() only ever queried
// status='completed', so the reflection job's "a run errored" improvement
// trigger (reflection-engine.ts marks each run '[ok]'/'[error]') never saw a
// real failure — success was structurally always true. Confirms the
// memory.reflection handler now requests failed runs too (includeFailed) and
// that they reach the model prompt tagged '[error]' with success:false.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { registerReflectionJob } from '@modules/memory/reflection-job'

function fakeScheduler() {
  const handlers = new Map<string, () => Promise<unknown>>()
  return {
    registerHandler: (name: string, fn: () => Promise<unknown>) => { handlers.set(name, fn) },
    list: () => [],
    create: () => undefined,
    run: (name: string) => handlers.get(name)!(),
  }
}

describe('memory.reflection job — surfaces failed runs to the model prompt', () => {
  it('tags a failed run [error] (success:false) alongside a completed run [ok] in the reflection prompt', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, tool_calls, turns_used)
      VALUES ('r-failed', 'c1', 'a1', 'failed', ${now}, ${JSON.stringify(['web_search'])}, 1)`)
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, tool_calls, turns_used)
      VALUES ('r-ok', 'c1', 'a1', 'completed', ${now}, ${JSON.stringify(['read_file'])}, 1)`)

    const capturedPrompts: string[] = []
    const model = {
      complete: vi.fn(async (req: any) => {
        capturedPrompts.push(req.messages.map((m: any) => m.content).join('\n'))
        return { content: [{ type: 'text', text: '{}' }] }
      }),
    }

    const scheduler = fakeScheduler()
    const reflectionDigests = { record: vi.fn() }
    const ctx: any = {
      db,
      logger: { warn: () => {}, debug: () => {} },
      bus: { emit: () => {} },
      config: { memory: { reflection: { enabled: true } } },
      model,
      reflectionDigests,
    }
    const episodic = { list: () => [] }

    registerReflectionJob(scheduler as any, ctx, episodic)
    const result = await scheduler.run('memory.reflection')

    expect(result).toEqual({ recorded: true, date: expect.any(String) })
    expect(model.complete).toHaveBeenCalledTimes(1)
    const prompt = capturedPrompts[0]
    expect(prompt).toContain('[error]: web_search')
    expect(prompt).toContain('[ok]: read_file')
  })

  it('the underlying port still defaults to completed-only for its other caller (skill-candidate miner)', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, tool_calls, turns_used)
      VALUES ('r-failed', 'c1', 'a1', 'failed', ${now}, ${JSON.stringify(['web_search'])}, 1)`)

    const { createCompletedRunsPort } = await import('@modules/agent/completed-runs')
    const port = createCompletedRunsPort(db)
    expect(port.listCompletedSessions(Date.now() - 3_600_000)).toEqual([])
    expect(port.listCompletedSessions(Date.now() - 3_600_000, true)).toHaveLength(1)
  })
})
