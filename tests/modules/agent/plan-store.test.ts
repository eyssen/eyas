// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T7 (D8) — plan-as-rubric persistence. The plan a complex background run
// generates has to outlive the run itself: the critic judges the transcript
// against its steps' successCriteria, and a feedback resume must REUSE it
// rather than pay for a second generation.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import {
  ensureAgentPlansSchema,
  savePlan,
  latestPlanForConversation,
  buildPlanRubricSection,
  planStepsForCritic,
  goalHash,
} from '@modules/agent/plan-store'
import type { Plan } from '@modules/agent/planning'
import { createMemoryDb } from '../../helpers/test-db'

let db: any

const GOAL = 'migrate the billing module to v2'

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    originalRequest: 'migrate billing',
    goal: 'migrate the billing module to v2',
    steps: [
      { id: 'step-1', title: 'Write the migration', description: '', dependsOn: [], consumes: [], produces: [], successCriteria: 'migration runs clean', status: 'pending' },
      { id: 'step-2', title: 'Backfill tenants', description: '', dependsOn: [], consumes: [], produces: [], successCriteria: 'no NULL tenant rows', status: 'pending' },
    ],
    risks: [],
    rollback: '',
    status: 'approved',
    createdAt: Date.now(),
    ...overrides,
  } as Plan
}

beforeEach(() => {
  db = createMemoryDb()
  ensureAgentPlansSchema(db)
})

describe('agent_plans store', () => {
  it('is idempotent DDL — a second call is a no-op', () => {
    expect(() => ensureAgentPlansSchema(db)).not.toThrow()
    const cols = (db.all(sql`PRAGMA table_info(agent_plans)`) as any[]).map((c) => String(c.name))
    expect(cols.sort()).toEqual(['conversation_id', 'created_at', 'goal_hash', 'id', 'plan_json', 'run_id'])
  })

  it('persists a plan and reads it back for the conversation', () => {
    const plan = makePlan()
    const id = savePlan(db, { runId: 'run-1', conversationId: 'conv-1', plan, goal: GOAL })

    expect(id).toBeTruthy()
    const loaded = latestPlanForConversation(db, 'conv-1', GOAL)
    expect(loaded?.runId).toBe('run-1')
    expect(loaded?.plan.goal).toBe('migrate the billing module to v2')
    expect(loaded?.plan.steps).toHaveLength(2)
  })

  it('returns null for a conversation with no plan', () => {
    expect(latestPlanForConversation(db, 'conv-none', GOAL)).toBeNull()
  })

  it('returns the LATEST plan when a conversation has several', () => {
    savePlan(db, { runId: 'run-1', conversationId: 'conv-1', plan: makePlan({ id: 'plan-old', goal: 'old goal' }), goal: GOAL, createdAt: '2026-01-01T00:00:00.000Z' })
    savePlan(db, { runId: 'run-2', conversationId: 'conv-1', plan: makePlan({ id: 'plan-new', goal: 'new goal' }), goal: GOAL, createdAt: '2026-02-01T00:00:00.000Z' })

    expect(latestPlanForConversation(db, 'conv-1', GOAL)?.plan.goal).toBe('new goal')
  })

  // Fix round 1 / Important 2 — goal_description is editable, so a plan keyed
  // on the conversation alone would instruct a re-armed card toward the OLD
  // goal and then fail it against a rubric it was never given.
  describe('goal-keyed reuse', () => {
    it('refuses a plan whose goal no longer matches the run\'s goal', () => {
      savePlan(db, { runId: 'run-1', conversationId: 'conv-1', plan: makePlan(), goal: GOAL })

      expect(latestPlanForConversation(db, 'conv-1', GOAL)).not.toBeNull()
      expect(latestPlanForConversation(db, 'conv-1', 'a completely different goal')).toBeNull()
    })

    it('is whitespace-insensitive but not content-insensitive', () => {
      savePlan(db, { runId: 'run-1', conversationId: 'conv-1', plan: makePlan(), goal: GOAL })

      expect(latestPlanForConversation(db, 'conv-1', `  ${GOAL}\n`)).not.toBeNull()
      expect(latestPlanForConversation(db, 'conv-1', `${GOAL} and also archive v1`)).toBeNull()
    })

    it('treats a row with no recorded goal as unusable (pre-fix rows)', () => {
      db.run(sql`INSERT INTO agent_plans (id, run_id, conversation_id, plan_json, goal_hash, created_at)
        VALUES ('p-old', 'run-0', 'conv-1', ${JSON.stringify(makePlan())}, NULL, '2026-01-01T00:00:00.000Z')`)

      expect(latestPlanForConversation(db, 'conv-1', GOAL)).toBeNull()
    })
  })

  it('survives a missing table instead of breaking the run (fail-open reads/writes)', () => {
    const bare = createMemoryDb()
    expect(savePlan(bare, { runId: 'r', conversationId: 'c', plan: makePlan(), goal: GOAL })).toBeNull()
    expect(latestPlanForConversation(bare, 'c', GOAL)).toBeNull()
  })

  it('treats an unparseable plan_json row as no plan', () => {
    db.run(sql`INSERT INTO agent_plans (id, run_id, conversation_id, plan_json, goal_hash, created_at)
      VALUES ('p-bad', 'run-1', 'conv-1', 'not json', ${goalHash(GOAL)}, '2026-01-01T00:00:00.000Z')`)

    expect(latestPlanForConversation(db, 'conv-1', GOAL)).toBeNull()
  })
})

describe('plan → rubric projections', () => {
  it('projects step titles + successCriteria for the critic', () => {
    expect(planStepsForCritic(makePlan())).toEqual([
      { title: 'Write the migration', successCriteria: 'migration runs clean' },
      { title: 'Backfill tenants', successCriteria: 'no NULL tenant rows' },
    ])
  })

  it('builds a reinjection section carrying the titles and criteria', () => {
    const section = buildPlanRubricSection(makePlan())

    expect(section).toContain('Write the migration')
    expect(section).toContain('no NULL tenant rows')
    // It has to read as a rubric the run is measured against, not as new work.
    expect(section.toLowerCase()).toContain('plan')
  })

  it('returns an empty section for a plan with no steps', () => {
    expect(buildPlanRubricSection(makePlan({ steps: [] }))).toBe('')
  })
})
