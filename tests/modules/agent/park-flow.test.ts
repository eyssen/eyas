// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T5 — durable park (D2). An AUTONOMOUS + SUPERVISED run that hits an
// escalation does NOT deny-and-continue any more: the approval is enqueued
// (T3), the runner yields a terminal `parked_for_approval` and returns, the
// supervisor parks the agent_sessions row ('waiting_approval', no completed_at)
// and the conversation follows it. Task 6 resumes it from the operator's
// decision.
//
// Interactive and unsupervised runs keep EXACTLY the old deny-and-continue
// behaviour — parking a run nobody can resume would just strand it.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createAgentRunner, type AgentEvent } from '@modules/agent/agent-runner'
import { runConversation } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { createDelegationService } from '@modules/agent/delegation'
import { createStageAutomation } from '@modules/board/stage-automation'
import { createPermissionBridge } from '@modules/model/permission-bridge'
import { createAgentRunnerPort } from '@modules/pipelines/ticket-to-code/adapters/agent-runner-port'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy.js'
import { createMemoryDb } from '../../helpers/test-db'
import type { ModelGateway, ModelResponse, StreamEvent } from '@modules/model/types'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {}, child: () => silentLogger,
}

// ─── Runner fixtures ──────────────────────────

function toolUseResponse(id: string, name: string, input: Record<string, unknown>): ModelResponse {
  return {
    id: 'r-tu',
    provider: 'mock',
    model: 'mock',
    content: [{ type: 'tool_use', id, name, input }] as any,
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

/** Two turns: a tool_use, then a plain text end (so a NON-parking run finishes). */
function makeTwoTurnGateway(): ModelGateway {
  let turn = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only in this test') },
    async *stream(): AsyncIterable<StreamEvent> {
      turn++
      if (turn === 1) yield { type: 'done', response: toolUseResponse('tu-1', 'run_command', { cmd: 'ls' }) }
      else yield { type: 'done', response: textResponse('finished') }
    },
  } as unknown as ModelGateway
}

/**
 * A CLI-style provider: the agentic loop runs INSIDE it, so escalations never
 * reach the runner's own approval block — the permission bridge reports them
 * through the per-request approval sink instead.
 */
function makeSinkGateway(opts: { ids: Array<[number, string]>; then: 'done' | 'throw' }): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only in this test') },
    async *stream(request: any): AsyncIterable<StreamEvent> {
      for (const [id, tool] of opts.ids) request.metadata?.onEscalatedApproval?.(id, tool)
      if (opts.then === 'throw') {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      yield { type: 'done', response: textResponse('partial') }
    },
  } as unknown as ModelGateway
}

/**
 * A CLI provider standing in for claude-code / grok-cli. It builds the REAL
 * permission bridge out of `request.metadata` exactly the way both providers
 * do — no mock at that seam — so the whole chain (runId stamping → enqueue →
 * sink → how the turn ends → park) is exercised end to end.
 *
 * `endsWith` models the three real endings:
 *  - 'sdk-interrupt' (claude-code): the SDK honours an interrupting deny by
 *    aborting its controller, which surfaces to the runner as an abort throw.
 *  - 'reject-once'   (grok/ACP): `interrupt` is ignored — acp-governance only
 *    reads `behavior` — so the denied turn runs on and ends cleanly.
 *  - 'network-crash' (grok/ACP): same reject_once, but the CLI then dies for
 *    an unrelated reason AFTER the escalation.
 */
