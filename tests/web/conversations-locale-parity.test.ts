// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G10 — the conversations bundle is complete in all six languages: every key
// of en.json exists, non-empty, in hu/de/es/fr/tlh with the same
// {{placeholders}}; the error and notice texts stay in the one flat
// conversations.errors.* / conversations.notice.* family (no chat.error.*).

import { describe, it, expect } from 'vitest'
import en from '../../src/web/src/pages/conversations/locales/en.json'
import hu from '../../src/web/src/pages/conversations/locales/hu.json'
import de from '../../src/web/src/pages/conversations/locales/de.json'
import es from '../../src/web/src/pages/conversations/locales/es.json'
import fr from '../../src/web/src/pages/conversations/locales/fr.json'
import tlh from '../../src/web/src/pages/conversations/locales/tlh.json'

const BUNDLES: Record<string, Record<string, string>> = { hu, de, es, fr, tlh }
const EN = en as Record<string, string>

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
}

describe('conversations locales', () => {
  for (const [lang, bundle] of Object.entries(BUNDLES)) {
    it(`(+) ${lang} has every en key, non-empty, with the same placeholders`, () => {
      const missing = Object.keys(EN).filter((k) => typeof bundle[k] !== 'string' || !bundle[k].trim())
      expect(missing).toEqual([])
      const mismatched = Object.keys(EN).filter((k) => placeholders(EN[k]).join() !== placeholders(bundle[k] ?? '').join())
      expect(mismatched).toEqual([])
    })

    it(`(−) ${lang} has no key that en does not define`, () => {
      expect(Object.keys(bundle).filter((k) => !(k in EN))).toEqual([])
    })
  }

  it('(−) no key starts with chat.error.; every error or notice text lives in conversations.errors.* / conversations.notice.*', () => {
    for (const bundle of [EN, ...Object.values(BUNDLES)]) {
      expect(Object.keys(bundle).filter((k) => k.startsWith('chat.'))).toEqual([])
      expect(Object.keys(bundle).filter((k) => /(^|\.)(error|errors|notice)\./.test(k) && !/^conversations\.(errors|notice)\./.test(k))).toEqual([])
    }
  })

  it('(+) the G10 families are present: tool statuses, outcomes, usage, error kinds, notices, approvals, progress', () => {
    const required = [
      'conversations.toolCall.status.running', 'conversations.toolCall.status.success', 'conversations.toolCall.status.error',
      'conversations.toolCall.status.denied', 'conversations.toolCall.status.approvalRequired', 'conversations.toolCall.status.skipped',
      'conversations.toolCall.status.unknown', 'conversations.toolCall.rawName',
      'conversations.outcome.maxTurns', 'conversations.outcome.maxTokens', 'conversations.outcome.refusal', 'conversations.outcome.toolBudget',
      'conversations.outcome.cancelled', 'conversations.outcome.failed', 'conversations.outcome.parked',
      'conversations.usage.tokens', 'conversations.usage.costProvider', 'conversations.usage.costEstimate',
      'conversations.usage.costUnknown', 'conversations.usage.notReported',
      'conversations.errors.auth', 'conversations.errors.rateLimit', 'conversations.errors.overload', 'conversations.errors.timeout',
      'conversations.errors.network', 'conversations.errors.aborted', 'conversations.errors.invalidRequest',
      'conversations.errors.providerRunError', 'conversations.errors.isolation', 'conversations.errors.other',
      'conversations.errors.showDetails', 'conversations.errors.hideDetails', 'conversations.errors.partialSaved',
      'conversations.errors.connection', 'conversations.errors.http',
      'conversations.errors.cliIsolation', 'conversations.errors.cliSignIn', 'conversations.errors.cliSandboxUnavailable',
      'conversations.errors.model_binding_unavailable', 'conversations.errors.no_model_configured',
      'conversations.notice.contextCompacted', 'conversations.notice.imagesNotVisible', 'conversations.notice.cliSandboxUnavailable',
      'conversations.approval.title', 'conversations.approval.reason', 'conversations.approval.approve', 'conversations.approval.reject',
      'conversations.approval.openQueue', 'conversations.approval.approved', 'conversations.approval.rejected',
      'conversations.approval.notAllowed', 'conversations.approval.retryHint',
      'conversations.agentProgress.stepOf', 'conversations.agentProgress.toolCallsCount', 'conversations.messages.assistant',
    ]
    expect(required.filter((k) => !(k in EN))).toEqual([])
  })

  it('(−) the retired keys are gone (turn counter, the cliIsolation-only settings link)', () => {
    expect('conversations.agentProgress.turnOf' in EN).toBe(false)
    expect('conversations.errors.cliIsolation.openSettings' in EN).toBe(false)
  })
})
