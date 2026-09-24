// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { PiiMatch, PiiScanner, CustomPatternConfig } from '../types.js'
import { assertSafeRegex, UnsafeRegexError } from '@shared/safe-regex.js'
import { splitLines } from './lines.js'

export interface RejectedCustomPattern {
  name: string
  /** 'unsafe' = failed the ReDoS guard, 'invalid' = does not compile. */
  reason: 'unsafe' | 'invalid'
  message: string
}

export interface CustomScanner extends PiiScanner {
  /** Patterns that were dropped at construction, with the reason. */
  readonly rejected: readonly RejectedCustomPattern[]
}

/**
 * User-defined pattern scanner.
 * Its patterns come from the privacy policy's customPatterns (policy.ts).
 *
 * Every user-supplied regex is routed through assertSafeRegex() before
 * compilation. Patterns that fail the ReDoS heuristic or do not compile are
 * DROPPED with a logged warning and reported in `rejected` instead of being
 * added to the scanner — the alternative (throwing on module load) would
 * brick the entire privacy module for a single bad config entry.
 *
 * Matching is line-bounded like the built-in scanner: a pattern never
 * matches across a line break, and '^' / '$' anchor to line starts / ends.
 */
export function createCustomScanner(
  patterns: CustomPatternConfig[],
  logger: Pick<Logger, 'warn'>,
): CustomScanner {
  const compiled: Array<{ name: string; regex: RegExp; type: string; confidence: number }> = []
  const rejected: RejectedCustomPattern[] = []
  for (const p of patterns) {
    try {
      assertSafeRegex(p.regex)
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp
      // Guarded above — assertSafeRegex() rejects ReDoS-prone patterns
      // before we reach this constructor. The pattern comes from the
      // privacy policy (the privacy.yaml seed or an admin's save), never
      // from end-user input.
      const regex = new RegExp(p.regex, 'g')
      compiled.push({ name: p.name, regex, type: p.type, confidence: p.confidence })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const reason =
        err instanceof UnsafeRegexError && err.verdict.reason !== 'invalid-regex' ? 'unsafe' : 'invalid'
      rejected.push({ name: p.name, reason, message })
      logger.warn({ pattern: p.name, reason, err: message }, 'Privacy: custom pattern rejected')
    }
  }

  return {
    id: 'custom',
    rejected,

    scan(text: string): PiiMatch[] {
      const matches: PiiMatch[] = []

      for (const line of splitLines(text)) {
        for (const pattern of compiled) {
          pattern.regex.lastIndex = 0
          let m: RegExpExecArray | null

          while ((m = pattern.regex.exec(line.text)) !== null) {
            // A pattern that can match the empty string ('x*') would never
            // advance; step over the empty match instead of looping forever.
            if (m[0].length === 0) {
              pattern.regex.lastIndex++
              continue
            }
            matches.push({
              type: pattern.type,
              value: m[0],
              start: line.offset + m.index,
              end: line.offset + m.index + m[0].length,
              confidence: pattern.confidence,
              scanner: 'custom',
            })
          }
        }
      }

      return matches
    },
  }
}
