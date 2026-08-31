// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createOrchestrator } from '@modules/agent/orchestrator.js'

function makeDeps(track: { cur: number; max: number }) {
  let n = 0
  return {
    bus: { emit: vi.fn() },
    gateway: {} as any,
    toolExecutor: {} as any,
    agentRegistry: {
      get: (id: string) => ({ id, name: id, model: 'x', tools: [], systemPrompt: '', constraints: [], maxTurns: 5 }),
      addTokenUsage: vi.fn(),
      list: () => [],
    },
    conversations: { create: () => ({ id: `c${++n}` }), update: vi.fn(), addMessage: vi.fn() },
    toolRegistry: { toToolDefinitions: () => [] },
    agentRunner: {
      async *run() {
        track.cur++
        track.max = Math.max(track.max, track.cur)
        await new Promise((r) => setTimeout(r, 10))
        yield { type: 'done', response: { content: [{ type: 'text', text: 'ok' }] } }
        track.cur--
      },
    },
    rePlanner: { replan: vi.fn() },
    teamSessions: undefined,
  } as any
}

const config = {
  phases: [{ name: 'P', agents: ['a', 'b', 'c', 'd', 'e'], parallel: true, checkpoint: false, replanOnComplete: false }],
  maxParallelAgents: 2,
  conflictStrategy: 'human-review',
  replanAfterPhase: false,
  modelRouting: 'manual',
  useWorktrees: false,
}

describe('executeTeam honors maxParallelAgents', () => {
  it('never runs more than maxParallelAgents concurrently', async () => {
    const track = { cur: 0, max: 0 }
    const orch = createOrchestrator(makeDeps(track))
    const completed: string[] = []
    for await (const ev of orch.executeTeam(config as any, 'parent', 'goal', 'ts')) {
      if ((ev as any).type === 'agent_completed') completed.push((ev as any).agentId)
    }
    expect(track.max).toBeLessThanOrEqual(2)
    // all 5 still complete
    expect(completed.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
