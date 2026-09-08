// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { Channel, ChannelContent, ChannelMessage } from '../../types.js'
import type {
  EmailProvider,
  InboundEmail,
  OutboundEmail,
  EmailAddress,
} from '../../providers/email-common/types.js'

export interface EmailChannelOptions {
  /**
   * The channelId exposed to the router. Also used as the reply-from envelope.
   * Typically the account's primary email address ("ops@company.com").
   */
  channelId: string
  /** Human-readable name for admin UI. */
  displayName?: string
  logger: Logger
  /**
   * Default subject for outbound messages that don't carry one. Kept minimal
   * because reply flows supply their own via the originating message.
   */
  defaultSubject?: string
}

/**
 * Adapt an EmailProvider (m365 / gmail / imap-smtp) to the Channel interface
 * consumed by the communication router.
 *
 * The mapping is intentionally thin:
 *   - `connect()`        → provider.init() + startListener
 *   - `disconnect()`     → invoke the stop-function returned by startListener
 *   - `send()`           → provider.send({ to, subject, bodyText, bodyHtml })
 *   - `reply()`          → same as send, but preserves threading headers
 *   - inbound messages   → normalized to ChannelMessage with attachments metadata
 *
 * Full MIME bodies and attachment payloads are fetched lazily via the provider's
 * own API (`fetchAttachment`) — we don't pre-fetch here to keep memory usage
 * bounded when high-volume inboxes start up.
 */
export function createEmailChannelFromProvider(
  provider: EmailProvider,
  opts: EmailChannelOptions,
): Channel & { readonly providerId: string } {
  const { channelId, displayName, logger, defaultSubject = 'EYAS' } = opts

  const handlers: ((msg: ChannelMessage) => Promise<void>)[] = []
  let connected = false
  let stopListener: (() => Promise<void>) | null = null

  function toChannelMessage(email: InboundEmail): ChannelMessage {
    const subject = email.subject || '(no subject)'
    // Prefer the rendered text; HTML rendering belongs elsewhere (router or frontend).
    const body = email.bodyText?.trim() || email.bodyHtml?.trim() || ''
    const content = body ? `Subject: ${subject}\n\n${body}` : `Subject: ${subject}`

    return {
      id: `email-${provider.id}-${email.messageId ?? email.id}`,
      channelType: 'email',
      channelId,
      senderId: email.from.address,
      senderName: email.from.name,
      content,
      attachments: email.attachments.map(a => ({
        filename: a.filename,
        mimeType: a.contentType,
        // Payload is fetched on demand via provider.fetchAttachment(email.id, a.id).
        // We leave data/url empty here so the router doesn't copy large buffers.
      })),
      timestamp: new Date(email.receivedAt).toISOString(),
      // `replyToId` uses the raw message-id so thread-builder can chain replies.
      replyToId: email.inReplyTo,
    }
  }

  async function dispatch(email: InboundEmail): Promise<void> {
    const msg = toChannelMessage(email)
    for (const handler of handlers) {
      try {
        await handler(msg)
      } catch (err) {
        logger.error({ err, providerId: provider.id, messageId: email.id }, 'Email channel: handler error')
      }
    }
  }

  function contentToOutbound(to: string, content: ChannelContent, subject: string): OutboundEmail {
    const toAddress: EmailAddress = { address: to }
    return {
      to: [toAddress],
      subject,
      bodyText: content.text,
      bodyHtml: content.html,
      attachments: content.attachments?.map(a => ({
        filename: a.filename,
        contentType: a.mimeType,
        // `ChannelContent.attachments.data` is a base64 string per the type;
        // providers expect raw bytes so decode here.
        content: Buffer.from(a.data, 'base64'),
      })),
    }
  }

  return {
    id: channelId,
    type: 'email',
    name: displayName ?? `Email (${provider.id})`,
    get connected() {
      return connected
    },
    providerId: provider.id,

    async connect() {
      try {
        await provider.init()
        stopListener = await provider.startListener(dispatch)
        connected = true
        logger.info({ providerId: provider.id, channelId }, 'Email channel connected')
      } catch (err) {
        connected = false
        logger.warn({ err, providerId: provider.id, channelId }, 'Email channel failed to connect')
      }
    },

    async disconnect() {
      if (stopListener) {
        try {
          await stopListener()
        } catch (err) {
          logger.warn({ err, providerId: provider.id }, 'Email channel: listener stop failed')
        }
        stopListener = null
      }
      connected = false
      logger.info({ providerId: provider.id, channelId }, 'Email channel disconnected')
    },

    async send(to: string, content: ChannelContent) {
      if (!connected) {
        logger.warn({ providerId: provider.id, to }, 'Email channel: send skipped — not connected')
        return
      }
      try {
        await provider.send(contentToOutbound(to, content, defaultSubject))
      } catch (err) {
        logger.error({ err, providerId: provider.id, to }, 'Email channel: send failed')
      }
    },

    async reply(originalMsg: ChannelMessage, content: ChannelContent) {
      if (!connected) {
        logger.warn({ providerId: provider.id, to: originalMsg.senderId }, 'Email channel: reply skipped — not connected')
        return
      }
      // Preserve threading: inReplyTo = original message-id, prepend "Re:" if absent.
      const subject = originalMsg.content.startsWith('Subject: ')
        ? deriveReplySubject(originalMsg.content)
        : defaultSubject
      try {
        await provider.send({
          to: [{ address: originalMsg.senderId, name: originalMsg.senderName }],
          subject,
          bodyText: content.text,
          bodyHtml: content.html,
          inReplyTo: originalMsg.replyToId,
          // `references` threads longer conversations — we only know the
          // immediate parent here; providers may enrich from their own state.
          references: originalMsg.replyToId ? [originalMsg.replyToId] : undefined,
          attachments: content.attachments?.map(a => ({
            filename: a.filename,
            contentType: a.mimeType,
            content: Buffer.from(a.data, 'base64'),
          })),
        })
      } catch (err) {
        logger.error({ err, providerId: provider.id, to: originalMsg.senderId }, 'Email channel: reply failed')
      }
    },

    onMessage(handler) {
      handlers.push(handler)
    },
  }
}

/** Extract subject from a ChannelMessage.content string produced by toChannelMessage. */
function deriveReplySubject(channelContent: string): string {
  const firstLine = channelContent.split('\n', 1)[0] ?? ''
  const raw = firstLine.replace(/^Subject:\s*/i, '').trim()
  if (!raw) return 'Re:'
  // Avoid "Re: Re: Re:" chains.
  return /^re:/i.test(raw) ? raw : `Re: ${raw}`
}
