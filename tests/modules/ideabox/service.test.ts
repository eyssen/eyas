import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createIdeaboxService, createIdeaboxTables } from '@modules/ideabox/service'

const testDb = createTestDb('ideabox-service')

describe('ideabox service', () => {
  let db: ReturnType<typeof testDb.open>
  let box: ReturnType<typeof createIdeaboxService>

  beforeEach(() => {
    db = testDb.open()
    createIdeaboxTables(db as any)
    box = createIdeaboxService(db as any)
  })

  afterEach(() => {
    testDb.cleanup()
  })

  it('scores impact×effort and surfaces top suggestions', () => {
    const idea = box.create({ title: 'Automate billing' })
    box.score(idea.id, 5, 2) // score 3
    const low = box.create({ title: 'Rewrite everything' })
    box.score(low.id, 2, 5) // score -3
    const top = box.topSuggestions(3)
    expect(top.some((i) => i.id === idea.id)).toBe(true)
    expect(top.some((i) => i.id === low.id)).toBe(false)
  })

  it('promotes to kanban status', () => {
    const idea = box.create({ title: 'Ship feature X' })
    const promoted = box.promote(idea.id, 'conv-1')
    expect(promoted?.status).toBe('kanban')
    expect(promoted?.conversationId).toBe('conv-1')
  })
})
