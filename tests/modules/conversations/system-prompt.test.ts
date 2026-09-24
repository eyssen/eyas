// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { resolveConversationSystemPrompt } from '@modules/conversations/system-prompt'

const assembled = {
  prefix: '<core-identity>\nI am EYAS.\n</core-identity>\n',
  suffix: '<runtime>\n- Current date: 2026-08-24\n</runtime>\n',
  reminders: [],
  cacheBoundaryHint: 0, prefixHash: 'h', tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 },
  sections: [
    { zone: 'prefix', key: 'core-identity', content: 'c', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 },
    { zone: 'suffix', key: 'runtime', content: 'r', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 },
  ],
} as any

const okAssembler = { buildForPrimary: async () => assembled } as any

/** A spy assembler for tests asserting buildForPrimary was (not) called. */
function spyAssembler() {
  return { buildForPrimary: vi.fn(async () => assembled) } as any
}

describe('resolveConversationSystemPrompt', () => {
  it('returns the flattened system plus the manifest', async () => {
    const r = await resolveConversationSystemPrompt({
      assembler: okAssembler, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe([assembled.prefix, assembled.suffix].join('\n\n'))
    expect(r.sections).toHaveLength(2)
    expect(r.entryPoint).toBe('conversation')
    expect(r.assemblerError).toBeUndefined()
  })

  it('records a body.system override as one section', async () => {
    const assembler = spyAssembler()
    const r = await resolveConversationSystemPrompt({
      bodySystem: 'OVERRIDE', assembler, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe('OVERRIDE')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.sections).toEqual([
      expect.objectContaining({ zone: 'append', key: 'body-system-override', content: 'OVERRIDE' }),
    ])
  })

  it('(+) a body.system override replaces only the system: the turn block is still built', async () => {
    const turnSection = { zone: 'turn', key: 'memory-recall', content: '<eyas-memory>m</eyas-memory>', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 }
    const assembler = { buildForPrimary: vi.fn(async () => ({
      ...assembled,
      sections: [...assembled.sections, turnSection],
      turn: '<turn-context>\nNOW\n<eyas-memory>m</eyas-memory>\n</turn-context>',
    })) } as any
    const r = await resolveConversationSystemPrompt({
      bodySystem: 'OVERRIDE', assembler, agentId: 'a1', projectId: null, conversationId: 'c1', turnText: 'hello',
    })
    expect(r.system).toBe('OVERRIDE')
    expect(r.turn).toContain('<eyas-memory>m</eyas-memory>')
    // The override's own section, then the turn sections — never the prefix/suffix it replaced.
    expect(r.sections.map((s) => s.key)).toEqual(['body-system-override', 'memory-recall'])
    expect(assembler.buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ turnText: 'hello' }))
  })

  it('(−) the turn block never lands in the system prompt', async () => {
    const assembler = { buildForPrimary: async () => ({ ...assembled, turn: '<turn-context>\nNOW\n</turn-context>' }) } as any
    const r = await resolveConversationSystemPrompt({
      assembler, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.turn).toBe('<turn-context>\nNOW\n</turn-context>')
    expect(r.system).not.toContain('turn-context')
  })

  it('surfaces an assembler failure instead of swallowing it', async () => {
    const boom = { buildForPrimary: async () => { throw new Error('resolver exploded') } } as any
    const r = await resolveConversationSystemPrompt({
      assembler: boom, agentId: 'a1', projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe('')          // still fails soft
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toContain('resolver exploded')
  })

  it('uses the fallback agentId when the conversation has none', async () => {
    const r = await resolveConversationSystemPrompt({
      assembler: okAssembler, agentId: null, projectId: 'p1', conversationId: 'c1', fallbackAgentId: () => 'default-agent',
    })
    expect(r.entryPoint).toBe('conversation')
    expect(r.sections).toHaveLength(2)
  })

  it('surfaces "no agent resolved" when no agentId is resolvable', async () => {
    const assembler = spyAssembler()
    const r = await resolveConversationSystemPrompt({
      assembler, agentId: null, projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe('')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('no agent resolved')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })

  it('surfaces "no assembler available" when there is no assembler', async () => {
    const r = await resolveConversationSystemPrompt({
      agentId: null, projectId: null, conversationId: 'c1',
    })
    expect(r.system).toBe('')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('no assembler available')
  })

  it('never propagates when fallbackAgentId itself throws', async () => {
    const assembler = spyAssembler()
    const r = await resolveConversationSystemPrompt({
      assembler, agentId: null, projectId: null, conversationId: 'c1',
      fallbackAgentId: () => { throw new Error('db down') },
    })
    expect(r.system).toBe('')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('db down')
    expect(assembler.buildForPrimary).not.toHaveBeenCalled()
  })
})
