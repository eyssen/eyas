// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { createPromptAssembler } from '../../../src/modules/prompt-wizard/assembler.js'

describe('assembler.buildForPrimary', () => {
  it('produces an AssembledPrompt with stable prefixHash', async () => {
    const fakeWs = {
      agentId: 'jarvis', rootPath: '/tmp/jarvis',
      identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '## My mission\nx', byteSize: 0, truncated: false },
      soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '## [Internal Voice]\n## [External Voice]', byteSize: 0, truncated: false },
      soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
      agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      dailyMemory: [],
    }
    const assembler = createPromptAssembler({
      workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ date: '2026-04-26', time: '14:00 CET', channel: 'owner_dm', os: 'darwin' }),
      resolveContextWindow: async () => 200_000,
      resolveMasterSections: async () => ({ identity: '<core-identity>test</core-identity>', coreRules: '<core-rules>test</core-rules>', personality: '<personality>test</personality>' }),
    })
    const a = await assembler.buildForPrimary({ agentId: 'jarvis', agentName: 'Jarvis', conversationId: null, projectId: null, channelContext: null })
    expect(a.prefix).toContain('<core-identity>')
    expect(a.prefix).toContain('<agent-voice>')
    expect(a.suffix).toContain('<active-voice>')
    expect(a.prefixHash).toMatch(/^[a-f0-9]{64}$/)
    expect(a.tokenEstimate.prefix).toBeGreaterThan(0)
  })

  it('carries a manifest that rebuilds prefix and suffix', async () => {
    const fakeWs = {
      agentId: 'jarvis', rootPath: '/tmp/jarvis',
      identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '## My mission\nx', byteSize: 0, truncated: false },
      soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '## [Internal Voice]\n## [External Voice]', byteSize: 0, truncated: false },
      soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
      agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      dailyMemory: [],
    }
    const assembler = createPromptAssembler({
      workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ date: '2026-04-26', time: '14:00 CET', channel: 'owner_dm', os: 'darwin' }),
      resolveContextWindow: async () => 200_000,
      resolveMasterSections: async () => ({ identity: '<core-identity>test</core-identity>', coreRules: '<core-rules>test</core-rules>', personality: '<personality>test</personality>' }),
    })

    const assembled = await assembler.buildForPrimary({
      agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null,
    })
    const prefixSections = assembled.sections.filter((s) => s.zone === 'prefix')
    const suffixSections = assembled.sections.filter((s) => s.zone === 'suffix')
    expect(prefixSections.map((s) => s.content).join('').trimEnd() + '\n').toBe(assembled.prefix)
    expect(suffixSections.map((s) => s.content).join('').trimEnd() + '\n').toBe(assembled.suffix)
    // order: all prefix sections, then all suffix sections
    expect(assembled.sections.map((s) => s.zone)).toEqual([
      ...prefixSections.map(() => 'prefix'), ...suffixSections.map(() => 'suffix'),
    ])
  })
})
