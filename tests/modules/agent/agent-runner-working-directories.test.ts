// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B2: the agent runner hands every conversation folder to (1) the provider
// request metadata — CLI providers take their cwd, jail and gate folders from
// it — and (2) the security gate, whose memory-path policy uses them to
// refuse another conversation's workspace.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'

const silentLogger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => silentLogger }

function response(content: ModelResponse['content'], stopReason: ModelResponse['stopReason']): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason, usage: { inputTokens: 1, outputTokens: 1 } }
}

function gateway(captured: { metadata?: ModelRequest['metadata'] }): ModelGateway {
  const replies = [
    response([{ type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'a.md' } }], 'tool_use'),
    response([{ type: 'text', text: 'done' }], 'end'),
  ]
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: ModelRequest) {
      captured.metadata ??= request.metadata
      yield { type: 'done', response: replies[i++] ?? replies[1] } as StreamEvent
    },
  } as unknown as ModelGateway
}

async function run(toolContext: Record<string, unknown>) {
  const captured: { metadata?: ModelRequest['metadata'] } = {}
  const validateToolCall = vi.fn(async () => ({ decision: 'allow', reason: 'green', riskTier: 'green' }))
  const toolExecutor = { execute: vi.fn(async () => ({ success: true, output: { ok: true }, durationMs: 1 })) }
  const runner = createAgentRunner({ gateway: gateway(captured), toolExecutor, securityGate: { validateToolCall } } as any)
  for await (const _ of runner.run({
    messages: [{ role: 'user', content: 'go' }],
    tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
    maxTurns: 3,
    metadata: { conversationId: 'conv-1', origin: 'interactive' },
    toolContext: { conversationId: 'conv-1', userId: 'u1', logger: silentLogger, ...toolContext },
  } as any)) { /* drain */ }
  return { metadata: captured.metadata, validateToolCall }
}

describe('agent runner — conversation folders reach providers and the gate (B2)', () => {
  it('(+) sends every folder in the request metadata, primary first', async () => {
    const { metadata } = await run({ workingDirectory: '/w/repo', workingDirectories: ['/w/repo', '/w/docs'] })
    expect(metadata?.workingDirectory).toBe('/w/repo')
    expect(metadata?.workingDirectories).toEqual(['/w/repo', '/w/docs'])
  })

  it('(+) hands the folders to the security gate with the call', async () => {
    const { validateToolCall } = await run({ workingDirectory: '/w/repo', workingDirectories: ['/w/repo', '/w/docs'] })
    expect(validateToolCall).toHaveBeenCalledWith('read_file', { path: 'a.md' }, expect.objectContaining({
      conversationId: 'conv-1',
      workingDirectories: ['/w/repo', '/w/docs'],
    }))
  })

  it('(+) a single working directory still counts as the folder list for the gate', async () => {
    const { validateToolCall, metadata } = await run({ workingDirectory: '/w/only' })
    expect(metadata?.workingDirectories).toBeUndefined()
    expect(validateToolCall).toHaveBeenCalledWith('read_file', { path: 'a.md' }, expect.objectContaining({ workingDirectories: ['/w/only'] }))
  })

  it('(−) no folders: the gate gets none (only the cross-workspace refinement is off)', async () => {
    const { validateToolCall, metadata } = await run({})
    expect(metadata?.workingDirectories).toBeUndefined()
    expect(metadata?.workingDirectory).toBeUndefined()
    const ctx = (validateToolCall.mock.calls[0] as unknown[])[2] as { workingDirectories?: string[] }
    expect(ctx.workingDirectories).toBeUndefined()
  })
})
