import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

// The Agent SDK is faked: query() records its options and answers with a
// clean init + result; tool()/createSdkMcpServer() keep the handler so a test
// can call a bridged tool the way the runtime would.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider'
import { claudeCodeWindowFor, claudeModelsFromDiscovery } from '@modules/model/submodules/claude-code/discovery'
import { PROVIDER_WINDOW, pickContextWindow, resolveModelContextWindow } from '@modules/model/model-window'
import { renderToolRef, toolAddressingOf } from '@modules/model/tool-addressing'
import { TEST_CLAUDE_RUNTIME } from '../../helpers/claude-runtime.js'

describe('Claude Code Provider', () => {
  it('has correct id and name', () => {
    const provider = createClaudeCodeProvider()
    expect(provider.id).toBe('claude-code')
    expect(provider.name).toBe('Claude Code CLI')
  })

  it('lists available models', async () => {
    const provider = createClaudeCodeProvider()
    const models = await provider.listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].provider).toBe('claude-code')
  })
})

describe('claude-code listModels caps + metadata', () => {
  it('returns current caps and the CLI alias, and claims no concrete model id', async () => {
    const p = createClaudeCodeProvider()
    const models = await p.listModels()
    const sonnet = models.find((m) => m.id === 'claude-code-sonnet')!
    expect(sonnet.maxOutputTokens).toBe(64_000)
    // Which concrete model an alias resolves to is the runtime's decision.
    expect((sonnet.metadata as any).realModelId).toBeUndefined()
    expect((sonnet.metadata as any).alias).toBe('sonnet')
    const opus = models.find((m) => m.id === 'claude-code-opus')!
    expect(opus.maxOutputTokens).toBe(128_000)
    const fable = models.find((m) => m.id === 'claude-code-fable')!
    expect(fable.maxOutputTokens).toBe(128_000)
    expect((fable.metadata as any).realModelId).toBeUndefined()
    expect((fable.metadata as any).alias).toBe('fable')
  })

  // CCB-3: the seed claims the window the runtime gives a bare alias — the
  // one discovery and THE window resolver give it — never 1M.
  it('seeds every alias with the window discovery and the window resolver give it, never 1M', async () => {
    const models = await createClaudeCodeProvider().listModels()
    expect(models.map((m) => m.id).sort()).toEqual(['claude-code-fable', 'claude-code-haiku', 'claude-code-opus', 'claude-code-sonnet'])
    for (const m of models) {
      expect(m.contextWindow).toBe(PROVIDER_WINDOW['claude-code'])
      expect(m.contextWindow).toBeLessThan(1_000_000)
      const alias = (m.metadata as any).alias as string
      expect(m.contextWindow).toBe(claudeCodeWindowFor(alias))
      // What discovery would store for the same alias, and what the resolver
      // falls back to for the provider, are the same number.
      const discovered = claudeModelsFromDiscovery({ runtimeVersion: '2.1.281', models: [{ value: alias }] }, '2026-09-24T00:00:00.000Z')[0]
      expect(discovered.id).toBe(m.id)
      expect(discovered.contextWindow).toBe(m.contextWindow)
      expect(pickContextWindow(null, 'claude-code')).toBe(m.contextWindow)
    }
  })

  it('the seed and the resolver agree: a seeded catalog sizes prompts and the context bar at the provider window (negative: no 1M)', async () => {
    const seed = await createClaudeCodeProvider().listModels()
    const catalog = { listModels: () => seed.map((m) => ({ modelId: m.id, contextWindow: m.contextWindow, supportsTools: m.supportsTools })) }
    for (const m of seed) {
      const resolved = resolveModelContextWindow({ providerId: 'claude-code', modelId: m.id }, { catalog })
      expect(resolved).toEqual({ contextWindow: PROVIDER_WINDOW['claude-code'], supportsTools: true, source: 'catalog' })
      expect(pickContextWindow(m.contextWindow, 'claude-code')).toBe(resolved.contextWindow)
      expect(resolved.contextWindow).not.toBe(1_000_000)
    }
  })

  it('hands out a copy: a caller mutating the list cannot change the seed (negative)', async () => {
    const p = createClaudeCodeProvider()
    const first = await p.listModels()
    first.length = 0
    expect((await p.listModels()).length).toBe(4)
  })
})

describe('claude-code model discovery', () => {
  it('"Refresh models" runs the zero-cost discovery on the resolved runtime', async () => {
    const init = { models: [{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] }] }
    const provider = createClaudeCodeProvider({
      runtime: TEST_CLAUDE_RUNTIME,
      discovery: { cwd: '/tmp', query: () => ({ initializationResult: async () => init, close: () => {} }) },
    })
    const models = await provider.fetchModels!()
    expect(models.map((m) => m.id)).toEqual(['claude-code-opus'])
    expect(models[0].metadata).toMatchObject({ alias: 'opus', realModelId: 'claude-opus-5-5' })
  })

  it('without a resolved runtime discovery refuses rather than letting the SDK pick a binary (negative)', async () => {
    await expect(createClaudeCodeProvider().fetchModels!()).rejects.toThrow(/runtime/)
  })
})

