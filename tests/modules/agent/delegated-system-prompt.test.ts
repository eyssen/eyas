// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { buildDelegatedSystemPrompt } from '@modules/agent/delegated-system-prompt'

const assembled = {
  prefix: 'CORE', suffix: 'RUNTIME', reminders: [],
  sections: [{ zone: 'prefix', key: 'core-identity', content: 'CORE', chars: 4, estimatedTokens: 1, truncated: false, droppedChars: 0 }],
}

describe('buildDelegatedSystemPrompt', () => {
  it('prepends the assembled prompt to the agent definition prompt', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: 'p1',
      agentSystemPrompt: 'You are a bug triager.',
    })
    expect(r.system).toBe('CORE\n\nRUNTIME\n\nYou are a bug triager.')
    expect(r.entryPoint).toBe('assembled')
  })

  it('records the agent prompt as its own section so the inspector sees it', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: 'You are a bug triager.',
    })
    const keys = r.sections.map((s) => s.key)
    expect(keys).toContain('core-identity')
    expect(keys).toContain('agent-definition-prompt')
  })

  it('falls back to the agent prompt alone when the assembler fails', async () => {
    const buildForPrimary = vi.fn().mockRejectedValue(new Error('nope'))
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: 'You are a bug triager.',
    })
    expect(r.system).toBe('You are a bug triager.')
    expect(r.entryPoint).toBe('unassembled')
    expect(r.assemblerError).toBe('nope')
    expect(r.sections.map((s) => s.key)).toEqual(['agent-definition-prompt'])
  })

  it('produces an empty system and no sections when both sources are empty', async () => {
    const r = await buildDelegatedSystemPrompt({
      agentId: 'a1', conversationId: 'c1', projectId: null, agentSystemPrompt: '',
    })
    expect(r.system).toBe('')
    expect(r.sections).toEqual([])
    expect(r.entryPoint).toBe('unassembled')
  })

  it('works with no agent prompt at all', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: null,
    })
    expect(r.system).toBe('CORE\n\nRUNTIME')
    expect(r.sections.map((s) => s.key)).toEqual(['core-identity'])
  })

  it('trims a whitespace-only agent prompt rather than adding an empty section', async () => {
    const buildForPrimary = vi.fn().mockResolvedValue(assembled)
    const r = await buildDelegatedSystemPrompt({
      assembler: { buildForPrimary }, agentId: 'a1', conversationId: 'c1', projectId: null,
      agentSystemPrompt: '   \n  ',
    })
    expect(r.system).toBe('CORE\n\nRUNTIME')
    expect(r.sections).toHaveLength(1)
  })
})
