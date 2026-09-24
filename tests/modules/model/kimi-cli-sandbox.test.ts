// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — Kimi Code CLI documents no kernel file sandbox ('unsupported'): with
// security.cliSandbox 'required' a turn with tools is refused before the
// spawn; with 'auto' it runs and says so once per conversation. A turn
// without tools (isolated) is never refused for it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { resetCliSandboxForTests, type CliSandboxDeps } from '@modules/model/cli-runtime/sandbox/index.js'
import type { ModelRequest, StreamEvent } from '@modules/model/types.js'

afterEach(() => {
  resetIsolationStatuses()
  resetCliSandboxForTests()
})

function provider(sandbox: CliSandboxDeps) {
  const runPrompt = vi.fn(async function* () {
    return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
  })
  return { runPrompt, provider: createKimiCliProvider({ runPrompt: runPrompt as any, sandbox }) }
}

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: 'user', content: 'hi' }],
  metadata: { conversationId: 'conv-k', origin: 'interactive' },
  ...extra,
})

async function collect(stream: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; error?: unknown }> {
  const events: StreamEvent[] = []
  try {
    for await (const e of stream) events.push(e)
    return { events }
  } catch (error) {
    return { events, error }
  }
}

describe('kimi-cli provider — no kernel file sandbox', () => {
  it("'required': a turn with tools is refused with cliSandboxUnavailable and nothing runs", async () => {
    const { provider: p, runPrompt } = provider({ mode: () => 'required' })
    const { error } = await collect(p.stream(request()))
    expect(error).toMatchObject({ kind: 'isolation', code: 'cliSandboxUnavailable', params: { provider: 'kimi-cli', reason: 'cli-has-none' } })
    expect(runPrompt).not.toHaveBeenCalled()
  })

  it("'auto': runs, with the notice once per conversation", async () => {
    const { provider: p, runPrompt } = provider({ mode: () => 'auto' })
    const first = await collect(p.stream(request()))
    expect(first.error).toBeUndefined()
    expect(first.events[0]).toEqual({ type: 'notice', code: 'cliSandboxUnavailable', params: { provider: 'Kimi Code CLI', reason: 'cli-has-none' } })
    const second = await collect(p.stream(request()))
    expect(second.events.some((e) => e.type === 'notice')).toBe(false)
    expect(runPrompt).toHaveBeenCalledTimes(2)
  })

  it('negative: an isolated completion is neither refused nor announced', async () => {
    const { provider: p, runPrompt } = provider({ mode: () => 'required' })
    const { error, events } = await collect(p.stream(request({ isolated: true })))
    expect(error).toBeUndefined()
    expect(events.some((e) => e.type === 'notice')).toBe(false)
    expect(runPrompt).toHaveBeenCalledTimes(1)
  })
})
