// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type {
  ModelGateway,
  ModelResponse,
  StreamEvent,
  ToolDefinition,
  ContentBlock,
} from '@modules/model/types'

// ─── Helpers (same style as agent-runner.test.ts) ──────────────────

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}

function makeTextResponse(text: string, usage = { inputTokens: 10, outputTokens: 5 }): ModelResponse {
  return {
    id: 'resp-text',
    provider: 'mock',
    model: 'mock-model',
    content: [{ type: 'text', text }],
    stopReason: 'end',
    usage,
  }
}

function makeToolUseResponse(
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[],
  usage = { inputTokens: 10, outputTokens: 5 },
): ModelResponse {
  const content: ContentBlock[] = toolCalls.map(tc => ({
    type: 'tool_use' as const,
    id: tc.id,
    name: tc.name,
    input: tc.input,
  }))
  return {
    id: 'resp-tool',
    provider: 'mock',
    model: 'mock-model',
    content,
    stopReason: 'tool_use',
    usage,
  }
}

function createMockGateway(responses: ModelResponse[]): ModelGateway {
  let callIndex = 0
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn(),
    listProviders: vi.fn(() => []),
    listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[callIndex++] ?? makeTextResponse('fallback')),
    async *stream() {
      const resp = responses[callIndex++] ?? makeTextResponse('fallback')
      yield { type: 'done', response: resp } as StreamEvent
    },
  } as unknown as ModelGateway
}

function createMockToolExecutor() {
  const executeFn = vi.fn(async (_name: string, _input: unknown, _ctx: unknown) => ({
    success: true,
    output: { result: 'ok' },
    durationMs: 12,
  }))
  return { execute: executeFn }
}

