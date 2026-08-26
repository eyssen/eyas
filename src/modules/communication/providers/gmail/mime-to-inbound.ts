// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Convert a Gmail "Message" resource (format=full) into the EYAS InboundEmail shape.
 *
 * Gmail exposes parsed MIME as a nested payload tree rather than raw bytes. We walk
 * the tree and collect the first text/plain and first text/html bodies, plus every
 * attachment (inline or otherwise). Bodies are base64url-encoded by Gmail; after
 * base64url-decode we also handle Content-Transfer-Encoding: quoted-printable and
 * base64 if those headers are present.
 */

import type {
  EmailAddress,
  EmailAttachmentMeta,
  InboundEmail,
} from '../email-common/types.js'
import type { GmailHeader, GmailMessageResource, GmailPayloadPart } from './types.js'

export function base64UrlDecode(data: string): Uint8Array {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalised.length % 4 === 0 ? '' : '='.repeat(4 - (normalised.length % 4))
  const bin = atob(normalised + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function decodeQuotedPrintable(input: string): string {
  const noSoft = input.replace(/=\r?\n/g, '')
  return noSoft.replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function getHeader(headers: GmailHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const h of headers) {
    if (h.name.toLowerCase() === lower) return h.value
  }
  return undefined
}

function collectHeaders(headers: GmailHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const h of headers) out[h.name] = h.value
  return out
}

/**
 * Parse an RFC 5322 address list. Supports "Name <addr@host>" and "addr@host".
 * Quoted display-names may contain commas, which are separators in the outer
 * list — handle quoting explicitly.
 */
export function parseAddressList(raw: string | undefined): EmailAddress[] {
  if (!raw) return []
  const out: EmailAddress[] = []
  let buf = ''
  let inQuotes = false
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes
    if (ch === ',' && !inQuotes) {
      const parsed = parseSingleAddress(buf)
      if (parsed) out.push(parsed)
      buf = ''
      continue
    }
    buf += ch
  }
  const tail = parseSingleAddress(buf)
  if (tail) out.push(tail)
  return out
}

function parseSingleAddress(raw: string): EmailAddress | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = /^(.*?)<([^>]+)>$/s.exec(trimmed)
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, '').trim()
    const address = m[2].trim()
    if (!address) return null
    return name ? { address, name } : { address }
  }
  return { address: trimmed }
}

/**
 * Decode a Gmail payload body part into a string. Returns an empty string when the
 * body is inlined via attachmentId (must be fetched separately) or when no data is
 * present.
 */
export function decodeBodyPart(part: GmailPayloadPart): string {
  if (!part.body?.data) return ''
  const bytes = base64UrlDecode(part.body.data)
  const encoding = (getHeader(part.headers, 'Content-Transfer-Encoding') ?? '').toLowerCase()
  const charset = extractCharset(getHeader(part.headers, 'Content-Type')) ?? 'utf-8'
  let raw: string
  try {
    raw = new TextDecoder(charset as BufferEncoding).decode(bytes)
  } catch {
    raw = new TextDecoder('utf-8').decode(bytes)
  }
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(raw)
  if (encoding === 'base64') {
    try {
      const inner = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
      const out = new Uint8Array(inner.length)
      for (let i = 0; i < inner.length; i++) out[i] = inner.charCodeAt(i)
      return new TextDecoder('utf-8').decode(out)
    } catch {
      return raw
    }
  }
  return raw
}

function extractCharset(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined
  const m = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)
  return m ? m[1] : undefined
}

function isAttachmentPart(part: GmailPayloadPart): boolean {
  if (part.filename && part.filename.length > 0) return true
  const disposition = (getHeader(part.headers, 'Content-Disposition') ?? '').toLowerCase()
  if (disposition.startsWith('attachment')) return true
  if ((getHeader(part.headers, 'Content-ID') ?? '').length > 0) return true
  return false
}

function isInline(part: GmailPayloadPart): boolean {
  const disposition = (getHeader(part.headers, 'Content-Disposition') ?? '').toLowerCase()
  if (disposition.startsWith('inline')) return true
  return (getHeader(part.headers, 'Content-ID') ?? '').length > 0
}

interface WalkAccumulator {
  bodyText?: string
  bodyHtml?: string
  attachments: EmailAttachmentMeta[]
}

function walk(part: GmailPayloadPart, acc: WalkAccumulator): void {
  const mime = (part.mimeType ?? '').toLowerCase()

  if (mime.startsWith('multipart/')) {
    for (const sub of part.parts ?? []) walk(sub, acc)
    return
  }

  if (isAttachmentPart(part)) {
    const attachmentId = part.body?.attachmentId
    if (!attachmentId) {
      acc.attachments.push({
        id: `inline-${acc.attachments.length}`,
        filename: part.filename ?? 'untitled',
        contentType: part.mimeType ?? 'application/octet-stream',
        sizeBytes: part.body?.size ?? 0,
        inline: isInline(part),
      })
      return
    }
    acc.attachments.push({
      id: attachmentId,
      filename: part.filename ?? 'untitled',
      contentType: part.mimeType ?? 'application/octet-stream',
      sizeBytes: part.body?.size ?? 0,
      inline: isInline(part),
    })
    return
  }

  if (mime === 'text/plain' && !acc.bodyText) {
    acc.bodyText = decodeBodyPart(part)
    return
  }
  if (mime === 'text/html' && !acc.bodyHtml) {
    acc.bodyHtml = decodeBodyPart(part)
    return
  }
}

export interface ConvertOptions {
  folder?: string
}

export function gmailMessageToInbound(msg: GmailMessageResource, opts: ConvertOptions = {}): InboundEmail {
  const acc: WalkAccumulator = { attachments: [] }
  if (msg.payload) {
    walk(msg.payload, acc)
  }

  const headers = collectHeaders(msg.payload?.headers)
  const headerList = msg.payload?.headers
  const from = parseSingleAddress(getHeader(headerList, 'From') ?? '') ?? { address: 'unknown@unknown' }
  const to = parseAddressList(getHeader(headerList, 'To'))
  const cc = parseAddressList(getHeader(headerList, 'Cc'))
  const subject = getHeader(headerList, 'Subject') ?? '(no subject)'
  const messageId = getHeader(headerList, 'Message-ID') ?? getHeader(headerList, 'Message-Id')
  const inReplyTo = getHeader(headerList, 'In-Reply-To')
  const referencesRaw = getHeader(headerList, 'References')
  const references = referencesRaw
    ? referencesRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    : undefined

  const receivedAt = msg.internalDate ? Number(msg.internalDate) : Date.now()

  return {
    id: msg.id,
    messageId,
    threadId: msg.threadId,
    from,
    to,
    cc: cc.length ? cc : undefined,
    subject,
    bodyText: acc.bodyText,
    bodyHtml: acc.bodyHtml,
    attachments: acc.attachments,
    receivedAt,
    inReplyTo,
    references,
    headers,
    folder: opts.folder,
  }
}
