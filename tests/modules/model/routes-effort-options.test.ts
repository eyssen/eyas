// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — GET /api/v1/model/effort-options: the rungs one model accepts (a pair,
// or a bare id / alias resolved to its single owner), Auto only for a model
// EYAS cannot place, and the Auto-routing tier union without a model. The
// model lists carry each model's effective reasoning capability.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { sql } from 'drizzle-orm'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { AIProvider, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'
import type { EffortOptions } from '@modules/model/reasoning/options'

function model(provider: string, id: string, name = id): ModelInfo {
  return { id, name, provider, contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true }
}

function provider(id: string, models: ModelInfo[]): AIProvider {
  return {
    id,
    name: id,
    listModels: async () => models,
    complete: async () => { throw new Error('not used') },
    stream: async function* () { throw new Error('not used') },
  }
}

function asRole(role: RoleId | null): MiddlewareHandler {
  const registry = createPermissionRegistry()
  return async (c, next) => {
    if (role) {
      c.set('userId' as never, 'u1' as never)
      c.set('ability' as never, buildAbilityForRole(role, registry) as never)
    }
    await next()
  }
}

let db: any
beforeEach(() => {
  db = createTestDb('model-routes-effort-options').open()
  db.run(sql`CREATE TABLE IF NOT EXISTS routing_tiers (
    tier TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
    fallback_provider_id TEXT, fallback_model_id TEXT, description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')), effort TEXT
  )`)
})

function seedTiers(rows: Array<[string, string, string]>) {
  for (const [tier, p, m] of rows) db.run(sql`INSERT INTO routing_tiers (tier, provider_id, model_id) VALUES (${tier}, ${p}, ${m})`)
}

function app(role: RoleId | null = 'user') {
  const anthropicModels = [model('anthropic', 'claude-opus-4-6', 'Opus 4.6'), model('anthropic', 'claude-opus-5-5', 'Opus 5.5')]
  const openaiModels = [model('openai', 'gpt-5.5', 'GPT-5.5')]
  const gateway = createModelGateway()
  gateway.registerProvider(provider('anthropic', anthropicModels))
  gateway.registerProvider(provider('openai', openaiModels))
  const configService = createProviderConfigService(db)
  configService.ensureProvider('anthropic')
  configService.ensureProvider('openai')
  configService.updateProvider('anthropic', { enabled: true })
  configService.updateProvider('openai', { enabled: true })
  configService.upsertModels('anthropic', anthropicModels)
  configService.upsertModels('openai', openaiModels)
  const registry = createReasoningRegistry({
    getDiscovered: (p, m) => configService.getModelMetadata(p, m)?.reasoning ?? null,
  })
  const hono = new Hono()
  hono.onError(errorHandler)
  createModelRoutes(hono, gateway, asRole(role), configService, undefined, undefined, db, registry)
  return hono
}

async function options(a: Hono, query = ''): Promise<{ status: number; body: EffortOptions & Record<string, unknown> }> {
  const res = await a.request(`/api/v1/model/effort-options${query}`)
  return { status: res.status, body: await res.json() as EffortOptions & Record<string, unknown> }
}

describe('GET /api/v1/model/effort-options', () => {
  it('a pinned model returns exactly its levels, default and name', async () => {
    const { status, body } = await options(app(), '?providerId=anthropic&modelId=claude-opus-5-5')
    expect(status).toBe(200)
    expect(body.mode).toBe('pinned')
    expect(body.target).toEqual({ providerId: 'anthropic', modelId: 'claude-opus-5-5', name: 'Opus 5.5' })
    expect(body.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(body.defaultLevel).toBe('medium')
    expect(typeof body.catalogVersion).toBe('number')
  })

  it('a model without xhigh does not list it (opus-4-6)', async () => {
    const { body } = await options(app(), '?providerId=anthropic&modelId=claude-opus-4-6')
    expect(body.levels).not.toContain('xhigh')
    expect(body.levels).toContain('max')
  })

  it('a bare model id is resolved to its single owning provider', async () => {
    const { body } = await options(app(), '?modelId=gpt-5.5')
    expect(body.mode).toBe('pinned')
    expect(body.target?.providerId).toBe('openai')
    expect(body.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
  })

  it('a bare id no provider lists → unknown, Auto only (negative)', async () => {
    const { body } = await options(app(), '?modelId=no-such-model')
    expect(body.mode).toBe('unknown')
    expect(body.levels).toEqual([])
  })

  it('no model returns the Auto-routing tier union', async () => {
    seedTiers([
      ['quick', 'anthropic', 'claude-opus-4-6'],
      ['standard', 'anthropic', 'claude-opus-4-6'],
      ['complex', 'openai', 'gpt-5.5'],
      ['triage', 'openai', 'gpt-5.5'],
    ])
    const { body } = await options(app())
    expect(body.mode).toBe('auto')
    expect(body.target).toBeUndefined()
    expect(body.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('a bad query is refused (400): providerId without modelId, over-long ids', async () => {
    expect((await options(app(), '?providerId=anthropic')).status).toBe(400)
    expect((await options(app(), `?modelId=${'x'.repeat(400)}`)).status).toBe(400)
  })

  it('needs read:Model (403 for a guest, 401 anonymous)', async () => {
    expect((await options(app('guest'), '?modelId=gpt-5.5')).status).toBe(403)
    expect((await options(app(null), '?modelId=gpt-5.5')).status).toBe(401)
  })
})

describe('model lists carry the effective reasoning capability', () => {
  it('/model/models entries carry reasoning', async () => {
    const res = await app().request('/api/v1/model/models')
    expect(res.status).toBe(200)
    const { models } = await res.json() as { models: Array<{ id: string; reasoning?: { levels: string[]; kind: string } }> }
    const opus = models.find((m) => m.id === 'claude-opus-4-6')
    expect(opus?.reasoning?.kind).toBe('effort')
    expect(opus?.reasoning?.levels).not.toContain('xhigh')
  })

  it('/model/providers/:id models carry reasoning', async () => {
    const res = await app('owner').request('/api/v1/model/providers/openai')
    const body = await res.json() as { models: Array<{ modelId: string; reasoning?: { levels: string[] } }> }
    expect(body.models.find((m) => m.modelId === 'gpt-5.5')?.reasoning?.levels).toContain('xhigh')
  })
})
