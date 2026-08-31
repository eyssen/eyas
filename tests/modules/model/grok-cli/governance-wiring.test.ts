// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { buildGrokCliArgs } from '@modules/model/submodules/grok-cli/acp-client.js'
import type { StreamEvent } from '@modules/model/types.js'

function captureRunPrompt() {
  const captured: { opts?: any } = {}
  async function* fakeRun(opts: any) {
    captured.opts = opts
    yield { type: 'text', text: 'ok' } satisfies StreamEvent
    return { text: 'ok', sessionId: null, inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
  }
  return { captured, fakeRun }
}

function governance(over: { level?: number; locked?: boolean; decision?: 'allow' | 'escalate' } = {}) {
  const createApproval = vi.fn()
  return {
    gov: {
      securityGate: {
        validateToolCall: vi.fn(() => ({ decision: over.decision ?? ('escalate' as const), reason: 'yellow', riskTier: 'yellow' })),
        autonomyPolicy: {
          categoryForTool: () => 'file_write',
          resolve: () => ({ level: over.level ?? 1, locked: over.locked ?? true, maxLevel: 3 }),
          createApproval,
        },
      },
    },
    createApproval,
  }
}

async function drain(gen: AsyncIterable<any>) { for await (const _ of gen) { /* consume */ } }

describe('grok-cli CLI args', () => {
  it('never passes --always-approve (permissions must flow through the gate)', () => {
    const args = buildGrokCliArgs('grok-4.5')
    expect(args).not.toContain('--always-approve')
    expect(args[0]).toBe('agent')
    expect(args[args.length - 1]).toBe('stdio')
    expect(args).toContain('--model')
  })
})

describe('grok-cli provider — governance wiring', () => {
  it('passes a canUseTool gate callback into the ACP runner when governance is present', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, createApproval } = governance()
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', agentId: 'a1', origin: 'interactive' },
    } as any))

    expect(typeof captured.opts.canUseTool).toBe('function')
    // Interactive run: escalate now DENIES and enqueues an approval (fail-closed).
    const decision = await captured.opts.canUseTool('Write', { path: '/tmp/x' })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalled()
    expect(gov.securityGate.validateToolCall).toHaveBeenCalledWith(
      'Write',
      { path: '/tmp/x' },
      expect.objectContaining({ conversationId: 'c1', agentId: 'a1' }),
    )
  })

  // F2 T5 — the runner's park sink rides on the request metadata, so an
  // escalation inside the provider's own loop still tells the runner what to
  // park on. Threading it here is what makes a CLI run parkable at all.
  it('threads the per-request approval sink from metadata into the bridge', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, createApproval } = governance()
    createApproval.mockReturnValue(123)
    const onEscalatedApproval = vi.fn()
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', agentId: 'a1', autonomous: true, onEscalatedApproval },
    } as any))

    const decision = await captured.opts.canUseTool('Write', { path: '/tmp/x' })
    expect(decision).toMatchObject({ behavior: 'deny', interrupt: true })
    expect(onEscalatedApproval).toHaveBeenCalledWith(123, 'Write')
  })

  it('treats team runs as autonomous — ladder governs, fail-closed deny + approval', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, createApproval } = governance({ level: 1, locked: true })
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', agentId: 'a1', teamSessionId: 'ts1' },
    } as any))

    const decision = await captured.opts.canUseTool('Write', { path: '/etc/x' })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalled()
  })

  it('passes no gate callback when governance is absent (ACP layer then fail-closes)', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] } as any))
    expect(captured.opts.canUseTool).toBeUndefined()
  })

  it('F0 R4: no origin metadata at all → fail-closed autonomous → ladder denies', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, createApproval } = governance({ decision: 'allow' })
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', agentId: 'a1' },
    } as any))

    const decision = await captured.opts.canUseTool('Write', { path: '/tmp/x' })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalled()
  })

  it('F0 R4: an unattended origin (scheduled) cannot opt out via autonomous:false', async () => {
    const { captured, fakeRun } = captureRunPrompt()
    const { gov, createApproval } = governance({ decision: 'allow' })
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any, getGovernance: () => gov as any })
    await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', agentId: 'a1', origin: 'scheduled', autonomous: false },
    } as any))

    const decision = await captured.opts.canUseTool('Write', { path: '/tmp/x' })
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(createApproval).toHaveBeenCalled()
  })
})
