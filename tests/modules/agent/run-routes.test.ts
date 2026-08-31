// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureRunSupervisionSchema, createRunSupervisor } from '@modules/agent/run-supervisor'
import { createRunSupervisionRoutes } from '@modules/agent/run-routes'

type Outcome = Promise<{ ran: boolean; sessionId?: string; reason?: string }>
function setup(opts: {
  ability?: { can: () => boolean }
  resumeRun?: (id: string, o?: { seedFromCheckpoint?: boolean }) => Outcome
  cancelParked?: (runId: string, actor: string) => Promise<boolean>
} = {}) {
  const db = createMemoryDb()
  ensureRunSupervisionSchema(db)
  const supervisor = createRunSupervisor({ db })
  const app = new Hono()
  if (opts.ability) {
    app.use('*', async (c, next) => { (c as any).set('ability', opts.ability); (c as any).set('userId', 'op'); await next() })
  }
  createRunSupervisionRoutes(app as any, supervisor, db as any, { resumeRun: opts.resumeRun, cancelParked: opts.cancelParked })
  return { app, db, supervisor }
}

const allow = { can: () => true }

describe('agent run-supervision routes', () => {
  it('GET /api/v1/agent/runs requires auth (401 without ability)', async () => {
    const res = await setup().app.request('/api/v1/agent/runs')
    expect(res.status).toBe(401)
  })

  it('lists active + recent runs', async () => {
    const { app, supervisor } = setup({ ability: allow })
    supervisor.beginRun({ sessionId: 's1', conversationId: 'c1', agentId: 'a1', kind: 'background' })
    const res = await app.request('/api/v1/agent/runs')
    expect(res.status).toBe(200)
    const body = await res.json() as { runs: Array<{ id: string; status: string }> }
    expect(body.runs.some((r) => r.id === 's1' && r.status === 'running')).toBe(true)
  })

  it('cancels an active run (aborts its signal)', async () => {
    const { app, supervisor } = setup({ ability: allow })
    const h = supervisor.beginRun({ sessionId: 's2', conversationId: 'c1', agentId: 'a1' })
    const res = await app.request('/api/v1/agent/runs/s2/cancel', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(h.signal.aborted).toBe(true)
  })

  it('cancel on an unknown/inactive run returns 404', async () => {
    const { app } = setup({ ability: allow })
    const res = await app.request('/api/v1/agent/runs/nope/cancel', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  // F2 T6 (R5) — a PARKED run was dropped from the watch map, so supervisor
  // .cancel() cannot see it. Without this branch an operator who wants neither
  // the action nor the run has no way to stop it at all.
  it('cancels a PARKED run through the parked path, carrying the actor', async () => {
    const cancelParked = vi.fn(async () => true)
    const { app, supervisor } = setup({ ability: allow, cancelParked })
    supervisor.beginRun({ sessionId: 'p1', conversationId: 'c1', agentId: 'a1' })
    supervisor.park('p1', 7)

    const res = await app.request('/api/v1/agent/runs/p1/cancel', { method: 'POST' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, parked: true })
    expect(cancelParked).toHaveBeenCalledWith('p1', 'op')
  })

  it('a parked cancel that loses its guard still reports the run as not active', async () => {
    const { app, supervisor } = setup({ ability: allow, cancelParked: async () => false })
    supervisor.beginRun({ sessionId: 'p2', conversationId: 'c1', agentId: 'a1' })
    supervisor.park('p2', 7)

    const res = await app.request('/api/v1/agent/runs/p2/cancel', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('a terminal run is never routed to the parked path', async () => {
    const cancelParked = vi.fn(async () => true)
    const { app, supervisor } = setup({ ability: allow, cancelParked })
    supervisor.beginRun({ sessionId: 'p3', conversationId: 'c1', agentId: 'a1' }).complete()

    const res = await app.request('/api/v1/agent/runs/p3/cancel', { method: 'POST' })

    expect(res.status).toBe(404)
    expect(cancelParked).not.toHaveBeenCalled()
  })

  it('retry requires auth (401 without ability)', async () => {
    const res = await setup({ resumeRun: async () => ({ ran: true }) }).app.request('/api/v1/agent/runs/x/retry', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('retry on an unknown run returns 404', async () => {
    const { app } = setup({ ability: allow, resumeRun: async () => ({ ran: true, sessionId: 'new' }) })
    const res = await app.request('/api/v1/agent/runs/nope/retry', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('retry on an active (running) run returns 409', async () => {
    const { app, supervisor } = setup({ ability: allow, resumeRun: async () => ({ ran: true, sessionId: 'new' }) })
    supervisor.beginRun({ sessionId: 'r1', conversationId: 'c1', agentId: 'a1' })
    const res = await app.request('/api/v1/agent/runs/r1/retry', { method: 'POST' })
    expect(res.status).toBe(409)
  })

  // D6 (F2 T2): a parked (waiting_approval) run is not terminal — it is
  // paused pending an operator decision (Task 3/5/6), so retry/refresh must
  // treat it as active (409), same as 'running'.
  it('retry on a parked (waiting_approval) run returns 409', async () => {
    const { app, supervisor } = setup({ ability: allow, resumeRun: async () => ({ ran: true, sessionId: 'new' }) })
    supervisor.beginRun({ sessionId: 'r-park', conversationId: 'c1', agentId: 'a1' })
    supervisor.park('r-park', 'appr-1')
    const res = await app.request('/api/v1/agent/runs/r-park/retry', { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('retry on a terminal run re-runs (goal reseed, ledger armed) and returns the new run id', async () => {
    const rc = vi.fn(async () => ({ ran: true, sessionId: 'new-run' }))
    const { app, supervisor } = setup({ ability: allow, resumeRun: rc })
    const h = supervisor.beginRun({ sessionId: 'r2', conversationId: 'c-9', agentId: 'a1' })
    h.complete()
    const res = await app.request('/api/v1/agent/runs/r2/retry', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as { runId: string }
    expect(body.runId).toBe('new-run')
    // retry passes the RUN id and forces a goal reseed (ledger still armed inside resumeRun)
    expect(rc).toHaveBeenCalledWith('r2', { seedFromCheckpoint: false })
  })

  it('retry returns 422 when the re-run cannot start (e.g. agent unavailable)', async () => {
    const { app, supervisor } = setup({ ability: allow, resumeRun: async () => ({ ran: false, reason: 'agent_unavailable' }) })
    const h = supervisor.beginRun({ sessionId: 'r3', conversationId: 'c-3', agentId: 'a1' })
    h.fail('boom')
    const res = await app.request('/api/v1/agent/runs/r3/retry', { method: 'POST' })
    expect(res.status).toBe(422)
  })

  it('refresh requires auth (401 without ability)', async () => {
    const res = await setup({ resumeRun: async () => ({ ran: true }) }).app.request('/api/v1/agent/runs/x/refresh', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('refresh on an unknown run returns 404', async () => {
    const { app } = setup({ ability: allow, resumeRun: async () => ({ ran: true, sessionId: 'new' }) })
    const res = await app.request('/api/v1/agent/runs/nope/refresh', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('refresh on an active (running) run returns 409', async () => {
    const { app, supervisor } = setup({ ability: allow, resumeRun: async () => ({ ran: true, sessionId: 'new' }) })
    supervisor.beginRun({ sessionId: 'rf1', conversationId: 'c1', agentId: 'a1' })
    const res = await app.request('/api/v1/agent/runs/rf1/refresh', { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('refresh on a parked (waiting_approval) run returns 409', async () => {
    const { app, supervisor } = setup({ ability: allow, resumeRun: async () => ({ ran: true, sessionId: 'new' }) })
    supervisor.beginRun({ sessionId: 'rf-park', conversationId: 'c1', agentId: 'a1' })
    supervisor.park('rf-park', 'appr-1')
    const res = await app.request('/api/v1/agent/runs/rf-park/refresh', { method: 'POST' })
    expect(res.status).toBe(409)
  })

  it('refresh on a terminal run warm-resumes and returns the new run id', async () => {
    const rr = vi.fn(async () => ({ ran: true, sessionId: 'resumed-run' }))
    const { app, supervisor } = setup({ ability: allow, resumeRun: rr })
    const h = supervisor.beginRun({ sessionId: 'rf2', conversationId: 'c-9', agentId: 'a1' })
    h.fail('stuck')
    const res = await app.request('/api/v1/agent/runs/rf2/refresh', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = await res.json() as { runId: string }
    expect(body.runId).toBe('resumed-run')
    expect(rr).toHaveBeenCalledWith('rf2')
  })

  // F2 T7 — the agent-runs page renders a verification badge off these two
  // fields; without them in the mapping the column is invisible to the UI.
  describe('verification exposure (F2 T7)', () => {
    it("carries verification + criticRounds on the list and the detail response", async () => {
      const { app, supervisor, db } = setup({ ability: allow })
      const h = supervisor.beginRun({ sessionId: 'v1', conversationId: 'c1', agentId: 'a1', kind: 'background' })
      h.complete({ turns: 2, verification: 'failed' })
      db.run(sql`UPDATE agent_sessions SET critic_rounds = 1 WHERE id = 'v1'`)

      const list = await (await app.request('/api/v1/agent/runs')).json() as { runs: any[] }
      expect(list.runs.find((r) => r.id === 'v1')).toMatchObject({ verification: 'failed', criticRounds: 1 })

      const detail = await (await app.request('/api/v1/agent/runs/v1')).json() as { run: any }
      expect(detail.run).toMatchObject({ verification: 'failed', criticRounds: 1 })
    })

    it('an un-critic\'d run reports verification: null and 0 rounds', async () => {
      const { app, supervisor } = setup({ ability: allow })
      supervisor.beginRun({ sessionId: 'v2', conversationId: 'c1', agentId: 'a1' }).complete({ turns: 1 })

      const detail = await (await app.request('/api/v1/agent/runs/v2')).json() as { run: any }
      expect(detail.run.verification).toBeNull()
      expect(detail.run.criticRounds).toBe(0)
    })
  })
})
