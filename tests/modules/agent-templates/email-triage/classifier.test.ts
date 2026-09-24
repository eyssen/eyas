// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EmailClassifier,
  InMemoryRuleStore,
  type InboundEmail,
  type LLMClient,
  type TriageBucket,
} from '@modules/agent-templates/email-triage'
import type { CompiledRule } from '@modules/agent-templates/email-triage'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): InboundEmail {
  const path = resolve(__dirname, 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8')) as InboundEmail
}

class MockLLM implements LLMClient {
  constructor(public response: string) {}
  async complete(): Promise<string> {
    return this.response
  }
}

function makeRule(overrides: Partial<CompiledRule>): CompiledRule {
  return {
    id: 'rule-1',
    label: 'test rule',
    matcher: { from: { contains: 'example.com', caseInsensitive: true } },
    action: { type: 'archive' },
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('EmailClassifier — deterministic rule pass', () => {
  let store: InMemoryRuleStore

  beforeEach(() => {
    store = new InMemoryRuleStore()
  })

  it('matches a high-priority delegate rule', async () => {
    await store.seed([
      makeRule({
        id: 'r-finance',
        label: 'Kovács invoices to finance',
        matcher: {
          from: { contains: 'kovacs', caseInsensitive: true },
          subject: { regexIsh: 'invoice|számla', caseInsensitive: true },
        },
        action: { type: 'delegate', to: 'finance@acme.example' },
        priority: 20,
      }),
    ])
    const classifier = new EmailClassifier(store, null)

    const email: InboundEmail = {
      id: 'e1',
      from: 'kovacs@example.com',
      to: ['user@eyas.example'],
      subject: 'Invoice 2026-01',
      body: 'see attached',
      receivedAt: '2026-04-16T10:00:00+02:00',
    }

    const result = await classifier.classify(email)
    expect(result.bucket).toBe('delegate')
    expect(result.suggestedDelegate).toBe('finance@acme.example')
    expect(result.matchedRuleId).toBe('r-finance')
    expect(result.confidence).toBe(1)
  })

  it('respects priority ordering', async () => {
    await store.seed([
      makeRule({
        id: 'low',
        matcher: { subject: { contains: 'invoice', caseInsensitive: true } },
        action: { type: 'archive' },
        priority: 1,
      }),
      makeRule({
        id: 'high',
        matcher: { subject: { contains: 'invoice', caseInsensitive: true } },
        action: { type: 'todo' },
        priority: 100,
      }),
    ])
    const classifier = new EmailClassifier(store, null)

    const result = await classifier.classify({
      id: 'e2',
      from: 'a@b.example',
      to: ['user@eyas.example'],
      subject: 'Monthly invoice',
      body: '...',
      receivedAt: '2026-04-16T10:00:00+02:00',
    })
    expect(result.matchedRuleId).toBe('high')
    expect(result.bucket).toBe('todo')
  })
})

describe('EmailClassifier — heuristics', () => {
  const store = new InMemoryRuleStore()

  it.each<[string, TriageBucket]>([
    ['newsletter', 'archive'],
    ['meeting-invite', 'todo'],
    ['invoice', 'todo'],
    ['phishing', 'escalate'],
  ])('classifies %s as %s via heuristics', async (fixture, expectedBucket) => {
    const classifier = new EmailClassifier(store, null)
    const email = loadFixture(fixture)
    const result = await classifier.classify(email)
    expect(result.bucket).toBe(expectedBucket)
    expect(result.confidence).toBeGreaterThan(0.5)
  })

  it('escalates when no deterministic path and no LLM is available', async () => {
    const classifier = new EmailClassifier(store, null)
    const email = loadFixture('urgent-client')
    const result = await classifier.classify(email)
    expect(result.bucket).toBe('escalate')
    expect(result.confidence).toBe(0)
  })
})

describe('EmailClassifier — LLM fallback', () => {
  const store = new InMemoryRuleStore()

  it('parses a well-formed JSON LLM response', async () => {
    const llm = new MockLLM(
      JSON.stringify({
        bucket: 'todo',
        confidence: 0.82,
        reason: 'Client production incident',
      })
    )
    const classifier = new EmailClassifier(store, llm)
    const result = await classifier.classify(loadFixture('urgent-client'))
    expect(result.bucket).toBe('todo')
    expect(result.confidence).toBeCloseTo(0.82)
    expect(result.fromLLM).toBe(true)
  })

  it('falls back to escalate on malformed LLM output', async () => {
    const llm = new MockLLM('not json at all')
    const classifier = new EmailClassifier(store, llm)
    const result = await classifier.classify(loadFixture('urgent-client'))
    expect(result.bucket).toBe('escalate')
    expect(result.fromLLM).toBe(true)
  })

  it('applies the safety floor: quick-reply on financial content → escalate', async () => {
    const llm = new MockLLM(
      JSON.stringify({
        bucket: 'quick-reply',
        confidence: 0.95,
        reason: 'Sender wants a status update',
        draft: 'Hi, yes the invoice is paid.',
      })
    )
    const classifier = new EmailClassifier(store, llm)
    // Use a fixture that contains financial keywords in the body.
    const email: InboundEmail = {
      id: 'e-money',
      from: 'boss@example.com',
      to: ['user@eyas.example'],
      subject: 'Question',
      body: 'Did we complete the wire transfer for the invoice?',
      receivedAt: '2026-04-16T10:00:00+02:00',
    }
    const result = await classifier.classify(email)
    expect(result.bucket).toBe('escalate')
  })

  it('falls back to escalate on LLM call failure', async () => {
    const failing: LLMClient = {
      async complete() {
        throw new Error('network down')
      },
    }
    const classifier = new EmailClassifier(store, failing)
    const result = await classifier.classify(loadFixture('urgent-client'))
    expect(result.bucket).toBe('escalate')
    expect(result.fromLLM).toBe(true)
  })
})

describe('EmailClassifier — rule clause edge cases', () => {
  it('does not match a rule whose matcher is empty', async () => {
    const store = new InMemoryRuleStore()
    await store.seed([
      makeRule({ id: 'r-empty', matcher: {}, action: { type: 'archive' } }),
    ])
    const classifier = new EmailClassifier(store, null)
    const result = await classifier.classify(loadFixture('urgent-client'))
    // Should fall through to heuristics, which still returns escalate here.
    expect(result.matchedRuleId).toBeUndefined()
  })

  it('matches on regexIsh alternation (literal substrings)', async () => {
    const store = new InMemoryRuleStore()
    await store.seed([
      makeRule({
        id: 'r-alt',
        matcher: {
          subject: { regexIsh: 'invoice|bill|számla', caseInsensitive: true },
        },
        action: { type: 'todo' },
        priority: 50,
      }),
    ])
    const classifier = new EmailClassifier(store, null)
    const email: InboundEmail = {
      id: 'e-alt',
      from: 'x@y.example',
      to: ['user@eyas.example'],
      subject: 'Your monthly BILL',
      body: 'see attached',
      receivedAt: '2026-04-16T10:00:00+02:00',
    }
    const result = await classifier.classify(email)
    expect(result.bucket).toBe('todo')
    expect(result.matchedRuleId).toBe('r-alt')
  })
})
