// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D6 — the chat send's 422 privacy refusal body → the composer card's data.

import { describe, it, expect } from 'vitest'
import { parsePrivacyRefusal } from '../../src/web/src/pages/conversations/privacy-refusal'

describe('parsePrivacyRefusal', () => {
  it('a 422 privacy_blocked body parses into the refusal (positive)', () => {
    expect(parsePrivacyRefusal(422, {
      error: 'privacy_blocked', code: 'privacy_blocked', types: ['iban', 'credit_card'], maskedContent: 'pay to [IBAN]',
    })).toEqual({ types: ['iban', 'credit_card'], maskedContent: 'pay to [IBAN]' })
  })

  it('keeps only type slugs, each once, and tolerates a missing masked text', () => {
    expect(parsePrivacyRefusal(422, { code: 'privacy_blocked', types: ['iban', 'iban', 42, 'not a slug!', 'employee_id'] }))
      .toEqual({ types: ['iban', 'employee_id'], maskedContent: null })
  })

  it('other failures are not a privacy refusal (negative)', () => {
    expect(parsePrivacyRefusal(400, { code: 'privacy_blocked', types: ['iban'] })).toBeNull()
    expect(parsePrivacyRefusal(422, { code: 'effort_unsupported' })).toBeNull()
    expect(parsePrivacyRefusal(409, { code: 'GodModeBusyError', message: 'busy' })).toBeNull()
    expect(parsePrivacyRefusal(422, null)).toBeNull()
    expect(parsePrivacyRefusal(422, 'privacy_blocked')).toBeNull()
  })
})
