// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry'
import {
  createToolExecutor,
  type AuthorizationDeps,
  type ExecutorSecurityGate,
} from '@modules/tools/tool-executor'
import type { ToolAbility, ToolActor, ToolContext, ToolImplementation } from '@modules/tools/types'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { ensureToolExecutionsTable, recordToolExecution } from '@modules/tools/execution-log'

// ─── Helpers ────────────────────────────────────────────────────────

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
}

function makeTool(overrides: Partial<ToolImplementation> = {}): ToolImplementation {
  return {
    name: 'echo',
    description: 'Echo the input back',
    category: 'custom',
    riskTier: 'green',
    inputSchema: {},
    execute: vi.fn(async (input: Record<string, unknown>) => ({ echoed: input })),
    ...overrides,
  }
}

const allowAll: ToolAbility = { can: () => true }
const denyAll: ToolAbility = { can: () => false }

const agentActor: ToolActor = { kind: 'agent', role: 'agent', ability: allowAll }

function ctxWith(actor?: ToolActor, extra: Partial<ToolContext> = {}): ToolContext {
  return {
    conversationId: 'c1',
    userId: 'u1',
    agentId: 'a1',
    parentGoal: 'g1',
    logger: silentLogger,
    ...(actor ? { actor } : {}),
    ...extra,
  } as ToolContext
}

type GateDecision = 'allow' | 'deny' | 'escalate' | 'judge_error'

function gateAllow(
  decision: GateDecision = 'allow',
  reason = 'safe',
  riskTier: 'green' | 'yellow' | 'red' = 'green',
) {
  return {
    validateToolCall: vi.fn(async () => ({ decision, reason, riskTier })),
  } as unknown as ExecutorSecurityGate & { validateToolCall: ReturnType<typeof vi.fn> }
}

