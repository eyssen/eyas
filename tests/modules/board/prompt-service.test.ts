import { describe, it, expect } from 'vitest'
import { resolvePromptChain } from '@modules/board/services/prompt-service'

describe('resolvePromptChain', () => {
  it('returns empty string when all levels are empty', () => {
    expect(resolvePromptChain(undefined, undefined, undefined)).toBe('')
  })

  it('uses type prompt when others are empty', () => {
    expect(resolvePromptChain('You are a bug tracker', undefined, undefined)).toBe('You are a bug tracker')
  })

  it('project overrides type when no "+" prefix', () => {
    expect(resolvePromptChain('Type prompt', 'Project override', undefined)).toBe('Project override')
  })

  it('project extends type with "+" prefix', () => {
    expect(resolvePromptChain('Type prompt', '+ Extra context', undefined)).toBe('Type prompt\nExtra context')
  })

  it('conversation overrides everything when no "+" prefix', () => {
    expect(resolvePromptChain('Type', 'Project', 'Conv override')).toBe('Conv override')
  })

  it('conversation extends with "+" prefix', () => {
    expect(resolvePromptChain('Type', '+ Project ext', '+ Conv ext')).toBe('Type\nProject ext\nConv ext')
  })

  it('handles "+" extend on empty parent', () => {
    expect(resolvePromptChain(undefined, '+ Extend nothing', undefined)).toBe('Extend nothing')
  })

  it('trims whitespace', () => {
    expect(resolvePromptChain('  Type  ', '  + Extra  ', undefined)).toBe('Type\nExtra')
  })
})
