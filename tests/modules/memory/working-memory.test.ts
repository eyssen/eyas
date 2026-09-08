// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createWorkingMemoryService } from '../../../src/modules/memory/tiers/working-memory.js'

describe('WorkingMemoryService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createWorkingMemoryService>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    service = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
  })

  it('creates and retrieves a block', () => {
    service.set('user_context', 'Krisztian is a DevOps engineer')
    const block = service.get('user_context')
    expect(block).not.toBeNull()
    expect(block!.content).toBe('Krisztian is a DevOps engineer')
    expect(block!.key).toBe('user_context')
  })

  it('updates an existing block', () => {
    service.set('user_context', 'initial')
    service.set('user_context', 'updated content')
    const block = service.get('user_context')
    expect(block!.content).toBe('updated content')
  })

  it('lists all blocks', () => {
    service.set('user_context', 'content 1')
    service.set('current_task', 'content 2')
    const blocks = service.listAll()
    expect(blocks).toHaveLength(2)
  })

  it('deletes a block', () => {
    service.set('user_context', 'content')
    service.delete('user_context')
    expect(service.get('user_context')).toBeNull()
  })

  it('cleans up expired blocks', () => {
    service.set('old_block', 'expired content')
    db.run(sql`UPDATE working_memory SET expires_at = '2020-01-01T00:00:00.000Z' WHERE key = 'old_block'`)
    service.cleanupExpired()
    expect(service.get('old_block')).toBeNull()
  })

  it('returns null for non-existent key', () => {
    expect(service.get('nonexistent')).toBeNull()
  })
})
