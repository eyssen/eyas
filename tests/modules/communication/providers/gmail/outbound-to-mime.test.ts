// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  outboundToGmailRaw,
  outboundToRfc822,
} from '../../../../../src/modules/communication/providers/gmail/outbound-to-mime.js'
import { base64UrlDecode } from '../../../../../src/modules/communication/providers/gmail/mime-to-inbound.js'

function decodeRaw(raw: string): string {
  return new TextDecoder().decode(base64UrlDecode(raw))
}

describe('outboundToRfc822 — single-part', () => {
  it('builds plain-text-only message with base64 body', () => {
    const rfc = outboundToRfc822({
      to: [{ address: 'r@example.com' }],
      subject: 'Hello',
      bodyText: 'Plain body',
    })
    expect(rfc).toContain('To: r@example.com')
    expect(rfc).toContain('Subject: Hello')
    expect(rfc).toContain('MIME-Version: 1.0')
    expect(rfc).toContain('Content-Type: text/plain; charset="utf-8"')
    expect(rfc).toContain('Content-Transfer-Encoding: base64')
  })

  it('formats addresses with display name and quotes comma-containing names', () => {
    const rfc = outboundToRfc822({
      to: [{ address: 'a@b.c', name: 'Doe, John' }],
      cc: [{ address: 'c@d.e', name: 'Bob' }],
      subject: 'Hi',
      bodyText: 'x',
    })
    expect(rfc).toContain('To: "Doe, John" <a@b.c>')
    expect(rfc).toContain('Cc: Bob <c@d.e>')
  })

  it('rejects header values with CR/LF (injection guard)', () => {
    expect(() => outboundToRfc822({
      to: [{ address: 'r@x' }],
      subject: 'Evil\r\nBcc: attacker@x',
      bodyText: 'x',
    })).toThrow(/CR\/LF/)
  })

  it('throws when no recipients supplied', () => {
    expect(() => outboundToRfc822({ to: [], subject: 's', bodyText: 'x' })).toThrow(/recipient/)
  })
})

describe('outboundToRfc822 — multipart/alternative', () => {
  it('wraps text and html in multipart/alternative', () => {
    const rfc = outboundToRfc822({
      to: [{ address: 'r@x' }],
      subject: 'Alt',
      bodyText: 'plain',
      bodyHtml: '<p>html</p>',
    }, { boundary: 'BOUND' })
    expect(rfc).toContain('Content-Type: multipart/alternative; boundary="BOUND"')
    expect(rfc).toContain('--BOUND')
    expect(rfc).toContain('--BOUND--')
    expect(rfc).toContain('text/plain')
    expect(rfc).toContain('text/html')
  })
})

describe('outboundToRfc822 — multipart/mixed with attachments', () => {
  it('emits mixed boundary wrapping alternative and attachment parts', () => {
    const rfc = outboundToRfc822({
      to: [{ address: 'r@x' }],
      subject: 'Att',
      bodyText: 'body',
      attachments: [{
        filename: 'a.txt',
        contentType: 'text/plain',
        content: new TextEncoder().encode('contents'),
      }],
    }, { boundary: 'B' })
    expect(rfc).toContain('Content-Type: multipart/mixed; boundary="B_mixed"')
    expect(rfc).toContain('Content-Disposition: attachment; filename="a.txt"')
    expect(rfc).toContain('--B_mixed--')
  })

  it('rejects attachment filenames with CRLF', () => {
    expect(() => outboundToRfc822({
      to: [{ address: 'r@x' }],
      subject: 's',
      bodyText: 'x',
      attachments: [{
        filename: 'a\r\nX-Header: evil.txt',
        contentType: 'text/plain',
        content: new Uint8Array(1),
      }],
    })).toThrow(/CR\/LF/)
  })
})

describe('outboundToGmailRaw roundtrip', () => {
  it('returns base64url-decodable RFC 822 string', () => {
    const raw = outboundToGmailRaw({
      to: [{ address: 'r@x' }],
      subject: 'Round',
      bodyText: 'trip',
    })
    expect(raw).not.toMatch(/[+/=]/) // base64url
    const decoded = decodeRaw(raw)
    expect(decoded).toContain('Subject: Round')
    expect(decoded).toContain('To: r@x')
  })

  it('encodes In-Reply-To and References headers', () => {
    const raw = outboundToGmailRaw({
      to: [{ address: 'r@x' }],
      subject: 'Re',
      bodyText: 'ok',
      inReplyTo: '<one@host>',
      references: ['<one@host>', '<two@host>'],
    })
    const decoded = decodeRaw(raw)
    expect(decoded).toContain('In-Reply-To: <one@host>')
    expect(decoded).toContain('References: <one@host> <two@host>')
  })
})