function authWith(
  gate: ExecutorSecurityGate | undefined,
  getAbilityForRole: (role: string) => ToolAbility | undefined = () => allowAll,
): AuthorizationDeps {
  return { getSecurityGate: () => gate, getAbilityForRole }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Tool executor — authorization choke point (F0 R2)', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  describe('fail-closed wiring', () => {
    it('(1) denies every call when authorization is omitted — the tool never runs', async () => {
      const tool = makeTool()
      registry.register(tool)
      const exec = createToolExecutor(registry)

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/not wired/i)
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it("(2) authorization: 'disabled' bypasses the choke point entirely", async () => {
      const tool = makeTool()
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: 'disabled' })

      const r = await exec.execute('echo', { a: 1 }, ctxWith())

      expect(r.success).toBe(true)
      expect(tool.execute).toHaveBeenCalledTimes(1)
    })
  })

  describe('step 1 — CASL actor identity', () => {
    it('(3) denies when the context carries no actor, and never consults the gate', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith())

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/no actor identity/i)
      expect(gate.validateToolCall).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it("(4) denies when the actor's ability refuses execute Tool", async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute(
        'echo',
        { a: 1 },
        ctxWith({ kind: 'user', role: 'guest', ability: denyAll }),
      )

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/guest/)
      expect(gate.validateToolCall).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(5) falls back to the role-derived ability when the actor carries none', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const getAbilityForRole = vi.fn((role: string) => (role === 'agent' ? allowAll : undefined))
      const exec = createToolExecutor(registry, { authorization: authWith(gate, getAbilityForRole) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith({ kind: 'agent', role: 'agent' }))

      expect(getAbilityForRole).toHaveBeenCalledWith('agent')
      expect(r.success).toBe(true)
      expect(tool.execute).toHaveBeenCalledTimes(1)
    })
  })

  describe('step 3 — security gate', () => {
    it('(6) denies on a gate deny verdict and forwards the call context to the gate', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('deny', 'blocklisted command', 'red')
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toContain('blocklisted command')
      expect(gate.validateToolCall).toHaveBeenCalledWith('echo', { a: 1 }, {
        conversationId: 'c1',
        agentId: 'a1',
        parentGoal: 'g1',
      })
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(7) denies when the security-gate module is not registered', async () => {
      const tool = makeTool()
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: authWith(undefined) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/security gate unavailable/i)
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(8a) denies on a judge_error verdict', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('judge_error', 'judge returned malformed JSON', 'yellow')
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/judge error/i)
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(8b) denies — without leaking the exception — when the gate throws', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = {
        validateToolCall: vi.fn(async () => {
          throw new Error('judge network timeout')
        }),
      } as unknown as ExecutorSecurityGate
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toContain('judge network timeout')
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(8c) denies on an unrecognized decision string — fail-closed, not just deny/escalate/judge_error/allow', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = {
        validateToolCall: vi.fn(async () => ({ decision: 'maybe' as any, reason: '?', riskTier: 'green' })),
      } as unknown as ExecutorSecurityGate
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/unknown gate verdict/i)
      expect(tool.execute).not.toHaveBeenCalled()
    })
  })

  describe('step 2 — securityPipelineHandled trust marker', () => {
    it('(9a) skips the gate when an in-process pipeline already ran it', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('deny', 'would have denied', 'red')
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute(
        'echo',
        { a: 1 },
        ctxWith(agentActor, { securityPipelineHandled: true }),
      )

      expect(r.success).toBe(true)
      expect(gate.validateToolCall).not.toHaveBeenCalled()
      expect(tool.execute).toHaveBeenCalledTimes(1)
    })

    it('(9b) still enforces CASL even when the marker is set', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute(
        'echo',
        { a: 1 },
        ctxWith({ kind: 'external', role: 'guest', ability: denyAll }, { securityPipelineHandled: true }),
      )

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(tool.execute).not.toHaveBeenCalled()
    })
  })

  describe("step 1b — the run's toolset (H9 ToolContext.allowedTools)", () => {
    it('(+) a name inside allowedTools executes', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor, { allowedTools: new Set(['echo', 'other']) }))

      expect(r.success).toBe(true)
      expect(tool.execute).toHaveBeenCalledTimes(1)
    })

    it('(−) a name outside allowedTools is denied even with securityPipelineHandled, before the gate', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const logExecution = vi.fn()
      const exec = createToolExecutor(registry, { authorization: authWith(gate), logExecution })

      const r = await exec.execute(
        'echo',
        { a: 1 },
        ctxWith(agentActor, { allowedTools: new Set(['other']), securityPipelineHandled: true }),
      )

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toBe("Tool call denied: 'echo' is not in this agent's toolset")
      expect(tool.execute).not.toHaveBeenCalled()
      expect(gate.validateToolCall).not.toHaveBeenCalled()
      // The refusal is audited like every other denial.
      expect(logExecution).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'echo', success: false }))
    })

    it('(−) an empty toolset refuses everything', async () => {
      const tool = makeTool()
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: authWith(gateAllow()) })

      const r = await exec.execute('echo', {}, ctxWith(agentActor, { allowedTools: new Set() }))

      expect(r.errorCode).toBe('DENIED')
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('no allowedTools → unchanged behaviour (gate decides)', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow()
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(true)
      expect(gate.validateToolCall).toHaveBeenCalledTimes(1)
    })
  })

  describe('step 4 — autonomy ladder for approval-requiring calls', () => {
    it('(10) denies an approval-requiring tool when no autonomy policy is available', async () => {
      const tool = makeTool({ requiresApproval: true })
      registry.register(tool)
      // Green gate-allow skips requiresApproval (read-path). Approval is
      // only owed when the gate did not already allow the call as green.
      const gate = gateAllow('escalate', 'yellow tier', 'yellow')
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toMatch(/approval required/i)
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(11) runs an approval-requiring tool when its category is at L3 and unlocked', async () => {
      const tool = makeTool({ requiresApproval: true })
      registry.register(tool)
      const gate = gateAllow('escalate', 'yellow tier', 'yellow')
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'kanban_archive_done'),
        resolve: vi.fn(() => ({ level: 3, locked: false })),
        createApproval: vi.fn(),
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(true)
      expect(tool.execute).toHaveBeenCalledTimes(1)
      expect((gate as any).autonomyPolicy.createApproval).not.toHaveBeenCalled()
    })

    it('(12) enqueues an approval and refuses the call as waiting on a human when the category sits below L3', async () => {
      const tool = makeTool({ requiresApproval: true })
      registry.register(tool)
      const gate = gateAllow('allow', 'looks fine', 'yellow')
      const createApproval = vi.fn()
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => ({ level: 1, locked: true })),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      // G3: waiting on a human is APPROVAL_REQUIRED, not DENIED; a queue
      // that returns no row id leaves approvalId absent.
      expect(r.errorCode).toBe('APPROVAL_REQUIRED')
      expect(r).not.toHaveProperty('approvalId')
      expect(r.error).toContain('data_delete')
      expect(createApproval).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'data_delete', toolName: 'echo', agentId: 'a1', conversationId: 'c1' }),
      )
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(12b) denies instead of throwing when the autonomy policy itself blows up', async () => {
      // `resolve` hits the DB; the executor's contract is that execute() always
      // returns a structured result, so a throwing policy must not escape.
      const tool = makeTool({ requiresApproval: true })
      registry.register(tool)
      const gate = gateAllow('escalate', 'yellow tier', 'yellow')
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => {
          throw new Error('autonomy table is gone')
        }),
        createApproval: vi.fn(),
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('DENIED')
      expect(r.error).toContain('autonomy table is gone')
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(13) treats a gate escalate verdict on a plain tool like requiresApproval', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'unclassified tool', 'red')
      const createApproval = vi.fn()
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'shell_exec'),
        resolve: vi.fn(() => ({ level: 2, locked: false })),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('APPROVAL_REQUIRED')
      expect(r.error).toMatch(/approval required/i)
      expect(createApproval).toHaveBeenCalledTimes(1)
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(13b) G3: an escalation returns APPROVAL_REQUIRED with the queued approval id, stamped with the run', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'unclassified tool', 'red')
      const createApproval = vi.fn(() => 77)
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'shell_exec'),
        resolve: vi.fn(() => ({ level: 1, locked: false })),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor, { runId: 'run-9' }))

      expect(r).toMatchObject({ success: false, errorCode: 'APPROVAL_REQUIRED', approvalId: 77 })
      expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-9', conversationId: 'c1' }))
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('(13c) G3: a gate deny is still DENIED and queues nothing (negative)', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('deny', 'blocked', 'red')
      const createApproval = vi.fn(() => 78)
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'shell_exec'),
        resolve: vi.fn(() => ({ level: 1, locked: false })),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.errorCode).toBe('DENIED')
      expect(r).not.toHaveProperty('approvalId')
      expect(createApproval).not.toHaveBeenCalled()
    })

    it('(13d) G3: an approval nobody could ever grant (no conversation scope) stays DENIED (negative)', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'unclassified tool', 'red')
      const createApproval = vi.fn(() => 79)
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'shell_exec'),
        resolve: vi.fn(() => ({ level: 1, locked: false })),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor, { conversationId: '' }))

      expect(r.errorCode).toBe('DENIED')
      expect(createApproval).not.toHaveBeenCalled()
    })
  })

  describe('F2 T3 — approval subsystem upgrade (enqueue-everywhere + grant ledger)', () => {
    it('enqueues a row for an UNCATEGORIZED escalation (previously: denied with no row at all)', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'unclassified tool', 'red')
      const createApproval = vi.fn()
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => null), // uncategorized
        resolve: vi.fn(),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(createApproval).toHaveBeenCalledWith(expect.objectContaining({
        category: 'uncategorized',
        toolName: 'echo',
        conversationId: 'c1',
        agentId: 'a1',
        inputJson: JSON.stringify({ a: 1 }),
        argHash: expect.any(String),
      }))
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it('a granted call (consumeGrant returns granted:true) proceeds as ALLOWED without creating a new approval row', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'needs review', 'yellow')
      const createApproval = vi.fn()
      const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 7 }))
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => ({ level: 1, locked: true })),
        createApproval,
        consumeGrant,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(true)
      expect(tool.execute).toHaveBeenCalledTimes(1)
      expect(consumeGrant).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1', toolName: 'echo', argHash: expect.any(String) }))
      expect(createApproval).not.toHaveBeenCalled()
    })

    it('a denied grant (granted:false) falls through to the normal enqueue+deny flow', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'needs review', 'yellow')
      const createApproval = vi.fn()
      const consumeGrant = vi.fn(() => ({ granted: false }))
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => ({ level: 1, locked: true })),
        createApproval,
        consumeGrant,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(tool.execute).not.toHaveBeenCalled()
      expect(createApproval).toHaveBeenCalledTimes(1)
    })

    it('a THROWING consumeGrant fails closed to the normal enqueue+deny flow (never silently allows)', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'needs review', 'yellow')
      const createApproval = vi.fn()
      const consumeGrant = vi.fn(() => { throw new Error('approvals table locked') })
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => ({ level: 1, locked: true })),
        createApproval,
        consumeGrant,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(tool.execute).not.toHaveBeenCalled()
      expect(createApproval).toHaveBeenCalledTimes(1)
    })

    it('I3: with no conversation_id in scope, skips createApproval entirely (a dead row could never be granted) and denies with an explicit message', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('escalate', 'needs review', 'yellow')
      const createApproval = vi.fn()
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => ({ level: 1, locked: true })),
        createApproval,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor, { conversationId: undefined as any }))

      expect(r.success).toBe(false)
      expect(r.error).toContain('cannot receive grants')
      expect(createApproval).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })

    it("SECURITY INVARIANT: a grant is never even consulted on a deterministic gate 'deny' — consumeGrant must not be called", async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('deny', 'sensitive path', 'red')
      const consumeGrant = vi.fn(() => ({ granted: true, approvalId: 1 }))
      ;(gate as any).autonomyPolicy = {
        categoryForTool: vi.fn(() => 'data_delete'),
        resolve: vi.fn(() => ({ level: 1, locked: true })),
        createApproval: vi.fn(),
        consumeGrant,
      }
      const exec = createToolExecutor(registry, { authorization: authWith(gate) })

      const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(r.success).toBe(false)
      expect(r.error).toContain('sensitive path')
      expect(consumeGrant).not.toHaveBeenCalled()
      expect(tool.execute).not.toHaveBeenCalled()
    })
  })

  describe('observability', () => {
    it('(14) a denied call is audit-logged and emits tools:executed with success:false', async () => {
      const tool = makeTool()
      registry.register(tool)
      const gate = gateAllow('deny', 'nope', 'red')
      const logExecution = vi.fn()
      const emit = vi.fn()
      const exec = createToolExecutor(registry, {
        authorization: authWith(gate),
        logExecution,
        bus: { emit },
      })

      await exec.execute('echo', { a: 1 }, ctxWith(agentActor))

      expect(logExecution).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'echo', success: false, conversationId: 'c1', agentId: 'a1' }),
      )
      expect(emit).toHaveBeenCalledWith(
        'tools:executed',
        expect.objectContaining({ toolName: 'echo', success: false }),
      )
    })
  })
})

