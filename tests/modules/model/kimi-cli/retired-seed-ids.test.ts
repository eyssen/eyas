// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F11 — earlier releases seeded kimi-cli-k3 / -k2.7-code / -k2.6. They named
// Moonshot API models, not keys of the Kimi CLI's config, and `kimi acp`
// ignored them, so each ran the CLI's default. Now that the model is selected
// in-session, EYAS moves the configuration it seeded itself (routing tiers,
// the provider default) to kimi-cli-default — what those ids always ran — and
// seeds new tiers with it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../../helpers/test-db'
import {
  KIMI_CLI_TIER_DEFAULTS,
  RETIRED_KIMI_CLI_MODEL_IDS,
  repointRetiredKimiCliModels,
} from '@modules/model/onboarding-reconcile'
import { resolveTier } from '@modules/model/tier-resolver'

const testDb = createTestDb('kimi-retired-seed-ids')
let db: ReturnType<typeof testDb.open>

function tier(name: string, providerId: string, modelId: string, fallbackProviderId: string | null, fallbackModelId: string | null) {
  db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id, fallback_provider_id, fallback_model_id, updated_at)
    VALUES (${name}, ${providerId}, ${modelId}, ${fallbackProviderId}, ${fallbackModelId}, '2026-01-01T00:00:00.000Z')`)
}
const row = (name: string) => (db.all(sql`SELECT * FROM routing_tiers WHERE tier = ${name}`) as any[])[0]
const kimiDefault = () => (db.all(sql`SELECT default_model FROM provider_config WHERE id = 'kimi-cli'`) as any[])[0]?.default_model

beforeEach(() => {
  db = testDb.open()
  db.run(sql`CREATE TABLE IF NOT EXISTS routing_tiers (
    tier TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
    fallback_provider_id TEXT, fallback_model_id TEXT, description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)`)
})

afterEach(() => testDb.cleanup())

describe('repointRetiredKimiCliModels', () => {
  it('moves tiers, fallbacks and the provider default off the retired ids (positive)', () => {
    tier('triage', 'kimi-cli', 'kimi-cli-k2.6', 'kimi-cli', 'kimi-cli-default')
    tier('complex', 'kimi-cli', 'kimi-cli-k3', 'kimi-cli', 'kimi-cli-default')
    tier('standard', 'kimi-cli', 'kimi-cli-default', 'kimi-cli', 'kimi-cli-k2.6')
    tier('code', 'grok-cli', 'grok-cli-default', 'kimi-cli', 'kimi-cli-k2.7-code')
    db.run(sql`INSERT INTO provider_config (id, default_model, updated_at) VALUES ('kimi-cli', 'kimi-cli-k3', '2026-01-01T00:00:00.000Z')`)

    expect(repointRetiredKimiCliModels(db)).toBe(5)
    expect(row('triage')).toMatchObject({ model_id: 'kimi-cli-default', fallback_model_id: 'kimi-cli-default' })
    expect(row('complex').model_id).toBe('kimi-cli-default')
    // A fallback that would only repeat its tier's own model is cleared.
    expect(row('standard')).toMatchObject({ model_id: 'kimi-cli-default', fallback_provider_id: null, fallback_model_id: null })
    // Another provider's tier keeps its model; only the Kimi fallback moves.
    expect(row('code')).toMatchObject({ provider_id: 'grok-cli', model_id: 'grok-cli-default', fallback_model_id: 'kimi-cli-default' })
    expect(kimiDefault()).toBe('kimi-cli-default')
  })

  it('is idempotent and never touches other ids or providers (negative)', () => {
    tier('triage', 'kimi-cli', 'kimi-cli-kimi-code/kimi-for-coding', null, null)
    tier('quick', 'kimi', 'kimi-k2.6', null, null)
    tier('heartbeat', 'grok-cli', 'kimi-cli-k3', null, null)
    db.run(sql`INSERT INTO provider_config (id, default_model, updated_at) VALUES ('kimi-cli', 'kimi-cli-k2.6-custom', '2026-01-01T00:00:00.000Z')`)
    expect(repointRetiredKimiCliModels(db)).toBe(0)
    expect(row('triage').model_id).toBe('kimi-cli-kimi-code/kimi-for-coding')
    expect(row('quick').model_id).toBe('kimi-k2.6')
    expect(row('heartbeat').model_id).toBe('kimi-cli-k3')
    expect(kimiDefault()).toBe('kimi-cli-k2.6-custom')
    // Twice in a row: the second run finds nothing.
    tier('complex', 'kimi-cli', 'kimi-cli-k3', null, null)
    expect(repointRetiredKimiCliModels(db)).toBe(1)
    expect(repointRetiredKimiCliModels(db)).toBe(0)
  })
})

describe('Kimi CLI defaults for new installs', () => {
  it('seed every tier with the CLI default and no retired id', () => {
    for (const mapping of Object.values(KIMI_CLI_TIER_DEFAULTS)) {
      expect(mapping!.modelId).toBe('kimi-cli-default')
      expect(RETIRED_KIMI_CLI_MODEL_IDS).not.toContain(mapping!.fallbackModelId)
    }
  })

  it('the agent-type tier resolver picks the CLI default for every tier', () => {
    const providers = [{ providerId: 'kimi-cli', modelIds: ['kimi-cli-default', 'kimi-cli-k3'] }]
    for (const t of ['opus', 'sonnet', 'haiku'] as const) {
      expect(resolveTier(t, providers)).toEqual({ provider: 'kimi-cli', modelId: 'kimi-cli-default' })
    }
  })
})
