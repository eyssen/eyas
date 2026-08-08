// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  decodeEncodedWords,
  parseContentType,
  parseHeaders,
  parseMime,
} from '../../../../../src/modules/communication/providers/imap-smtp/mime-parser.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf-8')

describe('mime-parser: headers', () => {
  it('parses simple headers and lowercases names', () => {
    const h = parseHeaders('From: Alice <alice@example.com>\nSubject: Hi')
    expect(h.from).toBe('Alice <alice@example.com>')
    expect(h.subject).toBe('Hi')
  })

  it('unfolds continuation lines', () => {
    const h = parseHeaders('Subject: one\n  two\n\tthree')
    expect(h.subject).toBe('one two three')
  })

  it('decodes RFC 2047 encoded words in values', () => {
    const h = parseHeaders('Subject: =?utf-8?Q?Sziasztok_=E2=80=93_teszt?=')
    expect(h.subject).toContain('Sziasztok')
    expect(h.subject).toContain('–')
  })
})

describe('mime-parser: content-type', () => {
  it('parses a plain type', () => {
    const ct = parseContentType('text/plain; charset=utf-8')
    expect(ct.type).toBe('text/plain')
    expect(ct.params.charset).toBe('utf-8')
  })

  it('strips quotes from params', () => {
    const ct = parseContentType('multipart/mixed; boundary="abc"')
    expect(ct.params.boundary).toBe('abc')
  })
})

describe('mime-parser: encoded words', () => {
  it('decodes B-encoded (base64) words', () => {
    // base64("\u00DCdv!") — Ü in UTF-8 = 0xC3 0x9C
    expect(decodeEncodedWords('=?utf-8?B?w5xkdiE=?=')).toBe('Üdv!')
  })

  it('decodes Q-encoded words with underscores-as-spaces', () => {
    expect(decodeEncodedWords('=?utf-8?Q?Helyettes=C3=ADt=C3=A9s?=')).toBe('Helyettesítés')
  })

  it('leaves non-encoded text alone', () => {
    expect(decodeEncodedWords('Plain subject')).toBe('Plain subject')
  })
})

describe('mime-parser: parseMime', () => {
  it('parses a simple plain/text message', () => {
    const mime = parseMime(fixture('simple-plain.eml'))
    expect(mime.headers.from).toContain('Alice')
    expect(mime.headers.subject).toBe('Hello world')
    expect(mime.textPlain).toContain('Hello Bob')
    expect(mime.attachments).toHaveLength(0)
  })

  it('parses multipart/alternative with QP and base64 parts', () => {
    const mime = parseMime(fixture('multipart-alternative.eml'))
    expect(mime.textPlain).toContain('árvíztűrő tükörfúrógép teszt')
    expect(mime.textHtml).toContain('<b>HTML</b>')
  })

  it('extracts attachments (content-disposition: attachment)', () => {
    const mime = parseMime(fixture('with-attachment.eml'))
    expect(mime.textPlain).toContain('invoice')
    expect(mime.attachments).toHaveLength(1)
    expect(mime.attachments[0]?.filename).toBe('invoice.pdf')
    expect(mime.attachments[0]?.contentType).toBe('application/pdf')
    expect(mime.attachments[0]?.data.length).toBeGreaterThan(0)
  })

  it('extracts inline images with Content-ID', () => {
    const mime = parseMime(fixture('inline-image.eml'))
    expect(mime.inline).toHaveLength(1)
    expect(mime.inline[0]?.contentType).toBe('image/png')
    expect(mime.inline[0]?.contentId).toBe('logo1')
    expect(mime.inline[0]?.inline).toBe(true)
  })

  it('decodes iso-8859-2 subjects', () => {
    const mime = parseMime(fixture('iso-8859-2.eml'))
    expect(mime.headers.subject).toContain('Árvíztűrő')
  })

  it('preserves threading headers', () => {
    const mime = parseMime(fixture('threaded-reply.eml'))
    expect(mime.headers['in-reply-to']).toContain('simple-1@example.com')
    expect(mime.headers['references']).toContain('simple-1@example.com')
  })

  it('enforces maxBytes', () => {
    const raw = 'From: a@b.com\r\n\r\nhello'
    expect(() => parseMime(raw, { maxBytes: 5 })).toThrow(/exceeds max size/)
  })

  it('enforces maxParts', () => {
    let payload = 'Content-Type: multipart/mixed; boundary="X"\r\n\r\n'
    for (let i = 0; i < 10; i++) {
      payload += '--X\r\nContent-Type: text/plain\r\n\r\n' + `part${i}` + '\r\n'
    }
    payload += '--X--\r\n'
    expect(() => parseMime(payload, { maxParts: 3 })).toThrow(/too many parts/)
  })
})
