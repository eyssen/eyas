// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition, ContentBlock } from '@modules/model/types'

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}

function makeTextResponse(text: string): ModelResponse {
  return {
    id: 'resp-text', provider: 'mock', model: 'mock-model',
    content: [{ type: 'text', text }], stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 5 },
  }
}

function makeToolUseResponse(
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[],
): ModelResponse {
  const content: ContentBlock[] = toolCalls.map((tc) => ({
    type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.input,
  }))
  return {
    id: 'resp-tool', provider: 'mock', model: 'mock-model',
    content, stopReason: 'tool_use',
    usage: { inputTokens: 10, outputTokens: 5 },
  }
}

function createMockGateway(responses: ModelResponse[]): ModelGateway {
  let callIndex = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[callIndex++] ?? makeTextResponse('fallback')),
    async *stream() {
      const resp = responses[callIndex++] ?? makeTextResponse('fallback')
      yield { type: 'done', response: resp } as StreamEvent
    },
  } as unknown as ModelGateway
}

describe('AgentRunner parallel specialist routing', () => {
  it('overlaps two run_specialist executes in one turn', async () => {
    let current = 0
    let max = 0
    const execute = vi.fn(async (name: string) => {
      current++
      max = Math.max(max, current)
      await new Promise((r) => setTimeout(r, 40))
      current--
      return { success: true, output: { name }, durationMs: 40 }
    })
    const runner = createAgentRunner({
      gateway: createMockGateway([
        makeToolUseResponse([
          { id: 'a', name: 'read_file', input: { path: 'x' } },
          { id: 'b', name: 'run_specialist', input: { agentId: 'rev', task: '1' } },
          { id: 'c', name: 'run_specialist', input: { agentId: 'dev', task: '2' } },
        ]),
        makeTextResponse('done'),
      ]),
      toolExecutor: { execute } as any,
    })
    const events = []
    for await (const e of runner.run({
      messages: [{ role: 'user', content: 'go' }],
      tools: [makeToolDef('read_file'), makeToolDef('run_specialist')],
      maxTurns: 3,
    })) events.push(e)

    expect(execute).toHaveBeenCalledTimes(3)
    expect(max).toBe(2)
    const names = execute.mock.calls.map((c) => c[0])
    expect(names.slice(0, 2).sort()).toEqual(['run_specialist', 'run_specialist'])
    expect(names[2]).toBe('read_file')
  })
})
