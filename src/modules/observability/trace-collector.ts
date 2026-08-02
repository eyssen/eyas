// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import { estimateCost as estimateCostShared, type PricingTable } from '@shared/model-pricing.js'
import type { EyasDb, ModuleContext } from '@core/types'
import type {
  ModelGateway,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  ContentBlock,
} from '@modules/model/types'

export interface AiTrace {
  id: string
  timestamp: string
  requestId: string
  conversationId: string | null
  agentSessionId: string | null
  model: string
  provider: string
  memoryTiersUsed: string | null
  contextTokens: number
  systemPromptTokens: number
  toolDefinitions: string | null
  toolCalls: string | null
  toolCallCount: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  qualityScoreAuto: number | null
  qualityScoreUser: string | null
  evaluatorModel: string | null
  error: string | null
}

/**
 * F2 T9 (R5) — attribution key for a traced call. `agentSessionId` is the
 * run's metadata.runId (F2 T5's key — agent_sessions.id), NOT the
 * conversationId; a call carrying no runId (an unsupervised interactive
 * turn, or a judge/cheap-pass call with no run metadata) stays NULL, exactly
 * as before this task.
 */
function resolveAttribution(request: ModelRequest): { conversationId: string | null; agentSessionId: string | null } {
  return {
    conversationId: request.metadata?.conversationId ?? null,
    agentSessionId: request.metadata?.runId ?? null,
  }
}

/**
 * F2 T9 (R4) — routes through the shared pricing module instead of the local
 * hardcoded table this file used to own. `usage.costUsd` (when the provider
 * supplies one, e.g. the Claude Code SDK's total_cost_usd) wins over the
 * table estimate; local providers (ollama/lmstudio) price at $0 — fixing the
 * pre-T9 bug where every call, including on-box inference, was billed at
 * Anthropic's $3/$15 fallback into the global routing budget.
 */
function resolveCostUsd(
  provider: string,
  model: string,
  response: ModelResponse | null,
  pricingOverrides?: PricingTable,
): number {
  return estimateCostShared(provider, model, {
    inputTokens: response?.usage?.inputTokens ?? 0,
    outputTokens: response?.usage?.outputTokens ?? 0,
    cacheReadTokens: response?.usage?.cacheReadTokens,
    cacheCreationTokens: response?.usage?.cacheCreationTokens,
    costUsd: response?.usage?.costUsd,
  }, pricingOverrides)
}

function countToolUseBlocks(content: ContentBlock[]): { count: number; calls: string } {
  const toolUses = content.filter((b) => b.type === 'tool_use')
  return {
    count: toolUses.length,
    calls: toolUses.length > 0
      ? JSON.stringify(toolUses.map((b) => ({ name: (b as any).name, id: (b as any).id })))
      : '',
  }
}

export interface TraceCollector {
  insert(trace: Omit<AiTrace, 'id' | 'timestamp'>): AiTrace
  getById(id: string): AiTrace | null
  query(filters: TraceQueryFilters): { traces: AiTrace[]; total: number }
  getStats(from?: string, to?: string): TraceStats
  getAnomalyData(): AnomalyDataPoint[]
  updateFeedback(id: string, score: string): void
  updateAutoScore(id: string, score: number, evaluatorModel: string): void
}

export interface TraceQueryFilters {
  model?: string
  provider?: string
  conversationId?: string
  from?: string
  to?: string
  minCost?: number
  limit?: number
  offset?: number
}

/**
 * Compose WHERE-clause sql fragments from a filter object. Fragments are
 * assembled with sql.join(fragments, sql` AND `) at the call site so the
 * final statement is a single tagged-template expression with bound params.
 */
function buildWhereFragments(filters: TraceQueryFilters): ReturnType<typeof sql>[] {
  const frags: ReturnType<typeof sql>[] = []
  if (filters.model) frags.push(sql`model = ${filters.model}`)
  if (filters.provider) frags.push(sql`provider = ${filters.provider}`)
  if (filters.conversationId) frags.push(sql`conversation_id = ${filters.conversationId}`)
  if (filters.from) frags.push(sql`timestamp >= ${filters.from}`)
  if (filters.to) frags.push(sql`timestamp <= ${filters.to}`)
  if (filters.minCost != null) frags.push(sql`cost_usd >= ${filters.minCost}`)
  return frags
}

