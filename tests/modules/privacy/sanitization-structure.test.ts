// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createEgressFilter } from '@modules/privacy/egress-filter'
import { createModelGateway } from '@modules/model/gateway'
import { createEgressSlot } from '@modules/model/egress'
import type { AIProvider, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

/**
 * S5 regression tests — structure-aware sanitization, on the egress filter
 * the gateway applies to every attempt.
 *
 * An old implementation concatenated all segments with '\n', scanned the
 * concatenation, then tried to recover each segment by offset. Replacements
 * whose length differed from the original ('alice@example.com' → '[EMAIL]')
 * shifted every subsequent offset and corrupted neighbouring messages.
 *
 * These tests lock in the fix: each segment is masked in isolation and
 * written back to exactly its origin. Masking never blocks: a block-class
 * value is masked like any other.
 */

/** A remote provider (no egress host) that records what it receives. */
function remoteProvider(): AIProvider & { received: ModelRequest[] } {
  const received: ModelRequest[] = []
  return {
    id: 'remote',
    name: 'remote',
    received,
    listModels: async () => [],
    async complete(req: ModelRequest): Promise<ModelResponse> {
      received.push(req)
      return { id: 'r1', provider: 'remote', model: 'm', content: [{ type: 'text', text: 'ok' }], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *stream(req: ModelRequest): AsyncIterable<StreamEvent> {
      received.push(req)
      yield { type: 'text', text: 'ok' }
    },
  }
}

let fx: PrivacyFixture
afterEach(() => fx?.cleanup())

function filter() {
  return createEgressFilter({
    service: fx.service,
    getToolRegistry: () => undefined,
    getRecorder: () => undefined,
    logger: { debug: vi.fn() },
  })
}

const remote = remoteProvider()
const send = (req: ModelRequest) => filter().request(req, remote)

describe('Privacy sanitization — structure-aware (S5)', () => {
  it('does not drift: replacement in message[0] leaves message[1] intact', () => {
    fx = createPrivacyFixture({})
    const m0 = 'Please email alice@example.com for details.'
    const m1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const input: ModelRequest = { messages: [{ role: 'user', content: m0 }, { role: 'user', content: m1 }] }

    const passed = send(input)

    expect(passed.messages[0].content).toBe('Please email [EMAIL] for details.')
    // The critical assertion: message[1] must be BYTE-IDENTICAL to the original.
    expect(passed.messages[1].content).toBe(m1)
    expect(passed.messages[1]).toBe(input.messages[1])
  })

  it('sanitizes independent emails in separate messages without cross-talk', () => {
    fx = createPrivacyFixture({})
    const passed = send({
      messages: [
        { role: 'user', content: 'Contact: alice@example.com' },
        { role: 'user', content: 'Alt: bob@example.org' },
      ],
    })
    expect(passed.messages[0].content).toBe('Contact: [EMAIL]')
    expect(passed.messages[1].content).toBe('Alt: [EMAIL]')
  })

  it('sanitizes inside structured text blocks (Anthropic-style content arrays)', () => {
    fx = createPrivacyFixture({})
    const passed = send({
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Email me at alice@example.com' }, { type: 'text', text: 'See appendix.' }],
      }],
    })
    const blocks = passed.messages[0].content as any[]
    expect(blocks[0].text).toBe('Email me at [EMAIL]')
    expect(blocks[1].text).toBe('See appendix.')
  })

  it('masks a block-class card number in history instead of refusing the request', () => {
    fx = createPrivacyFixture({})
    let passed: ModelRequest | undefined
    expect(() => {
      passed = send({
        messages: [
          { role: 'user', content: 'Harmless.' },
          { role: 'user', content: 'Card: 4111-1111-1111-1111' },
        ],
      })
    }).not.toThrow()
    expect(passed!.messages[0].content).toBe('Harmless.')
    expect(passed!.messages[1].content).toBe('Card: [CREDIT_CARD]')
  })

  it('never turns a stream into an error frame', async () => {
    fx = createPrivacyFixture({})
    const egress = createEgressSlot()
    egress.install(filter())
    const provider = remoteProvider()
    const gateway = createModelGateway(undefined, { egress })
    gateway.registerProvider(provider)

    const events: StreamEvent[] = []
    for await (const e of gateway.stream({ provider: 'remote', system: 'IBAN HU42 1177 3016 1111 1018 0000 0000', messages: [{ role: 'user', content: 'hi' }] })) {
      events.push(e)
    }
    expect(events.map((e) => e.type)).toEqual(['text'])
    expect(provider.received[0].system).toBe('IBAN [IBAN]')
  })

  it('keeps dates and the runtime line intact', () => {
    fx = createPrivacyFixture({})
    const req: ModelRequest = { system: '- Current date: 2026-09-08', messages: [{ role: 'user', content: 'Meet on 22.09.2026 at 14:05' }] }
    expect(send(req)).toBe(req)
  })

  it('leaves requests with no matches untouched (same object)', () => {
    fx = createPrivacyFixture({})
    const req: ModelRequest = { messages: [{ role: 'user', content: 'Clean text.' }], system: 'You are helpful.' }
    expect(send(req)).toBe(req)
  })
})
