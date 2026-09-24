// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F3 — the agent runner's tool loop against the Anthropic API provider (REAL
// SDK, stubbed fetch). The continuation request must carry the model's signed
// thinking block before its tool_use, and nothing in the prefix the block is
// bound to may change between iterations: the system prompt goes out
// byte-identical every time.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { createAgentRunner } from '@modules/agent/agent-runner'
import { createAnthropicProvider } from '@modules/model/submodules/anthropic/provider'
import type { AIProvider, ModelGateway, ModelRequest } from '@modules/model/types'
import {
  anthropicWireStub,
  sseResponse,
  textAnswerEvents,
  thinkingThenToolUseEvents,
  TEST_SIGNATURE,
} from '../../helpers/anthropic-wire'

/** A gateway that hands every request to one provider (no routing, no failover). */
function passThroughGateway(provider: AIProvider, seen: ModelRequest[]): ModelGateway {
  return {
    registerProvider: vi.fn(), unregisterProvider: vi.fn(), getProvider: vi.fn(),
    listProviders: vi.fn(() => [provider]), listAllModels: vi.fn(async () => []),
    complete: (req: ModelRequest) => provider.complete(req),
    stream(req: ModelRequest) {
      // The runner keeps appending to one history array: record a snapshot.
      seen.push({ ...req, messages: structuredClone(req.messages) })
      return provider.stream(req)
    },
    embed: vi.fn(),
  } as unknown as ModelGateway
}

const SYSTEM = 'You are EYAS. Answer briefly.\n<eyas-memory>none</eyas-memory>'
const TOOLS = [{ name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } }]

async function runLoop(firstTurn: Array<Record<string, unknown>>) {
  const wire = anthropicWireStub([() => sseResponse(firstTurn), () => sseResponse(textAnswerEvents())])
  vi.stubGlobal('fetch', wire.fetch)
  const seen: ModelRequest[] = []
  const execute = vi.fn(async () => ({ success: true, output: { sky: 'clear' }, durationMs: 1 }))
  const runner = createAgentRunner({ gateway: passThroughGateway(createAnthropicProvider('key'), seen), toolExecutor: { execute } } as any)
  const events: any[] = []
  for await (const e of runner.run({
    messages: [{ role: 'user', content: 'Weather in Paris?' }],
    tools: TOOLS,
    system: SYSTEM,
    maxTurns: 5,
    provider: 'anthropic',
    model: 'claude-opus-4-8',
  })) events.push(e)
  return { wire, seen, execute, events }
}

afterEach(() => vi.unstubAllGlobals())

describe('agent runner — reasoning continuity in the tool loop (Anthropic API)', () => {
  it('the second request replays the signed thinking block before the tool_use, byte-identical (positive)', async () => {
    const { wire, execute } = await runLoop(thinkingThenToolUseEvents())
    expect(execute).toHaveBeenCalledTimes(1)
    expect(wire.rawBodies).toHaveLength(2)

    const [, second] = wire.bodies()
    expect(second.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'The user wants the weather; call the tool.', signature: TEST_SIGNATURE },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } },
      ],
    })
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' })
    expect(wire.rawBodies[1]).toContain(`"signature":${JSON.stringify(TEST_SIGNATURE)}`)
  })

  it('the system prompt and the earlier turns are byte-identical across iterations (positive)', async () => {
    const { wire, seen } = await runLoop(thinkingThenToolUseEvents())
    const [first, second] = wire.bodies()
    // The system prompt goes as one text block carrying the prompt-cache breakpoint (I13).
    expect(JSON.stringify(second.system)).toBe(JSON.stringify(first.system))
    expect(first.system).toEqual([{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }])
    expect(seen[1]!.system).toBe(seen[0]!.system)
    // Append-only: the first request's messages are an exact prefix of the second's.
    expect(JSON.stringify(second.messages.slice(0, first.messages.length))).toBe(JSON.stringify(first.messages))
  })

  it('a turn without reasoning continues without any thinking block (negative)', async () => {
    const plain = thinkingThenToolUseEvents().filter((e: any) => !(e.index === 0 && String(e.type).startsWith('content_block')))
    const { wire } = await runLoop(plain)
    const [, second] = wire.bodies()
    expect(second.messages[1].content.map((b: any) => b.type)).toEqual(['tool_use'])
    expect(wire.rawBodies[1]).not.toContain('"type":"thinking"')
  })
})
