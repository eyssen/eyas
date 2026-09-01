// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { wrapAgentTool } from '@modules/agent/tools/wrap-agent-tool'

describe('wrapAgentTool', () => {
  const schema = z.object({
    file: z.enum(['AGENTS.md', 'TOOLS.md']),
    content: z.string().max(100),
  })

  function buildFactory() {
    const calls: Array<{ agentId: string; input: unknown }> = []
    const tool = {
      name: 'demo_tool',
      description: 'A demo tool',
      inputSchema: schema,
      async invoke(agentId: string, input: z.infer<typeof schema>) {
        calls.push({ agentId, input })
        return { ok: true, echoed: input.content }
      },
    }
    return { tool, calls }
  }

  it('converts the Zod schema to JSON Schema and keeps the Zod as validator', () => {
    const { tool } = buildFactory()
    const wrapped = wrapAgentTool(tool, { category: 'agent', riskTier: 'yellow' })
    expect(wrapped.name).toBe('demo_tool')
    expect(wrapped.category).toBe('agent')
    expect(wrapped.riskTier).toBe('yellow')
    expect(wrapped.validator).toBe(schema)
    // JSON Schema-shaped: type: object with named properties
    expect((wrapped.inputSchema as any).type).toBe('object')
    expect((wrapped.inputSchema as any).properties.file).toBeDefined()
    expect((wrapped.inputSchema as any).properties.content).toBeDefined()
  })

  it('passes optional flags through (requiresApproval, timeoutMs)', () => {
    const { tool } = buildFactory()
    const wrapped = wrapAgentTool(tool, {
      category: 'agent',
      riskTier: 'red',
      requiresApproval: true,
      timeoutMs: 5_000,
    })
    expect(wrapped.requiresApproval).toBe(true)
    expect(wrapped.timeoutMs).toBe(5_000)
  })

  it('pulls agentId from ctx and forwards input to invoke', async () => {
    const { tool, calls } = buildFactory()
    const wrapped = wrapAgentTool(tool, { category: 'agent', riskTier: 'green' })
    const result = await wrapped.execute(
      { file: 'AGENTS.md', content: 'hello' },
      { conversationId: 'c1', userId: 'u1', agentId: 'agent-42', logger: {} as any },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].agentId).toBe('agent-42')
    expect(calls[0].input).toEqual({ file: 'AGENTS.md', content: 'hello' })
    expect(result).toEqual({ ok: true, echoed: 'hello' })
  })

  it('throws when ctx.agentId is missing', async () => {
    const { tool } = buildFactory()
    const wrapped = wrapAgentTool(tool, { category: 'agent', riskTier: 'green' })
    await expect(
      wrapped.execute({ file: 'AGENTS.md', content: 'hi' }, { conversationId: 'c1', userId: 'u1', logger: {} as any }),
    ).rejects.toThrow(/requires ctx\.agentId/)
  })

  it('throws when ctx is undefined', async () => {
    const { tool } = buildFactory()
    const wrapped = wrapAgentTool(tool, { category: 'agent', riskTier: 'green' })
    await expect(
      wrapped.execute({ file: 'AGENTS.md', content: 'hi' }, undefined),
    ).rejects.toThrow(/requires ctx\.agentId/)
  })
})
