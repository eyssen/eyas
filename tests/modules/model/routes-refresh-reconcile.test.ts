// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 — "Refresh models" applies a SUCCESSFUL discovery: offered rows persist
// with the concrete model they run, rows it no longer offers are switched off
// and flagged (never deleted), and a failed or empty discovery changes nothing.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createTestDb } from '../../helpers/test-db'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService, type ProviderConfigService } from '@modules/model/provider-config-service'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { AIProvider, ModelInfo } from '@modules/model/types'
import type { RoleId } from '@modules/permissions/types'

const model = (id: string, realModelId?: string): ModelInfo => ({
  id, name: id, provider: 'grok-cli', contextWindow: 500000, maxOutputTokens: 64000,
  supportsTools: true, supportsImages: false, supportsStreaming: true,
  ...(realModelId ? { metadata: { realModelId } } : {}),
})

let discovery: () => Promise<ModelInfo[]>
const provider: AIProvider = {
  id: 'grok-cli',
  name: 'Grok CLI',
  listModels: async () => [model('grok-cli-default')],
  fetchModels: () => discovery(),
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
let svc: ProviderConfigService
beforeEach(() => {
  db = createTestDb('model-routes-refresh-reconcile').open()
  svc = createProviderConfigService(db)
  svc.ensureProvider('grok-cli')
  svc.updateProvider('grok-cli', { enabled: true })
})

function app(role: RoleId | null = 'owner') {
  const gateway = createModelGateway()
  gateway.registerProvider(provider)
  const hono = new Hono()
  hono.onError(errorHandler)
  const reasoning = {
    invalidate: () => {},
    get: (_p: string, _m: string, real?: string) => ({ kind: 'none', levels: [], source: real ? 'overlay' : 'unknown' }) as any,
  }
  createModelRoutes(hono, gateway, asRole(role), svc, undefined, undefined, db, reasoning)
  return hono
}

const refresh = (role: RoleId | null = 'owner') => app(role).request('/api/v1/model/providers/grok-cli/models/refresh', { method: 'POST' })
const detail = async () => (await (await app().request('/api/v1/model/providers/grok-cli')).json()).models as any[]
const byId = (rows: any[], id: string) => rows.find((m) => m.modelId === id)

describe('POST /api/v1/model/providers/:id/models/refresh — reconcile', () => {
  it('persists what discovery found, with the concrete model each row runs (positive)', async () => {
    discovery = async () => [model('grok-cli-default', 'grok-4.6'), model('grok-cli-grok-4.7', 'grok-4.7')]
    const res = await refresh()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ modelCount: 2, missing: [], restored: [] })
    expect(byId(body.models, 'grok-cli-grok-4.7').realModelId).toBe('grok-4.7')

    const rows = await detail()
    expect(byId(rows, 'grok-cli-default').realModelId).toBe('grok-4.6')
    expect(byId(rows, 'grok-cli-grok-4.7')).toMatchObject({ enabled: true, realModelId: 'grok-4.7' })
    expect(byId(rows, 'grok-cli-grok-4.7').missing).toBeUndefined()
    expect(byId(rows, 'grok-cli-grok-4.7').reasoning).toBeDefined()

    const all = (await (await app().request('/api/v1/model/models')).json()).models as any[]
    expect(all.find((m) => m.id === 'grok-cli-grok-4.7')).toMatchObject({ provider: 'grok-cli', realModelId: 'grok-4.7' })
  })

  it('a model the next discovery no longer offers is switched off and flagged, not deleted; it comes back', async () => {
    discovery = async () => [model('grok-cli-default', 'grok-4.6'), model('grok-cli-grok-4.7', 'grok-4.7')]
    await refresh()
    discovery = async () => [model('grok-cli-default', 'grok-4.6')]
    const body = await (await refresh()).json()
    expect(body.missing).toEqual(['grok-cli-grok-4.7'])
    const gone = byId(await detail(), 'grok-cli-grok-4.7')
    expect(gone).toMatchObject({ enabled: false, missing: true, realModelId: 'grok-4.7' })
    const all = (await (await app().request('/api/v1/model/models')).json()).models as any[]
    expect(all.map((m) => m.id)).not.toContain('grok-cli-grok-4.7')

    discovery = async () => [model('grok-cli-default', 'grok-4.6'), model('grok-cli-grok-4.7', 'grok-4.7')]
    expect((await (await refresh()).json()).restored).toEqual(['grok-cli-grok-4.7'])
    expect(byId(await detail(), 'grok-cli-grok-4.7')).toMatchObject({ enabled: true })
  })

  it('a failed discovery answers 502 and changes nothing (negative)', async () => {
    discovery = async () => [model('grok-cli-default', 'grok-4.6'), model('grok-cli-grok-4.7', 'grok-4.7')]
    await refresh()
    const before = await detail()
    discovery = async () => { throw new Error('grok models: not signed in') }
    const res = await refresh()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'ModelDiscoveryFailed' })
    expect(await detail()).toEqual(before)
  })

  it('an empty discovery answers 502 and switches nothing off (negative)', async () => {
    discovery = async () => [model('grok-cli-default', 'grok-4.6'), model('grok-cli-grok-4.7', 'grok-4.7')]
    await refresh()
    const before = await detail()
    discovery = async () => []
    const res = await refresh()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'ModelDiscoveryEmpty' })
    expect(await detail()).toEqual(before)
  })

  it('a caller who may not manage models cannot refresh (403), nor can an anonymous one (401)', async () => {
    discovery = async () => [model('grok-cli-default')]
    expect((await refresh('user')).status).toBe(403)
    expect((await refresh(null)).status).toBe(401)
    expect(svc.listModels('grok-cli')).toEqual([])
  })
})
