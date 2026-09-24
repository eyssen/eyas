// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// routing_tiers.effort — the per-tier default effort: the one-time column +
// Low seed for the cheap tiers, readTiers/getTierEffort, and the tier routes.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { AbilityBuilder, PureAbility } from '@casl/ability'
import { createTestDb } from '../../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { getTierEffort, readTiers } from '@modules/model/routing/tier-store'
import { createRoutingRoutes } from '@modules/model/routing/routes'
import type { AppAbility } from '@modules/permissions/roles'
import type { ModuleContext } from '@core/types'

const logger = {
  info() {}, error() {}, debug() {}, trace() {}, fatal() {}, warn() {},
  child() { return logger },
} as any

let db: any
beforeEach(() => {
  db = createTestDb('routing-tier-effort').open()
})

function buildCtx(): ModuleContext {
  return {
    db,
    logger,
    http: new Hono(),
    setup: createSetupRegistry(db),
    secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
  } as unknown as ModuleContext
}

async function boot(): Promise<void> {
  const { modelModule } = await import('@modules/model/index')
  await modelModule.onRegister(buildCtx())
}

function effortByTier(): Record<string, string | null> {
  const rows = db.all(sql`SELECT tier, effort FROM routing_tiers`) as Array<{ tier: string; effort: string | null }>
  return Object.fromEntries(rows.map((r) => [r.tier, r.effort]))
}

/** A routing_tiers table as an EYAS before the effort column created it, with rows. */
function createLegacyTable(): void {
  db.run(sql`CREATE TABLE routing_tiers (
    tier TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
    fallback_provider_id TEXT, fallback_model_id TEXT, description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  for (const tier of ['triage', 'quick', 'standard', 'complex', 'code', 'heartbeat', 'embedding', 'prompt_enhancer']) {
    db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id) VALUES (${tier}, 'p', 'm')`)
  }
}

describe('routing_tiers.effort — migration and seed', () => {
  it('a fresh DB seeds low for triage/quick/heartbeat and Auto (NULL) for every other tier', async () => {
    await boot()
    expect(effortByTier()).toEqual({
      triage: 'low', quick: 'low', heartbeat: 'low',
      standard: null, complex: null, code: null, embedding: null, prompt_enhancer: null,
    })
  })

  it('an existing DB without the column gets the ALTER and the one-time Low seed', async () => {
    createLegacyTable()
    await boot()
    const effort = effortByTier()
    expect(effort.triage).toBe('low')
    expect(effort.quick).toBe('low')
    expect(effort.heartbeat).toBe('low')
    expect(effort.standard).toBeNull()
    expect(effort.code).toBeNull()
  })

  it('negative: a tier the user set to Auto is never re-seeded on a later boot', async () => {
    await boot()
    db.run(sql`UPDATE routing_tiers SET effort = NULL WHERE tier = 'quick'`)
    await boot()
    await boot()
    expect(effortByTier().quick).toBeNull()
    expect(effortByTier().triage).toBe('low')
  })

  it('negative: a later boot never overwrites a user-chosen level', async () => {
    await boot()
    db.run(sql`UPDATE routing_tiers SET effort = 'high' WHERE tier = 'triage'`)
    await boot()
    expect(effortByTier().triage).toBe('high')
  })
})

