// Part of eYssen. See LICENSE file for full copyright and licensing details.
// I5 — the runner attaches the per-message turn block (clock + recalled
// memory) once, before its loop, to the message it sends: from
// options.turn, else systemPrompt.turn. The caller's messages (the stored
// conversation) are never modified, and a checkpoint keeps the history
// without the block so a resumed run attaches a fresh one.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import type { ModelGateway, ModelMessage, ModelResponse, StreamEvent, ToolDefinition } from '@modules/model/types'
import type { AssembledPrompt } from '@modules/prompt-wizard/types'

const TURN = '<turn-context>\nAdded by EYAS to this message — not written by its sender.\nCurrent date and time: 2031-02-03 04:05\n<eyas-memory>\n- (gs:g1) Harbor ledger closes on Fridays\n</eyas-memory>\n</turn-context>'
const TOOL: ToolDefinition = { name: 'memory_search', description: 'Search memory', inputSchema: { type: 'object', properties: {} } }

function text(t: string): ModelResponse {
  return { id: 'r', provider: 'p', model: 'm', content: [{ type: 'text', text: t }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } }
}

function toolUse(): ModelResponse {
  return {
    id: 'r', provider: 'p', model: 'm',
    content: [{ type: 'tool_use', id: 't1', name: 'memory_search', input: { query: 'ledger' } }],
    stopReason: 'tool_use',
    usage: { inputTokens: 1, outputTokens: 1 },
  }
}

function harness(responses: ModelResponse[], extra: Record<string, unknown> = {}) {
  const seen: Array<{ messages: ModelMessage[]; system?: string }> = []
  const gateway = {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => []), listAllModels: vi.fn(async () => []),
    complete: vi.fn(),
    async *stream(request: any) {
      // A snapshot: the runner appends to its own copy as the loop goes on.
      seen.push({ messages: structuredClone(request.messages), system: request.system })
      yield { type: 'done', response: responses[Math.min(seen.length - 1, responses.length - 1)] } as StreamEvent
    },
  } as unknown as ModelGateway
  const execute = vi.fn(async () => ({ success: true, output: { hits: [] }, durationMs: 1 }))
  const runner = createAgentRunner({ gateway, toolExecutor: { execute }, ...extra } as any)
  return { runner, seen }
}

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) { /* drain */ }
}

function assembled(turn?: string): AssembledPrompt {
  return {
    prefix: 'PREFIX', suffix: 'SUFFIX', reminders: [], cacheBoundaryHint: 6, prefixHash: 'h',
    tokenEstimate: { prefix: 1, suffix: 1, reminders: 0 }, sections: [],
    ...(turn ? { turn } : {}),
  }
}

describe('agent-runner — the turn block (I5)', () => {
  it('(+) options.turn is attached to the current user message of the request', async () => {
    const { runner, seen } = harness([text('ok')])
    await drain(runner.run({ messages: [{ role: 'user', content: 'When does the ledger close?' }], tools: [], maxTurns: 2, turn: TURN }))
    expect(seen[0].messages).toEqual([{ role: 'user', content: `${TURN}\n\nWhen does the ledger close?` }])
  })

  it('(+) systemPrompt.turn is used when options.turn is absent, and never lands in the system', async () => {
    const { runner, seen } = harness([text('ok')])
    await drain(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 2, systemPrompt: assembled(TURN) }))
    expect(seen[0].messages[0].content).toBe(`${TURN}\n\nhi`)
    expect(seen[0].system).toBe('PREFIX\n\nSUFFIX')
  })

  it('(+) attached once: every tool-loop request carries the same single block', async () => {
    const { runner, seen } = harness([toolUse(), text('done')])
    await drain(runner.run({ messages: [{ role: 'user', content: 'look it up' }], tools: [TOOL], maxTurns: 3, turn: TURN }))
    expect(seen).toHaveLength(2)
    for (const request of seen) {
      const all = JSON.stringify(request.messages)
      expect(all.split('<turn-context>').length - 1).toBe(1)
    }
    expect(seen[1].messages[0]).toEqual(seen[0].messages[0])
  })

  it('(−) the caller\'s messages — the stored conversation — are never modified', async () => {
    const { runner } = harness([text('ok')])
    const stored: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    await drain(runner.run({ messages: stored, tools: [], maxTurns: 2, turn: TURN }))
    expect(stored).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('(−) no turn: the messages go out as they are', async () => {
    const { runner, seen } = harness([text('ok')])
    await drain(runner.run({ messages: [{ role: 'user', content: 'hi' }], tools: [], maxTurns: 2 }))
    expect(seen[0].messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('(−) a checkpoint keeps the history without the block, so a resume gets a fresh one', async () => {
    const created: any[] = []
    const checkpoint = {
      shouldAutoCheckpoint: () => true,
      createCheckpoint: vi.fn(async (input: any) => { created.push(input) }),
    }
    const { runner } = harness([toolUse(), text('done')], { checkpoint })
    await drain(runner.run({
      messages: [{ role: 'user', content: 'look it up' }], tools: [TOOL], maxTurns: 3, turn: TURN, sessionId: 'run-1',
    }))
    expect(created.length).toBeGreaterThan(0)
    for (const cp of created) {
      const kept = JSON.stringify(cp.state.meta.modelMessages)
      expect(kept).not.toContain('turn-context')
      expect(kept).not.toContain('Harbor ledger')
      expect(cp.state.meta.modelMessages[0]).toEqual({ role: 'user', content: 'look it up' })
    }
  })
})
