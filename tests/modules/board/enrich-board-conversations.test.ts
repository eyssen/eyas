import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService } from '@modules/conversations/conversation-service'
import { enrichBoardConversations } from '@modules/board/enrich-board-conversations'
import { createLocalBus } from '@core/bus/local-bus'

const testDb = createTestDb('enrich-board')
let db: ReturnType<typeof testDb.open>

beforeEach(() => {
  db = testDb.open()
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, created_at) VALUES ('stg-open', NULL, 'Backlog', 0, 0, ${now})`)
  db.run(sql`INSERT INTO stages (id, project_id, name, sort_order, is_closed, created_at) VALUES ('stg-done', NULL, 'Done', 1, 1, ${now})`)
  try {
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, agent_type, enabled, source, created_at, updated_at)
      VALUES ('ag-1', 'Jarvis', 'specialist', 'assistant', 1, 'seed', ${now}, ${now})`)
  } catch {
    /* schema may differ slightly */
  }
})

afterEach(() => {
  testDb.cleanup()
})

describe('enrichBoardConversations', () => {
  it('adds agent name and child progress', () => {
    const bus = createLocalBus()
    const svc = createConversationService(db, bus)
    const parent = svc.create({ userId: 'u1', title: 'Parent' })
    svc.update(parent.id, { agentId: 'ag-1', stageId: 'stg-open', projectId: 'general-general' })

    const child1 = svc.createSubConversation({
      title: 'Child 1',
      goalDescription: 'g',
      parentConversationId: parent.id,
    })
    const child2 = svc.createSubConversation({
      title: 'Child 2',
      goalDescription: 'g',
      parentConversationId: parent.id,
    })
    svc.update(child1.id, { status: 'archived' })
    svc.update(child2.id, { stageId: 'stg-done' })

    const refreshed = svc.listByProject('general-general', 'stg-open', 'u1')
    const enriched = enrichBoardConversations(db, refreshed)
    expect(enriched).toHaveLength(1)
    expect(enriched[0].agentName).toBe('Jarvis')
    expect(enriched[0].childCount).toBe(2)
    expect(enriched[0].childrenDone).toBe(2)
  })

  it('returns empty for empty input', () => {
    expect(enrichBoardConversations(db, [])).toEqual([])
  })
})
