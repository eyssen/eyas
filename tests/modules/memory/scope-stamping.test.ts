// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createMemoryLifecycle } from '@modules/memory/consolidation/memory-lifecycle'
import { effectiveProjectId } from '@modules/memory/types.js'

let db: any, episodic: any

beforeEach(() => { db = createMemoryDb(); createMemoryTables(db); episodic = createEpisodicMemoryService(db) })

const rowFor = (id: string) =>
  (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories WHERE id = ${id}`) as any[])[0]

describe('scope stamping', () => {
  it('episodic.create stamps conversation and effective project', () => {
    const row = episodic.create({
      content: 'the owner prefers rebase over merge',
      sourceType: 'agent-memory',
      conversationId: 'c1',
      projectId: effectiveProjectId('p1'),
    })
    expect(rowFor(row.id)).toEqual({ conversation_id: 'c1', project_id: 'p1' })
  })

  it('the seed project stamps as no project', () => {
    const row = episodic.create({
      content: 'the owner prefers rebase over merge',
      sourceType: 'agent-memory',
      conversationId: 'c1',
      projectId: effectiveProjectId('general-general'),
    })
    expect(rowFor(row.id).project_id).toBeNull()
  })

  // G7 — a provider's context compaction is a stream notice now; no
  // model-authored summary is ever written to memory.
  it('(−) the memory lifecycle has no compaction hook and writes no episodic row after a turn', () => {
    const hooks = createMemoryLifecycle({ episodic })
    expect(hooks).not.toHaveProperty('onContextCompact')
    hooks.onTurnComplete!('c2', 'a question', 'a compaction-sized answer long enough to be worth keeping around')
    expect(db.all(sql`SELECT id FROM episodic_memories`)).toEqual([])
  })
})
