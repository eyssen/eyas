// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PiiMatch, PiiScanner, PrivacyStats } from './types.js'

/**
 * Runs registered PII scanners sequentially, deduplicates and aggregates results.
 */
export function createScannerChain() {
  const scanners: PiiScanner[] = []
  let totalScans = 0
  const detectionsByType: Record<string, number> = {}

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

    async scan(text: string): Promise<PiiMatch[]> {
      totalScans++
      const allMatches: PiiMatch[] = []

      for (const scanner of scanners) {
        const matches = await scanner.scan(text)
        allMatches.push(...matches)
      }

      const deduplicated = deduplicateMatches(allMatches)

      // Track stats
      for (const match of deduplicated) {
        detectionsByType[match.type] = (detectionsByType[match.type] || 0) + 1
      }

      return deduplicated
    },

    getStats(): PrivacyStats {
      const totalDetections = Object.values(detectionsByType).reduce((sum, n) => sum + n, 0)
      return {
        totalScans,
        totalDetections,
        detectionsByType: { ...detectionsByType },
        detectionsByAction: {}, // Filled by policy engine
      }
    },

    resetStats() {
      totalScans = 0
      for (const key of Object.keys(detectionsByType)) {
        delete detectionsByType[key]
      }
    },
  }
}

export type ScannerChain = ReturnType<typeof createScannerChain>
