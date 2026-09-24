// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// GET /api/v1/routing/auxiliary — the Routing tab's "Background model calls"
// card: where each group of background calls goes right now, or why nowhere.
// The endpoint is read-only behind read:Settings and returns the auxiliary
// service's describe() verbatim.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { AbilityBuilder, PureAbility } from '@casl/ability'
import { createRoutingRoutes, type RoutingRoutesDeps } from '@modules/model/routing/routes'
import {
  AUX_POLICY,
  createAuxiliaryModelService,
  type AuxGroupStatus,
  type AuxiliaryStatusResponse,
} from '@modules/model/auxiliary'
import type { BindingProviderConfig } from '@modules/model/binding'
import type { BudgetStatus, TierConfig } from '@modules/model/routing/types'
import type { AIProvider, ModelInfo } from '@modules/model/types'
import type { AppAbility } from '@modules/permissions/roles'

// ── Fixtures ────────────────────────────────────────────────────────────────

/** `id` alone, or `id!` for a CLI that advertises isolated completion. */
function providers(ids: string[]) {
  return ids.map((raw) => {
    const id = raw.replace(/!$/, '')
    return raw.endsWith('!') ? { id, supportsIsolatedCompletion: true } : { id }
  })
}

function config(ids: string[], models: Record<string, string[]> = {}): BindingProviderConfig {
  const known = ids.map((i) => i.replace(/!$/, ''))
  const row = (id: string) => ({ id, enabled: true, settings: {}, isDefault: false, defaultModel: null, updatedAt: '' })
  return {
    getProvider: (id) => (known.includes(id) ? row(id) : null),
    getDefault: () => null,
    listProviders: () => known.map(row),
    listEnabledModels: (id) => (models[id] ?? []).map((m): ModelInfo => ({
      id: m, name: m, provider: id, contextWindow: 1000, maxOutputTokens: 100,
      supportsTools: true, supportsImages: false, supportsStreaming: true,
    })),
  }
}

function tier(name: TierConfig['tier'], providerId: string, modelId: string): TierConfig {
  return {
    tier: name, providerId, modelId, fallbackProviderId: null, fallbackModelId: null,
    description: '', enabled: true, updatedAt: '',
  }
}

function auxiliary(opts: {
  ids: string[]
  models?: Record<string, string[]>
  tiers?: TierConfig[]
  budgetStatus?: BudgetStatus | null
}) {
  const complete = vi.fn()
  const service = createAuxiliaryModelService({
    getGateway: () => ({ listProviders: () => providers(opts.ids) as unknown as AIProvider[], complete }),
    getTiers: () => opts.tiers ?? [],
    getProviderConfig: () => config(opts.ids, opts.models),
    getBudgetStatus: () => opts.budgetStatus ?? null,
  })
  return { service, complete }
}

/** An app whose caller holds `grants` (null: no ability at all, i.e. unauthenticated). */
function app(deps: RoutingRoutesDeps, grants: Array<[string, string]> | null = [['read', 'Settings']]) {
  const a = new Hono()
  a.use('*', async (c, next) => {
    if (grants) {
      const { can, build } = new AbilityBuilder<AppAbility>(PureAbility)
      for (const [action, subject] of grants) can(action as any, subject as any)
      ;(c as any).set('ability', build())
    }
    await next()
  })
  // The auxiliary route never touches the DB.
  createRoutingRoutes(a, {} as any, deps)
  return a
}

async function groups(a: Hono): Promise<Record<string, AuxGroupStatus>> {
  const res = await a.request('/api/v1/routing/auxiliary')
  expect(res.status).toBe(200)
  const body = await res.json() as AuxiliaryStatusResponse
  return Object.fromEntries(body.groups.map((g) => [g.group, g]))
}

