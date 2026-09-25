import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService, parseModelConfigMetadata } from '@modules/model/provider-config-service'

const testDb = createTestDb('provider-config-service')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('ProviderConfigService', () => {
  describe('ensureProvider', () => {
    it('creates provider_config row if missing, disabled by default', () => {
      const svc = createProviderConfigService(db)
      const config = svc.ensureProvider('anthropic')
      expect(config.id).toBe('anthropic')
      expect(config.enabled).toBe(false)
    })

    it('returns existing row without overwriting', () => {
      const svc = createProviderConfigService(db)
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO provider_config (id, enabled, settings, updated_at) VALUES ('openai', 0, '{"custom":true}', ${now})`)
      const config = svc.ensureProvider('openai')
      expect(config.enabled).toBe(false)
      expect(config.settings).toEqual({ custom: true })
    })
  })

  describe('getProvider', () => {
    it('returns null for missing provider', () => {
      const svc = createProviderConfigService(db)
      expect(svc.getProvider('nonexistent')).toBeNull()
    })
  })

  describe('updateProvider', () => {
    it('updates enabled flag', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.updateProvider('anthropic', { enabled: false })
      const config = svc.getProvider('anthropic')
      expect(config!.enabled).toBe(false)
    })
  })

  describe('listProviders', () => {
    it('returns all provider configs', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.ensureProvider('openai')
      const list = svc.listProviders()
      expect(list).toHaveLength(2)
    })
  })

  describe('model config', () => {
    it('upserts models from ModelInfo array', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [
        { id: 'claude-sonnet-4-5-20250514', name: 'Claude Sonnet 4.5', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      const models = svc.listModels('anthropic')
      expect(models).toHaveLength(1)
      expect(models[0].modelId).toBe('claude-sonnet-4-5-20250514')
      expect(models[0].enabled).toBe(true)
    })

    it('preserves enabled flag on upsert', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('openai')
      svc.upsertModels('openai', [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      svc.updateModel('openai:gpt-4o', { enabled: false })
      svc.upsertModels('openai', [
        { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      const models = svc.listModels('openai')
      expect(models[0].enabled).toBe(false)
    })

    it('updateModel changes enabled', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('gemini')
      svc.upsertModels('gemini', [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      svc.updateModel('gemini:gemini-2.0-flash', { enabled: false })
      const models = svc.listModels('gemini')
      expect(models[0].enabled).toBe(false)
    })

    it('listEnabledModels returns only enabled models as ModelInfo', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [
        { id: 'model-a', name: 'A', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
        { id: 'model-b', name: 'B', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsImages: true, supportsStreaming: true },
      ])
      svc.updateModel('anthropic:model-b', { enabled: false })
      const enabled = svc.listEnabledModels('anthropic')
      expect(enabled).toHaveLength(1)
      expect(enabled[0].id).toBe('model-a')
    })
  })

  // H6 — a CLI's reported image input drives the Vision flag of its rows.
  describe('setImageSupport', () => {
    const info = (id: string, provider: string) => ({ id, name: id, provider, contextWindow: 256000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true })

    function seed() {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('grok-cli')
      svc.ensureProvider('kimi-cli')
      svc.upsertModels('grok-cli', [info('grok-cli-default', 'grok-cli'), info('grok-cli-grok-4.6', 'grok-cli')])
      svc.upsertModels('kimi-cli', [info('kimi-cli-default', 'kimi-cli')])
      return svc
    }

    it('flips only that provider\'s rows, both ways (positive)', () => {
      const svc = seed()
      svc.setImageSupport('grok-cli', false)
      expect(svc.listModels('grok-cli').map((m) => m.supportsImages)).toEqual([false, false])
      expect(svc.listEnabledModels('grok-cli').every((m) => m.supportsImages === false)).toBe(true)
      expect(svc.listModels('kimi-cli')[0].supportsImages).toBe(true)
      svc.setImageSupport('grok-cli', true)
      expect(svc.listModels('grok-cli').map((m) => m.supportsImages)).toEqual([true, true])
    })

    it('leaves matching rows untouched and keeps the user\'s enabled choice', () => {
      const svc = seed()
      svc.updateModel('grok-cli:grok-cli-default', { enabled: false })
      const before = svc.listModels('grok-cli')
      svc.setImageSupport('grok-cli', true)
      const after = svc.listModels('grok-cli')
      expect(after.map((m) => m.updatedAt)).toEqual(before.map((m) => m.updatedAt))
      expect(after.find((m) => m.modelId === 'grok-cli-default')!.enabled).toBe(false)
    })

    it('an unknown provider changes nothing (negative)', () => {
      const svc = seed()
      svc.setImageSupport('no-such-cli', false)
      expect(svc.listModels('grok-cli').every((m) => m.supportsImages)).toBe(true)
      expect(svc.listModels('kimi-cli').every((m) => m.supportsImages)).toBe(true)
      expect(svc.listModels('no-such-cli')).toEqual([])
    })
  })

  describe('model_config.metadata (typed accessor)', () => {
    const model = { id: 'claude-opus-4-8', name: 'Opus', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true }
    const reasoning = { source: 'sdk', param: 'effort', levels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultLevel: 'high', adaptiveThinking: true, runtime: '2.1.280', discoveredAt: '2026-09-22T12:00:00.000Z' }

    /** A database created before the metadata column existed. */
    function withoutColumn() {
      db.run(sql`ALTER TABLE model_config DROP COLUMN metadata`)
    }

    function setMetadata(value: string | null) {
      db.run(sql`UPDATE model_config SET metadata = ${value} WHERE id = 'anthropic:claude-opus-4-8'`)
    }

    it('round-trips validated metadata including discovered reasoning', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [model])
      setMetadata(JSON.stringify({ alias: 'opus', realModelId: 'claude-opus-4-8', reasoning }))
      expect(svc.getModelMetadata('anthropic', 'claude-opus-4-8')).toEqual({ alias: 'opus', realModelId: 'claude-opus-4-8', reasoning })
      expect(svc.listModels('anthropic')[0].metadata?.reasoning?.levels).toContain('xhigh')
    })

    it('a refresh (upsert) keeps the stored metadata and the enabled choice', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [model])
      setMetadata(JSON.stringify({ realModelId: 'claude-opus-4-8' }))
      svc.updateModel('anthropic:claude-opus-4-8', { enabled: false })
      svc.upsertModels('anthropic', [{ ...model, name: 'Opus renamed' }])
      const row = svc.listModels('anthropic')[0]
      expect(row.name).toBe('Opus renamed')
      expect(row.enabled).toBe(false)
      expect(row.metadata).toEqual({ realModelId: 'claude-opus-4-8' })
    })

    it('reads null for no row, no metadata, and a database created before the column', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [model])
      expect(svc.getModelMetadata('anthropic', 'claude-opus-4-8')).toBeNull()
      expect(svc.getModelMetadata('anthropic', 'no-such-model')).toBeNull()
      expect(svc.listModels('anthropic')[0].metadata).toBeNull()
      withoutColumn()
      expect(svc.getModelMetadata('anthropic', 'claude-opus-4-8')).toBeNull()
      expect(svc.listModels('anthropic')[0].metadata).toBeNull()
    })

    it('corrupt JSON reads as null with one warning per row, never a throw', () => {
      const logger = { warn: vi.fn() }
      const svc = createProviderConfigService(db, logger as any)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [model])
      setMetadata('{not json')
      expect(svc.getModelMetadata('anthropic', 'claude-opus-4-8')).toBeNull()
      expect(svc.listModels('anthropic')[0].metadata).toBeNull()
      expect(logger.warn).toHaveBeenCalledTimes(1)
    })

    it('an invalid reasoning block is dropped while valid identity fields are kept', () => {
      const svc = createProviderConfigService(db)
      svc.ensureProvider('anthropic')
      svc.upsertModels('anthropic', [model])
      setMetadata(JSON.stringify({ realModelId: 'claude-opus-4-8', reasoning: { ...reasoning, levels: ['ultra'] } }))
      expect(svc.getModelMetadata('anthropic', 'claude-opus-4-8')).toEqual({ realModelId: 'claude-opus-4-8' })
    })
  })
})

// F2 — discovered facts persist, and a successful discovery reconciles the rows.
describe('ProviderConfigService — discovery persistence and reconcile', () => {
  const info = (id: string, metadata?: Record<string, unknown>) => ({
    id, name: id, provider: 'grok-cli', contextWindow: 500000, maxOutputTokens: 64000,
    supportsTools: true, supportsImages: false, supportsStreaming: true,
    ...(metadata ? { metadata } : {}),
  })
  const row = (svc: ReturnType<typeof createProviderConfigService>, modelId: string) =>
    svc.listModels('grok-cli').find((m) => m.modelId === modelId)!

  function seeded() {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('grok-cli')
    svc.reconcileDiscoveredModels('grok-cli', [
      info('grok-cli-default', { alias: 'default', realModelId: 'grok-4.6' }),
      info('grok-cli-grok-4.6', { realModelId: 'grok-4.6' }),
      info('grok-cli-grok-4.7', { realModelId: 'grok-4.7' }),
    ])
    return svc
  }

  it('upsert persists ModelInfo.metadata and survives a new service instance (restart)', () => {
    seeded()
    const fresh = createProviderConfigService(db)
    expect(fresh.getModelMetadata('grok-cli', 'grok-cli-grok-4.7')).toEqual({ realModelId: 'grok-4.7' })
    expect(fresh.getModelMetadata('grok-cli', 'grok-cli-default')).toEqual({ alias: 'default', realModelId: 'grok-4.6' })
  })

  it('a source without a fact never erases it; a newer discovery updates it', () => {
    const svc = seeded()
    svc.upsertModels('grok-cli', [info('grok-cli-grok-4.7')])
    expect(svc.getModelMetadata('grok-cli', 'grok-cli-grok-4.7')).toEqual({ realModelId: 'grok-4.7' })
    svc.upsertModels('grok-cli', [info('grok-cli-default', { alias: 'default', realModelId: 'grok-4.7' })])
    expect(svc.getModelMetadata('grok-cli', 'grok-cli-default')?.realModelId).toBe('grok-4.7')
  })

  it('invalid discovered metadata is not stored and never throws (negative)', () => {
    const logger = { warn: vi.fn() }
    const svc = createProviderConfigService(db, logger as any)
    svc.ensureProvider('grok-cli')
    svc.upsertModels('grok-cli', [info('grok-cli-x', { realModelId: 42 })])
    expect(svc.getModelMetadata('grok-cli', 'grok-cli-x')).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('a provider cannot set the missing-row bookkeeping through its catalog (negative)', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('grok-cli')
    svc.upsertModels('grok-cli', [info('grok-cli-x', { realModelId: 'x', missingSince: '2026-09-01T00:00:00.000Z', autoDisabled: true })])
    expect(svc.getModelMetadata('grok-cli', 'grok-cli-x')).toEqual({ realModelId: 'x' })
  })

  it('reconcile switches off and flags rows a successful discovery no longer offers, and restores them when they reappear', () => {
    const svc = seeded()
    const gone = svc.reconcileDiscoveredModels('grok-cli', [
      info('grok-cli-default', { alias: 'default', realModelId: 'grok-4.7' }),
      info('grok-cli-grok-4.7', { realModelId: 'grok-4.7' }),
    ])
    expect(gone).toEqual({ missing: ['grok-cli-grok-4.6'], restored: [] })
    const missing = row(svc, 'grok-cli-grok-4.6')
    expect(missing.enabled).toBe(false)
    expect(missing.metadata?.missingSince).toBeTruthy()
    expect(missing.metadata?.realModelId).toBe('grok-4.6')

    const back = svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-grok-4.6', { realModelId: 'grok-4.6' }), info('grok-cli-default')])
    expect(back.restored).toEqual(['grok-cli-grok-4.6'])
    const restored = row(svc, 'grok-cli-grok-4.6')
    expect(restored.enabled).toBe(true)
    expect(restored.metadata).toEqual({ realModelId: 'grok-4.6' })
  })

  it('never deletes a row, and a row already flagged keeps its first missingSince', () => {
    const svc = seeded()
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default')])
    const first = row(svc, 'grok-cli-grok-4.6').metadata?.missingSince
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default')])
    expect(svc.listModels('grok-cli').map((m) => m.modelId).sort()).toEqual(['grok-cli-default', 'grok-cli-grok-4.6', 'grok-cli-grok-4.7'])
    expect(row(svc, 'grok-cli-grok-4.6').metadata?.missingSince).toBe(first)
  })

  it('a row the user switched off is never switched back on by a discovery (negative)', () => {
    const svc = seeded()
    svc.updateModel('grok-cli:grok-cli-grok-4.6', { enabled: false })
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default')])
    expect(row(svc, 'grok-cli-grok-4.6').metadata?.autoDisabled).toBeUndefined()
    const back = svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default'), info('grok-cli-grok-4.6')])
    expect(back.restored).toEqual([])
    expect(row(svc, 'grok-cli-grok-4.6').enabled).toBe(false)
    expect(row(svc, 'grok-cli-grok-4.6').metadata?.missingSince).toBeUndefined()
  })

  it('a missing row the user switches back on stays on: the user owns it from then on', () => {
    const svc = seeded()
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default')])
    svc.updateModel('grok-cli:grok-cli-grok-4.6', { enabled: true })
    expect(row(svc, 'grok-cli-grok-4.6').metadata?.autoDisabled).toBeUndefined()
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default')])
    expect(row(svc, 'grok-cli-grok-4.6').enabled).toBe(true)
    // Switched off by the user again: its return does not switch it on.
    svc.updateModel('grok-cli:grok-cli-grok-4.6', { enabled: false })
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default'), info('grok-cli-grok-4.6')])
    expect(row(svc, 'grok-cli-grok-4.6').enabled).toBe(false)
  })

  it('an empty discovery proves nothing and changes nothing (negative)', () => {
    const svc = seeded()
    const before = svc.listModels('grok-cli')
    expect(svc.reconcileDiscoveredModels('grok-cli', [])).toEqual({ missing: [], restored: [] })
    expect(svc.listModels('grok-cli')).toEqual(before)
  })

  it('a reconcile touches only its own provider', () => {
    const svc = seeded()
    svc.ensureProvider('kimi-cli')
    svc.upsertModels('kimi-cli', [{ ...info('kimi-cli-default'), provider: 'kimi-cli' }])
    svc.reconcileDiscoveredModels('grok-cli', [info('grok-cli-default')])
    expect(svc.listModels('kimi-cli')[0].enabled).toBe(true)
    expect(svc.listModels('kimi-cli')[0].metadata).toBeNull()
  })
})

describe('parseModelConfigMetadata', () => {
  it('rejects non-objects and wrongly typed identity fields', () => {
    const warn = vi.fn()
    expect(parseModelConfigMetadata('[1,2]', warn)).toBeNull()
    expect(parseModelConfigMetadata('"text"', warn)).toBeNull()
    expect(parseModelConfigMetadata(JSON.stringify({ realModelId: 42 }), warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('accepts an already-parsed object, strips unknown keys and treats empty as nothing stored', () => {
    expect(parseModelConfigMetadata({ alias: 'default', futureKey: true })).toEqual({ alias: 'default' })
    expect(parseModelConfigMetadata('')).toBeNull()
    expect(parseModelConfigMetadata(null)).toBeNull()
  })

  it("(+) keeps a local runtime's own reasoning setting (display only, F9)", () => {
    const runtimeReasoning = { options: ['off', 'on'], default: 'on' }
    expect(parseModelConfigMetadata(JSON.stringify({ discoveredAt: '2026-09-23T10:00:00.000Z', runtimeReasoning }))).toEqual({
      discoveredAt: '2026-09-23T10:00:00.000Z',
      runtimeReasoning,
    })
  })

  it('(−) an invalid runtimeReasoning is dropped alone, keeping the identity fields and the discovered reasoning', () => {
    const warn = vi.fn()
    const reasoning = { source: 'models-api', param: 'none', levels: [], discoveredAt: '2026-09-23T10:00:00.000Z' }
    const parsed = parseModelConfigMetadata({ realModelId: 'qwen/qwen3-8b', reasoning, runtimeReasoning: { options: 'on', default: 7 } }, warn)
    expect(parsed).toEqual({ realModelId: 'qwen/qwen3-8b', reasoning })
    expect(warn).toHaveBeenCalledWith('metadata.runtimeReasoning failed validation; ignored', expect.anything())
  })
})
