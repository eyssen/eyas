import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService } from '@modules/model/provider-config-service'

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
})
