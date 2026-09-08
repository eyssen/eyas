import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition, ContentBlock, ToolUseBlock } from '@modules/model/types'

// ─── Helpers ─────────────────────────────────

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}

function makeTextResponse(text: string, usage = { inputTokens: 10, outputTokens: 5 }): ModelResponse {
  return {
    id: 'resp-1',
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
  // Explicit return type so later .mockResolvedValueOnce() calls can override
  // with failure-shape payloads ({ success: false, error: '...' }) without
  // being rejected by TypeScript's inferred literal type.
  type MockExecResult = {
    success: boolean
    output?: { result: string }
    error?: string
    durationMs: number
  }
  const executeFn = vi.fn<(name: string, input: unknown, ctx: unknown) => Promise<MockExecResult>>(
    async () => ({
      success: true,
      output: { result: 'ok' },
      durationMs: 42,
    }),
  )
  return { execute: executeFn }
}

async function collectEvents(gen: AsyncGenerator<any>) {
  const events: any[] = []
  for await (const e of gen) events.push(e)
  return events
}

// ─── Tests ───────────────────────────────────

describe('AgentRunner', () => {
  let gateway: ModelGateway
  let toolExecutor: ReturnType<typeof createMockToolExecutor>

  beforeEach(() => {
    toolExecutor = createMockToolExecutor()
  })

  describe('simple text response (no tool use)', () => {
    it('yields done + turn_complete events and stops', async () => {
      gateway = createMockGateway([makeTextResponse('Hello!')])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [makeToolDef('search')],
        maxTurns: 5,
      }))

      const doneEvent = events.find(e => e.type === 'done')
      expect(doneEvent).toBeDefined()
      expect(doneEvent.response.content[0].text).toBe('Hello!')

      const turnComplete = events.find(e => e.type === 'turn_complete')
      expect(turnComplete).toBeDefined()
      expect(turnComplete.turn).toBe(1)
    })
  })

  describe('tool-use loop', () => {
    it('executes tool and feeds result back to model', async () => {
      const toolResponse = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: { query: 'test' } },
      ])
      const finalResponse = makeTextResponse('Here is the answer')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Find something' }],
        tools: [makeToolDef('search')],
        maxTurns: 5,
      }))

      // Tool executor should be called with the right arguments
      expect(toolExecutor.execute).toHaveBeenCalledWith('search', { query: 'test' }, undefined)

      // Should have tool_result event
      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult.isError).toBe(false)
      expect(toolResult.durationMs).toBe(42)

      // Should have two turn_complete events (tool turn + final turn)
      const turns = events.filter(e => e.type === 'turn_complete')
      expect(turns).toHaveLength(2)
    })

    it('handles multiple tool calls in a single response', async () => {
      const toolResponse = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: { q: 'a' } },
        { id: 'tu-2', name: 'search', input: { q: 'b' } },
      ])
      const finalResponse = makeTextResponse('Done')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Find two things' }],
        tools: [makeToolDef('search')],
        maxTurns: 5,
      }))

      expect(toolExecutor.execute).toHaveBeenCalledTimes(2)
      const toolResults = events.filter(e => e.type === 'tool_result')
      expect(toolResults).toHaveLength(2)
    })
  })

  describe('maxTurns enforcement', () => {
    it('emits max_turns_reached when limit is hit', async () => {
      // Every response requests a tool call — should exhaust maxTurns
      const toolResp = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: { q: 'a' } },
      ])

      gateway = createMockGateway([toolResp, toolResp, toolResp])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Loop' }],
        tools: [makeToolDef('search')],
        maxTurns: 2,
      }))

      const maxTurns = events.find(e => e.type === 'max_turns_reached')
      expect(maxTurns).toBeDefined()
      expect(maxTurns.turns).toBe(2)
    })

    it('stops at exactly maxTurns=1', async () => {
      const toolResp = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: {} },
      ])

      gateway = createMockGateway([toolResp, toolResp])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'One shot' }],
        tools: [makeToolDef('search')],
        maxTurns: 1,
      }))

      const turns = events.filter(e => e.type === 'turn_complete')
      expect(turns).toHaveLength(1)
      expect(events.find(e => e.type === 'max_turns_reached')).toBeDefined()
    })
  })

  describe('tool execution failure', () => {
    it('passes error result back to model as isError=true', async () => {
      toolExecutor.execute.mockResolvedValueOnce({
        success: false,
        error: 'File not found',
        durationMs: 10,
      })

      const toolResponse = makeToolUseResponse([
        { id: 'tu-err', name: 'read_file', input: { path: '/nope' } },
      ])
      const finalResponse = makeTextResponse('Sorry, could not read')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Read file' }],
        tools: [makeToolDef('read_file')],
        maxTurns: 5,
      }))

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('File not found')
    })
  })

  describe('security gate integration', () => {
    it('denies tool call when security gate says deny', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'deny',
          reason: 'Dangerous command',
          riskTier: 'red',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-danger', name: 'run_command', input: { command: 'rm -rf /' } },
      ])
      const finalResponse = makeTextResponse('Blocked')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Delete everything' }],
        tools: [makeToolDef('run_command')],
        maxTurns: 5,
      }))

      // Tool executor should NOT be called
      expect(toolExecutor.execute).not.toHaveBeenCalled()

      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(true)
      expect(toolResult.content).toContain('Security gate denied')
    })

    it('allows tool call when security gate approves', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => ({
          decision: 'allow',
          reason: 'Safe operation',
          riskTier: 'green',
        })),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-safe', name: 'search', input: { q: 'test' } },
      ])
      const finalResponse = makeTextResponse('Found it')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Search' }],
        tools: [makeToolDef('search')],
        maxTurns: 5,
      }))

      expect(toolExecutor.execute).toHaveBeenCalled()
      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(false)
    })

    it('fails closed when security gate throws in default (enforcing) mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => { throw new Error('Gate crashed') }),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: {} },
      ])
      const finalResponse = makeTextResponse('OK')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Search' }],
        tools: [makeToolDef('search')],
        maxTurns: 5,
      }))

      // Tool MUST NOT execute when gate fails in enforcing mode (S2 fix)
      expect(toolExecutor.execute).not.toHaveBeenCalled()
      const gateErrorEvent = events.find(e => e.type === 'security_gate_error')
      expect(gateErrorEvent).toBeDefined()
      expect(gateErrorEvent.mode).toBe('enforcing')
      const toolResult = events.find(e => e.type === 'tool_result')
      expect(toolResult.isError).toBe(true)
    })

    it('allows execution when security gate throws in permissive mode', async () => {
      const securityGate = {
        validateToolCall: vi.fn(async () => { throw new Error('Gate crashed') }),
      }

      const toolResponse = makeToolUseResponse([
        { id: 'tu-1', name: 'search', input: {} },
      ])
      const finalResponse = makeTextResponse('OK')

      gateway = createMockGateway([toolResponse, finalResponse])
      const runner = createAgentRunner({ gateway, toolExecutor, securityGate })

      const events = await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Search' }],
        tools: [makeToolDef('search')],
        maxTurns: 5,
        securityGateMode: 'permissive',
      }))

      // Permissive mode: tool executes, but warning event is emitted
      expect(toolExecutor.execute).toHaveBeenCalled()
      const gateErrorEvent = events.find(e => e.type === 'security_gate_error')
      expect(gateErrorEvent).toBeDefined()
      expect(gateErrorEvent.mode).toBe('permissive')
    })
  })

  describe('onTurnComplete callback', () => {
    it('calls onTurnComplete after each turn', async () => {
      gateway = createMockGateway([makeTextResponse('Hi')])
      const runner = createAgentRunner({ gateway, toolExecutor })
      const onTurnComplete = vi.fn()

      await collectEvents(runner.run({
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [],
        maxTurns: 5,
        onTurnComplete,
      }))

      expect(onTurnComplete).toHaveBeenCalledTimes(1)
      expect(onTurnComplete).toHaveBeenCalledWith(1, expect.objectContaining({ id: 'resp-1' }))
    })
  })
})
