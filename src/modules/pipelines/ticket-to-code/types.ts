// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Core type definitions for the ticket-to-code pipeline.
 * Intentionally standalone — external modules (Artifacts, Checkpoint,
 * AgentRunner, PRClient) are reached only through DI ports in `port-types.ts`.
 */

export const STAGE_NAMES = [
  'ingest',
  'pm-clarify',
  'architect-design',
  'dev-implement',
  'review',
  'pr-open',
  'deploy',
] as const

export type StageName = (typeof STAGE_NAMES)[number]

// The internal EYAS board is the only built-in ticket source — no
// vendor/ERP-specific ticket backend is privileged here. Operators who want
// an external tracker (e.g. their own issue tracker) can wire a custom
// TicketSourcePort implementation without EYAS core needing to know about it.
export const TICKET_SOURCES = ['board', 'manual'] as const
export type TicketSource = (typeof TICKET_SOURCES)[number]

export type PipelineStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_approval'

export type StageStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'awaiting_approval'

// ─── DB row shapes ───

export interface PipelineRunRow {
  id: string
  ticketSource: TicketSource
  ticketId: string
  status: PipelineStatus
  currentStage: StageName | null
  startedAt: number
  finishedAt: number | null
  startedBy: string | null
  config: PipelineRunConfig
}

export interface PipelineStageRunRow {
  id: string
  pipelineRunId: string
  stageName: StageName
  status: StageStatus
  startedAt: number | null
  finishedAt: number | null
  artifactId: string | null
  error: string | null
}

// ─── Per-run config ───

/**
 * Approval gates: a map of stage → boolean. `true` means the pipeline pauses
 * AFTER the stage completes, setting its status to `awaiting_approval`.
 * Defaults are configurable via orchestrator options.
 */
export interface PipelineRunConfig {
  approvalGates?: Partial<Record<StageName, boolean>>
  sessionId?: string | null
  agentIds?: Partial<Record<StageName, string>>
  prBaseBranch?: string
  dryRun?: boolean
}

// ─── Stage contract ───

export interface StageContext {
  runId: string
  sessionId: string | null
  startedBy: string | null
  stageName: StageName
  previousArtifactId: string | null
  config: PipelineRunConfig
}

export interface StageResult {
  artifactId: string
  summary: string
  /**
   * Optional: stages may emit questions that should be surfaced to a
   * human reviewer. If non-empty and the stage is configured to gate on
   * clarification, the pipeline moves to `awaiting_approval`.
   */
  openQuestions?: string[]
  /**
   * Free-form metadata the stage wants to persist on the stage run row.
   * Kept JSON-serializable.
   */
  metadata?: Record<string, unknown>
}

/**
 * Ticket payload resolved by the ingest stage and referenced by later
 * stages. Kept intentionally loose so a custom TicketSourcePort adapter can
 * map its native fields without tight coupling here.
 */
export interface TicketContext {
  source: TicketSource
  id: string
  title: string
  body: string
  tags?: string[]
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  reporter?: string | null
  url?: string | null
  customer?: string | null
  createdAt?: number
  raw?: Record<string, unknown>
}

// ─── Orchestrator runtime state ───

export interface PipelineState {
  run: PipelineRunRow
  stages: PipelineStageRunRow[]
}

export interface StartRunInput {
  ticketSource: TicketSource
  ticketId: string
  startedBy?: string | null
  config?: PipelineRunConfig
}
