// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware.js'
import { EffortSettingSchema } from '../reasoning/schemas.js'
import { normalizeEffortSetting } from '../reasoning/ladder.js'
import { effortUnsupportedBody, unsupportedEffort } from '../reasoning/validate.js'
import type { ReasoningRegistry } from '../reasoning/registry.js'
import { readTiers } from './tier-store.js'
import type { TierConfig } from './types.js'
import type { AuxiliaryModelService, AuxiliaryStatusResponse } from '../auxiliary.js'

/** Display order of the tier list; a tier not named here sorts first (as SQL NULL did). */
const TIER_ORDER: readonly string[] = ['triage', 'quick', 'standard', 'complex', 'code', 'heartbeat', 'embedding']

function tierRank(tier: string): number {
  return TIER_ORDER.indexOf(tier)
}

/**
 * The PUT /routing/tiers/:tier body. Every field the Routing tab sends is
 * here; keys it also echoes back from the GET (tier, updatedAt) are stripped.
 * An empty or null provider/model leaves the tier unassigned. `effort`:
 * absent keeps the stored value; 'auto' and null mean Auto (NULL); anything
 * that is not a ladder rung is refused — no guessing a level.
 */
export const TierConfigInputSchema = z.object({
  providerId: z.string().max(200).nullable(),
  modelId: z.string().max(300).nullable(),
  fallbackProviderId: z.string().max(200).nullable().optional(),
  fallbackModelId: z.string().max(300).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  effort: EffortSettingSchema.nullable().optional(),
})

export type TierConfigBody = z.infer<typeof TierConfigInputSchema>

export interface RoutingRoutesDeps {
  /** Read per request: the service is created in onRegister, before these routes. */
  getAuxiliaryModel?(): Pick<AuxiliaryModelService, 'describe'> | undefined
  /**
   * The reasoning capability registry (ctx.reasoningRegistry): a tier's
   * effort must be a rung its model accepts. Absent: every model counts as
   * unknown and any rung is accepted (the gateway still clamps).
   */
  getReasoningRegistry?(): Pick<ReasoningRegistry, 'get'> | undefined
}

export function createRoutingRoutes(app: Hono, db: any, deps: RoutingRoutesDeps = {}) {
  const router = app as any

  // ─── Background model calls ─────────────────────

  // Where each group of background calls goes right now, or why nowhere.
  // Read-only and input-free (no body, no query), so there is nothing to parse.
  router.get('/api/v1/routing/auxiliary', requirePermission('read', 'Settings'), (c: any) => {
    const auxiliary = deps.getAuxiliaryModel?.()
    if (!auxiliary) return c.json({ error: 'Background model service unavailable' }, 503)
    const body: AuxiliaryStatusResponse = { groups: auxiliary.describe() }
    return c.json(body)
  })

  // ─── Routing Tiers ──────────────────────────────

  // List all tiers
  router.get('/api/v1/routing/tiers', requirePermission('read', 'Settings'), (c: any) => {
    const tiers: TierConfig[] = readTiers(db).sort((a, b) => tierRank(a.tier) - tierRank(b.tier))
    return c.json({ tiers })
  })

  // Update a tier
  router.put('/api/v1/routing/tiers/:tier', requirePermission('manage', 'Settings'), async (c: any) => {
    const tier = c.req.param('tier') as string
    const parsed = TierConfigInputSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Invalid tier configuration', details: parsed.error.flatten() }, 400)
    if (!readTiers(db).some((t) => t.tier === tier)) return c.json({ error: 'Tier not found' }, 404)
    const body = parsed.data
    // The columns are NOT NULL: an unassigned tier stores '' (readTiers reads it back as '').
    const providerId = body.providerId ?? ''
    const modelId = body.modelId ?? ''

    // A rung the tier's (new) model does not accept is refused before
    // anything is written; Auto always fits, and a model EYAS has no
    // verified facts about accepts any rung (the gateway resolves it).
    const effort = body.effort === undefined ? undefined : (normalizeEffortSetting(body.effort) ?? null)
    if (effort && providerId && modelId) {
      let capability: ReturnType<ReasoningRegistry['get']> | undefined
      try {
        capability = deps.getReasoningRegistry?.()?.get(providerId, modelId)
      } catch {
        capability = undefined
      }
      const rejection = unsupportedEffort(effort, capability)
      if (rejection) return c.json(effortUnsupportedBody(rejection, { providerId, modelId }), 400)
    }

    const now = new Date().toISOString()
    if (effort !== undefined) {
      db.run(sql`UPDATE routing_tiers SET effort = ${effort} WHERE tier = ${tier}`)
    }
    db.run(sql`UPDATE routing_tiers SET
      provider_id = ${providerId},
      model_id = ${modelId},
      fallback_provider_id = ${body.fallbackProviderId || null},
      fallback_model_id = ${body.fallbackModelId || null},
      description = ${body.description ?? null},
      enabled = ${body.enabled !== false ? 1 : 0},
      updated_at = ${now}
      WHERE tier = ${tier}`)

    const updated = readTiers(db).find((t) => t.tier === tier)
    if (!updated) return c.json({ error: 'Tier not found' }, 404)
    return c.json(updated)
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
