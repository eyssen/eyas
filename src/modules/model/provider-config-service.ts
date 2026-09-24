// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Logger } from 'pino'
import type { ModelInfo } from './types.js'
import { DiscoveredReasoningSchema } from './reasoning/schemas.js'

const IsoTimestamp = z.string().datetime({ offset: true })

/** A local runtime's own reasoning setting (display only; see ModelConfigMetadataSchema.runtimeReasoning). */
const RuntimeReasoningSchema = z.object({
  options: z.array(z.string().min(1).max(32)).max(16),
  default: z.string().min(1).max(32).nullable(),
})

/**
 * Provider-discovered facts about one model row (model_config.metadata, JSON).
 * `reasoning` is THE discovered-reasoning shape the capability registry reads;
 * the identity fields tell EYAS which concrete model an EYAS id runs.
 * Unknown keys are stripped, so a row written by a newer EYAS still reads.
 */
export const ModelConfigMetadataSchema = z.object({
  /** CLI alias the model is selected by (e.g. 'opus' for Claude Code). */
  alias: z.string().min(1).max(200).optional(),
  /** The concrete upstream model id behind an EYAS model id. */
  realModelId: z.string().min(1).max(300).optional(),
  runtimeVersion: z.string().min(1).max(64).optional(),
  cliVersion: z.string().min(1).max(64).optional(),
  discoveredAt: IsoTimestamp.optional(),
  /** Set when a successful discovery no longer offered this model. */
  missingSince: IsoTimestamp.optional(),
  /**
   * The reconcile itself switched this row off when it went missing, so it may
   * switch it back on when a discovery offers it again. A row the user
   * switched off (or toggled since) never carries it.
   */
  autoDisabled: z.boolean().optional(),
  reasoning: DiscoveredReasoningSchema.optional(),
  /**
   * Informational only: a reasoning setting the local runtime controls itself
   * (LM Studio's capabilities.reasoning). Never read by the capability
   * registry, so it can never put a reasoning parameter on the wire.
   */
  runtimeReasoning: RuntimeReasoningSchema.optional(),
})

export type ModelConfigMetadata = z.infer<typeof ModelConfigMetadataSchema>

const MetadataIdentitySchema = ModelConfigMetadataSchema.omit({ reasoning: true, runtimeReasoning: true })

/** What a discovery reports; the missing-row bookkeeping belongs to the reconcile alone. */
type DiscoveredMetadata = Omit<ModelConfigMetadata, 'missingSince' | 'autoDisabled'>

/** What one successful discovery changed (model ids). */
export interface ReconcileOutcome {
  /** Rows the discovery no longer offers, flagged missing by this run. */
  missing: string[]
  /** Rows the reconcile had switched off that are offered again and back on. */
  restored: string[]
}

type WarnLogger = Pick<Logger, 'warn'>

/**
 * Parse a stored metadata cell. A corrupt cell never throws: it reads as null
 * (and an invalid `reasoning` or `runtimeReasoning` block alone is dropped,
 * keeping the identity fields), with one warning per row so a bad row is
 * visible but not noisy.
 */
export function parseModelConfigMetadata(
  raw: unknown,
  warn: (reason: string, detail?: unknown) => void = () => {},
): ModelConfigMetadata | null {
  if (raw === null || raw === undefined || raw === '') return null
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      warn('metadata is not valid JSON')
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warn('metadata is not an object')
    return null
  }
  const { reasoning, runtimeReasoning, ...identity } = value as Record<string, unknown>
  const base = MetadataIdentitySchema.safeParse(identity)
  if (!base.success) {
    warn('metadata failed validation', base.error.issues.slice(0, 5))
    return null
  }
  let result: ModelConfigMetadata = base.data
  // The display-only runtime setting is optional too: an invalid one is dropped alone.
  if (runtimeReasoning !== undefined && runtimeReasoning !== null) {
    const parsedRuntime = RuntimeReasoningSchema.safeParse(runtimeReasoning)
    if (parsedRuntime.success) result = { ...result, runtimeReasoning: parsedRuntime.data }
    else warn('metadata.runtimeReasoning failed validation; ignored', parsedRuntime.error.issues.slice(0, 5))
  }
  if (reasoning === undefined || reasoning === null) return result
  const parsedReasoning = DiscoveredReasoningSchema.safeParse(reasoning)
  if (!parsedReasoning.success) {
    warn('metadata.reasoning failed validation; ignored', parsedReasoning.error.issues.slice(0, 5))
    return result
  }
  return { ...result, reasoning: parsedReasoning.data }
}

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
  /** Validated model_config.metadata; null when absent or unreadable. */
  metadata: ModelConfigMetadata | null
}

