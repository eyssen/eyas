// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T10 — team-session durability. The wedge this closes: before the phase
// cursor existed, a restarted server could not continue ANY team session — the
// driver was a fire-and-forget IIFE in the approve route, pause() blocked on an
// in-memory Promise, and resume() after a restart flipped the DB row to
// 'running' with nothing driving it.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureTeamSchema } from '@modules/agent/team-schema'
import { createTeamSessionService, resumePhaseIndex } from '@modules/agent/team-session-service'
import { createOrchestrator, type TeamConfig } from '@modules/agent/orchestrator'
import { createOrchestrationEventService } from '@modules/agent/orchestration-event-service'
import { createTeamRoutes } from '@modules/agent/routes-team'
import {
  driveTeam,
  hasActiveTeamDriver,
  reviveTeamSessions,
  __resetTeamDriversForTest,
} from '@modules/agent/team-driver'

vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: any, next: any) => next(),
}))

// ─── World ────────────────────────────────────

const TOKENS_PER_MEMBER = 100
const COST_PER_MEMBER = 0.01

function makeDb() {
  const db = createMemoryDb()
  ensureTeamSchema(db)
  db.run(sql`CREATE TABLE conversations (id TEXT PRIMARY KEY, team_session_id TEXT)`)
  db.run(sql`INSERT INTO conversations (id, team_session_id) VALUES ('conv-1', NULL)`)
  db.run(sql`CREATE TABLE orchestration_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL, seq INTEGER NOT NULL, node_id TEXT NOT NULL,
    parent_id TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL
  )`)
  return db
}

const PARKED_APPROVAL_ID = 7

interface StackOptions {
  /** Members whose run blocks until the returned gate is released. */
  gate?: { promise: Promise<void> }
  /** Captured user message of every gateway.complete call (the re-planner's input). */
  replanPrompts?: string[]
  /** Members whose run stops on an approval escalation (T5's durable park). */
  parkAgents?: Set<string>
}

/**
 * One "process": its own service instances, orchestrator and driver deps over a
 * shared DB. A restart is modelled by building a SECOND stack on the same db
 * (empty resolver map, no live driver) — exactly what a fresh process sees.
 */
function makeStack(db: any, opts: StackOptions = {}) {
  const runs: string[] = []
  let convSeq = 0

  const conversations = {
    create: vi.fn(() => ({ id: `child-${++convSeq}` })),
    update: vi.fn(),
    addMessage: vi.fn(),
    get: vi.fn(() => ({ projectId: null })),
    addRunCost: vi.fn(),
  }

  const registry = {
    list: vi.fn(() => []),
    get: vi.fn((id: string) => ({
      id, name: id, role: 'engineer', systemPrompt: 'be useful',
      constraints: [], tools: [], maxTurns: 2, model: 'claude-haiku-4-5', enabled: true,
    })),
    addTokenUsage: vi.fn(),
  }

  const runner = {
    run: vi.fn(async function* (req: any) {
      const agentId = req.metadata.agentId as string
      runs.push(agentId)
      if (opts.gate) await opts.gate.promise
      yield {
        type: 'turn_complete', turn: 1, tokensUsed: TOKENS_PER_MEMBER,
        usage: { inputTokens: 80, outputTokens: 20, costUsd: COST_PER_MEMBER },
      }
      // parked_for_approval is TERMINAL in the runner — no 'done' follows it.
      if (opts.parkAgents?.has(agentId)) {
        yield { type: 'parked_for_approval', approvalId: PARKED_APPROVAL_ID, toolName: 'write_file' }
        return
      }
      yield { type: 'done', response: { content: [{ type: 'text', text: `${agentId} finished` }] } }
    }),
  }

  const gateway = {
    complete: vi.fn(async (req: any) => {
      opts.replanPrompts?.push(req.messages[0].content)
      return { content: [{ type: 'text', text: '{"shouldContinue": true}' }] }
    }),
    getProvider: vi.fn(() => undefined),
  }

  const teamSessions = createTeamSessionService(db)
  const orchestrator = createOrchestrator({
    agentRegistry: registry as any,
    agentRunner: runner as any,
    gateway: gateway as any,
    conversations: conversations as any,
    toolRegistry: { toToolDefinitions: vi.fn(() => []) } as any,
    toolExecutor: {} as any,
    teamSessions,
  })

  const broadcast: any[] = []
  const orchestrationEvents = createOrchestrationEventService({
    db,
    broadcaster: { emit: (e) => broadcast.push(e), topicFor: (r: string) => `orchestration:${r}` },
  })

  const warnings: unknown[] = []
  const logger = { info: vi.fn(), warn: vi.fn((o: unknown) => warnings.push(o)), error: vi.fn() }
  const wsFrames: Array<{ topic: string; message: any }> = []
  const busEvents: Array<{ subject: string; data: any }> = []

  const deps = {
    teamSessions,
    orchestrator,
    bus: { emit: (subject: string, data: unknown) => busEvents.push({ subject, data }) },
    broadcaster: orchestrationEvents,
    wsBroadcast: (topic: string, message: unknown) => wsFrames.push({ topic, message }),
    logger,
  }

  const app = new Hono()
  app.use('*', async (c: any, next) => { c.set('userId', 'owner-1'); return next() })
  createTeamRoutes(
    app, teamSessions as any, orchestrator as any,
    { get: () => ({ userId: 'owner-1' }) } as any,
    deps.bus, orchestrationEvents, deps.wsBroadcast, logger,
  )

  return { runs, teamSessions, orchestrator, orchestrationEvents, deps, app, logger, warnings, wsFrames, busEvents, broadcast }
}

