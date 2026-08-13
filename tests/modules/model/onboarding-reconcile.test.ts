// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import {
  reconcileClaudeCodeTiers,
  reconcileCliProviderTiers,
  applyClaudeCodeFreshDefaults,
  applyCliFreshDefaults,
  applyPrimaryCliProvider,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_DEFAULT_MODEL,
  GROK_CLI_PROVIDER_ID,
  GROK_CLI_DEFAULT_MODEL,
} from '@modules/model/onboarding-reconcile'
import { DEFAULT_TIERS } from '@modules/model/routing/types'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'

const testDb = createTestDb('onboarding-reconcile')
let db: ReturnType<typeof testDb.open>
let providerConfig: ProviderConfigService

/** Mirrors the routing_tiers table + DEFAULT_TIERS seed from model/index.ts onRegister. */
function seedRoutingTiers() {
  db.run(sql`CREATE TABLE IF NOT EXISTS routing_tiers (
    tier TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    fallback_provider_id TEXT,
    fallback_model_id TEXT,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  const now = new Date().toISOString()
  for (const t of DEFAULT_TIERS) {
    db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id, fallback_provider_id, fallback_model_id, description, enabled, updated_at)
      VALUES (${t.tier}, ${t.providerId}, ${t.modelId}, ${t.fallbackProviderId}, ${t.fallbackModelId}, ${t.description}, ${t.enabled ? 1 : 0}, ${now})`)
  }
}

function tierRow(tier: string) {
  return (db.all(sql`SELECT * FROM routing_tiers WHERE tier = ${tier}`) as any[])[0]
}

beforeEach(() => {
  db = testDb.open()
  seedRoutingTiers()
  providerConfig = createProviderConfigService(db)
})

afterEach(() => testDb.cleanup())

describe('reconcileClaudeCodeTiers', () => {
  it('fills empty tiers with Claude Code models when available (spot-check standard/complex/triage)', () => {
    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)

    const filled = reconcileClaudeCodeTiers(db, true)

    expect(filled.sort()).toEqual(
      ['triage', 'quick', 'standard', 'complex', 'code', 'heartbeat', 'prompt_enhancer'].sort(),
    )

    const standard = tierRow('standard')
    expect(standard.provider_id).toBe('claude-code')
    expect(standard.model_id).toBe('claude-code-sonnet')
    expect(standard.fallback_provider_id).toBe('claude-code')
    expect(standard.fallback_model_id).toBe('claude-code-haiku')

    const complex = tierRow('complex')
    expect(complex.provider_id).toBe('claude-code')
    expect(complex.model_id).toBe('claude-code-opus')
    expect(complex.fallback_model_id).toBe('claude-code-sonnet')

    const triage = tierRow('triage')
    expect(triage.provider_id).toBe('claude-code')
    expect(triage.model_id).toBe('claude-code-haiku')
    expect(triage.fallback_model_id).toBe('claude-code-sonnet')

    const heartbeat = tierRow('heartbeat')
    expect(heartbeat.model_id).toBe('claude-code-haiku')
    expect(heartbeat.fallback_provider_id).toBeNull()
    expect(heartbeat.fallback_model_id).toBeNull()
  })

  it('never assigns the embedding tier — Claude Code has no embedding model', () => {
    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    const filled = reconcileClaudeCodeTiers(db, true)

    expect(filled).not.toContain('embedding')
    const embedding = tierRow('embedding')
    expect(embedding.provider_id).toBe('')
  })

  it('never overwrites a tier the user already configured', () => {
    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    const now = new Date().toISOString()
    db.run(sql`UPDATE routing_tiers SET provider_id = 'anthropic', model_id = 'claude-sonnet-4-6', updated_at = ${now} WHERE tier = 'standard'`)

    const filled = reconcileClaudeCodeTiers(db, true)

    expect(filled).not.toContain('standard')
    const standard = tierRow('standard')
    expect(standard.provider_id).toBe('anthropic')
    expect(standard.model_id).toBe('claude-sonnet-4-6')
  })

  it('is a no-op when Claude Code is not available', () => {
    const filled = reconcileClaudeCodeTiers(db, false)
    expect(filled).toEqual([])
    for (const t of DEFAULT_TIERS) {
      expect(tierRow(t.tier).provider_id).toBe('')
    }
  })

  it('is idempotent — calling it twice does not change already-filled tiers', () => {
    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    reconcileClaudeCodeTiers(db, true)
    const firstRun = tierRow('standard')
    const secondFilled = reconcileClaudeCodeTiers(db, true)
    expect(secondFilled).toEqual([])
    expect(tierRow('standard')).toEqual(firstRun)
  })

  it('fills the claude-code provider default_model column when unset, without touching is_default', () => {
    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    reconcileClaudeCodeTiers(db, true)
    const cfg = providerConfig.getProvider(CLAUDE_CODE_PROVIDER_ID)
    expect(cfg!.defaultModel).toBe(CLAUDE_CODE_DEFAULT_MODEL)
    expect(cfg!.isDefault).toBe(false)
  })

  it('uses the real Claude Code provider listModels() output to derive availability (non-empty)', async () => {
    const realProvider = createClaudeCodeProvider()
    const models = await realProvider.listModels()
    expect(models.length).toBeGreaterThan(0)

    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    const filled = reconcileClaudeCodeTiers(db, models.length > 0)
    expect(filled.length).toBeGreaterThan(0)
  })

  it('treats a minimal stub provider with an empty listModels() as unavailable', async () => {
    const stubProvider = { listModels: async () => [] }
    const models = await stubProvider.listModels()

    const filled = reconcileClaudeCodeTiers(db, models.length > 0)
    expect(filled).toEqual([])
  })
})

