// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'
import { validateRoster } from './roster.js'
import { ensureGodModeSchema } from './schema.js'
import type {
  GodModeConfig,
  GodModeDecision,
  GodModeIsolation,
  GodModeParticipant,
  GodModeParticipantSpec,
  GodModeParticipantStatus,
  GodModeRun,
  GodModeRunStatus,
  GodModeTimelineEvent,
  ReviewScores,
} from './types.js'

const CONFIG_ID = 'default'
const TERMINAL_RUN = new Set<GodModeRunStatus>(['completed', 'failed', 'cancelled'])

export class RosterValidationError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'RosterValidationError'
  }
}

export interface InsertGodModeRunInput {
  conversationId: string
  userMessageId: number
  status?: GodModeRunStatus
  chairParticipantId: string | null
  participantsSnapshot: GodModeParticipantSpec[]
  isolation: GodModeIsolation
  sourceWorkingDirectory: string | null
}

export interface InsertGodModeParticipantInput {
  runId: string
  slotId: string
  providerId: string
  modelId: string
  status?: GodModeParticipantStatus
  workspacePath?: string | null
}

export interface GodModeRunPatch {
  status?: GodModeRunStatus
  winnerParticipantId?: string | null
  tieBroken?: boolean
  totalTokens?: number
  totalCostUsd?: number
  durationMs?: number
  error?: string | null
  insights?: string[]
  timeline?: GodModeTimelineEvent[]
  decision?: GodModeDecision | null
  completedAt?: string | null
}

export interface GodModeParticipantPatch {
  status?: GodModeParticipantStatus
  workspacePath?: string | null
  childRunId?: string | null
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  durationMs?: number
  voteFor?: string | null
  scores?: ReviewScores | null
  uniqueInsights?: string[]
  risks?: string[]
  summary?: string | null
  reviewSummary?: string | null
  error?: string | null
  completedAt?: string | null
}

export interface GodModeStore {
  getConfig(): GodModeConfig
  saveConfig(input: unknown, liveKeys: Set<string>, limits: { min: number; max: number }): GodModeConfig
  insertRun(input: InsertGodModeRunInput): GodModeRun
  updateRun(id: string, patch: GodModeRunPatch): void
  getRun(id: string): GodModeRun | null
  listRunsForConversation(conversationId: string): GodModeRun[]
  hasActiveRun(conversationId: string): boolean
  sumCost(runId: string): number
  insertParticipant(input: InsertGodModeParticipantInput): GodModeParticipant
  updateParticipant(id: string, patch: GodModeParticipantPatch): void
  listParticipants(runId: string): GodModeParticipant[]
  appendTimeline(runId: string, event: GodModeTimelineEvent): void
}

function defaultConfig(): GodModeConfig {
  return {
    participants: [],
    chairParticipantId: null,
    costCeilingUsd: null,
    workspaceRetentionHours: 72,
    updatedAt: new Date().toISOString(),
  }
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

function parseScores(raw: unknown): ReviewScores | null {
  if (raw == null || raw === '') return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object') return null
    const { quality, completeness, risk } = parsed as ReviewScores
    if ([quality, completeness, risk].some((n) => typeof n !== 'number')) return null
    return { quality, completeness, risk }
  } catch {
    return null
  }
}

function parseTimeline(raw: unknown): GodModeTimelineEvent[] {
  if (raw == null || raw === '') return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is GodModeTimelineEvent =>
      !!e && typeof e === 'object' && typeof e.at === 'string' && typeof e.key === 'string',
    )
  } catch {
    return []
  }
}

function parseDecision(raw: unknown): GodModeDecision | null {
  if (raw == null || raw === '') return null
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || typeof parsed.method !== 'string') return null
    return parsed as GodModeDecision
  } catch {
    return null
  }
}

function rowToConfig(row: any): GodModeConfig {
  let participants: GodModeConfig['participants'] = []
  try {
    const parsed = JSON.parse(row.participants ?? '[]')
    if (Array.isArray(parsed)) participants = parsed
  } catch {
    participants = []
  }
  return {
    participants,
    chairParticipantId: row.chair_participant_id ?? null,
    costCeilingUsd: row.cost_ceiling_usd ?? null,
    workspaceRetentionHours: row.workspace_retention_hours ?? 72,
    updatedAt: row.updated_at,
  }
}

function rowToRun(row: any): GodModeRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    status: row.status,
    winnerParticipantId: row.winner_participant_id ?? null,
    tieBroken: row.tie_broken === 1,
    chairParticipantId: row.chair_participant_id ?? null,
    participantsSnapshot: parseSnapshot(row.participants_snapshot),
    isolation: row.isolation,
    sourceWorkingDirectory: row.source_working_directory ?? null,
    totalTokens: row.total_tokens ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
    durationMs: row.duration_ms ?? 0,
    error: row.error ?? null,
    insights: parseJsonArray(row.insights),
    timeline: parseTimeline(row.timeline),
    decision: parseDecision(row.decision),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  }
}

