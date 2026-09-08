// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { assembleSystemPrompt, flattenAssembled, rawSection } from '@modules/prompt-wizard/assemble-system'

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
