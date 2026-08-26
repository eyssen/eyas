// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T7 (D8) — plan-as-rubric, end to end through runConversation. A complex
// background goal gets a written plan whose steps are BOTH the agent's
// checklist (reinjected into its prompt) and the critic's rubric — and the
// whole pass is fail-open: no plan must never mean no run.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { runConversation } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createMemoryDb } from '../../helpers/test-db'

const COMPLEX_GOAL = 'Migrate the billing module to the new database schema in production, covering the backend api, the frontend and the tests.'
const SIMPLE_GOAL = 'say hello'

const PLAN_JSON = JSON.stringify({
  goal: 'migrate billing',
  steps: [
    { title: 'Write the migration', description: 'ddl', successCriteria: 'migration runs clean on a copy', dependsOn: [] },
    { title: 'Backfill tenants', description: 'data', successCriteria: 'zero rows with a NULL tenant', dependsOn: [] },
  ],
  risks: [],
  rollback: 'restore the snapshot',
})
const COMPLETE = '{"verdict":"complete","reason":"done","missing":[]}'
const INCOMPLETE = '{"verdict":"incomplete","reason":"backfill never ran","missing":["backfill tenants"]}'

let db: any
let deps: any
let store: any
let gateway: any

function createTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
    team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
    orchestration TEXT, working_directories TEXT, tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  database.run(sql`CREATE TABLE IF NOT EXISTS autonomy_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT)`)
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

/**
 * One gateway serving both model passes this feature makes — the planner and
 * the critic — routed by the system prompt, the way the real gateway sees them.
 */
