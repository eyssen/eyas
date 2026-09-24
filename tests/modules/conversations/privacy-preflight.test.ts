// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import { MessagePrivacySchema, preflightUserText } from '@modules/conversations/privacy-preflight'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const EMAIL = 'john.doe@example.com'

let fx: PrivacyFixture
afterEach(() => fx?.cleanup())

describe('preflightUserText', () => {
  it('refuses a block-class value bound for a remote destination, with the masked text', () => {
    fx = createPrivacyFixture({})
    const r = preflightUserText({ privacy: fx.service, text: `IBAN ${IBAN}, mail ${EMAIL}`, localities: ['remote'] })
    expect(r).toEqual({ ok: false, types: ['iban'], maskedText: `IBAN [IBAN], mail ${EMAIL}` })
  })

  it('unknown destinations (empty list) count as remote', () => {
    fx = createPrivacyFixture({})
    expect(preflightUserText({ privacy: fx.service, text: `IBAN ${IBAN}`, localities: [] }).ok).toBe(false)
  })

  it('accepts it raw when every destination is local (negative)', () => {
    fx = createPrivacyFixture({})
    expect(preflightUserText({ privacy: fx.service, text: `IBAN ${IBAN}`, localities: ['local', 'local'] }))
      .toEqual({ ok: true, text: `IBAN ${IBAN}`, maskedTypes: [] })
  })

  it("mode 'mask' masks exactly the block-class values and reports them", () => {
    fx = createPrivacyFixture({})
    expect(preflightUserText({ privacy: fx.service, text: `IBAN ${IBAN}, mail ${EMAIL}`, localities: ['remote'], mode: 'mask' }))
      .toEqual({ ok: true, text: `IBAN [IBAN], mail ${EMAIL}`, maskedTypes: ['iban'] })
    expect(preflightUserText({ privacy: fx.service, text: `mail ${EMAIL}`, localities: ['remote'], mode: 'mask' }))
      .toEqual({ ok: true, text: `mail ${EMAIL}`, maskedTypes: [] })
  })

  it('without a privacy service or with the policy off, everything passes unchanged (negative)', () => {
    expect(preflightUserText({ privacy: undefined, text: `IBAN ${IBAN}`, localities: ['remote'] }))
      .toEqual({ ok: true, text: `IBAN ${IBAN}`, maskedTypes: [] })
    fx = createPrivacyFixture({ enabled: false })
    expect(preflightUserText({ privacy: fx.service, text: `IBAN ${IBAN}`, localities: ['remote'] }).ok).toBe(true)
  })

  it('the privacy field accepts only "mask"', () => {
    expect(MessagePrivacySchema.safeParse('mask').success).toBe(true)
    expect(MessagePrivacySchema.safeParse(undefined).success).toBe(true)
    expect(MessagePrivacySchema.safeParse('raw').success).toBe(false)
    expect(MessagePrivacySchema.safeParse(1).success).toBe(false)
  })
})
