// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import { DEFAULT_WINDOW, PROVIDER_WINDOW, resolveModelContextWindow } from '@modules/model/model-window'
import type { ModelInfo, ToolAddressing } from '@modules/model/types'
import {
  budgetWindowOf,
  profileMatchesRun,
  resolveDeliveryProfile,
  type DeliveryProfileDeps,
} from '@modules/prompt-wizard/delivery-profile'
import { BASELINE_WINDOW } from '@modules/prompt-wizard/token-budget'

const testDb = createTestDb('delivery-profile')
let svc: ProviderConfigService

function model(id: string, provider: string, contextWindow: number, supportsTools = true): ModelInfo {
  return { id, name: id, provider, contextWindow, maxOutputTokens: 4096, supportsTools, supportsImages: false, supportsStreaming: true }
}

const ADDRESSING: Record<string, ToolAddressing> = {
  'claude-code': { kind: 'mcp-prefix', prefix: 'mcp__eyas__' },
  'grok-cli': { kind: 'meta-tool', via: 'use_tool', qualify: 'eyas__' },
  'kimi-cli': { kind: 'mcp-server', server: 'eyas' },
}

function deps(over: Partial<DeliveryProfileDeps> = {}): DeliveryProfileDeps {
  return {
    modelWindow: (t) => resolveModelContextWindow(t, { catalog: svc }),
    getProvider: (id) => ({ toolAddressing: ADDRESSING[id] }),
    resolveDefault: () => null,
    bridgeHealth: () => ({ healthy: true, checkedAt: 'now' }),
    ...over,
  }
}

beforeEach(() => {
  svc = createProviderConfigService(testDb.open())
  svc.ensureProvider('claude-code')
  svc.upsertModels('claude-code', [model('claude-code-sonnet', 'claude-code', 100_000)])
  svc.ensureProvider('ollama')
  svc.upsertModels('ollama', [model('small', 'ollama', 8_192, false)])
  svc.ensureProvider('grok-cli')
  svc.upsertModels('grok-cli', [model('grok-code', 'grok-cli', 500_000)])
})
afterEach(() => testDb.cleanup())

