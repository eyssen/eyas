// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Lightweight MIME parser for the IMAP/SMTP provider.
 *
 * Supports:
 *   - Multipart bodies (alternative / mixed / related / anything with boundaries)
 *   - Transfer encodings: 7bit, 8bit, binary, quoted-printable, base64
 *   - Charsets: utf-8 (default), ascii, latin1 / iso-8859-1, iso-8859-2,
 *     windows-1250, windows-1252 (via TextDecoder; others fall back to utf-8)
 *   - RFC 2047 encoded-word headers (=?utf-8?B?...?=, =?utf-8?Q?...?=)
 *   - Content-Disposition / Content-ID extraction for attachments
 *
 * Bounds:
 *   - maxBytes caps the raw input length
 *   - maxDepth caps multipart nesting
 *   - maxParts caps total MIME parts
 *
 * There is NO XML in MIME; we never invoke an XML parser, so XXE is not a
 * concern here. HTML bodies are NOT executed — they're just decoded text.
 */

import type { MimeAttachment, MimeNode, MimeParseOptions, ParsedMime } from './types.js'

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_DEPTH = 10
const DEFAULT_MAX_PARTS = 500

export function parseMime(
  raw: string | Uint8Array,
  opts: MimeParseOptions = {},
): ParsedMime {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxParts = opts.maxParts ?? DEFAULT_MAX_PARTS

  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw
  if (bytes.length > maxBytes) {
    throw new Error(`MIME message exceeds max size (${bytes.length} > ${maxBytes})`)
  }

  const latin1 = bytesToLatin1(bytes)

  const state = { count: 0, limit: maxParts }
  const root = parseEntity(latin1, bytes, 0, latin1.length, 0, maxDepth, state)

  const attachments: MimeAttachment[] = []
  const inline: MimeAttachment[] = []
  let textPlain: string | undefined
  let textHtml: string | undefined

  walk(root, node => {
    if (node.children.length > 0) return
    const ct = node.contentType.toLowerCase()
    const dispo = node.disposition ?? (node.filename ? 'attachment' : undefined)
    if (dispo === 'attachment' || (ct && !ct.startsWith('text/') && !ct.startsWith('multipart/'))) {
      const att: MimeAttachment = {
        filename: node.filename ?? deriveFilename(node) ?? 'attachment.bin',
        contentType: ct || 'application/octet-stream',
        contentId: node.contentId,
        inline: dispo === 'inline',
        data: node.body ?? new Uint8Array(),
      }
      if (att.inline) inline.push(att)
      else attachments.push(att)
      return
    }
    if (ct.startsWith('text/plain') && textPlain === undefined) {
      textPlain = node.text ?? ''
    } else if (ct.startsWith('text/html') && textHtml === undefined) {
      textHtml = node.text ?? ''
    }
  })

  return {
    root,
    textPlain,
    textHtml,
    attachments,
    inline,
    headers: root.headers,
  }
}

/** Walk the tree depth-first. */
export function walk(node: MimeNode, visit: (n: MimeNode) => void): void {
  visit(node)
  for (const c of node.children) walk(c, visit)
}

// ---------- internals ----------

interface ParseState { count: number; limit: number }

function parseEntity(
  text: string,
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  maxDepth: number,
  state: ParseState,
): MimeNode {
  if (state.count++ > state.limit) {
    throw new Error(`MIME message has too many parts (> ${state.limit})`)
  }
  const hdrEnd = findHeaderEnd(text, start, end)
  const rawHeaders = text.slice(start, hdrEnd)
  const headers = parseHeaders(rawHeaders)
  const bodyStart = hdrEnd < end ? skipBlankLine(text, hdrEnd) : end

  const ctRaw = headers['content-type'] ?? 'text/plain; charset=us-ascii'
  const ct = parseContentType(ctRaw)
  const cteRaw = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase().trim()
  const dispoRaw = headers['content-disposition']
  const dispo = parseContentDisposition(dispoRaw)
  const contentIdRaw = headers['content-id']
  const contentId = contentIdRaw
    ? contentIdRaw.replace(/^<|>$/g, '').trim()
    : undefined

  const node: MimeNode = {
    headers,
    contentType: ct.type,
    charset: ct.params.charset,
    encoding: cteRaw,
    filename: ct.params.name ?? dispo?.filename,
    disposition: dispo?.value,
    contentId,
    children: [],
  }

  if (ct.type.startsWith('multipart/') && ct.params.boundary && depth < maxDepth) {
    const boundary = ct.params.boundary
    const parts = splitMultipart(text, bodyStart, end, boundary)
    for (const [ps, pe] of parts) {
      node.children.push(parseEntity(text, bytes, ps, pe, depth + 1, maxDepth, state))
    }
    return node
  }

  const bodyBytes = bytes.slice(bodyStart, end)
  const decoded = decodeTransferEncoding(bodyBytes, node.encoding ?? '7bit')
  node.body = decoded
  if (node.contentType.startsWith('text/')) {
    node.text = decodeCharset(decoded, node.charset ?? 'utf-8')
  }
  return node
}

