// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createAgentRunnerPort } from '@modules/pipelines/ticket-to-code/adapters/agent-runner-port'

// F2 T4 — executeAgent's dependency contract changed from Promise<string> to
// an honest Promise<{ text, status, sessionId }>. These mocks return the new
// shape; a dedicated test below covers the port turning status:'failed' into
// a throw so the pipeline's existing per-stage catch marks the stage failed.
function completed(text: string) {
  return { text, status: 'completed' as const, sessionId: 'sess-1' }
}

describe('createAgentRunnerPort', () => {
  it('runs the agent and parses a JSON completion', async () => {
    const executeAgent = vi.fn(async (_c: string, _a: string, _t: string, _o?: { origin?: 'pipeline' | 'delegation' }) => completed('```json\n{"files":[]}\n```'))
    const port = createAgentRunnerPort({ executeAgent })
    const out = await port.run({ agentId: 'dev', sessionId: 'conv1', instructions: 'implement', context: { a: 1 } })
    expect(out.text).toContain('files')
    expect(out.json).toEqual({ files: [] })
    const call = executeAgent.mock.calls[0]
    expect(call[0]).toBe('conv1')
    expect(call[1]).toBe('dev')
    expect(call[2]).toContain('implement')
    expect(call[2]).toContain('"a": 1')
    expect(call[3]).toEqual({ origin: 'pipeline' })
  })

  it('returns json undefined when the completion is not JSON', async () => {
    const port = createAgentRunnerPort({ executeAgent: async () => completed('plain text answer') })
    const out = await port.run({ agentId: 'x', sessionId: null, instructions: 'hi' })
    expect(out.text).toBe('plain text answer')
    expect(out.json).toBeUndefined()
  })

  it('generates a conversation id when sessionId is null and no newConversationId is given', async () => {
    const executeAgent = vi.fn(async (_c: string, _a: string, _t: string) => completed('ok'))
    const port = createAgentRunnerPort({ executeAgent })
    await port.run({ agentId: 'reviewer', sessionId: null, instructions: 'review' })
    expect(executeAgent.mock.calls[0][0]).toBe('pipeline-reviewer')
  })

  it('uses the supplied newConversationId generator when sessionId is null', async () => {
    const executeAgent = vi.fn(async (_c: string, _a: string, _t: string) => completed('ok'))
    const port = createAgentRunnerPort({ executeAgent, newConversationId: () => 'generated-id' })
    await port.run({ agentId: 'reviewer', sessionId: null, instructions: 'review' })
    expect(executeAgent.mock.calls[0][0]).toBe('generated-id')
  })

  // F2 T4 — a stage must no longer succeed on a run that didn't complete.
  it('throws when the run status is failed, instead of returning success text', async () => {
    const executeAgent = vi.fn(async () => ({ text: 'partial garbage', status: 'failed' as const, sessionId: 'sess-2' }))
    const port = createAgentRunnerPort({ executeAgent })
    await expect(port.run({ agentId: 'dev', sessionId: 'conv1', instructions: 'implement' })).rejects.toThrow(/failed/i)
  })

  // Fix round 1 / Important 4 (controller ruling) — a max_turns result is
  // truncated mid-work by construction; letting the next stage consume it as
  // a completed artifact means it parses `undefined` JSON and proceeds blind.
  // The stage must fail here too, with a message distinguishable from a hard
  // 'failed' so the operator can tell WHY.
  it('throws on status max_turns too — with a message distinguishable from a hard failure', async () => {
    const executeAgent = vi.fn(async () => ({ text: 'ran out of turns but got this far', status: 'max_turns' as const, sessionId: 'sess-3' }))
    const port = createAgentRunnerPort({ executeAgent })
    await expect(port.run({ agentId: 'dev', sessionId: 'conv1', instructions: 'implement' })).rejects.toThrow(/max_turns|turn limit/i)
    await expect(port.run({ agentId: 'dev', sessionId: 'conv1', instructions: 'implement' })).rejects.toThrow(
      /ran out of turns but got this far/,
    )
  })
})
