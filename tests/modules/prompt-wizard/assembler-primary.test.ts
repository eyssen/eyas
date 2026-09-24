// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, vi } from 'vitest'
import { createPromptAssembler, type AssemblerDeps } from '../../../src/modules/prompt-wizard/assembler.js'
import { flattenAssembled } from '../../../src/modules/prompt-wizard/assemble-system.js'
import { unresolvedDeliveryProfile } from '../../../src/modules/prompt-wizard/delivery-profile.js'
import { DEFAULT_BUDGET_FULL } from '../../../src/modules/prompt-wizard/token-budget.js'
import type { MemoryRecallInput, RecallResult } from '../../../src/modules/memory/v2/assemble.js'

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
      resolveRuntime: () => ({ channel: 'owner_dm', os: 'darwin' }),
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
      resolveRuntime: () => ({ channel: 'owner_dm', os: 'darwin' }),
      resolveMasterSections: async () => ({ identity: '<core-identity>test</core-identity>', coreRules: '<core-rules>test</core-rules>', personality: '<personality>test</personality>' }),
    })

    const assembled = await assembler.buildForPrimary({
      agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null,
    })
    const prefixSections = assembled.sections.filter((s) => s.zone === 'prefix')
    const suffixSections = assembled.sections.filter((s) => s.zone === 'suffix')
    expect(prefixSections.map((s) => s.content).join('').trimEnd() + '\n').toBe(assembled.prefix)
    expect(suffixSections.map((s) => s.content).join('').trimEnd() + '\n').toBe(assembled.suffix)
    const turnSections = assembled.sections.filter((s) => s.zone === 'turn')
    // order: all prefix sections, then all suffix sections, then the turn block's parts
    expect(assembled.sections.map((s) => s.zone)).toEqual([
      ...prefixSections.map(() => 'prefix'), ...suffixSections.map(() => 'suffix'), ...turnSections.map(() => 'turn'),
    ])
    // Every turn section's text is inside the turn block.
    for (const t of turnSections) expect(assembled.turn).toContain(t.content)
  })

  // I3 — the tool inventory is scoped per run (Solo is a per-conversation
  // setting), so the assembler hands the resolver the conversation too.
  it('asks the tool resolver for the agent in this conversation', async () => {
    const fakeWs = {
      agentId: 'a1', rootPath: '/tmp/a1',
      identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '## My mission\nx', byteSize: 0, truncated: false },
      soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
      agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
      dailyMemory: [],
    }
    const toolCalls: Array<[string, string | null | undefined]> = []
    const assembler = createPromptAssembler({
      workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async (agentId, conversationId) => {
        toolCalls.push([agentId, conversationId])
        return [{ name: 'memory_search', oneLine: 'Search EYAS memory' }]
      },
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ channel: 'owner_dm', os: 'darwin' }),
      resolveMasterSections: async () => ({ identity: '<core-identity>test</core-identity>', coreRules: '<core-rules>test</core-rules>', personality: '<personality>test</personality>' }),
    })

    await assembler.buildForPrimary({ agentId: 'a1', agentName: 'a1', conversationId: 'conv-7', projectId: null, channelContext: null })
    await assembler.buildForPrimary({ agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null })

    expect(toolCalls).toEqual([['a1', 'conv-7'], ['a1', null]])
  })
})

