import { describe, it, expect } from 'vitest'
import { planAutoFailover } from '@modules/model/routing/auto-failover'
import type { TierConfig } from '@modules/model/routing/types'

describe('auto-failover planner', () => {
  const tiers: TierConfig[] = [
    {
      tier: 'standard',
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      fallbackProviderId: '',
      fallbackModelId: '',
      description: '',
      enabled: true,
      updatedAt: '',
    },
    {
      tier: 'quick',
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      fallbackProviderId: 'anthropic',
      fallbackModelId: 'claude-haiku',
      description: '',
      enabled: true,
      updatedAt: '',
    },
  ]

  it('plans fallback only when empty and ≥2 providers', () => {
    const plan = planAutoFailover(tiers, [
      { id: 'anthropic', models: [{ id: 'claude-sonnet' }, { id: 'claude-haiku' }] },
      { id: 'openai', models: [{ id: 'gpt-4o-mini' }] },
    ])
    expect(plan).toHaveLength(1)
    expect(plan[0].tier).toBe('standard')
    expect(plan[0].fallbackProviderId).toBe('openai')
    expect(plan[0].fallbackModelId).toBe('gpt-4o-mini')
  })

  it('does nothing with a single provider', () => {
    const plan = planAutoFailover(tiers, [{ id: 'anthropic', models: [{ id: 'x' }] }])
    expect(plan).toHaveLength(0)
  })
})
