// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { ModelGateway } from '@modules/model/types.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine.js'
import { runCheapModelPass } from '@modules/model/cheap-pass.js'
import type { ExecutionInsight } from './types.js'

export interface ExecutionLearnerDeps {
  /**
   * Cheap-tier ('heartbeat' tier) model gateway — turns each metric anomaly
   * below into a CONCRETE patch (a rewritten prompt line / constraint /
   * routing rule) instead of the constant generic sentence, fed with the
   * agent's ACTUAL current systemPrompt + constraints. Threaded from
   * self-learning/index.ts's onStart — mirrors forge/proposal-engine.ts
   * (onRegister runs before the model module's onStart populates
   * ctx.decisionEngine/ctx.agents, so they're not available yet at
   * construction time). Absent/erroring model, or a missing agentRegistry/
   * agent, fails open to the pre-existing generic sentence; never throws.
   */
  model?: Pick<ModelGateway, 'complete'>
  decisionEngine?: DecisionEngine
  /** Narrow structural subset of AgentRegistry.get() — avoids importing the whole agent module for one method. */
  agentRegistry?: { get(id: string): { systemPrompt: string; constraints: string[] } | undefined }
  logger?: Logger
}

export function createExecutionLearner(db: any, deps: ExecutionLearnerDeps = {}) {
  return {
    /**
     * Analyze completed agent sessions and generate improvement insights.
     *
     * `modelPassEnabled` is the `selfLearning.apply` Phase-3 loop feature flag
     * (security-gate/autonomy-features.ts), read FRESH by the caller at fire
     * time and passed in here — defaults to `true` so existing callers/tests
     * that predate the flag are unaffected; the production wiring
     * (self-learning/index.ts) always passes the live, OFF-by-default value.
     * `false` skips every model pass below, falling back to the generic
     * sentence (same shape as a missing model).
     */
    async learn(daysBack: number = 30, modelPassEnabled: boolean = true): Promise<ExecutionInsight[]> {
      const insights: ExecutionInsight[] = []
      const cutoff = new Date(Date.now() - daysBack * 86400_000).toISOString()
      const now = new Date().toISOString()

      // 1. Success rate per agent
      const agentStats = db.all(sql`
        SELECT agent_id, COUNT(*) as total,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
               AVG(tokens_used) as avg_tokens, AVG(cost_usd) as avg_cost
        FROM agent_sessions
        WHERE started_at > ${cutoff}
        GROUP BY agent_id
        HAVING total >= 5
      `) as any[]

      for (const row of agentStats) {
        const successRate = row.completed / row.total
        if (successRate < 0.7) {
          const fallback = 'Review system prompt, constraints, and available tools'
          const agent = deps.agentRegistry?.get(row.agent_id)
          const suggestedValue = (agent && modelPassEnabled)
            ? await runCheapModelPass(deps, {
                system:
                  'You are refining an EYAS self-learning insight about an agent\'s low success rate into ONE ' +
                  'concrete patch. You are given the agent\'s ACTUAL current system prompt and constraints. ' +
                  'Return ONE concrete rewritten prompt line or new constraint that would plausibly fix the ' +
                  'failure pattern — 1-3 sentences, no preamble, no quotes.',
                user:
                  `Agent: ${row.agent_id}\nCurrent system prompt:\n${agent.systemPrompt}\n` +
                  `Current constraints:\n${agent.constraints.length ? agent.constraints.map((c) => `- ${c}`).join('\n') : '(none)'}\n\n` +
                  `Metric: ${Math.round(successRate * 100)}% success rate over ${row.total} sessions.`,
                fallback,
              })
            : fallback

          insights.push({
            type: 'success_rate',
            agentId: row.agent_id,
            metric: successRate,
            currentValue: `${Math.round(successRate * 100)}% success rate`,
            suggestedValue,
            confidence: Math.min(row.total / 20, 1),
            dataPoints: row.total,
            reasoning: `Agent has only ${Math.round(successRate * 100)}% success rate over ${row.total} sessions. Possible causes: inadequate tools, poor prompt, or tasks beyond capability.`,
            createdAt: now,
          })
        }
      }

      // 2. Model routing optimization — check if cheaper models could have been used
      const modelUsage = db.all(sql`
        SELECT s.agent_id, m.model, m.provider, COUNT(*) as cnt,
               SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as completed,
               AVG(s.tokens_used) as avg_tokens
        FROM agent_sessions s
        JOIN conversations c ON s.conversation_id = c.id
        LEFT JOIN conversation_messages m ON m.conversation_id = c.id AND m.role = 'assistant'
        WHERE s.started_at > ${cutoff}
        GROUP BY s.agent_id, m.model
        HAVING cnt >= 3
      `) as any[]

      // Find agents using expensive models with high success on simple tasks
      for (const row of modelUsage) {
        const successRate = row.completed / row.cnt
        const isExpensive = row.model?.includes('opus')
        if (isExpensive && successRate > 0.9 && row.avg_tokens < 5000) {
          const fallback = 'Consider using Sonnet or Haiku — high success rate with low token usage suggests simpler model would suffice'
          const agent = deps.agentRegistry?.get(row.agent_id)
          const suggestedValue = (agent && modelPassEnabled)
            ? await runCheapModelPass(deps, {
                system:
                  'You are refining an EYAS self-learning insight about inefficient model routing into ONE ' +
                  'concrete routing rule. You are given the agent\'s ACTUAL current system prompt/constraints ' +
                  'and its usage metrics. Return ONE concrete routing rule (which cheaper provider/model to ' +
                  'route this agent to, and under what condition) — 1-3 sentences, no preamble, no quotes.',
                user:
                  `Agent: ${row.agent_id}\nCurrent system prompt:\n${agent.systemPrompt}\n` +
                  `Current constraints:\n${agent.constraints.length ? agent.constraints.map((c) => `- ${c}`).join('\n') : '(none)'}\n\n` +
                  `Metric: currently routed to ${row.model}, ${Math.round(successRate * 100)}% success with avg ${Math.round(row.avg_tokens)} tokens.`,
                fallback,
              })
            : fallback

          insights.push({
            type: 'model_routing',
            agentId: row.agent_id,
            metric: row.avg_tokens / 50000, // Normalized cost metric
            currentValue: `Using ${row.model} (avg ${Math.round(row.avg_tokens)} tokens)`,
            suggestedValue,
            confidence: Math.min(row.cnt / 10, 1) * successRate,
            dataPoints: row.cnt,
            reasoning: `Agent achieves ${Math.round(successRate * 100)}% success with only ${Math.round(row.avg_tokens)} avg tokens on ${row.model}. A cheaper model would likely produce similar results at lower cost.`,
            createdAt: now,
          })
        }
      }

      // 3. Tool effectiveness
      const toolStats = db.all(sql`
        SELECT tool_name, COUNT(*) as total,
               SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as succeeded,
               AVG(duration_ms) as avg_duration
        FROM tool_executions
        WHERE created_at > ${cutoff}
        GROUP BY tool_name
        HAVING total >= 10
      `) as any[]

      for (const row of toolStats) {
        const errorRate = 1 - (row.succeeded / row.total)
        if (errorRate > 0.3) {
          const fallback = `Investigate error causes. Consider adding input validation or improving tool description.`
          // No agentId at this scope (tool-level, not per-agent) — no agent
          // context to feed, but runCheapModelPass itself fails open when
          // deps.model is absent/erroring, so this is safe to call unconditionally
          // (aside from the modelPassEnabled feature-flag gate below).
          const suggestedValue = modelPassEnabled
            ? await runCheapModelPass(deps, {
                system:
                  'You are refining an EYAS self-learning insight about a failing tool into ONE concrete patch — ' +
                  'a specific input-validation rule or description fix that would plausibly reduce the error rate. ' +
                  '1-3 sentences, no preamble, no quotes.',
                user: `Tool: ${row.tool_name}\nMetric: ${Math.round(errorRate * 100)}% error rate over ${row.total} calls.`,
                fallback,
              })
            : fallback

          insights.push({
            type: 'constraint_tuning',
            metric: errorRate,
            currentValue: `Tool "${row.tool_name}" has ${Math.round(errorRate * 100)}% error rate`,
            suggestedValue,
            confidence: Math.min(row.total / 30, 1),
            dataPoints: row.total,
            reasoning: `${row.tool_name} fails ${Math.round(errorRate * 100)}% of the time across ${row.total} calls. Common cause: agents pass incorrect input due to unclear tool description.`,
            createdAt: now,
          })
        }
      }

      return insights
    },
  }
}
