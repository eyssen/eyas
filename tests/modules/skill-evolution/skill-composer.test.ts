import { describe, it, expect } from 'vitest'
import { composeSkillContent } from '@modules/skill-evolution/skill-composer'
import type { DetectedPattern } from '@modules/skill-evolution/types'

const samplePattern: DetectedPattern = {
  title: 'Deploy to Production',
  occurrences: 7,
  confidence: 0.7,
  avgTokens: 350,
  sampleConversationIds: ['id-1', 'id-2', 'id-3'],
}

describe('composeSkillContent', () => {
  it('returns a non-empty string', () => {
    const content = composeSkillContent(samplePattern)
    expect(typeof content).toBe('string')
    expect(content.length).toBeGreaterThan(50)
  })

  it('includes YAML frontmatter block', () => {
    const content = composeSkillContent(samplePattern)
    expect(content.startsWith('---')).toBe(true)
    expect(content).toContain('---\n')
  })

  it('includes auto-slug id derived from title', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('id: auto-deploy-to-production')
  })

  it('includes the pattern title as the name', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('name: Deploy to Production')
  })

  it('includes occurrences count in description', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('7')
  })

  it('includes confidence value', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('0.70')
  })

  it('includes When to Use section', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('## When to Use')
  })

  it('includes Procedure section', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('## Procedure')
  })

  it('includes Notes section', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('## Notes')
  })

  it('includes average tokens info', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('350')
  })

  it('includes sample conversation ids', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('id-1')
  })

  it('handles titles with special characters gracefully', () => {
    const p: DetectedPattern = {
      ...samplePattern,
      title: 'Fix: Bug #123 (urgent!)',
    }
    const content = composeSkillContent(p)
    expect(content).toContain('id: auto-fix-bug-123-urgent')
    expect(content).toContain('name: Fix: Bug #123 (urgent!)')
  })

  it('handles short titles without crashing', () => {
    const p: DetectedPattern = { ...samplePattern, title: 'CI' }
    const content = composeSkillContent(p)
    expect(content).toContain('id: auto-ci')
  })

  it('marks content as auto_generated', () => {
    const content = composeSkillContent(samplePattern)
    expect(content).toContain('auto_generated: true')
  })
})
