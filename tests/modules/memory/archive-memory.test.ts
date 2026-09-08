// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createArchiveMemoryService } from '../../../src/modules/memory/tiers/archive-memory.js'

describe('ArchiveMemoryService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createArchiveMemoryService>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    service = createArchiveMemoryService(db)
  })

  it('archives a memory', () => {
    const archived = service.archive({
      originalId: 'ep-123', content: 'Compressed summary',
      sourceType: 'extraction', tags: ['k8s'],
      originalCreatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(archived.id).toBeTruthy()
    expect(archived.originalId).toBe('ep-123')
  })

  it('lists and searches archived memories', () => {
    service.archive({ originalId: 'ep-1', content: 'kubernetes networking rules', sourceType: 'extraction', tags: [], originalCreatedAt: '2026-01-01T00:00:00.000Z' })
    service.archive({ originalId: 'ep-2', content: 'odoo workflow engine', sourceType: 'user', tags: [], originalCreatedAt: '2026-01-02T00:00:00.000Z' })
    expect(service.list(10)).toHaveLength(2)
    const results = service.search('kubernetes')
    expect(results).toHaveLength(1)
  })
})
