// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Onboarding Fix 2 — end-to-end wiring/ordering test for modelModule.onStart.
//
// All other onboarding-reconcile tests call the extracted pure functions
// (applyClaudeCodeFreshDefaults / reconcileClaudeCodeTiers) directly — none of
// them exercise onStart itself, so the exact ordering identified as the crux
// (the fresh-enable/flip block MUST run BEFORE the submodules loop, see
// src/modules/model/index.ts) was untested. A refactor could reorder it and
// silently reintroduce the bug with an all-green suite. This test drives the
// real onStart against a real (in-memory) DB + provider config service so that
// ordering is locked in.
//
// The claude-code submodule is mocked ONLY to remove the dependency on the
// real `claude` CLI binary being on PATH (isClaudeCliAvailable would
// otherwise make this test's outcome depend on the machine it runs on). The
// mock still respects the same `enabled` gate the real submodule checks, so
// the ordering assertion is meaningful: if the fresh-flip block didn't run
// before this submodule's onStart, `enabled` would still be false and the
// provider would never register on the gateway.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'
import type { ModuleContext } from '@core/types'

vi.mock('@modules/model/submodules/claude-code/manifest.js', () => ({
  isClaudeCliAvailable: async () => true,
  claudeCodeManifest: {
    id: 'model.claude-code',
    name: 'Claude Code CLI',
    parentModule: 'model',
    enabled: true,
    async onStart(ctx: ModuleContext) {
      ctx.providerConfig.ensureProvider('claude-code')
      ctx.model.unregisterProvider('claude-code')
      const config = ctx.providerConfig.getProvider('claude-code')
      if (!config?.enabled) return
      ctx.model.registerProvider(createClaudeCodeProvider())
    },
  },
}))

// Grok CLI absent in this suite — keeps the single-CLI fresh-install path
// (Claude becomes default) under test without depending on a real `grok` binary.
vi.mock('@modules/model/submodules/grok-cli/manifest.js', () => ({
  isGrokCliAvailable: async () => false,
  grokCliManifest: {
    id: 'model.grok-cli',
    name: 'Grok CLI',
    parentModule: 'model',
    enabled: true,
    async onStart(ctx: ModuleContext) {
      ctx.providerConfig.ensureProvider('grok-cli')
    },
  },
}))

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return noopLogger } } as any

const testDb = createTestDb('onboarding-onstart')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

function buildCtx(): ModuleContext {
  return {
    db,
    logger: noopLogger,
    http: new Hono(),
    setup: createSetupRegistry(db),
    secrets: {
      get: async () => null,
      set: async () => {},
      delete: async () => false,
      list: async () => [],
      has: async () => false,
    },
  } as unknown as ModuleContext
}

function tierRow(tier: string) {
  return (db.all(sql`SELECT * FROM routing_tiers WHERE tier = ${tier}`) as any[])[0]
}

describe('modelModule.onStart — fresh-install wiring/ordering (the crux)', () => {
  it('enables claude-code, makes it the default, and fills routing tiers end-to-end from a genuinely fresh state', async () => {
    const { modelModule } = await import('@modules/model/index')
    const ctx = buildCtx()

    // Fresh state: onRegister hasn't run yet, so there is no claude-code
    // provider_config row and no routing_tiers table at all.
    await modelModule.onRegister(ctx)

    // Sanity: still fresh right up to onStart.
    expect(ctx.providerConfig.getProvider('claude-code')).toBeNull()
    expect(tierRow('standard').provider_id).toBe('')

    await modelModule.onStart(ctx)

    // The fresh-enable/flip block ran BEFORE the submodules loop: claude-code
    // ends up enabled, default, with its default model set.
    const provider = ctx.providerConfig.getProvider('claude-code')
    expect(provider).not.toBeNull()
    expect(provider!.enabled).toBe(true)
    expect(provider!.isDefault).toBe(true)
    expect(provider!.defaultModel).toBe('claude-code-sonnet')
    expect(ctx.providerConfig.getDefault()).toEqual({ providerId: 'claude-code', modelId: 'claude-code-sonnet' })

    // The submodules loop then actually registered the provider on the
    // gateway (proves it saw `enabled: true`, not the pre-flip disabled row).
    expect(ctx.model.getProvider('claude-code')).toBeDefined()

    // The post-loop self-healing reconcile filled the routing tiers.
    const standard = tierRow('standard')
    expect(standard.provider_id).toBe('claude-code')
    expect(standard.model_id).toBe('claude-code-sonnet')

    const complex = tierRow('complex')
    expect(complex.provider_id).toBe('claude-code')
    expect(complex.model_id).toBe('claude-code-opus')
  })
})
