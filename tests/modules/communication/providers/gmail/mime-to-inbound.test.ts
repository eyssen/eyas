// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  base64UrlDecode,
  decodeBodyPart,
  gmailMessageToInbound,
  parseAddressList,
} from '../../../../../src/modules/communication/providers/gmail/mime-to-inbound.js'
import type { GmailMessageResource } from '../../../../../src/modules/communication/providers/gmail/types.js'

function b64url(s: string): string {
  // btoa expects a binary string; encode UTF-8 bytes first so multi-byte chars
  // survive the round-trip through base64url.
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('base64UrlDecode', () => {
  it('decodes without padding', () => {
    const text = 'hello world'
    const enc = btoa(text).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    const out = base64UrlDecode(enc)
    expect(new TextDecoder().decode(out)).toBe(text)
  })
})

describe('parseAddressList', () => {
  it('parses single address with display name', () => {
    const list = parseAddressList('John Doe <john@example.com>')
    expect(list).toEqual([{ address: 'john@example.com', name: 'John Doe' }])
  })

  it('parses bare address', () => {
    const list = parseAddressList('someone@example.com')
    expect(list).toEqual([{ address: 'someone@example.com' }])
  })

  it('parses multiple addresses with quoted display-name containing comma', () => {
    const list = parseAddressList('"Doe, John" <a@b.c>, jane@example.com')
    expect(list).toEqual([
      { address: 'a@b.c', name: 'Doe, John' },
      { address: 'jane@example.com' },
    ])
  })

  it('returns empty array for undefined', () => {
    expect(parseAddressList(undefined)).toEqual([])
  })
})

describe('decodeBodyPart', () => {
  it('returns empty string when body.data is absent', () => {
    expect(decodeBodyPart({ mimeType: 'text/plain' })).toBe('')
  })

  it('decodes utf-8 text/plain', () => {
    const data = b64url('Árvíztűrő tükörfúrógép')
    const out = decodeBodyPart({
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="utf-8"' }],
      body: { data },
    })
    expect(out).toBe('Árvíztűrő tükörfúrógép')
  })

  it('decodes quoted-printable bodies', () => {
    const raw = 'Hel=6Co=0Awor=6Cd='
    const data = b64url(raw)
    const out = decodeBodyPart({
      mimeType: 'text/plain',
      headers: [
        { name: 'Content-Transfer-Encoding', value: 'quoted-printable' },
        { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
      ],
      body: { data },
    })
    expect(out).toContain('Hello')
    expect(out).toContain('world')
  })
})

describe('gmailMessageToInbound — single part', () => {
  it('builds InboundEmail from plain text payload', () => {
    const msg: GmailMessageResource = {
      id: 'abc123',
      threadId: 't1',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Alice <alice@example.com>' },
          { name: 'To', value: 'bob@example.com' },
          { name: 'Subject', value: 'Hi' },
          { name: 'Message-ID', value: '<msg-1@example.com>' },
          { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
        ],
        body: { data: b64url('hello there') },
      },
    }
    const inbound = gmailMessageToInbound(msg)
    expect(inbound.id).toBe('abc123')
    expect(inbound.threadId).toBe('t1')
    expect(inbound.from).toEqual({ address: 'alice@example.com', name: 'Alice' })
    expect(inbound.to).toEqual([{ address: 'bob@example.com' }])
    expect(inbound.subject).toBe('Hi')
    expect(inbound.bodyText).toBe('hello there')
    expect(inbound.bodyHtml).toBeUndefined()
    expect(inbound.messageId).toBe('<msg-1@example.com>')
    expect(inbound.receivedAt).toBe(1700000000000)
    expect(inbound.attachments).toEqual([])
  })
})

describe('gmailMessageToInbound — multipart/alternative', () => {
  it('collects both text and html bodies', () => {
    const msg: GmailMessageResource = {
      id: 'a',
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: 'a@b.c' },
          { name: 'To', value: 'c@d.e' },
          { name: 'Subject', value: 'Multi' },
        ],
        parts: [
          {
            mimeType: 'text/plain',
            headers: [{ name: 'Content-Type', value: 'text/plain; charset="utf-8"' }],
            body: { data: b64url('plain body') },
          },
          {
            mimeType: 'text/html',
            headers: [{ name: 'Content-Type', value: 'text/html; charset="utf-8"' }],
            body: { data: b64url('<p>html body</p>') },
          },
        ],
      },
    }
    const inbound = gmailMessageToInbound(msg)
    expect(inbound.bodyText).toBe('plain body')
    expect(inbound.bodyHtml).toBe('<p>html body</p>')
  })
})

describe('gmailMessageToInbound — multipart/mixed with attachment', () => {
  it('captures attachment metadata', () => {
    const msg: GmailMessageResource = {
      id: 'b',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'a@b.c' },
          { name: 'To', value: 'c@d.e' },
          { name: 'Subject', value: 'With attachment' },
        ],
        parts: [
          {
            mimeType: 'text/plain',
            headers: [{ name: 'Content-Type', value: 'text/plain; charset="utf-8"' }],
            body: { data: b64url('see attachment') },
          },
          {
            mimeType: 'application/pdf',
            filename: 'report.pdf',
            headers: [
              { name: 'Content-Type', value: 'application/pdf' },
              { name: 'Content-Disposition', value: 'attachment; filename="report.pdf"' },
            ],
            body: { attachmentId: 'att-1', size: 4096 },
          },
        ],
      },
    }
    const inbound = gmailMessageToInbound(msg)
    expect(inbound.bodyText).toBe('see attachment')
    expect(inbound.attachments).toHaveLength(1)
    expect(inbound.attachments[0]).toEqual({
      id: 'att-1', filename: 'report.pdf', contentType: 'application/pdf',
      sizeBytes: 4096, inline: false,
    })
  })
})

describe('gmailMessageToInbound — inline image', () => {
  it('marks inline attachments', () => {
    const msg: GmailMessageResource = {
      id: 'c',
      payload: {
        mimeType: 'multipart/related',
        headers: [
          { name: 'From', value: 'a@b.c' },
          { name: 'To', value: 'c@d.e' },
          { name: 'Subject', value: 'Inline' },
        ],
        parts: [
          {
            mimeType: 'text/html',
            headers: [{ name: 'Content-Type', value: 'text/html; charset="utf-8"' }],
            body: { data: b64url('<img src="cid:logo">') },
          },
          {
            mimeType: 'image/png',
            filename: 'logo.png',
            headers: [
              { name: 'Content-Type', value: 'image/png' },
              { name: 'Content-Disposition', value: 'inline; filename="logo.png"' },
              { name: 'Content-ID', value: '<logo>' },
            ],
            body: { attachmentId: 'img-1', size: 100 },
          },
        ],
      },
    }
    const inbound = gmailMessageToInbound(msg)
    expect(inbound.attachments[0].inline).toBe(true)
  })
})

describe('gmailMessageToInbound — References header', () => {
  it('splits References into array', () => {
    const msg: GmailMessageResource = {
      id: 'd',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@b.c' },
          { name: 'To', value: 'c@d.e' },
          { name: 'Subject', value: 'Re' },
          { name: 'In-Reply-To', value: '<one@host>' },
          { name: 'References', value: '<one@host> <two@host>' },
          { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
        ],
        body: { data: b64url('reply') },
      },
    }
    const inbound = gmailMessageToInbound(msg)
    expect(inbound.inReplyTo).toBe('<one@host>')
    expect(inbound.references).toEqual(['<one@host>', '<two@host>'])
  })
})
