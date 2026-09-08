// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EfficiencyReport } from './types.js'

export function createEfficiencyReporter(db: any) {
  return {
    /**
     * Generate an efficiency report for the given period.
     */
    generate(period: 'daily' | 'weekly' | 'monthly' = 'weekly'): EfficiencyReport {
      const daysBack = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30
      const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString()

      // Session stats
      const sessionRows = db.all(sql`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(tokens_used) as total_tokens, SUM(cost_usd) as total_cost
        FROM agent_sessions WHERE started_at > ${cutoff}
      `) as any[]
      const stats = sessionRows[0] ?? { total: 0, completed: 0, total_tokens: 0, total_cost: 0 }

      // Top agents
      const topAgents = (db.all(sql`
        SELECT agent_id, COUNT(*) as sessions, SUM(tokens_used) as tokens,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as success_rate
        FROM agent_sessions WHERE started_at > ${cutoff}
        GROUP BY agent_id ORDER BY sessions DESC LIMIT 5
      `) as any[]).map((r: any) => ({
        agentId: r.agent_id,
        sessions: r.sessions,
        tokens: r.tokens ?? 0,
        successRate: r.success_rate ?? 0,
      }))

      // Top tools
      const topTools = (db.all(sql`
        SELECT tool_name, COUNT(*) as calls, AVG(duration_ms) as avg_duration,
               SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as error_rate
        FROM tool_executions WHERE created_at > ${cutoff}
        GROUP BY tool_name ORDER BY calls DESC LIMIT 10
      `) as any[]).map((r: any) => ({
        toolName: r.tool_name,
        calls: r.calls,
        avgDurationMs: Math.round(r.avg_duration ?? 0),
        errorRate: r.error_rate ?? 0,
      }))

      return {
        period,
        totalTokens: stats.total_tokens ?? 0,
        totalCostUsd: stats.total_cost ?? 0,
        totalSessions: stats.total ?? 0,
        successRate: stats.total > 0 ? (stats.completed ?? 0) / stats.total : 0,
        avgTokensPerSession: stats.total > 0 ? Math.round((stats.total_tokens ?? 0) / stats.total) : 0,
        topAgents,
        topTools,
        insights: [], // Filled by execution learner
        generatedAt: new Date().toISOString(),
      }
    },
  }
}
