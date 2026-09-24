// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import {
  PlanSchema,
  detectComplexity,
  generatePlan,
  approvePlan,
  rejectPlan,
  markPlanInProgress,
  markStepStatus,
  type Plan,
} from '@modules/agent/planning'

describe('detectComplexity', () => {
  it('scores below threshold for a short trivial question', () => {
    const r = detectComplexity('What is 2+2?')
    expect(r.score).toBeLessThan(0.5)
    expect(r.recommendsPlan).toBe(false)
  })

  it('recommends a plan when several planning signals are present', () => {
    const r = detectComplexity(
      'Please refactor the backend API and migrate the production database for our customer accounts. ' +
        'The plan should cover the frontend and include tests.',
    )
    expect(r.score).toBeGreaterThanOrEqual(0.5)
    expect(r.recommendsPlan).toBe(true)
    expect(r.reasons.length).toBeGreaterThan(1)
  })

  it('custom threshold changes the decision without changing the score', () => {
    const r1 = detectComplexity('please migrate the database', { threshold: 0.9 })
    const r2 = detectComplexity('please migrate the database', { threshold: 0.1 })
    expect(r1.score).toBeCloseTo(r2.score)
    expect(r1.recommendsPlan).toBe(false)
    expect(r2.recommendsPlan).toBe(true)
  })

  it('enumerated lists count as a planning signal', () => {
    const msg = 'Please do the following:\n1. thing one\n2. thing two\n3. thing three'
    const r = detectComplexity(msg)
    expect(r.reasons).toContain('enumerated items in request')
  })
})

/**
 * A scripted plan completion: each call takes the next answer (text, an
 * `{error}` answer, or an Error to throw); the last one repeats.
 */
function makeComplete(...answers: Array<string | { error: string } | Error>) {
  return vi.fn(async (_prompt: { system: string; user: string }) => {
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    if (next instanceof Error) throw next
    return typeof next === 'string' ? { text: next } : next
  })
}

const VALID_PLAN_JSON = JSON.stringify({
  goal: 'refactor the API',
  steps: [
    { title: 'Inventory endpoints', description: '', successCriteria: 'list written', dependsOn: [] },
    { title: 'Rewrite handler 1', description: '', successCriteria: 'tests pass', dependsOn: ['Inventory endpoints'] },
  ],
  risks: [{ description: 'breaking clients', severity: 'high', mitigation: 'version bump' }],
  rollback: 'revert the PR',
})

