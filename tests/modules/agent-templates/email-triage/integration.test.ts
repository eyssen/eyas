// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  EmailClassifier,
  InMemoryRuleStore,
  NaturalLanguageFilters,
  routeAction,
  type EmailReceivedEvent,
  type InboundEmail,
  type LLMClient,
  type TriageAction,
} from '@modules/agent-templates/email-triage'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): InboundEmail {
  const path = resolve(__dirname, 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8')) as InboundEmail
}

class ScriptedLLM implements LLMClient {
  private i = 0
  constructor(private readonly responses: string[]) {}
  async complete(): Promise<string> {
    return this.responses[this.i++] ?? this.responses[this.responses.length - 1]
  }
}

/**
 * Minimal stand-in for the event bus. The real Phase-2 email adapter will
 * emit EmailReceivedEvent onto the bus; here we just call the handler
 * directly after simulating the event shape.
 */
async function handleEmailReceivedEvent(
  event: EmailReceivedEvent,
  classifier: EmailClassifier
): Promise<TriageAction> {
  const result = await classifier.classify(event.email)
  return routeAction(event.email, result)
}

describe('email-triage integration — simulated event pipeline', () => {
  it('newsletter event → archive action', async () => {
    const store = new InMemoryRuleStore()
    const classifier = new EmailClassifier(store, null)
    const event: EmailReceivedEvent = {
      type: 'email.received',
      email: loadFixture('newsletter'),
      mailboxId: 'primary',
    }
    const action = await handleEmailReceivedEvent(event, classifier)
    expect(action.kind).toBe('archive')
  })

  it('phishing event → escalate action', async () => {
    const store = new InMemoryRuleStore()
    const classifier = new EmailClassifier(store, null)
    const event: EmailReceivedEvent = {
      type: 'email.received',
      email: loadFixture('phishing'),
      mailboxId: 'primary',
    }
    const action = await handleEmailReceivedEvent(event, classifier)
    expect(action.kind).toBe('escalate')
  })

  it('reply-to-thread + LLM quick-reply → quick-reply action with draft', async () => {
    const store = new InMemoryRuleStore()
    const llm = new ScriptedLLM([
      JSON.stringify({
        bucket: 'quick-reply',
        confidence: 0.85,
        reason: 'Sender is asking a simple scheduling question',
        draft: 'Yes, July works for us — let me know which week.',
      }),
    ])
    const classifier = new EmailClassifier(store, llm)
    const event: EmailReceivedEvent = {
      type: 'email.received',
      email: loadFixture('reply-to-thread'),
      mailboxId: 'primary',
    }
    const action = await handleEmailReceivedEvent(event, classifier)
    expect(action.kind).toBe('quick-reply')
    if (action.kind === 'quick-reply') {
      expect(action.draft).toContain('July')
      expect(action.requiresApproval).toBe(true)
    }
  })

  it('rule compiled from NL then applied to an event', async () => {
    const store = new InMemoryRuleStore()
    const compilerLlm = new ScriptedLLM([
      JSON.stringify({
        label: 'Delegate vendor invoices',
        matcher: {
          from: { contains: 'vendor.example' },
          subject: { regexIsh: 'invoice|bill' },
        },
        action: { type: 'delegate', to: 'finance@eyas.example' },
      }),
    ])
    const filters = new NaturalLanguageFilters(store, compilerLlm)
    await filters.addFromNl(
      'Forward vendor invoices to finance@eyas.example'
    )

    const classifier = new EmailClassifier(store, null)
    const event: EmailReceivedEvent = {
      type: 'email.received',
      email: loadFixture('invoice'),
      mailboxId: 'primary',
    }
    const action = await handleEmailReceivedEvent(event, classifier)
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.to).toBe('finance@eyas.example')
    }
  })

  it('internal announcement with no rule and no LLM → escalate', async () => {
    const store = new InMemoryRuleStore()
    const classifier = new EmailClassifier(store, null)
    const event: EmailReceivedEvent = {
      type: 'email.received',
      email: loadFixture('internal-announcement'),
      mailboxId: 'primary',
    }
    const action = await handleEmailReceivedEvent(event, classifier)
    expect(action.kind).toBe('escalate')
  })
})
