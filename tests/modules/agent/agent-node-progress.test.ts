// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createOrchestrator } from '@modules/agent/orchestrator.js'

function makeDeps(events: any[]) {
  let created = 0
  return {
    bus: { emit: vi.fn() },
    gateway: {} as any,
    toolExecutor: {} as any,
    agentRegistry: {
      get: () => ({ id: 'a1', name: 'A1', model: 'x', tools: [], systemPrompt: '', constraints: [], maxTurns: 5 }),
      addTokenUsage: vi.fn(),
      list: () => [],
    },
    conversations: {
      create: () => ({ id: `conv${++created}` }),
      update: vi.fn(),
      addMessage: vi.fn(),
    },
    toolRegistry: { toToolDefinitions: () => [] },
    agentRunner: {
      async *run() {
        for (const e of events) yield e
      },
    },
  } as any
}

describe('runAgentInConversation onProgress', () => {
  it('emits node_started with the real conversationId, then node_progress + tool events', async () => {
    const seen: any[] = []
    const orch = createOrchestrator(
      makeDeps([
        { type: 'turn_complete', turn: 1, tokensUsed: 10 },
        { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, durationMs: 5 },
        { type: 'done', response: { content: [{ type: 'text', text: 'done' }] } },
      ]),
    )
    await orch.runAgentInConversation('a1', 'p1', 'goal', false, {
      phase: 'Build',
      onProgress: (e: any) => seen.push(e),
    })

    expect(seen[0]).toMatchObject({ kind: 'node_started', agentId: 'a1', phase: 'Build' })
    expect(seen[0].conversationId).toMatch(/^conv/)
    expect(seen.every((e: any) => e.phase === 'Build')).toBe(true)
    expect(seen.some((e) => e.kind === 'node_progress' && e.turn === 1 && e.tokens === 10)).toBe(true)
    expect(seen.some((e) => e.kind === 'tool' && e.toolId === 't1' && e.status === 'success')).toBe(true)
  })
})
