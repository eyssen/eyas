// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { splitLegacySystemPrompt, type LegacyAgentMeta } from '../../scripts/lib/legacy-prompt-splitter.js'
import type { ModelProvider, ModelResponse, ContentBlock } from '../../src/modules/model/types.js'

function makeModel(content: ContentBlock[]): { model: ModelProvider; sendSpy: ReturnType<typeof vi.fn> } {
  const sendSpy = vi.fn(async (): Promise<ModelResponse> => ({
    id: 'm1',
    provider: 'mock',
    model: 'mock',
    content,
    stopReason: 'end',
    usage: { inputTokens: 1, outputTokens: 1 },
  }))
  return {
    model: {
      id: 'mock',
      capabilities: { promptCache: 'none', toolCalling: 'none', multiSystemMessages: false, thinking: false, effectiveContextWindow: 8000 },
      send: sendSpy,
    },
    sendSpy,
  }
}

const meta: LegacyAgentMeta = {
  id: 'jarvis',
  name: 'Jarvis',
  role: 'Personal assistant',
  goal: 'Help the owner manage daily tasks',
  backstory: null,
  tier: 'specialist',
}

describe('splitLegacySystemPrompt', () => {
  it('returns low-confidence default when legacy prompt is empty', async () => {
    const { model, sendSpy } = makeModel([])
    const result = await splitLegacySystemPrompt('', meta, model, 'gpt-4')

    expect(result).toEqual({
      identityMission: 'Help the owner manage daily tasks',
      identityProactiveDuties: '(none defined)',
      identityEscalation: '(none defined)',
      agentsRules: '',
      confidence: 'low',
    })
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('parses a happy-path JSON response from the model', async () => {
    const json = JSON.stringify({
      identityMission: 'I help with tasks.',
      identityProactiveDuties: '- Daily standups\n- Inbox triage',
      identityEscalation: 'Escalate billing decisions to the owner.',
      agentsRules: '## Rules\n\nAlways confirm destructive actions.',
      confidence: 'high',
    })
    const { model } = makeModel([{ type: 'text', text: `\`\`\`json\n${json}\n\`\`\`` }])

    const result = await splitLegacySystemPrompt('You are Jarvis. Help the owner.', meta, model, 'gpt-4')
    expect(result.confidence).toBe('high')
    expect(result.identityMission).toBe('I help with tasks.')
    expect(result.identityProactiveDuties).toContain('Daily standups')
  })

  it('falls back to legacy-rules wrapper when the model response is malformed', async () => {
    const { model } = makeModel([{ type: 'text', text: 'not even close to JSON' }])

    const result = await splitLegacySystemPrompt('Legacy text', meta, model, 'gpt-4')
    expect(result.confidence).toBe('low')
    expect(result.identityMission).toBe('Help the owner manage daily tasks')
    expect(result.identityProactiveDuties).toBe('(see legacy rules below)')
    expect(result.agentsRules).toBe('## Legacy Rules\n\nLegacy text')
  })

  it('uses metadata goal/role in the fallback when the model fails', async () => {
    const noGoalMeta: LegacyAgentMeta = { ...meta, goal: null, role: null }
    const { model } = makeModel([{ type: 'text', text: 'garbage' }])

    const result = await splitLegacySystemPrompt('legacy body', noGoalMeta, model, 'gpt-4')
    expect(result.identityMission).toBe('Migrated from legacy')
  })
})