function fakeGateway(opts: { plan?: string; verdicts?: string[] } = {}) {
  const planCalls: any[] = []
  const criticCalls: any[] = []
  const verdicts = [...(opts.verdicts ?? [])]
  const complete = vi.fn(async (req: any) => {
    const isPlan = String(req.system ?? '').includes('planning agent')
    ;(isPlan ? planCalls : criticCalls).push(req)
    const text = isPlan ? (opts.plan ?? PLAN_JSON) : (verdicts.shift() ?? COMPLETE)
    return { id: 'r', provider: 'p', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
  })
  return { complete, listProviders: vi.fn().mockReturnValue(['p']), planCalls, criticCalls } as any
}

function fakeRunner(eventStore: any) {
  const run = vi.fn((runOpts: any) => ({
    async *[Symbol.asyncIterator]() {
      await eventStore.append({ sessionId: runOpts.sessionId, type: 'LlmResponse', payload: { response: { content: `worked on ${runOpts.sessionId}` } } })
      yield { type: 'turn_complete', tokensUsed: 3 }
    },
  }))
  return { run }
}

function setGoal(goal: string) {
  db.run(sql`UPDATE conversations SET goal_description = ${goal} WHERE id = 'conv-1'`)
}

function plans(): any[] {
  return db.all(sql`SELECT id, run_id, conversation_id, plan_json FROM agent_plans`) as any[]
}

beforeEach(() => {
  db = createMemoryDb()
  createTables(db)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
    VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', ${COMPLEX_GOAL}, ${now}, ${now})`)

  store = fakeEventStore()
  gateway = fakeGateway()

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

describe('plan-as-rubric', () => {
  it('persists a plan for a complex goal and injects its steps into the run', async () => {
    await runConversation('conv-1', deps)

    const rows = plans()
    expect(rows).toHaveLength(1)
    expect(rows[0].run_id).toBe('run-1')
    expect(rows[0].conversation_id).toBe('conv-1')
    expect(JSON.parse(rows[0].plan_json).steps).toHaveLength(2)

    const reinjection: string = deps.agentRunner.run.mock.calls[0][0].reinjection
    expect(reinjection).toContain('Write the migration')
    expect(reinjection).toContain('zero rows with a NULL tenant')
  })

  it('hands the plan steps to the critic as its rubric', async () => {
    await runConversation('conv-1', deps)

    const criticUser: string = gateway.criticCalls[0].messages[0].content
    expect(criticUser).toContain('Write the migration')
    expect(criticUser).toContain('migration runs clean on a copy')
  })

  it('resolves the planner model through the quick tier when one is configured', async () => {
    deps.critic.resolveTier = vi.fn((tier: string) => (tier === 'quick' ? { provider: 'pq', model: 'mq' } : null))

    await runConversation('conv-1', deps)

    expect(gateway.planCalls[0].provider).toBe('pq')
    expect(gateway.planCalls[0].model).toBe('mq')
  })

  it('skips planning entirely for a simple goal (no model call, no row)', async () => {
    setGoal(SIMPLE_GOAL)

    await runConversation('conv-1', deps)

    expect(gateway.planCalls).toHaveLength(0)
    expect(plans()).toHaveLength(0)
    expect(deps.agentRunner.run.mock.calls[0][0].reinjection).toBeUndefined()
  })

  it('skips planning when the critic is disabled (a rubric nobody judges is just cost)', async () => {
    deps.critic.enabled = false

    await runConversation('conv-1', deps)

    expect(gateway.planCalls).toHaveLength(0)
    expect(plans()).toHaveLength(0)
  })

  describe('fail-open', () => {
    it('an unparseable plan response → the run proceeds with no rubric', async () => {
      deps.critic.gateway = fakeGateway({ plan: 'sorry, I cannot plan that' })

      const result = await runConversation('conv-1', deps)

      expect(result.ran).toBe(true)
      expect(plans()).toHaveLength(0)
      expect(deps.agentRunner.run.mock.calls[0][0].reinjection).toBeUndefined()
      expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('plan generation failed'))
      // …and the run is still verified, just without a rubric.
      const row = (db.all(sql`SELECT verification FROM agent_sessions WHERE id = 'run-1'`) as any[])[0]
      expect(row.verification).toBe('passed')
    })

    it('a gateway that throws during planning → the run proceeds', async () => {
      const throwing = fakeGateway()
      throwing.complete = vi.fn(async (req: any) => {
        if (String(req.system ?? '').includes('planning agent')) throw new Error('planner down')
        return { id: 'r', provider: 'p', model: 'm', content: [{ type: 'text', text: COMPLETE }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
      })
      deps.critic.gateway = throwing

      const result = await runConversation('conv-1', deps)

      expect(result.ran).toBe(true)
      expect(plans()).toHaveLength(0)
    })
  })

  // Fix round 1 / Important 2 — the goal is editable between runs. A plan keyed
  // on the conversation alone would hand a re-armed card the OLD rubric and
  // then judge it against the old criteria.
  describe('goal-keyed reuse', () => {
    it('re-uses the plan when the goal is unchanged (no second generation)', async () => {
      await runConversation('conv-1', deps)
      await runConversation('conv-1', deps)

      expect(gateway.planCalls).toHaveLength(1)
      expect(plans()).toHaveLength(1)
    })

    it('generates a FRESH plan when the goal was edited between runs', async () => {
      await runConversation('conv-1', deps)
      setGoal(`${COMPLEX_GOAL} Also archive the legacy tables in production.`)

      await runConversation('conv-1', deps)

      expect(gateway.planCalls).toHaveLength(2)
      expect(plans()).toHaveLength(2)
      // The second run is instructed by the plan generated for the NEW goal.
      expect(gateway.planCalls[1].messages[0].content).toContain('archive the legacy tables')
    })

    it('an edited goal that is no longer complex simply runs without a rubric', async () => {
      await runConversation('conv-1', deps)
      setGoal(SIMPLE_GOAL)

      await runConversation('conv-1', deps)

      expect(gateway.planCalls).toHaveLength(1)                                  // no regeneration
      expect(deps.agentRunner.run.mock.calls[1][0].reinjection).toBeUndefined()  // and no stale rubric
    })
  })

  describe('feedback resume', () => {
    it('reuses the parent plan instead of regenerating it, and still injects the rubric', async () => {
      deps.critic.gateway = fakeGateway({ verdicts: [INCOMPLETE, COMPLETE] })

      await runConversation('conv-1', deps)

      // Two runs in the lineage, but exactly ONE plan generation + ONE plan row.
      expect(deps.agentRunner.run).toHaveBeenCalledTimes(2)
      expect(deps.critic.gateway.planCalls).toHaveLength(1)
      expect(plans()).toHaveLength(1)

      const childReinjection: string = deps.agentRunner.run.mock.calls[1][0].reinjection
      expect(childReinjection).toContain('Write the migration')
      // The resume's do-not-repeat recap rides the SAME channel, not a new one.
      expect(childReinjection).toContain('Resumed run — task state')
    })

    it("the child's critic is handed the same rubric", async () => {
      deps.critic.gateway = fakeGateway({ verdicts: [INCOMPLETE, COMPLETE] })

      await runConversation('conv-1', deps)

      const childCriticUser: string = deps.critic.gateway.criticCalls[1].messages[0].content
      expect(childCriticUser).toContain('zero rows with a NULL tenant')
    })
  })
})
