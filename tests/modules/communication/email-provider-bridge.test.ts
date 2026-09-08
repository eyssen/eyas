// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi } from 'vitest'
import type { Logger } from 'pino'
import { createEmailChannelFromProvider } from '@modules/communication/submodules/email/provider-bridge'
import type {
  EmailProvider,
  InboundEmail,
  OutboundEmail,
  SendResult,
} from '@modules/communication/providers/email-common/types'
import type { ChannelMessage } from '@modules/communication/types'

/**
 * Phase-2 regression tests — the EmailProvider → Channel bridge.
 *
 * These pin down the behaviour the router depends on: each provider becomes
 * one Channel whose connect/disconnect is wired through to the provider, and
 * inbound emails show up as correctly-shaped ChannelMessages including
 * threading metadata (`replyToId`) and attachment manifests.
 */

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger
}

/** Build a mock EmailProvider that records interactions and lets tests drive inbound. */
function makeProvider(id = 'm365'): {
  provider: EmailProvider
  deliver: (email: InboundEmail) => Promise<void>
  sentMessages: OutboundEmail[]
  stopCalls: number
} {
  let dispatcher: ((m: InboundEmail) => void | Promise<void>) | null = null
  const sentMessages: OutboundEmail[] = []
  let stopCalls = 0

  const provider: EmailProvider = {
    id,
    init: vi.fn().mockResolvedValue(undefined),
    listUnread: vi.fn().mockResolvedValue([]),
    async startListener(onMessage) {
      dispatcher = onMessage
      return async () => {
        stopCalls++
        dispatcher = null
      }
    },
    async send(message): Promise<SendResult> {
      sentMessages.push(message)
      return { providerMessageId: `sent-${sentMessages.length}` }
    },
    fetchAttachment: vi.fn(),
    markAsRead: vi.fn(),
    archive: vi.fn(),
  }

  return {
    provider,
    sentMessages,
    get stopCalls() {
      return stopCalls
    },
    async deliver(email: InboundEmail) {
      if (!dispatcher) throw new Error('No listener started — cannot deliver')
      await dispatcher(email)
    },
  } as any
}

const BASE_EMAIL: InboundEmail = {
  id: 'msg-1',
  messageId: '<msg-1@example.com>',
  from: { address: 'alice@example.com', name: 'Alice' },
  to: [{ address: 'ops@company.com' }],
  subject: 'Hello',
  bodyText: 'hi there',
  bodyHtml: undefined,
  attachments: [],
  receivedAt: 1_700_000_000_000,
  inReplyTo: undefined,
  references: undefined,
  headers: {},
}

