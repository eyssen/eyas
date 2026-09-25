// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The install default is defined once (binding.ts resolveDefault): the
// gateway's unpinned fallback and the auxiliary model service both read it.
// No provider is preferred by id and registration order never matters.

import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { canRunIsolated, findModelOwner, resolveDefault, type BindingProviderConfig } from '@modules/model/binding'
import { readTiers } from '@modules/model/routing/tier-store'
import type { TierConfig } from '@modules/model/routing/types'
import type { ModelInfo } from '@modules/model/types'

function tier(name: TierConfig['tier'], providerId: string, modelId: string, extra: Partial<TierConfig> = {}): TierConfig {
  return {
    tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null,
    description: '', enabled: true, updatedAt: '', ...extra,
  }
}

function modelInfo(provider: string, id: string): ModelInfo {
  return {
    id, name: id, provider, contextWindow: 1000, maxOutputTokens: 100,
    supportsTools: true, supportsImages: false, supportsStreaming: true,
  }
}

interface FakeRow { enabled?: boolean; models?: string[] }

/** provider_config stand-in: rows by id, an optional default. */
function fakeConfig(rows: Record<string, FakeRow>, def: { providerId: string; modelId: string } | null = null): BindingProviderConfig {
  return {
    getProvider: (id) => (id in rows
      ? { id, enabled: rows[id].enabled !== false, settings: {}, isDefault: def?.providerId === id, defaultModel: null, updatedAt: '' }
      : null),
    getDefault: () => def,
    listProviders: () => Object.keys(rows).map((id) => ({
      id, enabled: rows[id].enabled !== false, settings: {}, isDefault: false, defaultModel: null, updatedAt: '',
    })),
    listEnabledModels: (id) => (rows[id]?.models ?? []).map((m) => modelInfo(id, m)),
  }
}

const registered = (...ids: string[]) => (id: string) => ids.includes(id)

describe('canRunIsolated', () => {
  it('is true for an API provider, whatever it advertises', () => {
    expect(canRunIsolated({ id: 'anthropic' })).toBe(true)
    expect(canRunIsolated({ id: 'openai', supportsIsolatedCompletion: false })).toBe(true)
  })

  it('is true for a CLI that advertises isolated completion', () => {
    expect(canRunIsolated({ id: 'claude-code', supportsIsolatedCompletion: true })).toBe(true)
  })

  it('is false for a CLI without the flag', () => {
    expect(canRunIsolated({ id: 'grok-cli' })).toBe(false)
    expect(canRunIsolated({ id: 'kimi-cli', supportsIsolatedCompletion: false })).toBe(false)
  })
})

describe('resolveDefault', () => {
  it('uses the enabled standard tier on a registered, enabled provider', () => {
    const result = resolveDefault({
      getTiers: () => [tier('quick', 'openai', 'gpt-mini'), tier('standard', 'anthropic', 'claude-sonnet')],
      providerConfig: fakeConfig({ anthropic: { models: ['claude-sonnet'] }, openai: { models: ['gpt-mini'] } }, { providerId: 'openai', modelId: 'gpt-mini' }),
      isRegistered: registered('anthropic', 'openai'),
    })
    expect(result).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet', source: 'tier' })
  })

  it('uses the provider_config default when there is no standard tier', () => {
    const result = resolveDefault({
      getTiers: () => [tier('standard', '', '')],
      providerConfig: fakeConfig({ anthropic: { models: ['claude-sonnet'] }, openai: { models: ['gpt-mini'] } }, { providerId: 'openai', modelId: 'gpt-mini' }),
      isRegistered: registered('anthropic', 'openai'),
    })
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-mini', source: 'default' })
  })

  it('falls to the alphabetically first registered+enabled provider with an enabled model', () => {
    const result = resolveDefault({
      getTiers: () => [],
      providerConfig: fakeConfig({ zeta: { models: ['z1'] }, openai: { models: ['gpt-mini'] }, anthropic: { models: ['claude-sonnet'] } }),
      isRegistered: registered('zeta', 'openai', 'anthropic'),
    })
    expect(result).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet', source: 'first' })
  })

  it('does not prefer anthropic: the first provider by id wins', () => {
    const result = resolveDefault({
      getTiers: () => [],
      providerConfig: fakeConfig({ anthropic: { models: ['claude-sonnet'] }, 'aardvark-ai': { models: ['a1'] } }),
      isRegistered: registered('anthropic', 'aardvark-ai'),
    })
    expect(result?.providerId).toBe('aardvark-ai')
  })

  it('skips a standard tier naming an unregistered provider', () => {
    const result = resolveDefault({
      getTiers: () => [tier('standard', 'ghost', 'g1')],
      providerConfig: fakeConfig({ openai: { models: ['gpt-mini'] } }, { providerId: 'openai', modelId: 'gpt-mini' }),
      isRegistered: registered('openai'),
    })
    expect(result).toMatchObject({ providerId: 'openai', source: 'default' })
  })

  it('skips a standard tier and a default naming a provider disabled in provider_config', () => {
    const result = resolveDefault({
      getTiers: () => [tier('standard', 'anthropic', 'claude-sonnet')],
      providerConfig: fakeConfig(
        { anthropic: { enabled: false, models: ['claude-sonnet'] }, openai: { models: ['gpt-mini'] } },
        { providerId: 'anthropic', modelId: 'claude-sonnet' },
      ),
      isRegistered: registered('anthropic', 'openai'),
    })
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-mini', source: 'first' })
  })

  it('skips a disabled standard tier row', () => {
    const result = resolveDefault({
      getTiers: () => [tier('standard', 'anthropic', 'claude-sonnet', { enabled: false })],
      providerConfig: fakeConfig({ anthropic: { models: ['claude-sonnet'] }, openai: { models: ['gpt-mini'] } }, { providerId: 'openai', modelId: 'gpt-mini' }),
      isRegistered: registered('anthropic', 'openai'),
    })
    expect(result?.source).toBe('default')
  })

  it('skips a provider with zero enabled models on the last rung', () => {
    const result = resolveDefault({
      getTiers: () => [],
      providerConfig: fakeConfig({ anthropic: { models: [] }, openai: { models: ['gpt-mini'] } }),
      isRegistered: registered('anthropic', 'openai'),
    })
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-mini', source: 'first' })
  })

  it('returns null when nothing qualifies', () => {
    expect(resolveDefault({
      getTiers: () => [tier('standard', 'ghost', 'g1')],
      providerConfig: fakeConfig({ anthropic: { models: [] }, openai: { enabled: false, models: ['gpt-mini'] } }),
      isRegistered: registered('anthropic', 'openai'),
    })).toBeNull()
    expect(resolveDefault({ getTiers: () => [], providerConfig: fakeConfig({}), isRegistered: () => false })).toBeNull()
  })

  it('treats a lookup that throws as "not this rung", never as an exception', () => {
    const config = fakeConfig({ openai: { models: ['gpt-mini'] } })
    const result = resolveDefault({
      getTiers: () => { throw new Error('routing table gone') },
      providerConfig: { ...config, getDefault: () => { throw new Error('db locked') } },
      isRegistered: registered('openai'),
    })
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-mini', source: 'first' })
  })
})