describe('generatePlan', () => {
  it('returns a parsed and schema-validated plan on a clean response', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    const result = await generatePlan({ originalRequest: 'refactor the API' }, { complete })
    expect(result.plan).toBeDefined()
    expect(result.error).toBeUndefined()
    const plan = result.plan!
    expect(plan.goal).toBe('refactor the API')
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0].id).toBe('step-1')
    expect(plan.status).toBe('pending_approval')
    expect(PlanSchema.safeParse(plan).success).toBe(true)
  })

  it('sends the plan instructions as the system prompt and the task as the user message', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    await generatePlan({ originalRequest: 'refactor the API', additionalContext: 'monorepo' }, { complete })
    expect(complete).toHaveBeenCalledTimes(1)
    const prompt = complete.mock.calls[0][0]
    expect(prompt.system).toContain('planning agent')
    expect(prompt.system).not.toContain('refactor the API')
    expect(prompt.user).toContain('Task:\nrefactor the API')
    expect(prompt.user).toContain('Context:\nmonorepo')
  })

  it('strips json code fences before parsing', async () => {
    const fenced = '```json\n' + VALID_PLAN_JSON + '\n```'
    const result = await generatePlan({ originalRequest: 'refactor' }, { complete: makeComplete(fenced) })
    expect(result.plan).toBeDefined()
    expect(result.plan!.goal).toBe('refactor the API')
  })

  it('recovers when the model prepends a sentence before the JSON', async () => {
    const noisy = 'Sure, here is your plan:\n' + VALID_PLAN_JSON
    const result = await generatePlan({ originalRequest: 'x' }, { complete: makeComplete(noisy) })
    expect(result.plan).toBeDefined()
  })

  it('retries up to maxAttempts on malformed JSON and reports the final failure', async () => {
    const complete = makeComplete('this is not JSON at all')
    const result = await generatePlan({ originalRequest: 'x' }, { complete, maxAttempts: 3 })
    expect(result.plan).toBeUndefined()
    expect(result.error).toBeDefined()
    expect(result.error!.attempts).toBe(3)
    expect(complete).toHaveBeenCalledTimes(3)
  })

  it('a malformed first answer is retried and a valid second one wins', async () => {
    const complete = makeComplete('not json', VALID_PLAN_JSON)
    const result = await generatePlan({ originalRequest: 'x' }, { complete, maxAttempts: 2 })
    expect(result.plan).toBeDefined()
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('an object without steps is invalid output (retried), never a crash', async () => {
    const complete = makeComplete(JSON.stringify({ goal: 'g', risks: 'none' }))
    const result = await generatePlan({ originalRequest: 'x' }, { complete, maxAttempts: 2 })
    expect(result.plan).toBeUndefined()
    expect(result.error!.lastMessage).toMatch(/schema validation/i)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('an error answer from the completion ends generation at once with {error}', async () => {
    const complete = makeComplete({ error: 'no eligible background model (no_eligible_provider)' })
    const result = await generatePlan({ originalRequest: 'x' }, { complete, maxAttempts: 3 })
    expect(result.plan).toBeUndefined()
    expect(result.error).toEqual({ attempts: 1, lastMessage: 'no eligible background model (no_eligible_provider)' })
    // No second ask: the same completion would answer the same way.
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('a completion that throws is surfaced as a failure without throwing', async () => {
    const complete = makeComplete(new Error('provider offline'))
    const result = await generatePlan({ originalRequest: 'x' }, { complete, maxAttempts: 2 })
    expect(result.plan).toBeUndefined()
    expect(result.error!.lastMessage).toContain('provider offline')
  })

  it('fails schema validation if the model omits required fields', async () => {
    const bad = JSON.stringify({
      steps: [{ title: 'step one', successCriteria: 'ok' }],
      risks: [],
      rollback: '',
    })
    const result = await generatePlan({ originalRequest: 'x' }, { complete: makeComplete(bad), maxAttempts: 1 })
    expect(result.plan).toBeUndefined()
    expect(result.error!.lastMessage).toMatch(/schema validation|goal/i)
  })
})

function freshPlan(): Plan {
  return {
    id: 'plan-1',
    originalRequest: 'do the thing',
    goal: 'do the thing',
    steps: [
      {
        id: 'step-1',
        title: 's1',
        description: '',
        dependsOn: [],
        consumes: [],
        produces: [],
        successCriteria: '',
        status: 'pending',
      },
    ],
    risks: [],
    rollback: '',
    status: 'pending_approval',
    createdAt: Date.now(),
  }
}

describe('approval transitions', () => {
  it('approvePlan transitions pending_approval -> approved and stamps approvedBy', () => {
    const p = freshPlan()
    const approved = approvePlan(p, 'alice')
    expect(approved.status).toBe('approved')
    expect(approved.approvedBy).toBe('alice')
    expect(approved.approvedAt).toBeGreaterThan(0)
    // Original untouched — immutability contract
    expect(p.status).toBe('pending_approval')
  })

  it('rejectPlan transitions pending_approval -> rejected with reason', () => {
    const p = freshPlan()
    const rejected = rejectPlan(p, 'out of scope')
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedReason).toBe('out of scope')
  })

  it('approving an already-approved plan throws', () => {
    const approved = approvePlan(freshPlan(), 'alice')
    expect(() => approvePlan(approved, 'bob')).toThrow(/cannot approve/)
  })

  it('rejecting an already-rejected plan throws', () => {
    const rejected = rejectPlan(freshPlan(), 'nope')
    expect(() => rejectPlan(rejected, 'again')).toThrow(/cannot reject/)
  })

  it('markPlanInProgress requires the plan to be approved first', () => {
    const pending = freshPlan()
    expect(() => markPlanInProgress(pending)).toThrow(/must be approved first/)
    const approved = approvePlan(pending, 'alice')
    const started = markPlanInProgress(approved)
    expect(started.status).toBe('in_progress')
  })

  it('markStepStatus updates the named step without touching siblings', () => {
    const p = {
      ...freshPlan(),
      steps: [
        { ...freshPlan().steps[0], id: 'step-1', status: 'pending' as const },
        { ...freshPlan().steps[0], id: 'step-2', status: 'pending' as const },
      ],
    }
    const next = markStepStatus(p, 'step-1', 'done')
    expect(next.steps[0].status).toBe('done')
    expect(next.steps[1].status).toBe('pending')
  })

  it('markStepStatus throws for unknown step ids', () => {
    expect(() => markStepStatus(freshPlan(), 'step-99', 'done')).toThrow(/not found/)
  })
})
