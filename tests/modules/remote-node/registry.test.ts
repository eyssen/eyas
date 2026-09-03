// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createNodeRegistry } from '@modules/remote-node/registry'
import type { EyasDb } from '@core/types'

function makeDb(): EyasDb {
  const db = createMemoryDb()
  db.run(sql`CREATE TABLE remote_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    connection_type TEXT NOT NULL DEFAULT 'ssh',
    capabilities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen TEXT,
    config TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  return db as unknown as EyasDb
}

describe('NodeRegistry read path', () => {
  let registry: ReturnType<typeof createNodeRegistry>

  beforeEach(() => {
    registry = createNodeRegistry(makeDb())
  })

  it('create returns the persisted node (read path works)', () => {
    const node = registry.create({ name: 'box1', host: '10.0.0.1' })
    // Before the fix, create() returned this.get(id)! === null and threw.
    expect(node).not.toBeNull()
    expect(node.id).toBeDefined()
    expect(node.name).toBe('box1')
    expect(node.host).toBe('10.0.0.1')
    expect(node.connectionType).toBe('ssh')
    expect(node.status).toBe('offline')
    expect(node.capabilities).toEqual([])
    expect(node.config).toBeNull()
  })

  it('get returns the node by id with parsed json fields', () => {
    const created = registry.create({
      name: 'box2',
      host: '10.0.0.2',
      connectionType: 'websocket',
      capabilities: ['shell', 'files'],
      config: { port: 22 },
    })
    const fetched = registry.get(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.connectionType).toBe('websocket')
    expect(fetched!.capabilities).toEqual(['shell', 'files'])
    expect(fetched!.config).toEqual({ port: 22 })
  })

  it('get returns null for unknown id', () => {
    expect(registry.get('nope')).toBeNull()
  })

  it('list returns all created nodes (not empty)', () => {
    registry.create({ name: 'a', host: 'h1' })
    registry.create({ name: 'b', host: 'h2' })
    const all = registry.list()
    // Before the fix, list() always returned [].
    expect(all).toHaveLength(2)
    expect(all.map((n) => n.name).sort()).toEqual(['a', 'b'])
  })

  it('update mutates and returns the node', () => {
    const created = registry.create({ name: 'old', host: 'h' })
    const updated = registry.update(created.id, { name: 'new', status: 'online' })
    expect(updated.name).toBe('new')
    expect(updated.status).toBe('online')
    expect(updated.lastSeen).not.toBeNull()
    expect(registry.get(created.id)!.name).toBe('new')
  })

  it('update throws for unknown id', () => {
    expect(() => registry.update('nope', { name: 'x' })).toThrow(/not found/)
  })

  it('remove deletes the node', () => {
    const created = registry.create({ name: 'gone', host: 'h' })
    registry.remove(created.id)
    expect(registry.get(created.id)).toBeNull()
    expect(registry.list()).toHaveLength(0)
  })
})