async function collectEvents(gen: AsyncGenerator<any>) {
  const events: any[] = []
  for await (const e of gen) events.push(e)
  return events
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentRunner — securityGateMode (S2)', () => {
  let gateway: ModelGateway
  let toolExecutor: ReturnType<typeof createMockToolExecutor>

  beforeEach(() => {
    toolExecutor = createMockToolExecutor()
  })

  describe('enforcing mode (default)', () => {
    it('blocks tool call when judge throws — emits security_gate_error with mode=enforcing', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => {
          throw new Error('Judge network timeout')
        }),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: { q: 'x' } },
      ])
      const finalResponse = makeTextResponse('Blocked')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          // securityGateMode defaults to 'enforcing'
        }),
      )

      // Tool executor must NOT run
      expect(toolExecutor.execute).not.toHaveBeenCalled()

      // security_gate_error event must be emitted with mode=enforcing
      const gateErr = events.find(e => e.type === 'security_gate_error')
      expect(gateErr).toBeDefined()
      expect(gateErr.mode).toBe('enforcing')
      expect(gateErr.toolName).toBe('search')
      expect(gateErr.reason).toContain('Judge network timeout')

      // Error tool_result pushed
      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('Security gate unavailable')
    })

    it('blocks tool call when judge returns decision=judge_error', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'judge_error',
          reason: 'Judge returned malformed response',
          riskTier: 'yellow',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-2', name: 'search', input: { q: 'y' } },
      ])
      const finalResponse = makeTextResponse('Blocked')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          securityGateMode: 'enforcing',
        }),
      )

      expect(toolExecutor.execute).not.toHaveBeenCalled()

      const gateErr = events.find(e => e.type === 'security_gate_error')
      expect(gateErr).toBeDefined()
      expect(gateErr.mode).toBe('enforcing')
      expect(gateErr.reason).toContain('malformed')

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('Security gate unavailable')
    })

    it('deny decision still blocks in enforcing mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'deny',
          reason: 'Dangerous command',
          riskTier: 'red',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-d', name: 'run_command', input: { command: 'rm -rf /' } },
      ])
      const finalResponse = makeTextResponse('Denied')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Delete' }],
          tools: [makeToolDef('run_command')],
          maxTurns: 5,
          securityGateMode: 'enforcing',
        }),
      )

      expect(toolExecutor.execute).not.toHaveBeenCalled()

      // No security_gate_error (this is a clean deny, not a judge malfunction)
      expect(events.find(e => e.type === 'security_gate_error')).toBeUndefined()

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('Security gate denied')
    })

    it('allow decision lets tool execute in enforcing mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'allow',
          reason: 'Safe',
          riskTier: 'green',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-a', name: 'search', input: { q: 'safe' } },
      ])
      const finalResponse = makeTextResponse('Done')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          securityGateMode: 'enforcing',
        }),
      )

      expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
      expect(events.find(e => e.type === 'security_gate_error')).toBeUndefined()

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(false)
    })
  })

  describe('permissive mode', () => {
    it('allows tool to execute when judge throws — emits warn event with mode=permissive', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => {
          throw new Error('Judge unavailable')
        }),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-p1', name: 'search', input: { q: 'p' } },
      ])
      const finalResponse = makeTextResponse('OK')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          securityGateMode: 'permissive',
        }),
      )

      // Tool executor SHOULD run (permissive = fail-open with warning)
      expect(toolExecutor.execute).toHaveBeenCalledTimes(1)

      // Warn event emitted
      const gateErr = events.find(e => e.type === 'security_gate_error')
      expect(gateErr).toBeDefined()
      expect(gateErr.mode).toBe('permissive')
      expect(gateErr.reason).toContain('Judge unavailable')

      // tool_result should reflect successful execution (not a security-block error)
      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(false)
    })

    it('allows tool to execute when judge returns judge_error', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'judge_error',
          reason: 'LLM returned no content',
          riskTier: 'green',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-p2', name: 'search', input: { q: 'p' } },
      ])
      const finalResponse = makeTextResponse('OK')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          securityGateMode: 'permissive',
        }),
      )

      expect(toolExecutor.execute).toHaveBeenCalledTimes(1)

      const gateErr = events.find(e => e.type === 'security_gate_error')
      expect(gateErr).toBeDefined()
      expect(gateErr.mode).toBe('permissive')

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(false)
    })

    it('deny decision still blocks in permissive mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'deny',
          reason: 'Explicit deny',
          riskTier: 'red',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-pd', name: 'run_command', input: { command: 'sudo reboot' } },
      ])
      const finalResponse = makeTextResponse('Denied')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Reboot' }],
          tools: [makeToolDef('run_command')],
          maxTurns: 5,
          securityGateMode: 'permissive',
        }),
      )

      expect(toolExecutor.execute).not.toHaveBeenCalled()
      expect(events.find(e => e.type === 'security_gate_error')).toBeUndefined()

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('Security gate denied')
    })

    it('allow decision lets tool execute in permissive mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'allow',
          reason: 'Safe',
          riskTier: 'green',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-pa', name: 'search', input: { q: 'ok' } },
      ])
      const finalResponse = makeTextResponse('Done')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          securityGateMode: 'permissive',
        }),
      )

      expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
      expect(events.find(e => e.type === 'security_gate_error')).toBeUndefined()
    })
  })

  describe('unknown verdict (F0) — fail-closed, not just deny/escalate/judge_error/allow', () => {
    it('unrecognized decision string blocks the tool call in enforcing mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'maybe' as any,
          reason: '?',
          riskTier: 'green',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-u1', name: 'search', input: { q: 'x' } },
      ])
      const finalResponse = makeTextResponse('Blocked')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'Search' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          securityGateMode: 'enforcing',
        }),
      )

      expect(toolExecutor.execute).not.toHaveBeenCalled()

      // Not a judge malfunction (that's security_gate_error) — a clean
      // fail-closed block on an unrecognized verdict, like a deny.
      expect(events.find(e => e.type === 'security_gate_error')).toBeUndefined()

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toMatch(/unknown gate verdict/i)
    })
  })

  describe('escalate verdict (F0) — routes into the approval flow', () => {
    it('escalate + no reviewer configured → tool blocked with approval-required denial', async () => {
      const securityGate = { validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'No AI provider configured for the security judge — human approval required', riskTier: 'red' })) }
      gateway = createMockGateway([makeToolUseResponse([{ id: 'tu-e1', name: 'run_command', input: { command: 'ls' } }]), makeTextResponse('done')])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })
      const events = await collectEvents(runner.run({ messages: [{ role: 'user', content: 'x' }], tools: [makeToolDef('run_command')], maxTurns: 5 }))
      expect(toolExecutor.execute).not.toHaveBeenCalled()
      expect(events.find(e => e.type === 'tool_approval_required')).toBeDefined()
    })
    it('escalate + reviewer approves → tool executes', async () => {
      const securityGate = { validateToolCall: vi.fn(async () => ({ decision: 'escalate', reason: 'judge unavailable', riskTier: 'yellow' })) }
      gateway = createMockGateway([makeToolUseResponse([{ id: 'tu-e2', name: 'save_memory', input: {} }]), makeTextResponse('done')])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate, onApprovalRequired: vi.fn(async () => true) })
      await collectEvents(runner.run({ messages: [{ role: 'user', content: 'x' }], tools: [makeToolDef('save_memory')], maxTurns: 5 }))
      expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    })
  })
})
