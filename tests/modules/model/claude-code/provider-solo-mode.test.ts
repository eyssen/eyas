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
    securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }) },
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

const req = { messages: [{ role: 'user' as const, content: 'hi' }], metadata: { conversationId: 'c1' } }

// H8 — the provider has no orchestration-specific behaviour of its own: it
// never offers a native subagent spawner, so there is nothing for Solo to
// strip. What Solo means (no specialists, hand-offs or team proposals) is
// decided by the EYAS tool scope for every provider alike (I3/H9).
describe('claude-code provider — orchestration mode', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('solo, auto and deep get the same builtins and the same bridge', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    const seen: any[] = []
    for (const orchestration of ['solo', 'auto', 'deep', undefined]) {
      h.captured.options = undefined
      await drain(provider.stream({ ...req, ...(orchestration ? { orchestration } : {}) } as any))
      seen.push(h.captured.options)
    }
    for (const o of seen) {
      expect(o.tools).toEqual(seen[0].tools)
      expect(Object.keys(o.mcpServers ?? {})).toEqual(['eyas'])
    }
    expect(seen[0].tools).toContain('Read')
  })

  it('solo does not bring back an agent roster or a subagent spawner (negative)', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance() as any })
    await drain(provider.stream({ ...req, orchestration: 'solo' } as any))
    expect(h.captured.options).not.toHaveProperty('agents')
    expect(h.captured.options.tools).not.toContain('Task')
    expect(h.captured.options.tools).not.toContain('Agent')
  })
})
