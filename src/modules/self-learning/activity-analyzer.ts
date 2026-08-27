// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ActivityPattern } from './types.js'

export function createActivityAnalyzer(db: any) {
  return {
    /**
     * Analyze recent activity for patterns.
     * Queries tool_executions and agent_sessions.
     */
    analyze(daysBack: number = 7): ActivityPattern[] {
      const patterns: ActivityPattern[] = []
      // Guard against a non-finite daysBack (e.g. NaN from an unvalidated query
      // param) which would make `new Date(... NaN ...)` throw RangeError.
      const days = Number.isFinite(daysBack) && daysBack > 0 ? daysBack : 7
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString()

      // 1. Recurring tool call patterns
      const toolFreq = db.all(sql`
        SELECT tool_name, COUNT(*) as cnt,
               SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
        FROM tool_executions
        WHERE created_at > ${cutoff}
        GROUP BY tool_name
        HAVING cnt >= 5
        ORDER BY cnt DESC
        LIMIT 10
      `) as any[]

      for (const row of toolFreq) {
        if (row.failures / row.cnt > 0.5) {
          patterns.push({
            type: 'error_pattern',
            description: `Tool "${row.tool_name}" has ${Math.round(row.failures / row.cnt * 100)}% failure rate (${row.failures}/${row.cnt} calls)`,
            frequency: row.cnt,
            lastSeen: new Date().toISOString(),
            suggestion: `Investigate why ${row.tool_name} is failing frequently. Consider adjusting tool constraints or input validation.`,
          })
        }
      }

      // 2. Agent session patterns
      const sessionStats = db.all(sql`
        SELECT agent_id, COUNT(*) as cnt,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
               AVG(tokens_used) as avg_tokens
        FROM agent_sessions
        WHERE started_at > ${cutoff}
        GROUP BY agent_id
        HAVING cnt >= 3
      `) as any[]

      for (const row of sessionStats) {
        const successRate = row.completed / row.cnt
        if (successRate < 0.5) {
          patterns.push({
            type: 'error_pattern',
            description: `Agent "${row.agent_id}" has ${Math.round(successRate * 100)}% success rate`,
            frequency: row.cnt,
            lastSeen: new Date().toISOString(),
            suggestion: `Review agent constraints and system prompt. Consider adjusting maxTurns or available tools.`,
          })
        }
        if (row.avg_tokens > 50000) {
          patterns.push({
            type: 'cost_anomaly',
            description: `Agent "${row.agent_id}" averages ${Math.round(row.avg_tokens)} tokens/session`,
            frequency: row.cnt,
            lastSeen: new Date().toISOString(),
            suggestion: `Consider using a cheaper model for this agent or reducing maxTurns.`,
          })
        }
      }

      return patterns
    },
  }
}
