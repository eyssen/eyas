// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createKimiProvider, KIMI_MODELS, KIMI_API_BASE_URL } from '@modules/model/submodules/kimi/provider'
import { createKimiCliProvider, KIMI_CLI_KNOWN_MODELS } from '@modules/model/submodules/kimi-cli/provider'
import { buildKimiCliArgs } from '@modules/model/submodules/grok-cli/acp-client'
import { estimateCost } from '@shared/model-pricing'
import { MODEL_DOWNGRADE_PATH } from '@modules/model/routing/types'
import { isCliProviderId, KIMI_CLI_PROVIDER_ID, CLI_DEFAULT_MODELS } from '@modules/model/onboarding-reconcile'

describe('Kimi API provider', () => {
  it('lists known Moonshot models', async () => {
    const p = createKimiProvider('test-key')
    expect(p.id).toBe('kimi')
    expect(p.name).toBe('Kimi')
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(KIMI_MODELS.map((m) => m.id))
    expect(models.some((m) => m.id === 'kimi-k3')).toBe(true)
    expect(models.some((m) => m.id === 'kimi-k2.7-code')).toBe(true)
  })

  it('uses the Moonshot OpenAI-compatible base URL', () => {
    expect(KIMI_API_BASE_URL).toBe('https://api.moonshot.ai/v1')
  })
})

describe('Kimi Code CLI provider', () => {
  it('lists known CLI aliases', async () => {
    const p = createKimiCliProvider()
    expect(p.id).toBe('kimi-cli')
    const models = await p.listModels()
    expect(models.length).toBe(KIMI_CLI_KNOWN_MODELS.length)
    const def = models.find((m) => m.id === 'kimi-cli-default')!
    expect((def.metadata as any).realModelId).toBe('kimi-k2.7-code')
  })

  it('builds ACP argv as kimi [--model X] acp', () => {
    expect(buildKimiCliArgs()).toEqual(['acp'])
    expect(buildKimiCliArgs('kimi-k3')).toEqual(['--model', 'kimi-k3', 'acp'])
  })
})

describe('Kimi pricing + routing', () => {
  it('prices K3 and K2.7 Code correctly', () => {
    expect(estimateCost('kimi', 'kimi-k3', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(3 + 15, 6)
    expect(estimateCost('kimi', 'kimi-k2.7-code', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.95 + 4, 6)
    expect(estimateCost('kimi-cli', 'kimi-cli-default', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.95 + 4, 6)
  })

  it('downgrades K3 → K2.7 code and CLI K3 → default', () => {
    expect(MODEL_DOWNGRADE_PATH['kimi-k3']).toBe('kimi-k2.7-code')
    expect(MODEL_DOWNGRADE_PATH['kimi-cli-k3']).toBe('kimi-cli-default')
  })

  it('registers kimi-cli as a host CLI provider', () => {
    expect(isCliProviderId(KIMI_CLI_PROVIDER_ID)).toBe(true)
    expect(CLI_DEFAULT_MODELS['kimi-cli']).toBe('kimi-cli-default')
  })
})
