// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Agent-runner ↔ autonomy ladder integration. A tool that maps to a LOCKED /
// low-level category requires human approval and FAILS CLOSED when no reviewer
// is wired (this also subsumes the "security-gate absent → red tool ran
// ungated" gap). A category raised to L3 runs autonomously. Benign tools that
// map to no category are never autonomy-gated.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy'
import type { ModelGateway, ModelResponse, StreamEvent, ToolDefinition, ContentBlock } from '@modules/model/types'

function makeToolDef(name: string): ToolDefinition {
  return { name, description: `Tool ${name}`, inputSchema: { type: 'object' } }
}
function makeText(text: string): ModelResponse {
  return { id: 'r', provider: 'mock', model: 'm', content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}
function makeToolUse(name: string): ModelResponse {
  const content: ContentBlock[] = [{ type: 'tool_use', id: 'tu-1', name, input: {} }]
  return { id: 'r', provider: 'mock', model: 'm', content, stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } }
}
function gatewayOf(responses: ModelResponse[]): ModelGateway {
  let i = 0
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(async () => responses[i++] ?? makeText('done')),
    async *stream() { yield { type: 'done', response: responses[i++] ?? makeText('done') } as StreamEvent },
  } as unknown as ModelGateway
}
function executorMock() {
  return { execute: vi.fn(async () => ({ success: true, output: { ok: true }, durationMs: 1 })) }
}
async function collect(gen: AsyncGenerator<any>) { const e: any[] = []; for await (const x of gen) e.push(x); return e }

function freshPolicy() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  const p = createAutonomyPolicy(db)
  p.seedDefaults()
  return p
}

describe('agent-runner — autonomy ladder gating', () => {
  let toolExecutor: ReturnType<typeof executorMock>
  beforeEach(() => { toolExecutor = executorMock() })

  it('FAILS CLOSED on a locked-category tool when no reviewer is wired', async () => {
    const autonomyPolicy = freshPolicy()
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('run_command'), makeText('done')]), toolExecutor, autonomyPolicy } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('run_command')], maxTurns: 3, autonomous: true }))

    expect(toolExecutor.execute).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'tool_approval_required')).toBeDefined()
    expect(events.find((e) => e.type === 'tool_approval_denied')).toBeDefined()
  })

  it('runs autonomously when the category is raised to L3', async () => {
    const autonomyPolicy = freshPolicy()
    autonomyPolicy.setLevel('deploy_retry', 3, 'test')
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('restart_service'), makeText('done')]), toolExecutor, autonomyPolicy } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('restart_service')], maxTurns: 3, autonomous: true }))

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    expect(events.find((e) => e.type === 'tool_approval_required')).toBeUndefined()
  })

  it('does NOT autonomy-gate a benign tool that maps to no category', async () => {
    const autonomyPolicy = freshPolicy()
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('search_memory'), makeText('done')]), toolExecutor, autonomyPolicy } as any)
    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('search_memory')], maxTurns: 3, autonomous: true }))
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })

  it('does NOT autonomy-gate an INTERACTIVE run (origin: interactive)', async () => {
    const autonomyPolicy = freshPolicy()
    // run_command maps to a locked category, but this is an interactive run
    // (metadata.origin: 'interactive') so the autonomy ladder does not apply —
    // the user is the approver, governed by the security gate instead.
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('run_command'), makeText('done')]), toolExecutor, autonomyPolicy } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('run_command')], maxTurns: 3, metadata: { origin: 'interactive' } }))
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
    expect(events.find((e) => e.type === 'tool_approval_required')).toBeUndefined()
  })

  it('F0 R4 pin: no identity metadata + no autonomous flag → still FAILS CLOSED (absence is autonomous)', async () => {
    const autonomyPolicy = freshPolicy()
    // Neither options.autonomous nor options.metadata is set at all. Fail-closed
    // classification (isAutonomousRequest(undefined) === true) means this run is
    // STILL gated by the ladder — a construction site that forgets to label its
    // origin must never silently fall back to "interactive, ungated".
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('run_command'), makeText('done')]), toolExecutor, autonomyPolicy } as any)
    const events = await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('run_command')], maxTurns: 3 }))

    expect(toolExecutor.execute).not.toHaveBeenCalled()
    expect(events.find((e) => e.type === 'tool_approval_required')).toBeDefined()
    expect(events.find((e) => e.type === 'tool_approval_denied')).toBeDefined()
  })

  it('runs a locked-category tool when the reviewer approves', async () => {
    const autonomyPolicy = freshPolicy()
    const onApprovalRequired = vi.fn(async () => true)
    const runner = createAgentRunner({ gateway: gatewayOf([makeToolUse('run_command'), makeText('done')]), toolExecutor, autonomyPolicy, onApprovalRequired } as any)
    await collect(runner.run({ messages: [{ role: 'user', content: 'go' }], tools: [makeToolDef('run_command')], maxTurns: 3, autonomous: true }))
    expect(onApprovalRequired).toHaveBeenCalledTimes(1)
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1)
  })
})