function findHeaderEnd(text: string, start: number, end: number): number {
  const a = text.indexOf('\r\n\r\n', start)
  const b = text.indexOf('\n\n', start)
  let idx = -1
  if (a !== -1 && (b === -1 || a <= b)) idx = a
  else if (b !== -1) idx = b
  if (idx === -1 || idx >= end) return end
  return idx
}

function skipBlankLine(text: string, idx: number): number {
  if (text.startsWith('\r\n\r\n', idx)) return idx + 4
  if (text.startsWith('\n\n', idx)) return idx + 2
  let i = idx
  while (i < text.length && (text[i] === '\r' || text[i] === '\n')) i++
  return i
}

export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = raw.split(/\r?\n/)
  let current = ''
  const commit = () => {
    if (!current) return
    const colon = current.indexOf(':')
    if (colon === -1) return
    const name = current.slice(0, colon).trim().toLowerCase()
    const value = decodeEncodedWords(current.slice(colon + 1).trim())
    if (name) {
      out[name] = out[name] !== undefined ? `${out[name]}\n${value}` : value
    }
  }
  for (const line of lines) {
    if (!line) continue
    if (/^[ \t]/.test(line)) {
      current += ' ' + line.trim()
    } else {
      commit()
      current = line
    }
  }
  commit()
  return out
}

interface ContentType {
  type: string
  params: Record<string, string>
}

export function parseContentType(raw: string): ContentType {
  const [typePart, ...paramParts] = raw.split(';')
  const type = (typePart ?? '').trim().toLowerCase()
  const params: Record<string, string> = {}
  for (const p of paramParts) {
    const eq = p.indexOf('=')
    if (eq === -1) continue
    const k = p.slice(0, eq).trim().toLowerCase()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    params[k] = v
  }
  return { type: type || 'text/plain', params }
}

