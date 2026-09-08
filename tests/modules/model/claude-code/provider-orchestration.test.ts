// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

const h = vi.hoisted(() => ({
  captured: { options: undefined as any },
  script: [] as any[],
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.options = args.options
    return (async function* () {
      for (const msg of h.script) yield msg
    })()
  },
  getSessionInfo: async () => null,
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'

const toolDeps = {
  toolExecutor: { execute: vi.fn() } as any,
  toolRegistry: { list: () => [{ name: 'search_memory', category: 'memory' }] } as any,
}

function governance(sink: (e: OrchestrationEvent) => void) {
  return {
    securityGate: {
      validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' }),
    },
    orchestrationSink: sink,
  }
}

const resultMsg = { type: 'result', subtype: 'success', result: 'MAIN', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } }

async function collect(gen: AsyncIterable<any>) {
  const out: any[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('claude-code provider — orchestration for ALL runs', () => {
  beforeEach(() => {
    h.captured.options = undefined
    h.script = [resultMsg]
  })

  it('installs hooks for a plain conversation run (no teamSessionId)', async () => {
    const events: OrchestrationEvent[] = []
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance((e) => events.push(e)) })
    await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', userId: 'u1' },
    } as any))
    expect(h.captured.options.hooks).toBeTruthy()
    expect(h.captured.options.includeHookEvents).toBe(true)
  })

  it('plain run: emits run_started + root node, then node_completed + run_completed', async () => {
    const events: OrchestrationEvent[] = []
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance((e) => events.push(e)) })
    await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', userId: 'u1' },
    } as any))

    const types = events.map((e) => e.payload.type)
    expect(types[0]).toBe('run_started')
    expect(events[0].runId).toBe('c1')
    expect(events[1]).toMatchObject({ nodeId: 'conv:c1', parentId: null, payload: { type: 'node_started', kind: 'root', conversationId: 'c1' } })
    expect(types).toContain('node_completed')
    expect(events[events.length - 1].payload).toMatchObject({ type: 'run_completed', status: 'completed' })
  })

  it('team run: hooks installed but NO root emission (routes-team owns the tree)', async () => {
    const events: OrchestrationEvent[] = []
    const provider = createClaudeCodeProvider({ ...toolDeps, getGovernance: () => governance((e) => events.push(e)) })
    await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', userId: 'u1', teamSessionId: 'ts1' },
    } as any))
    expect(h.captured.options.hooks).toBeTruthy()
    expect(events.filter((e) => e.payload.type === 'run_started')).toHaveLength(0)
    expect(events.filter((e) => e.payload.type === 'run_completed')).toHaveLength(0)
  })

  it('no orchestration sink → no hooks, still streams fine', async () => {
    const provider = createClaudeCodeProvider({ ...toolDeps })
    const out = await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1' },
    } as any))
    expect(h.captured.options.hooks).toBeUndefined()
    expect(out.find((e) => e.type === 'done')).toBeTruthy()
  })

  it('subagent-originated messages (parent_tool_use_id) never leak into the main stream', async () => {
    h.script = [
      { type: 'assistant', session_id: 's1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'MAIN-1 ' }] } },
      { type: 'assistant', session_id: 's1', parent_tool_use_id: 'task-1', message: { content: [{ type: 'text', text: 'SUBTEXT ' }, { type: 'tool_use', id: 'tu9', name: 'Read' }] } },
      { type: 'assistant', session_id: 's1', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'MAIN-2' }] } },
      { type: 'result', subtype: 'success', result: '', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } },
    ]
    const provider = createClaudeCodeProvider({ ...toolDeps })
    const out = await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1' },
    } as any))

    const text = out.filter((e) => e.type === 'text').map((e) => e.text).join('')
    expect(text).toBe('MAIN-1 MAIN-2')
    expect(out.some((e) => e.type === 'tool_use_start' && e.name === 'Read')).toBe(false)
    const done = out.find((e) => e.type === 'done')
    expect(done.response.content[0].text).toBe('MAIN-1 MAIN-2')
  })
})