function makeBridgedCliGateway(
  policy: any,
  gate: () => any,
  endsWith: 'sdk-interrupt' | 'reject-once' | 'network-crash' = 'sdk-interrupt',
): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
    async complete() { throw new Error('streaming only in this test') },
    async *stream(request: any): AsyncIterable<StreamEvent> {
      const bridge = createPermissionBridge({
        validateToolCall: gate,
        autonomy: policy,
        autonomous: true,
        ctx: {
          conversationId: request.metadata?.conversationId,
          agentId: request.metadata?.agentId,
          runId: request.metadata?.runId,
        },
        onEscalatedApproval: request.metadata?.onEscalatedApproval,
      })
      const decision = await bridge('run_command', { cmd: 'ls' }, { toolUseID: 't1', signal: new AbortController().signal }) as any

      if (endsWith === 'sdk-interrupt' && decision.interrupt) {
        // cli.js: `deny + interrupt → abortController.abort()`, which the
        // provider surfaces as an abort-named throw.
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }
      if (endsWith === 'network-crash') {
        throw new Error('fetch failed: ECONNRESET')
      }
      yield { type: 'done', response: textResponse('kept going after the in-session deny') }
    },
  } as unknown as ModelGateway
}

function makeExecutor() {
  return { execute: vi.fn(async () => ({ success: true, output: { result: 'ok' }, durationMs: 5 })) } as any
}

function makeStores() {
  return {
    eventStore: { append: vi.fn(async () => {}), latestSeq: vi.fn(async () => 0), getByTypes: vi.fn(async () => []) } as any,
    checkpoint: { shouldAutoCheckpoint: vi.fn(() => false), createCheckpoint: vi.fn(async () => {}), list: vi.fn(async () => []) } as any,
  }
}

async function collect(events: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of events) out.push(e)
  return out
}

const escalatingGate = () => ({
  validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })),
})

function policyOn(db: any) {
  createAutonomyTables(db)
  return createAutonomyPolicy(db)
}

const toolContext = { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger } as any

