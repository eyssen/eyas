// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { DetectedPattern, EvolutionConfig } from './types.js'

export function createPatternDetector(db: any, config: EvolutionConfig) {
  return {
    detect(): DetectedPattern[] {
      const cutoff = new Date(Date.now() - config.analysisWindowDays * 86400_000).toISOString()

      // Group by title, count occurrences and average tokens
      const rows = db.all(sql`
        SELECT
          title,
          COUNT(*) as occurrences,
          AVG(tokens_used) as avg_tokens,
          GROUP_CONCAT(id) as ids
        FROM conversations
        WHERE title IS NOT NULL AND title != '' AND created_at > ${cutoff}
        GROUP BY title
        HAVING occurrences >= ${config.minSessionsForPattern}
        ORDER BY occurrences DESC
        LIMIT 20
      `) as any[]

      const patterns: DetectedPattern[] = []

      for (const row of rows) {
        const confidence = Math.min(row.occurrences / 10, 1)
        if (confidence < config.minConfidence) continue

        const ids: string[] = row.ids ? row.ids.split(',').slice(0, 5) : []

        patterns.push({
          title: row.title,
          occurrences: row.occurrences,
          confidence,
          avgTokens: Math.round(row.avg_tokens ?? 0),
          sampleConversationIds: ids,
        })
      }

      return patterns
    },
  }
}

export type PatternDetector = ReturnType<typeof createPatternDetector>
