// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The re-planner runs through the background model service (purpose
// 're_planner'): one isolated, tool-less call on the planning tiers, never a
// gateway-chosen provider. No eligible model keeps the current plan.

import { describe, it, expect } from 'vitest'
import { createRePlanner } from '@modules/agent/re-planner'
import type { TierConfig } from '@modules/model/routing/types'
import {
  auxEmpty,
  auxError,
  auxNone,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model'

const PHASE = {
  phaseName: 'build',
  agentResults: [{ agentId: 'dev', conversationId: 'c-dev', status: 'completed' as const, summary: 'built it', tokensUsed: 10, costUsd: 0 }],
}
const REMAINING = [{ id: 't2', title: 'Test it', agentId: 'qa', phase: 'verify', status: 'pending' as const }]

function quickTier(providerId = 'fake-api', modelId = 'fake-model'): TierConfig {
  return { tier: 'quick', providerId, modelId, fallbackProviderId: null, fallbackModelId: null, description: '', enabled: true, updatedAt: '' }
}

describe('re-planner', () => {
  it("asks the service with purpose 're_planner' and applies the returned JSON", async () => {
    const aux = createFakeAuxiliaryModel(auxOk('```json\n' + JSON.stringify({
      tasksAdded: [{ id: 'new-1', title: 'Fix the flaky test', agentId: 'qa', phase: 'verify' }],
      tasksRemoved: ['t2'],
      tasksModified: [],
      reasoning: 'the build changed the test surface',
      shouldContinue: true,
    }) + '\n```'))
    const replanner = createRePlanner(() => aux)

    const result = await replanner.replan('ship the feature', PHASE, REMAINING, { conversationId: 'parent-1' })

    expect(aux.calls).toHaveLength(1)
    const req = aux.calls[0]
    expect(req.purpose).toBe('re_planner')
    expect(req.system).toContain('You are a project planner')
    expect(req.user).toContain('ship the feature')
    expect(req.user).toContain('[t2] Test it')
    expect(req.temperature).toBe(0.2)
    expect(req.conversationId).toBe('parent-1')
    expect(result.tasksAdded).toEqual([{ id: 'new-1', title: 'Fix the flaky test', agentId: 'qa', phase: 'verify', status: 'pending' }])
    expect(result.tasksRemoved).toEqual(['t2'])
    expect(result.reasoning).toBe('the build changed the test surface')
    expect(result.shouldContinue).toBe(true)
  })

  it('reaches the gateway as one isolated call with the instruction in system and no tier', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      answer: '{"shouldContinue": true, "reasoning": "fine"}',
      tiers: [quickTier()],
    })
    const replanner = createRePlanner(() => aux)

    const result = await replanner.replan('goal', PHASE, REMAINING)

    expect(requests).toHaveLength(1)
    const req = requests[0]
    expect(req.provider).toBe('fake-api')
    expect(req.model).toBe('fake-model')
    expect(req.isolated).toBe(true)
    expect(req.tools).toBeUndefined()
    expect(req.messages).toHaveLength(1)
    expect(req.messages[0].role).toBe('user')
    expect(req.system).toContain('You are a project planner')
    expect(req.metadata?.purpose).toBe('re_planner')
    expect(req.metadata?.tier).toBeUndefined()
    expect(result.reasoning).toBe('fine')
  })

  it('no eligible model: no task changes, no throw, no model call', async () => {
    const aux = createFakeAuxiliaryModel(auxNone('no_eligible_provider'))
    const replanner = createRePlanner(() => aux)

    const result = await replanner.replan('goal', PHASE, REMAINING)

    expect(result).toEqual({
      tasksAdded: [],
      tasksRemoved: [],
      tasksModified: [],
      reasoning: 'No eligible background model; continuing with the existing plan',
      shouldContinue: true,
    })
  })

  it('a grok-only install (a CLI that cannot run isolated calls) makes zero provider calls', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      providers: ['grok-cli'],
      tiers: [quickTier('grok-cli', 'grok-cli-default')],
    })
    const replanner = createRePlanner(() => aux)

    const result = await replanner.replan('goal', PHASE, REMAINING)

    expect(requests).toHaveLength(0)
    expect(result.tasksAdded).toEqual([])
    expect(result.shouldContinue).toBe(true)
  })

  it('an unset service keeps the plan', async () => {
    const replanner = createRePlanner(() => undefined)
    const result = await replanner.replan('goal', PHASE, REMAINING)
    expect(result.tasksAdded).toEqual([])
    expect(result.shouldContinue).toBe(true)
  })

  it('a budget stop keeps the plan and says so', async () => {
    const replanner = createRePlanner(() => createFakeAuxiliaryModel(auxNone('budget_stop')))
    const result = await replanner.replan('goal', PHASE, REMAINING)
    expect(result.tasksRemoved).toEqual([])
    expect(result.reasoning).toContain('budget')
  })

  it('a failed or empty call keeps the plan', async () => {
    for (const step of [auxError('boom'), auxEmpty()]) {
      const replanner = createRePlanner(() => createFakeAuxiliaryModel(step))
      const result = await replanner.replan('goal', PHASE, REMAINING)
      expect(result.tasksAdded).toEqual([])
      expect(result.shouldContinue).toBe(true)
      expect(result.reasoning).toBe('Re-planning failed, continuing with existing plan')
    }
  })

  it('a stand-in that throws still keeps the plan', async () => {
    const replanner = createRePlanner(() => ({ complete: async () => { throw new Error('boom') } }))
    const result = await replanner.replan('goal', PHASE, REMAINING)
    expect(result.shouldContinue).toBe(true)
    expect(result.tasksAdded).toEqual([])
  })

  it('an answer without JSON, or JSON that fails the schema, keeps the plan', async () => {
    const noJson = await createRePlanner(() => createFakeAuxiliaryModel(auxOk('I think it is fine.')))
      .replan('goal', PHASE, REMAINING)
    expect(noJson.reasoning).toBe('Could not parse re-plan response')
    expect(noJson.shouldContinue).toBe(true)

    const badShape = await createRePlanner(() => createFakeAuxiliaryModel(auxOk('{"tasksRemoved": "t2"}')))
      .replan('goal', PHASE, REMAINING)
    expect(badShape.tasksRemoved).toEqual([])
    expect(badShape.reasoning).toContain('failed validation')
  })
})
