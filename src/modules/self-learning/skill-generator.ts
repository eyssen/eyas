// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { SkillSuggestion } from './types.js'

export function createSkillGenerator(db: any) {
  return {
    /**
     * Suggest new skills based on recurring conversation goals.
     */
    suggest(daysBack: number = 30): SkillSuggestion[] {
      const suggestions: SkillSuggestion[] = []
      const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString()

      // Find recurring conversation goals
      const goals = db.all(sql`
        SELECT goal_description, COUNT(*) as cnt
        FROM conversations
        WHERE goal_description IS NOT NULL AND created_at > ${cutoff}
        GROUP BY goal_description
        HAVING cnt >= 3
        ORDER BY cnt DESC
        LIMIT 5
      `) as any[]

      for (const row of goals) {
        if (row.goal_description && row.cnt >= 3) {
          suggestions.push({
            name: `auto-${row.goal_description.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}`,
            description: `Automated skill for: ${row.goal_description}`,
            triggerPatterns: [row.goal_description.toLowerCase()],
            reasoning: `This task has been requested ${row.cnt} times in the last ${daysBack} days`,
            basedOnTasks: row.cnt,
            confidence: Math.min(row.cnt / 10, 1),
          })
        }
      }

      return suggestions
    },
  }
}
