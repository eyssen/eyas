// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import type { Plan } from '@modules/agent/planning'
import {
  parkPlan,
  peekPlan,
  takePlan,
  dropPlan,
  planToSystemSection,
  resetPlanGateForTests,
} from '@modules/conversations/plan-gate'

function samplePlan(): Plan {
  return {
    id: 'plan-1',
    originalRequest: 'refactor the alpha module',
    goal: 'Refactor alpha without breaking bravo',
    steps: [
      {
        id: 'step-1',
        title: 'Read alpha',
        description: '',
        dependsOn: [],
        consumes: [],
        produces: [],
        successCriteria: 'alpha source is in context',
        status: 'pending',
      },
    ],
    risks: [],
    rollback: 'git checkout -- src/alpha.ts',
    status: 'pending_approval',
    createdAt: 1,
  }
}

describe('plan gate', () => {
  beforeEach(() => {
    resetPlanGateForTests()
  })

  it('parks a plan until it is taken', () => {
    parkPlan('c1', samplePlan())
    expect(peekPlan('c1')?.goal).toBe('Refactor alpha without breaking bravo')
    const taken = takePlan('c1')
    expect(taken?.id).toBe('plan-1')
    expect(peekPlan('c1')).toBeNull()
  })

  it('dropPlan discards without returning it', () => {
    parkPlan('c1', samplePlan())
    dropPlan('c1')
    expect(takePlan('c1')).toBeNull()
  })

  it('planToSystemSection reuses the rubric shape so the model can follow it', () => {
    const section = planToSystemSection(samplePlan())
    expect(section).toContain('Read alpha')
    expect(section).toContain('Done when:')
    expect(section).toContain('alpha source is in context')
  })
})
