// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
import { resolveThinkingAndEffort } from '@modules/conversations/thinking-resolver.js'
import { buildOrchestrationDirective } from '@modules/conversations/orchestration-directive.js'

describe('resolveThinkingAndEffort — orchestration deep mode', () => {
  it('deep mode defaults effort to max (and enables thinking)', () => {
    expect(resolveThinkingAndEffort({ thinking: 'off', thinkingBudget: null, effort: null, orchestration: 'deep' }))
      .toEqual({ thinking: { enabled: true, budgetTokens: 10000 }, effort: 'max' })
  })

  it('deep mode respects an explicit effort choice', () => {
    expect(resolveThinkingAndEffort({ thinking: 'off', thinkingBudget: null, effort: 'low', orchestration: 'deep' }).effort)
      .toBe('low')
  })

  it('solo and auto modes change nothing', () => {
    expect(resolveThinkingAndEffort({ thinking: 'off', thinkingBudget: null, effort: null, orchestration: 'solo' }))
      .toEqual({ thinking: undefined, effort: undefined })
    expect(resolveThinkingAndEffort({ thinking: 'on', thinkingBudget: 5000, effort: null, orchestration: 'auto' }))
      .toEqual({ thinking: { enabled: true, budgetTokens: 5000 }, effort: undefined })
  })
})

describe('buildOrchestrationDirective', () => {
  it('deep + claude-code instructs native Task fan-out', () => {
    const d = buildOrchestrationDirective('deep', 'claude-code')
    expect(d).toContain('Task')
    expect(d.length).toBeGreaterThan(40)
  })

  it('deep + other providers instructs the EYAS team path', () => {
    const d = buildOrchestrationDirective('deep', 'anthropic')
    expect(d).toContain('propose_team')
  })

  it('solo/auto/unknown produce no directive', () => {
    expect(buildOrchestrationDirective('solo', 'claude-code')).toBe('')
    expect(buildOrchestrationDirective('auto', 'claude-code')).toBe('')
    expect(buildOrchestrationDirective(null, 'claude-code')).toBe('')
  })
})

describe('conversation service — orchestration column', () => {
  const testDb = createTestDb('orchestration-mode')
  let svc: ConversationService

  beforeEach(() => {
    svc = createConversationService(testDb.open())
  })
  afterEach(() => testDb.cleanup())

  it('defaults to auto and persists updates', () => {
    const conv = svc.create({ userId: 'u1' })
    expect((conv as any).orchestration).toBe('auto')
    svc.update(conv.id, { orchestration: 'deep' } as any)
    expect((svc.get(conv.id) as any).orchestration).toBe('deep')
  })
})