export interface TraceStats {
  dailyCosts: Array<{ date: string; cost: number; traces: number }>
  modelDistribution: Array<{ model: string; count: number; cost: number }>
  topAgents: Array<{ agentSessionId: string; count: number; cost: number }>
  totalCost: number
  totalTraces: number
  avgLatency: number
}

export interface AnomalyDataPoint {
  model: string
  metric: string
  currentValue: number
  mean: number
  stddev: number
  threshold: number
  timestamp: string
}

export function createTraceCollector(db: EyasDb): TraceCollector {
  return {
    insert(data) {
      const id = generateId()
      db.run(sql`INSERT INTO ai_traces (
        id, request_id, conversation_id, agent_session_id, model, provider,
        memory_tiers_used, context_tokens, system_prompt_tokens, tool_definitions,
        tool_calls, tool_call_count, output_tokens, cost_usd, latency_ms,
        quality_score_auto, quality_score_user, evaluator_model, error
      ) VALUES (
        ${id}, ${data.requestId}, ${data.conversationId}, ${data.agentSessionId},
        ${data.model}, ${data.provider}, ${data.memoryTiersUsed},
        ${data.contextTokens}, ${data.systemPromptTokens}, ${data.toolDefinitions},
        ${data.toolCalls}, ${data.toolCallCount}, ${data.outputTokens},
        ${data.costUsd}, ${data.latencyMs}, ${data.qualityScoreAuto},
        ${data.qualityScoreUser}, ${data.evaluatorModel}, ${data.error}
      )`)

      return { id, timestamp: new Date().toISOString(), ...data }
    },

    getById(id) {
      const rows = db.all<Record<string, unknown>>(
        sql`SELECT * FROM ai_traces WHERE id = ${id}`,
      )
      if (rows.length === 0) return null
      return mapRow(rows[0])
    },

    query(filters) {
      // Retained only for logging below; the actual query uses Drizzle sql
      // fragments (see buildWhereFragments) which bind params correctly.

      // Build the WHERE clause as a Drizzle sql fragment so parameters are
      // bound via Drizzle's tagged template, NOT interpolated — `sql.raw()`
      // with a separate params array silently drops the params, which meant
      // all callers were receiving unfiltered results before this fix.
      const fragments = buildWhereFragments(filters)
      const where = fragments.length > 0
        ? sql.join(fragments, sql` AND `)
        : sql`1=1`
      const limit = filters.limit ?? 50
      const offset = filters.offset ?? 0

      const countRows = db.all<Record<string, unknown>>(
        sql`SELECT COUNT(*) as cnt FROM ai_traces WHERE ${where}`,
      )
      const total = Number((countRows[0] as any)?.cnt ?? 0)

      const rows = db.all<Record<string, unknown>>(
        sql`SELECT * FROM ai_traces WHERE ${where} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`,
      )

      return { traces: rows.map(mapRow), total }
    },

    getStats(from, to) {
      // Same reasoning as list(): use Drizzle sql fragments so parameter
      // binding actually happens. The old sql.raw(str, params) call was a
      // no-op for params and filtered nothing.
      const fragments: ReturnType<typeof sql>[] = []
      if (from) fragments.push(sql`timestamp >= ${from}`)
      if (to) fragments.push(sql`timestamp <= ${to}`)
      const where = fragments.length > 0
        ? sql.join(fragments, sql` AND `)
        : sql`1=1`

      // Daily costs
      const dailyRows = db.all<Record<string, unknown>>(
        sql`SELECT date(timestamp) as date, SUM(cost_usd) as cost, COUNT(*) as traces
            FROM ai_traces WHERE ${where}
            GROUP BY date(timestamp) ORDER BY date(timestamp) DESC LIMIT 30`,
      )

      // Model distribution
      const modelRows = db.all<Record<string, unknown>>(
        sql`SELECT model, COUNT(*) as count, SUM(cost_usd) as cost
            FROM ai_traces WHERE ${where}
            GROUP BY model ORDER BY cost DESC`,
      )

      // Top agents
      const agentRows = db.all<Record<string, unknown>>(
        sql`SELECT agent_session_id, COUNT(*) as count, SUM(cost_usd) as cost
            FROM ai_traces WHERE ${where} AND agent_session_id IS NOT NULL
            GROUP BY agent_session_id ORDER BY cost DESC LIMIT 10`,
      )

      // Totals
      const totals = db.all<Record<string, unknown>>(
        sql`SELECT COUNT(*) as total, SUM(cost_usd) as cost, AVG(latency_ms) as avg_latency
            FROM ai_traces WHERE ${where}`,
      )
      const t = totals[0] as any

      return {
        dailyCosts: dailyRows.map((r: any) => ({
          date: r.date as string,
          cost: Number(r.cost ?? 0),
          traces: Number(r.traces ?? 0),
        })),
        modelDistribution: modelRows.map((r: any) => ({
          model: r.model as string,
          count: Number(r.count ?? 0),
          cost: Number(r.cost ?? 0),
        })),
        topAgents: agentRows.map((r: any) => ({
          agentSessionId: r.agent_session_id as string,
          count: Number(r.count ?? 0),
          cost: Number(r.cost ?? 0),
        })),
        totalCost: Number(t?.cost ?? 0),
        totalTraces: Number(t?.total ?? 0),
        avgLatency: Number(t?.avg_latency ?? 0),
      }
    },

    getAnomalyData() {
      // Get 7-day rolling stats per model
      const rows = db.all<Record<string, unknown>>(
        sql`SELECT model,
              AVG(cost_usd) as avg_cost,
              AVG(latency_ms) as avg_latency,
              AVG(context_tokens + output_tokens) as avg_tokens,
              COUNT(*) as sample_count,
              -- Standard deviations
              (SUM(cost_usd * cost_usd) / COUNT(*) - (AVG(cost_usd) * AVG(cost_usd))) as var_cost,
              (SUM(latency_ms * latency_ms) / COUNT(*) - (AVG(latency_ms) * AVG(latency_ms))) as var_latency,
              (SUM((context_tokens + output_tokens) * (context_tokens + output_tokens)) / COUNT(*)
                - (AVG(context_tokens + output_tokens) * AVG(context_tokens + output_tokens))) as var_tokens
            FROM ai_traces
            WHERE timestamp >= datetime('now', '-7 days')
            GROUP BY model
            HAVING COUNT(*) >= 5`,
      )

      // Get last hour's stats per model
      const recentRows = db.all<Record<string, unknown>>(
        sql`SELECT model,
              AVG(cost_usd) as avg_cost,
              AVG(latency_ms) as avg_latency,
              AVG(context_tokens + output_tokens) as avg_tokens,
              COUNT(*) as cnt
            FROM ai_traces
            WHERE timestamp >= datetime('now', '-1 hour')
            GROUP BY model`,
      )

      const recentByModel = new Map(
        recentRows.map((r: any) => [r.model, r]),
      )

      const anomalies: AnomalyDataPoint[] = []

      for (const row of rows as any[]) {
        const recent = recentByModel.get(row.model)
        if (!recent || recent.cnt < 2) continue

        const checks = [
          { metric: 'cost_usd', current: recent.avg_cost, mean: row.avg_cost, variance: row.var_cost },
          { metric: 'latency_ms', current: recent.avg_latency, mean: row.avg_latency, variance: row.var_latency },
          { metric: 'total_tokens', current: recent.avg_tokens, mean: row.avg_tokens, variance: row.var_tokens },
        ]

        for (const check of checks) {
          const stddev = Math.sqrt(Math.max(0, check.variance))
          const threshold = check.mean + 2 * stddev
          if (check.current > threshold && stddev > 0) {
            anomalies.push({
              model: row.model,
              metric: check.metric,
              currentValue: Number(check.current),
              mean: Number(check.mean),
              stddev: Number(stddev),
              threshold: Number(threshold),
              timestamp: new Date().toISOString(),
            })
          }
        }
      }

      return anomalies
    },

    updateFeedback(id, score) {
      db.run(sql`UPDATE ai_traces SET quality_score_user = ${score} WHERE id = ${id}`)
    },

    updateAutoScore(id, score, evaluatorModel) {
      db.run(sql`UPDATE ai_traces SET quality_score_auto = ${score}, evaluator_model = ${evaluatorModel} WHERE id = ${id}`)
    },
  }
}

