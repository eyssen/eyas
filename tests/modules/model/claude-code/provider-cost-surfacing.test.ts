// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 T9 — the Claude Code SDK's 'result' message carries its own authoritative
// total_cost_usd + cache-token breakdown. Before this task the provider read
// only input_tokens/output_tokens and hardcoded totalCostUsd:0 into its own
// run_completed orchestration frame, discarding real spend data. G6: the run
// frame is the agent runner's (run-tree.ts); the provider carries the billed
// cost to it — on the answer's usage, and on the error of a failed run.

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
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
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage.cacheCreationTokens).toBe(200)
    expect(done.response.usage.cacheReadTokens).toBe(300)
  })

  it('omits cost/cache fields entirely when the SDK result carries none; the usage is still reported', async () => {
    h.script = [{ type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 2 } }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage).toEqual({ inputTokens: 1, outputTokens: 2, reported: true })
  })

  // G1 canonical usage: a result without any usage or cost is "not reported"
  // (cost unknown), never a real zero-cost turn.
  it('marks the usage as not reported when the SDK result carries neither usage nor cost', async () => {
    h.script = [{ type: 'result', subtype: 'success', result: 'ok', session_id: 's1' }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const out = await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage).toEqual({ inputTokens: 0, outputTokens: 0, reported: false })
  })

  it('the answer carries the REAL billed cost for the run tree, not a hardcoded 0', async () => {
    h.script = [{
      type: 'result', subtype: 'success', result: 'ok', session_id: 's1',
      total_cost_usd: 0.099,
      usage: { input_tokens: 10, output_tokens: 20 },
    }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    const out = await collect(provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { conversationId: 'c1', userId: 'u1' },
    } as any))

    const done = out.find((e) => e.type === 'done')
    expect(done.response.usage).toMatchObject({ inputTokens: 10, outputTokens: 20, costUsd: 0.099 })
  })

  it('a FAILED run (non-success subtype) carries the real cost/tokens the SDK billed on its error', async () => {
    h.script = [{
      type: 'result', subtype: 'error_during_execution', session_id: 's1',
      total_cost_usd: 0.055,
      usage: { input_tokens: 7, output_tokens: 3 },
    }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    let thrown: any
    try {
      await collect(provider.stream({
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { conversationId: 'c1', userId: 'u1' },
      } as any))
    } catch (err) {
      thrown = err
    }
    expect(thrown?.name).toBe('ProviderRunError')
    expect(thrown.usage).toEqual({ inputTokens: 7, outputTokens: 3, costUsd: 0.055 })
  })

  it('a failed run the SDK did not price carries no cost of its own (negative)', async () => {
    h.script = [{
      type: 'result', subtype: 'error_during_execution', session_id: 's1',
      usage: { input_tokens: 7, output_tokens: 3 },
    }]
    const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
    let thrown: any
    try {
      await collect(provider.stream({ messages: [{ role: 'user', content: 'hi' }] } as any))
    } catch (err) {
      thrown = err
    }
    expect(thrown.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })
})
