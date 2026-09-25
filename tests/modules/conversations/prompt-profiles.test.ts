// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  buildEnhancerSystemPrompt,
  extractFinalPrompts,
  extractQualityCheck,
  isPromptTaskType,
  resolvePromptFamily,
  resolvePromptProfile,
} from '@modules/conversations/prompt-profiles/index.js'

describe('resolvePromptFamily', () => {
  it('maps anthropic / claude providers and model ids', () => {
    expect(resolvePromptFamily({ providerId: 'anthropic', modelId: 'claude-sonnet-4' })).toBe('claude')
    expect(resolvePromptFamily({ providerId: 'claude-code', modelId: null })).toBe('claude')
    expect(resolvePromptFamily({ providerId: 'openrouter', modelId: 'anthropic/claude-opus-4' })).toBe('claude')
  })

  it('maps openai and gpt model strings', () => {
    expect(resolvePromptFamily({ providerId: 'openai', modelId: 'gpt-5' })).toBe('openai')
    expect(resolvePromptFamily({ providerId: 'openrouter', modelId: 'openai/gpt-4o' })).toBe('openai')
  })

  it('maps gemini, grok, kimi', () => {
    expect(resolvePromptFamily({ providerId: 'gemini', modelId: 'gemini-2.5-pro' })).toBe('gemini')
    expect(resolvePromptFamily({ providerId: 'grok-cli', modelId: 'grok-4.5' })).toBe('grok')
    expect(resolvePromptFamily({ providerId: 'kimi', modelId: 'kimi-k2.5' })).toBe('kimi')
    expect(resolvePromptFamily({ providerId: 'kimi-cli', modelId: null })).toBe('kimi')
  })

  it('falls back to generic for unknown / bare openrouter', () => {
    expect(resolvePromptFamily({ providerId: 'openrouter', modelId: null })).toBe('generic')
    expect(resolvePromptFamily({ providerId: null, modelId: null })).toBe('generic')
    expect(resolvePromptFamily({})).toBe('generic')
  })
})

describe('resolvePromptProfile', () => {
  it('returns a profile with techniques and skeleton', () => {
    const p = resolvePromptProfile({ providerId: 'anthropic', modelId: 'claude-opus-4' })
    expect(p.family).toBe('claude')
    expect(p.displayName).toBe('Claude')
    expect(p.techniques.length).toBeGreaterThan(3)
    expect(p.skeleton).toContain('<role>')
  })
})

describe('buildEnhancerSystemPrompt', () => {
  it('embeds target family techniques and checklist', () => {
    const prompt = buildEnhancerSystemPrompt({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
      taskType: 'coding',
    })
    expect(prompt).toContain('Family: claude')
    expect(prompt).toContain('anthropic / claude-sonnet-4')
    expect(prompt).toContain('<final-prompt')
    expect(prompt).toContain('Prompt anatomy checklist')
    expect(prompt).toContain('coding')
    expect(prompt).toMatch(/XML/i)
    expect(prompt).toMatch(/minimal scope/i)
  })

  it('uses gemini-specific structure hints', () => {
    const prompt = buildEnhancerSystemPrompt({
      providerId: 'gemini',
      modelId: 'gemini-3-pro',
      taskType: 'research',
    })
    expect(prompt).toContain('Family: gemini')
    expect(prompt).toMatch(/precise/i)
    expect(prompt).toContain('research')
  })

  it('uses openai anti-contradiction guidance', () => {
    const prompt = buildEnhancerSystemPrompt({
      providerId: 'openai',
      modelId: 'gpt-5',
    })
    expect(prompt).toContain('Family: openai')
    expect(prompt).toMatch(/contradict/i)
  })

  it('defaults task type to general', () => {
    const prompt = buildEnhancerSystemPrompt({ providerId: 'kimi' })
    expect(prompt).toContain('Task type hint: general')
    expect(prompt).toContain('Family: kimi')
  })

  it('includes quality gate and alternatives instructions', () => {
    const prompt = buildEnhancerSystemPrompt({ providerId: 'anthropic' })
    expect(prompt).toContain('Quality gate')
    expect(prompt).toContain('<quality-check')
    expect(prompt).toContain('score ≥ 8')
    expect(prompt).toContain('variant="concise"')
    expect(prompt).toContain('variant="thorough"')
  })
})

describe('extractFinalPrompts / extractQualityCheck', () => {
  it('parses multiple final-prompt variants and carry-attachments', () => {
    const text = `
Here you go.
<quality-check score="9" missing="">
Solid
</quality-check>
<final-prompt carry-attachments="none" variant="concise">
Short prompt
</final-prompt>
<final-prompt carry-attachments="all" variant="thorough">
Long prompt with files
</final-prompt>
`
    const variants = extractFinalPrompts(text)
    expect(variants).toHaveLength(2)
    expect(variants[0]).toMatchObject({ text: 'Short prompt', variant: 'concise', carryAttachments: 'none' })
    expect(variants[1]).toMatchObject({ text: 'Long prompt with files', variant: 'thorough', carryAttachments: 'all' })

    const q = extractQualityCheck(text)
    expect(q).toEqual({ score: 9, missing: [], note: 'Solid' })
  })

  it('parses missing checklist gaps and clamps score', () => {
    const text = `<quality-check score="99" missing="examples, success criteria">fix me</quality-check>
<final-prompt>x</final-prompt>`
    const q = extractQualityCheck(text)
    expect(q?.score).toBe(10)
    expect(q?.missing).toEqual(['examples', 'success criteria'])
    expect(q?.note).toBe('fix me')
  })

  it('falls back to loose Quality: N/10 line', () => {
    expect(extractQualityCheck('Quality: 7/10 — almost')).toEqual({
      score: 7,
      missing: [],
      note: '',
    })
  })
})

describe('isPromptTaskType', () => {
  it('accepts known task types only', () => {
    expect(isPromptTaskType('coding')).toBe(true)
    expect(isPromptTaskType('nope')).toBe(false)
    expect(isPromptTaskType(null)).toBe(false)
  })
})
