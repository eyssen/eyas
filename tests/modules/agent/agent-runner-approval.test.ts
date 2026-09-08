// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { AgentEvent } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => silentLogger,
}

/**
 * Phase 3F integration — agent-runner × approval tier.
 *
 * Covers the four branches:
 *   1. autopilot default    → no approval events, tool runs as before
 *   2. paranoid + approve   → tool_approval_required + tool runs
 *   3. paranoid + deny      → tool_approval_denied + tool_result isError
 *   4. paranoid + no cb     → fail-closed, denied without calling executor
 */

function toolUseResponse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): ModelResponse {
  return {
    id: 'r-tu',
    provider: 'mock',
    model: 'mock',
    content: [
      { type: 'tool_use', id, name, input },
    ] as any,
    stopReason: 'tool_use',
    usage: { inputTokens: 10, outputTokens: 10 },
  }
}

function textResponse(text: string): ModelResponse {
  return {
    id: 'r-done',
    provider: 'mock',
    model: 'mock',
    content: [{ type: 'text', text }],
    stopReason: 'end',
    usage: { inputTokens: 5, outputTokens: 5 },
  }
}

/** Gateway that streams two turns: first a tool_use, then a plain text end. */
function makeTwoTurnGateway(): ModelGateway {
  let turn = 0
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    listProviders: vi.fn(() => []),
    listAllModels: vi.fn(async () => []),
    embed: vi.fn(),
    async complete() {
      throw new Error('streaming only in this test')
    },
    async *stream(): AsyncIterable<StreamEvent> {
      turn++
      if (turn === 1) {
        yield { type: 'done', response: toolUseResponse('tu-1', 'run_command', { cmd: 'ls' }) }
      } else {
        yield { type: 'done', response: textResponse('finished') }
      }
    },
  } as unknown as ModelGateway
}

function makeExecutor(output: unknown = { result: 'ok' }) {
  const execute = vi.fn(async () => ({
    success: true,
    output,
    durationMs: 5,
  }))
  return { execute } as any
}

