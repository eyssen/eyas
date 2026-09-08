// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T6 — resume. A parked run (T5) is woken by the operator's decision on the
// approval it parked on: approve → the run continues and re-issues the call
// under its grant (T3's consumeGrant); reject/expiry → the run continues with a
// denial and has to find another way. The approval row is the coordination
// point: `resume_started_at` is claimed with a CAS so the bus subscriber and
// the hourly sweep can never both drive the same resume.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { runConversation, resumeRun } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { resumeParked, sweepApprovalResumes, cancelParkedRun } from '@modules/agent/approval-resume'
import { wireApprovalResume } from '@modules/agent/index'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy'
import { createEventStoreTables } from '@modules/event-store/schema'
import { createEventStore } from '@modules/event-store/event-store'
import { createCheckpointTables, createCheckpointServices } from '@modules/agent/checkpoint'
import { createLocalBus } from '@core/bus/local-bus'
import { createMemoryDb } from '../../helpers/test-db'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => silentLogger,
}

// ─── fixtures ─────────────────────────────────

function toolUse(name: string, input: Record<string, unknown>, id = `tu-${name}`): ModelResponse {
  return {
    id: 'r-tu', provider: 'mock', model: 'mock',
    content: [{ type: 'tool_use', id, name, input }] as any,
    stopReason: 'tool_use', usage: { inputTokens: 5, outputTokens: 5 },
  }
}

function text(t: string): ModelResponse {
  return {
    id: 'r-text', provider: 'mock', model: 'mock',
    content: [{ type: 'text', text: t }], stopReason: 'end', usage: { inputTokens: 3, outputTokens: 3 },
  }
}

/** Replays a queued response per model turn and records every request it saw. */
function queueGateway(responses: ModelResponse[]) {
  const requests: any[] = []
  let i = 0
  const gateway = {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only in this test') },
    async *stream(request: any): AsyncIterable<StreamEvent> {
      requests.push(request)
      yield { type: 'done', response: responses[i++] ?? text('nothing left') }
    },
  } as unknown as ModelGateway
  return { gateway, requests }
}