// I2 — tool_executions.run_id ties a row to its supervised run, so a run's
// tool evidence is read by run, not guessed from conversation and time.
describe('tool_executions.run_id', () => {
  function setup() {
    const db = createMemoryDb()
    ensureToolExecutionsTable(db)
    const registry = createToolRegistry()
    registry.register(makeTool())
    const exec = createToolExecutor(registry, {
      authorization: authWith(gateAllow()),
      logExecution: (entry) => recordToolExecution(db, entry),
    })
    return { db, exec }
  }

  it('persists the context runId on the row', async () => {
    const { db, exec } = setup()
    await exec.execute('echo', { a: 1 }, ctxWith(agentActor, { runId: 'run-42', turnId: 'turn-1' }))
    const rows = db.all(sql`SELECT tool_name, conversation_id, run_id, success FROM tool_executions`)
    expect(rows).toEqual([{ tool_name: 'echo', conversation_id: 'c1', run_id: 'run-42', success: 1 }])
  })

  it('writes NULL, without throwing, when the call ran outside a run', async () => {
    const { db, exec } = setup()
    const r = await exec.execute('echo', { a: 1 }, ctxWith(agentActor))
    expect(r.success).toBe(true)
    const rows = db.all(sql`SELECT run_id FROM tool_executions`)
    expect(rows).toEqual([{ run_id: null }])
  })

  it('records the runId on a denied call too', async () => {
    const db = createMemoryDb()
    ensureToolExecutionsTable(db)
    const registry = createToolRegistry()
    registry.register(makeTool())
    const exec = createToolExecutor(registry, {
      authorization: authWith(gateAllow('deny', 'nope', 'red')),
      logExecution: (entry) => recordToolExecution(db, entry),
    })
    await exec.execute('echo', { a: 1 }, ctxWith(agentActor, { runId: 'run-denied' }))
    expect(db.all(sql`SELECT run_id, success FROM tool_executions`)).toEqual([{ run_id: 'run-denied', success: 0 }])
  })

  it('adds run_id to a table created before the column existed, keeping its rows', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE tool_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, agent_id TEXT, tool_name TEXT NOT NULL,
      input TEXT, output TEXT, error TEXT, success INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    db.run(sql`INSERT INTO tool_executions (tool_name, success, duration_ms) VALUES ('old', 1, 3)`)
    ensureToolExecutionsTable(db)
    ensureToolExecutionsTable(db) // idempotent
    expect(db.all(sql`SELECT tool_name, run_id FROM tool_executions`)).toEqual([{ tool_name: 'old', run_id: null }])
  })
})
