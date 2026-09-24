// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { LessonLearned } from './types.js'

export function createLessonLearner(db: any) {
  return {
    /**
     * Analyze recently closed conversations for patterns.
     * Extracts recurring solutions and saves to memory.
     */
    analyze(daysBack: number = 7): LessonLearned[] {
      const lessons: LessonLearned[] = []
      const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString()

      // Find conversations that used tools successfully
      const toolPatterns = db.all(sql`
        SELECT te.tool_name, COUNT(*) as cnt,
               GROUP_CONCAT(DISTINCT c.goal_description) as goals
        FROM tool_executions te
        JOIN conversations c ON te.conversation_id = c.id
        WHERE te.created_at > ${cutoff} AND te.success = 1
          AND c.status IN ('idle', 'archived') AND c.goal_description IS NOT NULL
        GROUP BY te.tool_name
        HAVING cnt >= 3
        ORDER BY cnt DESC
      `) as any[]

      for (const row of toolPatterns) {
        lessons.push({
          pattern: `Tasks using "${row.tool_name}" (${row.cnt} times)`,
          solution: `Goals: ${row.goals?.split(',').slice(0, 3).join('; ')}`,
          frequency: row.cnt,
          lastSeen: new Date().toISOString(),
          savedToMemory: false,
        })
      }

      return lessons
    },
  }
}