function convTables(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
    team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
    orchestration TEXT, working_directories TEXT, tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

/**
 * A full park-and-resume rig: real runner, real autonomy policy, real
 * supervisor, real event store + checkpoints — only the gateway, the tool
 * executor and the security gate are stand-ins. `run_command` escalates;
 * everything else is allowed, so a run can complete a clean tool turn (and
 * capture a checkpoint) before it walls.
 */
function setup(responses: ModelResponse[]) {
  const db = createMemoryDb()
  convTables(db)
  ensureRunSupervisionSchema(db)
  createAutonomyTables(db)
  createEventStoreTables(db)
  createCheckpointTables(db)

  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'Ship the thing', ${now}, ${now})`)

  const policy = createAutonomyPolicy(db)
  const events = createEventStore(db)
  const checkpoints = createCheckpointServices(db, { eventStore: events, policy: { everyTurns: 1 } })
  const { gateway, requests } = queueGateway(responses)
  const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { result: 'ok' }, durationMs: 1 })) }
  const securityGate = {
    validateToolCall: vi.fn(async (toolName: string) =>
      toolName === 'run_command'
        ? { decision: 'escalate', reason: 'needs review', riskTier: 'yellow' }
        : { decision: 'allow', reason: 'ok', riskTier: 'green' }),
  }
  const agentRunner = createAgentRunner({
    gateway,
    toolExecutor: toolExecutor as any,
    securityGate: securityGate as any,
    autonomyPolicy: policy as any,
    eventStore: events,
    checkpoint: checkpoints.api,
    logger: silentLogger,
  })

  const emitted: Array<{ event: string; payload: any }> = []
  const supervisor = createRunSupervisor({ db, emit: (event, payload) => emitted.push({ event, payload }) })

  let runSeq = 0
  const runnerDeps = {
    db,
    agentRunner,
    agentRegistry: {
      get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['run_command', 'read_file'], maxTurns: 6, model: 'm' }),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([{ name: 'run_command' }, { name: 'read_file' }]) },
    supervisor,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    generateId: () => `run-${++runSeq}`,
  }

  const removeWorktree = vi.fn()
  const resumeDeps = (over: { eventStore?: any } = {}) => ({
    db,
    autonomyPolicy: policy,
    supervisor,
    logger: silentLogger,
    removeWorktree,
    resumeRun: vi.fn((runId: string, opts: any) =>
      resumeRun(runId, { ...runnerDeps, eventStore: 'eventStore' in over ? over.eventStore : events, getCheckpoint: () => checkpoints } as any, opts)),
  })

  const park = async () => {
    const result = await runConversation('conv-1', runnerDeps as any)
    const approval = policy.listApprovals('pending')[0]!
    return { result, approvalId: approval.id, runId: result.sessionId! }
  }

  const runRow = (id: string) => (db.all(sql`SELECT * FROM agent_sessions WHERE id = ${id}`) as any[])[0]
  /** The run that resumed `parkedId`, once one exists. */
  const resumedRun = (parkedId: string) => (db.all(sql`SELECT * FROM agent_sessions WHERE parent_run_id = ${parkedId}`) as any[])[0]
  const approvalRow = (id: number) => (db.all(sql`SELECT * FROM autonomy_approvals WHERE id = ${id}`) as any[])[0]
  const convStatus = () => (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0].status

  return { db, policy, events, checkpoints, supervisor, runnerDeps, resumeDeps, park, requests, toolExecutor, emitted, removeWorktree, runRow, resumedRun, approvalRow, convStatus }
}

/** The messages the LAST model request was made with. */
function lastMessages(requests: any[]): any[] {
  return requests[requests.length - 1].messages
}

// ─── 1. approve → resumed run re-issues under its grant ───

describe('F2 T6 — approve drives the run', () => {
  it('park → approve → resumed run re-issues the call, the grant is consumed, the run completes', async () => {
    const rig = setup([
      toolUse('read_file', { path: '/a' }),   // park run, turn 1: allowed, checkpointed
      toolUse('run_command', { cmd: 'ls' }),  // park run, turn 2: escalates → park
      toolUse('run_command', { cmd: 'ls' }),  // resumed run, turn 1: re-issued under the grant
      text('all done'),                       // resumed run, turn 2
    ])
    const { approvalId, runId } = await rig.park()
    expect(rig.runRow(runId).status).toBe('waiting_approval')

    expect(rig.policy.decide(approvalId, 'approved', 'operator').ok).toBe(true)
    const deps = rig.resumeDeps()
    await resumeParked(approvalId, 'approved', deps as any)

    // The parked row is superseded, not resurrected.
    const parked = rig.runRow(runId)
    expect(parked.status).toBe('cancelled')
    expect(parked.error).toBe('superseded_by_resume')
    expect(parked.completed_at).toBeTruthy()

    // A NEW run took over, chained to the parked one.
    const resumed = (rig.db.all(sql`SELECT * FROM agent_sessions WHERE parent_run_id = ${runId}`) as any[])[0]
    expect(resumed).toBeDefined()
    expect(resumed.status).toBe('completed')

    // The grant authorized exactly the re-issued call.
    expect(rig.approvalRow(approvalId).consumed_at).toBeTruthy()
    expect(rig.toolExecutor.execute).toHaveBeenCalledTimes(2) // read_file (original) + run_command (resumed)
    expect(rig.approvalRow(approvalId).resume_error).toBeNull()
    expect(rig.convStatus()).toBe('idle')
  })

  it('seeds the resumed run from the checkpoint and appends the reviewer message', async () => {
    const rig = setup([
      toolUse('read_file', { path: '/a' }),
      toolUse('run_command', { cmd: 'ls' }),
      text('done without the tool'),
    ])
    const { approvalId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    await resumeParked(approvalId, 'approved', rig.resumeDeps() as any)

    const messages = lastMessages(rig.requests)
    // Lossless checkpoint seed: the goal, the assistant turn that called
    // read_file, and its tool_result — not a bare goal reseed.
    expect(messages[0]).toMatchObject({ role: 'user', content: 'Ship the thing' })
    expect(messages.some((m: any) => m.role === 'assistant' && m.content.some?.((b: any) => b.type === 'tool_use'))).toBe(true)
    expect(messages.some((m: any) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'))).toBe(true)
    // … with the operator's verdict appended LAST.
    const reviewer = messages[messages.length - 1]
    expect(reviewer.role).toBe('user')
    expect(reviewer.content).toContain('approved')
    expect(reviewer.content).toContain('run_command')
    expect(reviewer.content).toContain(`#${approvalId}`)
    expect(reviewer.content).toContain('same arguments')
  })

  it('the bus event drives the resume (autonomy:approval-resolved)', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      toolUse('run_command', { cmd: 'ls' }),
      text('done'),
    ])
    const { approvalId, runId } = await rig.park()
    const bus = createLocalBus()
    const deps = rig.resumeDeps()
    wireApprovalResume(bus, deps as any)

    rig.policy.decide(approvalId, 'approved', 'operator')
    bus.emit('autonomy:approval-resolved', { approvalId, status: 'approved', decidedBy: 'operator' })
    await vi.waitFor(() => expect(rig.resumedRun(runId)?.status).toBe('completed'))

    expect(rig.runRow(runId).status).toBe('cancelled')
    expect(rig.approvalRow(approvalId).consumed_at).toBeTruthy()
  })
})

