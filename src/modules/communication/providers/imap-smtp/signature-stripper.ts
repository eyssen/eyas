// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Email signature stripping.
 *
 * Detects and removes:
 *   - RFC 3676 sig delimiter line `-- ` (dash-dash-space) — canonical
 *   - Common signature headers: "Kind regards,", "Best,", "Sent from my iPhone",
 *     Hungarian equivalents ("Üdvözlettel,", "Köszönettel,")
 *   - Quoted-reply blocks: lines starting with `>` (and the `On ... wrote:`
 *     intro line above them)
 *
 * Returns both the cleaned body and what was stripped so auditors / Agent
 * Memory can see the discarded context.
 */

import type { StripSignatureResult } from './types.js'

const SIG_DELIMITER = /^-- ?\s*$/

const SIG_HEADERS = [
  /^kind regards[,.]?/i,
  /^best regards[,.]?/i,
  /^best[,.]?$/i,
  /^regards[,.]?$/i,
  /^thanks[,.]?$/i,
  /^thank you[,.]?$/i,
  /^cheers[,.]?$/i,
  /^sincerely[,.]?$/i,
  /^sent from my (iphone|ipad|android|phone|mobile)/i,
  /^get outlook for (ios|android)/i,
  /^üdv(özlettel)?[,.]?$/i,
  /^köszönettel[,.]?$/i,
  /^tisztelettel[,.]?$/i,
  /^minden jót[,.]?$/i,
  /^baráti üdvözlettel[,.]?$/i,
]

const REPLY_INTRO_PATTERNS = [
  /^on .+ wrote:\s*$/i,
  /^-----original message-----\s*$/i,
  /^from: .+$/i,
  /^küldte: .+$/i,
  /^feladó: .+$/i,
  /^\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}.+(wrote|írta|írt):\s*$/i,
]

export function stripSignature(body: string): StripSignatureResult {
  if (!body) return { cleanBody: '', signature: undefined, quotedReply: undefined }

  const normalised = body.replace(/\r\n/g, '\n')
  const lines = normalised.split('\n')

  // Step 1 — strip quoted reply (`>` prefixed lines, plus the intro above).
  const quoteStart = findQuoteStart(lines)
  const preQuote = quoteStart >= 0 ? lines.slice(0, quoteStart) : lines
  const quotedReply = quoteStart >= 0
    ? lines.slice(quoteStart).join('\n').trim() || undefined
    : undefined

  // Step 2 — detect `-- ` delimiter.
  let sigStart = -1
  for (let i = 0; i < preQuote.length; i++) {
    if (SIG_DELIMITER.test(preQuote[i] ?? '')) { sigStart = i; break }
  }

  // Step 3 — heuristic header match in the final N lines if no delimiter found.
  if (sigStart === -1) {
    sigStart = findHeuristicSignature(preQuote)
  }

  const bodyLines = sigStart >= 0 ? preQuote.slice(0, sigStart) : preQuote
  const signatureLines = sigStart >= 0 ? preQuote.slice(sigStart) : []

  const cleanBody = trimBlankLines(bodyLines).join('\n')
  const signature = signatureLines.length > 0
    ? trimBlankLines(signatureLines).join('\n') || undefined
    : undefined

  return { cleanBody, signature, quotedReply }
}

/** Index of the first quote line we should strip (including its `On ... wrote:` intro). */
function findQuoteStart(lines: string[]): number {
  let firstQuote = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i] ?? '')) { firstQuote = i; break }
  }
  if (firstQuote === -1) return -1
  // Back up past a "On ... wrote:" intro and any blank lines.
  let i = firstQuote - 1
  while (i >= 0 && (lines[i] ?? '').trim() === '') i--
  if (i >= 0 && REPLY_INTRO_PATTERNS.some(r => r.test(lines[i] ?? ''))) {
    return i
  }
  return firstQuote
}

/**
 * Look at the last 8 lines for a line that matches a common sign-off.
 * If found, treat that line (and everything after it) as the signature.
 */
function findHeuristicSignature(lines: string[]): number {
  const windowStart = Math.max(0, lines.length - 8)
  for (let i = windowStart; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue
    if (SIG_HEADERS.some(r => r.test(line))) return i
  }
  return -1
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0
  while (start < lines.length && (lines[start] ?? '').trim() === '') start++
  let end = lines.length
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--
  return lines.slice(start, end)
}
