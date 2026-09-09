// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { Logger } from 'pino'
import { Counter, Gauge, Registry } from '../registry.js'

export interface AgentMetrics {
  sessionsTotal: Counter
  turnsTotal: Counter
  tokensTotal: Counter
  costUsdTotal: Counter
  budgetUsageRatio: Gauge
  activeTeamsTotal: Gauge
}

/**
 * Register agent-related counters and gauges, and subscribe to bus events
 * emitted by the agent/teams modules.
 *
 * Subscribed bus subjects:
 *  - `agent.session.started`            { agentId, status }
 *  - `agent.session.completed`          { agentId, status, turns, tokens, cost }
 *  - `agent.session.failed`             { agentId, status, error }
 *  - `agent.session.waiting_approval`   { agentId }
 *  - `agent.turn.completed`             { agentId, outcome }
 *  - `agent.tokens.used`                { agentId, provider, kind, amount }
 *  - `agent.cost.charged`               { agentId, usd }
 *  - `agent.budget.updated`             { agentId, ratio }
 *  - `team.active.count`                { count }
 */
export function registerAgentMetrics(
  registry: Registry,
  bus: EyasBus,
  logger: Logger,
): AgentMetrics {
  const metrics: AgentMetrics = {
    sessionsTotal: registry.register(
      new Counter({
        name: 'eyas_agent_sessions_total',
        help: 'Count of agent sessions by terminal status.',
        labelNames: ['status'],
      }),
    ),
    turnsTotal: registry.register(
      new Counter({
        name: 'eyas_agent_turns_total',
        help: 'Count of agent turns by outcome.',
        labelNames: ['agent_id', 'outcome'],
      }),
    ),
    tokensTotal: registry.register(
      new Counter({
        name: 'eyas_agent_tokens_total',
        help: 'Cumulative token usage per agent, provider, and kind.',
        labelNames: ['agent_id', 'provider', 'kind'],
      }),
    ),
    costUsdTotal: registry.register(
      new Counter({
        name: 'eyas_agent_cost_usd_total',
        help: 'Cumulative USD cost of agent model calls.',
        labelNames: ['agent_id'],
      }),
    ),
    budgetUsageRatio: registry.register(
      new Gauge({
        name: 'eyas_agent_budget_usage_ratio',
        help: 'Ratio of used budget over allocated budget (0..1+).',
        labelNames: ['agent_id'],
      }),
    ),
    activeTeamsTotal: registry.register(
      new Gauge({
        name: 'eyas_active_teams_total',
        help: 'Currently active team sessions.',
      }),
    ),
  }

  const safe = <T extends object>(data: unknown): T | null =>
    data && typeof data === 'object' ? (data as T) : null

  bus.on('agent.session.started', async (data) => {
    const d = safe<{ status?: string }>(data)
    metrics.sessionsTotal.inc({ status: d?.status ?? 'running' }, 1)
  })

  bus.on('agent.session.completed', async (data) => {
    const d = safe<{ status?: string }>(data)
    metrics.sessionsTotal.inc({ status: d?.status ?? 'completed' }, 1)
  })

  bus.on('agent.session.failed', async () => {
    metrics.sessionsTotal.inc({ status: 'failed' }, 1)
  })

  bus.on('agent.session.waiting_approval', async () => {
    metrics.sessionsTotal.inc({ status: 'waiting_approval' }, 1)
  })

  bus.on('agent.turn.completed', async (data) => {
    const d = safe<{ agentId?: string; outcome?: string }>(data)
    metrics.turnsTotal.inc({
      agent_id: d?.agentId ?? 'unknown',
      outcome: d?.outcome ?? 'ok',
    }, 1)
  })

  bus.on('agent.tokens.used', async (data) => {
    const d = safe<{ agentId?: string; provider?: string; kind?: string; amount?: number }>(data)
    if (!d || typeof d.amount !== 'number') return
    metrics.tokensTotal.inc(
      {
        agent_id: d.agentId ?? 'unknown',
        provider: d.provider ?? 'unknown',
        kind: d.kind ?? 'output',
      },
      d.amount,
    )
  })

  bus.on('agent.cost.charged', async (data) => {
    const d = safe<{ agentId?: string; usd?: number }>(data)
    if (!d || typeof d.usd !== 'number') return
    metrics.costUsdTotal.inc({ agent_id: d.agentId ?? 'unknown' }, d.usd)
  })

  bus.on('agent.budget.updated', async (data) => {
    const d = safe<{ agentId?: string; ratio?: number }>(data)
    if (!d || typeof d.ratio !== 'number') return
    metrics.budgetUsageRatio.set({ agent_id: d.agentId ?? 'unknown' }, d.ratio)
  })

  bus.on('team.active.count', async (data) => {
    const d = safe<{ count?: number }>(data)
    if (!d || typeof d.count !== 'number') return
    metrics.activeTeamsTotal.set({}, d.count)
  })

  logger.debug('Prometheus: agent metrics registered')
  return metrics
}
