// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildAgentPersona } from '../../../src/modules/prompt-wizard/agent-persona-builder.js'
import type { AgentPersonaInput } from '../../../src/modules/prompt-wizard/agent-persona-builder.js'

describe('buildAgentPersona', () => {
  const fullInput: AgentPersonaInput = {
    name: 'Test Persona',
    role: 'Senior Developer',
    goal: 'Write clean, maintainable code',
    backstory: 'You have 15 years of experience in TypeScript.',
    capabilities: ['code review', 'refactoring', 'testing'],
    constraints: ['no external API calls', 'must use TypeScript'],
    systemPrompt: 'Always explain your reasoning.',
  }

  it('all fields present: all XML tags appear with correct content', () => {
    const result = buildAgentPersona(fullInput)

    expect(result).toContain('<role>Senior Developer</role>')
    expect(result).toContain('<goal>Write clean, maintainable code</goal>')
    expect(result).toContain('<backstory>You have 15 years of experience in TypeScript.</backstory>')
    expect(result).toContain('<capabilities>\n- code review\n- refactoring\n- testing\n</capabilities>')
    expect(result).toContain('<constraints>\n- no external API calls\n- must use TypeScript\n</constraints>')
    expect(result).toContain('<additional-instructions>Always explain your reasoning.</additional-instructions>')
  })

  it('empty systemPrompt: no <additional-instructions> tag', () => {
    const result = buildAgentPersona({ ...fullInput, systemPrompt: '' })

    expect(result).not.toContain('<additional-instructions>')
    expect(result).not.toContain('</additional-instructions>')
  })

  it('undefined systemPrompt: no <additional-instructions> tag', () => {
    const result = buildAgentPersona({ ...fullInput, systemPrompt: undefined })

    expect(result).not.toContain('<additional-instructions>')
    expect(result).not.toContain('</additional-instructions>')
  })

  it('whitespace-only systemPrompt: no <additional-instructions> tag', () => {
    const result = buildAgentPersona({ ...fullInput, systemPrompt: '   \n\t  ' })

    expect(result).not.toContain('<additional-instructions>')
    expect(result).not.toContain('</additional-instructions>')
  })

  it('empty capabilities: no <capabilities> tag', () => {
    const result = buildAgentPersona({ ...fullInput, capabilities: [] })

    expect(result).not.toContain('<capabilities>')
    expect(result).not.toContain('</capabilities>')
    // Other tags still present
    expect(result).toContain('<role>')
    expect(result).toContain('<constraints>')
  })

  it('empty constraints: no <constraints> tag', () => {
    const result = buildAgentPersona({ ...fullInput, constraints: [] })

    expect(result).not.toContain('<constraints>')
    expect(result).not.toContain('</constraints>')
    // Other tags still present
    expect(result).toContain('<role>')
    expect(result).toContain('<capabilities>')
  })

  it('minimal input: only required fields', () => {
    const result = buildAgentPersona({
      name: 'Minimal',
      role: 'Assistant',
      goal: 'Help users',
      backstory: 'A general-purpose helper.',
      capabilities: [],
      constraints: [],
    })

    expect(result).toContain('<role>Assistant</role>')
    expect(result).toContain('<goal>Help users</goal>')
    expect(result).toContain('<backstory>A general-purpose helper.</backstory>')
    expect(result).not.toContain('<capabilities>')
    expect(result).not.toContain('<constraints>')
    expect(result).not.toContain('<additional-instructions>')
  })
})
