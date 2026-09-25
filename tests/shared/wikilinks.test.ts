// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../helpers/test-db'
import { createWikilinkService } from '@shared/wikilinks'

describe('WikilinkService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createWikilinkService>

  beforeEach(() => {
    db = createMemoryDb()
    service = createWikilinkService(db)
  })

  it('creates wikilinks table on init', () => {
    service.init()
    const rows = db.all(sql`SELECT COUNT(*) as count FROM wikilinks`)
    expect(rows).toHaveLength(1)
  })

  it('syncs links for a source', () => {
    service.init()
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'networking.md', context: 'see [[networking]]' },
      { targetType: 'knowledge', targetId: 'page-123', context: 'related to [[K8s Setup]]' },
    ])
    const outgoing = service.getOutgoing('vault', 'kubernetes.md')
    expect(outgoing).toHaveLength(2)
    expect(outgoing[0].targetId).toBe('networking.md')
    expect(outgoing[1].targetId).toBe('page-123')
  })

  it('returns backlinks for a target', () => {
    service.init()
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'networking.md', context: '[[networking]]' },
    ])
    service.syncLinks('knowledge', 'page-456', [
      { targetType: 'vault', targetId: 'networking.md', context: '[[networking]]' },
    ])
    const backlinks = service.getBacklinks('vault', 'networking.md')
    expect(backlinks).toHaveLength(2)
  })

  it('replaces links on re-sync', () => {
    service.init()
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'networking.md', context: '[[networking]]' },
    ])
    service.syncLinks('vault', 'kubernetes.md', [
      { targetType: 'vault', targetId: 'storage.md', context: '[[storage]]' },
    ])
    const outgoing = service.getOutgoing('vault', 'kubernetes.md')
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].targetId).toBe('storage.md')
  })

  it('gets 1-hop neighbors', () => {
    service.init()
    service.syncLinks('vault', 'a.md', [
      { targetType: 'vault', targetId: 'b.md', context: '' },
    ])
    service.syncLinks('vault', 'c.md', [
      { targetType: 'vault', targetId: 'a.md', context: '' },
    ])
    const neighbors = service.getNeighbors('vault', 'a.md')
    expect(neighbors).toHaveLength(2)
    const ids = neighbors.map(n => n.id)
    expect(ids).toContain('b.md')
    expect(ids).toContain('c.md')
  })
})
