// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Local types for the IMAP/SMTP provider helpers.
 *
 * Re-exports shared types from `email-common` so downstream code only
 * needs a single import path.
 */

export type {
  EmailAddress,
  EmailAttachmentMeta,
  InboundEmail,
  OutboundEmail,
  OutboundEmailAttachment,
  FetchedAttachment,
  SendResult,
  EmailProvider,
} from '../email-common/types.js'

/**
 * A node in the MIME tree produced by {@link parseMime}.
 */
export interface MimeNode {
  headers: Record<string, string>
  contentType: string
  charset?: string
  encoding?: string
  filename?: string
  disposition?: 'inline' | 'attachment'
  contentId?: string
  /** Raw decoded bytes for leaf nodes. */
  body?: Uint8Array
  /** Decoded string (for text/*). */
  text?: string
  children: MimeNode[]
}

/**
 * Parsed MIME message. The root is always a single {@link MimeNode}.
 */
export interface ParsedMime {
  root: MimeNode
  /** Convenience: first text/plain part's decoded text. */
  textPlain?: string
  /** Convenience: first text/html part's decoded text. */
  textHtml?: string
  /** Attachments (content-disposition: attachment or any non text/* leaf). */
  attachments: MimeAttachment[]
  /** Inline attachments keyed by Content-ID (cid:xxx). */
  inline: MimeAttachment[]
  /** Top-level headers. */
  headers: Record<string, string>
}

export interface MimeAttachment {
  filename: string
  contentType: string
  contentId?: string
  inline: boolean
  data: Uint8Array
}

/**
 * A thread built from a sequence of inbound messages.
 */
export interface EmailThread {
  threadId: string
  messageIds: string[]
}

/**
 * Signature stripping result.
 */
export interface StripSignatureResult {
  cleanBody: string
  signature: string | undefined
  /** The part that was a quoted reply, stripped from cleanBody. */
  quotedReply: string | undefined
}

/**
 * Options shared by the helpers.
 */
export interface MimeParseOptions {
  /** Cap total raw message size (bytes). Default 20 MB. */
  maxBytes?: number
  /** Cap multipart nesting depth. Default 10. */
  maxDepth?: number
  /** Cap number of MIME parts. Default 500. */
  maxParts?: number
}
