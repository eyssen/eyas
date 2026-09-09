// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// memory_run — one audited ledger for extraction, consolidation and
// migration (spec §5; today's memory_capture_runs widened, not duplicated).
// The discipline it keeps: a skip writes a row too, so "why did nothing
// happen" is always answerable. Cost fields come from spike §2 #17.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'

export type MemoryRunType = 'extraction' | 'consolidation_light' | 'consolidation_heavy' | 'migration'
export type MemoryRunStatus = 'ok' | 'partial' | 'failed' | 'skipped' | 'degraded_no_model'

export interface MemoryRunInput {
  runType: MemoryRunType
  status: MemoryRunStatus
  /** The task an extraction run served; null for consolidation and migration. */
  conversationId?: string | null
  modelUsed?: string | null
  promptTemplateHash?: string | null
  rawModelOutputHash?: string | null
  rejectedCandidateCount?: number
  quarantinedCandidateCount?: number
  modelCallsUsed?: number
  tokensIn?: number
  tokensOut?: number
  costUsd?: number | null
  durationApiMs?: number | null
  /** SDK-bundled CLI version for claude-code, the API version string otherwise. */
  providerVersion?: string | null
  statsJson?: Record<string, unknown>
}

export interface MemoryRunRow {
  id: string
  runType: MemoryRunType
  status: MemoryRunStatus
  conversationId: string | null
  modelUsed: string | null
  promptTemplateHash: string | null
  rawModelOutputHash: string | null
  rejectedCandidateCount: number
  quarantinedCandidateCount: number
  modelCallsUsed: number
  tokensIn: number
  tokensOut: number
  costUsd: number | null
  durationApiMs: number | null
  providerVersion: string | null
  statsJson: Record<string, unknown> | null
  createdAt: number
  finishedAt: number | null
}

interface RawRunRow {
  id: string
  run_type: MemoryRunType
  status: MemoryRunStatus
  conversation_id: string | null
  model_used: string | null
  prompt_template_hash: string | null
  raw_model_output_hash: string | null
  rejected_candidate_count: number
  quarantined_candidate_count: number
  model_calls_used: number
  tokens_in: number
  tokens_out: number
  cost_usd: number | null
  duration_api_ms: number | null
  provider_version: string | null
  stats_json: string | null
  created_at: number
  finished_at: number | null
}

function toRow(r: RawRunRow): MemoryRunRow {
  return {
    id: r.id,
    runType: r.run_type,
    status: r.status,
    conversationId: r.conversation_id,
    modelUsed: r.model_used,
    promptTemplateHash: r.prompt_template_hash,
    rawModelOutputHash: r.raw_model_output_hash,
    rejectedCandidateCount: r.rejected_candidate_count,
    quarantinedCandidateCount: r.quarantined_candidate_count,
    modelCallsUsed: r.model_calls_used,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    durationApiMs: r.duration_api_ms,
    providerVersion: r.provider_version,
    statsJson: r.stats_json ? (JSON.parse(r.stats_json) as Record<string, unknown>) : null,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }
}

/** Insert a complete run row; returns its ULID. */
export function recordRun(db: EyasDb, run: MemoryRunInput): string {
  const id = generateId()
  const now = Date.now()
  db.run(sql`INSERT INTO memory_run (
      id, run_type, status, conversation_id, model_used, prompt_template_hash, raw_model_output_hash,
      rejected_candidate_count, quarantined_candidate_count, model_calls_used, tokens_in, tokens_out,
      cost_usd, duration_api_ms, provider_version, stats_json, created_at, finished_at)
    VALUES (
      ${id}, ${run.runType}, ${run.status}, ${run.conversationId ?? null}, ${run.modelUsed ?? null},
      ${run.promptTemplateHash ?? null}, ${run.rawModelOutputHash ?? null},
      ${run.rejectedCandidateCount ?? 0}, ${run.quarantinedCandidateCount ?? 0}, ${run.modelCallsUsed ?? 0},
      ${run.tokensIn ?? 0}, ${run.tokensOut ?? 0}, ${run.costUsd ?? null}, ${run.durationApiMs ?? null},
      ${run.providerVersion ?? null}, ${run.statsJson ? JSON.stringify(run.statsJson) : null}, ${now}, ${now})`)
  return id
}

export function getRun(db: EyasDb, runId: string): MemoryRunRow | null {
  const row = db.all<RawRunRow>(sql`SELECT * FROM memory_run WHERE id = ${runId}`)[0]
  return row ? toRow(row) : null
}

/** Merge a patch into an existing run and re-stamp finished_at. */
export function finishRun(
  db: EyasDb,
  runId: string,
  patch: Partial<Omit<MemoryRunInput, 'runType'>> & { status: MemoryRunStatus },
): void {
  const current = getRun(db, runId)
  if (!current) throw new Error(`finishRun: unknown run ${runId}`)
  const stats = patch.statsJson !== undefined ? patch.statsJson : current.statsJson
  db.run(sql`UPDATE memory_run SET
      status = ${patch.status},
      conversation_id = ${patch.conversationId !== undefined ? patch.conversationId : current.conversationId},
      model_used = ${patch.modelUsed !== undefined ? patch.modelUsed : current.modelUsed},
      prompt_template_hash = ${patch.promptTemplateHash !== undefined ? patch.promptTemplateHash : current.promptTemplateHash},
      raw_model_output_hash = ${patch.rawModelOutputHash !== undefined ? patch.rawModelOutputHash : current.rawModelOutputHash},
      rejected_candidate_count = ${patch.rejectedCandidateCount ?? current.rejectedCandidateCount},
      quarantined_candidate_count = ${patch.quarantinedCandidateCount ?? current.quarantinedCandidateCount},
      model_calls_used = ${patch.modelCallsUsed ?? current.modelCallsUsed},
      tokens_in = ${patch.tokensIn ?? current.tokensIn},
      tokens_out = ${patch.tokensOut ?? current.tokensOut},
      cost_usd = ${patch.costUsd !== undefined ? patch.costUsd : current.costUsd},
      duration_api_ms = ${patch.durationApiMs !== undefined ? patch.durationApiMs : current.durationApiMs},
      provider_version = ${patch.providerVersion !== undefined ? patch.providerVersion : current.providerVersion},
      stats_json = ${stats ? JSON.stringify(stats) : null},
      finished_at = ${Date.now()}
    WHERE id = ${runId}`)
}
