// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The provider runs exactly the runtime it was built with: every query() —
// chat and isolated — gets the same explicit pathToClaudeCodeExecutable, the
// provider itself never shells out to a `claude` of its own (the paid host
// `claude -p` model probe is gone), and it sends no thinking option unless
// thinking was requested.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ calls: [] as any[], execFile: vi.fn(), spawn: vi.fn(), execFileSync: vi.fn() }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.calls.push(args.options)
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

// Any attempt by the provider to run a CLI itself would land here.
vi.mock('child_process', () => ({ execFile: h.execFile, spawn: h.spawn, execFileSync: h.execFileSync }))
vi.mock('node:child_process', () => ({ execFile: h.execFile, spawn: h.spawn, execFileSync: h.execFileSync }))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'
import { effortPlanFor } from '../../../helpers/effort-plan.js'

async function drain(gen: AsyncIterable<unknown>) { for await (const _ of gen) { /* consume */ } }

const base = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

const governed = () => ({
  securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' as const }) },
})

beforeEach(() => {
  h.calls = []
  h.execFile.mockReset()
  h.spawn.mockReset()
  h.execFileSync.mockReset()
})

describe('claude-code provider — one runtime for every query', () => {
  it('chat and isolated queries receive the identical pathToClaudeCodeExecutable', async () => {
    const provider = createClaudeCodeProvider({
      runtime: TEST_CLAUDE_RUNTIME,
      toolExecutor: { execute: vi.fn() } as any,
      toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
      getGovernance: () => governed() as any,
    })
    await drain(provider.stream(base as any))
    await drain(provider.stream({ ...base, isolated: true } as any))
    await provider.complete({ ...base, isolated: true } as any)
    expect(h.calls).toHaveLength(3)
    for (const options of h.calls) expect(options.pathToClaudeCodeExecutable).toBe(TEST_CLAUDE_RUNTIME.path)
  })

  it('passes the SDK-bundled last resort path through unchanged', async () => {
    const bundled = { path: '/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js', version: '2.1.89', source: 'sdk-bundled' as const }
    await drain(createClaudeCodeProvider({ runtime: bundled }).stream(base as any))
    expect(h.calls[0].pathToClaudeCodeExecutable).toBe(bundled.path)
  })

  it('refuses to run without a resolved runtime instead of letting the SDK pick a binary', async () => {
    const provider = createClaudeCodeProvider()
    await expect(drain(provider.stream(base as any))).rejects.toThrow(/runtime/)
    expect(h.calls).toHaveLength(0)
  })
})

describe('claude-code provider — no host CLI calls of its own', () => {
  it('lists models, discovers, streams and completes without touching child_process', async () => {
    const init = { models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', supportsEffort: true, supportedEffortLevels: ['low', 'high'] }] }
    const provider = createClaudeCodeProvider({
      runtime: TEST_CLAUDE_RUNTIME,
      discovery: { cwd: '/tmp', query: () => ({ initializationResult: async () => init, close: () => {} }) },
    })
    // Discovery asks the runtime through the SDK client, never a `claude` of its own.
    expect((await provider.fetchModels!()).map((m) => m.id)).toEqual(['claude-code-sonnet'])
    const models = await provider.listModels()
    expect(models.map((m) => m.id).sort()).toEqual(['claude-code-fable', 'claude-code-haiku', 'claude-code-opus', 'claude-code-sonnet'])
    await drain(provider.stream(base as any))
    await provider.complete({ ...base, isolated: true } as any)
    expect(h.execFile).not.toHaveBeenCalled()
    expect(h.spawn).not.toHaveBeenCalled()
    expect(h.execFileSync).not.toHaveBeenCalled()
  })
})

describe('claude-code provider — thinking is only sent when requested', () => {
  it('no thinking:{type:"disabled"} (nor any thinking option) when nothing is requested', async () => {
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    await drain(provider.stream(base as any))
    await drain(provider.stream({ ...base, isolated: true } as any))
    for (const options of h.calls) {
      expect('thinking' in options).toBe(false)
      expect('maxThinkingTokens' in options).toBe(false)
    }
  })

  it('thinking the effort plan turns on is adaptive, never a fixed budget', async () => {
    // The runtime reported effort and adaptive thinking for this model.
    const lookupModelMetadata = () => ({
      alias: 'opus',
      reasoning: { source: 'sdk' as const, param: 'effort' as const, levels: ['low' as const, 'high' as const], adaptiveThinking: true, runtime: TEST_CLAUDE_RUNTIME.version!, discoveredAt: '2026-09-23T00:00:00.000Z' },
    })
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME, lookupModelMetadata })
    await drain(provider.stream({ ...base, model: 'claude-code-opus', effortPlan: effortPlanFor('high') } as any))
    expect(h.calls[0].thinking).toEqual({ type: 'adaptive' })
    expect(JSON.stringify(h.calls[0])).not.toMatch(/budgetTokens/)
  })
})
