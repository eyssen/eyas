// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { assembleSystemPrompt, deliveryRecordFields, flattenAssembled, rawSection } from '@modules/prompt-wizard/assemble-system'

function assembled(over: Partial<any> = {}) {
  return {
    prefix: 'PREFIX',
    suffix: 'SUFFIX',
    reminders: ['R1'],
    sections: [{ zone: 'prefix', key: 'core-identity', content: 'PREFIX', chars: 6, estimatedTokens: 2, truncated: false, droppedChars: 0 }],
    ...over,
  }
}

describe('flattenAssembled', () => {
  it('joins prefix, suffix and reminders with blank lines, skipping empties', () => {
    expect(flattenAssembled(assembled() as any)).toBe('PREFIX\n\nSUFFIX\n\nR1')
    expect(flattenAssembled(assembled({ suffix: '   ', reminders: [] }) as any)).toBe('PREFIX')
  })
})

describe('rawSection', () => {
  it('produces an append-zone section with measured length', () => {
    const s = rawSection('raw-system', 'hello')
    expect(s.zone).toBe('append')
    expect(s.key).toBe('raw-system')
    expect(s.chars).toBe(5)
    expect(s.truncated).toBe(false)
  })
})

describe('assembleSystemPrompt', () => {
  it('returns unassembled when no assembler is available', async () => {
    const r = await assembleSystemPrompt({ agentId: 'a1', conversationId: 'c1', projectId: null })
    expect(r).toMatchObject({ system: '', entryPoint: 'unassembled', assemblerError: 'no assembler available' })
    expect(r.sections).toEqual([])
  })

  it('returns unassembled when no agent can be resolved', async () => {
    const buildForPrimary = vi.fn()
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: null, conversationId: 'c1', projectId: null,
    })
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('no agent resolved')
    expect(buildForPrimary).not.toHaveBeenCalled()
  })

  it('uses fallbackAgentId when agentId is null', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: null, conversationId: 'c1', projectId: 'p1',
      fallbackAgentId: () => 'fallback-agent',
    })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'fallback-agent', projectId: 'p1' }))
  })

  it('flattens a successful assembly and reports entryPoint assembled', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: 'p1',
    })
    expect(r.system).toBe('PREFIX\n\nSUFFIX\n\nR1')
    expect(r.entryPoint).toBe('assembled')
    expect(r.sections).toHaveLength(1)
    expect(r.assemblerError).toBeUndefined()
  })

  it('never throws — a failing assembler becomes assemblerError', async () => {
    const buildForPrimary = vi.fn().mockRejectedValue(new Error('workspace missing'))
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
    })
    expect(r.system).toBe('')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('workspace missing')
  })

  it('passes conversationId and channelContext through', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c9', projectId: null,
      channelContext: { channelType: 'telegram' },
    })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c9', channelContext: { channelType: 'telegram' },
    }))
  })
})

describe('assembleSystemPrompt — the turn block (I4)', () => {
  it('returns the turn separately and never flattens it into the system', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled({ turn: '<turn-context>\nNOW\n</turn-context>' }))
    const r = await assembleSystemPrompt({ assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null })
    expect(r.turn).toBe('<turn-context>\nNOW\n</turn-context>')
    expect(r.system).toBe('PREFIX\n\nSUFFIX\n\nR1')
    expect(r.system).not.toContain('turn-context')
  })

  it('forwards turnText, audience and turnId to the assembler', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled())
    await assembleSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      turnText: 'hello', audience: 'external', turnId: 't-1',
    })
    expect(buildForPrimary).toHaveBeenCalledWith(expect.objectContaining({ turnText: 'hello', audience: 'external', turnId: 't-1' }))
  })

  it('an unassembled prompt has no turn', async () => {
    const r = await assembleSystemPrompt({ agentId: 'a1', conversationId: 'c1', projectId: null })
    expect(r.turn).toBeUndefined()
  })
})

describe('assembleSystemPrompt — fallbackAgentId failures', () => {
  it('never propagates when fallbackAgentId itself throws', async () => {
    const buildForPrimary = vi.fn()
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary },
      agentId: null,
      conversationId: 'c1',
      projectId: null,
      fallbackAgentId: () => { throw new Error('db down') },
    })
    expect(r.system).toBe('')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('db down')
    expect(buildForPrimary).not.toHaveBeenCalled()
  })
})

describe('assembleSystemPrompt — the turn block without a system prompt (I5)', () => {
  const turnOnly = { turn: '<turn-context>\nNOW\n<eyas-memory>m</eyas-memory>\n</turn-context>', sections: [{ zone: 'turn', key: 'memory-recall', content: 'm', chars: 1, estimatedTokens: 1, truncated: false, droppedChars: 0 }], delivery: { profile: {} as any, budgetTotalTokens: 1 } }

  it('(+) no agent resolved: still unassembled, but the clock and recall come back as the turn', async () => {
    const buildForPrimary = vi.fn()
    const buildTurnOnly = vi.fn().mockResolvedValue(turnOnly)
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary, buildTurnOnly }, agentId: null, conversationId: 'c1', projectId: null, turnText: 'hi', audience: 'owner',
    })
    expect(r).toMatchObject({ system: '', entryPoint: 'unassembled', assemblerError: 'no agent resolved', turn: turnOnly.turn })
    expect(r.sections).toEqual(turnOnly.sections)
    expect(buildForPrimary).not.toHaveBeenCalled()
    expect(buildTurnOnly).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1', turnText: 'hi', audience: 'owner' }))
  })

  it('(+) a failed assembly still carries the turn', async () => {
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary: vi.fn().mockRejectedValue(new Error('workspace unreadable')), buildTurnOnly: vi.fn().mockResolvedValue(turnOnly) },
      agentId: 'a1', conversationId: 'c1', projectId: null,
    })
    expect(r.assemblerError).toBe('workspace unreadable')
    expect(r.turn).toBe(turnOnly.turn)
  })

  it('(−) a turn that cannot be built either is left out, never thrown', async () => {
    const r = await assembleSystemPrompt({
      assembler: { buildForPrimary: vi.fn(), buildTurnOnly: vi.fn().mockRejectedValue(new Error('clock broke')) },
      agentId: null, conversationId: 'c1', projectId: null,
    })
    expect(r).toMatchObject({ entryPoint: 'unassembled', assemblerError: 'no agent resolved' })
    expect(r.turn).toBeUndefined()
    expect(r.sections).toEqual([])
  })
})

// G11 — a composition records the window the prompt was sized for only when
// the profile resolved it; occupancy must not take a placeholder for it.
describe('deliveryRecordFields', () => {
  const delivery = (resolved: boolean) => ({
    profile: {
      providerId: 'openai', modelId: 'm', contextWindow: resolved ? 128_000 : 200_000, supportsTools: true,
      toolAddressing: { kind: 'native' as const }, drillDown: true, resolved, windowSource: resolved ? 'catalog' as const : 'default' as const,
    },
    budgetTotalTokens: 9_000,
  })

  it('(+) a resolved profile records its window, its budget and the delivery record itself (I12)', () => {
    const d = delivery(true)
    expect(deliveryRecordFields(d)).toEqual({ contextWindow: 128_000, budgetTotalTokens: 9_000, delivery: d })
  })

  it('(−) an unresolved profile records the budget but not the placeholder window; no delivery records nothing', () => {
    const d = delivery(false)
    expect(deliveryRecordFields(d)).toEqual({ budgetTotalTokens: 9_000, delivery: d })
    expect(deliveryRecordFields(undefined)).toEqual({})
  })
})