describe('ensureProvider default (Fix 2 — off by default)', () => {
  it('creates a fresh provider row disabled', () => {
    const cfg = providerConfig.ensureProvider('anthropic')
    expect(cfg.enabled).toBe(false)
  })

  it('does not touch an existing row', () => {
    providerConfig.ensureProvider('anthropic')
    providerConfig.updateProvider('anthropic', { enabled: true })
    const cfg = providerConfig.ensureProvider('anthropic')
    expect(cfg.enabled).toBe(true)
  })
})

describe('applyClaudeCodeFreshDefaults', () => {
  it('enables claude-code and marks it the global default on fresh state', () => {
    const fresh = providerConfig.getProvider(CLAUDE_CODE_PROVIDER_ID) === null
    expect(fresh).toBe(true)

    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    expect(providerConfig.getProvider(CLAUDE_CODE_PROVIDER_ID)!.enabled).toBe(false)

    applyClaudeCodeFreshDefaults(providerConfig)

    const cfg = providerConfig.getProvider(CLAUDE_CODE_PROVIDER_ID)!
    expect(cfg.enabled).toBe(true)
    expect(cfg.isDefault).toBe(true)
    expect(cfg.defaultModel).toBe(CLAUDE_CODE_DEFAULT_MODEL)
    expect(providerConfig.getDefault()).toEqual({ providerId: CLAUDE_CODE_PROVIDER_ID, modelId: CLAUDE_CODE_DEFAULT_MODEL })
  })

  it('unconditionally flips the default to claude-code — setDefault clears any prior default (the "only one default" invariant)', () => {
    providerConfig.ensureProvider('anthropic')
    providerConfig.updateProvider('anthropic', { enabled: true })
    providerConfig.setDefault('anthropic', 'claude-sonnet-4-6')

    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    applyClaudeCodeFreshDefaults(providerConfig)

    // applyClaudeCodeFreshDefaults always makes claude-code the default when
    // called — it does NOT check whether another provider was already the
    // default. Callers are responsible for only calling it on a genuinely
    // fresh install (see index.ts's claudeCodeIsFresh gate). The real safety
    // guarantee — "don't re-default after a user has set their own default" —
    // lives at the caller site, not here; it's covered end-to-end by
    // onboarding-onstart.test.ts. This test only documents setDefault's
    // normal "clears previous default" contract.
    expect(providerConfig.getDefault()).toEqual({ providerId: CLAUDE_CODE_PROVIDER_ID, modelId: CLAUDE_CODE_DEFAULT_MODEL })
    expect(providerConfig.getProvider('anthropic')!.isDefault).toBe(false)
  })
})

describe('Grok CLI onboarding', () => {
  it('fills empty tiers with grok-cli-default when Grok is available', () => {
    providerConfig.ensureProvider(GROK_CLI_PROVIDER_ID)
    const filled = reconcileCliProviderTiers(db, GROK_CLI_PROVIDER_ID, true)
    expect(filled).toContain('standard')
    expect(tierRow('standard').provider_id).toBe(GROK_CLI_PROVIDER_ID)
    expect(tierRow('standard').model_id).toBe(GROK_CLI_DEFAULT_MODEL)
  })

  it('enables grok without making it default when makeDefault=false', () => {
    providerConfig.ensureProvider(GROK_CLI_PROVIDER_ID)
    applyCliFreshDefaults(providerConfig, GROK_CLI_PROVIDER_ID, false)
    const cfg = providerConfig.getProvider(GROK_CLI_PROVIDER_ID)!
    expect(cfg.enabled).toBe(true)
    expect(cfg.isDefault).toBe(false)
  })

  it('applyPrimaryCliProvider sets default + fills tiers without disabling the other CLI', () => {
    providerConfig.ensureProvider(CLAUDE_CODE_PROVIDER_ID)
    providerConfig.ensureProvider(GROK_CLI_PROVIDER_ID)
    applyCliFreshDefaults(providerConfig, CLAUDE_CODE_PROVIDER_ID, false)
    applyCliFreshDefaults(providerConfig, GROK_CLI_PROVIDER_ID, false)

    applyPrimaryCliProvider(db, providerConfig, GROK_CLI_PROVIDER_ID)

    expect(providerConfig.getProvider(CLAUDE_CODE_PROVIDER_ID)!.enabled).toBe(true)
    expect(providerConfig.getProvider(GROK_CLI_PROVIDER_ID)!.enabled).toBe(true)
    expect(providerConfig.getDefault()).toEqual({
      providerId: GROK_CLI_PROVIDER_ID,
      modelId: GROK_CLI_DEFAULT_MODEL,
    })
    expect(tierRow('code').provider_id).toBe(GROK_CLI_PROVIDER_ID)
  })
})
