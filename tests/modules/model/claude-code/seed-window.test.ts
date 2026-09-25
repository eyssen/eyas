// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// CCB-3 — the Claude Code first-boot seed never claims a window the runtime
// does not give a bare alias. The seed, discovery and THE window resolver
// (model-window.ts) share one window function, and seed rows an earlier EYAS
// stored with a 1M window are corrected at load until a discovery confirms
// them, so prompt sizing and the context bar agree even when discovery keeps
// failing.

import { describe, it, expect, afterEach } from 'vitest'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { PROVIDER_WINDOW, resolveModelContextWindow } from '@modules/model/model-window'
import { claudeCodeWindowFor, claudeModelsFromDiscovery, parseRuntimeModels } from '@modules/model/submodules/claude-code/discovery.js'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { undiscoveredSeedDrift } from '@modules/model/submodules/claude-code/manifest.js'
import type { ModelInfo } from '@modules/model/types'
import { createTestDb } from '../../../helpers/test-db'

const CLAUDE_WINDOW = PROVIDER_WINDOW['claude-code']!

describe('claudeCodeWindowFor — one window for the seed and discovery', () => {
  it('a bare alias gets the provider window of the window resolver (positive)', () => {
    for (const alias of ['fable', 'opus', 'sonnet', 'haiku', 'default', 'claude-opus-5-5']) {
      expect(claudeCodeWindowFor(alias)).toBe(CLAUDE_WINDOW)
    }
    expect(CLAUDE_WINDOW).toBeLessThan(1_000_000)
  })

  it('only the 1M-context suffix, on the alias or the concrete model, gives 1M (positive)', () => {
    expect(claudeCodeWindowFor('opus[1m]')).toBe(1_000_000)
    expect(claudeCodeWindowFor('SONNET[1M]')).toBe(1_000_000)
    expect(claudeCodeWindowFor('opus', 'claude-opus-5-5[1m]')).toBe(1_000_000)
  })

  it('a slug or a suffix elsewhere in the name is not the 1M selector (negative)', () => {
    expect(claudeCodeWindowFor('opus-1m')).toBe(CLAUDE_WINDOW)
    expect(claudeCodeWindowFor('opus[1m]-preview')).toBe(CLAUDE_WINDOW)
    expect(claudeCodeWindowFor('opus', 'claude-opus-5-5')).toBe(CLAUDE_WINDOW)
  })
})

describe('claude-code seed rows stored with a drifted window', () => {
  const testDb = createTestDb('claude-code-seed-window')
  afterEach(() => testDb.cleanup())

  /** The seed as an earlier EYAS wrote it: 1M on the bare fable, opus and sonnet aliases. */
  async function legacySeed(): Promise<ModelInfo[]> {
    const seed = await createClaudeCodeProvider().listModels()
    return seed.map((m) => (m.id === 'claude-code-haiku' ? m : { ...m, contextWindow: 1_000_000 }))
  }

  it('re-applies the current seed window to undiscovered seed rows and keeps the user\'s enabled choice (positive)', async () => {
    const svc = createProviderConfigService(testDb.open())
    svc.ensureProvider('claude-code')
    svc.upsertModels('claude-code', await legacySeed())
    svc.updateModel('claude-code:claude-code-sonnet', { enabled: false })

    const seed = await createClaudeCodeProvider().listModels()
    const drift = undiscoveredSeedDrift(svc.listModels('claude-code'), seed)
    expect(drift.map((m) => m.id).sort()).toEqual(['claude-code-fable', 'claude-code-opus', 'claude-code-sonnet'])
    svc.upsertModels('claude-code', drift)

    const rows = svc.listModels('claude-code')
    for (const row of rows) expect(row.contextWindow).toBe(CLAUDE_WINDOW)
    expect(rows.find((r) => r.modelId === 'claude-code-sonnet')!.enabled).toBe(false)
    expect(rows.find((r) => r.modelId === 'claude-code-opus')!.enabled).toBe(true)
    // Prompt sizing and the context bar now read the same window.
    expect(resolveModelContextWindow({ providerId: 'claude-code', modelId: 'claude-code-opus' }, { catalog: svc }))
      .toEqual({ contextWindow: CLAUDE_WINDOW, supportsTools: true, source: 'catalog' })
    // Idempotent: nothing is left to repair.
    expect(undiscoveredSeedDrift(svc.listModels('claude-code'), seed)).toEqual([])
  })

  it('leaves discovered rows, non-seed rows and rows already on the seed window alone (negative)', async () => {
    const svc = createProviderConfigService(testDb.open())
    svc.ensureProvider('claude-code')
    // A discovery confirmed opus (and offered a 1M variant); haiku is on the seed window.
    svc.upsertModels('claude-code', await legacySeed())
    const discovered = claudeModelsFromDiscovery({
      models: parseRuntimeModels([
        { value: 'opus', resolvedModel: 'claude-opus-5-5' },
        { value: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]' },
      ]),
      runtimeVersion: '2.1.281',
    }, '2026-09-24T10:00:00.000Z')
    svc.upsertModels('claude-code', discovered)

    const seed = await createClaudeCodeProvider().listModels()
    const drift = undiscoveredSeedDrift(svc.listModels('claude-code'), seed).map((m) => m.id).sort()
    expect(drift).toEqual(['claude-code-fable', 'claude-code-sonnet'])
    expect(drift).not.toContain('claude-code-opus')
    expect(drift).not.toContain('claude-code-opus-1m')
    expect(drift).not.toContain('claude-code-haiku')
    // The runtime's own 1M variant keeps its 1M window.
    expect(svc.listModels('claude-code').find((r) => r.modelId === 'claude-code-opus-1m')!.contextWindow).toBe(1_000_000)
  })

  it('a seed row a discovery flagged missing gets the window but stays off and flagged', async () => {
    const svc = createProviderConfigService(testDb.open())
    svc.ensureProvider('claude-code')
    svc.upsertModels('claude-code', await legacySeed())
    // A discovery that offers only haiku: fable, opus and sonnet are flagged missing and switched off.
    svc.reconcileDiscoveredModels('claude-code', claudeModelsFromDiscovery({ models: parseRuntimeModels([{ value: 'haiku' }]), runtimeVersion: '2.1.89' }, '2026-09-24T10:00:00.000Z'))

    const seed = await createClaudeCodeProvider().listModels()
    svc.upsertModels('claude-code', undiscoveredSeedDrift(svc.listModels('claude-code'), seed))

    const fable = svc.listModels('claude-code').find((r) => r.modelId === 'claude-code-fable')!
    expect(fable.contextWindow).toBe(CLAUDE_WINDOW)
    expect(fable.enabled).toBe(false)
    expect(fable.metadata?.missingSince).toBeDefined()
    expect(fable.metadata?.autoDisabled).toBe(true)
  })
})
