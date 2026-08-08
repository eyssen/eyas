// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EmailAddress, OutboundEmail } from '../email-common/types.js'
import type {
  GraphInternetMessageHeader,
  GraphRecipient,
  GraphSendMailPayload,
} from './types.js'

/**
 * Transform an OutboundEmail into a Graph sendMail payload.
 *
 * - Attachments are base64-encoded for `contentBytes`.
 * - inReplyTo / references become internetMessageHeaders (RFC 5322 compliant).
 * - If both bodyHtml and bodyText are provided, bodyHtml wins (Graph cannot
 *   represent multipart/alternative in a single send; the HTML typically
 *   includes a plain-text fallback on the client side).
 * - A body placeholder ('') is still sent when no body is provided, because
 *   Graph requires the field.
 */
export function outboundToMime(msg: OutboundEmail): GraphSendMailPayload {
  if (!msg.to || msg.to.length === 0) {
    throw new Error('OutboundEmail requires at least one recipient (to)')
  }
  if (!msg.subject && msg.subject !== '') {
    throw new Error('OutboundEmail requires a subject')
  }

  const payload: GraphSendMailPayload = {
    message: {
      subject: msg.subject,
      body: buildBody(msg),
      toRecipients: msg.to.map(toRecipient),
    },
    saveToSentItems: true,
  }

  if (msg.cc && msg.cc.length > 0) {
    payload.message.ccRecipients = msg.cc.map(toRecipient)
  }
  if (msg.bcc && msg.bcc.length > 0) {
    payload.message.bccRecipients = msg.bcc.map(toRecipient)
  }
  if (msg.attachments && msg.attachments.length > 0) {
    payload.message.attachments = msg.attachments.map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment' as const,
      name: a.filename,
      contentType: a.contentType,
      contentBytes: encodeBase64(a.content),
    }))
  }

  const headers = buildThreadingHeaders(msg)
  if (headers.length > 0) {
    payload.message.internetMessageHeaders = headers
  }

  return payload
}

function toRecipient(addr: EmailAddress): GraphRecipient {
  const emailAddress: { address: string; name?: string } = { address: addr.address }
  if (addr.name) emailAddress.name = addr.name
  return { emailAddress }
}

function buildBody(msg: OutboundEmail): { contentType: 'html' | 'text'; content: string } {
  if (msg.bodyHtml !== undefined) {
    return { contentType: 'html', content: msg.bodyHtml }
  }
  if (msg.bodyText !== undefined) {
    return { contentType: 'text', content: msg.bodyText }
  }
  return { contentType: 'text', content: '' }
}

function buildThreadingHeaders(msg: OutboundEmail): GraphInternetMessageHeader[] {
  const headers: GraphInternetMessageHeader[] = []
  if (msg.inReplyTo) {
    headers.push({ name: 'In-Reply-To', value: msg.inReplyTo })
  }
  if (msg.references && msg.references.length > 0) {
    headers.push({ name: 'References', value: msg.references.join(' ') })
  }
  return headers
}

/**
 * Base64-encode a Buffer or Uint8Array without Node-specific APIs.
 */
function encodeBase64(data: Buffer | Uint8Array): string {
  // Prefer native Node/Bun Buffer if available for performance.
  const g = globalThis as { Buffer?: { from: (d: Uint8Array) => { toString: (enc: string) => string } } }
  if (g.Buffer) {
    return g.Buffer.from(data).toString('base64')
  }
  // Fallback for unusual runtimes: chunked binary-string encoding.
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  // btoa is available in all modern JS runtimes.
  // eslint-disable-next-line no-undef
  return btoa(binary)
}
