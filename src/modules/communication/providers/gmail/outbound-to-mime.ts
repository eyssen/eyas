// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Build an RFC 822 message from an OutboundEmail and base64url-encode it for the
 * Gmail API's `users.messages.send` endpoint.
 *
 * Rules we enforce:
 *   - Header folding at ~76 chars is NOT performed (Gmail accepts long header values).
 *   - Header values that contain newlines are rejected to avoid CRLF injection.
 *   - The body uses CRLF line endings (required by the RFC).
 *   - Attachments are base64-encoded with 76-char wrapped lines (RFC 2045).
 *   - A random boundary string is generated via crypto.getRandomValues.
 *   - If there are no attachments and only one of text/html is provided, a single-part
 *     message is emitted; otherwise a multipart/alternative (or multipart/mixed when
 *     attachments are present) wrapper is used.
 */

import type {
  EmailAddress,
  OutboundEmail,
  OutboundEmailAttachment,
} from '../email-common/types.js'
import { base64UrlEncode } from './oauth2-flow.js'

const CRLF = '\r\n'

export interface BuildMimeOptions {
  /** Test hook: deterministic boundary */
  boundary?: string
  /** Used only if the caller did not supply a From on the outbound (the EmailProvider
   *  adds it when it knows the authenticated account). */
  defaultFrom?: EmailAddress
}

function assertSafeHeaderValue(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Gmail outbound: header "${name}" contains CR/LF — refusing to build message`)
  }
}

function formatAddress(addr: EmailAddress): string {
  // A CR or LF anywhere in a header value ends the header, and everything after
  // it is read as a new one - a display name carrying "\r\nBcc: ..." would add a
  // recipient. Strip them before anything else.
  const address = addr.address.replace(/[\r\n]+/g, '')
  const name = addr.name?.replace(/[\r\n]+/g, ' ').trim()
  if (name) {
    // RFC 5322 quoted-string. Escape the backslash FIRST: doing it after the
    // quote would also escape the backslashes we just added, and a name ending
    // in a lone backslash would escape the closing quote and swallow the address.
    const quoted = /[",()<>:;@\\[\]]/.test(name)
      ? `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      : name
    return `${quoted} <${address}>`
  }
  return address
}

function formatAddressList(list: EmailAddress[] | undefined): string | undefined {
  if (!list || list.length === 0) return undefined
  return list.map(formatAddress).join(', ')
}

function generateBoundary(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `eyas_${base64UrlEncode(bytes)}`
}

function wrapBase64(b64: string, width = 76): string {
  const out: string[] = []
  for (let i = 0; i < b64.length; i += width) out.push(b64.slice(i, i + width))
  return out.join(CRLF)
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function buildHeaderBlock(headers: Record<string, string | undefined>): string {
  const lines: string[] = []
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    assertSafeHeaderValue(name, value)
    lines.push(`${name}: ${value}`)
  }
  return lines.join(CRLF)
}

function buildTextPart(text: string): string {
  const headers = buildHeaderBlock({
    'Content-Type': 'text/plain; charset="utf-8"',
    'Content-Transfer-Encoding': 'base64',
  })
  return `${headers}${CRLF}${CRLF}${wrapBase64(encodeBase64(new TextEncoder().encode(text)))}`
}

function buildHtmlPart(html: string): string {
  const headers = buildHeaderBlock({
    'Content-Type': 'text/html; charset="utf-8"',
    'Content-Transfer-Encoding': 'base64',
  })
  return `${headers}${CRLF}${CRLF}${wrapBase64(encodeBase64(new TextEncoder().encode(html)))}`
}

function buildAttachmentPart(att: OutboundEmailAttachment): string {
  if (/[\r\n]/.test(att.filename)) {
    throw new Error('Gmail outbound: attachment filename contains CR/LF')
  }
  const headers = buildHeaderBlock({
    'Content-Type': `${att.contentType}; name="${att.filename.replace(/"/g, '')}"`,
    'Content-Disposition': `attachment; filename="${att.filename.replace(/"/g, '')}"`,
    'Content-Transfer-Encoding': 'base64',
  })
  const data = att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content)
  return `${headers}${CRLF}${CRLF}${wrapBase64(encodeBase64(data))}`
}

