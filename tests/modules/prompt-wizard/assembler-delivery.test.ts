// Part of eYssen. See LICENSE file for full copyright and licensing details.
// I7 — the assembler sizes the prompt for the model that answers and names
// EYAS tools the way that model's host lists them.
import { describe, expect, it, vi } from 'vitest'
import { createPromptAssembler, type AssemblerDeps } from '../../../src/modules/prompt-wizard/assembler.js'
import { unresolvedDeliveryProfile, type DeliveryProfile } from '../../../src/modules/prompt-wizard/delivery-profile.js'
import { DEFAULT_BUDGET_FULL, budgetForWindow, totalBudget } from '../../../src/modules/prompt-wizard/token-budget.js'
import { CORE_IDENTITY, IDENTITY_TOOL_PARAGRAPHS } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '../../../src/modules/prompt-wizard/master-prompt.js'

const NOTES = 'n'.repeat(DEFAULT_BUDGET_FULL.agentsMd * 4 + 400) // just over the baseline cap

function file(name: string, body: string) {
  return { name, path: '', exists: true, frontmatter: null, body, byteSize: 0, truncated: false }
}

function assemblerWith(over: Partial<AssemblerDeps> = {}) {
  const ws = {
    agentId: 'a1', rootPath: '/tmp/a1',
    identity: file('IDENTITY.md', '## My mission\nx'),
    soulMd: file('SOUL.md', '## [Internal Voice]\n## [External Voice]'),
    soulStyleJson: file('SOUL.style.json', '{}'),
    agentsMd: file('AGENTS.md', NOTES),
    toolsMd: file('TOOLS.md', ''),
    memoryMd: file('MEMORY.md', ''),
    dailyMemory: [],
  }
  return createPromptAssembler({
    workspaceLoader: { load: async () => ws as never, invalidate: () => {}, invalidateAll: () => {} },
    projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
    resolveSkillsFor: async () => [],
    resolveToolsFor: async () => [{ name: 'memory_search', oneLine: 'Search EYAS memory' }],
    resolveTeamContext: async () => null,
    resolveMemoryContext: async () => null,
    resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
    resolveRuntime: () => ({ date: '2026-01-01', time: '10:00', channel: 'owner_dm', os: 'linux' }),
    resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
    ...over,
  })
}

function profile(over: Partial<DeliveryProfile>): DeliveryProfile {
  return { ...unresolvedDeliveryProfile(), resolved: true, windowSource: 'catalog', providerId: 'p', modelId: 'm', ...over }
}

const build = (a: ReturnType<typeof assemblerWith>, target?: { providerId?: string; modelId?: string }) =>
  a.buildForPrimary({ agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null, target })

