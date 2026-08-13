// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T7 (D7) — verification-before-done, end to end through runConversation
// with a REAL run supervisor and a real sqlite db: the verdict has to land on
// the actual agent_sessions row, and the feedback resume has to produce a real
// child run in the lineage (never a board 'waiting' hand-off — S5).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { runConversation, resumeRun } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createMemoryDb } from '../../helpers/test-db'

let db: any
let deps: any
let store: ReturnType<typeof fakeEventStore>
let gateway: ReturnType<typeof fakeCriticGateway>

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT,
    project_id TEXT,
    goal_description TEXT,
    provider_id TEXT,
    model_id TEXT,
    stage_id TEXT,
    team_session_id TEXT,
    thinking TEXT NOT NULL DEFAULT 'off',
    thinking_budget INTEGER,
    effort TEXT,
    orchestration TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS autonomy_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT
  )`)
  ensureRunSupervisionSchema(database)
  ensureAgentPlansSchema(database)
}

function fakeEventStore() {
  const events: any[] = []
  return {
    events,
    append: vi.fn(async (e: any) => { events.push({ ...e, seq: events.length }); return events.length }),
    getByTypes: vi.fn(async (sessionId: string, types: string[]) =>
      events.filter((e) => e.sessionId === sessionId && types.includes(e.type))),
  }
}

/** Critic gateway answering a scripted verdict per call. */
function fakeCriticGateway(verdicts: string[]) {
  const complete = vi.fn(async () => {
    const text = verdicts.shift() ?? '{"verdict":"complete","reason":"default","missing":[]}'
    return { id: 'r', provider: 'p', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
  })
  return { complete, listProviders: vi.fn().mockReturnValue(['p']) } as any
}

/** Runner that writes one LlmResponse into the event store, then ends its loop. */
function fakeRunner(eventStore: ReturnType<typeof fakeEventStore>, opts: { events?: any[]; text?: string } = {}) {
  const calls: any[] = []
  const run = vi.fn((runOpts: any) => {
    calls.push(runOpts)
    return {
      async *[Symbol.asyncIterator]() {
        await eventStore.append({
          sessionId: runOpts.sessionId,
          type: 'LlmResponse',
          payload: { response: { content: opts.text ?? `answer for ${runOpts.sessionId}` } },
        })
        yield { type: 'turn_complete', tokensUsed: 3 }
        for (const e of opts.events ?? []) yield e
      },
    }
  })
  return { run, calls }
}

function runRow(id: string) {
  return (db.all(sql`SELECT status, verification, critic_rounds, parent_run_id FROM agent_sessions WHERE id = ${id}`) as any[])[0]
}

function lineage(): any[] {
  return db.all(sql`SELECT id, parent_run_id, verification, critic_rounds FROM agent_sessions ORDER BY started_at, rowid`) as any[]
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'send the quarterly report', ${now}, ${now})`)

  store = fakeEventStore()
  gateway = fakeCriticGateway(['{"verdict":"complete","reason":"report sent","missing":[]}'])

  let n = 0
  deps = {
    db,
    agentRunner: fakeRunner(store),
    agentRegistry: {
      get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['t'], maxTurns: 9, model: 'm' }),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([{ name: 't' }]) },
    supervisor: createRunSupervisor({ db }),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    generateId: () => `run-${++n}`,
    eventStore: store,
    getCheckpoint: () => ({ api: { list: vi.fn().mockResolvedValue([]) } }),
    critic: { enabled: true, maxRounds: 1, gateway, resolveTier: () => null },
  }
})

describe('completeness critic — verdicts on a finished run', () => {
  it("verdict 'complete' → verification='passed', no resume, CriticVerdict event appended", async () => {
    const result = await runConversation('conv-1', deps)

    expect(result.ran).toBe(true)
    const row = runRow('run-1')
    expect(row.status).toBe('completed')
    expect(row.verification).toBe('passed')
    expect(lineage()).toHaveLength(1)

    const verdictEvents = store.events.filter((e) => e.type === 'CriticVerdict')
    expect(verdictEvents).toHaveLength(1)
    expect(verdictEvents[0].sessionId).toBe('run-1')
    expect(verdictEvents[0].payload).toMatchObject({ verdict: 'complete', reason: 'report sent', missing: [], round: 0 })
  })

  it('judges the run against the goal and its OWN transcript', async () => {
    await runConversation('conv-1', deps)

    const user: string = gateway.complete.mock.calls[0][0].messages[0].content
    expect(user).toContain('send the quarterly report')
    expect(user).toContain('answer for run-1')
  })

  it("stamps {origin:'scheduled', conversationId, runId} on the critic call (Task 9 attribution)", async () => {
    await runConversation('conv-1', deps)

    expect(gateway.complete.mock.calls[0][0].metadata).toEqual({
      origin: 'scheduled', conversationId: 'conv-1', runId: 'run-1',
    })
  })

  it("verdict 'unavailable' (gateway throws) → verification='unverified', run completes, no resume", async () => {
    deps.critic.gateway = { complete: vi.fn().mockRejectedValue(new Error('down')), listProviders: () => ['p'] }

    await runConversation('conv-1', deps)

    const row = runRow('run-1')
    expect(row.status).toBe('completed')
    expect(row.verification).toBe('unverified')
    expect(lineage()).toHaveLength(1)
    expect(store.events.filter((e) => e.type === 'CriticVerdict')[0].payload.verdict).toBe('unavailable')
  })

  it("malformed critic JSON → verification='unverified'", async () => {
    deps.critic.gateway = fakeCriticGateway(['looks done to me'])

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBe('unverified')
  })

  it("no event store ⇒ no transcript to judge ⇒ verification='unverified', critic never called", async () => {
    deps.eventStore = undefined

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBe('unverified')
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it("an empty transcript ⇒ verification='unverified', critic never called", async () => {
    deps.agentRunner = { run: vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield { type: 'turn_complete', tokensUsed: 1 } } })) }

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBe('unverified')
    expect(gateway.complete).not.toHaveBeenCalled()
  })
})

