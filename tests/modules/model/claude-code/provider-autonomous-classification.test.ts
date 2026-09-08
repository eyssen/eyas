// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F0 R4 — the claude-code provider must classify autonomy from the full
// ModelRequestMetadata contract (isAutonomousRequest), not just teamSessionId.
// A locked autonomy category is used as the probe: an autonomous run gets
// denied + an approval queued (ladder governs), while an interactive run
// bypasses the ladder entirely and the gate-allowed call is granted.

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
  toolRegistry: { list: () => [] } as any,
}

function governance() {
  const createApproval = vi.fn()
  return {
    gov: {
      securityGate: {
        validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'yellow' }),
        autonomyPolicy: {
          categoryForTool: () => 'file_write',
          resolve: () => ({ level: 1, locked: true, maxLevel: 3 }),
          createApproval,
        },
      },
    },
    createApproval,
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

describe('claude-code provider — autonomous classification (F0 R4)', () => {
  beforeEach(() => { h.captured.options = undefined })

  it('origin:scheduled → ladder governs → deny + createApproval', async () => {
    const { gov, createApproval } = governance()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', origin: 'scheduled' },
    } as any))

    const decision = await h.captured.options.canUseTool('Write', { path: '/tmp/x' }, { toolUseID: 't1', signal: new AbortController().signal })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalled()
  })

  it('missing metadata → fail-closed autonomous → deny (no createApproval: F2 T3/I3 — no conversationId means no row, since a conversation-less approval could never be granted)', async () => {
    const { gov, createApproval } = governance()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => gov as any })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] } as any))

    const decision = await h.captured.options.canUseTool('Write', { path: '/tmp/x' }, { toolUseID: 't1', signal: new AbortController().signal })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).not.toHaveBeenCalled()
  })

  it('origin:interactive → ladder bypassed → gate-allowed call is granted', async () => {
    const { gov, createApproval } = governance()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', origin: 'interactive' },
    } as any))

    const decision = await h.captured.options.canUseTool('Write', { path: '/tmp/x' }, { toolUseID: 't1', signal: new AbortController().signal })
    expect(decision).toMatchObject({ behavior: 'allow' })
    expect(createApproval).not.toHaveBeenCalled()
  })

  // F2 T5 — the SDK's agentic loop denies the escalated call in-session; the
  // park sink (carried on the request metadata) is how the runner learns which
  // approval to park the run on, and `interrupt` stops the SDK re-planning
  // around a wall it cannot pass.
  it('threads the per-request approval sink into the bridge and interrupts the SDK loop', async () => {
    const { gov, createApproval } = governance()
    createApproval.mockReturnValue(456)
    const onEscalatedApproval = vi.fn()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', origin: 'scheduled', onEscalatedApproval },
    } as any))

    const decision = await h.captured.options.canUseTool('Write', { path: '/tmp/x' }, { toolUseID: 't1', signal: new AbortController().signal })
    expect(decision).toMatchObject({ behavior: 'deny', interrupt: true })
    expect(onEscalatedApproval).toHaveBeenCalledWith(456, 'Write')
  })

  it('teamSessionId back-compat: autonomous even with an interactive origin', async () => {
    const { gov, createApproval } = governance()
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', origin: 'interactive', teamSessionId: 'ts1' },
    } as any))

    const decision = await h.captured.options.canUseTool('Write', { path: '/tmp/x' }, { toolUseID: 't1', signal: new AbortController().signal })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalled()
  })
})
