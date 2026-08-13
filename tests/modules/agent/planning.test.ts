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
import type { ModelGateway, ModelResponse } from '@modules/model/types'

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

function makeGateway(textContent: string, throws?: Error): ModelGateway {
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    listProviders: vi.fn().mockReturnValue([]),
    listAllModels: vi.fn().mockReturnValue([]),
    embed: vi.fn(),
    stream: vi.fn(async function* () {}) as any,
    complete: vi.fn(async (): Promise<ModelResponse> => {
      if (throws) throw throws
      return {
        id: 'r',
        provider: 'mock',
        model: 'mock',
        content: [{ type: 'text', text: textContent }],
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0 },
      }
    }),
  } as unknown as ModelGateway
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
    const gw = makeGateway(VALID_PLAN_JSON)
    const result = await generatePlan(
      { originalRequest: 'refactor the API' },
      { gateway: gw },
    )
    expect(result.plan).toBeDefined()
    expect(result.error).toBeUndefined()
    const plan = result.plan!
    expect(plan.goal).toBe('refactor the API')
    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0].id).toBe('step-1')
    expect(plan.status).toBe('pending_approval')
    expect(PlanSchema.safeParse(plan).success).toBe(true)
  })

  it('strips json code fences before parsing', async () => {
    const fenced = '```json\n' + VALID_PLAN_JSON + '\n```'
    const gw = makeGateway(fenced)
    const result = await generatePlan({ originalRequest: 'refactor' }, { gateway: gw })
    expect(result.plan).toBeDefined()
    expect(result.plan!.goal).toBe('refactor the API')
  })

  it('recovers when the model prepends a sentence before the JSON', async () => {
    const noisy = 'Sure, here is your plan:\n' + VALID_PLAN_JSON
    const gw = makeGateway(noisy)
    const result = await generatePlan({ originalRequest: 'x' }, { gateway: gw })
    expect(result.plan).toBeDefined()
  })

  it('retries up to maxAttempts on malformed JSON and reports the final failure', async () => {
    const gw = makeGateway('this is not JSON at all')
    const result = await generatePlan(
      { originalRequest: 'x' },
      { gateway: gw, maxAttempts: 3 },
    )
    expect(result.plan).toBeUndefined()
    expect(result.error).toBeDefined()
    expect(result.error!.attempts).toBe(3)
    expect((gw.complete as any).mock.calls.length).toBe(3)
  })

  it('surfaces gateway errors as a failure without throwing', async () => {
    const gw = makeGateway('', new Error('provider offline'))
    const result = await generatePlan({ originalRequest: 'x' }, { gateway: gw, maxAttempts: 2 })
    expect(result.plan).toBeUndefined()
    expect(result.error!.lastMessage).toContain('provider offline')
  })

  it('fails schema validation if the model omits required fields', async () => {
    const bad = JSON.stringify({
      steps: [{ title: 'step one', successCriteria: 'ok' }],
      risks: [],
      rollback: '',
    })
    const gw = makeGateway(bad)
    const result = await generatePlan({ originalRequest: 'x' }, { gateway: gw, maxAttempts: 1 })
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
