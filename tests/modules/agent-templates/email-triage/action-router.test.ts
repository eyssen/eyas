// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'

import {
  routeAction,
  type ClassificationResult,
  type InboundEmail,
} from '@modules/agent-templates/email-triage'

const baseEmail: InboundEmail = {
  id: 'e-test',
  from: 'Kovács János <kovacs@example.com>',
  to: ['user@eyas.example'],
  subject: 'Quick question',
  body: 'Hi, what is the office address?',
  receivedAt: '2026-04-16T10:00:00+02:00',
}

describe('routeAction', () => {
  it('routes archive → archive action', () => {
    const classification: ClassificationResult = {
      bucket: 'archive',
      confidence: 0.9,
      reason: 'Newsletter headers',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('archive')
    if (action.kind === 'archive') {
      expect(action.emailId).toBe('e-test')
      expect(action.reason).toContain('Newsletter')
    }
  })

  it('routes quick-reply with supplied draft', () => {
    const classification: ClassificationResult = {
      bucket: 'quick-reply',
      confidence: 0.8,
      reason: 'Small factual question',
      suggestedDraft: 'Our office is at 1234 Budapest, Main street 1.',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('quick-reply')
    if (action.kind === 'quick-reply') {
      expect(action.draft).toContain('Main street')
      expect(action.requiresApproval).toBe(true)
    }
  })

  it('routes quick-reply with a fallback draft when none is supplied', () => {
    const classification: ClassificationResult = {
      bucket: 'quick-reply',
      confidence: 0.75,
      reason: 'Simple acknowledgment',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('quick-reply')
    if (action.kind === 'quick-reply') {
      expect(action.draft).toContain('Kovács János')
      expect(action.draft).toContain('Quick question')
      expect(action.draft).toContain('auto-drafted')
    }
  })

  it('routes todo → todo with title + body', () => {
    const classification: ClassificationResult = {
      bucket: 'todo',
      confidence: 0.7,
      reason: 'Client reports outage',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('todo')
    if (action.kind === 'todo') {
      expect(action.title).toBe('Email: Quick question')
      expect(action.body).toContain('From: Kovács János <kovacs@example.com>')
      expect(action.body).toContain('Triage reason: Client reports outage')
    }
  })

  it('routes escalate → escalate with confidence preserved', () => {
    const classification: ClassificationResult = {
      bucket: 'escalate',
      confidence: 0.42,
      reason: 'Ambiguous request',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('escalate')
    if (action.kind === 'escalate') {
      expect(action.confidence).toBe(0.42)
      expect(action.reason).toBe('Ambiguous request')
    }
  })

  it('routes delegate when a target is present', () => {
    const classification: ClassificationResult = {
      bucket: 'delegate',
      confidence: 1,
      reason: 'Matched rule "Invoices to finance"',
      suggestedDelegate: 'finance@acme.example',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('delegate')
    if (action.kind === 'delegate') {
      expect(action.to).toBe('finance@acme.example')
    }
  })

  it('falls back to escalate when delegate target is missing', () => {
    const classification: ClassificationResult = {
      bucket: 'delegate',
      confidence: 0.9,
      reason: 'LLM picked delegate but forgot the target',
    }
    const action = routeAction(baseEmail, classification)
    expect(action.kind).toBe('escalate')
  })
})
