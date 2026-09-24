// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// How the SDK's `result` message ends a Claude Code turn (G2):
//   - success → done, its stop reason normalized;
//   - error_max_turns (the runtime's own turn budget ran out) → done with
//     stopReason 'max_turns', the partial answer and its usage kept. A budget
//     stop is an outcome, not a crash;
//   - any other non-success subtype (error_during_execution…) → a thrown
//     ProviderRunError carrying the partial answer and usage. Treating it as a
//     clean 'done' used to mark the provider healthy and the run "OK" (D9).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderRunError } from '@shared/classify-model-error.js'
import type { StreamEvent } from '@modules/model/types.js'

const h = vi.hoisted(() => ({ script: [] as any[] }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => (async function* () {
    const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
    yield fakeClaudeInit(args.options)
    for (const msg of h.script) yield msg
  })(),
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

const assistantMsg = {
  type: 'assistant',
  session_id: 's1',
  parent_tool_use_id: null,
  message: { id: 'msg_1', content: [{ type: 'text', text: 'partial' }] },
}

async function drain(gen: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; thrown: unknown }> {
  const events: StreamEvent[] = []
  let thrown: unknown
  try {
    for await (const ev of gen) events.push(ev)
  } catch (err) {
    thrown = err
  }
  return { events, thrown }
}

const doneOf = (events: StreamEvent[]) => {
  const done = events.find((e) => e.type === 'done')
  return done && done.type === 'done' ? done.response : undefined
}

describe('claude-code provider — result subtype', () => {
  beforeEach(() => { h.script = [] })

  it('error_max_turns ends the turn with done{stopReason:max_turns}, the partial answer and usage — no throw', async () => {
    h.script = [
      assistantMsg,
      { type: 'result', subtype: 'error_max_turns', session_id: 's1', total_cost_usd: 0.02, usage: { input_tokens: 7, output_tokens: 3 } },
    ]

    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const { events, thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(thrown).toBeUndefined()
    const response = doneOf(events)!
    expect(response.stopReason).toBe('max_turns')
    expect(response.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(response.usage).toEqual({ inputTokens: 7, outputTokens: 3, reported: true, costUsd: 0.02 })
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
  })

  it('error_during_execution throws ProviderRunError carrying the partial answer and usage — but no session id', async () => {
    h.script = [
      assistantMsg,
      { type: 'result', subtype: 'error_during_execution', session_id: 'sess-42', usage: { input_tokens: 7, output_tokens: 3 } },
    ]

    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const { events, thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    const err = thrown as ProviderRunError
    expect(err).toBeInstanceOf(ProviderRunError)
    expect(err.subtype).toBe('error_during_execution')
    expect(err.partialText).toBe('partial')
    expect(err).not.toHaveProperty('sessionId')
    expect(err.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
    expect(events.some((e) => e.type === 'text' && e.text === 'partial')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('throws for any other non-success subtype', async () => {
    h.script = [{ type: 'result', subtype: 'error_max_budget_usd', session_id: 's1' }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const { thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect((thrown as ProviderRunError).subtype).toBe('error_max_budget_usd')
  })

  it('a success completes, its stop reason normalized from the runtime report', async () => {
    h.script = [{ type: 'result', subtype: 'success', result: 'done text', stop_reason: 'end_turn', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const { events, thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(thrown).toBeUndefined()
    const response = doneOf(events)!
    expect(response.stopReason).toBe('end')
    expect(response.usage.outputTokens).toBe(2)
    expect(response.content).toEqual([{ type: 'text', text: 'done text' }])
  })

  it('a success that stopped on the output limit or a refusal says so', async () => {
    for (const [raw, expected] of [['max_tokens', 'max_tokens'], ['refusal', 'refusal']] as const) {
      h.script = [{ type: 'result', subtype: 'success', result: 'x', stop_reason: raw, usage: { input_tokens: 1, output_tokens: 1 } }]
      const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
      const { events } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
      expect(doneOf(events)!.stopReason).toBe(expected)
    }
  })

  it('a success never hands a tool_use back: the runtime already ran its tools', async () => {
    h.script = [{ type: 'result', subtype: 'success', result: 'x', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const { events } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(doneOf(events)!.stopReason).toBe('end')
  })
})
