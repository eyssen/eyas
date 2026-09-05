// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler.js'
import type { ConversationTagLine } from '@modules/prompt-wizard/cache-suffix-builder.js'

const voice = {
  scope: 'internal' as const,
  reason: 'owner DM',
  profile: {
    address: 'tegező' as const,
    tone: 'baráti' as const,
    verbosity: 'lényegre törő' as const,
    directness: 'direkt + udvarias' as const,
    humor: 'nincs' as const,
    emoji: 'soha' as const,
    blockedPhrases: [] as string[],
    signature: '',
  },
}

const fakeWs = {
  agentId: 'jarvis',
  rootPath: '/tmp/jarvis',
  identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '## My mission\nx', byteSize: 0, truncated: false },
  soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '## [Internal Voice]\n## [External Voice]', byteSize: 0, truncated: false },
  soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
  agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  dailyMemory: [],
}

function assemblerWithTags(tags: ConversationTagLine[] | null) {
  return createPromptAssembler({
    workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
    projectContextLoader: {
      cascade: async () => ({
        projectAgents: 'Project brief for alpha.',
        projectTypeAgents: 'Type brief. Never copy the closed edition.',
        projectId: 'alpha',
        projectTypeId: 'type-a',
      }),
    },
    resolveSkillsFor: async () => [],
    resolveToolsFor: async () => [],
    resolveTeamContext: async () => null,
    resolveMemoryContext: async () => null,
    resolveConversationTags: async () => tags,
    resolveActiveVoice: async () => voice,
    resolveRuntime: () => ({ date: '2026-08-30', time: '10:00 CET', channel: 'owner_dm', os: 'darwin' }),
    resolveContextWindow: async () => 200_000,
    resolveMasterSections: async () => ({
      identity: '<core-identity>test</core-identity>',
      coreRules: '<core-rules>test</core-rules>',
      personality: '<personality>test</personality>',
    }),
  })
}

describe('conversation tags stay out of the cache prefix', () => {
  it('tag swap does not change prefixHash or the project-context section; the new line is in the suffix', async () => {
    const first = await assemblerWithTags([
      { categoryName: 'area', name: 'alpha' },
    ]).buildForPrimary({
      agentId: 'jarvis', agentName: 'Jarvis', conversationId: 'conv-1', projectId: 'alpha', channelContext: null,
    })
    const second = await assemblerWithTags([
      { categoryName: 'area', name: 'bravo' },
      { categoryName: 'module', name: 'delta' },
    ]).buildForPrimary({
      agentId: 'jarvis', agentName: 'Jarvis', conversationId: 'conv-1', projectId: 'alpha', channelContext: null,
    })

    const firstCtx = first.sections.find((s) => s.key === 'project-context')
    const secondCtx = second.sections.find((s) => s.key === 'project-context')
    expect(firstCtx).toBeTruthy()
    expect(secondCtx).toBeTruthy()
    expect(secondCtx!.content).toBe(firstCtx!.content)
    expect(second.prefixHash).toBe(first.prefixHash)
    expect(second.prefix).toBe(first.prefix)

    expect(first.prefix).not.toContain('tags:')
    expect(second.prefix).not.toContain('area:bravo')
    expect(first.suffix).toContain('tags: area:alpha')
    expect(first.suffix).not.toContain('area:bravo')
    expect(second.suffix).toContain('tags: area:bravo, module:delta')
    expect(second.suffix).not.toContain('area:alpha')
    expect(second.sections.find((s) => s.key === 'conversation-tags')?.zone).toBe('suffix')
  })

  it('omits the tags line when the conversation has none', async () => {
    const assembled = await assemblerWithTags(null).buildForPrimary({
      agentId: 'jarvis', agentName: 'Jarvis', conversationId: 'conv-1', projectId: 'alpha', channelContext: null,
    })
    expect(assembled.suffix).not.toContain('tags:')
    expect(assembled.sections.find((s) => s.key === 'conversation-tags')).toBeUndefined()
  })
})
