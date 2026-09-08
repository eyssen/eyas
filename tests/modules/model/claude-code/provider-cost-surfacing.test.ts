// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 — the Claude Code SDK's 'result' message carries its own authoritative
// total_cost_usd + cache-token breakdown. Before this task the provider read
// only input_tokens/output_tokens and hardcoded totalCostUsd:0 into its own
// run_completed orchestration frame, discarding real spend data.

import { describe, it, expect, vi, beforeEach } from 'vitest'

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

async function collect(gen: AsyncIterable<any>) {
  const out: any[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('claude-code provider — cost + cache surfacing (F2 T9)', () => {
  beforeEach(() => { h.script = [] })

  it('surfaces total_cost_usd from the SDK result onto the done response usage', async () => {
    h.script = [{
      type: 'result', subtype: 'success', result: 'ok', session_id: 's1',
      total_cost_usd: 0.0421,
      usage: { input_tokens: 100, output_tokens: 50 },
    }]
    const provider = createClaudeCodeProvider()
    const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage.costUsd).toBe(0.0421)
    expect(done.response.usage.inputTokens).toBe(100)
    expect(done.response.usage.outputTokens).toBe(50)
  })

  it('surfaces cache_creation_input_tokens / cache_read_input_tokens onto the done response usage', async () => {
    h.script = [{
      type: 'result', subtype: 'success', result: 'ok', session_id: 's1',
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
    }]
    const provider = createClaudeCodeProvider()
    const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage.cacheCreationTokens).toBe(200)
    expect(done.response.usage.cacheReadTokens).toBe(300)
  })

  it('omits cost/cache fields entirely when the SDK result carries none (back-compat)', async () => {
    h.script = [{ type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } }]
    const provider = createClaudeCodeProvider()
    const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage).toEqual({ inputTokens: 1, outputTokens: 2 })
  })

  it('the run_completed orchestration frame carries the REAL totalCostUsd, not a hardcoded 0', async () => {
    h.script = [{
      type: 'result', subtype: 'success', result: 'ok', session_id: 's1',
      total_cost_usd: 0.099,
      usage: { input_tokens: 10, output_tokens: 20 },
    }]
    const events: any[] = []
    const provider = createClaudeCodeProvider({ getGovernance: () => ({ orchestrationSink: (e: any) => events.push(e) }) as any })
    await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', userId: 'u1' },
    } as any))

    const runCompleted = events.find((e) => e.payload.type === 'run_completed')
    expect(runCompleted.payload.status).toBe('completed')
    expect(runCompleted.payload.totalCostUsd).toBe(0.099)
    expect(runCompleted.payload.totalTokens).toBe(30)
  })

  it('a FAILED run (non-success subtype) still reports the real cost/tokens the SDK billed before it threw', async () => {
    const events: any[] = []
    h.script = [{
      type: 'result', subtype: 'error_max_turns', session_id: 's1',
      total_cost_usd: 0.055,
      usage: { input_tokens: 7, output_tokens: 3 },
    }]
    const provider = createClaudeCodeProvider({ getGovernance: () => ({ orchestrationSink: (e: any) => events.push(e) }) as any })
    let thrown: unknown
    try {
      await collect(provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { conversationId: 'c1', userId: 'u1' },
      } as any))
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeTruthy()
    const runCompleted = events.find((e) => e.payload.type === 'run_completed')
    expect(runCompleted.payload.status).toBe('failed')
    expect(runCompleted.payload.totalCostUsd).toBe(0.055)
    expect(runCompleted.payload.totalTokens).toBe(10)
  })
})