function phasedConfig(phases: TeamConfig['phases']): TeamConfig {
  return {
    phases,
    maxParallelAgents: 2,
    conflictStrategy: 'first-wins',
    replanAfterPhase: false,
    modelRouting: 'manual',
    useWorktrees: false,
  }
}

const CHECKPOINT_CONFIG = phasedConfig([
  { name: 'plan', agents: ['a1'], parallel: false, checkpoint: true, replanOnComplete: false },
  { name: 'build', agents: ['a2', 'a3'], parallel: false, checkpoint: false, replanOnComplete: false },
])

function cursorOf(db: any, id: string): { currentPhase: number; phaseStatus: string | null } {
  const row = (db.all(sql`SELECT current_phase, phase_status FROM team_sessions WHERE id = ${id}`) as any[])[0]
  return { currentPhase: row.current_phase, phaseStatus: row.phase_status ?? null }
}

function phaseResultRows(db: any, id: string): any[] {
  return db.all(sql`SELECT * FROM team_phase_results WHERE team_session_id = ${id}
    ORDER BY phase_index ASC, created_at ASC, rowid ASC`) as any[]
}

function createSession(stack: ReturnType<typeof makeStack>, config: TeamConfig) {
  return stack.teamSessions.create('conv-1', {
    config, reasoning: 'because', estimatedTokens: 1000, goalDescription: 'Ship it',
  })
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for: ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

beforeEach(() => {
  __resetTeamDriversForTest()
})

// ─── 1. Cursor lifecycle ──────────────────────

describe('phase cursor', () => {
  it('writes current_phase/phase_status at phase start, checkpoint and completion', async () => {
    const db = makeDb()
    const stack = makeStack(db)
    const session = createSession(stack, CHECKPOINT_CONFIG)
    stack.teamSessions.approve(session.id)

    const seen: Array<{ type: string; cursor: string }> = []
    for await (const ev of stack.orchestrator.executeTeam(CHECKPOINT_CONFIG, 'conv-1', 'Ship it', session.id)) {
      const c = cursorOf(db, session.id)
      seen.push({ type: ev.type, cursor: `${c.currentPhase}:${c.phaseStatus}` })
      // The generator only reaches pause() once the consumer asks for the next
      // value, so the resolver is registered after this body returns.
      if (ev.type === 'checkpoint') setTimeout(() => stack.teamSessions.resume(session.id), 0)
    }

    const at = (type: string) => seen.filter((s) => s.type === type).map((s) => s.cursor)
    expect(at('phase_started')).toEqual(['0:running', '1:running'])
    expect(at('checkpoint')).toEqual(['0:awaiting_checkpoint'])
    expect(at('team_completed')).toEqual(['1:done'])
  })

  it('starts a fresh session at cursor 0/pending', () => {
    const db = makeDb()
    const stack = makeStack(db)
    const session = createSession(stack, CHECKPOINT_CONFIG)
    expect(cursorOf(db, session.id)).toEqual({ currentPhase: 0, phaseStatus: null })
    expect(resumePhaseIndex({ currentPhase: 0, phaseStatus: null })).toBe(0)
  })

  it('resumePhaseIndex advances past a finished phase but not past a running one', () => {
    expect(resumePhaseIndex({ currentPhase: 2, phaseStatus: 'running' })).toBe(2)
    expect(resumePhaseIndex({ currentPhase: 2, phaseStatus: 'done' })).toBe(3)
    expect(resumePhaseIndex({ currentPhase: 2, phaseStatus: 'awaiting_checkpoint' })).toBe(3)
    expect(resumePhaseIndex({ currentPhase: 2, phaseStatus: 'pending' })).toBe(2)
  })
})

// ─── 2. Per-member result persistence ─────────

describe('team_phase_results', () => {
  it('persists one row per member with status, summary, tokens and cost', async () => {
    const db = makeDb()
    const stack = makeStack(db)
    const config = phasedConfig([
      { name: 'plan', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false },
      { name: 'build', agents: ['a2', 'a3'], parallel: true, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    for await (const _ of stack.orchestrator.executeTeam(config, 'conv-1', 'Ship it', session.id)) { /* drain */ }

    const rows = phaseResultRows(db, session.id)
    expect(rows.map((r) => [r.phase_index, r.agent_id, r.status])).toEqual([
      [0, 'a1', 'completed'],
      [1, 'a2', 'completed'],
      [1, 'a3', 'completed'],
    ])
    expect(rows.every((r) => r.tokens_used === TOKENS_PER_MEMBER)).toBe(true)
    expect(rows.every((r) => r.cost_usd === COST_PER_MEMBER)).toBe(true)
    expect(rows[0].summary).toContain('a1 finished')
    expect(rows.every((r) => typeof r.created_at === 'string' && r.created_at.length > 0)).toBe(true)
  })

  it('records a failed member with the failure summary', async () => {
    const db = makeDb()
    const stack = makeStack(db)
    stack.orchestrator.runAgentInConversation = (async () => { throw new Error('boom') }) as any
    const config = phasedConfig([
      { name: 'build', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    for await (const _ of stack.orchestrator.executeTeam(config, 'conv-1', 'Ship it', session.id)) { /* drain */ }

    const rows = phaseResultRows(db, session.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].summary).toBe('boom')
  })

  it('feeds loaded results to the re-planner in the same shape as in-memory ones', async () => {
    const db = makeDb()
    const replanPrompts: string[] = []
    const stack = makeStack(db, { replanPrompts })
    const config = phasedConfig([
      { name: 'build', agents: ['a1', 'a2'], parallel: false, checkpoint: false, replanOnComplete: true },
    ])
    config.replanAfterPhase = true
    const session = createSession(stack, config)

    // a1 already finished before the crash; only a2 is left to run.
    stack.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: 'child-old', status: 'completed',
      summary: 'a1 finished', tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })
    const state = stack.teamSessions.getResumeState(session.id)

    const phaseCompleted: any[] = []
    for await (const ev of stack.orchestrator.executeTeam(config, 'conv-1', 'Ship it', session.id, undefined, state)) {
      if (ev.type === 'phase_completed') phaseCompleted.push(ev)
    }

    expect(stack.runs).toEqual(['a2'])
    const results = phaseCompleted[0].results
    expect(results.phaseName).toBe('build')
    expect(results.agentResults.map((r: any) => r.agentId).sort()).toEqual(['a1', 'a2'])
    expect(results.agentResults.find((r: any) => r.agentId === 'a1')).toEqual({
      agentId: 'a1', conversationId: 'child-old', status: 'completed',
      summary: 'a1 finished', tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })
    // The re-planner's prompt lists the loaded member exactly like a live one.
    expect(replanPrompts.join('\n')).toContain('Agent a1: completed — a1 finished')
  })
})

// ─── 2b. Re-drive spend accounting (fix round 1, Important 1) ──

describe('re-drive spend accounting', () => {
  // A prior FAILED member's tokens were really spent. The skipped-phase branch
  // always counted them; the re-entered-phase branch counted only completed
  // ones, so every re-drive cycle silently shrank team_sessions.total_cost_usd.
  it('counts a failed prior member\'s spend exactly once when its phase is re-entered', async () => {
    const db = makeDb()
    const boot = makeStack(db)
    const config = phasedConfig([
      { name: 'build', agents: ['a1', 'a2'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(boot, config)
    boot.teamSessions.setStatus(session.id, 'running')
    boot.teamSessions.setPhaseCursor(session.id, 0, 'running')
    // a1 failed before the crash (it burned tokens getting there), a2 never ran.
    boot.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: 'child-old', status: 'failed',
      summary: 'a1 blew up', tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })

    expect(reviveTeamSessions(boot.deps)).toBe(1)
    await waitFor(() => boot.teamSessions.get(session.id)!.status === 'completed', 're-drive completion')

    // A failed member is NOT carried — it is retried — so the total is the
    // failed attempt plus both members' fresh runs.
    expect(boot.runs).toEqual(['a1', 'a2'])
    const done = boot.teamSessions.get(session.id)!
    expect(done.totalTokens).toBe(3 * TOKENS_PER_MEMBER)
    expect(done.totalCostUsd).toBeCloseTo(3 * COST_PER_MEMBER, 6)
  })

  it('counts every prior attempt of a repeatedly-failed member, not just the last', () => {
    const db = makeDb()
    const stack = makeStack(db)
    const config = phasedConfig([
      { name: 'build', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    for (const summary of ['first crash', 'second crash']) {
      stack.teamSessions.recordPhaseResult(session.id, 0, {
        agentId: 'a1', conversationId: '', status: 'failed',
        summary, tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
      })
    }

    const loaded = stack.teamSessions.loadPhaseResults(session.id)[0].agentResults
    expect(loaded).toHaveLength(1)
    // Status/summary are the LATEST truth; spend is the sum of every attempt.
    expect(loaded[0].summary).toBe('second crash')
    expect(loaded[0].tokensUsed).toBe(2 * TOKENS_PER_MEMBER)
    expect(loaded[0].costUsd).toBeCloseTo(2 * COST_PER_MEMBER, 6)
  })

  it('the skipped-phase branch counts prior failures too (both branches agree)', async () => {
    const db = makeDb()
    const stack = makeStack(db)
    const config = phasedConfig([
      { name: 'plan', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false },
      { name: 'build', agents: ['a2'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    stack.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: '', status: 'failed',
      summary: 'a1 blew up', tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })
    stack.teamSessions.setPhaseCursor(session.id, 0, 'done')

    await driveTeam(session.id, stack.deps, stack.teamSessions.getResumeState(session.id))

    expect(stack.runs).toEqual(['a2'])
    const done = stack.teamSessions.get(session.id)!
    expect(done.totalTokens).toBe(2 * TOKENS_PER_MEMBER)
  })
})

// ─── 2c. Parked members (fix round 1, Important 2) ────

describe('parked members', () => {
  const parkedConfig = phasedConfig([
    { name: 'build', agents: ['a1', 'a2'], parallel: false, checkpoint: false, replanOnComplete: true },
  ])
  parkedConfig.replanAfterPhase = true

  it('persists a parked member as parked, keeping the approval summary and its partial spend', async () => {
    const db = makeDb()
    const stack = makeStack(db, { parkAgents: new Set(['a1']) })
    const session = createSession(stack, parkedConfig)
    for await (const _ of stack.orchestrator.executeTeam(parkedConfig, 'conv-1', 'Ship it', session.id)) { /* drain */ }

    const rows = phaseResultRows(db, session.id)
    expect(rows.map((r) => [r.agent_id, r.status])).toEqual([['a1', 'parked'], ['a2', 'completed']])
    expect(rows[0].summary).toContain(`[parked for approval #${PARKED_APPROVAL_ID}]`)
    expect(rows[0].tokens_used).toBe(TOKENS_PER_MEMBER)
  })

  // A parked member is EXTERNALLY owned: its child run waits on an approval
  // (with, in production, a retained worktree). Re-running it would duplicate
  // the execution, orphan the approval and risk a double merge.
  it('a re-drive skips a parked member but still shows it to the re-planner as unfinished', async () => {
    const db = makeDb()
    const replanPrompts: string[] = []
    const stack = makeStack(db, { replanPrompts })
    const session = createSession(stack, parkedConfig)
    stack.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: 'child-old', status: 'failed', parked: true,
      summary: `[parked for approval #${PARKED_APPROVAL_ID}] mid-flight`,
      tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })
    const state = stack.teamSessions.getResumeState(session.id)

    const phaseCompleted: any[] = []
    for await (const ev of stack.orchestrator.executeTeam(parkedConfig, 'conv-1', 'Ship it', session.id, undefined, state)) {
      if (ev.type === 'phase_completed') phaseCompleted.push(ev)
    }

    expect(stack.runs).toEqual(['a2'])  // a1 is NOT re-run
    const carried = phaseCompleted[0].results.agentResults.find((r: any) => r.agentId === 'a1')
    // T5 semantics unchanged: the re-planner sees a failed-shaped, unfinished
    // member carrying the parked summary.
    expect(carried.status).toBe('failed')
    expect(carried.parked).toBe(true)
    expect(carried.summary).toContain(`[parked for approval #${PARKED_APPROVAL_ID}]`)
    expect(replanPrompts.join('\n')).toContain(`Agent a1: failed — [parked for approval #${PARKED_APPROVAL_ID}]`)
  })

  // The parallel pool carries member results through its own queue, so the
  // park marker has to survive that path too — not just the sequential one.
  it('persists a parked member from a parallel phase as parked', async () => {
    const db = makeDb()
    const stack = makeStack(db, { parkAgents: new Set(['a2']) })
    const config = phasedConfig([
      { name: 'build', agents: ['a1', 'a2'], parallel: true, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    for await (const _ of stack.orchestrator.executeTeam(config, 'conv-1', 'Ship it', session.id)) { /* drain */ }

    const rows = phaseResultRows(db, session.id)
    const parked = rows.find((r) => r.agent_id === 'a2')
    expect(parked.status).toBe('parked')
    expect(parked.summary).toContain(`[parked for approval #${PARKED_APPROVAL_ID}]`)
    expect(rows.find((r) => r.agent_id === 'a1').status).toBe('completed')
  })

  it('still re-runs a plain failed member, and still skips a completed one', async () => {
    const db = makeDb()
    const stack = makeStack(db)
    const session = createSession(stack, parkedConfig)
    stack.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: '', status: 'failed', summary: 'a1 blew up',
      tokensUsed: 0, costUsd: 0,
    })
    stack.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a2', conversationId: 'child-old', status: 'completed', summary: 'a2 finished',
      tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })
    const state = stack.teamSessions.getResumeState(session.id)

    for await (const _ of stack.orchestrator.executeTeam(parkedConfig, 'conv-1', 'Ship it', session.id, undefined, state)) { /* drain */ }
    expect(stack.runs).toEqual(['a1'])
  })
})

// ─── 3. THE WEDGE ─────────────────────────────

describe('restart durability (the F1-era wedge)', () => {
  it('continues a checkpoint-paused session after a restart and completes it', async () => {
    const db = makeDb()
    const before = makeStack(db)
    const session = createSession(before, CHECKPOINT_CONFIG)

    const approved = await before.app.request(`/team-sessions/${session.id}/approve`, { method: 'POST' })
    expect(approved.status).toBe(200)
    await waitFor(() => before.teamSessions.get(session.id)!.status === 'paused', 'first phase checkpoint')
    expect(before.runs).toEqual(['a1'])

    // ── restart: new service instances, empty resolver map, no live driver ──
    __resetTeamDriversForTest()
    const after = makeStack(db)
    expect(hasActiveTeamDriver(session.id)).toBe(false)

    const resumed = await after.app.request(`/team-sessions/${session.id}/resume`, { method: 'POST' })
    expect(resumed.status).toBe(200)
    await waitFor(() => after.teamSessions.get(session.id)!.status === 'completed', 'post-restart completion')

    // Phase 0 is NOT re-run; phase 1's members are.
    expect(after.runs).toEqual(['a2', 'a3'])
    const done = after.teamSessions.get(session.id)!
    expect(done.totalTokens).toBe(3 * TOKENS_PER_MEMBER)
    expect(done.totalCostUsd).toBeCloseTo(3 * COST_PER_MEMBER, 6)
    expect(cursorOf(db, session.id)).toEqual({ currentPhase: 1, phaseStatus: 'done' })
  })

  // Resume now RUNS the session, so it must refuse every state that is not
  // waiting at a checkpoint — starting an unapproved team would be an
  // approval bypass, and re-driving a finished one duplicates its close-out.
  it('refuses to resume a session that is not awaiting a checkpoint', async () => {
    const db = makeDb()
    const stack = makeStack(db)

    for (const status of ['proposing', 'awaiting_approval', 'completed', 'failed'] as const) {
      const session = createSession(stack, CHECKPOINT_CONFIG)
      stack.teamSessions.setStatus(session.id, status)
      const res = await stack.app.request(`/team-sessions/${session.id}/resume`, { method: 'POST' })
      expect(res.status, `resume on a ${status} session`).toBe(409)
      expect(stack.teamSessions.get(session.id)!.status).toBe(status)
    }
    expect(stack.runs).toEqual([])
  })

  it('resume no longer flips a driverless session to running without a driver', () => {
    const db = makeDb()
    const stack = makeStack(db)
    const session = createSession(stack, CHECKPOINT_CONFIG)
    stack.teamSessions.setStatus(session.id, 'paused')

    // No in-memory resolver — the service must SAY so rather than lie.
    expect(stack.teamSessions.resume(session.id)).toBe(false)
    expect(stack.teamSessions.get(session.id)!.status).toBe('paused')
  })
})

// ─── 4. Boot scan ─────────────────────────────

describe('boot scan', () => {
  function seedInterruptedPhase(db: any, stack: ReturnType<typeof makeStack>) {
    const config = phasedConfig([
      { name: 'build', agents: ['a1', 'a2'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    // Crash mid-phase: a1 landed, a2 never ran, cursor left at 0/running.
    stack.teamSessions.setStatus(session.id, 'running')
    stack.teamSessions.setPhaseCursor(session.id, 0, 'running')
    stack.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: 'child-old', status: 'completed',
      summary: 'a1 finished', tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })
    return session
  }

  it('re-drives a running orphan from its cursor and does not re-run completed members', async () => {
    const db = makeDb()
    const boot = makeStack(db)
    const session = seedInterruptedPhase(db, boot)

    expect(reviveTeamSessions(boot.deps)).toBe(1)
    await waitFor(() => boot.teamSessions.get(session.id)!.status === 'completed', 'boot re-drive completion')

    expect(boot.runs).toEqual(['a2'])
    const done = boot.teamSessions.get(session.id)!
    expect(done.totalTokens).toBe(2 * TOKENS_PER_MEMBER)
    expect(done.totalCostUsd).toBeCloseTo(2 * COST_PER_MEMBER, 6)
  })

  it('leaves a paused orphan alone, and it stays resumable afterwards', async () => {
    const db = makeDb()
    const boot = makeStack(db)
    const session = createSession(boot, CHECKPOINT_CONFIG)
    boot.teamSessions.setStatus(session.id, 'paused')
    boot.teamSessions.setPhaseCursor(session.id, 0, 'awaiting_checkpoint')
    boot.teamSessions.recordPhaseResult(session.id, 0, {
      agentId: 'a1', conversationId: 'child-old', status: 'completed',
      summary: 'a1 finished', tokensUsed: TOKENS_PER_MEMBER, costUsd: COST_PER_MEMBER,
    })

    expect(reviveTeamSessions(boot.deps)).toBe(0)
    expect(boot.teamSessions.get(session.id)!.status).toBe('paused')
    expect(boot.runs).toEqual([])

    const resumed = await boot.app.request(`/team-sessions/${session.id}/resume`, { method: 'POST' })
    expect(resumed.status).toBe(200)
    await waitFor(() => boot.teamSessions.get(session.id)!.status === 'completed', 'resume after boot')
    expect(boot.runs).toEqual(['a2', 'a3'])
  })

  // A crash between the checkpoint cursor write and pause() leaves status
  // 'running' at a human gate. Re-driving would silently skip the approval.
  it('parks a running orphan that died at a checkpoint boundary instead of driving it', () => {
    const db = makeDb()
    const boot = makeStack(db)
    const session = createSession(boot, CHECKPOINT_CONFIG)
    boot.teamSessions.setStatus(session.id, 'running')
    boot.teamSessions.setPhaseCursor(session.id, 0, 'awaiting_checkpoint')

    expect(reviveTeamSessions(boot.deps)).toBe(0)
    expect(boot.teamSessions.get(session.id)!.status).toBe('paused')
    expect(boot.runs).toEqual([])
  })
})

// ─── 5. Double-drive guard ────────────────────

describe('active-driver guard', () => {
  it('no-ops a second drive of a live session (boot scan racing a resume)', async () => {
    const db = makeDb()
    let release!: () => void
    const gate = { promise: new Promise<void>((r) => { release = r }) }
    const stack = makeStack(db, { gate })
    const config = phasedConfig([
      { name: 'build', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)
    stack.teamSessions.setStatus(session.id, 'running')

    const first = driveTeam(session.id, stack.deps)
    await waitFor(() => stack.runs.length === 1, 'first driver started the member')
    expect(hasActiveTeamDriver(session.id)).toBe(true)

    // Boot scan racing the live driver — must not start a second one.
    expect(reviveTeamSessions(stack.deps)).toBe(0)
    driveTeam(session.id, stack.deps)
    expect(stack.logger.warn).toHaveBeenCalled()

    release()
    await first
    expect(stack.runs).toEqual(['a1'])
    expect(hasActiveTeamDriver(session.id)).toBe(false)
  })
})

// ─── 6. Event-seq continuity ──────────────────

describe('orchestration event seq', () => {
  it('continues ascending after the persisted events of the pre-restart run', async () => {
    const db = makeDb()
    const before = makeStack(db)
    const session = createSession(before, CHECKPOINT_CONFIG)

    await before.app.request(`/team-sessions/${session.id}/approve`, { method: 'POST' })
    await waitFor(() => before.teamSessions.get(session.id)!.status === 'paused', 'checkpoint')
    const seqBefore = before.orchestrationEvents.listByRun(session.id).map((e) => e.seq)
    expect(seqBefore.length).toBeGreaterThan(0)

    __resetTeamDriversForTest()
    const after = makeStack(db)
    await after.app.request(`/team-sessions/${session.id}/resume`, { method: 'POST' })
    await waitFor(() => after.teamSessions.get(session.id)!.status === 'completed', 'completion')

    const all = after.orchestrationEvents.listByRun(session.id).map((e) => e.seq)
    expect(all.length).toBeGreaterThan(seqBefore.length)
    // Strictly ascending across the restart — the re-drive continues from the
    // persisted max instead of restarting at 1 (which would interleave).
    expect(all).toEqual([...all].sort((a, b) => a - b))
    expect(new Set(all).size).toBe(all.length)
    expect(Math.min(...all.slice(seqBefore.length))).toBeGreaterThan(Math.max(...seqBefore))
  })
})

// ─── 7. Regression — the normal flow ──────────

describe('non-restart flow', () => {
  it('approve → phases → complete works exactly as before', async () => {
    const db = makeDb()
    const stack = makeStack(db)
    const config = phasedConfig([
      { name: 'plan', agents: ['a1'], parallel: false, checkpoint: false, replanOnComplete: false },
      { name: 'build', agents: ['a2'], parallel: false, checkpoint: false, replanOnComplete: false },
    ])
    const session = createSession(stack, config)

    const res = await stack.app.request(`/team-sessions/${session.id}/approve`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'running' })
    await waitFor(() => stack.teamSessions.get(session.id)!.status === 'completed', 'completion')

    expect(stack.runs).toEqual(['a1', 'a2'])
    const done = stack.teamSessions.get(session.id)!
    expect(done.totalTokens).toBe(2 * TOKENS_PER_MEMBER)
    expect(done.totalCostUsd).toBeCloseTo(2 * COST_PER_MEMBER, 6)
    // The WS/bus transport the panel depends on is unchanged.
    expect(stack.wsFrames.some((f) => f.message.data?.type === 'team_completed')).toBe(true)
    expect(stack.busEvents.some((e) => e.subject === `team:${session.id}:event`)).toBe(true)
  })
})
