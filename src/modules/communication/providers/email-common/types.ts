// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Common email provider types shared across all email provider implementations
 * (IMAP/SMTP, Microsoft 365, Gmail, etc.).
 */

export interface EmailAddress {
  address: string
  name?: string
}

export interface EmailAttachmentMeta {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  inline?: boolean
}

export interface InboundEmail {
  /** Provider-specific message id */
  id: string
  /** RFC 5322 Message-ID header */
  messageId?: string
  threadId?: string
  from: EmailAddress
  to: EmailAddress[]
  cc?: EmailAddress[]
  subject: string
  bodyText?: string
  bodyHtml?: string
  attachments: EmailAttachmentMeta[]
  /** ms since epoch */
  receivedAt: number
  inReplyTo?: string
  references?: string[]
  headers: Record<string, string>
  folder?: string
}

export interface OutboundEmailAttachment {
  filename: string
  contentType: string
  content: Buffer | Uint8Array
}

export interface OutboundEmail {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject: string
  bodyText?: string
  bodyHtml?: string
  attachments?: OutboundEmailAttachment[]
  inReplyTo?: string
  references?: string[]
}

export interface FetchedAttachment {
  contentType: string
  data: Uint8Array
  filename: string
}

export interface SendResult {
  providerMessageId: string
}

/**
 * Unified interface that all email providers implement.
 * The communication router consumes this surface.
 */
export interface EmailProvider {
  readonly id: string
  init(): Promise<void>
  listUnread(since?: number): Promise<InboundEmail[]>
  startListener(
    onMessage: (m: InboundEmail) => void | Promise<void>,
  ): Promise<() => Promise<void>>
  send(message: OutboundEmail): Promise<SendResult>
  fetchAttachment(messageId: string, attachmentId: string): Promise<FetchedAttachment>
  markAsRead(messageId: string): Promise<void>
  archive(messageId: string): Promise<void>
}