// I4 — the per-message turn block: the clock and the recalled memory leave the
// system prompt and travel with the current user message.
describe('assembler turn block (I4)', () => {
  const file = (name: string, body: string) => ({ name, path: '', exists: true, frontmatter: null, body, byteSize: 0, truncated: false })
  const RECALL: RecallResult = {
    content: '<eyas-memory>\nEYAS recalled these notes.\n- [user] (vt:semantic/owner.md) Prefers short answers\n</eyas-memory>',
    ids: ['vt:semantic/owner.md', 'gs:g1'],
    standing: ['vt:semantic/owner.md'],
    retrieved: ['gs:g1'],
    expanded: ['gs:g1'],
    dropped: 0,
    chars: 90,
    tokens: 23,
    budgetChars: 2_400,
  }

  function assemblerWith(over: Partial<AssemblerDeps> = {}) {
    const ws = {
      agentId: 'a1', rootPath: '/tmp/a1',
      identity: file('IDENTITY.md', '## My mission\nx'),
      soulMd: file('SOUL.md', ''),
      soulStyleJson: file('SOUL.style.json', '{}'),
      agentsMd: file('AGENTS.md', ''),
      toolsMd: file('TOOLS.md', ''),
      memoryMd: file('MEMORY.md', ''),
      dailyMemory: [],
    }
    return createPromptAssembler({
      workspaceLoader: { load: async () => ws as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ channel: 'owner_dm', os: 'darwin' }),
      resolveClock: () => ({ date: '2031-02-03', time: '04:05 (UTC, UTC+00:00)' }),
      resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
      ...over,
    })
  }

  const build = (a: ReturnType<typeof assemblerWith>, over: Record<string, unknown> = {}) =>
    a.buildForPrimary({ agentId: 'a1', agentName: 'a1', conversationId: 'c1', projectId: null, channelContext: null, ...over })

  it('(+) builds a turn block with the clock and the recall; the system prompt carries neither', async () => {
    const resolveRecall = vi.fn(async () => RECALL)
    const a = await build(assemblerWith({ resolveRecall }), { turnText: 'what did we decide?' })
    expect(a.turn).toMatch(/^<turn-context>\n/)
    expect(a.turn).toMatch(/\n<\/turn-context>$/)
    expect(a.turn).toContain('Current date and time: 2031-02-03 04:05 (UTC, UTC+00:00)')
    expect(a.turn).toContain(RECALL.content)
    const system = flattenAssembled(a)
    expect(system).not.toContain('2031-02-03')
    expect(system).not.toMatch(/Current date|Current time/)
    expect(system).not.toContain('<eyas-memory>')
    expect(system).not.toContain('Prefers short answers')
  })

  it('(+) asks recall with the turn text, the model profile, the scaled budget and a turn id', async () => {
    const resolveRecall = vi.fn(async () => RECALL)
    const profile = { ...unresolvedDeliveryProfile(), providerId: 'p', modelId: 'm', resolved: true, windowSource: 'catalog' as const, contextWindow: 100_000 }
    const a = await build(assemblerWith({ resolveRecall, resolveDeliveryProfile: () => profile }), { turnText: 'hello', turnId: 'turn-9' })
    expect(resolveRecall).toHaveBeenCalledWith({
      conversationId: 'c1',
      turnText: 'hello',
      budgetChars: DEFAULT_BUDGET_FULL.memoryRecall * 4,
      profile,
      turnId: 'turn-9',
      audience: 'owner',
    })
    expect(a.delivery?.recall).toEqual({
      ids: RECALL.ids, retrieved: RECALL.retrieved, expanded: RECALL.expanded,
      chars: RECALL.chars, budgetChars: DEFAULT_BUDGET_FULL.memoryRecall * 4, turnId: 'turn-9',
    })
  })

  it('(+) records the turn parts as zone "turn" sections: turn-time and memory-recall', async () => {
    const a = await build(assemblerWith({ resolveRecall: async () => RECALL }))
    const turn = a.sections.filter((s) => s.zone === 'turn')
    expect(turn.map((s) => s.key)).toEqual(['turn-time', 'memory-recall'])
    const recall = turn.find((s) => s.key === 'memory-recall')!
    expect(recall.content).toBe(RECALL.content)
    expect(recall.sourceRef).toBe('vt:semantic/owner.md,gs:g1')
    expect(recall.budgetTokens).toBe(DEFAULT_BUDGET_FULL.memoryRecall)
    expect(a.tokenEstimate.turn).toBeGreaterThan(0)
  })

  it('(−) an external audience gets no recall, and the delivery record says why', async () => {
    const resolveRecall = vi.fn(async () => RECALL)
    const a = await build(assemblerWith({ resolveRecall }), { audience: 'external' })
    expect(resolveRecall).not.toHaveBeenCalled()
    expect(a.turn).toContain('Current date and time:')
    expect(a.turn).not.toContain('<eyas-memory>')
    expect(a.delivery?.recall).toMatchObject({ ids: [], withheld: 'external' })
    expect(a.sections.some((s) => s.key === 'memory-recall')).toBe(false)
  })

  it('(−) a throwing recall leaves the time alone and never throws', async () => {
    const a = await build(assemblerWith({ resolveRecall: async () => { throw new Error('index gone') } }))
    expect(a.turn).toContain('Current date and time: 2031-02-03')
    expect(a.turn).not.toContain('<eyas-memory>')
    expect(a.delivery?.recall?.withheld).toBe('failed')
  })

  it('(−) no conversation or no recall service → time only, recorded as unavailable', async () => {
    const resolveRecall = vi.fn(async () => RECALL)
    const noConv = await build(assemblerWith({ resolveRecall }), { conversationId: null })
    expect(resolveRecall).not.toHaveBeenCalled()
    expect(noConv.delivery?.recall?.withheld).toBe('unavailable')
    const noService = await build(assemblerWith())
    expect(noService.delivery?.recall?.withheld).toBe('unavailable')
    expect(noService.turn).toContain('Current date and time:')
  })

  it('(−) a window that leaves recall no room is recorded as no-budget', async () => {
    const resolveRecall = vi.fn(async () => RECALL)
    const a = await build(assemblerWith({ resolveRecall }), { budgetOverride: { memoryRecall: 0 } })
    expect(resolveRecall).not.toHaveBeenCalled()
    expect(a.delivery?.recall).toMatchObject({ budgetChars: 0, withheld: 'no-budget' })
  })

  it('(+) generates a turn id when none is given', async () => {
    const resolveRecall = vi.fn(async (_input: MemoryRecallInput) => RECALL)
    const a = await build(assemblerWith({ resolveRecall }))
    const turnId = a.delivery?.recall?.turnId
    expect(turnId).toMatch(/^[0-9A-Z]{26}$/)
    expect(resolveRecall.mock.calls[0][0]).toMatchObject({ turnId })
  })
})