export function parseContentDisposition(raw: string | undefined):
  { value: 'inline' | 'attachment'; filename?: string } | undefined {
  if (!raw) return undefined
  const [firstToken, ...rest] = raw.split(';')
  const token = (firstToken ?? '').trim().toLowerCase()
  const value: 'inline' | 'attachment' = token === 'inline' ? 'inline' : 'attachment'
  let filename: string | undefined
  for (const p of rest) {
    const eq = p.indexOf('=')
    if (eq === -1) continue
    const k = p.slice(0, eq).trim().toLowerCase()
    let v = p.slice(eq + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    if (k === 'filename' || k === 'filename*') filename = decodeRfc2231(v) ?? v
  }
  return { value, filename }
}

function decodeRfc2231(v: string): string | undefined {
  const m = /^([\w-]*)'[\w-]*'(.*)$/.exec(v)
  if (!m) return undefined
  try {
    return decodeURIComponent(m[2] ?? '')
  } catch {
    return undefined
  }
}

function splitMultipart(text: string, start: number, end: number, boundary: string): [number, number][] {
  const needle = `--${boundary}`
  const out: [number, number][] = []
  let cursor = start
  let firstBoundary = -1
  while (cursor < end) {
    const idx = text.indexOf(needle, cursor)
    if (idx === -1 || idx >= end) break
    if (firstBoundary === -1) {
      firstBoundary = idx
      cursor = idx + needle.length
      continue
    }
    const regionEnd = trimTrailingCrlf(text, idx)
    const regionStart = skipLineEnd(text, firstBoundary + needle.length)
    out.push([regionStart, regionEnd])
    if (text.startsWith('--', idx + needle.length)) break
    firstBoundary = idx
    cursor = idx + needle.length
  }
  return out
}

function skipLineEnd(text: string, i: number): number {
  if (text.startsWith('\r\n', i)) return i + 2
  if (text[i] === '\n') return i + 1
  return i
}

function trimTrailingCrlf(text: string, end: number): number {
  let e = end
  if (e > 0 && text[e - 1] === '\n') e--
  if (e > 0 && text[e - 1] === '\r') e--
  return e
}

// ---------- transfer encoding ----------

function decodeTransferEncoding(body: Uint8Array, enc: string): Uint8Array {
  const e = enc.toLowerCase().trim()
  if (e === 'base64') return decodeBase64(body)
  if (e === 'quoted-printable') return decodeQuotedPrintable(body)
  return body
}

function decodeBase64(body: Uint8Array): Uint8Array {
  const s = bytesToLatin1(body).replace(/\s+/g, '')
  try {
    const bin = base64ToBinary(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
    return out
  } catch {
    return new Uint8Array()
  }
}

function base64ToBinary(s: string): string {
  const g = globalThis as Record<string, unknown>
  const ab = g.atob as ((input: string) => string) | undefined
  if (typeof ab === 'function') return ab(s)
  const Buf = g.Buffer as { from(input: string, enc: string): { toString(enc: string): string } } | undefined
  if (Buf) return Buf.from(s, 'base64').toString('latin1')
  throw new Error('No base64 decoder available')
}

function decodeQuotedPrintable(body: Uint8Array): Uint8Array {
  const s = bytesToLatin1(body)
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '=') {
      const next = s[i + 1]
      if (next === '\n') { i += 1; continue }
      if (next === '\r' && s[i + 2] === '\n') { i += 2; continue }
      const hex = s.slice(i + 1, i + 3)
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16))
        i += 2
        continue
      }
      out.push(ch!.charCodeAt(0))
    } else {
      out.push(ch!.charCodeAt(0) & 0xff)
    }
  }
  return new Uint8Array(out)
}

// ---------- charset ----------

function decodeCharset(body: Uint8Array, charset: string): string {
  const cs = normalizeCharset(charset)
  // Some runtimes (e.g. Bun) lack TextDecoder entries for older single-byte
  // code pages. Fall back to a manual table for the ones we actually see.
  if (SINGLE_BYTE_MAPS[cs]) {
    return decodeSingleByte(body, SINGLE_BYTE_MAPS[cs]!)
  }
  try {
    return new TextDecoder(cs, { fatal: false }).decode(body)
  } catch {
    // If it's a known legacy label we didn't map, fall through.
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(body)
    } catch {
      return bytesToLatin1(body)
    }
  }
}

function decodeSingleByte(body: Uint8Array, map: string): string {
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const b = body[i]!
    if (b < 0x80) out += String.fromCharCode(b)
    else out += map[b - 0x80] ?? '\ufffd'
  }
  return out
}

/**
 * ISO-8859-2 (Latin-2) upper-half mapping (0x80..0xFF), used for common
 * Central European encodings missing from Bun's TextDecoder.
 * Source: Unicode.org MAPPINGS/ISO8859/8859-2.TXT.
 */