export interface ProviderConfigService {
  ensureProvider(id: string): ProviderConfigRow
  getProvider(id: string): ProviderConfigRow | null
  updateProvider(id: string, update: { enabled?: boolean; settings?: Record<string, unknown> }): void
  listProviders(): ProviderConfigRow[]
  /**
   * Insert or update rows from a provider's catalog. The user's enabled
   * choice is kept; ModelInfo.metadata (validated) is merged over what is
   * stored, so a source that does not know a fact never erases it.
   */
  upsertModels(providerId: string, models: ModelInfo[]): void
  /**
   * Apply one SUCCESSFUL discovery: upsert what it offers, then flag every
   * other row of the provider missing (metadata.missingSince) and switch it
   * off. Rows are never deleted; a row reappearing is unflagged, and switched
   * back on only when this reconcile had switched it off. An empty list
   * proves nothing and changes nothing.
   */
  reconcileDiscoveredModels(providerId: string, models: ModelInfo[]): ReconcileOutcome
  listModels(providerId: string): ModelConfigRow[]
  listEnabledModels(providerId: string): ModelInfo[]
  /** Validated metadata of one model row (null: no row, nothing stored, or unreadable). */
  getModelMetadata(providerId: string, modelId: string): ModelConfigMetadata | null
  updateModel(id: string, update: { enabled?: boolean }): void
  /**
   * Set the Vision flag (supports_images) on every model row of one provider,
   * from what its CLI reports it accepts. Rows that already match are left
   * alone; a provider without rows changes nothing.
   */
  setImageSupport(providerId: string, supported: boolean): void
  getDefault(): { providerId: string; modelId: string } | null
  setDefault(providerId: string, modelId: string): void
}

