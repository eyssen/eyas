// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { ensureGodModeSchema } from '@modules/agent/god-mode/schema.js'
import type {
  GodModeIsolation,
  GodModeParticipantSpec,
  GodModeRun,
  GodModeRunStatus,
} from '@modules/agent/god-mode/types.js'

const EPS = 1e-9
const DEFAULT_LIMIT = 25
const MAX_LIMIT = 100

export interface GodModeWinRateRow {
  providerId: string
  modelId: string
  wins: number
  runs: number
}

export interface GodModeSummary {
  runs: number
  totalCostUsd: number
  avgDurationMs: number
  avgCostMultiple: number
  winRate: GodModeWinRateRow[]
}

export interface GodModeReportRun extends GodModeRun {
  winnerProviderId: string | null
  winnerModelId: string | null
}

export interface GodModeRunList {
  runs: GodModeReportRun[]
  total: number
}

function parseJsonArray(raw: unknown): string[] {
  if (raw == null || raw === '') return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseSnapshot(raw: unknown): GodModeParticipantSpec[] {
  if (raw == null || raw === '') return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rowToRun(row: any): GodModeReportRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    status: row.status as GodModeRunStatus,
    winnerParticipantId: row.winner_participant_id ?? null,
    tieBroken: row.tie_broken === 1,
    chairParticipantId: row.chair_participant_id ?? null,
    participantsSnapshot: parseSnapshot(row.participants_snapshot),
    isolation: row.isolation as GodModeIsolation,
    sourceWorkingDirectory: row.source_working_directory ?? null,
    totalTokens: row.total_tokens ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
    durationMs: row.duration_ms ?? 0,
    error: row.error ?? null,
    insights: parseJsonArray(row.insights),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
    winnerProviderId: row.winner_provider_id ?? null,
    winnerModelId: row.winner_model_id ?? null,
  }
}

function clampPage(raw: number | undefined, fallback: number, max?: number): number {
  if (raw == null || !Number.isFinite(raw) || raw < 0) return fallback
  const n = Math.floor(raw)
  return max != null ? Math.min(n, max) : n
}

export function summarizeGodMode(db: any): GodModeSummary {
  ensureGodModeSchema(db)

  const allRows = db.all(sql`
    SELECT id, status, winner_participant_id, total_cost_usd, duration_ms
    FROM god_mode_runs
  `) as Array<{
    id: string
    status: string
    winner_participant_id: string | null
    total_cost_usd: number
    duration_ms: number
  }>

  const runs = allRows.length
  const totalCostUsd = allRows.reduce((sum, r) => sum + Number(r.total_cost_usd ?? 0), 0)

  const completed = allRows.filter((r) => r.status === 'completed')
  const avgDurationMs = completed.length === 0
    ? 0
    : completed.reduce((sum, r) => sum + Number(r.duration_ms ?? 0), 0) / completed.length

  const completedIds = completed.map((r) => r.id)
  const participants = completedIds.length === 0
    ? []
    : db.all(sql`SELECT id, run_id, provider_id, model_id, cost_usd FROM god_mode_participants`) as Array<{
        id: string
        run_id: string
        provider_id: string
        model_id: string
        cost_usd: number
      }>

  const completedSet = new Set(completedIds)
  const partsByRun = new Map<string, typeof participants>()
  for (const p of participants) {
    if (!completedSet.has(p.run_id)) continue
    const list = partsByRun.get(p.run_id) ?? []
    list.push(p)
    partsByRun.set(p.run_id, list)
  }

  const multiples: number[] = []
  const tally = new Map<string, GodModeWinRateRow>()

  function rowFor(providerId: string, modelId: string): GodModeWinRateRow {
    const key = `${providerId}/${modelId}`
    let row = tally.get(key)
    if (!row) {
      row = { providerId, modelId, wins: 0, runs: 0 }
      tally.set(key, row)
    }
    return row
  }

  for (const run of completed) {
    const parts = partsByRun.get(run.id) ?? []
    const seen = new Set<string>()
    for (const p of parts) {
      const key = `${p.provider_id}/${p.model_id}`
      if (seen.has(key)) continue
      seen.add(key)
      rowFor(p.provider_id, p.model_id).runs += 1
    }
    const winner = parts.find((p) => p.id === run.winner_participant_id)
    if (winner) {
      rowFor(winner.provider_id, winner.model_id).wins += 1
      multiples.push(Number(run.total_cost_usd ?? 0) / Math.max(Number(winner.cost_usd ?? 0), EPS))
    }
  }

  const avgCostMultiple = multiples.length === 0
    ? 0
    : multiples.reduce((sum, n) => sum + n, 0) / multiples.length

  const winRate = [...tally.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (b.runs !== a.runs) return b.runs - a.runs
    const byProvider = a.providerId.localeCompare(b.providerId)
    return byProvider !== 0 ? byProvider : a.modelId.localeCompare(b.modelId)
  })

  return { runs, totalCostUsd, avgDurationMs, avgCostMultiple, winRate }
}

export function listGodModeRuns(
  db: any,
  opts: { limit?: number; offset?: number } = {},
): GodModeRunList {
  ensureGodModeSchema(db)
  const limit = clampPage(opts.limit, DEFAULT_LIMIT, MAX_LIMIT)
  const offset = clampPage(opts.offset, 0)

  const countRows = db.all(sql`SELECT COUNT(*) AS total FROM god_mode_runs`) as Array<{ total: number }>
  const total = Number(countRows[0]?.total ?? 0)

  const rows = db.all(sql`
    SELECT r.*, w.provider_id AS winner_provider_id, w.model_id AS winner_model_id
    FROM god_mode_runs r
    LEFT JOIN god_mode_participants w ON w.id = r.winner_participant_id
    ORDER BY r.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as any[]

  return { runs: rows.map(rowToRun), total }
}
