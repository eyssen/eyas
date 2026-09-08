// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { options: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  getSessionInfo: async () => null,
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'

const toolDeps = {
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
}

function governance() {
  return {
    securityGate: {
      validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }),
      autonomyPolicy: { categoryForTool: () => null, resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: vi.fn() },
    },
    agentRegistry: {
      list: () => [{ id: 'dev', name: 'Dev', role: 'developer', goal: 'write code', systemPrompt: 'You write code', tools: ['read'], model: 'claude-code-sonnet' }],
    },
    orchestrationSink: vi.fn(),
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const req = { messages: [{ role: 'user' as const, content: 'hi' }], model: 'claude-code-sonnet', metadata: { conversationId: 'c1', agentId: 'a1', teamSessionId: 'ts1' } }

describe('claude-code provider — P1 agents/governance/hooks wiring', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('enables Task and wires canUseTool/agents/hooks when governance is present (no bypassPermissions)', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: governance })
    await drain(provider.stream(req as any))
    const o = h.captured.options
    expect(o.tools).toContain('Task')
    expect(typeof o.canUseTool).toBe('function')
    expect(o.permissionMode).not.toBe('bypassPermissions')
    expect(o.agents?.dev).toMatchObject({ description: expect.any(String), prompt: expect.any(String) })
    expect(o.hooks).toBeTruthy()
    expect(o.includeHookEvents).toBe(true)
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