function rowToParticipant(row: any): GodModeParticipant {
  return {
    id: row.id,
    runId: row.run_id,
    slotId: row.slot_id,
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    workspacePath: row.workspace_path ?? null,
    childRunId: row.child_run_id ?? null,
    tokensIn: row.tokens_in ?? 0,
    tokensOut: row.tokens_out ?? 0,
    costUsd: row.cost_usd ?? 0,
    durationMs: row.duration_ms ?? 0,
    voteFor: row.vote_for ?? null,
    scores: parseScores(row.scores),
    uniqueInsights: parseJsonArray(row.unique_insights),
    risks: parseJsonArray(row.risks),
    summary: row.summary ?? null,
    reviewSummary: row.review_summary ?? null,
    error: row.error ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  }
}

export function createGodModeStore(db: any): GodModeStore {
  ensureGodModeSchema(db)

  return {
    getConfig(): GodModeConfig {
      const rows = db.all(sql`SELECT * FROM god_mode_config WHERE id = ${CONFIG_ID}`) as any[]
      if (rows.length === 0) return defaultConfig()
      return rowToConfig(rows[0])
    },

    saveConfig(input: unknown, liveKeys: Set<string>, limits: { min: number; max: number }): GodModeConfig {
      const result = validateRoster(input, { ...limits, liveKeys, allowEmpty: true })
      if (!result.ok) throw new RosterValidationError(result.error)
      const config: GodModeConfig = { ...result.config, updatedAt: new Date().toISOString() }
      const participantsJson = JSON.stringify(config.participants)
      db.run(sql`
        INSERT INTO god_mode_config (
          id, participants, chair_participant_id, cost_ceiling_usd,
          workspace_retention_hours, updated_at
        ) VALUES (
          ${CONFIG_ID}, ${participantsJson}, ${config.chairParticipantId},
          ${config.costCeilingUsd}, ${config.workspaceRetentionHours}, ${config.updatedAt}
        )
        ON CONFLICT(id) DO UPDATE SET
          participants = excluded.participants,
          chair_participant_id = excluded.chair_participant_id,
          cost_ceiling_usd = excluded.cost_ceiling_usd,
          workspace_retention_hours = excluded.workspace_retention_hours,
          updated_at = excluded.updated_at
      `)
      return config
    },

    insertRun(input: InsertGodModeRunInput): GodModeRun {
      const id = generateId()
      const createdAt = new Date().toISOString()
      const status = input.status ?? 'preparing'
      const snapshot = JSON.stringify(input.participantsSnapshot)
      db.run(sql`
        INSERT INTO god_mode_runs (
          id, conversation_id, user_message_id, status, winner_participant_id,
          tie_broken, chair_participant_id, participants_snapshot, isolation,
          source_working_directory, total_tokens, total_cost_usd, duration_ms,
          error, insights, created_at, completed_at
        ) VALUES (
          ${id}, ${input.conversationId}, ${input.userMessageId}, ${status}, NULL,
          0, ${input.chairParticipantId}, ${snapshot}, ${input.isolation},
          ${input.sourceWorkingDirectory}, 0, 0, 0,
          NULL, NULL, ${createdAt}, NULL
        )
      `)
      return this.getRun(id)!
    },

    updateRun(id: string, patch: GodModeRunPatch): void {
      if (patch.status !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET status = ${patch.status} WHERE id = ${id}`)
      }
      if (patch.winnerParticipantId !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET winner_participant_id = ${patch.winnerParticipantId} WHERE id = ${id}`)
      }
      if (patch.tieBroken !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET tie_broken = ${patch.tieBroken ? 1 : 0} WHERE id = ${id}`)
      }
      if (patch.totalTokens !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET total_tokens = ${patch.totalTokens} WHERE id = ${id}`)
      }
      if (patch.totalCostUsd !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET total_cost_usd = ${patch.totalCostUsd} WHERE id = ${id}`)
      }
      if (patch.durationMs !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET duration_ms = ${patch.durationMs} WHERE id = ${id}`)
      }
      if (patch.error !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET error = ${patch.error} WHERE id = ${id}`)
      }
      if (patch.insights !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET insights = ${JSON.stringify(patch.insights)} WHERE id = ${id}`)
      }
      if (patch.timeline !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET timeline = ${JSON.stringify(patch.timeline)} WHERE id = ${id}`)
      }
      if (patch.decision !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET decision = ${patch.decision ? JSON.stringify(patch.decision) : null} WHERE id = ${id}`)
      }
      if (patch.completedAt !== undefined) {
        db.run(sql`UPDATE god_mode_runs SET completed_at = ${patch.completedAt} WHERE id = ${id}`)
      }
    },

    getRun(id: string): GodModeRun | null {
      const rows = db.all(sql`SELECT * FROM god_mode_runs WHERE id = ${id}`) as any[]
      return rows[0] ? rowToRun(rows[0]) : null
    },

    listRunsForConversation(conversationId: string): GodModeRun[] {
      const rows = db.all(sql`
        SELECT * FROM god_mode_runs
        WHERE conversation_id = ${conversationId}
        ORDER BY created_at DESC
      `) as any[]
      return rows.map(rowToRun)
    },

    hasActiveRun(conversationId: string): boolean {
      const rows = db.all(sql`
        SELECT id, status FROM god_mode_runs WHERE conversation_id = ${conversationId}
      `) as Array<{ status: GodModeRunStatus }>
      return rows.some((r) => !TERMINAL_RUN.has(r.status))
    },

    sumCost(runId: string): number {
      const rows = db.all(sql`
        SELECT COALESCE(SUM(cost_usd), 0) AS total
        FROM god_mode_participants WHERE run_id = ${runId}
      `) as Array<{ total: number }>
      return Number(rows[0]?.total ?? 0)
    },

    insertParticipant(input: InsertGodModeParticipantInput): GodModeParticipant {
      const id = generateId()
      const createdAt = new Date().toISOString()
      const status = input.status ?? 'pending'
      db.run(sql`
        INSERT INTO god_mode_participants (
          id, run_id, slot_id, provider_id, model_id, status, workspace_path,
          child_run_id, tokens_in, tokens_out, cost_usd, duration_ms,
          vote_for, scores, unique_insights, risks, summary, error,
          created_at, completed_at
        ) VALUES (
          ${id}, ${input.runId}, ${input.slotId}, ${input.providerId}, ${input.modelId},
          ${status}, ${input.workspacePath ?? null},
          NULL, 0, 0, 0, 0,
          NULL, NULL, NULL, NULL, NULL, NULL,
          ${createdAt}, NULL
        )
      `)
      const rows = db.all(sql`SELECT * FROM god_mode_participants WHERE id = ${id}`) as any[]
      return rowToParticipant(rows[0])
    },

    updateParticipant(id: string, patch: GodModeParticipantPatch): void {
      if (patch.status !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET status = ${patch.status} WHERE id = ${id}`)
      }
      if (patch.workspacePath !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET workspace_path = ${patch.workspacePath} WHERE id = ${id}`)
      }
      if (patch.childRunId !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET child_run_id = ${patch.childRunId} WHERE id = ${id}`)
      }
      if (patch.tokensIn !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET tokens_in = ${patch.tokensIn} WHERE id = ${id}`)
      }
      if (patch.tokensOut !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET tokens_out = ${patch.tokensOut} WHERE id = ${id}`)
      }
      if (patch.costUsd !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET cost_usd = ${patch.costUsd} WHERE id = ${id}`)
      }
      if (patch.durationMs !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET duration_ms = ${patch.durationMs} WHERE id = ${id}`)
      }
      if (patch.voteFor !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET vote_for = ${patch.voteFor} WHERE id = ${id}`)
      }
      if (patch.scores !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET scores = ${patch.scores ? JSON.stringify(patch.scores) : null} WHERE id = ${id}`)
      }
      if (patch.uniqueInsights !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET unique_insights = ${JSON.stringify(patch.uniqueInsights)} WHERE id = ${id}`)
      }
      if (patch.risks !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET risks = ${JSON.stringify(patch.risks)} WHERE id = ${id}`)
      }
      if (patch.summary !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET summary = ${patch.summary} WHERE id = ${id}`)
      }
      if (patch.reviewSummary !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET review_summary = ${patch.reviewSummary} WHERE id = ${id}`)
      }
      if (patch.error !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET error = ${patch.error} WHERE id = ${id}`)
      }
      if (patch.completedAt !== undefined) {
        db.run(sql`UPDATE god_mode_participants SET completed_at = ${patch.completedAt} WHERE id = ${id}`)
      }
    },

    listParticipants(runId: string): GodModeParticipant[] {
      const rows = db.all(sql`
        SELECT * FROM god_mode_participants WHERE run_id = ${runId} ORDER BY created_at ASC
      `) as any[]
      return rows.map(rowToParticipant)
    },

    appendTimeline(runId: string, event: GodModeTimelineEvent): void {
      let began = false
      try {
        db.run(sql.raw('BEGIN IMMEDIATE'))
        began = true
        const rows = db.all(sql`SELECT timeline FROM god_mode_runs WHERE id = ${runId}`) as any[]
        if (!rows[0]) {
          db.run(sql.raw('ROLLBACK'))
          return
        }
        const timeline = [...parseTimeline(rows[0].timeline), event]
        db.run(sql`UPDATE god_mode_runs SET timeline = ${JSON.stringify(timeline)} WHERE id = ${runId}`)
        db.run(sql.raw('COMMIT'))
      } catch (err) {
        if (began) {
          try { db.run(sql.raw('ROLLBACK')) } catch { /* transaction already gone */ }
        }
        throw err
      }
    },
  }
}