describe('F2 T5 — native-loop park', () => {
  it('autonomous + supervised escalation parks: yields parked_for_approval with the enqueued approval id and ENDS the loop', async () => {
    const db = createMemoryDb()
    const policy = policyOn(db)
    const toolExecutor = makeExecutor()
    const runner = createAgentRunner({
      gateway: makeTwoTurnGateway(),
      toolExecutor,
      securityGate: escalatingGate() as any,
      autonomyPolicy: policy as any,
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 3,
      autonomous: true,
      sessionId: 'run-1',
      toolContext,
    }))

    const parked = events.find(e => e.type === 'parked_for_approval') as any
    expect(parked).toBeDefined()
    expect(parked.toolName).toBe('run_command')
    const pending = policy.listApprovals('pending')
    expect(pending).toHaveLength(1)
    expect(parked.approvalId).toBe(pending[0]!.id)

    // Terminal: nothing follows the park — no done, no further model turn.
    expect(events[events.length - 1]!.type).toBe('parked_for_approval')
    expect(events.some(e => e.type === 'done')).toBe(false)
    expect(events.some(e => e.type === 'tool_result')).toBe(false)
    expect(toolExecutor.execute).not.toHaveBeenCalled()

    // The row carries the run so Task 6 can resume exactly this session.
    const row = (db.all(sql`SELECT run_id, input_json, arg_hash FROM autonomy_approvals WHERE id = ${pending[0]!.id}`) as any[])[0]
    expect(row.run_id).toBe('run-1')
    expect(row.input_json).toBe(JSON.stringify({ cmd: 'ls' }))
    expect(row.arg_hash).toBeTruthy()
  })

  it('INTERACTIVE run (human attending): unchanged deny-and-continue, never parks', async () => {
    const db = createMemoryDb()
    const policy = policyOn(db)
    const toolExecutor = makeExecutor()
    const runner = createAgentRunner({
      gateway: makeTwoTurnGateway(),
      toolExecutor,
      securityGate: escalatingGate() as any,
      autonomyPolicy: policy as any,
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 3,
      sessionId: 'run-i',
      metadata: { conversationId: 'c1', userId: 'u1', origin: 'interactive' },
      toolContext,
    }))

    expect(events.some(e => e.type === 'parked_for_approval')).toBe(false)
    expect(events.some(e => e.type === 'tool_approval_denied')).toBe(true)
    const toolResult = events.find(e => e.type === 'tool_result') as any
    expect(toolResult.isError).toBe(true)
    // The loop continued to the next turn and finished normally.
    expect(events.some(e => e.type === 'done')).toBe(true)
    // T3 still enqueues the row — only the park is interactive-exempt.
    expect(policy.listApprovals('pending')).toHaveLength(1)
  })

  it('UNSUPERVISED autonomous run (no sessionId): unchanged deny-and-continue, never parks', async () => {
    const db = createMemoryDb()
    const policy = policyOn(db)
    const runner = createAgentRunner({
      gateway: makeTwoTurnGateway(),
      toolExecutor: makeExecutor(),
      securityGate: escalatingGate() as any,
      autonomyPolicy: policy as any,
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 3,
      autonomous: true,
      toolContext,
    }))

    expect(events.some(e => e.type === 'parked_for_approval')).toBe(false)
    expect(events.some(e => e.type === 'tool_approval_denied')).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('supervised but NO event store: refuses to park (nothing to resume from) and warns', async () => {
    const db = createMemoryDb()
    const policy = policyOn(db)
    const warn = vi.fn()
    const runner = createAgentRunner({
      gateway: makeTwoTurnGateway(),
      toolExecutor: makeExecutor(),
      securityGate: escalatingGate() as any,
      autonomyPolicy: policy as any,
      logger: { ...silentLogger, warn } as any,
      // eventStore + checkpoint deliberately absent
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [],
      maxTurns: 3,
      autonomous: true,
      sessionId: 'run-nostore',
      toolContext,
    }))

    expect(events.some(e => e.type === 'parked_for_approval')).toBe(false)
    expect(events.some(e => e.type === 'tool_approval_denied')).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'park skipped: no event store')
  })

  it('an operator cancel WINS over a park — a stopped run must not come back as one awaiting approval', async () => {
    const db = createMemoryDb()
    const policy = policyOn(db)
    const controller = new AbortController()
    // Abort as soon as the gate is consulted: the call is mid-flight, exactly
    // where a cancel and an escalation can race.
    const securityGate = {
      validateToolCall: vi.fn(async () => {
        controller.abort()
        return { decision: 'escalate', reason: 'needs review', riskTier: 'yellow' }
      }),
    }
    const runner = createAgentRunner({
      gateway: makeTwoTurnGateway(),
      toolExecutor: makeExecutor(),
      securityGate: securityGate as any,
      autonomyPolicy: policy as any,
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cancel',
      signal: controller.signal,
      toolContext,
    }))

    expect(events.some(e => e.type === 'parked_for_approval')).toBe(false)
    expect(events.some(e => e.type === 'cancelled')).toBe(true)
  })

  it('parks at most once per run — the FIRST escalation of a turn parks, the rest were already enqueued', async () => {
    const db = createMemoryDb()
    const policy = policyOn(db)
    const twoToolGateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
      async complete() { throw new Error('streaming only') },
      async *stream(): AsyncIterable<StreamEvent> {
        yield {
          type: 'done',
          response: {
            id: 'r', provider: 'mock', model: 'mock', stopReason: 'tool_use',
            usage: { inputTokens: 1, outputTokens: 1 },
            content: [
              { type: 'tool_use', id: 'tu-1', name: 'run_command', input: { cmd: 'a' } },
              { type: 'tool_use', id: 'tu-2', name: 'run_command', input: { cmd: 'b' } },
            ] as any,
          },
        }
      },
    } as unknown as ModelGateway

    const runner = createAgentRunner({
      gateway: twoToolGateway,
      toolExecutor: makeExecutor(),
      securityGate: escalatingGate() as any,
      autonomyPolicy: policy as any,
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-multi', toolContext,
    }))

    expect(events.filter(e => e.type === 'parked_for_approval')).toHaveLength(1)
    // The second tool_use never reached the gate (the generator returned first).
    expect(policy.listApprovals('pending')).toHaveLength(1)
  })
})

