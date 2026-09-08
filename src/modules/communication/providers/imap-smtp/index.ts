// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Generic IMAP/SMTP provider entry point.
 *
 * This module does NOT replace the existing
 * `src/modules/communication/submodules/email/adapter.ts` — that file is
 * the live adapter, polled by the channel router. Instead, this module
 * exposes a `createImapSmtpProvider(deps)` factory that wraps the
 * provider's raw inbound items with the helpers here (MIME parse,
 * signature strip, thread build) to produce a hardened `InboundEmail`
 * record matching the `EmailProvider` surface in `email-common/types.ts`.
 *
 * Typical wiring:
 *
 * ```ts
 * const provider = createImapSmtpProvider({
 *   logger,
 *   threadIndex: new ThreadIndex(),
 *   rawFetcher: adapter,       // the existing submodules/email/adapter.ts
 * })
 *
 * const stop = await provider.startListener(async (email) => {
 *   // email is a normalized InboundEmail
 * })
 * ```
 */

import type { Logger } from 'pino'

import { parseAddress, parseAddressList } from './address-parser.js'
import { parseMime } from './mime-parser.js'
import { stripSignature } from './signature-stripper.js'
import { htmlToText } from './html-to-text.js'
import { ThreadIndex, normalizeSubject } from './thread-builder.js'
import type {
  EmailAttachmentMeta,
  EmailProvider,
  FetchedAttachment,
  InboundEmail,
  OutboundEmail,
  SendResult,
} from './types.js'

/** A minimal surface the existing adapter or any upstream source must satisfy. */
export interface RawImapSource {
  /**
   * Return a batch of raw RFC 5322 messages since `since` (ms).
   * Each record carries the raw bytes plus an opaque provider id.
   */
  listRaw(since?: number): Promise<Array<{ uid: string; raw: Uint8Array; folder?: string }>>
  /**
   * Subscribe to new raw messages. The returned unsubscribe closes the subscription.
   */
  subscribeRaw?(
    onRaw: (m: { uid: string; raw: Uint8Array; folder?: string }) => void | Promise<void>,
  ): Promise<() => Promise<void>>
  sendRaw(message: OutboundEmail): Promise<SendResult>
  fetchAttachment(uid: string, attachmentId: string): Promise<FetchedAttachment>
  markAsRead(uid: string): Promise<void>
  archive(uid: string): Promise<void>
  close?(): Promise<void>
}

export interface ImapSmtpProviderDeps {
  logger: Logger
  rawFetcher: RawImapSource
  /** Optional shared thread index. A fresh one is created if not provided. */
  threadIndex?: ThreadIndex
  /** Strip signature + quoted reply from bodyText before returning. Default true. */
  stripSignatures?: boolean
}

export function createImapSmtpProvider(deps: ImapSmtpProviderDeps): EmailProvider {
  const log = deps.logger
  const threadIndex = deps.threadIndex ?? new ThreadIndex()
  const stripSigs = deps.stripSignatures ?? true

  async function normalize(item: { uid: string; raw: Uint8Array; folder?: string }): Promise<InboundEmail> {
    const parsed = parseMime(item.raw)
    const h = parsed.headers

    const from = parseAddress(h.from) ?? { address: 'unknown@unknown.invalid' }
    const to = parseAddressList(h.to)
    const cc = parseAddressList(h.cc)
    const subject = h.subject ?? ''
    const messageId = h['message-id']?.replace(/^<|>$/g, '').trim()
    const inReplyTo = h['in-reply-to']?.replace(/^<|>$/g, '').trim()
    const references = (h.references ?? '')
      .split(/\s+/)
      .map(r => r.replace(/^<|>$/g, '').trim())
      .filter(Boolean)
    const date = h.date ? Date.parse(h.date) : NaN
    const receivedAt = Number.isFinite(date) ? date : Date.now()

    let bodyText = parsed.textPlain
    if (!bodyText && parsed.textHtml) bodyText = htmlToText(parsed.textHtml)
    if (stripSigs && bodyText) {
      const stripped = stripSignature(bodyText)
      bodyText = stripped.cleanBody
    }

    const attachments: EmailAttachmentMeta[] = parsed.attachments.map((a, idx) => ({
      id: a.contentId ?? `att-${idx}`,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.data.byteLength,
      inline: false,
    })).concat(parsed.inline.map((a, idx) => ({
      id: a.contentId ?? `inline-${idx}`,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.data.byteLength,
      inline: true,
    })))

    const threadId = messageId
      ? threadIndex.add({
        messageId,
        inReplyTo,
        references,
        normalisedSubject: normalizeSubject(subject),
        receivedAt,
      })
      : undefined

    return {
      id: item.uid,
      messageId,
      threadId,
      from,
      to,
      cc,
      subject,
      bodyText,
      bodyHtml: parsed.textHtml,
      attachments,
      receivedAt,
      inReplyTo,
      references,
      headers: parsed.headers,
      folder: item.folder,
    }
  }

  return {
    id: 'email-imap-smtp',

    async init(): Promise<void> {
      log.debug('imap-smtp provider: init')
    },

    async listUnread(since?: number): Promise<InboundEmail[]> {
      const raws = await deps.rawFetcher.listRaw(since)
      const out: InboundEmail[] = []
      for (const r of raws) {
        try {
          out.push(await normalize(r))
        } catch (err) {
          log.warn({ err, uid: r.uid }, 'imap-smtp: failed to parse MIME')
        }
      }
      return out
    },

    async startListener(onMessage): Promise<() => Promise<void>> {
      if (deps.rawFetcher.subscribeRaw) {
        return deps.rawFetcher.subscribeRaw(async raw => {
          try {
            const email = await normalize(raw)
            await onMessage(email)
          } catch (err) {
            log.warn({ err, uid: raw.uid }, 'imap-smtp: listener normalize failed')
          }
        })
      }
      // No push — return a no-op stopper; the caller should poll.
      return async () => { /* nothing */ }
    },

    send(message: OutboundEmail): Promise<SendResult> {
      return deps.rawFetcher.sendRaw(message)
    },

    fetchAttachment(messageId: string, attachmentId: string): Promise<FetchedAttachment> {
      return deps.rawFetcher.fetchAttachment(messageId, attachmentId)
    },

    markAsRead(messageId: string): Promise<void> {
      return deps.rawFetcher.markAsRead(messageId)
    },

    archive(messageId: string): Promise<void> {
      return deps.rawFetcher.archive(messageId)
    },
  }
}

export { parseMime } from './mime-parser.js'
export { parseAddress, parseAddressList, formatAddressList, isValidAddress } from './address-parser.js'
export { stripSignature } from './signature-stripper.js'
export { htmlToText, decodeEntities } from './html-to-text.js'
export { ThreadIndex, buildThreads, normalizeSubject } from './thread-builder.js'
export { ImapConnectionPool, SmtpTransportPool } from './connection-pool.js'
export { buildXOAuth2String, withRefresh } from './oauth-imap.js'
