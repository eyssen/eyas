// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import { outboundToMime } from '@modules/communication/providers/m365/outbound-to-mime'
import type { OutboundEmail } from '@modules/communication/providers/email-common/types'

describe('outboundToMime', () => {
  it('maps a minimal text email to a Graph sendMail payload', () => {
    const input: OutboundEmail = {
      to: [{ address: 'user@example.com', name: 'User' }],
      subject: 'Hello',
      bodyText: 'hi there',
    }
    const out = outboundToMime(input)
    expect(out.saveToSentItems).toBe(true)
    expect(out.message.subject).toBe('Hello')
    expect(out.message.body.contentType).toBe('text')
    expect(out.message.body.content).toBe('hi there')
    expect(out.message.toRecipients).toEqual([
      { emailAddress: { address: 'user@example.com', name: 'User' } },
    ])
    expect(out.message.attachments).toBeUndefined()
  })

  it('prefers HTML body over text body', () => {
    const out = outboundToMime({
      to: [{ address: 'a@b' }],
      subject: 's',
      bodyText: 'plain',
      bodyHtml: '<p>rich</p>',
    })
    expect(out.message.body.contentType).toBe('html')
    expect(out.message.body.content).toBe('<p>rich</p>')
  })

  it('includes cc and bcc', () => {
    const out = outboundToMime({
      to: [{ address: 'a@b' }],
      cc: [{ address: 'c@b' }],
      bcc: [{ address: 'd@b' }],
      subject: 's',
      bodyText: '',
    })
    expect(out.message.ccRecipients).toEqual([{ emailAddress: { address: 'c@b' } }])
    expect(out.message.bccRecipients).toEqual([{ emailAddress: { address: 'd@b' } }])
  })

  it('encodes attachments as base64 fileAttachment entries', () => {
    const data = new Uint8Array([104, 105]) // "hi"
    const out = outboundToMime({
      to: [{ address: 'a@b' }],
      subject: 's',
      bodyText: '',
      attachments: [{ filename: 'x.txt', contentType: 'text/plain', content: data }],
    })
    const att = out.message.attachments?.[0]
    expect(att?.['@odata.type']).toBe('#microsoft.graph.fileAttachment')
    expect(att?.name).toBe('x.txt')
    expect(att?.contentType).toBe('text/plain')
    expect(att?.contentBytes).toBe(Buffer.from(data).toString('base64'))
  })

  it('adds In-Reply-To and References headers for threading', () => {
    const out = outboundToMime({
      to: [{ address: 'a@b' }],
      subject: 's',
      bodyText: '',
      inReplyTo: '<prev@example.com>',
      references: ['<a@x.com>', '<b@x.com>'],
    })
    const headers = out.message.internetMessageHeaders ?? []
    expect(headers).toContainEqual({ name: 'In-Reply-To', value: '<prev@example.com>' })
    expect(headers).toContainEqual({ name: 'References', value: '<a@x.com> <b@x.com>' })
  })

  it('throws when to[] is empty', () => {
    expect(() =>
      outboundToMime({
        to: [],
        subject: 's',
        bodyText: '',
      }),
    ).toThrow(/recipient/)
  })

  it('defaults to empty text body if neither bodyText nor bodyHtml provided', () => {
    const out = outboundToMime({
      to: [{ address: 'a@b' }],
      subject: 's',
    })
    expect(out.message.body.contentType).toBe('text')
    expect(out.message.body.content).toBe('')
  })
})