describe('completeness critic — when it must NOT run', () => {
  it('a max_turns run is not critic\'d (it never claimed to be done)', async () => {
    deps.agentRunner = fakeRunner(store, { events: [{ type: 'max_turns_reached', turns: 9 }] })

    await runConversation('conv-1', deps)

    const row = runRow('run-1')
    expect(row.status).toBe('max_turns')
    expect(row.verification).toBeNull()
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('a tool_budget run is not critic\'d either', async () => {
    deps.agentRunner = fakeRunner(store, { events: [{ type: 'tool_budget_exhausted', totalCalls: 200, limit: 200 }] })

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBeNull()
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('a cancelled run is not critic\'d', async () => {
    deps.agentRunner = fakeRunner(store, { events: [{ type: 'cancelled' }] })

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBeNull()
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('a failed run (runner throws) is not critic\'d', async () => {
    deps.agentRunner = { run: vi.fn(() => { throw new Error('boom') }) }

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBeNull()
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('criticEnabled=false → no critic call and verification stays NULL', async () => {
    deps.critic.enabled = false

    await runConversation('conv-1', deps)

    const row = runRow('run-1')
    expect(row.status).toBe('completed')
    expect(row.verification).toBeNull()
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('no critic deps wired at all → verification stays NULL (unchanged behaviour)', async () => {
    deps.critic = undefined

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBeNull()
  })
})

describe('completeness critic — the feedback loop', () => {
  const INCOMPLETE = '{"verdict":"incomplete","reason":"the report was drafted but never sent","missing":["send the report to finance"]}'
  const COMPLETE = '{"verdict":"complete","reason":"sent","missing":[]}'

  it('incomplete under the cap → this run fails verification and ONE child run carries the feedback', async () => {
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE, COMPLETE])

    await runConversation('conv-1', deps)

    const parent = runRow('run-1')
    expect(parent.status).toBe('completed')       // the run itself finished
    expect(parent.verification).toBe('failed')    // …but it did not meet the goal
    expect(parent.critic_rounds).toBe(0)

    const child = runRow('run-2')
    expect(child.parent_run_id).toBe('run-1')     // lineage, not a board hand-off
    expect(child.critic_rounds).toBe(1)
    expect(child.verification).toBe('passed')     // the child's own verdict
    expect(lineage()).toHaveLength(2)
  })

  it("passes the reviewer feedback into the child's seeded messages", async () => {
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE, COMPLETE])

    await runConversation('conv-1', deps)

    const childCall = deps.agentRunner.run.mock.calls[1][0]
    const seeded = childCall.messages.map((m: any) => `${m.role}: ${m.content}`).join('\n')
    expect(seeded).toContain('send the quarterly report')           // the goal seed
    expect(seeded).toContain('the report was drafted but never sent') // the reason
    expect(seeded).toContain('send the report to finance')            // the missing item
    expect(childCall.messages.at(-1).role).toBe('user')
  })

  it('the cap is respected: a child that is ALSO incomplete does not spawn a grandchild', async () => {
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE, INCOMPLETE])

    await runConversation('conv-1', deps)

    const rows = lineage()
    expect(rows.map((r) => r.id)).toEqual(['run-1', 'run-2'])
    expect(runRow('run-2').verification).toBe('failed')
    expect(runRow('run-2').critic_rounds).toBe(1)
    // Two verdicts, no third round.
    expect(store.events.filter((e) => e.type === 'CriticVerdict')).toHaveLength(2)
  })

  it('records the round on each CriticVerdict event', async () => {
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE, INCOMPLETE])

    await runConversation('conv-1', deps)

    const verdicts = store.events.filter((e) => e.type === 'CriticVerdict')
    expect(verdicts.map((e) => [e.sessionId, e.payload.round])).toEqual([['run-1', 0], ['run-2', 1]])
  })

  it('maxRounds=0 → the verdict is recorded but no feedback resume is started', async () => {
    deps.critic.maxRounds = 0
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE])

    await runConversation('conv-1', deps)

    expect(runRow('run-1').verification).toBe('failed')
    expect(lineage()).toHaveLength(1)
  })

  it('never routes feedback through the board: the conversation ends idle, not waiting (S5)', async () => {
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE, COMPLETE])

    await runConversation('conv-1', deps)

    const conv = (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0]
    expect(conv.status).toBe('idle')
  })

  // Fix round 1 / Important 1 — a continuation run only does the REMAINING
  // work, so judging its own output against the WHOLE goal condemned the very
  // run that finished the job. A continuation is judged on the lineage's
  // combined transcript; a RESTART (retry re-plans from the goal) is not.
  describe('transcript scope — continuation vs restart', () => {
    /** Verdict depends on the transcript actually containing both halves of the job. */
    function transcriptSensitiveGateway() {
      const criticCalls: any[] = []
      const complete = vi.fn(async (req: any) => {
        criticCalls.push(req)
        const seen: string = req.messages[0].content
        const done = seen.includes('drafted the report') && seen.includes('sent it to finance')
        const text = done
          ? '{"verdict":"complete","reason":"drafted and sent","missing":[]}'
          : '{"verdict":"incomplete","reason":"not all of it happened","missing":["finish the job"]}'
        return { id: 'r', provider: 'p', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
      })
      return { complete, listProviders: vi.fn().mockReturnValue(['p']), criticCalls } as any
    }

    /** A finished parent run that produced `text`, ready to be resumed. */
    function seedParentRun(text: string): string {
      const h = deps.supervisor.beginRun({ sessionId: 'parent-1', conversationId: 'conv-1', agentId: 'agent-1', kind: 'background' })
      store.events.push({ sessionId: 'parent-1', type: 'LlmResponse', payload: { response: { content: text } }, seq: store.events.length })
      h.complete({ turns: 1 })
      return 'parent-1'
    }

    it('a continuation is judged on the lineage transcript — the run that FINISHES the job passes', async () => {
      const gw = transcriptSensitiveGateway()
      deps.critic.gateway = gw
      deps.agentRunner = fakeRunner(store, { text: 'sent it to finance' })
      const parent = seedParentRun('drafted the report')

      await resumeRun(parent, deps, { seedFromCheckpoint: true })

      const judged: string = gw.criticCalls[0].messages[0].content
      expect(judged).toContain('drafted the report')  // the parent's half…
      expect(judged).toContain('sent it to finance')  // …and this run's half
      expect(judged.indexOf('drafted the report')).toBeLessThan(judged.indexOf('sent it to finance'))
      expect(runRow('run-1').verification).toBe('passed')
    })

    it('a RESTART (retry) is judged on its own output only', async () => {
      const gw = transcriptSensitiveGateway()
      deps.critic.gateway = gw
      deps.agentRunner = fakeRunner(store, { text: 'sent it to finance' })
      const parent = seedParentRun('drafted the report')

      await resumeRun(parent, deps, { seedFromCheckpoint: false })

      const judged: string = gw.criticCalls[0].messages[0].content
      expect(judged).not.toContain('drafted the report')
      expect(judged).toContain('sent it to finance')
    })

    it('an approval-resume child (seedFromCheckpoint default) carries the parked parent transcript', async () => {
      const gw = transcriptSensitiveGateway()
      deps.critic.gateway = gw
      deps.agentRunner = fakeRunner(store, { text: 'sent it to finance' })
      const parent = seedParentRun('drafted the report')

      await resumeRun(parent, deps, { extraMessages: [{ role: 'user', content: 'approved' }] })

      expect(gw.criticCalls[0].messages[0].content).toContain('drafted the report')
    })

    it('a feedback child is judged with its parent\'s transcript (the mislabelling this fixes)', async () => {
      const gw = transcriptSensitiveGateway()
      deps.critic.gateway = gw
      // The first run only drafts; its feedback child sends it.
      let call = 0
      deps.agentRunner = {
        run: vi.fn((runOpts: any) => ({
          async *[Symbol.asyncIterator]() {
            const text = ++call === 1 ? 'drafted the report' : 'sent it to finance'
            await store.append({ sessionId: runOpts.sessionId, type: 'LlmResponse', payload: { response: { content: text } } })
            yield { type: 'turn_complete', tokensUsed: 1 }
          },
        })),
      }

      await runConversation('conv-1', deps)

      expect(runRow('run-1').verification).toBe('failed')  // it really was incomplete
      expect(runRow('run-2').verification).toBe('passed')  // …and the child finished it
    })
  })

  it('a resume that cannot start leaves the parent finalized and failed (no crash)', async () => {
    deps.critic.gateway = fakeCriticGateway([INCOMPLETE, COMPLETE])
    deps.eventStore = { ...store, getByTypes: store.getByTypes, append: store.append }
    // resumeRun refuses without an event store; simulate the refusal by making
    // the agent unavailable for the second run.
    let calls = 0
    deps.agentRegistry.get = vi.fn(() => (++calls > 1 ? null : { id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['t'], maxTurns: 9, model: 'm' }))

    const result = await runConversation('conv-1', deps)

    expect(result.ran).toBe(true)
    expect(runRow('run-1').verification).toBe('failed')
    expect(lineage()).toHaveLength(1)
    expect(deps.logger.warn).toHaveBeenCalled()
  })
})
