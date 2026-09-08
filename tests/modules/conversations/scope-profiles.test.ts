// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  buildAgentSystemCoachSystemPrompt,
  buildProjectCoachSystemPrompt,
  buildProjectTypeCoachSystemPrompt,
  buildScopedCoachSystemPrompt,
  coachGoalDescription,
  isPromptCoachScope,
} from '@modules/conversations/prompt-profiles/scope-profiles.js'

describe('isPromptCoachScope', () => {
  it('accepts known scopes', () => {
    expect(isPromptCoachScope('project')).toBe(true)
    expect(isPromptCoachScope('project-type')).toBe(true)
    expect(isPromptCoachScope('agent-system')).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isPromptCoachScope('conversation')).toBe(false)
    expect(isPromptCoachScope('')).toBe(false)
    expect(isPromptCoachScope(null)).toBe(false)
  })
})

describe('buildProjectCoachSystemPrompt', () => {
  it('describes project cascade role and emits final-prompt workflow', () => {
    const prompt = buildProjectCoachSystemPrompt({
      name: 'EYAS',
      typeName: 'Development',
      typePrompt: 'Ship carefully.',
      defaultAgentName: 'Jarvis',
    })
    expect(prompt).toMatch(/project-level prompt/i)
    expect(prompt).toMatch(/prompt cascade/i)
    expect(prompt).toContain('EYAS')
    expect(prompt).toContain('Jarvis')
    expect(prompt).toContain('Ship carefully.')
    expect(prompt).toContain('<final-prompt')
    expect(prompt).toContain('<quality-check')
    expect(prompt).toMatch(/NOT for/i)
    expect(prompt).toMatch(/NO tools/i)
  })
})

describe('buildProjectTypeCoachSystemPrompt', () => {
  it('describes type-level inheritance defaults', () => {
    const prompt = buildProjectTypeCoachSystemPrompt({ name: 'Research' })
    expect(prompt).toMatch(/project-type prompt/i)
    expect(prompt).toContain('Research')
    expect(prompt).toContain('<final-prompt')
  })
})

describe('buildAgentSystemCoachSystemPrompt', () => {
  it('targets additional-instructions and known agent fields', () => {
    const prompt = buildAgentSystemCoachSystemPrompt({
      name: 'Critic',
      role: 'Critical Reviewer',
      goal: 'Find blind spots',
      tools: ['search', 'file-read'],
      agentType: 'critic',
      tier: 'team',
    })
    expect(prompt).toContain('additional-instructions')
    expect(prompt).toContain('Critic')
    expect(prompt).toContain('search')
    expect(prompt).toMatch(/IDENTITY\.md/i)
    expect(prompt).toMatch(/SOUL/i)
    expect(prompt).toContain('<final-prompt')
    expect(prompt).toMatch(/do not.*helpful assistant|generic "you are a helpful assistant"/i)
  })
})

describe('buildScopedCoachSystemPrompt', () => {
  it('dispatches by scope', () => {
    expect(buildScopedCoachSystemPrompt('project')).toMatch(/project-level/i)
    expect(buildScopedCoachSystemPrompt('project-type')).toMatch(/project-type/i)
    expect(buildScopedCoachSystemPrompt('agent-system')).toMatch(/systemPrompt|additional-instructions/i)
  })
})

describe('coachGoalDescription', () => {
  it('prefixes scope', () => {
    expect(coachGoalDescription('project')).toBe('prompt-coach:project')
    expect(coachGoalDescription('agent-system')).toBe('prompt-coach:agent-system')
  })
})
