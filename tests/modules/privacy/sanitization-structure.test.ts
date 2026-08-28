// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import { wrapGateway } from '@modules/privacy/index'
import type { PiiMatch, PrivacyConfig, PolicyRule } from '@modules/privacy/types'
import type { ModelGateway, ModelRequest, ModelResponse } from '@modules/model/types'

/**
 * S5 regression tests — structure-aware sanitization.
 *
 * The previous implementation concatenated all segments with '\n', scanned the
 * concatenation, then tried to recover each segment by offset. Replacements
 * whose length differed from the original ('alice@example.com' → '[EMAIL]')
 * shifted every subsequent offset and corrupted neighbouring messages.
 *
 * These tests lock in the fix: each segment is sanitized in isolation and
 * written back to exactly its origin.
 */

function makeChain(matches: PiiMatch[]): { scan: (text: string) => Promise<PiiMatch[]> } {
  // Return per-segment matches: re-run the locator against each segment so
  // offsets are always segment-local (matches what regex scanners do in prod).
  return {
    async scan(text: string): Promise<PiiMatch[]> {
      return matches
        .filter(m => text.slice(m.start, m.end) === m.value)
        .map(m => ({ ...m }))
    },
  }
}

function makeGateway(): ModelGateway {
  return {
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    getProvider: vi.fn().mockReturnValue(undefined),
    listProviders: vi.fn().mockReturnValue([]),
    listAllModels: vi.fn().mockReturnValue([]),
    complete: vi.fn(async (req: ModelRequest): Promise<ModelResponse> => ({
      id: 'r1',
      provider: 'mock',
      model: 'mock',
      content: [{ type: 'text', text: JSON.stringify(req) }],
      stopReason: 'end',
      usage: { inputTokens: 0, outputTokens: 0 },
    })),
    stream: vi.fn(async function* () {}) as any,
    embed: vi.fn(),
  } as unknown as ModelGateway
}

function makeCtx() {
  return {
    bus: { emit: vi.fn() },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  } as any
}

const config: PrivacyConfig = {
  enabled: true,
  scanners: ['regex'],
  rules: [],
  custom_patterns: [],
  audit: true,
}

const rules: PolicyRule[] = [
  { pattern: 'email', action: 'sanitize' },
  { pattern: 'credit_card', action: 'block' },
]

describe('Privacy sanitization — structure-aware (S5)', () => {
  it('does not drift: replacement in message[0] leaves message[1] intact', async () => {
    // Setup: message[0] contains an email that will be sanitized to a shorter
    // placeholder. The old offset-based code would shift message[1]'s slice by
    // the length difference (18 chars → 7 chars = -11) and truncate it.
    const m0 = 'Please email alice@example.com for details.'
    const m1 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const emailStart = m0.indexOf('alice@example.com')
    const emailEnd = emailStart + 'alice@example.com'.length

    const chain = makeChain([
      {
        type: 'email',
        value: 'alice@example.com',
        start: emailStart,
        end: emailEnd,
        confidence: 0.99,
        scanner: 'regex',
      },
    ])

    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    const original: ModelRequest = {
      messages: [
        { role: 'user', content: m0 },
        { role: 'user', content: m1 },
      ],
    }

    await wrapped.complete(original)

    expect(gateway.complete).toHaveBeenCalledTimes(1)
    const passed = (gateway.complete as any).mock.calls[0][0] as ModelRequest

    expect(typeof passed.messages[0].content).toBe('string')
    expect(passed.messages[0].content).toBe('Please email [EMAIL] for details.')
    // The critical assertion: message[1] must be BYTE-IDENTICAL to the original.
    // In the old code this would be `m1.slice(0, 15)` or similar — truncated
    // by the drift caused by message[0]'s replacement.
    expect(passed.messages[1].content).toBe(m1)
  })

  it('sanitizes independent emails in separate messages without cross-talk', async () => {
    const m0 = 'Contact: alice@example.com'
    const m1 = 'Alt: bob@example.org'

    const chain = makeChain([
      { type: 'email', value: 'alice@example.com', start: m0.indexOf('alice@example.com'), end: m0.indexOf('alice@example.com') + 17, confidence: 1, scanner: 'regex' },
      { type: 'email', value: 'bob@example.org', start: m1.indexOf('bob@example.org'), end: m1.indexOf('bob@example.org') + 15, confidence: 1, scanner: 'regex' },
    ])

    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    await wrapped.complete({
      messages: [
        { role: 'user', content: m0 },
        { role: 'user', content: m1 },
      ],
    })

    const passed = (gateway.complete as any).mock.calls[0][0] as ModelRequest
    expect(passed.messages[0].content).toBe('Contact: [EMAIL]')
    expect(passed.messages[1].content).toBe('Alt: [EMAIL]')
  })

  it('sanitizes inside structured text blocks (Anthropic-style content arrays)', async () => {
    const block0 = 'Email me at alice@example.com'
    const block1 = 'See appendix.'

    const chain = makeChain([
      {
        type: 'email',
        value: 'alice@example.com',
        start: block0.indexOf('alice@example.com'),
        end: block0.indexOf('alice@example.com') + 17,
        confidence: 1,
        scanner: 'regex',
      },
    ])

    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    await wrapped.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: block0 },
            { type: 'text', text: block1 },
          ] as any,
        },
      ],
    })

    const passed = (gateway.complete as any).mock.calls[0][0] as ModelRequest
    const blocks = passed.messages[0].content as any[]
    expect(blocks[0].text).toBe('Email me at [EMAIL]')
    expect(blocks[1].text).toBe(block1)
  })

  it('blocks the whole request if any segment contains blocked PII', async () => {
    const m0 = 'Harmless.'
    const m1 = 'Card: 4111-1111-1111-1111'

    const chain = makeChain([
      {
        type: 'credit_card',
        value: '4111-1111-1111-1111',
        start: m1.indexOf('4111'),
        end: m1.indexOf('4111') + 19,
        confidence: 1,
        scanner: 'regex',
      },
    ])

    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    await expect(
      wrapped.complete({
        messages: [
          { role: 'user', content: m0 },
          { role: 'user', content: m1 },
        ],
      }),
    ).rejects.toThrow(/Privacy policy blocked/)
    expect(gateway.complete).not.toHaveBeenCalled()
  })

  it('leaves requests with no matches untouched (no unnecessary object mutation)', async () => {
    const chain = makeChain([])
    const gateway = makeGateway()
    const wrapped = wrapGateway(gateway, chain as any, rules, config, makeCtx())

    const req: ModelRequest = {
      messages: [{ role: 'user', content: 'Clean text.' }],
      system: 'You are helpful.',
    }
    await wrapped.complete(req)

    const passed = (gateway.complete as any).mock.calls[0][0] as ModelRequest
    expect(passed.messages[0].content).toBe('Clean text.')
    expect(passed.system).toBe('You are helpful.')
  })
})
