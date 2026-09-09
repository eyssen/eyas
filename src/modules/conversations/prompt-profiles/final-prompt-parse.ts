// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Parse structured blocks emitted by the Prompt Enhancer coach.
 */

export interface ParsedFinalPrompt {
  text: string
  carryAttachments: 'all' | 'none'
  /** e.g. recommended | concise | thorough */
  variant: string | null
}

export interface QualityCheck {
  score: number
  missing: string[]
  note: string
}

/**
 * Extract all `<final-prompt …>…</final-prompt>` blocks from coach output.
 * Supports optional `carry-attachments` and `variant` attributes.
 */
export function extractFinalPrompts(text: string): ParsedFinalPrompt[] {
  const results: ParsedFinalPrompt[] = []
  const re = /<final-prompt(\s[^>]*)?>\s*([\s\S]*?)\s*<\/final-prompt>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const attrs = match[1] ?? ''
    const body = match[2].trim()
    if (!body) continue
    const carryMatch = attrs.match(/carry-attachments\s*=\s*["']?(all|none)["']?/i)
    const variantMatch = attrs.match(/variant\s*=\s*["']([^"']+)["']/i)
      ?? attrs.match(/variant\s*=\s*([^\s>]+)/i)
    results.push({
      text: body,
      carryAttachments: carryMatch?.[1]?.toLowerCase() === 'all' ? 'all' : 'none',
      variant: variantMatch?.[1]?.trim() ?? null,
    })
  }
  return results
}

/** First final-prompt only (backward-compatible). */
export function extractFinalPrompt(text: string): ParsedFinalPrompt | null {
  return extractFinalPrompts(text)[0] ?? null
}

/**
 * Parse `<quality-check score="8" missing="a, b">note</quality-check>`
 * or a loose `Quality: 8/10` line.
 */
export function extractQualityCheck(text: string): QualityCheck | null {
  const tag = text.match(
    /<quality-check(\s[^>]*)?>\s*([\s\S]*?)\s*<\/quality-check>/i,
  )
  if (tag) {
    const attrs = tag[1] ?? ''
    const scoreMatch = attrs.match(/score\s*=\s*["']?(\d{1,2})["']?/i)
    const missingMatch = attrs.match(/missing\s*=\s*["']([^"']*)["']/i)
    const score = scoreMatch ? clampScore(Number(scoreMatch[1])) : 0
    const missing = (missingMatch?.[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return { score, missing, note: tag[2].trim() }
  }

  const loose = text.match(/quality\s*:\s*(\d{1,2})\s*\/\s*10/i)
  if (loose) {
    return { score: clampScore(Number(loose[1])), missing: [], note: '' }
  }
  return null
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(10, Math.round(n)))
}
