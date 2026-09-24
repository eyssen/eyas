// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db.js'
import { createWorkingMemoryService } from '@modules/memory/tiers/working-memory'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import type { EyasDb } from '@core/types'

function createMemoryTables(db: EyasDb) {
  db.run(sql`CREATE TABLE IF NOT EXISTS working_memory (
    key TEXT PRIMARY KEY, content TEXT NOT NULL, max_tokens INTEGER DEFAULT 500,
    access_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS episodic_memories (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT,
    salience REAL DEFAULT 1.0, access_count INTEGER DEFAULT 0, conversation_count INTEGER DEFAULT 1,
    valid_from TEXT NOT NULL, valid_until TEXT, tags TEXT, embedding_hash TEXT,
    agent_id TEXT, conversation_id TEXT, project_id TEXT, created_at TEXT NOT NULL, last_accessed_at TEXT
  )`)
}

describe('Agent-scoped memory', () => {
  let db: EyasDb

  beforeEach(() => {
    db = createMemoryDb() as EyasDb
    createMemoryTables(db)
  })

  describe('Working memory — listByPrefix', () => {
    it('returns only matching keys', () => {
      const wm = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
      wm.set('agent-a:mood', 'happy')
      wm.set('agent-b:mood', 'focused')
      wm.set('shared:date', '2026-04-13')

      const agentAKeys = wm.listByPrefix('agent-a:')
      expect(agentAKeys.length).toBe(1)
      expect(agentAKeys[0].key).toBe('agent-a:mood')
      expect(agentAKeys[0].content).toBe('happy')
    })

    it('returns empty array when no keys match', () => {
      const wm = createWorkingMemoryService(db, { ttlHours: 24, maxTokensPerBlock: 500 })
      wm.set('agent-a:mood', 'happy')

      const results = wm.listByPrefix('agent-z:')
      expect(results).toEqual([])
    })
  })

  describe('Episodic memory — agent_id', () => {
    it('creates memories with agent_id', () => {
      const em = createEpisodicMemoryService(db)
      const mem = em.create({ content: 'Agent A observation', sourceType: 'user', agentId: 'agent-a' })
      expect(mem.agentId).toBe('agent-a')
    })

    it('creates memories without agent_id (shared)', () => {
      const em = createEpisodicMemoryService(db)
      const mem = em.create({ content: 'Shared fact', sourceType: 'system' })
      expect(mem.agentId).toBeNull()
    })

    it('filters by agent_id', () => {
      const em = createEpisodicMemoryService(db)
      em.create({ content: 'Agent A saw rain', sourceType: 'user', agentId: 'agent-a' })
      em.create({ content: 'Agent B saw sun', sourceType: 'user', agentId: 'agent-b' })
      em.create({ content: 'Shared fact', sourceType: 'system' })

      const agentAOnly = em.list({ agentId: 'agent-a' })
      expect(agentAOnly.length).toBe(1)
      expect(agentAOnly[0].content).toBe('Agent A saw rain')
    })

    it('includes shared memories when includeShared is true', () => {
      const em = createEpisodicMemoryService(db)
      em.create({ content: 'Agent A private', sourceType: 'user', agentId: 'agent-a' })
      em.create({ content: 'Shared knowledge', sourceType: 'system' })
      em.create({ content: 'Agent B private', sourceType: 'user', agentId: 'agent-b' })

      const withShared = em.list({ agentId: 'agent-a', includeShared: true })
      expect(withShared.length).toBe(2)
      expect(withShared.map((m) => m.content).sort()).toEqual(['Agent A private', 'Shared knowledge'])
    })

    it('returns all memories when no agentId filter', () => {
      const em = createEpisodicMemoryService(db)
      em.create({ content: 'A', sourceType: 'user', agentId: 'agent-a' })
      em.create({ content: 'B', sourceType: 'user', agentId: 'agent-b' })
      em.create({ content: 'C', sourceType: 'system' })

      const all = em.list()
      expect(all.length).toBe(3)
    })
  })
})