// ─── 2/3. reject + expiry → denial resume ───

describe('F2 T6 — denial drives the run', () => {
  it('reject → the resumed run is told to stop attempting it and finishes without the tool', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      text('reported the blocker instead'),
    ])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'rejected', 'operator')

    await resumeParked(approvalId, 'rejected', rig.resumeDeps() as any)

    const reviewer = lastMessages(rig.requests).at(-1)
    expect(reviewer.content).toContain('denied')
    expect(reviewer.content).toContain('Do not attempt this action again')
    const resumed = (rig.db.all(sql`SELECT * FROM agent_sessions WHERE parent_run_id = ${runId}`) as any[])[0]
    expect(resumed.status).toBe('completed')
    // The denied call was never executed, and the rejection stands.
    expect(rig.toolExecutor.execute).not.toHaveBeenCalled()
    expect(rig.approvalRow(approvalId).status).toBe('rejected')
    expect(rig.approvalRow(approvalId).consumed_at).toBeNull()
    expect(rig.runRow(runId).error).toBe('rejected_by_operator')
  })

  it('expiry → same denial resume, driven by the autonomy:approval-expired event', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      text('gave up on that path'),
    ])
    const { approvalId, runId } = await rig.park()
    // Age the row past its TTL and let the security-gate sweep expire it.
    rig.db.run(sql`UPDATE autonomy_approvals SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ${approvalId}`)
    const expired = rig.policy.expireStale(new Date().toISOString())
    expect(expired).toEqual([{ id: approvalId, runId, conversationId: 'conv-1' }])

    const bus = createLocalBus()
    wireApprovalResume(bus, rig.resumeDeps() as any)
    bus.emit('autonomy:approval-expired', { approvalId, runId })
    await vi.waitFor(() => expect(rig.resumedRun(runId)?.status).toBe('completed'))

    expect(rig.runRow(runId).error).toBe('approval_expired')
    expect(lastMessages(rig.requests).at(-1).content).toContain('expired')
    expect(rig.approvalRow(approvalId).status).toBe('expired')
  })
})

// ─── 4. refusal → restored + observable ───

