// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { AgentEvent } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'

// The tool every scripted turn calls, offered to the run: the runner refuses
// a tool the run was not offered (H9) before any gate or approval.
const OFFERED_TOOLS = [{ name: 'run_command', description: 'run a command', inputSchema: { type: 'object' } }]

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => silentLogger,
}

/**
 * Phase 3F integration — agent-runner × approval tier.
 *
 * Covers the four branches (G5: one approval_required event for a call left
 * waiting on a human, and the tool_result says how the call ended):
 *   1. autopilot default    → no approval event, tool runs as before
 *   2. paranoid + approve   → the reviewer decided in-band: tool runs, no approval event
 *   3. paranoid + deny      → the reviewer decided: tool_result outcome 'denied'
 *   4. paranoid + no cb     → fail-closed: approval_required event + tool_result
 *                             outcome 'approval_required', executor never called
 */

const approvalEvents = (events: AgentEvent[]) => events.filter(e => e.type === 'approval_required') as any[]
const firstResult = (events: AgentEvent[]) => events.find(e => e.type === 'tool_result') as any

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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
    }))

    expect(approvalEvents(events)).toHaveLength(0)
    expect(firstResult(events)).toMatchObject({ outcome: 'success', executedBy: 'eyas', isError: false })
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('policy says approve + callback returns true: the reviewer decided in-band, tool runs, no approval event', async () => {
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
    }))

    expect(approvalEvents(events)).toHaveLength(0)
    expect(onApprovalRequired).toHaveBeenCalledTimes(1)
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    expect(firstResult(events).outcome).toBe('success')
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
    }))

    // A human answered: nothing waits on the queue, so no approval event.
    expect(approvalEvents(events)).toHaveLength(0)
    expect(toolExecutor.execute).not.toHaveBeenCalled()

    // The tool_result emitted to the model carries isError so the model
    // understands the action did not happen; the row settles as 'denied'.
    const toolResult = firstResult(events)
    expect(toolResult.isError).toBe(true)
    expect(toolResult.outcome).toBe('denied')
    expect(toolResult.content).toContain('Approval denied')
    expect(toolResult.content).toContain('human reviewer denied')
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
    }))

    const approvals = approvalEvents(events)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ toolUseId: 'tu-1', toolName: 'run_command', reason: 'paranoid', riskTier: 'green' })
    // No approval queue wired → no row to point at.
    expect(approvals[0].approvalId).toBeUndefined()
    const toolResult = firstResult(events)
    expect(toolResult.outcome).toBe('approval_required')
    expect(toolResult.content).toContain('no reviewer configured')
    expect(toolExecutor.execute).not.toHaveBeenCalled()
    // The removed events are gone.
    expect(events.some(e => (e as any).type === 'tool_approval_required' || (e as any).type === 'tool_approval_denied')).toBe(false)
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
    }))

    expect(approvalEvents(events)).toHaveLength(0)
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
    }))

    // A failed reviewer decided nothing: the call is left waiting on a human.
    expect(approvalEvents(events)).toHaveLength(1)
    const toolResult = firstResult(events)
    expect(toolResult.outcome).toBe('approval_required')
    expect(toolResult.content).toContain('approval callback threw: reviewer offline')
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
      tools: OFFERED_TOOLS,
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
    // The approval event points at the queued row, and the row settles as waiting.
    expect(approvalEvents(events)).toEqual([
      expect.objectContaining({ toolUseId: 'tu-1', toolName: 'run_command', reason: 'needs review', approvalId: 1, riskTier: 'yellow' }),
    ])
    expect(firstResult(events).outcome).toBe('approval_required')
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })

  it('a granted call (consumeGrant) proceeds as ALLOWED without an approval_required event', async () => {
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
      toolContext: { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any,
    }))

    expect(consumeGrant).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1', toolName: 'run_command', argHash: expect.any(String) }))
    expect(autonomyPolicy.createApproval).not.toHaveBeenCalled()
    expect(approvalEvents(events)).toHaveLength(0)
    expect(firstResult(events).outcome).toBe('success')
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
    const runOpts = { messages: [{ role: 'user' as const, content: 'do it' }], tools: OFFERED_TOOLS, maxTurns: 1, toolContext }

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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
      // No toolContext at all — no conversation scope available.
    }))

    expect(createApproval).not.toHaveBeenCalled()
    const [required] = approvalEvents(events)
    expect(required.reason).toContain('cannot receive grants')
    expect(required.approvalId).toBeUndefined()
    expect(firstResult(events).outcome).toBe('approval_required')
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
      tools: OFFERED_TOOLS,
      maxTurns: 2,
      toolContext: { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any,
    }))

    expect(consumeGrant).not.toHaveBeenCalled()
    expect(autonomyPolicy.createApproval).not.toHaveBeenCalled()
    const toolResult = firstResult(events)
    expect(toolResult.content).toContain('blocklisted command')
    expect(toolResult.outcome).toBe('denied')
    expect(approvalEvents(events)).toHaveLength(0)
    expect(toolExecutor.execute).not.toHaveBeenCalled()
  })
})
