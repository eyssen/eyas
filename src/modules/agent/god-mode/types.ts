// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── Config / roster ─────────────────────────────────────────────────────────

export interface GodModeParticipantSpec {
  id: string
  providerId: string
  modelId: string
}

export interface GodModeConfig {
  participants: GodModeParticipantSpec[]
  chairParticipantId: string | null
  costCeilingUsd: number | null
  workspaceRetentionHours: number
  updatedAt: string
}

export type RosterValidation =
  | { ok: true; config: GodModeConfig }
  | { ok: false; error: string }

// ─── Run lifecycle ───────────────────────────────────────────────────────────

export type GodModeRunStatus =
  | 'preparing'
  | 'racing'
  | 'reviewing'
  | 'deciding'
  | 'promoting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type GodModeParticipantStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type GodModeIsolation = 'worktree' | 'copy' | 'none'

export interface ReviewScores {
  quality: number
  completeness: number
  risk: number
}

/** Parsed cross-review JSON contract (one object per survivor). */
export interface ReviewVerdict {
  voteFor: string
  scores: ReviewScores
  uniqueInsights: string[]
  risks: string[]
  summary: string
}

export type GodModeDecisionMethod =
  | 'majority'
  | 'chair'
  | 'sole-survivor'
  | 'earliest-completed'

export interface GodModeDecision {
  method: GodModeDecisionMethod
  winnerSlotId: string
  tieBroken: boolean
  chairSlotId: string | null
  votes: Array<{ fromSlotId: string; voteFor: string | null }>
  counts: Record<string, number>
}

export type GodModeTimelineKey =
  | 'started'
  | 'racing'
  | 'worker-done'
  | 'worker-failed'
  | 'reviewing'
  | 'decided'
  | 'promoting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface GodModeTimelineEvent {
  at: string
  phase: GodModeRunStatus
  key: GodModeTimelineKey
  slotId: string | null
}

export interface GodModeParticipant {
  id: string
  runId: string
  slotId: string
  providerId: string
  modelId: string
  status: GodModeParticipantStatus
  workspacePath: string | null
  childRunId: string | null
  tokensIn: number
  tokensOut: number
  costUsd: number
  durationMs: number
  voteFor: string | null
  scores: ReviewScores | null
  uniqueInsights: string[]
  risks: string[]
  summary: string | null
  /** Cross-review commentary about the other workers (not the worker's own output). */
  reviewSummary: string | null
  error: string | null
  createdAt: string
  completedAt: string | null
}

export interface GodModeRun {
  id: string
  conversationId: string
  userMessageId: number
  status: GodModeRunStatus
  winnerParticipantId: string | null
  tieBroken: boolean
  chairParticipantId: string | null
  participantsSnapshot: GodModeParticipantSpec[]
  isolation: GodModeIsolation
  sourceWorkingDirectory: string | null
  totalTokens: number
  totalCostUsd: number
  durationMs: number
  error: string | null
  insights: string[]
  timeline: GodModeTimelineEvent[]
  decision: GodModeDecision | null
  createdAt: string
  completedAt: string | null
}