const ISO_8859_2 =
  '\u0080\u0081\u0082\u0083\u0084\u0085\u0086\u0087\u0088\u0089\u008A\u008B\u008C\u008D\u008E\u008F' +
  '\u0090\u0091\u0092\u0093\u0094\u0095\u0096\u0097\u0098\u0099\u009A\u009B\u009C\u009D\u009E\u009F' +
  '\u00A0\u0104\u02D8\u0141\u00A4\u013D\u015A\u00A7\u00A8\u0160\u015E\u0164\u0179\u00AD\u017D\u017B' +
  '\u00B0\u0105\u02DB\u0142\u00B4\u013E\u015B\u02C7\u00B8\u0161\u015F\u0165\u017A\u02DD\u017E\u017C' +
  '\u0154\u00C1\u00C2\u0102\u00C4\u0139\u0106\u00C7\u010C\u00C9\u0118\u00CB\u011A\u00CD\u00CE\u010E' +
  '\u0110\u0143\u0147\u00D3\u00D4\u0150\u00D6\u00D7\u0158\u016E\u00DA\u0170\u00DC\u00DD\u0162\u00DF' +
  '\u0155\u00E1\u00E2\u0103\u00E4\u013A\u0107\u00E7\u010D\u00E9\u0119\u00EB\u011B\u00ED\u00EE\u010F' +
  '\u0111\u0144\u0148\u00F3\u00F4\u0151\u00F6\u00F7\u0159\u016F\u00FA\u0171\u00FC\u00FD\u0163\u02D9'

/** Windows-1250 (Central European) upper-half mapping. */
const WIN_1250 =
  '\u20AC\ufffd\u201A\ufffd\u201E\u2026\u2020\u2021\ufffd\u2030\u0160\u2039\u015A\u0164\u017D\u0179' +
  '\ufffd\u2018\u2019\u201C\u201D\u2022\u2013\u2014\ufffd\u2122\u0161\u203A\u015B\u0165\u017E\u017A' +
  '\u00A0\u02C7\u02D8\u0141\u00A4\u0104\u00A6\u00A7\u00A8\u00A9\u015E\u00AB\u00AC\u00AD\u00AE\u017B' +
  '\u00B0\u00B1\u02DB\u0142\u00B4\u00B5\u00B6\u00B7\u00B8\u0105\u015F\u00BB\u013D\u02DD\u013E\u017C' +
  '\u0154\u00C1\u00C2\u0102\u00C4\u0139\u0106\u00C7\u010C\u00C9\u0118\u00CB\u011A\u00CD\u00CE\u010E' +
  '\u0110\u0143\u0147\u00D3\u00D4\u0150\u00D6\u00D7\u0158\u016E\u00DA\u0170\u00DC\u00DD\u0162\u00DF' +
  '\u0155\u00E1\u00E2\u0103\u00E4\u013A\u0107\u00E7\u010D\u00E9\u0119\u00EB\u011B\u00ED\u00EE\u010F' +
  '\u0111\u0144\u0148\u00F3\u00F4\u0151\u00F6\u00F7\u0159\u016F\u00FA\u0171\u00FC\u00FD\u0163\u02D9'

const SINGLE_BYTE_MAPS: Record<string, string> = {
  'iso-8859-2': ISO_8859_2,
  'windows-1250': WIN_1250,
}

function normalizeCharset(cs: string): string {
  const c = cs.toLowerCase().trim().replace(/^"|"$/g, '')
  if (!c || c === 'us-ascii' || c === 'ascii') return 'utf-8'
  if (c === 'latin1') return 'iso-8859-1'
  if (c === 'cp1250') return 'windows-1250'
  if (c === 'cp1252') return 'windows-1252'
  return c
}

function bytesToLatin1(b: Uint8Array): string {
  let s = ''
  const CHUNK = 32768
  for (let i = 0; i < b.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + CHUNK)))
  }
  return s
}

// ---------- RFC 2047 encoded words ----------

export function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (full: string, charset: string, enc: string, data: string) => {
      const encType = enc.toUpperCase()
      try {
        if (encType === 'B') {
          const bin = base64ToBinary(data)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff
          return decodeCharset(bytes, charset)
        }
        const normalised = data.replace(/_/g, ' ')
        const bytes = decodeQuotedPrintable(new TextEncoder().encode(normalised))
        return decodeCharset(bytes, charset)
      } catch {
        return full
      }
    },
  )
}

function deriveFilename(node: MimeNode): string | undefined {
  const ct = node.contentType.toLowerCase()
  if (ct === 'image/png') return 'image.png'
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'image.jpg'
  if (ct === 'image/gif') return 'image.gif'
  if (ct === 'application/pdf') return 'document.pdf'
  if (ct === 'application/zip') return 'archive.zip'
  return undefined
}
