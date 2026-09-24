// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The poison gate for durable text a MODEL authored outside arbitration: the
// per-turn capture notes (capture/note-writer.ts), the nightly consolidation
// summaries (consolidator/semantic-promoter.ts) and the team-session notes
// (vault/team-session-promoter.ts). It is the same scanner arbitrate() runs
// over every fact and gist (extract/poison-gate.ts), so a model cannot put an
// instruction into memory by routing it around arbitration.
//
// Stricter than arbitration on purpose. arbitrate() rejects 'high' and
// quarantines 'medium'/'low', because a fact or gist has a quarantine tier
// every reader honours and a gist has a heuristic fallback. A vault note has
// neither: it is one whole document, recalled by several paths. So any hit
// refuses the write; the caller records the refusal (a false positive is
// visible, never silent) and writes nothing.

import { scanForInjection, type InjectionLevel } from './extract/poison-gate.js'

export type ModelWriteVerdict =
  | { admitted: true }
  | {
      admitted: false
      /** How instruction-shaped the text was (never 'none'). */
      level: Exclude<InjectionLevel, 'none'>
      /** The detector family that matched — diagnostics only, never the text. */
      pattern: string
    }

/**
 * Admits model-authored text for a durable write, or refuses it.
 *
 * Each part is scanned on its own (title, summary, body…): joining them would
 * let the end of one part and the start of the next form a match neither
 * holds. Empty and absent parts are clean.
 */
export function admitModelAuthoredText(...parts: ReadonlyArray<string | null | undefined>): ModelWriteVerdict {
  for (const part of parts) {
    if (!part) continue
    const scan = scanForInjection(part)
    if (scan.level !== 'none') return { admitted: false, level: scan.level, pattern: scan.pattern ?? 'unknown' }
  }
  return { admitted: true }
}