describe('assembler.buildTurnOnly (I5)', () => {
  const file = (name: string, body: string) => ({ name, path: '', exists: true, frontmatter: null, body, byteSize: 0, truncated: false })
  const RECALL: RecallResult = {
    content: '<eyas-memory>\n- (gs:g1) Ledger closes on Fridays\n</eyas-memory>',
    ids: ['gs:g1'], standing: [], retrieved: ['gs:g1'], expanded: [], dropped: 0, chars: 50, tokens: 12, budgetChars: 2_400,
  }

  function assemblerWith(over: Partial<AssemblerDeps> = {}) {
    const load = vi.fn(async () => ({ agentId: 'a1', rootPath: '/tmp', identity: file('IDENTITY.md', 'x'), soulMd: file('SOUL.md', ''), soulStyleJson: file('SOUL.style.json', '{}'), agentsMd: file('AGENTS.md', ''), toolsMd: file('TOOLS.md', ''), memoryMd: file('MEMORY.md', ''), dailyMemory: [] }) as never)
    const assembler = createPromptAssembler({
      workspaceLoader: { load, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => { throw new Error('not needed for a turn') },
      resolveRuntime: () => ({ channel: 'owner_dm', os: 'darwin' }),
      resolveClock: () => ({ date: '2031-02-03', time: '04:05' }),
      resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
      ...over,
    })
    return { assembler, load }
  }

  it('(+) builds the clock and the recall without an agent or its workspace', async () => {
    const resolveRecall = vi.fn(async (_input: MemoryRecallInput) => RECALL)
    const { assembler, load } = assemblerWith({ resolveRecall })
    const t = await assembler.buildTurnOnly({ conversationId: 'c1', turnText: 'when does the ledger close?' })
    expect(t.turn).toMatch(/^<turn-context>\n/)
    expect(t.turn).toContain('Current date and time: 2031-02-03 04:05')
    expect(t.turn).toContain(RECALL.content)
    expect(t.sections.map((s) => s.key)).toEqual(['turn-time', 'memory-recall'])
    expect(t.delivery.recall?.ids).toEqual(['gs:g1'])
    expect(resolveRecall.mock.calls[0][0]).toMatchObject({ conversationId: 'c1', turnText: 'when does the ledger close?', audience: 'owner' })
    expect(load).not.toHaveBeenCalled()
  })

  it('(−) an external audience: the clock only, recorded as withheld', async () => {
    const resolveRecall = vi.fn(async () => RECALL)
    const { assembler } = assemblerWith({ resolveRecall })
    const t = await assembler.buildTurnOnly({ conversationId: 'c1', audience: 'external' })
    expect(resolveRecall).not.toHaveBeenCalled()
    expect(t.turn).not.toContain('<eyas-memory>')
    expect(t.delivery.recall?.withheld).toBe('external')
  })
})
