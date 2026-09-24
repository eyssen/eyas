// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createConversationService, type ConversationService } from '@modules/conversations/conversation-service'
import { loadEffortIntent } from '@modules/conversations/effort-intent.js'
import { buildOrchestrationDirective } from '@modules/conversations/orchestration-directive.js'

describe('loadEffortIntent — orchestration deep mode (stored rows)', () => {
  const testDb = createTestDb('orchestration-mode-effort')
  let db: any
  let svc: ConversationService

  beforeEach(() => {
    db = testDb.open()
    svc = createConversationService(db)
  })
  afterEach(() => testDb.cleanup())

  function stored(update: Record<string, unknown>): string {
    const id = svc.create({ userId: 'u1' }).id
    svc.update(id, update as any)
    return id
  }

  it('deep mode defaults the effort intent to max (source deep)', () => {
    expect(loadEffortIntent({ db }, stored({ orchestration: 'deep' }))).toEqual({ level: 'max', source: 'deep' })
  })

  it('deep mode respects an explicit effort choice', () => {
    expect(loadEffortIntent({ db }, stored({ orchestration: 'deep', effort: 'low' }))).toEqual({ level: 'low', source: 'conversation' })
  })

  it('solo and auto modes add no intent', () => {
    expect(loadEffortIntent({ db }, stored({ orchestration: 'solo' }))).toBeUndefined()
    expect(loadEffortIntent({ db }, stored({ orchestration: 'auto' }))).toBeUndefined()
  })
})

describe('buildOrchestrationDirective', () => {
  it('deep: one provider-neutral directive — specialist fan-out through EYAS, not a team card first', () => {
    const d = buildOrchestrationDirective('deep')
    expect(d).toContain('Deep orchestration mode is ON')
    expect(d).toContain('run_specialist')
    expect(d).toContain('handoff_to_colleague')
    expect(d).toContain('propose_team')
  })

  it('takes no provider: the same text reaches claude-code and grok-cli (the old second argument is ignored)', () => {
    const call = buildOrchestrationDirective as unknown as (mode: string, providerId?: string) => string
    const neutral = buildOrchestrationDirective('deep')
    expect(call('deep', 'claude-code')).toBe(neutral)
    expect(call('deep', 'grok-cli')).toBe(neutral)
    expect(buildOrchestrationDirective.length).toBe(1)
  })

  it('never tells the model to use a native Task/Agent subagent tool (negative)', () => {
    const d = buildOrchestrationDirective('deep')
    expect(d).not.toMatch(/\bTask\b/)
    expect(d).not.toMatch(/\bAgent tool\b/i)
    expect(d).not.toMatch(/subagent/i)
  })

  it('solo/auto/unknown produce no directive', () => {
    expect(buildOrchestrationDirective('solo')).toBe('')
    expect(buildOrchestrationDirective('auto')).toBe('')
    expect(buildOrchestrationDirective(null)).toBe('')
    expect(buildOrchestrationDirective(undefined)).toBe('')
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
