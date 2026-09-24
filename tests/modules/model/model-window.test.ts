// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import {
  DEFAULT_WINDOW,
  PROVIDER_WINDOW,
  pickContextWindow,
  resolveModelContextWindow,
} from '@modules/model/model-window'
import type { ModelInfo } from '@modules/model/types'

const testDb = createTestDb('model-window')
let svc: ProviderConfigService

function model(id: string, provider: string, contextWindow: number, supportsTools = true): ModelInfo {
  return {
    id,
    name: id,
    provider,
    contextWindow,
    maxOutputTokens: 4096,
    supportsTools,
    supportsImages: false,
    supportsStreaming: true,
  }
}

beforeEach(() => {
  svc = createProviderConfigService(testDb.open())
})
afterEach(() => testDb.cleanup())

describe('resolveModelContextWindow', () => {
  it('(+) an API model row: its catalog window and tool support', () => {
    svc.ensureProvider('openai')
    svc.upsertModels('openai', [model('big-model', 'openai', 1_000_000, false)])
    expect(resolveModelContextWindow({ providerId: 'openai', modelId: 'big-model' }, { catalog: svc }))
      .toEqual({ contextWindow: 1_000_000, supportsTools: false, source: 'catalog' })
  })

  it('(+) a CLI model with a 1M catalog row uses 1M, not the 200k provider default', () => {
    svc.ensureProvider('claude-code')
    svc.upsertModels('claude-code', [model('claude-code-opus-1m', 'claude-code', 1_000_000)])
    expect(resolveModelContextWindow({ providerId: 'claude-code', modelId: 'claude-code-opus-1m' }, { catalog: svc }))
      .toEqual({ contextWindow: 1_000_000, supportsTools: true, source: 'catalog' })
    expect(PROVIDER_WINDOW['claude-code']).toBeLessThan(1_000_000)
  })

  it('(−) a CLI model without a catalog window falls back to the provider window, not the default', () => {
    svc.ensureProvider('grok-cli')
    svc.upsertModels('grok-cli', [model('grok-code', 'grok-cli', 0)])
    expect(resolveModelContextWindow({ providerId: 'grok-cli', modelId: 'grok-code' }, { catalog: svc }))
      .toEqual({ contextWindow: PROVIDER_WINDOW['grok-cli'], supportsTools: true, source: 'provider' })
    expect(resolveModelContextWindow({ providerId: 'kimi-cli', modelId: 'unknown' }, { catalog: svc }))
      .toEqual({ contextWindow: PROVIDER_WINDOW['kimi-cli'], supportsTools: true, source: 'provider' })
  })

  it('(+) a CLI model row wins over the provider window, with its own tool support', () => {
    svc.ensureProvider('grok-cli')
    svc.upsertModels('grok-cli', [model('grok-code', 'grok-cli', 128_000, false)])
    expect(resolveModelContextWindow({ providerId: 'grok-cli', modelId: 'grok-code' }, { catalog: svc }))
      .toEqual({ contextWindow: 128_000, supportsTools: false, source: 'catalog' })
  })

  it('(−) no row and an unknown provider → the default window, tools assumed', () => {
    expect(resolveModelContextWindow({ providerId: 'openai', modelId: 'nope' }, { catalog: svc }))
      .toEqual({ contextWindow: DEFAULT_WINDOW, supportsTools: true, source: 'default' })
    expect(resolveModelContextWindow({}, { catalog: svc }).source).toBe('default')
  })

  it('(−) a row with no window is not a window', () => {
    svc.ensureProvider('openai')
    svc.upsertModels('openai', [model('m0', 'openai', 0)])
    expect(resolveModelContextWindow({ providerId: 'openai', modelId: 'm0' }, { catalog: svc }).source).toBe('default')
  })

  it('(−) a catalog that throws resolves to the default, never throws', () => {
    const catalog = { listModels: () => { throw new Error('db gone') } }
    expect(() => resolveModelContextWindow({ providerId: 'openai', modelId: 'm' }, { catalog })).not.toThrow()
    expect(resolveModelContextWindow({ providerId: 'openai', modelId: 'm' }, { catalog }))
      .toEqual({ contextWindow: DEFAULT_WINDOW, supportsTools: true, source: 'default' })
  })

  it('(−) the catalog is the only per-model source: no second window lookup is consulted', () => {
    // The capability record holds reasoning facts only; a lookup handed in
    // anyway is never called and cannot override the catalog row.
    svc.ensureProvider('openai')
    svc.upsertModels('openai', [model('m', 'openai', 32_000)])
    const capability = vi.fn(() => ({ contextWindow: 1_000_000, supportsTools: false }))
    expect(resolveModelContextWindow({ providerId: 'openai', modelId: 'm' }, { catalog: svc, capability } as any))
      .toEqual({ contextWindow: 32_000, supportsTools: true, source: 'catalog' })
    expect(capability).not.toHaveBeenCalled()
  })
})

describe('pickContextWindow (the pure part the web re-exports)', () => {
  it('prefers a positive catalog window, then the provider window, then the default', () => {
    expect(pickContextWindow(256_000, 'grok-cli')).toBe(256_000)
    expect(pickContextWindow(null, 'grok-cli')).toBe(PROVIDER_WINDOW['grok-cli'])
    expect(pickContextWindow(0, 'openai')).toBe(DEFAULT_WINDOW)
  })
})