describe('F2 T5 — CLI-provider park (approval sink)', () => {
  it('parks on the FIRST id the bridge reported, even though the provider ended its turn cleanly', async () => {
    const runner = createAgentRunner({
      gateway: makeSinkGateway({ ids: [[77, 'Bash'], [78, 'Write']], then: 'done' }),
      toolExecutor: makeExecutor(),
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli',
      toolContext,
    }))

    const parked = events.find(e => e.type === 'parked_for_approval') as any
    expect(parked).toMatchObject({ approvalId: 77, toolName: 'Bash' })
    expect(events[events.length - 1]!.type).toBe('parked_for_approval')
    expect(events.some(e => e.type === 'done')).toBe(false)
  })

  it("parks instead of failing when the provider THROWS after the bridge's interrupt-deny", async () => {
    const runner = createAgentRunner({
      gateway: makeSinkGateway({ ids: [[91, 'Bash']], then: 'throw' }),
      toolExecutor: makeExecutor(),
      logger: silentLogger,
      ...makeStores(),
    })

    const events = await collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli-throw',
      toolContext,
    }))

    expect(events.find(e => e.type === 'parked_for_approval')).toMatchObject({ approvalId: 91, toolName: 'Bash' })
  })

  it('a provider throw with NO reported approval still propagates (park must not swallow real failures)', async () => {
    const runner = createAgentRunner({
      gateway: makeSinkGateway({ ids: [], then: 'throw' }),
      toolExecutor: makeExecutor(),
      logger: silentLogger,
      ...makeStores(),
    })

    await expect(collect(runner.run({
      messages: [{ role: 'user', content: 'do it' }],
      tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli-fail',
      toolContext,
    }))).rejects.toThrow(/aborted/i)
  })

  it('an operator cancel WINS over a CLI park too — the abort surfaces instead of a park', async () => {
    const controller = new AbortController()
    const gateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
      async complete() { throw new Error('streaming only') },
      // A cancelled CLI run reports the abort the same way an interrupted one
      // does — a throw. Only the escalation may be turned into a park.
      async *stream(request: any): AsyncIterable<StreamEvent> {
        request.metadata?.onEscalatedApproval?.(55, 'Bash')
        controller.abort()
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      },
    } as unknown as ModelGateway

    const runner = createAgentRunner({ gateway, toolExecutor: makeExecutor(), logger: silentLogger, ...makeStores() })
    const events: AgentEvent[] = []
    await expect((async () => {
      for await (const e of runner.run({
        messages: [{ role: 'user', content: 'do it' }],
        tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli-cancel',
        signal: controller.signal,
        toolContext,
      })) events.push(e)
    })()).rejects.toThrow(/aborted/i)

    expect(events.some(e => e.type === 'parked_for_approval')).toBe(false)
  })

  // Critical (fix round 1): a CLI-path approval used to be enqueued with
  // run_id NULL — unpark() takes a run id, so the parked run could never be
  // woken and the re-park cap (WHERE run_id IN lineage) was inert.
  describe('end-to-end through the real permission bridge', () => {
    it('stamps run_id = sessionId on the enqueued approval and parks on it', async () => {
      const db = createMemoryDb()
      const policy = policyOn(db)
      const runner = createAgentRunner({
        gateway: makeBridgedCliGateway(policy, () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })),
        toolExecutor: makeExecutor(),
        logger: silentLogger,
        ...makeStores(),
      })

      const events = await collect(runner.run({
        messages: [{ role: 'user', content: 'do it' }],
        tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli-e2e',
        metadata: { conversationId: 'c1', agentId: 'a1', autonomous: true },
        toolContext,
      }))

      const pending = policy.listApprovals('pending')
      expect(pending).toHaveLength(1)
      expect(events.find(e => e.type === 'parked_for_approval')).toMatchObject({
        approvalId: pending[0]!.id,
        toolName: 'run_command',
      })
      const row = (db.all(sql`SELECT run_id FROM autonomy_approvals WHERE id = ${pending[0]!.id}`) as any[])[0]
      expect(row.run_id).toBe('run-cli-e2e')
    })

    it('the lineage re-park cap sees CLI-path approvals (they now carry run_id)', async () => {
      const db = createMemoryDb()
      const policy = policyOn(db)
      ensureRunSupervisionSchema(db)
      db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('run-cli-e2e', 'c1', 'a1', 'running', '2026-01-01T00:00:00Z')`)
      const runner = createAgentRunner({
        gateway: makeBridgedCliGateway(policy, () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })),
        toolExecutor: makeExecutor(),
        logger: silentLogger,
        ...makeStores(),
      })

      await collect(runner.run({
        messages: [{ role: 'user', content: 'do it' }],
        tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli-e2e',
        metadata: { conversationId: 'c1', agentId: 'a1', autonomous: true },
        toolContext,
      }))

      // This is the exact shape the cap counts with.
      const counted = (db.all(sql`SELECT COUNT(*) AS n FROM autonomy_approvals WHERE run_id = 'run-cli-e2e'`) as any[])[0]
      expect(Number(counted.n)).toBe(1)
    })

    // Important 2 (fix round 1): the sink is installed only when the run can
    // park, so keying interrupt on autonomy alone turned an unsupervised
    // autonomous CLI run — which used to deny-and-continue — into a failure.
    it('an autonomous CLI run with NO park sink is not interrupted and completes normally', async () => {
      const db = createMemoryDb()
      const policy = policyOn(db)
      const runner = createAgentRunner({
        gateway: makeBridgedCliGateway(policy, () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })),
        toolExecutor: makeExecutor(),
        logger: silentLogger,
        // no event store / checkpoint → canPark false → no sink installed
      })

      const events = await collect(runner.run({
        messages: [{ role: 'user', content: 'do it' }],
        tools: [], maxTurns: 3, autonomous: true, sessionId: 'run-cli-nosink',
        metadata: { conversationId: 'c1', agentId: 'a1', autonomous: true },
        toolContext,
      }))

      expect(events.some(e => e.type === 'parked_for_approval')).toBe(false)
      expect(events.some(e => e.type === 'done')).toBe(true)
      // The approval row is still queued for the operator — and still carries
      // the run id: it is stamped for every SUPERVISED run, not only parkable
      // ones (Task 9 attributes cost by it).
      const pending = policy.listApprovals('pending')
      expect(pending).toHaveLength(1)
      const row = (db.all(sql`SELECT run_id FROM autonomy_approvals WHERE id = ${pending[0]!.id}`) as any[])[0]
      expect(row.run_id).toBe('run-cli-nosink')
    })
  })

  // How the turn ENDED is the only park signal (fix round 2). The two CLI
  // providers end differently, and a crash that merely lands after an
  // escalation must NOT be laundered into "waiting for approval".
  describe('park is decided by how the provider turn ended', () => {
    const escalatingGateFn = () => ({ decision: 'escalate', reason: 'needs review', riskTier: 'yellow' })

    function runnerOn(policy: any, endsWith: 'sdk-interrupt' | 'reject-once' | 'network-crash', warn = vi.fn()) {
      return createAgentRunner({
        gateway: makeBridgedCliGateway(policy, escalatingGateFn, endsWith),
        toolExecutor: makeExecutor(),
        logger: { ...silentLogger, warn },
        ...makeStores(),
      })
    }

    const runOpts = {
      messages: [{ role: 'user' as const, content: 'do it' }],
      tools: [], maxTurns: 3, autonomous: true,
      metadata: { conversationId: 'c1', agentId: 'a1', autonomous: true },
      toolContext,
    }

    it('claude-code shape: the SDK aborts on our interrupting deny → parked', async () => {
      const db = createMemoryDb()
      const policy = policyOn(db)
      const events = await collect(runnerOn(policy, 'sdk-interrupt').run({ ...runOpts, sessionId: 'run-cc' }))

      const pending = policy.listApprovals('pending')
      expect(events.find(e => e.type === 'parked_for_approval')).toMatchObject({ approvalId: pending[0]!.id })
    })

    it('grok/ACP shape: reject_once ignores interrupt and the turn ends CLEANLY → parked', async () => {
      const db = createMemoryDb()
      const policy = policyOn(db)
      const events = await collect(runnerOn(policy, 'reject-once').run({ ...runOpts, sessionId: 'run-grok' }))

      const pending = policy.listApprovals('pending')
      expect(events.find(e => e.type === 'parked_for_approval')).toMatchObject({ approvalId: pending[0]!.id })
      // The provider produced an answer after the in-session deny, but the run
      // still parks: the blocked action is what needs a human.
      expect(events.some(e => e.type === 'done')).toBe(false)
    })

    it('THE I3 CASE — an unrelated crash after a reject_once FAILS the run (not parked) and preserves the error', async () => {
      const db = createMemoryDb()
      convTables(db)
      ensureRunSupervisionSchema(db)
      const policy = policyOn(db)
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
        VALUES ('c1', 'C', 'waiting', 'autonomous', 'agent-1', 'do it', ${now}, ${now})`)
      const supervisor = createRunSupervisor({ db })
      const warn = vi.fn()

      // Driven through runConversation so the run row's failure is REAL: the
      // error has to survive onto agent_sessions, not just be rethrown.
      const result = await runConversation('c1', {
        db,
        agentRunner: runnerOn(policy, 'network-crash', warn),
        agentRegistry: {
          get: () => ({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['t'], maxTurns: 9, model: 'm' }),
          isWithinBudget: () => true,
          addTokenUsage: vi.fn(),
        },
        toolRegistry: { toToolDefinitions: () => [{ name: 't' }] },
        supervisor,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        generateId: () => 'run-crash',
      } as any)

      expect(result).toMatchObject({ ran: false, reason: 'error' })
      expect(result.parked).toBeUndefined()

      const row = (db.all(sql`SELECT status, error FROM agent_sessions WHERE id = 'run-crash'`) as any[])[0]
      expect(row.status).toBe('failed')
      expect(row.error).toContain('ECONNRESET')
      expect((db.all(sql`SELECT status FROM conversations WHERE id = 'c1'`) as any[])[0].status).toBe('idle')

      // The approval the escalation queued is untouched — an operator can
      // still action it, and it carries the run for the lineage cap.
      const pending = policy.listApprovals('pending')
      expect(pending).toHaveLength(1)
      expect((db.all(sql`SELECT run_id FROM autonomy_approvals WHERE id = ${pending[0]!.id}`) as any[])[0].run_id).toBe('run-crash')
      expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('unrelated reason'))
    })
  })

  it('an INTERACTIVE run gets no sink at all (the CLI bridge keeps denying in-session)', async () => {
    let seen: unknown = 'unset'
    const gateway = {
      registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
      listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []), embed: vi.fn(),
      async complete() { throw new Error('streaming only') },
      async *stream(request: any): AsyncIterable<StreamEvent> {
        seen = request.metadata?.onEscalatedApproval
        yield { type: 'done', response: textResponse('ok') }
      },
    } as unknown as ModelGateway

    const runner = createAgentRunner({ gateway, toolExecutor: makeExecutor(), logger: silentLogger, ...makeStores() })
    await collect(runner.run({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [], maxTurns: 1, sessionId: 'run-int',
      metadata: { conversationId: 'c1', userId: 'u1', origin: 'interactive' },
    }))

    expect(seen).toBeUndefined()
  })
})