// ─── In-process EYAS bridge: turn context, tool scope, addressing ───────────

const REGISTRY = [
  { name: 'memory_search', category: 'memory', description: 'search', inputSchema: { type: 'object', properties: { query: {} } } },
  { name: 'memory_expand', category: 'memory', description: 'expand', inputSchema: { type: 'object', properties: { id: {} } } },
  { name: 'create_task', category: 'board', description: 'task', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_specialist', category: 'agent', description: 'specialist', inputSchema: { type: 'object', properties: {} } },
  { name: 'propose_team', category: 'agent', description: 'team', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_command', category: 'shell', description: 'shell', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_navigate', category: 'browser', description: 'browser', inputSchema: { type: 'object', properties: {} } },
]

const def = (name: string) => ({ name, description: name, inputSchema: { type: 'object' } })

function bridgeDeps() {
  const execute = vi.fn(async () => ({ success: true, output: { ok: true } }))
  return {
    execute,
    deps: {
      runtime: TEST_CLAUDE_RUNTIME,
      toolExecutor: { execute, renderForModel: () => ({ text: '{}', isError: false }) } as any,
      toolRegistry: { list: () => REGISTRY } as any,
      getGovernance: () => ({ securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) } }) as any,
    },
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

/** The EYAS tools the query's in-process MCP server offers, by canonical name. */
function bridgedNames(): string[] {
  return (h.captured.options?.mcpServers?.eyas?.tools ?? []).map((t: any) => t.name)
}

/** Call one bridged tool the way the runtime would, and return the ToolContext the executor got. */
async function callBridged(execute: ReturnType<typeof vi.fn>, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const bridged = (h.captured.options.mcpServers.eyas.tools as any[]).find((t) => t.name === name)
  expect(bridged).toBeTruthy()
  await bridged.handler(args)
  const call = execute.mock.calls.at(-1)!
  expect(call[0]).toBe(name)
  return call[2]
}

describe('claude-code in-process bridge — turn context', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('carries conversation, project, turn and run from the request metadata', async () => {
    const { execute, deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'conv-1', userId: 'u-1', agentId: 'a-1', teamSessionId: 'ts-1', projectId: 'proj-1', turnId: 'turn-1', runId: 'run-1' },
    }))
    const ctx = await callBridged(execute, 'memory_search', { query: 'x' })
    expect(ctx).toMatchObject({
      conversationId: 'conv-1',
      userId: 'u-1',
      agentId: 'a-1',
      teamSessionId: 'ts-1',
      projectId: 'proj-1',
      turnId: 'turn-1',
      runId: 'run-1',
      actor: { kind: 'agent', role: 'agent' },
      securityPipelineHandled: true,
    })
    // The bridged tools work in the folders the CLI itself runs in.
    expect(ctx.workingDirectory).toBe(h.captured.options.cwd)
    expect(ctx.workingDirectories).toContain(h.captured.options.cwd)
  })

  it("carries the turn's model binding into bridged calls, and none without one (H4)", async () => {
    const pair = { providerId: 'claude-code', modelId: 'claude-code-sonnet' }
    const { execute, deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-b', modelBinding: pair } }))
    expect((await callBridged(execute, 'memory_search', { query: 'x' })).modelBinding).toEqual(pair)

    h.captured.options = undefined
    const bare = bridgeDeps()
    await drain(createClaudeCodeProvider(bare.deps).stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-c' } }))
    expect(await callBridged(bare.execute, 'memory_search', { query: 'x' })).not.toHaveProperty('modelBinding')
  })

  it('carries a projectless conversation as projectId null, not as a missing project', async () => {
    const { execute, deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'conv-2', projectId: null, turnId: 'turn-2' },
    }))
    const ctx = await callBridged(execute, 'memory_expand', { id: 'vt:1' })
    expect(ctx).toHaveProperty('projectId', null)
    expect(ctx.turnId).toBe('turn-2')
  })

  it('never hands the executor an empty conversationId (negative)', async () => {
    for (const metadata of [undefined, { userId: 'u-1' }, { conversationId: '' }]) {
      h.captured.options = undefined
      const { execute, deps } = bridgeDeps()
      const provider = createClaudeCodeProvider(deps)
      await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], ...(metadata ? { metadata } : {}) }))
      const ctx = await callBridged(execute, 'memory_search', { query: 'x' })
      expect(ctx).not.toHaveProperty('conversationId')
      // Nothing is invented for the turn either: no id means no id.
      expect(ctx).not.toHaveProperty('turnId')
      expect(ctx).not.toHaveProperty('runId')
      expect(ctx).not.toHaveProperty('projectId')
    }
  })

  it('without governance the executor is told the call was NOT pre-gated (negative)', async () => {
    const { execute, deps } = bridgeDeps()
    const provider = createClaudeCodeProvider({ ...deps, getGovernance: undefined })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-3' } }))
    const ctx = await callBridged(execute, 'memory_search', { query: 'x' })
    expect(ctx.securityPipelineHandled).toBe(false)
  })
})

