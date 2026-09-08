// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PiiMatch, PiiScanner, CustomPatternConfig } from '../types.js'
import { assertSafeRegex, UnsafeRegexError } from '@shared/safe-regex.js'

/**
 * User-defined pattern scanner.
 * Reads patterns from the privacy config's custom_patterns section.
 *
 * Every user-supplied regex is routed through assertSafeRegex() before
 * compilation. Patterns that fail the ReDoS heuristic are DROPPED with
 * a console warning instead of being added to the scanner — the
 * alternative (throwing on module load) would brick the entire privacy
 * module for a single bad config entry.
 */
export function createCustomScanner(patterns: CustomPatternConfig[]): PiiScanner {
  const compiled: Array<{ name: string; regex: RegExp; type: string; confidence: number }> = []
  for (const p of patterns) {
    try {
      assertSafeRegex(p.regex)
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp
      // Guarded above — assertSafeRegex() rejects ReDoS-prone patterns
      // before we reach this constructor. The pattern comes from the
      // privacy.yaml config (operator-controlled, never end-user input).
      const regex = new RegExp(p.regex, 'g')
      compiled.push({ name: p.name, regex, type: p.type, confidence: p.confidence })
    } catch (err) {
      if (err instanceof UnsafeRegexError) {
        console.warn(`[privacy] custom pattern '${p.name}' rejected: ${err.message}`)
        continue
      }
      console.warn(`[privacy] custom pattern '${p.name}' failed to compile: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    id: 'custom',

    async scan(text: string): Promise<PiiMatch[]> {
      const matches: PiiMatch[] = []

      for (const pattern of compiled) {
        pattern.regex.lastIndex = 0
        let m: RegExpExecArray | null

        while ((m = pattern.regex.exec(text)) !== null) {
          matches.push({
            type: pattern.type,
            value: m[0],
            start: m.index,
            end: m.index + m[0].length,
            confidence: pattern.confidence,
            scanner: 'custom',
          })
        }
      }

      return matches
    },
  }
}
