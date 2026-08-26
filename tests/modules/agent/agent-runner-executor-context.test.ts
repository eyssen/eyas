// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type {
  ContentBlock,
  ModelGateway,
  ModelResponse,
  StreamEvent,
  ToolDefinition,
} from '@modules/model/types'

// ─── Helpers (same style as agent-runner-security-mode.test.ts) ─────

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}

function makeTextResponse(text: string): ModelResponse {
  return {
    id: 'resp-text',
    provider: 'mock',
    model: 'mock-model',
    content: [{ type: 'text', text }],
    stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 5 },
  }
}

function makeToolUseResponse(toolCalls: { id: string; name: string; input: Record<string, unknown> }[]): ModelResponse {
  const content: ContentBlock[] = toolCalls.map((tc) => ({
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
    usage: { inputTokens: 10, outputTokens: 5 },
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

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

const allowGate = { validateToolCall: vi.fn(async () => ({ decision: 'allow', reason: 'safe', riskTier: 'green' })) }

async function drain(gen: AsyncGenerator<any>) {
  for await (const _ of gen) { /* consume */ }
}

function baseToolContext(extra: Record<string, unknown> = {}) {
  return { conversationId: 'c1', userId: 'u1', logger: silentLogger, ...extra } as any
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentRunner — executor authorization context (F0 R2)', () => {
  let toolExecutor: ReturnType<typeof createMockToolExecutor>

  beforeEach(() => {
    toolExecutor = createMockToolExecutor()
    allowGate.validateToolCall.mockClear()
  })

  it('passes a default agent actor and securityPipelineHandled=true when a gate ran the call', async () => {
    const gateway = createMockGateway([
      makeToolUseResponse([{ id: 'tu-1', name: 'search', input: { q: 'x' } }]),
      makeTextResponse('done'),
    ])
    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: allowGate })

    await drain(runner.run({
      messages: [{ role: 'user', content: 'Search' }],
      tools: [makeToolDef('search')],
      maxTurns: 5,
      toolContext: baseToolContext(),
    }))

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    const ctx = toolExecutor.execute.mock.calls[0][2] as any
    expect(ctx.actor).toEqual({ kind: 'agent', role: 'agent' })
    expect(ctx.securityPipelineHandled).toBe(true)
    expect(ctx.conversationId).toBe('c1')
  })

  it('passes securityPipelineHandled=false when no security gate is wired', async () => {
    const gateway = createMockGateway([
      makeToolUseResponse([{ id: 'tu-2', name: 'search', input: { q: 'x' } }]),
      makeTextResponse('done'),
    ])
    const runner = createAgentRunner({ gateway, toolExecutor })

    await drain(runner.run({
      messages: [{ role: 'user', content: 'Search' }],
      tools: [makeToolDef('search')],
      maxTurns: 5,
      toolContext: baseToolContext(),
    }))

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    const ctx = toolExecutor.execute.mock.calls[0][2] as any
    expect(ctx.securityPipelineHandled).toBe(false)
    expect(ctx.actor).toEqual({ kind: 'agent', role: 'agent' })
  })

  it('preserves a caller-supplied actor instead of overwriting it with the agent default', async () => {
    const ability = { can: () => true }
    const gateway = createMockGateway([
      makeToolUseResponse([{ id: 'tu-3', name: 'search', input: { q: 'x' } }]),
      makeTextResponse('done'),
    ])
    const runner = createAgentRunner({ gateway, toolExecutor, securityGate: allowGate })

    await drain(runner.run({
      messages: [{ role: 'user', content: 'Search' }],
      tools: [makeToolDef('search')],
      maxTurns: 5,
      toolContext: baseToolContext({ actor: { kind: 'user', role: 'admin', ability } }),
    }))

    const ctx = toolExecutor.execute.mock.calls[0][2] as any
    expect(ctx.actor).toEqual({ kind: 'user', role: 'admin', ability })
  })

  // Fold-in minor 1 (review round 1): propose_team's result carries a
  // teamSessionId that gets propagated into the shared toolContext so later
  // calls in the same run can resolve it. Inside a team run the team session
  // IS the messaging session — sessionId must be propagated alongside it, or
  // the agent-messaging tools (which key on ctx.sessionId) have no session.
  it('propagates both teamSessionId and sessionId from a propose_team-shaped tool result', async () => {
    const gateway = createMockGateway([
      makeToolUseResponse([{ id: 'tu-4', name: 'propose_team', input: {} }]),
      makeToolUseResponse([{ id: 'tu-5', name: 'write_team_memory', input: {} }]),
      makeTextResponse('done'),
    ])
    const propagatingExecutor = {
      execute: vi.fn(async (name: string, _input: unknown, _ctx: unknown) =>
        name === 'propose_team'
          ? { success: true, output: { teamSessionId: 'ts-propagated' }, durationMs: 5 }
          : { success: true, output: { result: 'ok' }, durationMs: 5 },
      ),
    }
    const runner = createAgentRunner({ gateway, toolExecutor: propagatingExecutor, securityGate: allowGate })

    await drain(runner.run({
      messages: [{ role: 'user', content: 'Propose a team' }],
      tools: [makeToolDef('propose_team'), makeToolDef('write_team_memory')],
      maxTurns: 5,
      toolContext: baseToolContext(),
    }))

    expect(propagatingExecutor.execute).toHaveBeenCalledTimes(2)
    const secondCallCtx = propagatingExecutor.execute.mock.calls[1][2] as any
    expect(secondCallCtx.teamSessionId).toBe('ts-propagated')
    expect(secondCallCtx.sessionId).toBe('ts-propagated')
  })
})
