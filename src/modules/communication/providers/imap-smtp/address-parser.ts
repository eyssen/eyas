// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * RFC 5322 address-list parser.
 *
 * Handles:
 *   - Bare addresses:              `jane@example.com`
 *   - Name + angle-bracket:        `"John Doe" <john@example.com>`
 *   - Comma-separated lists
 *   - Parenthesized comments       `john@example.com (John)`
 *   - Quoted local-parts           `"weird name"@example.com`
 *   - Group syntax                 `team:alice@x,bob@x;`
 *
 * RFC 5322 is a context-free grammar (not regular), so we use a small
 * recursive-descent parser instead of regex.
 */

import type { EmailAddress } from '../email-common/types.js'

export function parseAddressList(input: string | undefined | null): EmailAddress[] {
  if (!input) return []
  const trimmed = input.trim()
  if (!trimmed) return []

  const parser = new AddressParser(trimmed)
  const out: EmailAddress[] = []
  while (!parser.eof()) {
    const addr = parser.readAddress()
    if (addr) out.push(addr)
    parser.skipWhitespace()
    if (parser.peek() === ',') {
      parser.advance()
      parser.skipWhitespace()
    }
  }
  return out
}

/**
 * Parse a single address; returns null if invalid.
 */
export function parseAddress(input: string | undefined | null): EmailAddress | null {
  const list = parseAddressList(input)
  return list[0] ?? null
}

class AddressParser {
  private pos = 0
  constructor(private readonly src: string) {}

  eof(): boolean { return this.pos >= this.src.length }
  peek(): string { return this.src[this.pos] ?? '' }
  advance(): string { return this.src[this.pos++] ?? '' }

  skipWhitespace(): void {
    while (!this.eof()) {
      const ch = this.peek()
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.pos++
      } else if (ch === '(') {
        this.skipComment()
      } else {
        break
      }
    }
  }

  /** Skip a `(...)` comment, honouring nested parens. */
  private skipComment(): void {
    if (this.peek() !== '(') return
    this.pos++
    let depth = 1
    while (!this.eof() && depth > 0) {
      const ch = this.advance()
      if (ch === '\\' && !this.eof()) { this.advance(); continue }
      if (ch === '(') depth++
      else if (ch === ')') depth--
    }
  }

  /** Read a quoted-string starting at current `"`. */
  private readQuoted(): string {
    if (this.peek() !== '"') return ''
    this.pos++
    let out = ''
    while (!this.eof()) {
      const ch = this.advance()
      if (ch === '\\' && !this.eof()) {
        out += this.advance()
        continue
      }
      if (ch === '"') break
      out += ch
    }
    return out
  }

  /** Read until any of the stop chars. Unescape quoted sections. */
  private readAtom(stop: string): string {
    let out = ''
    while (!this.eof()) {
      const ch = this.peek()
      if (ch === '"') { out += this.readQuoted(); continue }
      if (ch === '(') { this.skipComment(); continue }
      if (stop.includes(ch)) break
      out += this.advance()
    }
    return out.trim()
  }

  readAddress(): EmailAddress | null {
    this.skipWhitespace()
    if (this.eof()) return null

    // Group syntax: `name:addr,addr;`
    // We detect a colon before `@` or `,` — then parse the group contents
    // as sub-addresses and return the first one (keeps downstream shape).
    const saved = this.pos
    const preAt = this.readAtom(',<:@;')
    // Group form
    if (this.peek() === ':') {
      this.pos++
      // Parse members until `;`
      const members: EmailAddress[] = []
      while (!this.eof() && this.peek() !== ';') {
        const m = this.readAddress()
        if (m) members.push(m)
        this.skipWhitespace()
        if (this.peek() === ',') { this.pos++; this.skipWhitespace() }
      }
      if (this.peek() === ';') this.pos++
      return members[0] ?? null
    }

    // `name <addr>` form
    if (this.peek() === '<') {
      this.pos++
      const inner = this.readAtom('>')
      if (this.peek() === '>') this.pos++
      const address = sanitizeAddress(inner)
      if (!isValidAddress(address)) return null
      const name = preAt.replace(/^"|"$/g, '').trim() || undefined
      return name ? { address, name } : { address }
    }

    // Otherwise bare address (or name@host)
    this.pos = saved
    const raw = this.readAtom(',;')
    if (!raw) return null
    const address = sanitizeAddress(raw)
    if (!isValidAddress(address)) return null
    return { address }
  }
}

function sanitizeAddress(raw: string): string {
  return raw.replace(/^[\s<]+|[\s>]+$/g, '').trim()
}

/**
 * Lightweight well-formedness check. We deliberately do NOT enforce the full
 * RFC 5322 grammar — we just want: non-empty local-part, exactly one `@`,
 * non-empty domain with at least one `.` or a valid bracketed literal.
 */
export function isValidAddress(addr: string): boolean {
  if (!addr || addr.length > 254) return false
  // local@domain
  const at = addr.lastIndexOf('@')
  if (at <= 0 || at === addr.length - 1) return false
  const local = addr.slice(0, at)
  const domain = addr.slice(at + 1)
  if (!local || !domain) return false
  // Whitespace is only forbidden OUTSIDE a quoted local-part.
  if (/\s/.test(domain)) return false
  if (!local.startsWith('"') && /\s/.test(local)) return false
  // Domain: bracketed IP literal (e.g. `[127.0.0.1]`) is also valid.
  if (domain.startsWith('[') && domain.endsWith(']')) return domain.length > 2
  // Must have at least one dot in the domain part.
  if (!domain.includes('.')) return false
  return true
}

/**
 * Format an address list back to an RFC 5322 header string.
 */
export function formatAddressList(list: EmailAddress[]): string {
  return list.map(a => {
    if (!a.name) return a.address
    // Quote the name if it contains special chars.
    const needsQuote = /[",()<>:;@\\]/.test(a.name)
    const name = needsQuote ? `"${a.name.replace(/"/g, '\\"')}"` : a.name
    return `${name} <${a.address}>`
  }).join(', ')
}