describe('assembler delivery (I7)', () => {
  it('(+) passes the target to the profile resolver and records the profile and budget', async () => {
    const resolveDeliveryProfile = vi.fn(() => profile({ contextWindow: 500_000 }))
    const a = await build(assemblerWith({ resolveDeliveryProfile }), { providerId: 'p', modelId: 'm' })
    expect(resolveDeliveryProfile).toHaveBeenCalledWith({ providerId: 'p', modelId: 'm' })
    expect(a.delivery?.profile.contextWindow).toBe(500_000)
    expect(a.delivery?.budgetTotalTokens).toBe(totalBudget(budgetForWindow(500_000)))
  })

  it('(+) a large-window model keeps notes a 100k model has clipped', async () => {
    const big = await build(assemblerWith({ resolveDeliveryProfile: () => profile({ contextWindow: 500_000 }) }))
    const base = await build(assemblerWith({ resolveDeliveryProfile: () => profile({ contextWindow: 100_000 }) }))
    expect(big.sections.find((s) => s.key === 'agent-notes')?.truncated).toBe(false)
    expect(base.sections.find((s) => s.key === 'agent-notes')?.truncated).toBe(true)
  })

  it('(+) a small-window model gets a smaller prompt', async () => {
    const small = await build(assemblerWith({ resolveDeliveryProfile: () => profile({ contextWindow: 8_192 }) }))
    const base = await build(assemblerWith({ resolveDeliveryProfile: () => profile({ contextWindow: 100_000 }) }))
    expect(small.tokenEstimate.prefix).toBeLessThan(base.tokenEstimate.prefix)
    expect(small.delivery!.budgetTotalTokens).toBeLessThanOrEqual(0.35 * 8_192)
  })

  it('(+) memory.index.budgetChars sets the recall baseline in the declared budget', async () => {
    const a = await build(assemblerWith({
      resolveDeliveryProfile: () => profile({ contextWindow: 100_000 }),
      resolveMemoryRecallChars: () => 8_000,
    }))
    expect(a.delivery!.budgetTotalTokens).toBe(totalBudget(DEFAULT_BUDGET_FULL) - DEFAULT_BUDGET_FULL.memoryRecall + 2_000)
  })

  it('(+) a CLI host gets the addressing note; (−) a native one does not', async () => {
    const claude = await build(assemblerWith({
      resolveDeliveryProfile: () => profile({ toolAddressing: { kind: 'mcp-prefix', prefix: 'mcp__eyas__' } }),
    }))
    expect(claude.prefix).toContain('mcp__eyas__memory_search')
    const native = await build(assemblerWith({ resolveDeliveryProfile: () => profile({}) }))
    expect(native.prefix).toContain('memory_search')
    expect(native.prefix).not.toContain('mcp__eyas__')
    expect(native.prefix).not.toContain('use_tool')
  })

  it('(H9) a CLI host is not told about the tools it has natively; the EYAS browser stays listed', async () => {
    const tools = async () => [
      { name: 'memory_search', oneLine: 'Search EYAS memory' },
      { name: 'read_file', oneLine: 'Read a file' },
      { name: 'run_command', oneLine: 'Run a command' },
      { name: 'browser_navigate', oneLine: 'Open a page' },
    ]
    const claude = await build(assemblerWith({
      resolveToolsFor: tools,
      resolveDeliveryProfile: () => profile({ toolAddressing: { kind: 'mcp-prefix', prefix: 'mcp__eyas__' } }),
    }))
    expect(claude.prefix).toContain('- browser_navigate: Open a page')
    expect(claude.prefix).toContain('- memory_search: Search EYAS memory')
    expect(claude.prefix).not.toContain('- read_file:')
    expect(claude.prefix).not.toContain('- run_command:')
    // (−) A native host keeps every tool it is offered.
    const native = await build(assemblerWith({ resolveToolsFor: tools, resolveDeliveryProfile: () => profile({}) }))
    expect(native.prefix).toContain('- read_file: Read a file')
    expect(native.prefix).toContain('- run_command: Run a command')
  })

  it('(K3) a CLI host whose offered tools withhold the shell is told about git_status (bridged); with run_command it is not', async () => {
    const cli = () => profile({ toolAddressing: { kind: 'mcp-prefix', prefix: 'mcp__eyas__' } })
    const narrow = await build(assemblerWith({
      resolveToolsFor: async () => [
        { name: 'memory_search', oneLine: 'Search EYAS memory' },
        { name: 'git_status', oneLine: 'Show git status' },
        { name: 'read_file', oneLine: 'Read a file' },
      ],
      resolveDeliveryProfile: cli,
    }))
    expect(narrow.prefix).toContain('- git_status: Show git status')
    expect(narrow.prefix).not.toContain('- read_file:')
    const wide = await build(assemblerWith({
      resolveToolsFor: async () => [
        { name: 'memory_search', oneLine: 'Search EYAS memory' },
        { name: 'git_status', oneLine: 'Show git status' },
        { name: 'run_command', oneLine: 'Run a command' },
      ],
      resolveDeliveryProfile: cli,
    }))
    expect(wide.prefix).not.toContain('- git_status:')
    expect(wide.prefix).not.toContain('- run_command:')
  })

  it('(−) a model without tool support is not handed a tool inventory', async () => {
    const a = await build(assemblerWith({ resolveDeliveryProfile: () => profile({ supportsTools: false, drillDown: false }) }))
    expect(a.sections.some((s) => s.key === 'available-tools')).toBe(false)
    const withTools = await build(assemblerWith({ resolveDeliveryProfile: () => profile({}) }))
    expect(withTools.sections.some((s) => s.key === 'available-tools')).toBe(true)
  })

  it('(−) a throwing resolver degrades to the unresolved profile and the 100k baseline', async () => {
    const a = await build(assemblerWith({ resolveDeliveryProfile: () => { throw new Error('boom') } }), { providerId: 'p' })
    expect(a.delivery?.profile.resolved).toBe(false)
    expect(a.delivery?.budgetTotalTokens).toBe(totalBudget(DEFAULT_BUDGET_FULL))
  })

  it('(−) an unresolved window (default source) budgets at the baseline, not at the default 200k', async () => {
    const a = await build(assemblerWith({ resolveDeliveryProfile: () => ({ ...unresolvedDeliveryProfile({ providerId: 'p' }), contextWindow: 200_000 }) }))
    expect(a.delivery?.budgetTotalTokens).toBe(totalBudget(DEFAULT_BUDGET_FULL))
  })

  it('(−) no resolver wired: baseline budget, native names, no throw', async () => {
    const a = await build(assemblerWith())
    expect(a.delivery?.profile.resolved).toBe(false)
    expect(a.delivery?.budgetTotalTokens).toBe(totalBudget(DEFAULT_BUDGET_FULL))
  })
})