describe('readTiers / getTierEffort', () => {
  it('maps the effort column onto TierConfig.effort', async () => {
    await boot()
    const tiers = readTiers(db)
    expect(tiers.find((t) => t.tier === 'quick')?.effort).toBe('low')
    expect(tiers.find((t) => t.tier === 'standard')?.effort).toBeNull()
    expect(getTierEffort(db, 'heartbeat')).toBe('low')
    expect(getTierEffort(db, 'complex')).toBeNull()
  })

  it('a stored value that is not a rung (e.g. turbo) reads as Auto, with one warning', async () => {
    await boot()
    db.run(sql`UPDATE routing_tiers SET effort = 'turbo' WHERE tier = 'code'`)
    const warn = vi.fn()
    expect(getTierEffort(db, 'code', { warn } as any)).toBeNull()
    expect(getTierEffort(db, 'code', { warn } as any)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatchObject({ tier: 'code', effort: 'turbo' })
    // 'auto' stored literally is Auto too, without a warning.
    db.run(sql`UPDATE routing_tiers SET effort = 'auto' WHERE tier = 'complex'`)
    expect(getTierEffort(db, 'complex', { warn } as any)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('an unknown tier → null', async () => {
    await boot()
    expect(getTierEffort(db, 'nope' as any)).toBeNull()
  })

  it('a table without the effort column reads every tier as Auto', () => {
    createLegacyTable()
    expect(readTiers(db).every((t) => t.effort === null)).toBe(true)
  })
})

describe('routing tier routes — effort', () => {
  function app(canManage = true) {
    const a = new Hono()
    a.use('*', async (c, next) => {
      const { can, build } = new AbilityBuilder<AppAbility>(PureAbility)
      can('read', 'Settings')
      if (canManage) can('manage', 'Settings')
      ;(c as any).set('ability', build())
      await next()
    })
    createRoutingRoutes(a, db)
    return a
  }

  const put = (a: Hono, tier: string, body: unknown) => a.request(`/api/v1/routing/tiers/${tier}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  it('GET lists every tier with its effort, in the display order', async () => {
    await boot()
    const res = await app().request('/api/v1/routing/tiers')
    expect(res.status).toBe(200)
    const { tiers } = await res.json() as { tiers: Array<{ tier: string; effort: string | null }> }
    expect(tiers.map((t) => t.tier)).toEqual(['prompt_enhancer', 'triage', 'quick', 'standard', 'complex', 'code', 'heartbeat', 'embedding'])
    expect(tiers.find((t) => t.tier === 'quick')?.effort).toBe('low')
    expect(tiers.find((t) => t.tier === 'complex')?.effort).toBeNull()
  })

  it('PUT persists a level, and \'auto\' or null stores Auto (NULL)', async () => {
    await boot()
    const a = app()
    let res = await put(a, 'complex', { providerId: 'p', modelId: 'm', effort: 'xhigh' })
    expect(res.status).toBe(200)
    expect((await res.json() as { effort: string | null }).effort).toBe('xhigh')
    expect(getTierEffort(db, 'complex')).toBe('xhigh')

    res = await put(a, 'complex', { providerId: 'p', modelId: 'm', effort: 'auto' })
    expect((await res.json() as { effort: string | null }).effort).toBeNull()
    await put(a, 'quick', { providerId: 'p', modelId: 'm', effort: null })
    expect(getTierEffort(db, 'quick')).toBeNull()
  })

  it('PUT without an effort field keeps the stored level', async () => {
    await boot()
    await put(app(), 'triage', { providerId: 'p', modelId: 'm' })
    expect(getTierEffort(db, 'triage')).toBe('low')
  })

  it('PUT refuses an effort that is not a ladder rung or auto (400) and changes nothing', async () => {
    await boot()
    const res = await put(app(), 'triage', { providerId: 'other', modelId: 'm', effort: 'bogus' })
    expect(res.status).toBe(400)
    expect(getTierEffort(db, 'triage')).toBe('low')
    expect(readTiers(db).find((t) => t.tier === 'triage')?.providerId).toBe('')
  })

  it('PUT without manage:Settings is forbidden; an unknown tier is 404', async () => {
    await boot()
    expect((await put(app(false), 'quick', { providerId: 'p', modelId: 'm', effort: 'max' })).status).toBe(403)
    expect(getTierEffort(db, 'quick')).toBe('low')
    expect((await put(app(), 'nope', { providerId: 'p', modelId: 'm', effort: 'max' })).status).toBe(404)
  })
})
