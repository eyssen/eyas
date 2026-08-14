// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createConnectionsTables } from '@modules/connections/schema'
import { createConnectionsService } from '@modules/connections/service'
import { testConnection } from '@modules/connections/adapters'
import type { EyasDb } from '@core/types'

function makeService() {
  const db = createMemoryDb() as unknown as EyasDb
  createConnectionsTables(db)
  return createConnectionsService(db)
}

describe('connection adapters', () => {
  let service: ReturnType<typeof createConnectionsService>

  beforeEach(() => {
    service = makeService()
  })

  it('pending connection cannot be tested', async () => {
    const conn = await service.create({
      name: 'Pending GH',
      systemType: 'github',
      source: 'agent',
      pending: true,
    })
    const result = await testConnection(service, conn, {})
    expect(result.ok).toBe(false)
    expect(result.status).toBe('pending')
  })

  it('mcp adapter reports connected when mcp client matches', async () => {
    const conn = await service.create({
      name: 'Filesystem MCP',
      systemType: 'mcp',
      config: { mcpServerId: 'srv-1' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      mcpClient: {
        get: (id) => id === 'srv-1'
          ? { id: 'srv-1', name: 'filesystem', status: 'connected' }
          : null,
        list: () => [{ id: 'srv-1', name: 'filesystem', status: 'connected' }],
      },
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
    expect(service.get(conn.id)!.status).toBe('connected')
  })

  it('github adapter uses fetch and bearer token', async () => {
    const secrets = {
      store: new Map<string, string>(),
      async get(name: string, scope: string) {
        return this.store.get(`${scope}:${name}`) ?? null
      },
      async set(name: string, scope: string, value: string) {
        this.store.set(`${scope}:${name}`, value)
      },
    }
    const conn = await service.create({
      name: 'GH',
      systemType: 'github',
      secrets: { token: 'ghp_test' },
      source: 'user',
    }, { secrets })

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ login: 'eyssen' }),
    })) as any

    const result = await testConnection(service, conn, { secrets, fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('eyssen')
    expect(fetchImpl).toHaveBeenCalled()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('/user')
    expect(init.headers.Authorization).toBe('Bearer ghp_test')
  })
})