describe('resolveDeliveryProfile', () => {
  it('(+) a claude-code row: the model\'s own catalog window and the provider-exact (mcp-prefix) addressing', () => {
    const p = resolveDeliveryProfile(deps(), { providerId: 'claude-code', modelId: 'claude-code-sonnet' })
    expect(p).toMatchObject({
      providerId: 'claude-code',
      modelId: 'claude-code-sonnet',
      contextWindow: 100_000,
      supportsTools: true,
      toolAddressing: { kind: 'mcp-prefix', prefix: 'mcp__eyas__' },
      drillDown: true,
      resolved: true,
      windowSource: 'catalog',
    })
  })

  it('(+) a claude-code model without a catalog row: the provider window', () => {
    const p = resolveDeliveryProfile(deps(), { providerId: 'claude-code', modelId: 'claude-code-unlisted' })
    expect(p).toMatchObject({ contextWindow: PROVIDER_WINDOW['claude-code'], windowSource: 'provider', resolved: true })
  })

  it('(+) a tool-less model: supportsTools false and no drill-down', () => {
    const p = resolveDeliveryProfile(deps(), { providerId: 'ollama', modelId: 'small' })
    expect(p).toMatchObject({ contextWindow: 8_192, supportsTools: false, drillDown: false, resolved: true })
    expect(p.toolAddressing).toEqual({ kind: 'native' })
  })

  it('(+) a model-only target resolves its owner', () => {
    const p = resolveDeliveryProfile(deps({ lookupModelOwner: (id) => (id === 'small' ? 'ollama' : null) }), { modelId: 'small' })
    expect(p).toMatchObject({ providerId: 'ollama', modelId: 'small', contextWindow: 8_192, resolved: true })
  })

  it('(−) a model-only target whose owner is unknown stays unresolved — never the install default', () => {
    const resolveDefault = vi.fn(() => ({ providerId: 'grok-cli', modelId: 'grok-code' }))
    const p = resolveDeliveryProfile(deps({ resolveDefault, lookupModelOwner: () => null }), { modelId: 'gpt-x' })
    expect(p).toMatchObject({ providerId: null, modelId: 'gpt-x', resolved: false, toolAddressing: { kind: 'native' } })
    expect(budgetWindowOf(p)).toBe(BASELINE_WINDOW)
    expect(resolveDefault).not.toHaveBeenCalled()
    // No owner lookup wired at all: the same.
    expect(resolveDeliveryProfile(deps({ resolveDefault }), { modelId: 'gpt-x' }).toolAddressing).toEqual({ kind: 'native' })
  })

  it('(+) a model-only target owned by a CLI host gets that host\'s addressing', () => {
    const p = resolveDeliveryProfile(
      deps({ resolveDefault: () => ({ providerId: 'claude-code', modelId: 'claude-code-sonnet' }), lookupModelOwner: (id) => (id === 'grok-code' ? 'grok-cli' : null) }),
      { modelId: 'grok-code' },
    )
    expect(p).toMatchObject({ providerId: 'grok-cli', toolAddressing: { kind: 'meta-tool', via: 'use_tool', qualify: 'eyas__' } })
  })

  it('(+) an empty target → the install default binding', () => {
    const p = resolveDeliveryProfile(deps({ resolveDefault: () => ({ providerId: 'grok-cli', modelId: 'grok-code' }) }))
    expect(p).toMatchObject({
      providerId: 'grok-cli',
      modelId: 'grok-code',
      contextWindow: PROVIDER_WINDOW['grok-cli'],
      toolAddressing: { kind: 'meta-tool', via: 'use_tool', qualify: 'eyas__' },
      resolved: true,
    })
  })

  it('(−) an unknown model → default window, resolved:false, and the budget uses the 100k baseline', () => {
    svc.ensureProvider('openai')
    const p = resolveDeliveryProfile(deps(), { providerId: 'openai', modelId: 'nope' })
    expect(p).toMatchObject({ providerId: 'openai', contextWindow: DEFAULT_WINDOW, resolved: false, windowSource: 'default' })
    expect(budgetWindowOf(p)).toBe(BASELINE_WINDOW)
  })

  it('(−) nothing bound at all → unresolved, native, baseline', () => {
    const p = resolveDeliveryProfile(deps())
    expect(p).toMatchObject({ providerId: null, resolved: false, toolAddressing: { kind: 'native' } })
    expect(budgetWindowOf(p)).toBe(BASELINE_WINDOW)
  })

  it('(−) an ACP provider with a failed bridge self-test → no drill-down', () => {
    const failed = deps({ bridgeHealth: () => ({ healthy: false, error: 'HTTP 401', checkedAt: 'now' }) })
    expect(resolveDeliveryProfile(failed, { providerId: 'grok-cli', modelId: 'grok-code' }).drillDown).toBe(false)
    expect(resolveDeliveryProfile(failed, { providerId: 'kimi-cli', modelId: 'k2' }).drillDown).toBe(false)
    // Claude Code's tools are in-process (SDK MCP server), not over the bridge.
    expect(resolveDeliveryProfile(failed, { providerId: 'claude-code', modelId: 'claude-code-sonnet' }).drillDown).toBe(true)
  })

  it('(+) a deferred bridge check (setup was incomplete at boot) is not a fault', () => {
    const deferred = deps({ bridgeHealth: () => ({ healthy: false, deferred: true, checkedAt: 'now' }) })
    expect(resolveDeliveryProfile(deferred, { providerId: 'grok-cli', modelId: 'grok-code' }).drillDown).toBe(true)
  })

  it('(−) throwing dependencies degrade instead of throwing', () => {
    const boom = () => { throw new Error('boom') }
    const p = resolveDeliveryProfile(
      { modelWindow: boom, getProvider: boom, resolveDefault: boom, lookupModelOwner: boom, bridgeHealth: boom },
      { providerId: 'grok-cli', modelId: 'grok-code' },
    )
    // The window falls back to the source-less resolver (the known CLI window).
    expect(p).toMatchObject({ providerId: 'grok-cli', contextWindow: PROVIDER_WINDOW['grok-cli'], toolAddressing: { kind: 'native' } })
  })
})

describe('profileMatchesRun', () => {
  const p = resolveDeliveryProfile(deps(), { providerId: 'ollama', modelId: 'small' })

  it('(+) the same provider/model, or a run that pins nothing (the default binding)', () => {
    expect(profileMatchesRun(p, { provider: 'ollama', model: 'small' })).toBe(true)
    expect(profileMatchesRun(p, { provider: 'ollama' })).toBe(true)
    expect(profileMatchesRun(p, {})).toBe(true)
    expect(profileMatchesRun(p, { model: 'small' })).toBe(true)
  })

  it('(−) another provider or another model of it', () => {
    expect(profileMatchesRun(p, { provider: 'openai', model: 'small' })).toBe(false)
    expect(profileMatchesRun(p, { provider: 'ollama', model: 'large' })).toBe(false)
    expect(profileMatchesRun(p, { model: 'large' })).toBe(false)
    expect(profileMatchesRun(resolveDeliveryProfile(deps()), { provider: 'ollama' })).toBe(false)
  })
})
