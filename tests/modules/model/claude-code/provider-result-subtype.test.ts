// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The SDK reports a failed run as a `result` message with a non-'success'
// subtype (error_max_turns, error_during_execution). Ignoring it — the previous
// behaviour — produced a clean 'done' event with whatever partial text existed,
// so the gateway marked the provider healthy and the run finished "OK" with a
// truncated or empty answer (D9).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderRunError } from '@shared/classify-model-error.js'
import type { StreamEvent } from '@modules/model/types.js'

const h = vi.hoisted(() => ({ script: [] as any[] }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {
    for (const msg of h.script) yield msg
  })(),
  getSessionInfo: async () => null,
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'

const assistantMsg = {
  type: 'assistant',
  session_id: 's1',
  message: { content: [{ type: 'text', text: 'partial' }] },
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

describe('claude-code provider — non-success result subtype', () => {
  beforeEach(() => { h.script = [] })

  it('throws ProviderRunError carrying the subtype instead of completing', async () => {
    h.script = [
      assistantMsg,
      { type: 'result', subtype: 'error_max_turns', session_id: 's1', usage: { input_tokens: 7, output_tokens: 3 } },
    ]

    const provider = createClaudeCodeProvider()
    const { events, thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    expect(thrown).toBeInstanceOf(ProviderRunError)
    expect((thrown as ProviderRunError).subtype).toBe('error_max_turns')
    expect(events.some((e) => e.type === 'text' && e.text === 'partial')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  // A max-turns run is a budget outcome, not a crash: the answer so far and the
  // resumable SDK session are the only things that make it recoverable, and the
  // 'done' event that used to carry them is (correctly) never emitted for a
  // failed run — so the error has to carry them instead (F2-T8 consumes this).
  it('carries the partial answer, session id and usage on the thrown error', async () => {
    h.script = [
      assistantMsg,
      { type: 'result', subtype: 'error_max_turns', session_id: 'sess-42', usage: { input_tokens: 7, output_tokens: 3 } },
    ]

    const provider = createClaudeCodeProvider()
    const { thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))

    const err = thrown as ProviderRunError
    expect(err).toBeInstanceOf(ProviderRunError)
    expect(err.partialText).toBe('partial')
    expect(err.sessionId).toBe('sess-42')
    expect(err.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })

  it('throws for any non-success subtype', async () => {
    h.script = [{ type: 'result', subtype: 'error_during_execution', session_id: 's1' }]
    const provider = createClaudeCodeProvider()
    const { thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect((thrown as ProviderRunError).subtype).toBe('error_during_execution')
  })

  it('still completes normally on a success subtype', async () => {
    h.script = [{ type: 'result', subtype: 'success', result: 'done text', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } }]
    const provider = createClaudeCodeProvider()
    const { events, thrown } = await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(thrown).toBeUndefined()
    const done = events.find((e) => e.type === 'done')
    expect(done && done.type === 'done' && done.response.usage.outputTokens).toBe(2)
  })

  it('emits failed orchestration events for an own run before rethrowing', async () => {
    h.script = [{ type: 'result', subtype: 'error_max_turns', session_id: 's1' }]
    const events: any[] = []
    const provider = createClaudeCodeProvider({ getGovernance: () => ({ orchestrationSink: (e: any) => events.push(e) }) as any })
    const { thrown } = await drain(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', userId: 'u1' },
    } as any))

    expect(thrown).toBeInstanceOf(ProviderRunError)
    expect(events.some((e) => e.payload.type === 'run_completed' && e.payload.status === 'failed')).toBe(true)
  })
})
