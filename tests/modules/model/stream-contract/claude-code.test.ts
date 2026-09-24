// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code's normalized stream passes the G1 stream contract (G2): each
// recorded SDK message sequence is fed through the real provider (the Agent
// SDK's query() replaced by the recording) and the result is checked by the
// harness — so a Claude Code turn looks the same as any other provider's.

import { describe, it, expect, vi } from 'vitest'
import { assertStreamContract } from './harness.js'
import { CLAUDE_CODE_FIXTURES, type ClaudeCodeStreamFixture } from './fixtures/claude-code.js'
import type { ModelResponse, StreamEvent } from '@modules/model/types.js'

const h = vi.hoisted(() => ({ chunks: [] as Array<Record<string, unknown>> }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => (async function* () {
    const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
    yield fakeClaudeInit(args.options)
    for (const msg of h.chunks) yield msg
  })(),
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

async function drain(fixture: ClaudeCodeStreamFixture): Promise<StreamEvent[]> {
  h.chunks = fixture.chunks
  const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
  const events: StreamEvent[] = []
  for await (const e of provider.stream({ model: 'claude-code-sonnet', messages: [{ role: 'user', content: 'hi' }] })) events.push(e)
  return events
}

describe.each(CLAUDE_CODE_FIXTURES.map((f) => [f.name, f] as const))('Claude Code stream contract — %s', (_name, fixture) => {
  it('passes the stream-contract harness', async () => {
    const events = await drain(fixture)
    expect(() => assertStreamContract(events)).not.toThrow()
  })

  it('opens each tool row once and settles it only on its tool_result, with the real outcome and executor', async () => {
    const events = await drain(fixture)
    const starts = events.filter((e): e is Extract<StreamEvent, { type: 'tool_use_start' }> => e.type === 'tool_use_start')
    expect(starts.map((s) => s.id)).toEqual(fixture.expected.toolUseIds)
    const results = events.filter((e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result')
    expect(Object.fromEntries(results.map((r) => [r.toolUseId, { outcome: r.outcome, executedBy: r.executedBy }]))).toEqual(fixture.expected.results)
    for (const r of results) expect(r.durationMs).toBeGreaterThanOrEqual(0)
    expect(events.some((e) => (e as { type: string }).type === 'tool_use_end')).toBe(false)
  })

  it('streams each text piece exactly once and one step per model call', async () => {
    const events = await drain(fixture)
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual(fixture.expected.text)
    expect(events.filter((e) => e.type === 'step').map((e) => (e as { n: number }).n)).toEqual(
      Array.from({ length: fixture.expected.steps }, (_, i) => i + 1),
    )
  })

  it('ends with the normalized stop reason, canonical usage and the runtime-reported window', async () => {
    const events = await drain(fixture)
    const response = (events.find((e) => e.type === 'done') as { response: ModelResponse }).response
    expect(response.stopReason).toBe(fixture.expected.stopReason)
    expect(response.usage).toEqual(fixture.expected.usage)
    expect(response.contextWindow).toBe(fixture.expected.contextWindow)
  })
})