function mapRow(row: Record<string, unknown>): AiTrace {
  return {
    id: row.id as string,
    timestamp: row.timestamp as string,
    requestId: row.request_id as string,
    conversationId: (row.conversation_id as string) ?? null,
    agentSessionId: (row.agent_session_id as string) ?? null,
    model: row.model as string,
    provider: row.provider as string,
    memoryTiersUsed: (row.memory_tiers_used as string) ?? null,
    contextTokens: Number(row.context_tokens ?? 0),
    systemPromptTokens: Number(row.system_prompt_tokens ?? 0),
    toolDefinitions: (row.tool_definitions as string) ?? null,
    toolCalls: (row.tool_calls as string) ?? null,
    toolCallCount: Number(row.tool_call_count ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    latencyMs: Number(row.latency_ms ?? 0),
    qualityScoreAuto: row.quality_score_auto != null ? Number(row.quality_score_auto) : null,
    qualityScoreUser: (row.quality_score_user as string) ?? null,
    evaluatorModel: (row.evaluator_model as string) ?? null,
    error: (row.error as string) ?? null,
  }
}

/**
 * Wraps the model gateway with tracing instrumentation.
 * Records every complete() and stream() call as an ai_trace.
 */
export function wrapGatewayWithTracing(
  gateway: ModelGateway,
  collector: TraceCollector,
  ctx: ModuleContext,
): ModelGateway {
  return {
    registerProvider: gateway.registerProvider.bind(gateway),
    unregisterProvider: gateway.unregisterProvider.bind(gateway),
    getProvider: gateway.getProvider.bind(gateway),
    listProviders: gateway.listProviders.bind(gateway),
    listAllModels: gateway.listAllModels.bind(gateway),
    // Passthrough — the collector instruments completions only, not embeddings.
    embed: gateway.embed.bind(gateway),

    async complete(request: ModelRequest): Promise<ModelResponse> {
      const startTime = Date.now()
      const requestId = generateId()
      let response: ModelResponse | null = null
      let error: string | null = null

      try {
        response = await gateway.complete(request)
        return response
      } catch (err: any) {
        error = err?.message ?? String(err)
        throw err
      } finally {
        const latencyMs = Date.now() - startTime
        try {
          const model = response?.model ?? request.model ?? 'unknown'
          const provider = response?.provider ?? request.provider ?? 'unknown'
          const inputTokens = response?.usage?.inputTokens ?? 0
          const outputTokens = response?.usage?.outputTokens ?? 0
          const toolInfo = response ? countToolUseBlocks(response.content) : { count: 0, calls: '' }

          collector.insert({
            requestId,
            ...resolveAttribution(request),
            model,
            provider,
            memoryTiersUsed: null,
            contextTokens: inputTokens,
            systemPromptTokens: 0,
            toolDefinitions: request.tools ? JSON.stringify(request.tools.map((t) => t.name)) : null,
            toolCalls: toolInfo.calls || null,
            toolCallCount: toolInfo.count,
            outputTokens,
            costUsd: resolveCostUsd(provider, model, response, ctx.config?.model?.pricing),
            latencyMs,
            qualityScoreAuto: null,
            qualityScoreUser: null,
            evaluatorModel: null,
            error,
          })
        } catch (traceErr) {
          ctx.logger.warn({ err: traceErr }, 'Failed to record AI trace')
        }
      }
    },

    async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
      const startTime = Date.now()
      const requestId = generateId()
      let finalResponse: ModelResponse | null = null
      let error: string | null = null

      try {
        for await (const event of gateway.stream(request)) {
          if (event.type === 'done') {
            finalResponse = event.response
          }
          if (event.type === 'error') {
            error = event.error?.message ?? 'stream error'
          }
          yield event
        }
      } catch (err: any) {
        error = err?.message ?? String(err)
        throw err
      } finally {
        const latencyMs = Date.now() - startTime
        try {
          const model = finalResponse?.model ?? request.model ?? 'unknown'
          const provider = finalResponse?.provider ?? request.provider ?? 'unknown'
          const inputTokens = finalResponse?.usage?.inputTokens ?? 0
          const outputTokens = finalResponse?.usage?.outputTokens ?? 0
          const toolInfo = finalResponse
            ? countToolUseBlocks(finalResponse.content)
            : { count: 0, calls: '' }

          collector.insert({
            requestId,
            ...resolveAttribution(request),
            model,
            provider,
            memoryTiersUsed: null,
            contextTokens: inputTokens,
            systemPromptTokens: 0,
            toolDefinitions: request.tools ? JSON.stringify(request.tools.map((t) => t.name)) : null,
            toolCalls: toolInfo.calls || null,
            toolCallCount: toolInfo.count,
            outputTokens,
            costUsd: resolveCostUsd(provider, model, finalResponse, ctx.config?.model?.pricing),
            latencyMs,
            qualityScoreAuto: null,
            qualityScoreUser: null,
            evaluatorModel: null,
            error,
          })
        } catch (traceErr) {
          ctx.logger.warn({ err: traceErr }, 'Failed to record AI trace (stream)')
        }
      }
    },
  }
}
