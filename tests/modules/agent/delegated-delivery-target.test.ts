// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I7 — delegated runs (executeAgent) and channel runs size and address the
// prompt for the model they actually call, not for the install default. On
// an install whose default is Grok CLI, an agent pinned to an API model must
// not be told to reach EYAS tools through Grok's use_tool meta-tool.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolAddressing } from '@modules/model/types'

const runCalls: any[] = []
vi.mock('@modules/agent/agent-runner', () => ({
  createAgentRunner: () => ({
    run: (options: any) => {
      runCalls.push(options)
      return (async function* () { yield { type: 'text', text: 'ok' } })()
    },
  }),
}))

import { agentModule } from '@modules/agent/index'
import { createChannelRunAgent } from '@modules/communication/channel-run-agent'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'
import { resolveDeliveryProfile } from '@modules/prompt-wizard/delivery-profile'
import { createMemoryDb } from '../../helpers/test-db'

const ADDRESSING: Record<string, ToolAddressing> = {
  'grok-cli': { kind: 'meta-tool', via: 'use_tool', qualify: 'eyas__' },
  'claude-code': { kind: 'mcp-prefix', prefix: 'mcp__eyas__' },
}
/** The catalog: which provider lists which model. */
const OWNERS: Record<string, string> = { 'gpt-x': 'openai', 'grok-cli-default': 'grok-cli' }

function file(name: string, body: string) {
  return { name, path: '', exists: true, frontmatter: null, body, byteSize: 0, truncated: false }
}

/** The real assembler and delivery profile on a Grok-CLI-default install. */
function grokDefaultAssembler() {
  const ws = {
    agentId: 'a1', rootPath: '/tmp/a1',
    identity: file('IDENTITY.md', '## My mission\nx'),
    soulMd: file('SOUL.md', '## [Internal Voice]\n## [External Voice]'),
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
    resolveToolsFor: async () => [{ name: 'memory_search', oneLine: 'Search EYAS memory' }],
    resolveTeamContext: async () => null,
    resolveMemoryContext: async () => null,
    resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
    resolveRuntime: () => ({ date: '2026-01-01', time: '10:00', channel: 'unknown', os: 'linux' }),
    resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
    resolveDeliveryProfile: (target) => resolveDeliveryProfile({
      getProvider: (id) => ({ toolAddressing: ADDRESSING[id] }),
      resolveDefault: () => ({ providerId: 'grok-cli', modelId: 'grok-cli-default' }),
      lookupModelOwner: (id) => OWNERS[id] ?? null,
    }, target),
  })
}

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

async function bootAgentModule() {
  const ctx: any = {
    db: createMemoryDb(),
    bus: { emit: () => {}, on: () => {}, off: () => {} },
    logger: silentLogger,
    model: {},
    permissions: { registerSubject: () => {} },
    hasModule: () => false,
    http: { get: () => {}, post: () => {}, use: () => {} },
  }
  await agentModule.onRegister!(ctx)
  ctx.promptAssembler = grokDefaultAssembler()
  return ctx
}

function createAgent(ctx: any, id: string, model?: string) {
  ctx.agents.registry.create({
    id, name: id, role: 'tester', description: 'd', goal: 'g', backstory: 'b',
    systemPrompt: 'sp', capabilities: [], tools: [], constraints: [], ...(model ? { model } : {}),
  })
}

const META_TOOL_NOTE = /use_tool|eyas__memory_search/

describe('executeAgent — delivery target (I7)', () => {
  beforeEach(() => { runCalls.length = 0 })

  it('(−) an agent pinned to an API model gets no Grok meta-tool note on a Grok-default install', async () => {
    const ctx = await bootAgentModule()
    createAgent(ctx, 'api-agent', 'gpt-x')
    await ctx.agents.executeAgent('conv-api', 'api-agent', 'do it')
    const run = runCalls[0]
    expect(run.model).toBe('gpt-x')
    expect(run.system).toContain('memory_search')
    expect(run.system).not.toMatch(META_TOOL_NOTE)
    expect(run.delivery).toMatchObject({ providerId: 'openai', modelId: 'gpt-x' })
  })

  it('(−) a model nobody owns stays unresolved (native names), never the default\'s profile', async () => {
    const ctx = await bootAgentModule()
    createAgent(ctx, 'mystery-agent', 'mystery-model')
    await ctx.agents.executeAgent('conv-m', 'mystery-agent', 'do it')
    expect(runCalls[0].system).not.toMatch(META_TOOL_NOTE)
    expect(runCalls[0].delivery).toMatchObject({ providerId: null, resolved: false, toolAddressing: { kind: 'native' } })
  })

  it('(+) an agent with no model runs on the default, so it is addressed like the default', async () => {
    const ctx = await bootAgentModule()
    createAgent(ctx, 'default-agent')
    await ctx.agents.executeAgent('conv-d', 'default-agent', 'do it')
    expect(runCalls[0].system).toMatch(META_TOOL_NOTE)
    expect(runCalls[0].delivery).toMatchObject({ providerId: 'grok-cli' })
  })

  it('(+) the child conversation\'s pinned provider/model is the target when the agent pins none', async () => {
    const ctx = await bootAgentModule()
    createAgent(ctx, 'inherit-agent')
    ctx.conversations = {
      get: () => ({ providerId: 'claude-code', modelId: 'claude-code-sonnet', teamSessionId: null }),
      addMessage: () => {},
    }
    await ctx.agents.executeAgent('conv-c', 'inherit-agent', 'do it')
    expect(runCalls[0].system).toContain('mcp__eyas__memory_search')
    expect(runCalls[0].system).not.toContain('use_tool')
  })
})

describe('channel run — delivery target (I7)', () => {
  function channelDeps(model: string | undefined) {
    const captured: any = {}
    return {
      captured,
      run: createChannelRunAgent({
        agentRegistry: { get: () => ({ id: 'a1', enabled: true, systemPrompt: 'You are support.', constraints: [], maxTurns: 5, model }), addTokenUsage: vi.fn() },
        conversations: { get: () => ({ id: 'c1', projectId: null, messages: [{ role: 'user', content: 'hi' }] }), addMessage: vi.fn() },
        toolRegistry: { toToolDefinitions: () => [] },
        logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
        agentRunner: {
          run: async function* (input: any) {
            captured.input = input
            yield { type: 'text', text: 'ok' }
          },
        },
        promptAssembler: grokDefaultAssembler(),
      } as any),
    }
  }

  it('(−) an API-model agent on a Grok-default install gets no meta-tool note', async () => {
    const { captured, run } = channelDeps('gpt-x')
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toContain('memory_search')
    expect(captured.input.system).not.toMatch(META_TOOL_NOTE)
    expect(captured.input.delivery).toMatchObject({ providerId: 'openai', modelId: 'gpt-x' })
  })

  it('(+) an agent with no model is addressed like the default it runs on', async () => {
    const { captured, run } = channelDeps(undefined)
    await run({ conversationId: 'c1', agentId: 'a1', mode: 'managed' })
    expect(captured.input.system).toMatch(META_TOOL_NOTE)
    expect(captured.input.delivery).toMatchObject({ providerId: 'grok-cli' })
  })
})
