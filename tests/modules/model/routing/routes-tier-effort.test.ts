// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — PUT /api/v1/routing/tiers/:tier validates its whole body with Zod and
// refuses a tier effort the tier's model does not accept (EFFORT_UNSUPPORTED,
// with the rungs it does accept), before anything is written.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { AbilityBuilder, PureAbility } from '@casl/ability'
import { createTestDb } from '../../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import { readTiers, getTierEffort } from '@modules/model/routing/tier-store'
import { createRoutingRoutes, TierConfigInputSchema } from '@modules/model/routing/routes'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import type { AppAbility } from '@modules/permissions/roles'
import type { ModuleContext } from '@core/types'

const logger = {
  info() {}, error() {}, debug() {}, trace() {}, fatal() {}, warn() {},
  child() { return logger },
} as any

let db: any
beforeEach(async () => {
  db = createTestDb('routing-routes-tier-effort').open()
  const { modelModule } = await import('@modules/model/index')
  await modelModule.onRegister({
    db,
    logger,
    http: new Hono(),
    setup: createSetupRegistry(db),
    secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
  } as unknown as ModuleContext)
})

const registry = createReasoningRegistry({ getDiscovered: () => null })

function app(opts: { canManage?: boolean; withRegistry?: boolean } = {}) {
  const a = new Hono()
  a.use('*', async (c, next) => {
    const { can, build } = new AbilityBuilder<AppAbility>(PureAbility)
    can('read', 'Settings')
    if (opts.canManage !== false) can('manage', 'Settings')
    ;(c as any).set('ability', build())
    await next()
  })
  createRoutingRoutes(a, db, opts.withRegistry === false ? {} : { getReasoningRegistry: () => registry })
  return a
}

const put = (a: Hono, tier: string, body: unknown) => a.request(`/api/v1/routing/tiers/${tier}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const tierRow = (tier: string) => readTiers(db).find((t) => t.tier === tier)!

describe('PUT /api/v1/routing/tiers/:tier — effort per model', () => {
  it("refuses a rung the tier's model does not accept: 'xhigh' on an opus-4-6 tier (400 EFFORT_UNSUPPORTED) and writes nothing", async () => {
    const before = tierRow('complex')
    const res = await put(app(), 'complex', { providerId: 'anthropic', modelId: 'claude-opus-4-6', effort: 'xhigh' })
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string; levels: string[]; level: string; modelId: string }
    expect(body.code).toBe('EFFORT_UNSUPPORTED')
    expect(body.level).toBe('xhigh')
    expect(body.levels).not.toContain('xhigh')
    expect(body.levels).toContain('max')
    expect(body.modelId).toBe('claude-opus-4-6')
    const after = tierRow('complex')
    expect(after.providerId).toBe(before.providerId)
    expect(after.effort).toBe(before.effort)
  })

  it("accepts a rung the model offers: 'xhigh' on an opus-4-8 tier", async () => {
    const res = await put(app(), 'complex', { providerId: 'anthropic', modelId: 'claude-opus-4-8', effort: 'xhigh' })
    expect(res.status).toBe(200)
    expect(getTierEffort(db, 'complex')).toBe('xhigh')
    expect(tierRow('complex').modelId).toBe('claude-opus-4-8')
  })

  it("'auto' stores NULL (Auto) whatever the model", async () => {
    const res = await put(app(), 'quick', { providerId: 'xai', modelId: 'grok-4.5', effort: 'auto' })
    expect(res.status).toBe(200)
    expect((await res.json() as { effort: string | null }).effort).toBeNull()
    expect(getTierEffort(db, 'quick')).toBeNull()
  })

  it('a model with no reasoning control accepts only Auto (negative)', async () => {
    const res = await put(app(), 'quick', { providerId: 'xai', modelId: 'grok-4.5', effort: 'low' })
    expect(res.status).toBe(400)
    const body = await res.json() as { code: string; levels: string[] }
    expect(body.code).toBe('EFFORT_UNSUPPORTED')
    expect(body.levels).toEqual([])
  })

  it("'low' on a model EYAS has no facts about is accepted (the gateway clamps it)", async () => {
    const res = await put(app(), 'standard', { providerId: 'anthropic', modelId: 'brand-new-model', effort: 'low' })
    expect(res.status).toBe(200)
    expect(getTierEffort(db, 'standard')).toBe('low')
  })

  it('without the registry every model counts as unknown: any rung is accepted', async () => {
    const res = await put(app({ withRegistry: false }), 'complex', { providerId: 'anthropic', modelId: 'claude-opus-4-6', effort: 'xhigh' })
    expect(res.status).toBe(200)
  })

  it("'bogus' is refused (400) before anything is written", async () => {
    const res = await put(app(), 'triage', { providerId: 'anthropic', modelId: 'claude-opus-4-8', effort: 'bogus' })
    expect(res.status).toBe(400)
    expect(tierRow('triage').modelId).not.toBe('claude-opus-4-8')
  })

  it('an invalid body is refused (400): wrong types, a missing model', async () => {
    expect((await put(app(), 'triage', { providerId: 42, modelId: 'm' })).status).toBe(400)
    expect((await put(app(), 'triage', { providerId: 'p' })).status).toBe(400)
    expect((await put(app(), 'triage', { providerId: 'p', modelId: 'm', enabled: 'yes' })).status).toBe(400)
    expect((await put(app(), 'triage', null)).status).toBe(400)
  })

  it('accepts the whole row the Routing tab echoes back (tier, updatedAt stripped); an unassigned tier stays empty', async () => {
    const current = tierRow('heartbeat')
    const res = await put(app(), 'heartbeat', { ...current, providerId: '', modelId: '', effort: 'medium' })
    expect(res.status).toBe(200)
    const row = tierRow('heartbeat')
    expect(row.providerId).toBe('')
    expect(row.effort).toBe('medium')
    expect(row.description).toBe(current.description)
  })

  it('missing manage:Settings → 403; an unknown tier → 404; GET returns the effort', async () => {
    expect((await put(app({ canManage: false }), 'quick', { providerId: 'p', modelId: 'm', effort: 'max' })).status).toBe(403)
    expect((await put(app(), 'nope', { providerId: 'p', modelId: 'm', effort: 'max' })).status).toBe(404)
    const res = await app().request('/api/v1/routing/tiers')
    const { tiers } = await res.json() as { tiers: Array<{ tier: string; effort: string | null }> }
    expect(tiers.find((t) => t.tier === 'triage')?.effort).toBe('low')
  })
})

describe('TierConfigInputSchema', () => {
  it("maps what the Routing tab sends and strips what it echoes", () => {
    const parsed = TierConfigInputSchema.parse({ tier: 'quick', updatedAt: 'x', providerId: 'p', modelId: 'm', effort: null, enabled: true })
    expect(parsed).toEqual({ providerId: 'p', modelId: 'm', effort: null, enabled: true })
  })
})