describe('F2 T6 — a refused resume leaves the run parked and says why', () => {
  it('restores the parked row, clears the claim and records resume_error', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')

    // No event store → resumeRun refuses (no idempotency-ledger source).
    await resumeParked(approvalId, 'approved', rig.resumeDeps({ eventStore: undefined }) as any)

    const row = rig.runRow(runId)
    expect(row.status).toBe('waiting_approval')
    expect(row.completed_at).toBeNull()
    expect(row.error).toBeNull()
    const approval = rig.approvalRow(approvalId)
    expect(approval.resume_error).toBe('event_store_required')
    expect(approval.resume_started_at).toBeNull()
    // Nothing was started, so the conversation stays parked too.
    expect(rig.convStatus()).toBe('waiting_approval')
  })

  it('the sweep retries the refused resume later and succeeds once the deps are complete', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      toolUse('run_command', { cmd: 'ls' }),
      text('done'),
    ])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    await resumeParked(approvalId, 'approved', rig.resumeDeps({ eventStore: undefined }) as any)
    expect(rig.runRow(runId).status).toBe('waiting_approval')

    const healthy = rig.resumeDeps()
    const swept = await sweepApprovalResumes(healthy as any)

    expect(swept.resumed).toBe(1)
    expect(rig.runRow(runId).status).toBe('cancelled')
    expect(rig.approvalRow(approvalId).consumed_at).toBeTruthy()
  })

  // Fix round 2 / Minor — resume_error is what puts a row on the dashboard's
  // stuck list. A later resume that succeeds has to take it back off, or a
  // recovered approval whose model simply chose not to re-issue the call would
  // sit there as "resume failed" forever.
  it('a successful resume clears the resume_error a previous attempt recorded', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      text('decided not to re-issue it after all'),
    ])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    await resumeParked(approvalId, 'approved', rig.resumeDeps({ eventStore: undefined }) as any)
    expect(rig.approvalRow(approvalId).resume_error).toBe('event_store_required')

    await resumeParked(approvalId, 'approved', rig.resumeDeps() as any)

    expect(rig.approvalRow(approvalId).resume_error).toBeNull()
    // Unconsumed (the model never re-issued) — but no longer "failed".
    expect(rig.approvalRow(approvalId).consumed_at).toBeNull()
    expect(rig.resumedRun(runId).status).toBe('completed')
  })

  it('the sweep also picks up a rejected/expired approval whose run is still parked (missed bus event)', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      text('moved on'),
    ])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'rejected', 'operator') // no bus subscriber wired

    const swept = await sweepApprovalResumes(rig.resumeDeps() as any)

    expect(swept.resumed).toBe(1)
    expect(rig.runRow(runId).error).toBe('rejected_by_operator')
  })

  // Fix round 1 / Important 3 — each candidate awaits a FULL conversation
  // serially inside one scheduler slot, so an unbounded queue would turn the
  // hourly job into an open-ended run. Hourly cadence drains the backlog.
  it('resumes at most a batch per arm per sweep, and drains the backlog across sweeps', async () => {
    const rig = setup([text('done')])
    // 7 parked runs, all denial-resumes (the cheapest shape to stand up).
    const parked: string[] = []
    for (let i = 0; i < 7; i++) {
      const runId = `parked-${i}`
      rig.db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at)
        VALUES (${runId}, 'conv-1', 'agent-1', 'waiting_approval', '2026-01-01T00:00:00Z')`)
      const id = rig.policy.createApproval({ category: 'data_delete', toolName: 'run_command', conversationId: 'conv-1', argHash: `h${i}`, runId })
      rig.policy.decide(id, 'rejected', 'operator')
      parked.push(runId)
    }

    const deps = rig.resumeDeps()
    expect((await sweepApprovalResumes(deps as any)).resumed).toBe(5)
    expect((await sweepApprovalResumes(deps as any)).resumed).toBe(2)
    expect((await sweepApprovalResumes(deps as any)).resumed).toBe(0)
    for (const runId of parked) expect(rig.runRow(runId).status).toBe('cancelled')
  })

  it('the sweep ignores approvals whose run is no longer parked, and consumed grants', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' }), text('done')])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    rig.db.run(sql`UPDATE agent_sessions SET status = 'failed' WHERE id = ${runId}`)

    const deps = rig.resumeDeps()
    expect((await sweepApprovalResumes(deps as any)).resumed).toBe(0)
    expect(deps.resumeRun).not.toHaveBeenCalled()
  })

  it('crash recovery: a stale claim on a still-parked run is released for the NEXT sweep', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' }), toolUse('run_command', { cmd: 'ls' }), text('done')])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    // A resume that claimed the row and then died before it could finalize.
    rig.db.run(sql`UPDATE autonomy_approvals SET resume_started_at = '2020-01-01T00:00:00Z' WHERE id = ${approvalId}`)

    const deps = rig.resumeDeps()
    const first = await sweepApprovalResumes(deps as any)
    expect(first).toMatchObject({ resumed: 0, recovered: 1 })
    expect(rig.approvalRow(approvalId).resume_started_at).toBeNull()
    expect(rig.runRow(runId).status).toBe('waiting_approval')

    const second = await sweepApprovalResumes(deps as any)
    expect(second.resumed).toBe(1)
    expect(rig.runRow(runId).status).toBe('cancelled')
  })

  // Fix round 1 / Critical 1 — the window between closing the parked row and
  // the resumed run's INSERT contains git shellouts, a checkpoint read and an
  // event-store scan. A process death in there used to be unrecoverable by
  // BOTH other sweep arms (they require status='waiting_approval'), invisible
  // on the dashboard (resume_error NULL) and out of reach of the cancel hatch.
  it('crash recovery: a resume that died between closing the parked row and starting the new one is restored', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' }), toolUse('run_command', { cmd: 'ls' }), text('done')])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    // Exactly the state a crash in that window leaves behind.
    rig.db.run(sql`UPDATE autonomy_approvals SET resume_started_at = '2020-01-01T00:00:00Z' WHERE id = ${approvalId}`)
    rig.supervisor.finalizeParked(runId, 'superseded_by_resume')
    rig.db.run(sql`UPDATE conversations SET status = 'working' WHERE id = 'conv-1'`)

    const deps = rig.resumeDeps()
    const first = await sweepApprovalResumes(deps as any)

    expect(first).toMatchObject({ resumed: 0, recovered: 1 })
    const row = rig.runRow(runId)
    expect(row.status).toBe('waiting_approval')
    expect(row.completed_at).toBeNull()
    expect(rig.approvalRow(approvalId).resume_started_at).toBeNull()
    // Observable: the dashboard's stuck-resume list keys on resume_error.
    expect(rig.approvalRow(approvalId).resume_error).toBe('interrupted_by_restart')
    // The card followed the half-started resume into 'working' with no run
    // behind it — it has to come back to the parked state too.
    expect(rig.convStatus()).toBe('waiting_approval')

    // …and the next sweep drives it to completion.
    expect((await sweepApprovalResumes(deps as any)).resumed).toBe(1)
    expect(rig.resumedRun(runId).status).toBe('completed')
  })

  it('crash recovery leaves a half-started resume alone once its new run exists', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    rig.db.run(sql`UPDATE autonomy_approvals SET resume_started_at = '2020-01-01T00:00:00Z' WHERE id = ${approvalId}`)
    rig.supervisor.finalizeParked(runId, 'superseded_by_resume')
    // The resumed run DID get inserted before the crash — it is the run
    // supervisor's orphan recovery that owns this one, not us.
    rig.db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at, parent_run_id)
      VALUES ('run-child', 'conv-1', 'agent-1', 'running', '2026-01-01T00:00:00Z', ${runId})`)

    const swept = await sweepApprovalResumes(rig.resumeDeps() as any)

    expect(swept.recovered).toBe(0)
    expect(rig.runRow(runId).status).toBe('cancelled')
  })

  it('crash recovery never reverses an operator cancel or a rejection', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    rig.db.run(sql`UPDATE autonomy_approvals SET resume_started_at = '2020-01-01T00:00:00Z' WHERE id = ${approvalId}`)
    rig.supervisor.finalizeParked(runId, 'cancelled_by_operator')

    const swept = await sweepApprovalResumes(rig.resumeDeps() as any)

    expect(swept.recovered).toBe(0)
    expect(rig.runRow(runId).error).toBe('cancelled_by_operator')
  })

  // A resume in flight RIGHT NOW looks exactly like the crashed one above —
  // parked row closed, no child yet. Only the age of the claim separates them,
  // which is why every recovery arm is gated on the staleness cutoff.
  it('crash recovery does NOT touch a FRESH claim on a resume still in flight', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    const claimedAt = new Date().toISOString()
    rig.db.run(sql`UPDATE autonomy_approvals SET resume_started_at = ${claimedAt} WHERE id = ${approvalId}`)
    rig.supervisor.finalizeParked(runId, 'superseded_by_resume')

    const swept = await sweepApprovalResumes(rig.resumeDeps() as any)

    expect(swept.recovered).toBe(0)
    expect(rig.approvalRow(approvalId).resume_started_at).toBe(claimedAt)
    expect(rig.runRow(runId).status).toBe('cancelled')
  })
})

