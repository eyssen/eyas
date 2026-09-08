// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Logger } from 'pino'
import {
  createImapSmtpProvider,
  type RawImapSource,
} from '../../../../../src/modules/communication/providers/imap-smtp/index.js'
import { ThreadIndex } from '../../../../../src/modules/communication/providers/imap-smtp/thread-builder.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => readFileSync(join(here, 'fixtures', name))

function mockLogger(): Logger {
  const fn = vi.fn()
  const log = { debug: fn, info: fn, warn: fn, error: fn, trace: fn, fatal: fn }
  return log as unknown as Logger
}

/**
 * In-memory IMAP fake: returns the raw fixtures when asked.
 */
function fakeSource(names: string[]): RawImapSource & { sent: unknown[] } {
  const raws = names.map((n, i) => ({ uid: `uid-${i}`, raw: new Uint8Array(fixture(n)) }))
  const sent: unknown[] = []
  return {
    sent,
    async listRaw() { return raws },
    async sendRaw(message) { sent.push(message); return { providerMessageId: 'sent-1' } },
    async fetchAttachment() { return { contentType: 'application/octet-stream', data: new Uint8Array(), filename: 'x' } },
    async markAsRead() { /* noop */ },
    async archive() { /* noop */ },
  }
}

describe('imap-smtp provider integration', () => {
  it('normalizes a plain/text fixture into InboundEmail', async () => {
    const source = fakeSource(['simple-plain.eml'])
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    await provider.init()
    const msgs = await provider.listUnread()
    expect(msgs).toHaveLength(1)
    const m = msgs[0]!
    expect(m.from.address).toBe('alice@example.com')
    expect(m.from.name).toBe('Alice')
    expect(m.subject).toBe('Hello world')
    expect(m.messageId).toBe('simple-1@example.com')
    expect(m.bodyText).toContain('Hello Bob')
    expect(m.attachments).toHaveLength(0)
  })

  it('normalizes a multipart/alternative fixture', async () => {
    const source = fakeSource(['multipart-alternative.eml'])
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    const [m] = await provider.listUnread()
    expect(m!.bodyText).toContain('árvíztűrő')
    expect(m!.bodyHtml).toContain('<b>HTML</b>')
    expect(m!.subject).toContain('Sziasztok')
  })

  it('extracts attachments', async () => {
    const source = fakeSource(['with-attachment.eml'])
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    const [m] = await provider.listUnread()
    expect(m!.attachments).toHaveLength(1)
    expect(m!.attachments[0]?.filename).toBe('invoice.pdf')
    expect(m!.attachments[0]?.contentType).toBe('application/pdf')
    expect(m!.attachments[0]?.inline).toBe(false)
  })

  it('includes inline images in attachments with inline flag', async () => {
    const source = fakeSource(['inline-image.eml'])
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    const [m] = await provider.listUnread()
    const inlineAtts = m!.attachments.filter(a => a.inline)
    expect(inlineAtts.length).toBeGreaterThan(0)
    expect(inlineAtts[0]?.contentType).toBe('image/png')
  })

  it('builds threads across replies', async () => {
    const threadIndex = new ThreadIndex()
    const source = fakeSource(['simple-plain.eml', 'threaded-reply.eml'])
    const provider = createImapSmtpProvider({
      logger: mockLogger(),
      rawFetcher: source,
      threadIndex,
    })
    const msgs = await provider.listUnread()
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.threadId).toBe(msgs[1]!.threadId)
  })

  it('strips signatures from bodyText', async () => {
    const source = fakeSource(['threaded-reply.eml'])
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    const [m] = await provider.listUnread()
    expect(m!.bodyText).toContain('Thanks Alice')
    expect(m!.bodyText).not.toContain('Best,')
    expect(m!.bodyText).not.toContain('> Hello Bob')
  })

  it('forwards send() to the raw source', async () => {
    const source = fakeSource([])
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    const res = await provider.send({
      to: [{ address: 'to@example.com' }],
      subject: 'Hi',
      bodyText: 'Test',
    })
    expect(res.providerMessageId).toBe('sent-1')
    expect(source.sent).toHaveLength(1)
  })

  it('subscribeRaw path invokes the normalize + callback pipeline', async () => {
    let deliver: ((m: { uid: string; raw: Uint8Array }) => void) | undefined
    const source: RawImapSource = {
      async listRaw() { return [] },
      async subscribeRaw(cb) { deliver = cb; return async () => { /* noop */ } },
      async sendRaw() { return { providerMessageId: 'x' } },
      async fetchAttachment() { return { contentType: 'x', data: new Uint8Array(), filename: 'f' } },
      async markAsRead() { /* noop */ },
      async archive() { /* noop */ },
    }
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: source })
    const got: string[] = []
    await provider.startListener(async m => { got.push(m.subject) })
    deliver!({ uid: 'u1', raw: new Uint8Array(fixture('simple-plain.eml')) })
    await new Promise(r => setTimeout(r, 10))
    expect(got).toContain('Hello world')
  })

  it('logs-but-does-not-throw on malformed MIME', async () => {
    const bad: RawImapSource = {
      ...fakeSource([]),
      async listRaw() {
        const raw = new Uint8Array(1024 * 1024 * 25) // 25 MB — over default cap
        return [{ uid: 'big', raw }]
      },
    }
    const provider = createImapSmtpProvider({ logger: mockLogger(), rawFetcher: bad })
    const msgs = await provider.listUnread()
    expect(msgs).toHaveLength(0)
  })
})
