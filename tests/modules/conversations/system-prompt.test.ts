// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { resolveConversationSystemPrompt } from '../../../src/modules/conversations/system-prompt.js'

const fakeAssembled = { prefix: '<core-identity>\nX\n</core-identity>', suffix: '<active-voice>\nv\n</active-voice>', reminders: [], cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 } }

describe('resolveConversationSystemPrompt', () => {
  it('body.system always wins and skips the assembler', async () => {
    const assembler = { buildForPrimary: vi.fn() }
    const out = await resolveConversationSystemPrompt({ bodySystem: 'OVERRIDE', assembler, agentId: 'a1', projectId: null, conversationId: 'c1' })
    expect(out).toBe('OVERRIDE')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })

  it('composes prefix+suffix+reminders into one string', async () => {
    const assembler = { buildForPrimary: vi.fn().mockResolvedValue(fakeAssembled) }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: 'a1', projectId: 'p1', conversationId: 'c1' })
    expect(out).toContain('<core-identity>')
    expect(out).toContain('<active-voice>')
    expect(assembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'a1', conversationId: 'c1', projectId: 'p1' }))
  })

  it('uses the fallback agentId when the conversation has none', async () => {
    const assembler = { buildForPrimary: vi.fn().mockResolvedValue(fakeAssembled) }
    await resolveConversationSystemPrompt({ assembler, agentId: null, projectId: 'p1', conversationId: 'c1', fallbackAgentId: () => 'default-agent' })
    expect(assembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'default-agent' }))
  })

  it('returns "" (never throws) when no agentId is resolvable', async () => {
    const assembler = { buildForPrimary: vi.fn() }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: null, projectId: null, conversationId: 'c1' })
    expect(out).toBe('')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })

  it('returns "" when the assembler throws (fails soft)', async () => {
    const assembler = { buildForPrimary: vi.fn().mockRejectedValue(new Error('boom')) }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: 'a1', projectId: null, conversationId: 'c1' })
    expect(out).toBe('')
  })

  it('returns "" when fallbackAgentId throws (never propagates)', async () => {
    const assembler = { buildForPrimary: vi.fn() }
    const out = await resolveConversationSystemPrompt({ assembler, agentId: null, projectId: null, conversationId: 'c1', fallbackAgentId: () => { throw new Error('db down') } })
    expect(out).toBe('')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })
})
