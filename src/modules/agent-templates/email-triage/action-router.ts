// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  ClassificationResult,
  InboundEmail,
  TriageAction,
} from './types.js'

/**
 * Maps a classification result to the concrete next step.
 *
 * The router is deliberately pure (no side effects): it produces a
 * {@link TriageAction} object that the agent runner is expected to hand
 * off to the appropriate module (board for `todo`, the communication
 * module for `quick-reply` / `delegate`, etc.).
 *
 * Every bucket except `archive` requires human approval downstream. Even
 * `archive` can be undone from the audit log.
 */
export function routeAction(
  email: InboundEmail,
  classification: ClassificationResult
): TriageAction {
  switch (classification.bucket) {
    case 'archive':
      return {
        kind: 'archive',
        emailId: email.id,
        reason: classification.reason,
      }

    case 'quick-reply': {
      const draft =
        classification.suggestedDraft?.trim() ||
        buildFallbackDraft(email, classification.reason)
      return {
        kind: 'quick-reply',
        emailId: email.id,
        draft,
        requiresApproval: true,
        reason: classification.reason,
      }
    }

    case 'todo':
      return {
        kind: 'todo',
        emailId: email.id,
        title: buildTodoTitle(email),
        body: buildTodoBody(email, classification.reason),
        reason: classification.reason,
      }

    case 'delegate': {
      if (!classification.suggestedDelegate) {
        // Missing delegate target → escalate to avoid silently dropping mail.
        return {
          kind: 'escalate',
          emailId: email.id,
          reason:
            'Delegation bucket chosen but no target address was supplied — escalated.',
          confidence: classification.confidence,
        }
      }
      return {
        kind: 'delegate',
        emailId: email.id,
        to: classification.suggestedDelegate,
        note: classification.reason,
        reason: classification.reason,
      }
    }

    case 'escalate':
    default:
      return {
        kind: 'escalate',
        emailId: email.id,
        reason: classification.reason,
        confidence: classification.confidence,
      }
  }
}

function buildFallbackDraft(email: InboundEmail, reason: string): string {
  const sender = friendlyNameFromAddress(email.from)
  return [
    `Hi ${sender},`,
    '',
    `Thanks for your message about "${email.subject}". I'll get back to you shortly.`,
    '',
    `— (auto-drafted by EYAS triage: ${reason})`,
  ].join('\n')
}

function buildTodoTitle(email: InboundEmail): string {
  const trimmed = email.subject.trim()
  const base = trimmed.length > 0 ? trimmed : '(no subject)'
  return `Email: ${base}`
}

function buildTodoBody(email: InboundEmail, reason: string): string {
  return [
    `From: ${email.from}`,
    `Received: ${email.receivedAt}`,
    `Triage reason: ${reason}`,
    '',
    '---',
    email.body.slice(0, 2000),
  ].join('\n')
}

function friendlyNameFromAddress(address: string): string {
  // "Kovács János <kovacs@example.com>" → "Kovács János"
  const match = address.match(/^\s*"?([^"<]+?)"?\s*</)
  if (match) return match[1].trim()
  // Otherwise use the local-part of the address.
  const local = address.split('@')[0]
  return local.replace(/[._-]+/g, ' ').trim() || 'there'
}

/** Exposed for tests. */
export const __internals = {
  buildFallbackDraft,
  buildTodoTitle,
  buildTodoBody,
  friendlyNameFromAddress,
}
