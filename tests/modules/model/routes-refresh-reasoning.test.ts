// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A models refresh can change what discovery knows about a provider's models,
// so the refresh route drops that provider's memoized reasoning capabilities.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { AIProvider, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

const models: ModelInfo[] = [
  { id: 'claude-opus-4-8', name: 'Opus 4.8', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsImages: true, supportsStreaming: true },
]

const provider: AIProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  listModels: async () => models,
  complete: async () => { throw new Error('not used') },
  stream: async function* () { throw new Error('not used') },
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
beforeEach(() => { db = createTestDb('model-routes-refresh-reasoning').open() })

function app(role: RoleId | null, invalidate: (id?: string) => void) {
  const gateway = createModelGateway()
  gateway.registerProvider(provider)
  const configService = createProviderConfigService(db)
  configService.ensureProvider('anthropic')
  const hono = new Hono()
  hono.onError(errorHandler)
  createModelRoutes(hono, gateway, asRole(role), configService, undefined, undefined, db, { invalidate })
  return hono
}

describe('POST /api/v1/model/providers/:id/models/refresh', () => {
  it('invalidates the refreshed provider in the reasoning registry', async () => {
    const invalidate = vi.fn()
    const res = await app('owner', invalidate).request('/api/v1/model/providers/anthropic/models/refresh', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(invalidate).toHaveBeenCalledWith('anthropic')
  })

  it('does not touch the registry when the caller may not manage models (403) or is anonymous (401)', async () => {
    const invalidate = vi.fn()
    const forbidden = await app('user', invalidate).request('/api/v1/model/providers/anthropic/models/refresh', { method: 'POST' })
    expect(forbidden.status).toBe(403)
    const anonymous = await app(null, invalidate).request('/api/v1/model/providers/anthropic/models/refresh', { method: 'POST' })
    expect(anonymous.status).toBe(401)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does not invalidate when the provider is not active (404)', async () => {
    const invalidate = vi.fn()
    const res = await app('owner', invalidate).request('/api/v1/model/providers/openai/models/refresh', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
