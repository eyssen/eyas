// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  EmailAddress,
  EmailAttachmentMeta,
  InboundEmail,
} from '../email-common/types.js'
import type { GraphAttachment, GraphMessage, GraphRecipient } from './types.js'
import { DEFAULT_MAX_ATTACHMENT_SIZE_BYTES } from './types.js'

export interface MimeToInboundOptions {
  /** Attachments exceeding this size are dropped (warning is emitted by the listener, not here). */
  maxAttachmentSizeBytes?: number
}

/**
 * Convert a Graph Message JSON object into the unified InboundEmail shape.
 *
 * This function is pure — no I/O, no randomness. Attachments larger than the
 * size cap are excluded; callers can compare `message.attachments.length` to
 * the original Graph attachment count to know whether truncation occurred.
 */
export function mimeToInbound(
  msg: GraphMessage,
  opts: MimeToInboundOptions = {},
): InboundEmail {
  const maxSize = opts.maxAttachmentSizeBytes ?? DEFAULT_MAX_ATTACHMENT_SIZE_BYTES

  const from = addressOf(msg.from) ?? addressOf(msg.sender) ?? { address: '' }
  const to = (msg.toRecipients ?? []).map(addressOf).filter(isAddress)
  const cc = (msg.ccRecipients ?? []).map(addressOf).filter(isAddress)

  const headers = headersToRecord(msg.internetMessageHeaders)
  const inReplyTo = headers['in-reply-to']
  const references = parseReferences(headers.references)

  const attachments: EmailAttachmentMeta[] = (msg.attachments ?? [])
    .filter((a) => typeof a.size !== 'number' || a.size <= maxSize)
    .map(toAttachmentMeta)

  const { bodyText, bodyHtml } = splitBody(msg)

  return {
    id: msg.id,
    messageId: msg.internetMessageId,
    threadId: msg.conversationId,
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject: msg.subject ?? '',
    bodyText,
    bodyHtml,
    attachments,
    receivedAt: parseDate(msg.receivedDateTime),
    inReplyTo,
    references,
    headers,
    folder: msg.parentFolderId,
  }
}

function addressOf(r: GraphRecipient | undefined): EmailAddress | undefined {
  const ea = r?.emailAddress
  if (!ea?.address) return undefined
  const out: EmailAddress = { address: ea.address }
  if (ea.name) out.name = ea.name
  return out
}

function isAddress(a: EmailAddress | undefined): a is EmailAddress {
  return !!a && !!a.address
}

function headersToRecord(
  headers: Array<{ name: string; value: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const h of headers) {
    if (!h?.name) continue
    // Normalize keys to lowercase for predictable lookups.
    out[h.name.toLowerCase()] = h.value ?? ''
  }
  return out
}

function parseReferences(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const parts = raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return parts.length > 0 ? parts : undefined
}

function toAttachmentMeta(a: GraphAttachment): EmailAttachmentMeta {
  const meta: EmailAttachmentMeta = {
    id: a.id ?? '',
    filename: a.name ?? 'attachment',
    contentType: a.contentType ?? 'application/octet-stream',
    sizeBytes: typeof a.size === 'number' ? a.size : 0,
  }
  if (a.isInline) meta.inline = true
  return meta
}

function splitBody(msg: GraphMessage): { bodyText?: string; bodyHtml?: string } {
  const body = msg.body
  if (!body || typeof body.content !== 'string') {
    return {}
  }
  if (body.contentType === 'html') {
    return { bodyHtml: body.content }
  }
  return { bodyText: body.content }
}

function parseDate(iso: string | undefined): number {
  if (!iso) return 0
  const d = Date.parse(iso)
  return Number.isNaN(d) ? 0 : d
}
