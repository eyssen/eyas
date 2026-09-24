// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { maybePlanTask } from '@modules/agent/planning-runner'

/** A plan completion double that answers one canned text (or an error answer). */
function makeComplete(responseText: string, error?: string) {
  return vi.fn(async (_prompt: { system: string; user: string }) => (error ? { error } : { text: responseText }))
}

const VALID_PLAN_JSON = JSON.stringify({
  goal: 'migrate the production database',
  steps: [
    { title: 'Inventory schema', description: '', successCriteria: 'written list exists', dependsOn: [] },
    { title: 'Dry-run migration', description: '', successCriteria: 'no rollback needed', dependsOn: ['Inventory schema'] },
  ],
  risks: [{ description: 'downtime', severity: 'high', mitigation: 'blue/green' }],
  rollback: 'revert migration and swap back',
})

const SIMPLE_REQUEST = 'hi'
// Long enough + multi-component + risk indicators → high complexity score.
const COMPLEX_REQUEST =
  'Please migrate the production database for our customer accounts. ' +
  'The plan must cover backend, frontend, tests, and deploy. '.repeat(6)

describe('maybePlanTask', () => {
  it('skips planning for trivial requests (below threshold)', async () => {
    const complete = makeComplete('') // never called
    const decision = await maybePlanTask(SIMPLE_REQUEST, { complete })
    expect(decision.kind).toBe('skipped')
    expect(complete).not.toHaveBeenCalled()
  })

  it('generates a plan and returns approved when the reviewer returns true', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    const onPlanApproval = vi.fn().mockResolvedValue(true)

    const decision = await maybePlanTask(COMPLEX_REQUEST, { complete, onPlanApproval })

    expect(decision.kind).toBe('approved')
    if (decision.kind === 'approved') {
      expect(decision.plan.goal).toBe('migrate the production database')
      expect(decision.plan.steps).toHaveLength(2)
    }
    expect(onPlanApproval).toHaveBeenCalledTimes(1)
  })

  it('rejects when the reviewer returns false', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    const onPlanApproval = vi.fn().mockResolvedValue(false)

    const decision = await maybePlanTask(COMPLEX_REQUEST, { complete, onPlanApproval })

    expect(decision.kind).toBe('rejected')
    if (decision.kind === 'rejected') {
      expect(decision.reason).toBe('reviewer rejected the plan')
      expect(decision.plan).toBeDefined()
    }
  })

  it('skips when the reviewer explicitly says `skip`', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    const onPlanApproval = vi.fn().mockResolvedValue('skip')

    const decision = await maybePlanTask(COMPLEX_REQUEST, { complete, onPlanApproval })

    expect(decision.kind).toBe('skipped')
  })

  it('fails-closed when planning is triggered but no onPlanApproval is wired', async () => {
    // Absent callback → reject the task rather than silently running an
    // unreviewed plan. Mirrors the 3F fail-closed policy.
    const complete = makeComplete(VALID_PLAN_JSON)
    const decision = await maybePlanTask(COMPLEX_REQUEST, { complete })
    expect(decision.kind).toBe('rejected')
    if (decision.kind === 'rejected') {
      expect(decision.reason).toContain('no onPlanApproval handler')
    }
  })

  it('reports failure when the generator cannot produce valid JSON', async () => {
    const complete = makeComplete('not valid json at all')
    const decision = await maybePlanTask(COMPLEX_REQUEST, {
      complete,
      maxGenerationAttempts: 2,
      onPlanApproval: vi.fn(),
    })
    expect(decision.kind).toBe('failed')
  })

  it("reports failure (no retry, reviewer never asked) when the completion has no model", async () => {
    const complete = makeComplete('', 'no eligible background model (no_eligible_provider)')
    const onPlanApproval = vi.fn()

    const decision = await maybePlanTask(COMPLEX_REQUEST, { complete, onPlanApproval, maxGenerationAttempts: 3 })

    expect(decision.kind).toBe('failed')
    if (decision.kind === 'failed') expect(decision.reason).toContain('no eligible background model')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(onPlanApproval).not.toHaveBeenCalled()
  })

  it('treats a callback exception as a denial', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    const onPlanApproval = vi.fn().mockRejectedValue(new Error('reviewer died'))

    const decision = await maybePlanTask(COMPLEX_REQUEST, { complete, onPlanApproval })

    expect(decision.kind).toBe('rejected')
    if (decision.kind === 'rejected') {
      expect(decision.reason).toContain('approval handler threw')
      expect(decision.reason).toContain('reviewer died')
    }
  })

  it('respects a custom threshold that upgrades a borderline request', async () => {
    const complete = makeComplete(VALID_PLAN_JSON)
    const onPlanApproval = vi.fn().mockResolvedValue(true)

    // Very low threshold forces even moderate requests to plan.
    const decision = await maybePlanTask(
      'please migrate the data and tests',
      { complete, onPlanApproval, threshold: 0.1 },
    )
    expect(decision.kind).toBe('approved')
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
