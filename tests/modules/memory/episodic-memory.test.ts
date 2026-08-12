// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '../../../src/modules/memory/schema.js'
import { createEpisodicMemoryService } from '../../../src/modules/memory/tiers/episodic-memory.js'

describe('EpisodicMemoryService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createEpisodicMemoryService>

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)
    service = createEpisodicMemoryService(db)
  })

  it('creates a memory and retrieves it by id', () => {
    const mem = service.create({ content: 'User prefers dark mode', sourceType: 'conversation', tags: ['preferences'] })
    expect(mem.id).toBeTruthy()
    expect(mem.salience).toBe(1.0)
    const retrieved = service.get(mem.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.content).toBe('User prefers dark mode')
    expect(retrieved!.tags).toEqual(['preferences'])
  })

  it('lists valid memories ordered by salience', () => {
    service.create({ content: 'fact A', sourceType: 'extraction' })
    service.create({ content: 'fact B', sourceType: 'extraction' })
    const list = service.list({ validOnly: true, limit: 10 })
    expect(list).toHaveLength(2)
  })

  it('increments access count on touch', () => {
    const mem = service.create({ content: 'fact', sourceType: 'user' })
    service.touch(mem.id)
    service.touch(mem.id)
    const updated = service.get(mem.id)
    expect(updated!.accessCount).toBe(2)
  })

  it('invalidates a memory with valid_until', () => {
    const mem = service.create({ content: 'old fact', sourceType: 'system' })
    service.invalidate(mem.id)
    const updated = service.get(mem.id)
    expect(updated!.validUntil).not.toBeNull()
  })

  it('filters out invalidated memories when validOnly=true', () => {
    const mem = service.create({ content: 'old', sourceType: 'system' })
    service.create({ content: 'current', sourceType: 'system' })
    service.invalidate(mem.id)
    const valid = service.list({ validOnly: true, limit: 10 })
    expect(valid).toHaveLength(1)
    expect(valid[0].content).toBe('current')
  })

  it('applies salience decay', () => {
    const mem = service.create({ content: 'fact', sourceType: 'extraction' })
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
    db.run(sql`UPDATE episodic_memories SET last_accessed_at = ${tenDaysAgo} WHERE id = ${mem.id}`)
    service.applyDecay(0.95)
    const updated = service.get(mem.id)
    // 0.95^10 ≈ 0.5987
    expect(updated!.salience).toBeCloseTo(0.5987, 2)
  })

  it('finds promotion candidates', () => {
    const mem = service.create({ content: 'important fact', sourceType: 'extraction' })
    db.run(sql`UPDATE episodic_memories SET salience = 0.8, access_count = 5 WHERE id = ${mem.id}`)
    const candidates = service.findPromotionCandidates(0.7, 3)
    expect(candidates).toHaveLength(1)
  })

  it('finds demotion candidates', () => {
    const mem = service.create({ content: 'old forgotten fact', sourceType: 'extraction' })
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString()
    db.run(sql`UPDATE episodic_memories SET salience = 0.1, created_at = ${oldDate} WHERE id = ${mem.id}`)
    const candidates = service.findDemotionCandidates(0.2, 30)
    expect(candidates).toHaveLength(1)
  })

  it('deletes a memory', () => {
    const mem = service.create({ content: 'to delete', sourceType: 'user' })
    service.delete(mem.id)
    expect(service.get(mem.id)).toBeNull()
  })
})