// ─── 5. double-trigger race ───

describe('F2 T6 — exactly one resume per approval', () => {
  it('bus handler and sweep firing together produce ONE resume (R1 CAS)', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      toolUse('run_command', { cmd: 'ls' }),
      text('done'),
    ])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    const deps = rig.resumeDeps()

    await Promise.all([
      resumeParked(approvalId, 'approved', deps as any),
      resumeParked(approvalId, 'approved', deps as any),
      sweepApprovalResumes(deps as any),
    ])

    expect(deps.resumeRun).toHaveBeenCalledTimes(1)
    expect((rig.db.all(sql`SELECT COUNT(*) AS n FROM agent_sessions WHERE parent_run_id = ${runId}`) as any[])[0].n).toBe(1)
  })

  it('a held claim blocks a second trigger even while the run row still reads waiting_approval', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    // The crash window: claimed, but the parked row has not transitioned yet.
    expect(rig.policy.claimResume(approvalId)).toBe(true)

    const deps = rig.resumeDeps()
    await resumeParked(approvalId, 'approved', deps as any)

    expect(deps.resumeRun).not.toHaveBeenCalled()
  })
})

// ─── 6. cancel escape hatch ───

describe('F2 T6 — a parked run can be cancelled', () => {
  it('cancels the run, rejects its pending approval, reclaims the worktree and releases the card', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    rig.supervisor.recordRetainedWorktree(runId, { path: '/tmp/wt', branch: 'agent/a1-x', basePath: '/repo' })

    const deps = rig.resumeDeps()
    expect(await cancelParkedRun(runId, 'operator', deps as any)).toBe(true)

    const row = rig.runRow(runId)
    expect(row.status).toBe('cancelled')
    expect(row.error).toBe('cancelled_by_operator')
    expect(rig.approvalRow(approvalId).status).toBe('rejected')
    expect(rig.removeWorktree).toHaveBeenCalledWith({ path: '/tmp/wt', branch: 'agent/a1-x', basePath: '/repo' })
    expect(rig.runRow(runId).supervisor_state).toBeNull()
    // The card must not stay unarmable on a run nothing will ever resume.
    expect(rig.convStatus()).toBe('idle')
  })

  // Fix round 1 / Important 1 — a grant is scoped to (conversation, tool,
  // args), NOT to the run that asked for it. Cancelling a run whose approval
  // was already APPROVED but never consumed used to leave that grant live
  // until its TTL: the very action the operator just cancelled could still
  // fire from a later run in the same conversation, with no escalation.
  it('revokes an approved-but-unconsumed grant instead of leaving it live', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')

    expect(await cancelParkedRun(runId, 'operator', rig.resumeDeps() as any)).toBe(true)

    const row = rig.approvalRow(approvalId)
    expect(row.status).toBe('revoked')
    expect(row.revoked_at).toBeTruthy()
    // NOT laundered through consumed_at — the action never ran.
    expect(row.consumed_at).toBeNull()
    // And the grant is dead: a later run in the same conversation cannot use it.
    expect(rig.policy.consumeGrant({ conversationId: 'conv-1', toolName: 'run_command', argHash: row.arg_hash })).toEqual({ granted: false })
  })

  it('leaves an already-CONSUMED approval alone (the action really did run)', async () => {
    const rig = setup([
      toolUse('run_command', { cmd: 'ls' }),
      toolUse('run_command', { cmd: 'ls' }),
      text('done'),
    ])
    const { approvalId, runId } = await rig.park()
    rig.policy.decide(approvalId, 'approved', 'operator')
    await resumeParked(approvalId, 'approved', rig.resumeDeps() as any)
    expect(rig.approvalRow(approvalId).consumed_at).toBeTruthy()

    // The resumed run is a different row; cancelling the parked one is a no-op
    // now, but the consumed approval must not be rewritten either way.
    await cancelParkedRun(runId, 'operator', rig.resumeDeps() as any)
    expect(rig.approvalRow(approvalId).status).toBe('approved')
  })

  it('the approval-resolved event that follows the cancel is a no-op', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    const deps = rig.resumeDeps()
    await cancelParkedRun(runId, 'operator', deps as any)

    await resumeParked(approvalId, 'rejected', deps as any)

    expect(deps.resumeRun).not.toHaveBeenCalled()
    expect(rig.runRow(runId).error).toBe('cancelled_by_operator')
  })

  it('refuses a run that is not parked', async () => {
    const rig = setup([text('nothing')])
    await runConversation('conv-1', rig.runnerDeps as any)
    expect(await cancelParkedRun('run-1', 'operator', rig.resumeDeps() as any)).toBe(false)
  })
})

