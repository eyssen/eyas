// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * HTML to plain text converter.
 *
 * - Strips tags with a safe token-based parser (no `eval`, no `innerHTML`,
 *   no DOM). We scan linearly and honour open/close tags with a depth cap.
 * - Preserves block-level line breaks (p, div, br, li, tr, h1..h6, blockquote).
 * - Handles entities: named (&amp; &lt; &gt; &quot; &apos; &nbsp;) and
 *   numeric (&#123; &#xAB;).
 * - Optionally inlines link targets: `Click here (https://example.com)`.
 * - Caps nesting depth to protect against pathological inputs.
 *
 * NOTE: this is NOT a full HTML-to-markdown converter. For rich conversion
 * use the `turndown` dep that already ships with EYAS. This helper is just a
 * fast, dependency-free "give me a plaintext version of this email".
 */

const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'hr', 'li', 'tr', 'table', 'blockquote', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'section', 'article', 'header', 'footer', 'main', 'aside',
])

const DROP_TAGS = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript'])

interface HtmlToTextOptions {
  /** Include the href in parentheses after link text. Default true. */
  includeLinkUrls?: boolean
  /** Maximum tag nesting depth. Default 100. */
  maxDepth?: number
  /** Maximum output length. Default 1 MiB. */
  maxOutputLength?: number
}

export function htmlToText(html: string, opts: HtmlToTextOptions = {}): string {
  if (!html) return ''
  const includeLinkUrls = opts.includeLinkUrls ?? true
  const maxDepth = opts.maxDepth ?? 100
  const maxOut = opts.maxOutputLength ?? 1024 * 1024

  let out = ''
  let i = 0
  let depth = 0
  let dropUntil: string | null = null
  let pendingHref: string | null = null

  const appendText = (s: string) => {
    if (!s) return
    if (out.length + s.length > maxOut) {
      out += s.slice(0, Math.max(0, maxOut - out.length))
      i = html.length
      return
    }
    out += s
  }

  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const close = html[i + 1] === '/'
      const tagEnd = html.indexOf('>', i)
      if (tagEnd === -1) {
        appendText(decodeEntities(html.slice(i)))
        break
      }
      const tagRaw = html.slice(i + 1 + (close ? 1 : 0), tagEnd).trim()
      const selfClosing = tagRaw.endsWith('/')
      const name = tagRaw.split(/[\s/]/)[0]!.toLowerCase()
      i = tagEnd + 1

      if (dropUntil) {
        if (close && name === dropUntil) dropUntil = null
        continue
      }
      if (!close && DROP_TAGS.has(name)) { dropUntil = name; continue }

      if (!close && !selfClosing) {
        if (depth >= maxDepth) continue
        depth++
      } else if (close) {
        depth = Math.max(0, depth - 1)
      }

      if (name === 'br') { appendText('\n'); continue }
      if (name === 'hr') { appendText('\n---\n'); continue }
      if (name === 'a') {
        if (!close) {
          pendingHref = extractHref(tagRaw)
        } else if (includeLinkUrls && pendingHref) {
          appendText(` (${pendingHref})`)
          pendingHref = null
        } else {
          pendingHref = null
        }
        continue
      }
      if (name === 'li' && !close) { appendText('\n- '); continue }
      if (BLOCK_TAGS.has(name)) { appendText('\n'); continue }
      continue
    }

    if (dropUntil) { i++; continue }

    const next = html.indexOf('<', i)
    const chunk = next === -1 ? html.slice(i) : html.slice(i, next)
    appendText(decodeEntities(chunk))
    i = next === -1 ? html.length : next
  }

  return collapseWhitespace(out)
}

function extractHref(tagInside: string): string | null {
  const m = tagInside.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/i)
  return m?.[2] ?? m?.[3] ?? m?.[4] ?? null
}

/** Decode HTML entities. Returns the input unchanged if no entities are found. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = parseInt(ent.slice(2), 16)
      return Number.isFinite(cp) ? safeFromCodePoint(cp) : m
    }
    if (ent.startsWith('#')) {
      const cp = parseInt(ent.slice(1), 10)
      return Number.isFinite(cp) ? safeFromCodePoint(cp) : m
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? m
  })
}

function safeFromCodePoint(cp: number): string {
  if (cp < 0 || cp > 0x10ffff) return ''
  try { return String.fromCodePoint(cp) } catch { return '' }
}

function collapseWhitespace(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  iexcl: '\u00a1',
  iquest: '\u00bf',
}
