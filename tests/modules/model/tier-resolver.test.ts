// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  tierForAgentType,
  resolveTier,
  normalizeModelAlias,
  type ProviderModels,
} from '@modules/model/tier-resolver.js'

const cc: ProviderModels = { providerId: 'claude-code', modelIds: ['claude-code-opus', 'claude-code-sonnet', 'claude-code-haiku'] }
const anth: ProviderModels = { providerId: 'anthropic', modelIds: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'] }
const grok: ProviderModels = { providerId: 'grok-cli', modelIds: ['grok-cli-default'] }

describe('tier-resolver', () => {
  it('maps agent types to tiers', () => {
    expect(tierForAgentType('reviewer')).toBe('opus')
    expect(tierForAgentType('assistant')).toBe('sonnet')
    expect(tierForAgentType('observer')).toBe('haiku')
    expect(tierForAgentType('unknown-type')).toBe('sonnet') // safe default
  })

  it('prefers claude-code when present', () => {
    expect(resolveTier('opus', [anth, cc])).toEqual({ provider: 'claude-code', modelId: 'claude-code-opus' })
  })

  it('honors preferredProviderId over default order', () => {
    expect(resolveTier('sonnet', [cc, grok], 'grok-cli')).toEqual({
      provider: 'grok-cli',
      modelId: 'grok-cli-default',
    })
  })

  it('falls back to anthropic when claude-code absent', () => {
    expect(resolveTier('sonnet', [anth])).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' })
  })

  it('returns null when no provider can serve the tier', () => {
    expect(resolveTier('opus', [{ providerId: 'ollama', modelIds: ['llama3'] }])).toBeNull()
  })

  it('does not misroute when a known provider lacks the tier model', () => {
    const partialAnth: ProviderModels = { providerId: 'anthropic', modelIds: ['claude-haiku-4-5'] }
    expect(resolveTier('opus', [partialAnth])).toBeNull()
  })

  it('normalizes a bare alias to the preferred concrete id', () => {
    expect(normalizeModelAlias('sonnet', [cc, anth])).toBe('claude-code-sonnet')
    expect(normalizeModelAlias('opus', [anth])).toBe('claude-opus-4-8')
  })

  it('passes a valid concrete id through unchanged', () => {
    expect(normalizeModelAlias('claude-sonnet-4-6', [anth])).toBe('claude-sonnet-4-6')
  })

  it('returns undefined for an unresolvable model', () => {
    expect(normalizeModelAlias('gpt-9', [anth])).toBeUndefined()
  })
})
