// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const toolDeps = {
  runtime: TEST_CLAUDE_RUNTIME,
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
}

function governance() {
  return {
    securityGate: {
      validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }),
      autonomyPolicy: { categoryForTool: () => null, resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: vi.fn() },
    },
  }
}

/** A governance object that still carries an agent roster, as an old caller might pass it. */
function governanceWithRoster() {
  return {
    ...governance(),
    agentRegistry: {
      list: vi.fn(() => [{ id: 'dev', name: 'Dev', role: 'developer', goal: 'write code', systemPrompt: 'You write code', tools: ['read'], model: 'claude-code-sonnet', effort: 'high' }]),
    },
  }
}

/** The SDK's own subagent spawner: 'Agent', with 'Task' as its alias. */
const SUBAGENT_SPAWNERS = ['Agent', 'Task']

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const req = { messages: [{ role: 'user' as const, content: 'hi' }], model: 'claude-code-sonnet', metadata: { conversationId: 'c1', agentId: 'a1', teamSessionId: 'ts1' } }

describe('claude-code provider — P1 agents/governance/hooks wiring', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('wires canUseTool and hooks when governance is present (no bypassPermissions)', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: governance })
    await drain(provider.stream(req as any))
    const o = h.captured.options
    expect(typeof o.canUseTool).toBe('function')
    expect(o.permissionMode).not.toBe('bypassPermissions')
    expect(o.hooks).toBeTruthy()
    // G6: no orchestration observers, so no hook lifecycle messages.
    expect(o.includeHookEvents).toBeUndefined()
  })

  // H8 — one specialist mechanism: specialists are EYAS sub-conversations
  // (run_specialist over the bridge) on every provider, never SDK subagents.
  for (const orchestration of ['auto', 'deep'] as const) {
    it(`${orchestration}: no SDK agent roster and no subagent spawner among the tools`, async () => {
      const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: governance })
      await drain(provider.stream({ ...req, orchestration } as any))
      const o = h.captured.options
      expect(o).not.toHaveProperty('agents')
      expect(Array.isArray(o.tools)).toBe(true)
      for (const spawner of SUBAGENT_SPAWNERS) expect(o.tools).not.toContain(spawner)
      expect(o.tools).toContain('Read')
      // The EYAS bridge (where run_specialist lives) is still wired.
      expect(o.mcpServers?.eyas).toBeTruthy()
    })
  }

  it('with no bridge wired the builtins are still an explicit list, so the SDK defaults never apply', async () => {
    for (const deps of [{ runtime: TEST_CLAUDE_RUNTIME }, { ...toolDeps, toolRegistry: { list: () => [] } as any }]) {
      h.captured.options = undefined
      const provider = createClaudeCodeProvider({ ...deps, getGovernance: governance })
      await drain(provider.stream({ ...req, orchestration: 'deep' } as any))
      const o = h.captured.options
      expect(o.mcpServers).toBeUndefined()
      expect(Array.isArray(o.tools)).toBe(true)
      expect(o.tools.length).toBeGreaterThan(0)
      for (const spawner of SUBAGENT_SPAWNERS) expect(o.tools).not.toContain(spawner)
    }
  })

  it('a governance object that carries an agent roster changes nothing (negative)', async () => {
    const plain = createClaudeCodeProvider({ ...toolDeps, getGovernance: governance })
    await drain(plain.stream({ ...req, orchestration: 'deep' } as any))
    const without = h.captured.options

    h.captured.options = undefined
    const gov = governanceWithRoster()
    const withRoster = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => gov as any })
    await drain(withRoster.stream({ ...req, orchestration: 'deep' } as any))
    const o = h.captured.options
    expect(o).not.toHaveProperty('agents')
    expect(o.tools).toEqual(without.tools)
    expect(gov.agentRegistry.list).not.toHaveBeenCalled()
  })

  it('fail-closed: no governance → default permissionMode, never bypassPermissions', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps })
    await drain(provider.stream(req as any))
    const o = h.captured.options
    expect(o.permissionMode).toBe('default')
    expect(o.canUseTool).toBeUndefined()
  })

  it('uses per-request maxTurns when provided, else the construction default', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, maxTurns: 25, getGovernance: governance })
    await drain(provider.stream({ ...req, maxTurns: 7 } as any))
    expect(h.captured.options.maxTurns).toBe(7)

    h.captured.options = undefined
    await drain(provider.stream(req as any))
    expect(h.captured.options.maxTurns).toBe(25)
  })

  it('forwards request.signal into the SDK abortController', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: governance })
    const ac = new AbortController()
    ac.abort()
    await drain(provider.stream({ ...req, signal: ac.signal } as any))
    expect(h.captured.options.abortController.signal.aborted).toBe(true)
  })
})
