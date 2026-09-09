import { describe, it, expect } from 'vitest'
import { createSkillMatcher } from '@modules/skills/skill-matcher'
import type { Skill } from '@modules/skills/types'

const matcher = createSkillMatcher()

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    description: 'A test skill',
    triggerPatterns: [],
    capabilities: [],
    version: '1.0.0',
    content: 'content',
    skillType: 'knowledge',
    source: 'user',
    enabled: true,
    useCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('SkillMatcher', () => {
  it('matches skills by trigger pattern substring', () => {
    const skills = [
      makeSkill({ id: 's1', name: 'Deploy', triggerPatterns: ['deploy to production', 'deploy app'] }),
      makeSkill({ id: 's2', name: 'Test', triggerPatterns: ['run tests', 'test suite'] }),
    ]

    const matches = matcher.match('please deploy to production now', skills)
    expect(matches).toHaveLength(1)
    expect(matches[0].skill.id).toBe('s1')
    expect(matches[0].matchedPattern).toBe('deploy to production')
    expect(matches[0].matchScore).toBeGreaterThan(0)
  })

  it('scores longer pattern matches higher', () => {
    const skills = [
      makeSkill({ id: 's1', triggerPatterns: ['deploy'] }),
      makeSkill({ id: 's2', triggerPatterns: ['deploy to production'] }),
    ]

    const matches = matcher.match('deploy to production', skills)
    expect(matches).toHaveLength(2)
    // The longer pattern should score higher
    expect(matches[0].skill.id).toBe('s2')
    expect(matches[0].matchScore).toBeGreaterThan(matches[1].matchScore)
  })

  it('matches case-insensitively', () => {
    const skills = [
      makeSkill({ triggerPatterns: ['Run Tests'] }),
    ]

    const matches = matcher.match('can you RUN TESTS for me?', skills)
    expect(matches).toHaveLength(1)
  })

  it('falls back to skill name matching', () => {
    const skills = [
      makeSkill({ id: 's1', name: 'Code Review', triggerPatterns: [] }),
    ]

    const matches = matcher.match('I need a code review', skills)
    expect(matches).toHaveLength(1)
    expect(matches[0].matchedPattern).toContain('name:')
    // Name matches should have lower score (multiplied by 0.5)
    expect(matches[0].matchScore).toBeLessThanOrEqual(0.5)
  })

  it('skips disabled skills', () => {
    const skills = [
      makeSkill({ id: 's1', enabled: false, triggerPatterns: ['deploy'] }),
      makeSkill({ id: 's2', enabled: true, triggerPatterns: ['deploy'] }),
    ]

    const matches = matcher.match('deploy now', skills)
    expect(matches).toHaveLength(1)
    expect(matches[0].skill.id).toBe('s2')
  })

  it('respects maxResults limit', () => {
    const skills = Array.from({ length: 10 }, (_, i) =>
      makeSkill({ id: `s${i}`, name: `Skill ${i}`, triggerPatterns: ['common trigger'] }),
    )

    const matches = matcher.match('common trigger', skills, 2)
    expect(matches).toHaveLength(2)
  })

  it('returns empty array when nothing matches', () => {
    const skills = [
      makeSkill({ triggerPatterns: ['deploy'] }),
    ]

    const matches = matcher.match('completely unrelated query', skills)
    expect(matches).toHaveLength(0)
  })

  it('filters out low-confidence matches (score <= 0.1)', () => {
    const skills = [
      makeSkill({
        name: 'A Very Long Name That Has Many Words',
        triggerPatterns: [],
      }),
    ]

    // Only one word from name matches in a long query — should be below threshold
    const matches = matcher.match('a completely different and very long sentence about something else entirely', skills)
    // "a" and "very" and "long" match but they're common words — score depends on ratio
    // The key point is that very low ratios get filtered
    for (const m of matches) {
      expect(m.matchScore).toBeGreaterThan(0.1)
    }
  })

  it('picks the best trigger pattern from multiple options', () => {
    const skills = [
      makeSkill({
        triggerPatterns: ['test', 'run full test suite'],
      }),
    ]

    const matches = matcher.match('run full test suite', skills)
    expect(matches).toHaveLength(1)
    // Should match the longer pattern with higher score
    expect(matches[0].matchedPattern).toBe('run full test suite')
  })

  it('sorts results by matchScore descending', () => {
    const skills = [
      makeSkill({ id: 's1', triggerPatterns: ['x'] }),
      makeSkill({ id: 's2', triggerPatterns: ['xyz'] }),
      makeSkill({ id: 's3', triggerPatterns: ['xy'] }),
    ]

    const matches = matcher.match('xyz', skills)
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].matchScore).toBeGreaterThanOrEqual(matches[i].matchScore)
    }
  })

  // --- New tests for extended matching ---

  describe('integration skill matching', () => {
    it('matches by operation name', () => {
      const skills = [
        makeSkill({
          id: 'github',
          name: 'GitHub',
          skillType: 'integration',
          triggerPatterns: [],
          integrationConfig: {
            auth: 'bearer',
            operations: [
              { name: 'create_issue', method: 'POST', path: '/issues', description: 'Create a new issue' },
              { name: 'list_repos', method: 'GET', path: '/repos', description: 'List repositories' },
            ],
          },
        }),
      ]

      const matches = matcher.match('create issue on GitHub', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].skill.id).toBe('github')
      expect(matches[0].matchedPattern).toContain('operation:')
      expect(matches[0].matchedPattern).toContain('create_issue')
    })

    it('matches by operation description', () => {
      const skills = [
        makeSkill({
          id: 'jira',
          name: 'Jira',
          skillType: 'integration',
          triggerPatterns: [],
          integrationConfig: {
            auth: 'api_key',
            operations: [
              { name: 'search_tickets', method: 'GET', path: '/search', description: 'Search for tickets by query' },
            ],
          },
        }),
      ]

      const matches = matcher.match('search for tickets', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].skill.id).toBe('jira')
      expect(matches[0].matchedPattern).toContain('operation')
    })
  })

  describe('tool skill matching', () => {
    it('matches by function name', () => {
      const skills = [
        makeSkill({
          id: 'pdf-tool',
          name: 'PDF Tool',
          skillType: 'tool',
          triggerPatterns: [],
          toolConfig: {
            package: 'pdf-lib',
            functions: [
              { name: 'merge_pdfs', description: 'Merge multiple PDF files', parameters: {}, returns: 'Buffer' },
              { name: 'extract_text', description: 'Extract text from PDF', parameters: {}, returns: 'string' },
            ],
          },
        }),
      ]

      const matches = matcher.match('merge pdfs please', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].skill.id).toBe('pdf-tool')
      expect(matches[0].matchedPattern).toContain('function:')
      expect(matches[0].matchedPattern).toContain('merge_pdfs')
    })

    it('matches by function description', () => {
      const skills = [
        makeSkill({
          id: 'image-tool',
          name: 'Image Tool',
          skillType: 'tool',
          triggerPatterns: [],
          toolConfig: {
            package: 'sharp',
            functions: [
              { name: 'resize', description: 'Resize an image to specified dimensions', parameters: {}, returns: 'Buffer' },
            ],
          },
        }),
      ]

      const matches = matcher.match('resize an image to 800x600', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].skill.id).toBe('image-tool')
      expect(matches[0].matchedPattern).toContain('function')
    })
  })

  describe('category matching', () => {
    it('matches by category', () => {
      const skills = [
        makeSkill({
          id: 'eslint-skill',
          name: 'ESLint Config',
          category: 'coding/linting',
          triggerPatterns: [],
        }),
        makeSkill({
          id: 'prettier-skill',
          name: 'Prettier Config',
          category: 'coding/formatting',
          triggerPatterns: [],
        }),
      ]

      const matches = matcher.match('I need help with linting', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].skill.id).toBe('eslint-skill')
      expect(matches[0].matchedPattern).toContain('category:')
    })

    it('matches parent category segment', () => {
      const skills = [
        makeSkill({
          id: 'ts-skill',
          name: 'TypeScript Helper',
          category: 'coding/languages',
          triggerPatterns: [],
        }),
      ]

      const matches = matcher.match('coding best practices', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].matchedPattern).toContain('category:')
    })
  })

  describe('description matching', () => {
    it('matches by skill description with lower weight', () => {
      const skills = [
        makeSkill({
          id: 'docker-skill',
          name: 'Infra Helper',
          description: 'Manage Docker containers and images',
          triggerPatterns: [],
        }),
      ]

      const matches = matcher.match('docker containers management', skills)
      expect(matches).toHaveLength(1)
      expect(matches[0].skill.id).toBe('docker-skill')
      // Should match via description since name words don't appear in query
      expect(matches[0].matchedPattern).toContain('description:')
    })
  })

  describe('score priority', () => {
    it('trigger pattern scores higher than operation/function name', () => {
      const skills = [
        makeSkill({
          id: 'with-trigger',
          name: 'Trigger Skill',
          triggerPatterns: ['create issue'],
        }),
        makeSkill({
          id: 'with-operation',
          name: 'Operation Skill',
          skillType: 'integration',
          triggerPatterns: [],
          integrationConfig: {
            auth: 'none',
            operations: [
              { name: 'create_issue', method: 'POST', path: '/issues', description: 'Create issue' },
            ],
          },
        }),
      ]

      const matches = matcher.match('create issue', skills)
      expect(matches.length).toBeGreaterThanOrEqual(2)
      // Trigger pattern match (1.0 weight) should outrank operation name (0.8 weight)
      expect(matches[0].skill.id).toBe('with-trigger')
      expect(matches[0].matchScore).toBeGreaterThan(matches[1].matchScore)
    })

    it('operation/function name scores higher than description', () => {
      const skills = [
        makeSkill({
          id: 'with-function',
          name: 'Function Skill',
          skillType: 'tool',
          triggerPatterns: [],
          toolConfig: {
            package: 'test',
            functions: [
              { name: 'resize_image', description: 'Resize', parameters: {}, returns: 'void' },
            ],
          },
        }),
        makeSkill({
          id: 'with-desc',
          name: 'Misc Helper',
          description: 'resize image quickly',
          triggerPatterns: [],
        }),
      ]

      const matches = matcher.match('resize image', skills)
      expect(matches.length).toBeGreaterThanOrEqual(2)
      // Function name (0.8) should outrank description (0.3)
      expect(matches[0].skill.id).toBe('with-function')
      expect(matches[0].matchScore).toBeGreaterThan(matches[1].matchScore)
    })

    it('name match scores higher than description match', () => {
      const skills = [
        makeSkill({
          id: 'name-match',
          name: 'Docker Helper',
          description: 'Something unrelated',
          triggerPatterns: [],
        }),
        makeSkill({
          id: 'desc-match',
          name: 'Container Tool',
          description: 'Helps with Docker setup and configuration',
          triggerPatterns: [],
        }),
      ]

      const matches = matcher.match('docker', skills)
      // Name match (0.5 weight) should beat description match (0.3 weight)
      const nameMatch = matches.find(m => m.skill.id === 'name-match')
      const descMatch = matches.find(m => m.skill.id === 'desc-match')
      expect(nameMatch).toBeDefined()
      if (descMatch) {
        expect(nameMatch!.matchScore).toBeGreaterThan(descMatch.matchScore)
      }
    })
  })
})
