// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { buildCachePrefix } from '../../../src/modules/prompt-wizard/cache-prefix-builder.js'
import { DEFAULT_BUDGET_FULL } from '../../../src/modules/prompt-wizard/token-budget.js'
import type { AgentWorkspace, WorkspaceFile } from '../../../src/modules/prompt-wizard/workspace-types.js'
import type { CascadeResult } from '../../../src/modules/prompt-wizard/project-context-loader.js'

function file(name: string, body: string): WorkspaceFile {
  return {
    name, path: `/fake/${name}`, exists: true,
    frontmatter: null, body, byteSize: body.length, truncated: false,
  }
}

function workspace(overrides: Partial<{ identity: string; soul: string; agents: string; tools: string }> = {}): AgentWorkspace {
  return {
    agentId: 'agent-1',
    rootPath: '/fake',
    identity: file('IDENTITY.md', overrides.identity ?? '# Identity'),
    soulMd: file('SOUL.md', overrides.soul ?? '# Soul'),
    soulStyleJson: file('SOUL.style.json', ''),
    agentsMd: file('AGENTS.md', overrides.agents ?? ''),
    toolsMd: file('TOOLS.md', overrides.tools ?? ''),
    memoryMd: file('MEMORY.md', ''),
    dailyMemory: [],
  }
}

const emptyCascade: CascadeResult = {
  projectTypeAgents: null, projectAgents: null,
  projectTypeId: null, projectId: null,
}

describe('buildCachePrefix', () => {
  it('minimal prefix — only core-identity, core-rules, agent-identity, agent-voice tags appear', () => {
    const result = buildCachePrefix({
      coreIdentity: 'You are EYAS.',
      coreRules: 'Be helpful.',
      personality: 'Be warm.',
      workspace: workspace(),
      cascade: emptyCascade,
      skillsList: [],
      toolsList: [],
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('<core-identity>')
    expect(result).toContain('</core-identity>')
    expect(result).toContain('<core-rules>')
    expect(result).toContain('</core-rules>')
    expect(result).toContain('<agent-identity>')
    expect(result).toContain('</agent-identity>')
    expect(result).toContain('<agent-voice>')
    expect(result).toContain('</agent-voice>')

    // These sections should NOT appear
    expect(result).not.toContain('<project-context>')
    expect(result).not.toContain('<agent-notes>')
    expect(result).not.toContain('<agent-env-notes>')
    expect(result).not.toContain('<available-skills>')
    expect(result).not.toContain('<available-tools>')
  })

  it('cascade tags appear when projectTypeAgents and/or projectAgents are set', () => {
    const cascade: CascadeResult = {
      projectTypeAgents: 'Type-level agent context.',
      projectAgents: 'Project-level agent context.',
      projectTypeId: 'type-123',
      projectId: 'proj-456',
    }

    const result = buildCachePrefix({
      coreIdentity: 'You are EYAS.',
      coreRules: 'Be helpful.',
      personality: 'Be warm.',
      workspace: workspace(),
      cascade,
      skillsList: [],
      toolsList: [],
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('<project-context>')
    expect(result).toContain('</project-context>')
    expect(result).toContain('<source name="project-type" id="type-123">')
    expect(result).toContain('</source>')
    expect(result).toContain('<source name="project" id="proj-456">')
    expect(result).toContain('Type-level agent context.')
    expect(result).toContain('Project-level agent context.')
  })

  it('agent-notes section omitted when agentsMd.body is empty', () => {
    const result = buildCachePrefix({
      coreIdentity: 'You are EYAS.',
      coreRules: 'Be helpful.',
      personality: 'Be warm.',
      workspace: workspace({ agents: '' }),
      cascade: emptyCascade,
      skillsList: [],
      toolsList: [],
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).not.toContain('<agent-notes>')
  })

  it('skills and tools sections omitted when arrays are empty', () => {
    const result = buildCachePrefix({
      coreIdentity: 'You are EYAS.',
      coreRules: 'Be helpful.',
      personality: 'Be warm.',
      workspace: workspace(),
      cascade: emptyCascade,
      skillsList: [],
      toolsList: [],
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).not.toContain('<available-skills>')
    expect(result).not.toContain('<available-tools>')
  })

  it('section budget cap — content exceeding token budget is truncated with marker', () => {
    // DEFAULT_BUDGET_FULL.coreIdentity = 200 tokens = 800 chars
    // We create a string of 5000 chars which exceeds the budget
    const longIdentity = 'A'.repeat(5000)

    const result = buildCachePrefix({
      coreIdentity: longIdentity,
      coreRules: 'Be helpful.',
      personality: 'Be warm.',
      workspace: workspace(),
      cascade: emptyCascade,
      skillsList: [],
      toolsList: [],
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('[truncated — section budget]')
    // The core-identity section should be present but truncated
    const coreIdentityMatch = result.match(/<core-identity>([\s\S]*?)<\/core-identity>/)
    expect(coreIdentityMatch).not.toBeNull()
    const sectionContent = coreIdentityMatch![1]
    // 200 tokens * 4 chars/token = 800 chars for actual content, plus truncation marker
    expect(sectionContent.length).toBeLessThan(5000)
    expect(sectionContent).toContain('[truncated — section budget]')
  })
})
