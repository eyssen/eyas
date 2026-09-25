// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// I2 — one turn id per agent-runner run: the context composition when one was
// recorded, otherwise a fresh id. It is stamped on every tool call's context
// (with the run id) and on the model request metadata (with the project), so
// the per-turn memory budget and the CLI-MCP bridge binding see the same turn.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import type { ToolContext } from '@modules/tools/types'

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger } }

function gateway(requests: ModelRequest[], responses: ModelResponse[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: ModelRequest) {
      requests.push(request)
      yield { type: 'done', response: responses[i++] ?? text('done') } as StreamEvent
    },
  } as unknown as ModelGateway
}

function text(t: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text: t }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

function toolUse(n: number): ModelResponse {
  return {
    id: `r${n}`, provider: 'mock', model: 'm',
    content: [{ type: 'tool_use', id: `tu-${n}`, name: 'memory_search', input: { query: 'q' } }],
    stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 },
  }
}

async function run(opts: { metadata?: Record<string, unknown>; sessionId?: string; toolContext?: Partial<ToolContext>; responses?: ModelResponse[] }) {
  const requests: ModelRequest[] = []
  const contexts: ToolContext[] = []
  const toolExecutor = {
    execute: vi.fn(async (_n: string, _i: unknown, c?: ToolContext) => {
      contexts.push(c!)
      return { success: true, output: { results: [] }, durationMs: 1 }
    }),
  }
  const runner = createAgentRunner({ gateway: gateway(requests, opts.responses ?? [text('ok')]), toolExecutor } as any)
  for await (const _ of runner.run({
    messages: [{ role: 'user', content: 'go' }],
    tools: [{ name: 'memory_search', description: 'd', inputSchema: { type: 'object' } }],
    maxTurns: 5,
    metadata: opts.metadata,
    sessionId: opts.sessionId,
    toolContext: opts.toolContext
      ? { conversationId: 'c1', userId: 'u1', logger, ...opts.toolContext } as ToolContext
      : undefined,
  } as any)) { /* drain */ }
  return { requests, contexts }
}

describe('agent-runner turn identity (I2)', () => {
  it('uses the composition id as the turn id when one was recorded', async () => {
    const { requests } = await run({ metadata: { conversationId: 'c1', compositionId: 'comp-42' } })
    expect(requests[0].metadata?.turnId).toBe('comp-42')
  })

  it('generates a turn id otherwise, a new one per run', async () => {
    const a = await run({ metadata: { conversationId: 'c1' } })
    const b = await run({ metadata: { conversationId: 'c1' } })
    expect(a.requests[0].metadata?.turnId).toMatch(/^[0-9A-Z]{26}$/)
    expect(b.requests[0].metadata?.turnId).not.toBe(a.requests[0].metadata?.turnId)
  })

  it('keeps ONE turn id across every model call and tool call of the run', async () => {
    const { requests, contexts } = await run({
      metadata: { conversationId: 'c1', compositionId: 'comp-7' },
      sessionId: 'run-7',
      toolContext: {},
      responses: [toolUse(1), toolUse(2), text('answer')],
    })
    expect(requests).toHaveLength(3)
    expect(new Set(requests.map((r) => r.metadata?.turnId))).toEqual(new Set(['comp-7']))
    expect(contexts).toHaveLength(2)
    for (const c of contexts) {
      expect(c.turnId).toBe('comp-7')
      expect(c.runId).toBe('run-7')
    }
  })

  it('stamps the run id on the request metadata too', async () => {
    const { requests } = await run({ metadata: { conversationId: 'c1' }, sessionId: 'run-9' })
    expect(requests[0].metadata?.runId).toBe('run-9')
  })

  it('copies the tool context project into the request metadata', async () => {
    const withProject = await run({ metadata: { conversationId: 'c1' }, toolContext: { projectId: 'proj-1' } })
    expect(withProject.requests[0].metadata?.projectId).toBe('proj-1')
    const projectless = await run({ metadata: { conversationId: 'c1' }, toolContext: { projectId: null } })
    expect(projectless.requests[0].metadata?.projectId).toBeNull()
  })

  it('adds no project and no run id when the run has neither', async () => {
    const { requests, contexts } = await run({
      metadata: { conversationId: 'c1' },
      toolContext: {},
      responses: [toolUse(1), text('answer')],
    })
    expect(requests[0].metadata).not.toHaveProperty('projectId')
    expect(requests[0].metadata).not.toHaveProperty('runId')
    expect(contexts[0].runId).toBeUndefined()
    expect(contexts[0].turnId).toBe(requests[0].metadata?.turnId)
  })

  it('does not write the turn id into the caller\'s shared tool context', async () => {
    const shared = { conversationId: 'c1', userId: 'u1', logger } as ToolContext
    const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: {}, durationMs: 1 })) }
    const runner = createAgentRunner({ gateway: gateway([], [toolUse(1), text('ok')]), toolExecutor } as any)
    for await (const _ of runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'memory_search', description: 'd', inputSchema: { type: 'object' } }],
      maxTurns: 3,
      toolContext: shared,
    } as any)) { /* drain */ }
    expect(shared.turnId).toBeUndefined()
    expect(shared.runId).toBeUndefined()
  })
})