describe('findModelOwner', () => {
  it('(+) the registered, enabled provider whose catalog lists the model', () => {
    const providerConfig = fakeConfig({ openai: { models: ['gpt-x'] }, 'grok-cli': { models: ['grok-cli-default'] } })
    expect(findModelOwner({ providerConfig, isRegistered: registered('openai', 'grok-cli') }, 'gpt-x')).toBe('openai')
  })

  it('(+) a bare tier alias resolves the way the gateway normalizes it', () => {
    const providerConfig = fakeConfig({ 'grok-cli': { models: ['grok-cli-default'] } })
    expect(findModelOwner({ providerConfig, isRegistered: registered('grok-cli') }, 'sonnet')).toBe('grok-cli')
  })

  it('(+/−) exact: only the id itself counts — the gateway normalizes aliases on its own', () => {
    const providerConfig = fakeConfig({ 'grok-cli': { models: ['grok-cli-default', 'grok-cli-grok-4.6'] } })
    const deps = { providerConfig, isRegistered: registered('grok-cli') }
    expect(findModelOwner(deps, 'grok-cli-grok-4.6', { exact: true })).toBe('grok-cli')
    expect(findModelOwner(deps, 'sonnet', { exact: true })).toBeNull()
  })

  it('(−) unknown model, unregistered or disabled owner → null', () => {
    const providerConfig = fakeConfig({ openai: { models: ['gpt-x'] }, off: { enabled: false, models: ['m-off'] } })
    expect(findModelOwner({ providerConfig, isRegistered: registered('openai', 'off') }, 'mystery')).toBeNull()
    expect(findModelOwner({ providerConfig, isRegistered: registered() }, 'gpt-x')).toBeNull()
    expect(findModelOwner({ providerConfig, isRegistered: registered('openai', 'off') }, 'm-off')).toBeNull()
  })

  it('(−) two providers listing the same id → null (never a guess)', () => {
    const providerConfig = fakeConfig({ a: { models: ['shared'] }, b: { models: ['shared'] } })
    expect(findModelOwner({ providerConfig, isRegistered: registered('a', 'b') }, 'shared')).toBeNull()
  })

  it('(−) a throwing catalog → null, no throw', () => {
    const boom = { ...fakeConfig({}), listProviders: () => { throw new Error('db gone') } }
    expect(findModelOwner({ providerConfig: boom, isRegistered: registered('a') }, 'x')).toBeNull()
  })
})

describe('readTiers', () => {
  it('maps every routing_tiers row, enabled as a boolean', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE routing_tiers (tier TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      fallback_provider_id TEXT, fallback_model_id TEXT, description TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT '')`)
    db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id, fallback_provider_id, fallback_model_id, description, enabled, updated_at)
      VALUES ('standard', 'anthropic', 'claude-sonnet', 'openai', 'gpt-mini', 'Normal', 1, 't1'), ('heartbeat', '', '', NULL, NULL, NULL, 0, 't2')`)

    const tiers = readTiers(db)
    expect(tiers.find((t) => t.tier === 'standard')).toEqual({
      tier: 'standard', providerId: 'anthropic', modelId: 'claude-sonnet',
      fallbackProviderId: 'openai', fallbackModelId: 'gpt-mini', description: 'Normal', enabled: true, updatedAt: 't1',
      // A table from before routing_tiers.effort reads every tier as Auto.
      effort: null,
    })
    expect(tiers.find((t) => t.tier === 'heartbeat')).toMatchObject({ enabled: false, fallbackProviderId: null, description: '' })
  })

  it('throws when the table does not exist (callers decide how to degrade)', () => {
    expect(() => readTiers(createMemoryDb())).toThrow()
  })
})