async function collect(events: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

describe('agent-runner × approval-tier integration (Phase 3F)', () => {
  it('autopilot default (no policy): no approval events, executor runs', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const runner = createAgentRunner({ gateway, toolExecutor })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
    }))

    expect(events.some(e => e.type === 'tool_approval_required')).toBe(false)
    expect(events.some(e => e.type === 'tool_approval_denied')).toBe(false)
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('policy says approve + callback returns true: tool runs with an approval event', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const approvalPolicy = {
      decide: vi.fn().mockReturnValue({
        action: 'approve',
        reason: 'paranoid — all tool calls require approval',
        requiresPreview: false,
      }),
    }
    const onApprovalRequired = vi.fn().mockResolvedValue(true)

    const runner = createAgentRunner({
      gateway,
      toolExecutor,
      approvalPolicy: approvalPolicy as any,
      onApprovalRequired,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
    }))

    expect(events.filter(e => e.type === 'tool_approval_required')).toHaveLength(1)
    expect(events.filter(e => e.type === 'tool_approval_denied')).toHaveLength(0)
    expect(onApprovalRequired).toHaveBeenCalledTimes(1)
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('policy says approve + callback returns false: tool NOT executed, denied result returned', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const approvalPolicy = {
      decide: vi.fn().mockReturnValue({
        action: 'approve',
        reason: 'balanced — red tier',
        requiresPreview: true,
      }),
    }
    const onApprovalRequired = vi.fn().mockResolvedValue(false)

    const runner = createAgentRunner({
      gateway,
      toolExecutor,
      approvalPolicy: approvalPolicy as any,
      onApprovalRequired,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
    }))

    expect(events.some(e => e.type === 'tool_approval_required')).toBe(true)
    const denied = events.filter(e => e.type === 'tool_approval_denied')
    expect(denied).toHaveLength(1)
    expect((denied[0] as any).reason).toContain('human reviewer denied')
    expect(toolExecutor.execute).not.toHaveBeenCalled()

    // The tool_result emitted to the model carries isError so the model
    // understands the action did not happen.
    const toolResult = events.find(e => e.type === 'tool_result') as any
    expect(toolResult.isError).toBe(true)
    expect(toolResult.content).toContain('Approval denied')
  })

  it('policy says approve + NO callback: fail-closed, tool NOT executed', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const approvalPolicy = {
      decide: vi.fn().mockReturnValue({
        action: 'approve',
        reason: 'paranoid',
        requiresPreview: false,
      }),
    }

    const runner = createAgentRunner({
      gateway,
      toolExecutor,
      approvalPolicy: approvalPolicy as any,
      // onApprovalRequired intentionally omitted
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
    }))

    const denied = events.filter(e => e.type === 'tool_approval_denied') as any[]
    expect(denied).toHaveLength(1)
    expect(denied[0].reason).toContain('no reviewer configured')
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })

  it('policy says auto (autopilot / balanced-green): no approval events, executor runs', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const approvalPolicy = {
      decide: vi.fn().mockReturnValue({
        action: 'auto',
        reason: 'autopilot',
      }),
    }
    const onApprovalRequired = vi.fn()

    const runner = createAgentRunner({
      gateway,
      toolExecutor,
      approvalPolicy: approvalPolicy as any,
      onApprovalRequired,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
    }))

    expect(events.some(e => e.type === 'tool_approval_required')).toBe(false)
    expect(onApprovalRequired).not.toHaveBeenCalled()
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('callback that throws counts as denial (fail-closed)', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const approvalPolicy = {
      decide: vi.fn().mockReturnValue({
        action: 'approve',
        reason: 'paranoid',
        requiresPreview: false,
      }),
    }
    const onApprovalRequired = vi.fn().mockRejectedValue(new Error('reviewer offline'))

    const runner = createAgentRunner({
      gateway,
      toolExecutor,
      approvalPolicy: approvalPolicy as any,
      onApprovalRequired,
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
    }))

    // One event for the throw, one for the terminal denied (after the final
    // failure resolution). Both carry tool_approval_denied.
    const denied = events.filter(e => e.type === 'tool_approval_denied') as any[]
    expect(denied.length).toBeGreaterThanOrEqual(1)
    expect(denied[0].reason).toMatch(/callback threw|human reviewer denied/)
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })
})

