// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { requirePermission } from '@modules/permissions/middleware.js'
import type { TierConfig, TierConfigInput, RoutingTier } from './types.js'

export function createRoutingRoutes(app: Hono, db: any) {
  const router = app as any

  // ─── Routing Tiers ──────────────────────────────

  // List all tiers
  router.get('/api/v1/routing/tiers', requirePermission('read', 'Settings'), (c: any) => {
    const rows = db.all(sql`SELECT * FROM routing_tiers ORDER BY
      CASE tier WHEN 'triage' THEN 1 WHEN 'quick' THEN 2 WHEN 'standard' THEN 3
      WHEN 'complex' THEN 4 WHEN 'code' THEN 5 WHEN 'heartbeat' THEN 6 WHEN 'embedding' THEN 7 END`) as any[]
    const tiers: TierConfig[] = rows.map((r: any) => ({
      tier: r.tier, providerId: r.provider_id, modelId: r.model_id,
      fallbackProviderId: r.fallback_provider_id, fallbackModelId: r.fallback_model_id,
      description: r.description, enabled: !!r.enabled, updatedAt: r.updated_at,
    }))
    return c.json({ tiers })
  })

  // Update a tier
  router.put('/api/v1/routing/tiers/:tier', requirePermission('manage', 'Settings'), async (c: any) => {
    const tier = c.req.param('tier') as RoutingTier
    const body = await c.req.json() as TierConfigInput
    const now = new Date().toISOString()

    db.run(sql`UPDATE routing_tiers SET
      provider_id = ${body.providerId},
      model_id = ${body.modelId},
      fallback_provider_id = ${body.fallbackProviderId ?? null},
      fallback_model_id = ${body.fallbackModelId ?? null},
      description = ${body.description ?? null},
      enabled = ${body.enabled !== false ? 1 : 0},
      updated_at = ${now}
      WHERE tier = ${tier}`)

    const updated = (db.all(sql`SELECT * FROM routing_tiers WHERE tier = ${tier}`) as any[])[0]
    if (!updated) return c.json({ error: 'Tier not found' }, 404)
    return c.json({
      tier: updated.tier, providerId: updated.provider_id, modelId: updated.model_id,
      fallbackProviderId: updated.fallback_provider_id, fallbackModelId: updated.fallback_model_id,
      description: updated.description, enabled: !!updated.enabled, updatedAt: updated.updated_at,
    })
  })

  // ─── Budget Config ──────────────────────────────

  // Get budget config
  router.get('/api/v1/routing/budget', requirePermission('read', 'Settings'), (c: any) => {
    const row = (db.all(sql`SELECT * FROM routing_budget WHERE id = 'global'`) as any[])[0]
    if (!row) return c.json({ error: 'Budget config not found' }, 404)
    return c.json({
      autoRoutingEnabled: !!row.auto_routing_enabled,
      dailyLimit: row.daily_limit,
      weeklyLimit: row.weekly_limit,
      monthlyLimit: row.monthly_limit,
      warnAt: row.warn_at,
      downgradeAt: row.downgrade_at,
      hardStopAt: row.hard_stop_at,
    })
  })

  // Update budget config
  router.put('/api/v1/routing/budget', requirePermission('manage', 'Settings'), async (c: any) => {
    const body = await c.req.json()
    const now = new Date().toISOString()

    db.run(sql`UPDATE routing_budget SET
      auto_routing_enabled = ${body.autoRoutingEnabled !== false ? 1 : 0},
      daily_limit = ${body.dailyLimit ?? null},
      weekly_limit = ${body.weeklyLimit ?? null},
      monthly_limit = ${body.monthlyLimit ?? null},
      warn_at = ${body.warnAt ?? 0.8},
      downgrade_at = ${body.downgradeAt ?? 1.0},
      hard_stop_at = ${body.hardStopAt ?? 1.2},
      updated_at = ${now}
      WHERE id = 'global'`)

    return c.json({ updated: true })
  })

  // ─── Auto-routing toggle ─────────────────────────

  router.get('/api/v1/routing/config', requirePermission('read', 'Settings'), (c: any) => {
    const budget = (db.all(sql`SELECT auto_routing_enabled FROM routing_budget WHERE id = 'global'`) as any[])[0]
    return c.json({ autoRoutingEnabled: !!(budget?.auto_routing_enabled) })
  })
}