function joinParts(boundary: string, parts: string[]): string {
  const inner = parts.map((p) => `--${boundary}${CRLF}${p}`).join(CRLF)
  return `${inner}${CRLF}--${boundary}--${CRLF}`
}

/**
 * Build an RFC 822 string. The caller normally does not need this directly; call
 * outboundToGmailRaw() to also base64url-encode for the Gmail API.
 */
export function outboundToRfc822(message: OutboundEmail, opts: BuildMimeOptions = {}): string {
  const to = formatAddressList(message.to)
  const cc = formatAddressList(message.cc)
  const bcc = formatAddressList(message.bcc)

  if (!to && !cc && !bcc) throw new Error('Gmail outbound: at least one recipient required')

  const hasAttachments = !!(message.attachments && message.attachments.length > 0)
  const hasText = !!message.bodyText
  const hasHtml = !!message.bodyHtml
  const bodyPartsCount = (hasText ? 1 : 0) + (hasHtml ? 1 : 0)

  const baseHeaders: Record<string, string | undefined> = {
    'MIME-Version': '1.0',
    To: to,
    Cc: cc,
    Bcc: bcc,
    Subject: message.subject,
    'In-Reply-To': message.inReplyTo,
    References: message.references?.join(' '),
  }
  if (opts.defaultFrom) baseHeaders.From = formatAddress(opts.defaultFrom)

  // Single-part: one body, no attachments
  if (!hasAttachments && bodyPartsCount === 1) {
    const singlePart = hasHtml
      ? { contentType: 'text/html; charset="utf-8"', data: message.bodyHtml! }
      : { contentType: 'text/plain; charset="utf-8"', data: message.bodyText! }
    const headers = buildHeaderBlock({
      ...baseHeaders,
      'Content-Type': singlePart.contentType,
      'Content-Transfer-Encoding': 'base64',
    })
    const body = wrapBase64(encodeBase64(new TextEncoder().encode(singlePart.data)))
    return `${headers}${CRLF}${CRLF}${body}${CRLF}`
  }

  // Multipart/alternative for text+html, multipart/mixed for attachments
  const altBoundary = opts.boundary ?? generateBoundary()
  const alternativeParts: string[] = []
  if (hasText) alternativeParts.push(buildTextPart(message.bodyText!))
  if (hasHtml) alternativeParts.push(buildHtmlPart(message.bodyHtml!))

  if (!hasAttachments) {
    const headers = buildHeaderBlock({
      ...baseHeaders,
      'Content-Type': `multipart/alternative; boundary="${altBoundary}"`,
    })
    return `${headers}${CRLF}${CRLF}${joinParts(altBoundary, alternativeParts)}`
  }

  // With attachments: wrap the alternative in a mixed part
  const mixedBoundary = opts.boundary ? `${opts.boundary}_mixed` : generateBoundary()
  const altBlock = alternativeParts.length > 0
    ? `Content-Type: multipart/alternative; boundary="${altBoundary}"${CRLF}${CRLF}${joinParts(altBoundary, alternativeParts)}`
    : buildTextPart('') // always ensure at least one body part exists

  const attachmentParts = (message.attachments ?? []).map(buildAttachmentPart)
  const headers = buildHeaderBlock({
    ...baseHeaders,
    'Content-Type': `multipart/mixed; boundary="${mixedBoundary}"`,
  })
  return `${headers}${CRLF}${CRLF}${joinParts(mixedBoundary, [altBlock, ...attachmentParts])}`
}

/**
 * Build the base64url-encoded `raw` field that Gmail API's messages.send expects.
 */
export function outboundToGmailRaw(message: OutboundEmail, opts: BuildMimeOptions = {}): string {
  const rfc822 = outboundToRfc822(message, opts)
  return base64UrlEncode(new TextEncoder().encode(rfc822))
}
