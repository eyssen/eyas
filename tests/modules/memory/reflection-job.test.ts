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
import {
  auxError,
  auxNone,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model'

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

    const aux = createFakeAuxiliaryModel(auxOk('{}'))

    const scheduler = fakeScheduler()
    const reflectionDigests = { record: vi.fn() }
    const ctx: any = {
      db,
      logger: { warn: () => {}, debug: () => {} },
      bus: { emit: () => {} },
      config: { memory: { reflection: { enabled: true } } },
      auxiliaryModel: aux,
      reflectionDigests,
    }
    const episodic = { list: () => [] }

    registerReflectionJob(scheduler as any, ctx, episodic)
    const result = await scheduler.run('memory.reflection')

    expect(result).toEqual({ recorded: true, date: expect.any(String) })
    expect(aux.calls).toHaveLength(1)
    const prompt = aux.calls[0].user
    expect(prompt).toContain('[error]: web_search')
    expect(prompt).toContain('[ok]: read_file')
  })

  // D-7 / P-19: the reflection job summarises recent episodic rows with a model
  // call. A row the importer flagged as holding a credential must not enter
  // that prompt at all — filtering the OUTPUT would be too late.
  it('never hands a contains-secrets episodic row to the reflection prompt', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)

    const aux = createFakeAuxiliaryModel(auxOk('{}'))
    const ctx: any = {
      db,
      logger: { warn: () => {}, debug: () => {} },
      bus: { emit: () => {} },
      config: { memory: { reflection: { enabled: true } } },
      auxiliaryModel: aux,
      reflectionDigests: { record: vi.fn() },
    }
    const episodic = {
      list: () => [
        { content: 'zxq DB_PASSWORD=alphaalphaalpha0001', tags: ['contains-secrets'] },
        { content: 'zxq plain row', tags: [] },
      ],
    }

    const scheduler = fakeScheduler()
    registerReflectionJob(scheduler as any, ctx, episodic)
    await scheduler.run('memory.reflection')

    const prompts = aux.calls.map((c) => c.user).join('\n')
    expect(prompts).toContain('zxq plain row')
    expect(prompts).not.toContain('alphaalphaalpha0001')
  })

  it('still fills the prompt when a burst of flagged rows sits at the top of the list', async () => {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)

    const aux = createFakeAuxiliaryModel(auxOk('{}'))
    const ctx: any = {
      db,
      logger: { warn: () => {}, debug: () => {} },
      bus: { emit: () => {} },
      config: { memory: { reflection: { enabled: true } } },
      auxiliaryModel: aux,
      reflectionDigests: { record: vi.fn() },
    }
    const limits: number[] = []
    const episodic = {
      list: (opts: { limit: number }) => {
        limits.push(opts.limit)
        return [
          ...Array.from({ length: 25 }, (_, i) => ({ content: `zxq secret ${i} TOKEN=alphabravo000${i}`, tags: ['contains-secrets'] })),
          ...Array.from({ length: 5 }, (_, i) => ({ content: `zxq survivor ${i}`, tags: [] })),
        ]
      },
    }

    const scheduler = fakeScheduler()
    registerReflectionJob(scheduler as any, ctx, episodic)
    await scheduler.run('memory.reflection')

    // Fetch wider than the 20 rows the prompt keeps, so a burst of freshly
    // imported flagged transcripts cannot empty the reflection input.
    expect(limits[0]).toBeGreaterThan(20)
    const prompts = aux.calls.map((c) => c.user).join('\n')
    expect(prompts).toContain('zxq survivor 0')
    expect(prompts).not.toContain('alphabravo')
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

describe('memory.reflection job — the background model service', () => {
  function setup(auxiliaryModel: unknown) {
    const db = createMemoryDb()
    ensureRunSupervisionSchema(db)
    const reflectionDigests = { record: vi.fn() }
    const logger = { warn: vi.fn(), debug: vi.fn() }
    const ctx: any = {
      db,
      logger,
      bus: { emit: () => {} },
      config: { memory: { reflection: { enabled: true } } },
      auxiliaryModel,
      reflectionDigests,
    }
    const episodic = { list: () => [{ content: 'zxq the owner reviews invoices every Monday', tags: [] }] }
    const scheduler = fakeScheduler()
    registerReflectionJob(scheduler as any, ctx, episodic)
    return { run: () => scheduler.run('memory.reflection'), reflectionDigests, logger }
  }
  const bucketItems = (record: ReturnType<typeof vi.fn>) =>
    (record.mock.calls[0][0].buckets as Array<{ items: string[] }>).flatMap((b) => b.items)

  it('fills the digest from the model: one isolated call, purpose reflection, instruction in system', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      answer: JSON.stringify({ learnings: ['Invoices are reviewed on Mondays'] }),
    })
    const { run, reflectionDigests } = setup(aux)

    await expect(run()).resolves.toEqual({ recorded: true, date: expect.any(String) })
    expect(requests).toHaveLength(1)
    expect(requests[0].isolated).toBe(true)
    expect(requests[0].system).toMatch(/ONLY the requested JSON object/)
    expect(requests[0].messages.map((m) => m.role)).toEqual(['user'])
    expect(requests[0].metadata).toMatchObject({ purpose: 'reflection', origin: 'pipeline' })
    expect(bucketItems(reflectionDigests.record)).toContain('Invoices are reviewed on Mondays')
  })

  it('on a Grok-only install still records a deterministic digest, with zero model calls', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ providers: ['grok-cli'], tiers: [] })
    const { run, reflectionDigests } = setup(aux)

    await expect(run()).resolves.toEqual({ recorded: true, date: expect.any(String) })
    expect(requests).toHaveLength(0)
    expect(reflectionDigests.record).toHaveBeenCalledTimes(1)
    expect(bucketItems(reflectionDigests.record)).toEqual([])
  })

  it('records the deterministic digest on none, a budget stop, a failed call or no service at all', async () => {
    for (const aux of [
      createFakeAuxiliaryModel(auxNone()),
      createFakeAuxiliaryModel(auxNone('budget_stop')),
      createFakeAuxiliaryModel(auxError('model down')),
      undefined,
    ]) {
      const { run, reflectionDigests } = setup(aux)
      await expect(run()).resolves.toEqual({ recorded: true, date: expect.any(String) })
      expect(reflectionDigests.record).toHaveBeenCalledTimes(1)
      expect(bucketItems(reflectionDigests.record)).toEqual([])
    }
  })
})
