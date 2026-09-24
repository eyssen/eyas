// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F9 — the provider detail shows the reasoning setting LM Studio keeps for
// itself (metadata.runtimeReasoning), next to an effective capability that
// gives EYAS no control: the information never becomes a wire parameter.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import { createReasoningRegistry } from '@modules/model/reasoning/registry'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

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

const row = (id: string, metadata?: Record<string, unknown>): ModelInfo => ({
  id, name: id, provider: 'lmstudio', contextWindow: 8192, maxOutputTokens: 4096,
  supportsTools: true, supportsImages: false, supportsStreaming: true,
  ...(metadata ? { metadata } : {}),
})

let db: any
let configService: ProviderConfigService
beforeEach(() => {
  db = createTestDb('model-routes-runtime-reasoning').open()
  configService = createProviderConfigService(db)
  configService.ensureProvider('lmstudio')
  configService.upsertModels('lmstudio', [
    row('qwen/qwen3-8b', { discoveredAt: '2026-09-23T10:00:00.000Z', runtimeReasoning: { options: ['off', 'on'], default: 'on' } }),
    row('plain-model'),
  ])
})

function app(role: RoleId | null) {
  const registry = createReasoningRegistry({
    getDiscovered: (p, m) => configService.getModelMetadata(p, m)?.reasoning ?? null,
  })
  const hono = new Hono()
  hono.onError(errorHandler)
  createModelRoutes(hono, createModelGateway(), asRole(role), configService, undefined, undefined, db, registry)
  return hono
}

describe('GET /api/v1/model/providers/:id (LM Studio reasoning info)', () => {
  it('(+) a model LM Studio reports a setting for carries runtimeReasoning; its capability stays no-control', async () => {
    const res = await app('owner').request('/api/v1/model/providers/lmstudio')
    expect(res.status).toBe(200)
    const body = await res.json() as { models: Array<Record<string, any>> }
    const qwen = body.models.find((m) => m.modelId === 'qwen/qwen3-8b')!
    expect(qwen.runtimeReasoning).toEqual({ options: ['off', 'on'], default: 'on' })
    expect(qwen.reasoning.kind).toBe('none')
    expect(qwen.reasoning.levels).toEqual([])
  })

  it('(−) a model without reported info carries no runtimeReasoning', async () => {
    const body = await (await app('owner').request('/api/v1/model/providers/lmstudio')).json() as { models: Array<Record<string, any>> }
    expect(body.models.find((m) => m.modelId === 'plain-model')).not.toHaveProperty('runtimeReasoning')
  })

  it('(−) an anonymous caller gets nothing', async () => {
    const res = await app(null).request('/api/v1/model/providers/lmstudio')
    expect(res.status).toBe(401)
  })
})