// ─── 7. regressions ───

describe('F2 T6 — non-parked approvals are untouched', () => {
  it('an approval with no run_id (interactive / forge / ops) is a no-op', async () => {
    const rig = setup([text('nothing')])
    const id = rig.policy.createApproval({ category: 'skill.adopt', toolName: null as any, reason: 'adopt' })
    rig.policy.decide(id, 'approved', 'operator')

    const deps = rig.resumeDeps()
    const bus = createLocalBus()
    wireApprovalResume(bus, deps as any)
    bus.emit('autonomy:approval-resolved', { approvalId: id, status: 'approved', decidedBy: 'operator' })
    await new Promise((r) => setTimeout(r, 5))

    expect(deps.resumeRun).not.toHaveBeenCalled()
    expect(rig.approvalRow(id).resume_error).toBeNull()
  })

  it('an unknown approval id never throws at the bus', async () => {
    const rig = setup([text('nothing')])
    const bus = createLocalBus()
    wireApprovalResume(bus, rig.resumeDeps() as any)
    bus.emit('autonomy:approval-resolved', { approvalId: 9999, status: 'approved' })
    await new Promise((r) => setTimeout(r, 5))
  })

  it('a resolved approval whose run already finished is a no-op', async () => {
    const rig = setup([toolUse('run_command', { cmd: 'ls' })])
    const { approvalId, runId } = await rig.park()
    rig.db.run(sql`UPDATE agent_sessions SET status = 'failed', error = 'something else' WHERE id = ${runId}`)
    rig.policy.decide(approvalId, 'approved', 'operator')

    const deps = rig.resumeDeps()
    await resumeParked(approvalId, 'approved', deps as any)

    expect(deps.resumeRun).not.toHaveBeenCalled()
    expect(rig.runRow(runId).error).toBe('something else')
  })
})
