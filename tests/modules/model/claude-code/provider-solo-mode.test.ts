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
    securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) },
    agentRegistry: { list: () => [{ id: 'dev', name: 'Dev', goal: 'g', systemPrompt: 'p' }] },
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const req = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

describe('claude-code provider — solo orchestration mode', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('solo strips the Task tool and the subagent roster', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream({ ...req, orchestration: 'solo' } as any))
    expect(h.captured.options.tools).not.toContain('Task')
    expect(h.captured.options.tools).toContain('Read')
    expect(h.captured.options.agents).toBeUndefined()
  })

  it('auto/deep keep Task + agents available', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream({ ...req, orchestration: 'deep' } as any))
    expect(h.captured.options.tools).toContain('Task')
    expect(h.captured.options.agents?.dev).toBeTruthy()

    h.captured.options = undefined
    await drain(provider.stream(req as any))
    expect(h.captured.options.tools).toContain('Task')
  })
})