describe('master prompt per delivery profile (K7)', () => {
  const TOOL_CALL = /memory_search|memory_expand|search_indexed|list_search_sources|search_knowledge|propose_team|run_specialist|handoff_to_colleague|skill_load/
  const shipped = async () => ({ identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY })
  const withInventories = (over: Partial<AssemblerDeps>) => assemblerWith({
    resolveMasterSections: shipped,
    resolveSkillsFor: async () => [{ name: 'weekly-report', oneLine: 'Write the weekly report' }],
    resolveAgentsFor: async () => [{ name: 'agt_1', oneLine: 'Researcher' }],
    ...over,
  })
  const section = (a: Awaited<ReturnType<typeof build>>, key: string) => a.sections.find((s) => s.key === key)?.content ?? ''

  it('(+) a model without tool support is told nothing about calling tools, and gets no skill or agent inventory', async () => {
    const a = await build(withInventories({ resolveDeliveryProfile: () => profile({ supportsTools: false, drillDown: false }) }))
    expect(a.prefix).not.toMatch(TOOL_CALL)
    expect(section(a, 'core-identity')).toMatch(/cannot call tools, so you cannot search\s+further/)
    expect(section(a, 'core-rules')).toContain('8. MEMORY:')
    expect(section(a, 'core-rules')).toContain('<eyas-memory>')
    for (const key of ['available-tools', 'available-skills', 'available-agents']) {
      expect(a.sections.some((s) => s.key === key), key).toBe(false)
    }
    expect(section(a, 'core-identity')).not.toContain('[truncated')
    expect(section(a, 'core-rules')).not.toContain('[truncated')
  })

  it('(+) a tool-capable CLI host gets the shipped text verbatim, and the inventory names its tools provider-exact (I6)', async () => {
    const a = await build(withInventories({
      resolveDeliveryProfile: () => profile({ toolAddressing: { kind: 'mcp-prefix', prefix: 'mcp__eyas__' } }),
    }))
    expect(section(a, 'core-identity')).toContain(CORE_IDENTITY.trim())
    expect(section(a, 'core-rules')).toContain(CORE_RULES.trim())
    expect(a.prefix).toContain('mcp__eyas__memory_search')
    for (const key of ['available-tools', 'available-skills', 'available-agents']) {
      expect(a.sections.some((s) => s.key === key), key).toBe(true)
    }
  })

  it('(−) a native tool-capable model keeps the shipped wording and plain names', async () => {
    const a = await build(withInventories({ resolveDeliveryProfile: () => profile({}) }))
    expect(section(a, 'core-identity')).toContain('use memory_search, then memory_expand')
    expect(a.prefix).not.toContain('cannot call tools')
  })

  it('(−) an owner-edited paragraph reaches a tool-less model exactly as the owner wrote it', async () => {
    const [memory] = IDENTITY_TOOL_PARAGRAPHS
    const own = memory!.withTools.replace('use memory_search', 'ask me before memory_search')
    const a = await build(withInventories({
      resolveMasterSections: async () => ({ identity: CORE_IDENTITY.replace(memory!.withTools, own), coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }),
      resolveDeliveryProfile: () => profile({ supportsTools: false, drillDown: false }),
    }))
    expect(section(a, 'core-identity')).toContain(own)
    expect(section(a, 'core-identity')).toContain('This model cannot call tools')
  })
})
