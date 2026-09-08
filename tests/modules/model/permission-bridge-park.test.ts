// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T5 — CLI-provider park, bridge half. For claude-code / grok-cli the
// agentic loop runs INSIDE the provider, so an escalation can only be denied
// in-session. Two things make that denial durable:
//   1. the per-request approval sink tells the runner WHICH approval row the
//      bridge enqueued, so the run can park on it after the turn, and
//   2. an autonomous deny also asks the SDK to interrupt, so the provider stops
//      burning tokens re-planning around a wall it cannot get past.
// Interactive denies stay non-interrupt: a human is right there to re-steer.

import { describe, it, expect, vi } from 'vitest'
import { createPermissionBridge, type PermissionBridgeDeps } from '@modules/model/permission-bridge.js'

const opts = { toolUseID: 'tu1', signal: new AbortController().signal }

function deps(over: Partial<PermissionBridgeDeps> = {}): PermissionBridgeDeps {
  return {
    validateToolCall: () => ({ decision: 'allow', reason: 'green', riskTier: 'green' }),
    ctx: { conversationId: 'c1', agentId: 'a1' },
    ...over,
  }
}

const escalate = () => ({ decision: 'escalate' as const, reason: 'needs review', riskTier: 'yellow' })

describe('permission bridge — approval sink (F2 T5)', () => {
  it('gate escalate: reports the enqueued approval id (with the tool name) to the sink', async () => {
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      validateToolCall: escalate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: () => 501 },
      onEscalatedApproval,
    }))

    const r = await bridge('Write', { path: '/tmp/x' }, opts)

    expect(r).toMatchObject({ behavior: 'deny' })
    expect(onEscalatedApproval).toHaveBeenCalledWith(501, 'Write')
  })

  // Critical (fix round 1): without run_id the parked run is unreachable —
  // unpark() takes a run id and the re-park cap counts approvals per lineage.
  it('stamps ctx.runId onto every enqueued approval (escalate + ladder paths)', async () => {
    const escalateApproval = vi.fn(() => 1)
    const ladderApproval = vi.fn(() => 2)
    const escalateBridge = createPermissionBridge(deps({
      ctx: { conversationId: 'c1', agentId: 'a1', runId: 'run-77' },
      validateToolCall: escalate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: escalateApproval },
    }))
    const ladderBridge = createPermissionBridge(deps({
      ctx: { conversationId: 'c1', agentId: 'a1', runId: 'run-77' },
      autonomous: true,
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: ladderApproval },
    }))

    await escalateBridge('Write', {}, opts)
    await ladderBridge('Bash', {}, opts)

    expect(escalateApproval).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-77' }))
    expect(ladderApproval).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-77' }))
  })

  it('autonomous ladder deny: reports the enqueued approval id to the sink', async () => {
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: () => 777 },
      onEscalatedApproval,
    }))

    await bridge('mcp__eyas__delete_record', { id: 1 }, opts)

    expect(onEscalatedApproval).toHaveBeenCalledWith(777, 'delete_record')
  })

  it('does NOT call the sink when no row was created (no conversation scope)', async () => {
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      ctx: {},
      validateToolCall: escalate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: () => 1 },
      onEscalatedApproval,
    }))

    await bridge('Write', {}, opts)

    expect(onEscalatedApproval).not.toHaveBeenCalled()
  })

  it('does NOT call the sink when the enqueue throws', async () => {
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      validateToolCall: escalate,
      autonomy: {
        categoryForTool: () => 'file_write',
        resolve: () => ({ level: 1, locked: false, maxLevel: 3 }),
        createApproval: () => { throw new Error('queue down') },
      },
      onEscalatedApproval,
    }))

    const r = await bridge('Write', {}, opts)

    expect(r).toMatchObject({ behavior: 'deny' })
    expect(onEscalatedApproval).not.toHaveBeenCalled()
  })

  it('does NOT call the sink for a deterministic gate deny (nothing to approve)', async () => {
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: () => ({ decision: 'deny', reason: 'blocklisted', riskTier: 'red' }),
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: () => 1 },
      onEscalatedApproval,
    }))

    await bridge('Bash', { command: 'rm -rf /' }, opts)

    expect(onEscalatedApproval).not.toHaveBeenCalled()
  })

  it('a granted call never reaches the sink (the grant lets it run)', async () => {
    const onEscalatedApproval = vi.fn()
    const bridge = createPermissionBridge(deps({
      validateToolCall: escalate,
      autonomy: {
        categoryForTool: () => 'file_write',
        resolve: () => ({ level: 1, locked: false, maxLevel: 3 }),
        createApproval: () => 1,
        consumeGrant: () => ({ granted: true, approvalId: 9 }),
      },
      onEscalatedApproval,
    }))

    expect(await bridge('Write', {}, opts)).toMatchObject({ behavior: 'allow' })
    expect(onEscalatedApproval).not.toHaveBeenCalled()
  })
})

// Interrupt is keyed on the PARK SINK, not on autonomy: interrupting a run
// nobody collects approvals for kills a turn that used to survive on
// deny-and-continue (fix round 1, Important 2).
describe('permission bridge — interrupt on parkable approval denies (F2 T5)', () => {
  it('escalate deny with a park sink asks the SDK to interrupt', async () => {
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: escalate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 3, locked: false, maxLevel: 3 }), createApproval: () => 1 },
      onEscalatedApproval: vi.fn(),
    }))

    expect(await bridge('Write', {}, opts)).toMatchObject({ behavior: 'deny', interrupt: true })
  })

  it('ladder deny with a park sink asks the SDK to interrupt', async () => {
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: () => 1 },
      onEscalatedApproval: vi.fn(),
    }))

    expect(await bridge('Bash', {}, opts)).toMatchObject({ behavior: 'deny', interrupt: true })
  })

  it('AUTONOMOUS run with NO park sink does not interrupt — unsupervised/no-event-store runs still deny-and-continue', async () => {
    const escalateBridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: escalate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: () => 1 },
    }))
    const ladderBridge = createPermissionBridge(deps({
      autonomous: true,
      autonomy: { categoryForTool: () => 'data_delete', resolve: () => ({ level: 1, locked: true, maxLevel: 1 }), createApproval: () => 1 },
    }))

    expect((await escalateBridge('Write', {}, opts) as any).interrupt).toBeUndefined()
    expect((await ladderBridge('Bash', {}, opts) as any).interrupt).toBeUndefined()
  })

  it('INTERACTIVE escalate deny does not interrupt — the human can re-steer in place', async () => {
    const bridge = createPermissionBridge(deps({
      validateToolCall: escalate,
      autonomy: { categoryForTool: () => 'file_write', resolve: () => ({ level: 1, locked: false, maxLevel: 3 }), createApproval: () => 1 },
    }))

    const r = await bridge('Write', {}, opts) as any
    expect(r.behavior).toBe('deny')
    expect(r.interrupt).toBeUndefined()
  })

  it('a deterministic gate deny never interrupts (autonomous or not) — it is a normal blocked call', async () => {
    const bridge = createPermissionBridge(deps({
      autonomous: true,
      validateToolCall: () => ({ decision: 'deny', reason: 'blocklisted', riskTier: 'red' }),
    }))

    const r = await bridge('Bash', {}, opts) as any
    expect(r.behavior).toBe('deny')
    expect(r.interrupt).toBeUndefined()
  })
})