describe('createEmailChannelFromProvider', () => {
  it('connect() runs provider.init() then starts the listener; connected becomes true', async () => {
    const { provider } = makeProvider()
    const channel = createEmailChannelFromProvider(provider, {
      channelId: 'ops@company.com',
      logger: makeLogger(),
    })

    expect(channel.connected).toBe(false)
    await channel.connect()
    expect(channel.connected).toBe(true)
    expect(provider.init).toHaveBeenCalledTimes(1)
  })

  it('maps inbound InboundEmail to ChannelMessage with threading metadata', async () => {
    const h = makeProvider('gmail')
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger: makeLogger(),
    })
    await channel.connect()

    const received: ChannelMessage[] = []
    channel.onMessage(async msg => {
      received.push(msg)
    })

    await h.deliver({
      ...BASE_EMAIL,
      id: 'm42',
      messageId: '<m42@example.com>',
      inReplyTo: '<parent@example.com>',
      subject: 'Re: greeting',
      bodyText: 'thanks!',
    })

    expect(received).toHaveLength(1)
    const msg = received[0]
    expect(msg.channelType).toBe('email')
    expect(msg.channelId).toBe('ops@company.com')
    expect(msg.senderId).toBe('alice@example.com')
    expect(msg.senderName).toBe('Alice')
    expect(msg.content).toBe('Subject: Re: greeting\n\nthanks!')
    expect(msg.replyToId).toBe('<parent@example.com>')
    expect(msg.id).toContain('gmail')
  })

  it('reply() preserves inReplyTo/references so threads chain correctly', async () => {
    const h = makeProvider('imap-smtp')
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger: makeLogger(),
    })
    await channel.connect()

    const received: ChannelMessage[] = []
    channel.onMessage(async m => { received.push(m) })
    await h.deliver({ ...BASE_EMAIL, subject: 'Question', inReplyTo: '<q@example.com>' })

    await channel.reply(received[0], { text: 'answer' })

    expect(h.sentMessages).toHaveLength(1)
    const sent = h.sentMessages[0]
    expect(sent.to[0].address).toBe('alice@example.com')
    expect(sent.bodyText).toBe('answer')
    expect(sent.inReplyTo).toBe('<q@example.com>')
    expect(sent.references).toEqual(['<q@example.com>'])
    // Reply subject should get an "Re:" prefix but not accumulate extras.
    expect(sent.subject).toBe('Re: Question')
  })

  it('reply() does not double-prefix "Re:" when the subject already has one', async () => {
    const h = makeProvider()
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger: makeLogger(),
    })
    await channel.connect()
    const received: ChannelMessage[] = []
    channel.onMessage(async m => { received.push(m) })
    await h.deliver({ ...BASE_EMAIL, subject: 'Re: already-threaded' })

    await channel.reply(received[0], { text: 'ok' })

    expect(h.sentMessages[0].subject).toBe('Re: already-threaded')
  })

  it('send() with plain text produces OutboundEmail without HTML', async () => {
    const h = makeProvider()
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger: makeLogger(),
      defaultSubject: 'EYAS notification',
    })
    await channel.connect()

    await channel.send('bob@example.com', { text: 'short note' })

    expect(h.sentMessages).toHaveLength(1)
    expect(h.sentMessages[0]).toMatchObject({
      to: [{ address: 'bob@example.com' }],
      subject: 'EYAS notification',
      bodyText: 'short note',
      bodyHtml: undefined,
    })
  })

  it('send() skips silently when the channel is not connected', async () => {
    const h = makeProvider()
    const logger = makeLogger()
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger,
    })
    // No connect() — still disconnected

    await channel.send('bob@example.com', { text: 'nope' })

    expect(h.sentMessages).toHaveLength(0)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('disconnect() calls the stop function returned by startListener and flips connected to false', async () => {
    const h = makeProvider()
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger: makeLogger(),
    })
    await channel.connect()
    expect(channel.connected).toBe(true)

    await channel.disconnect()
    expect(channel.connected).toBe(false)
    expect(h.stopCalls).toBe(1)
  })

  it('connect() failure surfaces via connected=false and does NOT throw', async () => {
    const h = makeProvider()
    ;(h.provider.init as any).mockRejectedValueOnce(new Error('auth failed'))
    const logger = makeLogger()
    const channel = createEmailChannelFromProvider(h.provider, {
      channelId: 'ops@company.com',
      logger,
    })

    // Must not throw — bootstrap registers many channels, one failing must not
    // prevent the others. connected stays false and a warn is logged.
    await expect(channel.connect()).resolves.toBeUndefined()
    expect(channel.connected).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('multiple channels from the same provider object stay independent', async () => {
    // In practice each channel has its own provider instance, but the bridge
    // must not retain cross-instance state. Two bridges sharing one mock
    // should dispatch to only the one whose listener was registered last.
    const h = makeProvider()
    const c1 = createEmailChannelFromProvider(h.provider, {
      channelId: 'a@company.com',
      logger: makeLogger(),
    })
    const c2 = createEmailChannelFromProvider(h.provider, {
      channelId: 'b@company.com',
      logger: makeLogger(),
    })

    const received1: ChannelMessage[] = []
    const received2: ChannelMessage[] = []
    c1.onMessage(async m => { received1.push(m) })
    c2.onMessage(async m => { received2.push(m) })

    await c1.connect()
    await c2.connect() // second listener overrides first in the shared mock

    await h.deliver(BASE_EMAIL)

    expect(received2).toHaveLength(1)
    expect(received2[0].channelId).toBe('b@company.com')
    expect(received1).toHaveLength(0)
  })
})