export function createProviderConfigService(db: any, logger?: WarnLogger): ProviderConfigService {
  const warnedRows = new Set<string>()
  function parseRowMetadata(rowId: string, raw: unknown): ModelConfigMetadata | null {
    return parseModelConfigMetadata(raw, (reason, detail) => {
      if (warnedRows.has(rowId)) return
      warnedRows.add(rowId)
      logger?.warn({ modelConfigId: rowId, detail }, `model_config: ${reason}`)
    })
  }

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
      metadata: parseRowMetadata(raw.id, raw.metadata),
    }
  }

  /** A catalog entry's metadata as a discovery fact set; invalid → null, never a throw. */
  function discoveredMetadata(providerId: string, m: ModelInfo): DiscoveredMetadata | null {
    if (!m.metadata) return null
    const parsed = parseModelConfigMetadata(m.metadata, (reason, detail) => {
      logger?.warn({ providerId, modelId: m.id, detail }, `model_config: discovered ${reason}; not stored`)
    })
    if (!parsed) return null
    const { missingSince: _missing, autoDisabled: _auto, ...facts } = parsed
    return facts
  }

  function metadataCell(metadata: ModelConfigMetadata | null): string | null {
    return metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null
  }

  /**
   * Upsert one catalog entry. `offered` marks a successful discovery naming
   * it: a missing flag is cleared, and a row the reconcile had switched off
   * is switched back on. Returns true when it switched the row back on.
   */
  function upsertRow(providerId: string, m: ModelInfo, now: string, offered: boolean): boolean {
    const compositeId = `${providerId}:${m.id}`
    const existing = (db.all(sql`SELECT * FROM model_config WHERE id = ${compositeId}`) as any[])[0]
    const stored = existing ? parseRowMetadata(compositeId, existing.metadata) : null
    const facts = discoveredMetadata(providerId, m)
    let metadata: ModelConfigMetadata | null = facts ? { ...(stored ?? {}), ...facts } : stored
    let enabled = existing ? existing.enabled === 1 : true
    let restored = false
    if (offered && metadata?.missingSince) {
      const { missingSince: _gone, autoDisabled, ...rest } = metadata
      if (autoDisabled && !enabled) {
        enabled = true
        restored = true
      }
      metadata = rest
    }
    // An upsert, not INSERT OR REPLACE: a replace deletes the row first and
    // would silently reset every column it does not list.
    db.run(sql`INSERT INTO model_config (id, provider_id, model_id, enabled, name, context_window, max_output_tokens, supports_tools, supports_images, supports_streaming, updated_at, metadata)
      VALUES (${compositeId}, ${providerId}, ${m.id}, ${enabled ? 1 : 0}, ${m.name}, ${m.contextWindow}, ${m.maxOutputTokens}, ${m.supportsTools ? 1 : 0}, ${m.supportsImages ? 1 : 0}, ${m.supportsStreaming ? 1 : 0}, ${now}, ${metadataCell(metadata)})
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        enabled = excluded.enabled,
        name = excluded.name,
        context_window = excluded.context_window,
        max_output_tokens = excluded.max_output_tokens,
        supports_tools = excluded.supports_tools,
        supports_images = excluded.supports_images,
        supports_streaming = excluded.supports_streaming,
        updated_at = excluded.updated_at,
        metadata = excluded.metadata`)
    return restored
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
      for (const m of models) upsertRow(providerId, m, now, false)
    },

    reconcileDiscoveredModels(providerId: string, models: ModelInfo[]): ReconcileOutcome {
      const outcome: ReconcileOutcome = { missing: [], restored: [] }
      if (models.length === 0) return outcome
      const now = new Date().toISOString()
      const offered = new Set<string>()
      for (const m of models) {
        offered.add(m.id)
        if (upsertRow(providerId, m, now, true)) outcome.restored.push(m.id)
      }
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId}`) as any[]
      for (const row of rows) {
        if (offered.has(row.model_id)) continue
        const stored = parseRowMetadata(row.id, row.metadata)
        // Flagged by an earlier discovery: the user may have switched it back
        // on since, and that choice stands.
        if (stored?.missingSince) continue
        const wasEnabled = row.enabled === 1
        const metadata: ModelConfigMetadata = {
          ...(stored ?? {}),
          missingSince: now,
          ...(wasEnabled ? { autoDisabled: true } : {}),
        }
        db.run(sql`UPDATE model_config SET enabled = 0, metadata = ${metadataCell(metadata)}, updated_at = ${now} WHERE id = ${row.id}`)
        outcome.missing.push(row.model_id)
      }
      return outcome
    },

    listModels(providerId: string): ModelConfigRow[] {
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} ORDER BY name`) as any[]
      return rows.map(toModelRow)
    },

    listEnabledModels(providerId: string): ModelInfo[] {
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} AND enabled = 1 ORDER BY name`) as any[]
      return rows.map(toModelRow).map(modelRowToInfo)
    },

    getModelMetadata(providerId: string, modelId: string): ModelConfigMetadata | null {
      // SELECT * (not the column by name): a database created before the
      // metadata column existed simply reads as "nothing stored".
      const rows = db.all(sql`SELECT * FROM model_config WHERE provider_id = ${providerId} AND model_id = ${modelId} LIMIT 1`) as any[]
      if (rows.length === 0) return null
      return parseRowMetadata(rows[0].id, rows[0].metadata)
    },

    updateModel(id: string, update: { enabled?: boolean }): void {
      const now = new Date().toISOString()
      if (update.enabled !== undefined) {
        db.run(sql`UPDATE model_config SET enabled = ${update.enabled ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
        // The user's toggle now owns the row: a later discovery may unflag it,
        // but never switches it back on by itself.
        const row = (db.all(sql`SELECT * FROM model_config WHERE id = ${id}`) as any[])[0]
        const stored = row ? parseRowMetadata(id, row.metadata) : null
        if (stored?.autoDisabled) {
          const { autoDisabled: _released, ...rest } = stored
          db.run(sql`UPDATE model_config SET metadata = ${metadataCell(rest)} WHERE id = ${id}`)
        }
      }
    },

    setImageSupport(providerId: string, supported: boolean): void {
      const value = supported ? 1 : 0
      const now = new Date().toISOString()
      db.run(sql`UPDATE model_config SET supports_images = ${value}, updated_at = ${now}
        WHERE provider_id = ${providerId} AND supports_images IS NOT ${value}`)
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
