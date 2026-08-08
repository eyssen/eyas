// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import { mimeToInbound } from '@modules/communication/providers/m365/mime-to-inbound'
import type { GraphMessage } from '@modules/communication/providers/m365/types'

interface Fixture {
  name: string
  input: GraphMessage
  expect: {
    id: string
    fromAddress: string
    fromName?: string
    toCount: number
    subject: string
    bodyHtml?: string
    bodyText?: string
    attachmentCount: number
    headerLookup?: { key: string; value: string }
    receivedAt: number
    inReplyTo?: string
    references?: string[]
  }
}

const fixtures: Fixture[] = [
  {
    name: 'plain text message, no attachments',
    input: {
      id: 'AAA',
      internetMessageId: '<msg-1@example.com>',
      conversationId: 'conv-1',
      subject: 'Hello',
      from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
      toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
      body: { contentType: 'text', content: 'plain body' },
      receivedDateTime: '2026-01-02T03:04:05Z',
      internetMessageHeaders: [{ name: 'X-Custom', value: 'yes' }],
    },
    expect: {
      id: 'AAA',
      fromAddress: 'alice@example.com',
      fromName: 'Alice',
      toCount: 1,
      subject: 'Hello',
      bodyText: 'plain body',
      attachmentCount: 0,
      headerLookup: { key: 'x-custom', value: 'yes' },
      receivedAt: Date.parse('2026-01-02T03:04:05Z'),
    },
  },
  {
    name: 'html message with references and in-reply-to',
    input: {
      id: 'BBB',
      subject: 'Re: thread',
      from: { emailAddress: { address: 'alice@example.com' } },
      toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
      ccRecipients: [{ emailAddress: { address: 'cc@example.com' } }],
      body: { contentType: 'html', content: '<p>hi</p>' },
      receivedDateTime: '2026-02-02T00:00:00Z',
      internetMessageHeaders: [
        { name: 'In-Reply-To', value: '<prev@example.com>' },
        { name: 'References', value: '<a@x.com> <b@x.com>' },
      ],
    },
    expect: {
      id: 'BBB',
      fromAddress: 'alice@example.com',
      toCount: 1,
      subject: 'Re: thread',
      bodyHtml: '<p>hi</p>',
      attachmentCount: 0,
      receivedAt: Date.parse('2026-02-02T00:00:00Z'),
      inReplyTo: '<prev@example.com>',
      references: ['<a@x.com>', '<b@x.com>'],
    },
  },
  {
    name: 'message with attachments (one under cap, one over cap)',
    input: {
      id: 'CCC',
      subject: 'files',
      from: { emailAddress: { address: 'alice@example.com' } },
      toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
      body: { contentType: 'text', content: '' },
      receivedDateTime: '2026-03-03T00:00:00Z',
      hasAttachments: true,
      attachments: [
        {
          id: 'att-1',
          name: 'small.pdf',
          contentType: 'application/pdf',
          size: 1024,
          isInline: false,
        },
        {
          id: 'att-2',
          name: 'huge.zip',
          contentType: 'application/zip',
          size: 50 * 1024 * 1024,
          isInline: false,
        },
      ],
    },
    expect: {
      id: 'CCC',
      fromAddress: 'alice@example.com',
      toCount: 1,
      subject: 'files',
      bodyText: '',
      attachmentCount: 1,
      receivedAt: Date.parse('2026-03-03T00:00:00Z'),
    },
  },
  {
    name: 'fallback from sender when from is missing',
    input: {
      id: 'DDD',
      sender: { emailAddress: { address: 'sender@example.com' } },
      toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
      subject: '',
      body: { contentType: 'text', content: '' },
      receivedDateTime: '',
    },
    expect: {
      id: 'DDD',
      fromAddress: 'sender@example.com',
      toCount: 1,
      subject: '',
      bodyText: '',
      attachmentCount: 0,
      receivedAt: 0,
    },
  },
]

describe('mimeToInbound', () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      const inbound = mimeToInbound(fx.input)
      expect(inbound.id).toBe(fx.expect.id)
      expect(inbound.from.address).toBe(fx.expect.fromAddress)
      if (fx.expect.fromName !== undefined) {
        expect(inbound.from.name).toBe(fx.expect.fromName)
      }
      expect(inbound.to.length).toBe(fx.expect.toCount)
      expect(inbound.subject).toBe(fx.expect.subject)
      if (fx.expect.bodyText !== undefined) {
        expect(inbound.bodyText).toBe(fx.expect.bodyText)
      }
      if (fx.expect.bodyHtml !== undefined) {
        expect(inbound.bodyHtml).toBe(fx.expect.bodyHtml)
      }
      expect(inbound.attachments.length).toBe(fx.expect.attachmentCount)
      expect(inbound.receivedAt).toBe(fx.expect.receivedAt)
      if (fx.expect.inReplyTo !== undefined) {
        expect(inbound.inReplyTo).toBe(fx.expect.inReplyTo)
      }
      if (fx.expect.references !== undefined) {
        expect(inbound.references).toEqual(fx.expect.references)
      }
      if (fx.expect.headerLookup) {
        expect(inbound.headers[fx.expect.headerLookup.key]).toBe(fx.expect.headerLookup.value)
      }
    })
  }

  it('honors explicit maxAttachmentSizeBytes option', () => {
    const msg: GraphMessage = {
      id: 'X',
      subject: 'a',
      from: { emailAddress: { address: 'a@b' } },
      toRecipients: [{ emailAddress: { address: 'c@d' } }],
      body: { contentType: 'text', content: '' },
      receivedDateTime: '2026-01-01T00:00:00Z',
      attachments: [
        { id: '1', name: 'a', contentType: 'x', size: 100 },
        { id: '2', name: 'b', contentType: 'x', size: 2000 },
      ],
    }
    const out = mimeToInbound(msg, { maxAttachmentSizeBytes: 500 })
    expect(out.attachments.length).toBe(1)
    expect(out.attachments[0]?.id).toBe('1')
  })

  it('returns empty arrays/undefined safely for minimal input', () => {
    const out = mimeToInbound({ id: 'only-id' } as GraphMessage)
    expect(out.from.address).toBe('')
    expect(out.to).toEqual([])
    expect(out.subject).toBe('')
    expect(out.attachments).toEqual([])
    expect(out.receivedAt).toBe(0)
  })
})
