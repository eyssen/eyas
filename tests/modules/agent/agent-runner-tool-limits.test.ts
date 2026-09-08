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

// ─── Helpers ────────────────────────────────────────────────────────

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
    output: { ok: true },
    durationMs: 5,
  }))
  return { execute: executeFn }
}

async function collectEvents(gen: AsyncGenerator<any>) {
  const events: any[] = []
  for await (const e of gen) events.push(e)
  return events
}

function manyToolCalls(n: number, prefix = 'tu'): { id: string; name: string; input: Record<string, unknown> }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: 'search',
    input: { i: i + 1 },
  }))
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentRunner — tool call limits (S9)', () => {
  let gateway: ModelGateway
  let toolExecutor: ReturnType<typeof createMockToolExecutor>

  beforeEach(() => {
    toolExecutor = createMockToolExecutor()
  })

  describe('maxToolCallsPerTurn', () => {
    it('truncates to N tool calls when model returns 15 and limit is 10', async () => {
      // Turn 1: 15 tool_use blocks → runner executes 10, emits truncated event
      const turn1 = makeToolUseResponse(manyToolCalls(15))
      // Turn 2: final text response so the loop terminates cleanly
      const turn2 = makeTextResponse('done')

      gateway = createMockGateway([turn1, turn2])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'run many' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          maxToolCallsPerTurn: 10,
        }),
      )

      // Only 10 executions
      expect(toolExecutor.execute).toHaveBeenCalledTimes(10)

      // Truncated event emitted with correct counts
      const truncated = events.find(e => e.type === 'tool_calls_per_turn_truncated')
      expect(truncated).toBeDefined()
      expect(truncated.requested).toBe(15)
      expect(truncated.executed).toBe(10)
      expect(truncated.turn).toBe(1)

      // 10 tool_result events (one per executed tool)
      const toolResults = events.filter(e => e.type === 'tool_result')
      expect(toolResults).toHaveLength(10)
    })

    it('does not emit truncated event when count is within limit', async () => {
      const turn1 = makeToolUseResponse(manyToolCalls(3))
      const turn2 = makeTextResponse('done')

      gateway = createMockGateway([turn1, turn2])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'run few' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          maxToolCallsPerTurn: 10,
        }),
      )

      expect(toolExecutor.execute).toHaveBeenCalledTimes(3)
      expect(events.find(e => e.type === 'tool_calls_per_turn_truncated')).toBeUndefined()
    })
  })

  describe('maxTotalToolCalls', () => {
    it('emits tool_budget_exhausted and ends loop when cumulative limit hit across turns', async () => {
      // 3 turns of 2 tool_use blocks each = 6 calls; limit = 5
      const turn1 = makeToolUseResponse(manyToolCalls(2, 'a'))
      const turn2 = makeToolUseResponse(manyToolCalls(2, 'b'))
      const turn3 = makeToolUseResponse(manyToolCalls(2, 'c'))
      const turn4 = makeTextResponse('should not reach')

      gateway = createMockGateway([turn1, turn2, turn3, turn4])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'exhaust' }],
          tools: [makeToolDef('search')],
          maxTurns: 10,
          maxTotalToolCalls: 5,
        }),
      )

      // First 5 calls run through toolExecutor, 6th short-circuits with error
      expect(toolExecutor.execute).toHaveBeenCalledTimes(5)

      // tool_budget_exhausted event emitted with correct values
      const exhausted = events.find(e => e.type === 'tool_budget_exhausted')
      expect(exhausted).toBeDefined()
      expect(exhausted.limit).toBe(5)
      // totalCalls counter is incremented before the limit-check path stops counting,
      // so it should be exactly the limit (5) at the time of the last successful execution.
      expect(exhausted.totalCalls).toBe(5)

      // The 6th tool_use block should have produced an error tool_result
      const toolResults = events.filter(e => e.type === 'tool_result')
      const budgetErrorResults = toolResults.filter(
        r => r.isError && String(r.content).includes('Tool budget exhausted'),
      )
      expect(budgetErrorResults.length).toBeGreaterThanOrEqual(1)

      // Loop must terminate — turn4's text response must NOT arrive
      // (if the loop had continued, we'd see a 4th turn_complete with text response)
      const turns = events.filter(e => e.type === 'turn_complete')
      expect(turns.length).toBeLessThanOrEqual(3)
    })

    it('does not emit tool_budget_exhausted when under the limit', async () => {
      const turn1 = makeToolUseResponse(manyToolCalls(2))
      const turn2 = makeTextResponse('ok')

      gateway = createMockGateway([turn1, turn2])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'few' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          maxTotalToolCalls: 100,
        }),
      )

      expect(events.find(e => e.type === 'tool_budget_exhausted')).toBeUndefined()
    })
  })

  describe('default limits', () => {
    it('applies default maxToolCallsPerTurn=10 when option not set', async () => {
      const turn1 = makeToolUseResponse(manyToolCalls(15))
      const turn2 = makeTextResponse('done')

      gateway = createMockGateway([turn1, turn2])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'run many' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          // No maxToolCallsPerTurn — should default to 10
        }),
      )

      expect(toolExecutor.execute).toHaveBeenCalledTimes(10)
      const truncated = events.find(e => e.type === 'tool_calls_per_turn_truncated')
      expect(truncated).toBeDefined()
      expect(truncated.executed).toBe(10)
    })

    it('applies default maxTotalToolCalls=200 when option not set (no early exhaust for small flow)', async () => {
      const turn1 = makeToolUseResponse(manyToolCalls(2))
      const turn2 = makeTextResponse('done')

      gateway = createMockGateway([turn1, turn2])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'normal' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          // No maxTotalToolCalls — should default to 200
        }),
      )

      expect(events.find(e => e.type === 'tool_budget_exhausted')).toBeUndefined()
      expect(toolExecutor.execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('valid small flow', () => {
    it('runs 1 turn with 2 tool calls normally', async () => {
      const turn1 = makeToolUseResponse([
        { id: 'a', name: 'search', input: { q: '1' } },
        { id: 'b', name: 'search', input: { q: '2' } },
      ])
      const turn2 = makeTextResponse('done')

      gateway = createMockGateway([turn1, turn2])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(
        runner.run({
          messages: [{ role: 'user', content: 'small' }],
          tools: [makeToolDef('search')],
          maxTurns: 5,
          maxToolCallsPerTurn: 10,
          maxTotalToolCalls: 50,
        }),
      )

      expect(toolExecutor.execute).toHaveBeenCalledTimes(2)
      expect(events.find(e => e.type === 'tool_calls_per_turn_truncated')).toBeUndefined()
      expect(events.find(e => e.type === 'tool_budget_exhausted')).toBeUndefined()

      const turns = events.filter(e => e.type === 'turn_complete')
      expect(turns).toHaveLength(2)
      expect(events.find(e => e.type === 'done')).toBeDefined()
    })
  })
})
