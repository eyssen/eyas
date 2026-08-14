// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db.js'
import { createForgeTables } from '@modules/forge/schema'
import { createFeedbackCollector } from '@modules/forge/feedback-collector'
import type { EyasDb } from '@core/types'

describe('Forge — FeedbackCollector', () => {
  let db: EyasDb
  let collector: ReturnType<typeof createFeedbackCollector>

  beforeEach(() => {
    db = createMemoryDb() as EyasDb
    createForgeTables(db)
    collector = createFeedbackCollector(db)
  })

  it('record() stores positive feedback and returns it with id', () => {
    const fb = collector.record({
      target: 'skill',
      targetId: 'sk-weather',
      conversationId: 'conv-1',
      useful: true,
    })

    expect(fb.id).toBeTruthy()
    expect(fb.target).toBe('skill')
    expect(fb.targetId).toBe('sk-weather')
    expect(fb.conversationId).toBe('conv-1')
    expect(fb.agentId).toBeNull()
    expect(fb.useful).toBe(true)
    expect(fb.friction).toBeNull()
    expect(fb.betterApproach).toBeNull()
    expect(fb.createdAt).toBeTruthy()
  })

  it('record() stores friction and betterApproach', () => {
    const fb = collector.record({
      target: 'tool',
      targetId: 'tool-search',
      conversationId: 'conv-2',
      agentId: 'agent-1',
      useful: false,
      friction: 'Too slow response',
      betterApproach: 'Use cached results',
    })

    expect(fb.useful).toBe(false)
    expect(fb.friction).toBe('Too slow response')
    expect(fb.betterApproach).toBe('Use cached results')
    expect(fb.agentId).toBe('agent-1')
  })

  it('listForTarget() filters by target type and id', () => {
    collector.record({ target: 'skill', targetId: 'sk-weather', conversationId: 'c1', useful: true })
    collector.record({ target: 'skill', targetId: 'sk-weather', conversationId: 'c2', useful: false, friction: 'slow' })
    collector.record({ target: 'skill', targetId: 'sk-other', conversationId: 'c3', useful: true })
    collector.record({ target: 'tool', targetId: 'sk-weather', conversationId: 'c4', useful: true })

    const results = collector.listForTarget('skill', 'sk-weather')
    expect(results).toHaveLength(2)
    expect(results.every(r => r.target === 'skill' && r.targetId === 'sk-weather')).toBe(true)
  })

  it('getStats() computes total, useful count, friction count, friction rate', () => {
    collector.record({ target: 'skill', targetId: 'sk-a', conversationId: 'c1', useful: true })
    collector.record({ target: 'skill', targetId: 'sk-a', conversationId: 'c2', useful: true })
    collector.record({ target: 'skill', targetId: 'sk-a', conversationId: 'c3', useful: false, friction: 'confusing output' })
    collector.record({ target: 'skill', targetId: 'sk-a', conversationId: 'c4', useful: false, friction: 'wrong format' })

    const stats = collector.getStats('skill', 'sk-a')
    expect(stats.total).toBe(4)
    expect(stats.useful).toBe(2)
    expect(stats.frictionCount).toBe(2)
    expect(stats.frictionRate).toBe(0.5)
  })

  it('getStats() returns zeros for unknown target', () => {
    const stats = collector.getStats('tool', 'nonexistent')
    expect(stats.total).toBe(0)
    expect(stats.frictionRate).toBe(0)
  })
})
