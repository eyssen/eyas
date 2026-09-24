// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import { stripSignature } from '../../../../../src/modules/communication/providers/imap-smtp/signature-stripper.js'

describe('signature-stripper', () => {
  it('strips the RFC 3676 "-- " delimiter', () => {
    const body = 'Hello world\n\n-- \nAlice\nCEO, Example Corp'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Hello world')
    expect(res.signature).toContain('Alice')
  })

  it('strips a "Kind regards" sign-off', () => {
    const body = 'Thanks for the quick reply.\n\nKind regards,\nBob'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Thanks for the quick reply.')
    expect(res.signature).toContain('Kind regards')
  })

  it('strips "Sent from my iPhone"', () => {
    const body = 'Yes, sounds good.\n\nSent from my iPhone'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Yes, sounds good.')
    expect(res.signature).toContain('iPhone')
  })

  it('strips Hungarian sign-offs', () => {
    const body = 'Rendben, köszönöm.\n\nÜdvözlettel,\nBéla'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Rendben, köszönöm.')
    expect(res.signature).toContain('Üdvözlettel')
  })

  it('strips quoted-reply block', () => {
    const body = [
      'Thanks, that works.',
      '',
      'On Tue, 14 Apr 2026 10:00:00 +0000, Alice wrote:',
      '> Hello Bob,',
      '> This is a plain text message.',
    ].join('\n')
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Thanks, that works.')
    expect(res.quotedReply).toContain('Hello Bob')
  })

  it('strips quoted-reply AND signature together', () => {
    const body = [
      'Thanks, that works.',
      '',
      '-- ',
      'Bob Smith',
      'VP Eng',
      '',
      'On Tue, 14 Apr 2026 10:00:00 +0000, Alice wrote:',
      '> Hello Bob,',
    ].join('\n')
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Thanks, that works.')
    expect(res.signature).toContain('Bob Smith')
    expect(res.quotedReply).toContain('Hello Bob')
  })

  it('returns empty signature when none is present', () => {
    const body = 'Just a sentence.'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Just a sentence.')
    expect(res.signature).toBeUndefined()
    expect(res.quotedReply).toBeUndefined()
  })

  it('strips "-----Original Message-----" blocks', () => {
    const body = [
      'Quick update.',
      '',
      '-----Original Message-----',
      '> From: alice@example.com',
      '> Subject: Prev',
    ].join('\n')
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Quick update.')
    expect(res.quotedReply).toContain('Original Message')
  })

  it('strips "Get Outlook for iOS" type footers', () => {
    const body = 'OK.\n\nGet Outlook for iOS'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('OK.')
    expect(res.signature).toContain('Outlook')
  })

  it('handles CRLF line endings', () => {
    const body = 'Hello\r\n\r\n-- \r\nSig'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Hello')
    expect(res.signature).toContain('Sig')
  })

  it('handles empty input', () => {
    const res = stripSignature('')
    expect(res.cleanBody).toBe('')
    expect(res.signature).toBeUndefined()
    expect(res.quotedReply).toBeUndefined()
  })

  it('strips Hungarian "Tisztelettel" sign-off', () => {
    const body = 'Küldöm a szerződést.\n\nTisztelettel,\nKovács János'
    const res = stripSignature(body)
    expect(res.cleanBody).toBe('Küldöm a szerződést.')
    expect(res.signature).toContain('Tisztelettel')
  })
})