const GROUPS = Object.keys(AUX_POLICY)
const NOT_TIER_ONLY = GROUPS.filter((g) => !AUX_POLICY[g as keyof typeof AUX_POLICY].tierOnly)
const TIER_ONLY = GROUPS.filter((g) => AUX_POLICY[g as keyof typeof AUX_POLICY].tierOnly)

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/v1/routing/auxiliary', () => {
  it('a Settings reader gets every group, in policy order, with its purposes and resolved target', async () => {
    const { service, complete } = auxiliary({
      ids: ['anthropic'],
      models: { anthropic: ['claude-x'] },
      tiers: [tier('heartbeat', 'anthropic', 'claude-x'), tier('triage', 'anthropic', 'claude-x')],
    })
    const res = await app({ getAuxiliaryModel: () => service }).request('/api/v1/routing/auxiliary')
    expect(res.status).toBe(200)
    const body = await res.json() as AuxiliaryStatusResponse
    expect(body.groups.map((g) => g.group)).toEqual(GROUPS)
    const byGroup = Object.fromEntries(body.groups.map((g) => [g.group, g]))
    expect(byGroup.memory).toEqual({
      group: 'memory',
      purposes: ['capture', 'consolidation', 'reflection', 'data_port_enrichment'],
      target: { provider: 'anthropic', model: 'claude-x', route: 'tier' },
      reason: null,
    })
    expect(byGroup.title.target).toEqual({ provider: 'anthropic', model: 'claude-x', route: 'tier' })
    expect(byGroup.triage.target).toEqual({ provider: 'anthropic', model: 'claude-x', route: 'tier' })
    // Research has no Standard tier here: the next rung is the install default
    // (the only enabled provider with an enabled model).
    expect(byGroup.research.target).toEqual({ provider: 'anthropic', model: 'claude-x', route: 'default' })
    // Describing never calls a model.
    expect(complete).not.toHaveBeenCalled()
  })

  it('a Claude-Code-only install resolves every non-tier-only group to the isolating CLI, pinned by provider only', async () => {
    // No enabled model rows, so there is no install default either.
    const { service } = auxiliary({ ids: ['claude-code!'] })
    const byGroup = await groups(app({ getAuxiliaryModel: () => service }))
    for (const group of NOT_TIER_ONLY) {
      expect(byGroup[group].target).toEqual({ provider: 'claude-code', model: null, route: 'isolated-cli' })
      expect(byGroup[group].reason).toBeNull()
    }
    // Title and triage use their tier only, and neither tier is set.
    for (const group of TIER_ONLY) {
      expect(byGroup[group]).toMatchObject({ target: null, reason: 'tier_not_configured' })
    }
  })

  it('negative: a Grok-only install whose isolation is not verified has no target and no_eligible_provider for every non-tier-only group', async () => {
    const { service, complete } = auxiliary({ ids: ['grok-cli'], models: { 'grok-cli': ['grok-4'] } })
    const byGroup = await groups(app({ getAuxiliaryModel: () => service }))
    expect(NOT_TIER_ONLY.length).toBeGreaterThan(0)
    for (const group of NOT_TIER_ONLY) {
      expect(byGroup[group]).toMatchObject({ target: null, reason: 'no_eligible_provider' })
    }
    for (const group of TIER_ONLY) {
      expect(byGroup[group]).toMatchObject({ target: null, reason: 'tier_not_configured' })
    }
    expect(complete).not.toHaveBeenCalled()
  })

  it('negative: a tier-only group whose tier names a CLI that cannot isolate reports no_eligible_provider, not tier_not_configured', async () => {
    const { service } = auxiliary({ ids: ['grok-cli'], tiers: [tier('heartbeat', 'grok-cli', 'grok-4')] })
    const byGroup = await groups(app({ getAuxiliaryModel: () => service }))
    expect(byGroup.title).toMatchObject({ target: null, reason: 'no_eligible_provider' })
    expect(byGroup.triage).toMatchObject({ target: null, reason: 'tier_not_configured' })
  })

  it('negative: a budget stop reports budget_stop for every group', async () => {
    const { service } = auxiliary({
      ids: ['anthropic'],
      models: { anthropic: ['claude-x'] },
      tiers: [tier('heartbeat', 'anthropic', 'claude-x')],
      budgetStatus: {
        daily: { spent: 2, limit: 1, action: 'stop' },
        weekly: { spent: 2, limit: 10, action: 'ok' },
        monthly: { spent: 2, limit: 100, action: 'ok' },
      },
    })
    const byGroup = await groups(app({ getAuxiliaryModel: () => service }))
    for (const group of GROUPS) expect(byGroup[group]).toMatchObject({ target: null, reason: 'budget_stop' })
  })

  it('negative: a caller without read:Settings gets 403 and the service is never asked', async () => {
    const describe = vi.fn(() => [])
    const res = await app({ getAuxiliaryModel: () => ({ describe }) }, [['read', 'Conversation']])
      .request('/api/v1/routing/auxiliary')
    expect(res.status).toBe(403)
    expect(describe).not.toHaveBeenCalled()
  })

  it('negative: an unauthenticated caller gets 401', async () => {
    const describe = vi.fn(() => [])
    const res = await app({ getAuxiliaryModel: () => ({ describe }) }, null).request('/api/v1/routing/auxiliary')
    expect(res.status).toBe(401)
    expect(describe).not.toHaveBeenCalled()
  })

  it('negative: without the auxiliary service the endpoint answers 503 instead of an empty list', async () => {
    expect((await app({ getAuxiliaryModel: () => undefined }).request('/api/v1/routing/auxiliary')).status).toBe(503)
    expect((await app({}).request('/api/v1/routing/auxiliary')).status).toBe(503)
  })

  it('reads the service per request, so a later-installed service is used', async () => {
    let current: ReturnType<typeof auxiliary>['service'] | undefined
    const a = app({ getAuxiliaryModel: () => current })
    expect((await a.request('/api/v1/routing/auxiliary')).status).toBe(503)
    current = auxiliary({ ids: ['claude-code!'] }).service
    const byGroup = await groups(a)
    expect(byGroup.memory.target?.provider).toBe('claude-code')
  })
})
