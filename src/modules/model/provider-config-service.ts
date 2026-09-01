// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ModelInfo } from './types.js'

export interface ProviderConfigRow {
  id: string
  enabled: boolean
  settings: Record<string, unknown>
  isDefault: boolean
  defaultModel: string | null
  updatedAt: string
}

export interface ModelConfigRow {
  id: string
  providerId: string
  modelId: string
  enabled: boolean
  name: string
  contextWindow: number | null
  maxOutputTokens: number | null
  supportsTools: boolean
  supportsImages: boolean
  supportsStreaming: boolean
  updatedAt: string
}

export interface ProviderConfigService {
  ensureProvider(id: string): ProviderConfigRow
  getProvider(id: string): ProviderConfigRow | null
  updateProvider(id: string, update: { enabled?: boolean; settings?: Record<string, unknown> }): void
  listProviders(): ProviderConfigRow[]
  upsertModels(providerId: string, models: ModelInfo[]): void
  listModels(providerId: string): ModelConfigRow[]
  listEnabledModels(providerId: string): ModelInfo[]
  updateModel(id: string, update: { enabled?: boolean }): void
  getDefault(): { providerId: string; modelId: string } | null
  setDefault(providerId: string, modelId: string): void
}

export function createProviderConfigService(db: any): ProviderConfigService {
  function toRow(raw: any): ProviderConfigRow {
    return {
      id: raw.id,
      enabled: raw.enabled === 1,
      settings: JSON.parse(raw.settings || '{}'),
      isDefault: raw.is_default === 1,
      defaultModel: raw.default_model,
      updatedAt: raw.updated_at,
    }
  }

  function toModelRow(raw: any): ModelConfigRow {
    return {
      id: raw.id,
      providerId: raw.provider_id,
      modelId: raw.model_id,
      enabled: raw.enabled === 1,
      name: raw.name,
      contextWindow: raw.context_window,
      maxOutputTokens: raw.max_output_tokens,
      supportsTools: raw.supports_tools === 1,
      supportsImages: raw.supports_images === 1,
      supportsStreaming: raw.supports_streaming === 1,
      updatedAt: raw.updated_at,
    }
  }

  function modelRowToInfo(row: ModelConfigRow): ModelInfo {
    return {
      id: row.modelId,
      name: row.name,
      provider: row.providerId,
      contextWindow: row.contextWindow ?? 0,
      maxOutputTokens: row.maxOutputTokens ?? 0,
      supportsTools: row.supportsTools,
      supportsImages: row.supportsImages,
      supportsStreaming: row.supportsStreaming,
    }
  }

  return {
    ensureProvider(id: string): ProviderConfigRow {
      const existing = db.all(sql`SELECT * FROM provider_config WHERE id = ${id}`) as any[]
      if (existing.length > 0) return toRow(existing[0])
      // New provider rows start disabled — a provider is only "on" once the
      // user configures it (adds a key) or an onboarding reconcile (e.g.
      // Claude Code CLI auto-detect) explicitly opts it in. Existing rows are
      // never touched here, so already-configured installs are unaffected.
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO provider_config (id, enabled, settings, is_default, default_model, updated_at) VALUES (${id}, 0, '{}', 0, ${null}, ${now})`)
      return { id, enabled: false, settings: {}, isDefault: false, defaultModel: null, updatedAt: now }
    },

    getProvider(id: string): ProviderConfigRow | null {
      const rows = db.all(sql`SELECT * FROM provider_config WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toRow(rows[0]) : null
    },

    updateProvider(id: string, update: { enabled?: boolean; settings?: Record<string, unknown> }): void {
      const now = new Date().toISOString()
      if (update.enabled !== undefined) {
        db.run(sql`UPDATE provider_config SET enabled = ${update.enabled ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
      }
      if (update.settings !== undefined) {
        db.run(sql`UPDATE provider_config SET settings = ${JSON.stringify(update.settings)}, updated_at = ${now} WHERE id = ${id}`)
      }
    },

    listProviders(): ProviderConfigRow[] {
      const rows = db.all(sql`SELECT * FROM provider_config ORDER BY id`) as any[]
      return rows.map(toRow)
    },

    upsertModels(providerId: string, models: ModelInfo[]): void {
      const now = new Date().toISOString()
      for (const m of models) {
        const compositeId = `${providerId}:${m.id}`
        const existing = db.all(sql`SELECT enabled FROM model_config WHERE id = ${compositeId}`) as any[]
        const enabled = existing.length > 0 ? existing[0].enabled : 1
        db.run(sql`INSERT OR REPLACE INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at)
          VALUES (${compositeId}, ${providerId}, ${m.id}, ${enabled}, ${m.name}, ${m.contextWindow}, ${m.maxOutputTokens}, ${m.supportsTools ? 1 : 0}, ${m.supportsImages ? 1 : 0}, ${m.supportsStreaming ? 1 : 0}, ${now})`)
      }
    },

    listModels(providerId: string): ModelConfigRow[] {
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} ORDER BY name`) as any[]
      return rows.map(toModelRow)
    },

    listEnabledModels(providerId: string): ModelInfo[] {
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} AND enabled = 1 ORDER BY name`) as any[]
      return rows.map(toModelRow).map(modelRowToInfo)
    },

    updateModel(id: string, update: { enabled?: boolean }): void {
      const now = new Date().toISOString()
      if (update.enabled !== undefined) {
        db.run(sql`UPDATE model_config SET enabled = ${update.enabled ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
      }
    },

    getDefault(): { providerId: string; modelId: string } | null {
      const rows = db.all(sql`SELECT id, default_model FROM provider_config WHERE is_default = 1`) as any[]
      if (rows.length === 0 || !rows[0].default_model) return null
      return { providerId: rows[0].id, modelId: rows[0].default_model }
    },

    setDefault(providerId: string, modelId: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE provider_config SET is_default = 0, updated_at = ${now}`)
      db.run(sql`UPDATE provider_config SET is_default = 1, default_model = ${modelId}, updated_at = ${now} WHERE id = ${providerId}`)
    },
  }
}
