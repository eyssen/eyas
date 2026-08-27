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
    const { content: result } = buildCachePrefix({
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

    const { content: result } = buildCachePrefix({
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
    const { content: result } = buildCachePrefix({
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
    const { content: result } = buildCachePrefix({
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

    const { content: result } = buildCachePrefix({
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

describe('buildCachePrefix manifest', () => {
  const fullCascade: CascadeResult = {
    projectTypeAgents: 'PT body', projectAgents: 'P body', projectTypeId: 'pt1', projectId: 'p1',
  }

  const baseInput = {
    coreIdentity: 'Core identity text',
    coreRules: 'Core rules text',
    personality: 'Personality text',
    workspace: workspace({ identity: 'Identity body', soul: 'Soul body', agents: 'Agent notes', tools: 'Tool notes' }),
    cascade: fullCascade,
    skillsList: [{ name: 'alpha', oneLine: 'does alpha' }],
    toolsList: [{ name: 'bash', oneLine: 'runs commands' }],
    budget: DEFAULT_BUDGET_FULL,
  }

  it('sections concatenate back to the prompt byte-for-byte', () => {
    const { content, sections } = buildCachePrefix(baseInput)
    const rebuilt = sections.map((s) => s.content).join('').trimEnd() + '\n'
    expect(rebuilt).toBe(content)
  })

  it('records every emitted section in prompt order', () => {
    const { sections } = buildCachePrefix(baseInput)
    expect(sections.map((s) => s.key)).toEqual([
      'core-identity', 'core-rules', 'default-personality', 'project-context',
      'agent-identity', 'agent-voice', 'agent-notes', 'agent-env-notes',
      'available-skills', 'available-tools',
    ])
    expect(sections.every((s) => s.zone === 'prefix')).toBe(true)
  })

  it('omits blank optional sections from the manifest', () => {
    const { sections } = buildCachePrefix({ ...baseInput, workspace: workspace({ agents: '', tools: '' }) })
    expect(sections.map((s) => s.key)).not.toContain('agent-notes')
    expect(sections.map((s) => s.key)).not.toContain('agent-env-notes')
  })

  it('flags a truncated section and reports the loss', () => {
    const { sections } = buildCachePrefix({ ...baseInput, coreRules: 'r'.repeat(4000) })
    const rules = sections.find((s) => s.key === 'core-rules')!
    expect(rules.truncated).toBe(true)
    expect(rules.droppedChars).toBe(4000 - DEFAULT_BUDGET_FULL.coreRules * 4)
  })

  it('records no blank sections — join-neutrality is enforced, not assumed', () => {
    const { sections } = buildCachePrefix(baseInput)
    expect(sections.every((s) => s.content.trim().length > 0)).toBe(true)
  })
})

describe('the tool inventory survives its budget', () => {
  // Measured on a live instance before this was fixed: 56 tools, 13 586
  // characters, a 2 000-character budget, EIGHT tools visible — and the agent
  // went hunting for `design_read` because the prompt referenced tools its own
  // list had dropped, then wrote the requested page twice.
  const manyTools = Array.from({ length: 56 }, (_, i) => ({
    name: `a_tool_name_${String(i).padStart(3, '0')}`,
    oneLine: 'A description of roughly the length these actually run to in practice, which is not short at all.',
  }))

  function build(toolsList: { name: string; oneLine: string }[]) {
    return buildCachePrefix({
      coreIdentity: 'You are EYAS.',
      coreRules: 'Be helpful.',
      personality: 'Be warm.',
      workspace: workspace(),
      cascade: emptyCascade,
      skillsList: [],
      toolsList,
      budget: DEFAULT_BUDGET_FULL,
    })
  }

  it('lists every tool by name, not the first eight with descriptions', () => {
    const { content } = build(manyTools)
    for (const tool of manyTools) expect(content).toContain(tool.name)
  })

  it('keeps the line that says where the schemas come from', () => {
    // It was being cut off mid-sentence, so the model was never told.
    expect(build(manyTools).content).toContain('provider native tool API')
  })

  it('does not truncate the section any more', () => {
    const { sections } = build(manyTools)
    const tools = sections.find((s) => s.key === 'available-tools')!
    expect(tools.truncated).toBe(false)
    expect(tools.droppedChars).toBe(0)
  })

  it('still spells out the descriptions for a small tool set', () => {
    const { content } = build([{ name: 'read_file', oneLine: 'Read a file from disk.' }])
    expect(content).toContain('- read_file: Read a file from disk.')
  })
})
