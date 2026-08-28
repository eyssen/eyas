// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createMemoryTools } from '@modules/tools/builtin/memory-tools'
import { createMemoryLifecycle } from '@modules/memory/consolidation/memory-lifecycle'

let db: any, episodic: any

beforeEach(() => { db = createMemoryDb(); createMemoryTables(db); episodic = createEpisodicMemoryService(db) })

const rowFor = (id: string) =>
  (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories WHERE id = ${id}`) as any[])[0]

describe('scope stamping', () => {
  it('save_memory stamps conversation and effective project from ToolContext', async () => {
    const save = createMemoryTools(() => ({ episodic })).find((t) => t.name === 'save_memory')!
    const out: any = await save.execute({ content: 'the owner prefers rebase over merge' },
      { conversationId: 'c1', projectId: 'p1', userId: 'u', logger: { warn: vi.fn() } } as any)
    expect(rowFor(out.id)).toEqual({ conversation_id: 'c1', project_id: 'p1' })
  })

  it('save_memory treats the seed project as no project', async () => {
    const save = createMemoryTools(() => ({ episodic })).find((t) => t.name === 'save_memory')!
    const out: any = await save.execute({ content: 'the owner prefers rebase over merge' },
      { conversationId: 'c1', projectId: 'general-general', userId: 'u', logger: { warn: vi.fn() } } as any)
    expect(rowFor(out.id).project_id).toBeNull()
  })

  it('PreCompact stamps the conversation and the resolved project', () => {
    const hooks = createMemoryLifecycle({ episodic, resolveProjectId: () => 'p9' })
    hooks.onContextCompact!('c2', 'a compaction summary long enough to be worth keeping around')
    const row = (db.all(sql`SELECT conversation_id, project_id FROM episodic_memories`) as any[])[0]
    expect(row).toEqual({ conversation_id: 'c2', project_id: 'p9' })
  })
})
