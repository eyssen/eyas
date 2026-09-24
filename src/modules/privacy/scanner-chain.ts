// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PiiMatch, PiiScanner } from './types.js'
import { splitLines } from './scanners/lines.js'

/**
 * Runs the registered PII scanners and deduplicates their results.
 *
 * Deterministic and synchronous: the text is split on '\n' and every
 * scanner sees one line at a time, so no scanner can match or look across
 * a line break. Offsets in the result are absolute (relative to `text`).
 * It keeps no counters: the privacy service counts real traffic only
 * (PrivacyService.stats), so a scan-tester run never shows up there.
 */
export function createScannerChain() {
  const scanners: PiiScanner[] = []

  function deduplicateMatches(matches: PiiMatch[]): PiiMatch[] {
    // Sort by start position, then by confidence (highest first)
    const sorted = [...matches].sort((a, b) => a.start - b.start || b.confidence - a.confidence)
    const result: PiiMatch[] = []

    for (const match of sorted) {
      // Skip if overlapping with a higher-confidence match already in results
      const overlapping = result.some(
        (existing) => match.start < existing.end && match.end > existing.start,
      )
      if (!overlapping) {
        result.push(match)
      }
    }

    return result
  }

  return {
    addScanner(scanner: PiiScanner) {
      scanners.push(scanner)
    },

    removeScanner(id: string) {
      const idx = scanners.findIndex((s) => s.id === id)
      if (idx !== -1) scanners.splice(idx, 1)
    },

    getScanners(): PiiScanner[] {
      return [...scanners]
    },

    /**
     * `extraScanners` run after the registered ones for this call only — the
     * privacy service passes the custom scanner of the policy a caller pinned,
     * so a pinned policy keeps its own patterns after a swap.
     */
    scan(text: string, extraScanners: readonly PiiScanner[] = []): PiiMatch[] {
      const allMatches: PiiMatch[] = []
      const active = extraScanners.length > 0 ? [...scanners, ...extraScanners] : scanners

      for (const line of splitLines(text)) {
        if (!line.text.trim()) continue
        for (const scanner of active) {
          for (const match of scanner.scan(line.text)) {
            // A scanner may only report what is really there (defensive
            // against a buggy or custom scanner reporting bad offsets).
            if (match.start < 0 || match.end > line.text.length || match.start >= match.end) continue
            if (line.text.slice(match.start, match.end) !== match.value) continue
            allMatches.push({ ...match, start: match.start + line.offset, end: match.end + line.offset })
          }
        }
      }

      return deduplicateMatches(allMatches)
    },
  }
}

export type ScannerChain = ReturnType<typeof createScannerChain>
