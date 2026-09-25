// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import {
  OPENCODE_ID_PATTERN,
  OPENCODE_MODEL_ID_MAX,
  OPENCODE_VARIANT_MAX,
  type OpencodeModelRef,
  type OpencodeSettings,
} from './types.js'

const MAX_PTY_SESSIONS_CAP = 16
const MIN_PTY_SESSIONS = 1
const MIN_COLS = 20
const MAX_COLS = 400
const MIN_ROWS = 8
const MAX_ROWS = 200

export function defaultOpencodeSettings(): OpencodeSettings {
  return {
    enabled: true,
    cliPath: null,
    attachUrl: null,
    maxPtySessions: 4,
    defaultCols: 120,
    defaultRows: 32,
    model: null,
    variant: null,
  }
}

/** A trimmed, bounded id without control characters; anything else → null. */
function boundedId(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!id || id.length > max || !OPENCODE_ID_PATTERN.test(id)) return null
  return id
}

function normalizeModel(value: unknown): OpencodeModelRef | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  const providerID = boundedId(rec.providerID, OPENCODE_MODEL_ID_MAX)
  const modelID = boundedId(rec.modelID, OPENCODE_MODEL_ID_MAX)
  return providerID && modelID ? { providerID, modelID } : null
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const n = Math.trunc(value)
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * Keys other than the ones below are dropped — including the retired
 * `isolatedConfig` toggle: a spawned OpenCode always runs isolated.
 */
export function normalizeOpencodeSettings(parsed: Partial<OpencodeSettings> | null | undefined): OpencodeSettings {
  const base = defaultOpencodeSettings()
  if (!parsed || typeof parsed !== 'object') return base
  const attach = parsed.attachUrl
  const model = normalizeModel(parsed.model)
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
    cliPath: parsed.cliPath === null || typeof parsed.cliPath === 'string' ? parsed.cliPath : base.cliPath,
    attachUrl: attach === null || typeof attach === 'string' ? attach : base.attachUrl,
    maxPtySessions: clampInt(parsed.maxPtySessions, MIN_PTY_SESSIONS, MAX_PTY_SESSIONS_CAP, base.maxPtySessions),
    defaultCols: clampInt(parsed.defaultCols, MIN_COLS, MAX_COLS, base.defaultCols),
    defaultRows: clampInt(parsed.defaultRows, MIN_ROWS, MAX_ROWS, base.defaultRows),
    model,
    // A variant belongs to a model: without one it is meaningless.
    variant: model ? boundedId(parsed.variant, OPENCODE_VARIANT_MAX) : null,
  }
}

export function load(db: EyasDb): OpencodeSettings {
  const row = db.all<{ json: string }>(sql`SELECT json FROM opencode_settings WHERE id = 'default'`)[0]
  if (!row?.json) return defaultOpencodeSettings()
  try {
    return normalizeOpencodeSettings(JSON.parse(row.json) as Partial<OpencodeSettings>)
  } catch {
    return defaultOpencodeSettings()
  }
}

export function save(db: EyasDb, settings: OpencodeSettings): void {
  const now = new Date().toISOString()
  const next = normalizeOpencodeSettings(settings)
  db.run(sql`INSERT INTO opencode_settings (id, json, updated_at)
    VALUES ('default', ${JSON.stringify(next)}, ${now})
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
}