describe('claude-code in-process bridge — tool scope', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('offers exactly the tools the request names (negative: nothing outside request.tools)', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [def('memory_search'), def('memory_expand'), def('memory_search')],
      metadata: { conversationId: 'conv-1' },
    }))
    expect(bridgedNames().sort()).toEqual(['memory_expand', 'memory_search'])
    expect(bridgedNames()).not.toContain('create_task')
    expect(bridgedNames()).not.toContain('run_specialist')
  })

  it('a tool the request names that is not registered is simply absent', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [def('create_task'), def('no_such_tool')],
      metadata: { conversationId: 'conv-1' },
    }))
    expect(bridgedNames()).toEqual(['create_task'])
  })

  it('request.tools undefined → every registered tool except the host-native ones', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-1' } }))
    expect(bridgedNames().sort()).toEqual(['browser_navigate', 'create_task', 'memory_expand', 'memory_search', 'propose_team', 'run_specialist'])
  })

  it('an empty request.tools list names no scope and offers the same as undefined', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], tools: [], metadata: { conversationId: 'conv-1' } }))
    expect(bridgedNames()).toContain('create_task')
    expect(bridgedNames()).toContain('memory_search')
  })

  it('bridges request.tools ∩ bridgeable: the EYAS browser yes, a host-native tool never, even when named (negative)', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [def('memory_search'), def('run_command'), def('browser_navigate')],
      metadata: { conversationId: 'conv-1' },
    }))
    expect(bridgedNames()).toEqual(['memory_search', 'browser_navigate'])
    expect(bridgedNames()).not.toContain('run_command')
  })

  it('every bridged call carries the bridged set as its toolset, so the executor refuses anything else', async () => {
    const { execute, deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [def('memory_search'), def('run_command'), def('browser_navigate')],
      metadata: { conversationId: 'conv-1' },
    }))
    const ctx = await callBridged(execute, 'browser_navigate', { url: 'https://example.test' })
    expect([...ctx.allowedTools].sort()).toEqual(['browser_navigate', 'memory_search'])
    // Neither a host-native tool nor one the request did not offer (negative).
    expect(ctx.allowedTools.has('run_command')).toBe(false)
    expect(ctx.allowedTools.has('create_task')).toBe(false)
  })

  it('Solo strips the delegation family through the one resolver; memory stays', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    for (const tools of [undefined, [def('memory_search'), def('run_specialist'), def('propose_team')]]) {
      h.captured.options = undefined
      await drain(provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        orchestration: 'solo',
        ...(tools ? { tools } : {}),
        metadata: { conversationId: 'conv-1' },
      }))
      expect(bridgedNames()).toContain('memory_search')
      expect(bridgedNames()).not.toContain('run_specialist')
      expect(bridgedNames()).not.toContain('propose_team')
    }
  })

  it('outside Solo the delegation tools stay on the bridge', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], orchestration: 'deep', metadata: { conversationId: 'conv-1' } }))
    expect(bridgedNames()).toContain('run_specialist')
  })

  it('a scope that leaves no bridgeable tool wires no EYAS MCP server (negative)', async () => {
    const { deps } = bridgeDeps()
    const provider = createClaudeCodeProvider(deps)
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }], tools: [def('run_command')], metadata: { conversationId: 'conv-1' } }))
    expect(h.captured.options.mcpServers).toBeUndefined()
  })
})

describe('claude-code tool addressing', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('declares mcp-prefix addressing matching the name its runtime gives bridged tools', async () => {
    const provider = createClaudeCodeProvider()
    expect(provider.toolAddressing).toEqual({ kind: 'mcp-prefix', prefix: 'mcp__eyas__' })
    expect(renderToolRef(toolAddressingOf(provider), 'memory_search')).toBe('`mcp__eyas__memory_search`')

    // The runtime lists a tool of MCP server <key> as mcp__<key>__<name>: the
    // prefix must name the server key the provider actually registers.
    const { deps } = bridgeDeps()
    const wired = createClaudeCodeProvider(deps)
    await drain(wired.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'conv-1' } }))
    const [server] = Object.keys(h.captured.options.mcpServers)
    expect(`mcp__${server}__`).toBe((provider.toolAddressing as { prefix: string }).prefix)
  })

  it('is not native: a prompt never names a bare EYAS tool for Claude Code (negative)', () => {
    const provider = createClaudeCodeProvider()
    expect(toolAddressingOf(provider).kind).not.toBe('native')
    expect(renderToolRef(toolAddressingOf(provider), 'memory_search')).not.toBe('`memory_search`')
  })
})
