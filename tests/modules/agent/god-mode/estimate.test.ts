// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { estimateCost } from '@shared/model-pricing'
import { estimateGodModeCost } from '@modules/agent/god-mode/estimate'
import type { GodModeParticipantSpec } from '@modules/agent/god-mode/types'

const sonnet: GodModeParticipantSpec = {
  id: 'p1',
  providerId: 'anthropic',
  modelId: 'claude-sonnet-4-6',
}

const gpt4o: GodModeParticipantSpec = {
  id: 'p2',
  providerId: 'openai',
  modelId: 'gpt-4o',
}

const ollama: GodModeParticipantSpec = {
  id: 'p3',
  providerId: 'ollama',
  modelId: 'llama3',
}

const tokenUsage = { inputTokens: 8000, outputTokens: 2000 } as const

describe('estimateGodModeCost', () => {
  it('sums table estimates for two priced models and multiplies by 1.5', () => {
    const c1 = estimateCost('anthropic', 'claude-sonnet-4-6', tokenUsage)
    const c2 = estimateCost('openai', 'gpt-4o', tokenUsage)
    const total = estimateGodModeCost([sonnet, gpt4o])
    expect(total).toBeCloseTo(1.5 * (c1 + c2), 10)
  })

  it('uses averageCostByKey when present and finite, overriding the pricing table', () => {
    const average = 0.42
    const c2 = estimateCost('openai', 'gpt-4o', tokenUsage)
    const total = estimateGodModeCost([sonnet, gpt4o], {
      averageCostByKey: { 'anthropic/claude-sonnet-4-6': average },
    })
    expect(total).toBeCloseTo(1.5 * (average + c2), 10)
  })

  it('ollama slot contributes 0 (local models are unpriced)', () => {
    const c1 = estimateCost('anthropic', 'claude-sonnet-4-6', tokenUsage)
    const total = estimateGodModeCost([sonnet, ollama])
    expect(total).toBeCloseTo(1.5 * (c1 + 0), 10)
  })
})
