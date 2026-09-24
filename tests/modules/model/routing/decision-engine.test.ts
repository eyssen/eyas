// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// MCI-3 — when every tier triage could pick answers on the same model (a
// single-CLI install), classifying a message cannot change the answer, so the
// decision engine makes no triage call at all.

import { describe, it, expect } from 'vitest'
import { createDecisionEngine, TRIAGE_TARGET_TIERS } from '@modules/model/routing/decision-engine'
import type { TierConfig, RoutingTier, BudgetStatus } from '@modules/model/routing/types'
import { auxOk, createFakeAuxiliaryModel } from '../../../helpers/fake-auxiliary-model'

function tier(name: RoutingTier, providerId: string, modelId: string, extra: Partial<TierConfig> = {}): TierConfig {
  return {
    tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null,
    description: '', enabled: true, updatedAt: '', ...extra,
  }
}

const OK_BUDGET: BudgetStatus = {
  daily: { spent: 0, limit: 0, action: 'ok' },
  weekly: { spent: 0, limit: 0, action: 'ok' },
  monthly: { spent: 0, limit: 0, action: 'ok' },
}

function engine(tiers: TierConfig[]) {
  // The classifier runs through the auxiliary model service (C7); the engine's
  // gateway only answers which providers are registered.
  const aux = createFakeAuxiliaryModel(auxOk('{"category": "chat", "complexity": "complex"}'))
  const de = createDecisionEngine({
    gateway: { getProvider: (id: string) => ({ id }) as never },
    getAux: () => aux,
    getTiers: () => tiers,
    getBudget: () => ({ dailyLimit: null, weeklyLimit: null, monthlyLimit: null, warnAt: 0.8, downgradeAt: 1, hardStopAt: 1.2 }),
    getSpending: () => OK_BUDGET,
  })
  return { de, aux }
}

// No keyword rule matches this, so keyword triage is low-confidence and the
// LLM classifier would normally be asked.
const UNPLACEABLE = 'hello there, my friend'

describe('decision engine — single-model installs skip triage', () => {
  it('all triage targets on grok-cli-default → no triage call, strategy default (positive)', async () => {
    const all = ['triage', ...TRIAGE_TARGET_TIERS] as RoutingTier[]
    const { de, aux } = engine(all.map((t) => tier(t, 'grok-cli', 'grok-cli-default')))
    const decision = await de.route(UNPLACEABLE)
    expect(aux.calls).toHaveLength(0)
    expect(decision).toMatchObject({ provider: 'grok-cli', model: 'grok-cli-default', tier: 'standard', strategy: 'default' })
    expect(de.triageTargets().map((t) => t.tier)).toEqual(['quick', 'standard', 'complex', 'code'])
  })

  it('a disabled target tier does not count as a different model', async () => {
    const { de, aux } = engine([
      tier('triage', 'grok-cli', 'grok-cli-default'),
      tier('standard', 'grok-cli', 'grok-cli-default'),
      tier('complex', 'anthropic', 'claude-opus-4-8', { enabled: false }),
    ])
    await de.route(UNPLACEABLE)
    expect(aux.calls).toHaveLength(0)
  })

  it('distinct tiers with a low-confidence message → the triage LLM is called once (negative)', async () => {
    const { de, aux } = engine([
      tier('triage', 'claude-code', 'claude-code-haiku'),
      tier('quick', 'claude-code', 'claude-code-haiku'),
      tier('standard', 'claude-code', 'claude-code-sonnet'),
      tier('complex', 'claude-code', 'claude-code-opus'),
    ])
    const decision = await de.route(UNPLACEABLE)
    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0]).toMatchObject({ purpose: 'triage', origin: 'interactive' })
    expect(decision).toMatchObject({ tier: 'complex', model: 'claude-code-opus', strategy: 'triage' })
  })
})