describe('agent-runner × approval subsystem upgrade (F2 T3)', () => {
  it('interactive escalation (gate escalate, not autonomous) enqueues a row with input_json + arg_hash — previously: no row at all', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const createApproval = vi.fn(() => 1)
    const securityGate = {
      validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })),
    }
    const autonomyPolicy = {
      categoryForTool: vi.fn(() => null), // uncategorized — not autonomous, so this never even runs, but stub it anyway
      resolve: vi.fn(),
      createApproval,
    }

    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: securityGate as any, autonomyPolicy: autonomyPolicy as any })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
      toolContext: { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any,
    }))

    expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({
      category: 'uncategorized',
      toolName: 'run_command',
      conversationId: 'c1',
      agentId: 'a1',
      inputJson: JSON.stringify({ cmd: 'ls' }),
      argHash: expect.any(String),
    }))
    expect(events.some(e => e.type === 'tool_approval_denied')).toBe(true)
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })

  it('a granted call (consumeGrant) proceeds as ALLOWED without a tool_approval_required event', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const securityGate = {
      validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })),
    }
    const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 42 }))
    const autonomyPolicy = { categoryForTool: vi.fn(() => null), resolve: vi.fn(), createApproval: vi.fn(), consumeGrant }

    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: securityGate as any, autonomyPolicy: autonomyPolicy as any, logger: silentLogger })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
      toolContext: { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any,
    }))

    expect(consumeGrant).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1', toolName: 'run_command', argHash: expect.any(String) }))
    expect(autonomyPolicy.createApproval).not.toHaveBeenCalled()
    expect(events.some(e => e.type === 'tool_approval_required')).toBe(false)
    expect(events.some(e => e.type === 'tool_approval_denied')).toBe(false)
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('grant exactly-once integration: approving an escalated call allows the identical re-call exactly once, then escalates again', async () => {
    const db = createMemoryDb()
    createAutonomyTables(db)
    const policy = createAutonomyPolicy(db)

    // maxTurns:1 → the outer loop calls gateway.stream() exactly once per
    // runner.run() invocation, so a fixed one-shot tool_use response is enough
    // to simulate "the same call is attempted again" across separate runs
    // (standing in for a resumed/retried run — Tasks 5/6 wire the real park
    // and resume machinery; this task only proves the grant ledger itself).
    const gateway: ModelGateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
      async complete() { throw new Error('streaming only in this test') },
      async *stream(): AsyncIterable<StreamEvent> {
        yield { type: 'done', response: toolUseResponse('tu-x', 'run_command', { cmd: 'ls' }) }
      },
    } as unknown as ModelGateway

    const toolExecutor = makeExecutor()
    const securityGate = { validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })) }
    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: securityGate as any, autonomyPolicy: policy as any, logger: silentLogger })
    const toolContext = { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any
    const runOpts = { messages: [{ role: 'user' as const, content: 'do it' }], tools: [], maxTurns: 1, toolContext }

    // Run 1: escalates — a pending row is created, the tool does not execute.
    await collect(runner.run(runOpts))
    expect(toolExecutor.execute).not.toHaveBeenCalled()
    const pending = policy.listApprovals('pending')
    expect(pending).toHaveLength(1)

    // Operator approves the row.
    policy.decide(pending[0]!.id, 'approved', 'owner')

    // Run 2: the SAME call — the grant lets it through exactly once.
    await collect(runner.run(runOpts))
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    expect(policy.listApprovals('pending')).toHaveLength(0)

    // Run 3: identical call again — the grant is already consumed, so it
    // escalates (denies) again, producing a FRESH pending row.
    await collect(runner.run(runOpts))
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1) // still 1, not 2
    expect(policy.listApprovals('pending')).toHaveLength(1)
  })

  it('I3: with no conversation_id in scope, skips createApproval entirely (a dead row could never be granted) and appends an explicit note to the denial reason', async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const createApproval = vi.fn(() => 1)
    const securityGate = { validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })) }
    const autonomyPolicy = { categoryForTool: vi.fn(() => null), resolve: vi.fn(), createApproval }

    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: securityGate as any, autonomyPolicy: autonomyPolicy as any })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
      // No toolContext at all — no conversation scope available.
    }))

    expect(createApproval).not.toHaveBeenCalled()
    const denied = events.find(e => e.type === 'tool_approval_denied') as any
    expect(denied).toBeDefined()
    const required = events.find(e => e.type === 'tool_approval_required') as any
    expect(required.reason).toContain('cannot receive grants')
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })

  it("SECURITY INVARIANT: a grant is never even consulted on a deterministic gate 'deny' — consumeGrant must not be called", async () => {
    const gateway = makeTwoTurnGateway()
    const toolExecutor = makeExecutor()
    const securityGate = { validateToolCall: vi.fn(async () => ({ decision: 'deny', reason: 'blocklisted command', riskTier: 'red' })) }
    const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 1 }))
    const autonomyPolicy = { categoryForTool: vi.fn(() => 'data_delete'), resolve: vi.fn(), createApproval: vi.fn(), consumeGrant }

    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: securityGate as any, autonomyPolicy: autonomyPolicy as any })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 2,
      toolContext: { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any,
    }))

    expect(consumeGrant).not.toHaveBeenCalled()
    expect(autonomyPolicy.createApproval).not.toHaveBeenCalled()
    const toolResult = events.find(e => e.type === 'tool_result') as any
    expect(toolResult.content).toContain('blocklisted command')
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })
})
