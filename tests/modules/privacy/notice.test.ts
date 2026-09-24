// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { noticeLanguageOf, privacyNotice, privacyTypeLabel } from '@modules/privacy/notice'

describe('privacy channel notice', () => {
  it('follows the language the message was written in', () => {
    expect(privacyNotice(['iban'], 'Kérlek, utald át erre a számlára, és ne felejtsd el')).toMatch(/^Az üzeneted/)
    expect(privacyNotice(['iban'], 'Bitte überweise das Geld und vergiss nicht die Nummer')).toMatch(/^Deine Nachricht/)
    expect(privacyNotice(['iban'], 'Por favor, envía el dinero a la cuenta que te di')).toMatch(/^Tu mensaje/)
    expect(privacyNotice(['iban'], 'Merci de payer sur le compte que je vous ai donné')).toMatch(/^Votre message/)
    expect(privacyNotice(['iban'], 'Please pay to the account and this is the number')).toMatch(/^Your message/)
  })

  it('falls back to English when the language is unknown (negative)', () => {
    expect(noticeLanguageOf('HU42117730161111101800000000')).toBe('en')
    expect(noticeLanguageOf('')).toBe('en')
    expect(privacyNotice(['credit_card'], '4111111111111111')).toMatch(/^Your message was not delivered/)
  })

  it('names the types with localized labels, each once, and never a value', () => {
    const text = 'Please pay to HU42 1177 3016 1111 1018 0000 0000 and this is the card'
    const notice = privacyNotice(['iban', 'credit_card', 'iban'], text)
    expect(notice).toContain('(IBAN, Card number)')
    expect(notice).not.toContain('1177')
  })

  it('labels a custom pattern type by its slug', () => {
    expect(privacyTypeLabel('employee_id', 'en')).toBe('Custom pattern: employee_id')
    expect(privacyTypeLabel('employee_id', 'hu')).toBe('Egyéni minta: employee_id')
    expect(privacyTypeLabel('tax_number', 'de')).toBe('Steuernummer')
  })
})
