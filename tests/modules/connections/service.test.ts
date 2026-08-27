// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createConnectionsTables } from '@modules/connections/schema'
import { createConnectionsService } from '@modules/connections/service'
import { CONNECTION_CATALOG, connectionSecretName } from '@modules/connections/catalog'
import type { EyasDb } from '@core/types'
import type { SecretsLike } from '@modules/connections/service'

function makeDb(): EyasDb {
  const db = createMemoryDb() as unknown as EyasDb
  createConnectionsTables(db)
  return db
}

function memorySecrets(): SecretsLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    async get(name, scope) {
      return store.get(`${scope}:${name}`) ?? null
    },
    async set(name, scope, value) {
      store.set(`${scope}:${name}`, value)
    },
    async has(name, scope) {
      return store.has(`${scope}:${name}`)
    },
  }
}

describe('ConnectionsService', () => {
  let service: ReturnType<typeof createConnectionsService>
  let secrets: ReturnType<typeof memorySecrets>

  beforeEach(() => {
    service = createConnectionsService(makeDb())
    secrets = memorySecrets()
  })

  it('catalog has odoo, github, mcp', () => {
    const ids = CONNECTION_CATALOG.map((c) => c.id)
    expect(ids).toContain('odoo')
    expect(ids).toContain('github')
    expect(ids).toContain('mcp')
  })

  it('create user connection starts as unknown (not pending)', async () => {
    const conn = await service.create({
      name: 'Odoo prod',
      systemType: 'odoo',
      config: { url: 'https://odoo.example.com', db: 'prod', username: 'admin' },
      secrets: { 'api-key': 'secret-key' },
      source: 'user',
    }, { secrets })

    expect(conn.id).toBeDefined()
    expect(conn.status).toBe('unknown')
    expect(conn.adapter).toBe('native')
    expect(conn.secretRefs.length).toBeGreaterThan(0)
    expect(conn.secretRefs[0]).toBe(connectionSecretName(conn.id, 'api-key'))
    expect(await secrets.get(conn.secretRefs[0], 'system')).toBe('secret-key')
  })

  it('agent create is pending until approve', async () => {
    const conn = await service.create({
      name: 'GitHub eYssen',
      systemType: 'github',
      source: 'agent',
      reason: 'Need PR tools',
    })
    expect(conn.status).toBe('pending')

    const approved = service.approve(conn.id, 'user-1')
    expect(approved.status).toBe('unknown')
    expect(approved.approvedBy).toBe('user-1')
    expect(approved.approvedAt).toBeTruthy()
  })

  it('reject deletes pending connection', async () => {
    const conn = await service.create({
      name: 'Linear work',
      systemType: 'linear',
      pending: true,
      source: 'agent',
    })
    expect(service.reject(conn.id)).toBe(true)
    expect(service.get(conn.id)).toBeNull()
  })

  it('list filters by systemType and includePending', async () => {
    await service.create({ name: 'A', systemType: 'github', source: 'user' })
    await service.create({ name: 'B', systemType: 'github', source: 'agent', pending: true })
    await service.create({ name: 'C', systemType: 'odoo', source: 'user' })

    expect(service.list({ systemType: 'github', includePending: true })).toHaveLength(2)
    expect(service.list({ systemType: 'github', includePending: false })).toHaveLength(1)
    expect(service.list({ systemType: 'odoo' })).toHaveLength(1)
  })

  it('setHealth updates status and lastError', async () => {
    const conn = await service.create({ name: 'X', systemType: 'custom-http', config: { baseUrl: 'https://x.test' } })
    const updated = service.setHealth(conn.id, { status: 'error', lastError: 'boom' })
    expect(updated.status).toBe('error')
    expect(updated.health.lastError).toBe('boom')
    expect(updated.health.lastCheckedAt).toBeTruthy()
  })

  it('rejects unknown system type', async () => {
    await expect(service.create({ name: 'nope', systemType: 'does-not-exist' })).rejects.toThrow(/Unknown system type/)
  })

  it('setApprovalId stores id', async () => {
    const conn = await service.create({ name: 'P', systemType: 'mcp', pending: true, source: 'agent' })
    const withAppr = service.setApprovalId(conn.id, 42)
    expect(withAppr.approvalId).toBe(42)
  })
})