// ─── conversation-runner ──────────────────────

function convTables(database: any) {
  database.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle', mode TEXT NOT NULL DEFAULT 'simple',
    agent_id TEXT, project_id TEXT, goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
    team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT,
    orchestration TEXT, working_directories TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

function asyncIterable(events: any[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e } }
}

function convDeps(db: any, supervisor: any, events: any[]) {
  return {
    db,
    agentRunner: { run: vi.fn().mockReturnValue(asyncIterable(events)) },
    agentRegistry: {
      get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'sp', tools: ['t'], maxTurns: 9, model: 'm' }),
      isWithinBudget: vi.fn().mockReturnValue(true),
      addTokenUsage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([{ name: 't' }]) },
    supervisor,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    generateId: () => 'run-A',
  }
}

describe('F2 T5 — conversation-runner park handling', () => {
  function setup() {
    const db = createMemoryDb()
    convTables(db)
    ensureRunSupervisionSchema(db)
    createAutonomyTables(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do it', ${now}, ${now})`)
    const emitted: Array<{ event: string; payload: any }> = []
    const supervisor = createRunSupervisor({ db, emit: (event, payload) => emitted.push({ event, payload }) })
    return { db, supervisor, emitted }
  }

  const status = (db: any) => (db.all(sql`SELECT status FROM conversations WHERE id = 'conv-1'`) as any[])[0].status
  const runStatus = (db: any) => (db.all(sql`SELECT status, completed_at FROM agent_sessions WHERE id = 'run-A'`) as any[])[0]

  it('parks the run + the conversation and returns {ran, parked} without completing the run', async () => {
    const { db, supervisor, emitted } = setup()
    const deps = convDeps(db, supervisor, [
      { type: 'turn_complete', turn: 1, tokensUsed: 5 },
      { type: 'parked_for_approval', approvalId: 12, toolName: 'run_command' },
    ])

    const result = await runConversation('conv-1', deps as any)

    expect(result).toMatchObject({ ran: true, sessionId: 'run-A', parked: true })
    expect(status(db)).toBe('waiting_approval')
    const row = runStatus(db)
    expect(row.status).toBe('waiting_approval')
    expect(row.completed_at).toBeNull()
    expect(emitted.some(e => e.event === 'eyas.agent.run.waiting_approval' && e.payload.runId === 'run-A')).toBe(true)
  })

  it('a normal run still completes and resets the conversation to idle', async () => {
    const { db, supervisor } = setup()
    const deps = convDeps(db, supervisor, [{ type: 'turn_complete', turn: 1, tokensUsed: 5 }])

    const result = await runConversation('conv-1', deps as any)

    expect(result.parked).toBeUndefined()
    expect(status(db)).toBe('idle')
    expect(runStatus(db).status).toBe('completed')
  })

  it('re-park cap: the 5th approval on one run lineage fails the run as approval_loop instead of parking', async () => {
    const { db, supervisor } = setup()
    // Lineage: run-old ← run-A (the run about to park). Four approvals belong
    // to the ancestor; the fifth is the one this run enqueued before parking.
    db.run(sql`INSERT INTO agent_sessions (id, conversation_id, agent_id, status, started_at) VALUES ('run-old', 'conv-1', 'agent-1', 'failed', '2026-01-01T00:00:00Z')`)
    const policy = createAutonomyPolicy(db)
    const lineage = ['run-old', 'run-old', 'run-old', 'run-old', 'run-A']
    lineage.forEach((runId, i) => {
      policy.createApproval({ category: 'file_write', toolName: `t${i}`, conversationId: 'conv-1', argHash: `h${i}`, runId })
    })
    const deps = convDeps(db, supervisor, [{ type: 'parked_for_approval', approvalId: 99, toolName: 'run_command' }])

    const result = await runConversation('conv-1', deps as any, { parentRunId: 'run-old' })

    expect(result.parked).toBeUndefined()
    const row = (db.all(sql`SELECT status, error, error_kind FROM agent_sessions WHERE id = 'run-A'`) as any[])[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe('approval_loop')
    expect(row.error_kind).toBe('approval_loop')
    expect(status(db)).toBe('idle')
  })

  // The board's stage automation is the one thing that could undo a park: it
  // arms cards for autonomous pickup, and a re-armed card would be re-run
  // while its predecessor still waits on the operator. UNARMABLE (T2) covers
  // the status — this pins the pairing at the level where it actually matters.
  it('a parked conversation is NOT re-armed by the board stage automation', async () => {
    const { db, supervisor } = setup()
    const deps = convDeps(db, supervisor, [{ type: 'parked_for_approval', approvalId: 3, toolName: 'run_command' }])
    await runConversation('conv-1', deps as any)
    expect(status(db)).toBe('waiting_approval')

    const armed: unknown[] = []
    const automation = createStageAutomation({
      stages: { get: () => ({ id: 'stage-1', botListen: true, autoAssigneeId: 'agent-1' }) } as any,
      projects: { get: () => null } as any,
      conversations: {
        get: () => ({ ...(db.all(sql`SELECT * FROM conversations WHERE id = 'conv-1'`) as any[])[0], mode: 'autonomous', agentId: 'agent-1', goalDescription: 'do it', projectId: null }),
        update: (_id: string, patch: any) => { armed.push(patch) },
      } as any,
      bus: { emit: () => {} } as any,
      logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as any,
    })

    await automation.handleStageChanged({ conversationId: 'conv-1', fromStageId: null, toStageId: 'stage-1' })

    expect(armed).toEqual([])
    expect(status(db)).toBe('waiting_approval')
  })

  // park() refuses a row that is no longer 'running'. Claiming the park anyway
  // would leave the card in 'waiting_approval' forever, waiting on a run no
  // resume can wake — so a refused park closes the run normally instead.
  it('a REFUSED park does not strand the conversation in waiting_approval', async () => {
    const { db, supervisor } = setup()
    const refusing = { ...supervisor, park: vi.fn(() => false) }
    const deps = convDeps(db, refusing, [{ type: 'parked_for_approval', approvalId: 8, toolName: 'run_command' }])

    const result = await runConversation('conv-1', deps as any)

    expect(refusing.park).toHaveBeenCalledWith('run-A', 8)
    expect(result.parked).toBeUndefined()
    expect(status(db)).toBe('idle')
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not be parked'))
  })

  it('under the cap the run still parks', async () => {
    const { db, supervisor } = setup()
    const policy = createAutonomyPolicy(db)
    policy.createApproval({ category: 'file_write', toolName: 't', conversationId: 'conv-1', argHash: 'h', runId: 'run-A' })
    const deps = convDeps(db, supervisor, [{ type: 'parked_for_approval', approvalId: 5, toolName: 'run_command' }])

    const result = await runConversation('conv-1', deps as any)

    expect(result.parked).toBe(true)
    expect(status(db)).toBe('waiting_approval')
  })
})

// ─── delegation / pipeline shapes ─────────────

describe('F2 T5 — executeAgent-shaped park semantics', () => {
  it('delegate() reports a parked delegation with its approval id instead of fabricating a result', async () => {
    const service = createDelegationService({
      maxDepth: 5,
      getAncestry: () => [],
      createChildConversation: () => 'child-1',
      runTransaction: <T,>(fn: () => T) => fn(),
      executeAgent: async () => ({ text: '', status: 'parked' as const, sessionId: 's1', approvalId: 42 }),
    })

    const out = await service.delegate('parent-1', 'agent-2', 'do it')

    expect(out.conversationId).toBe('child-1')
    expect(out.result).toContain('parked')
    expect(out.result).toContain('#42')
  })

  it('the ticket-to-code port THROWS on a parked run, distinguishably from failed/max_turns', async () => {
    const port = createAgentRunnerPort({
      executeAgent: async () => ({ text: 'partial', status: 'parked' as const, sessionId: 's1', approvalId: 7 }),
    })

    await expect(port.run({ agentId: 'a1', instructions: 'go' } as any)).rejects.toThrow(/approval/i)
  })
})
