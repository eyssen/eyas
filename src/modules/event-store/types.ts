// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'

/**
 * Event Store — core tagged event union.
 *
 * Each event records a single significant occurrence in an agent session.
 * Events are append-only, ordered by (sessionId, seq), and sufficient to
 * deterministically reconstruct agent state via replay.
 *
 * Extensibility: the base shape is { type, payload }. Known event types are
 * validated via the EventTypes constant and their specific Zod schemas.
 * Unknown types are accepted (UnknownEvent) so downstream producers can
 * emit custom events without a core update.
 */

export const EventTypes = {
  ToolCall: 'ToolCall',
  ToolResult: 'ToolResult',
  LlmCall: 'LlmCall',
  LlmResponse: 'LlmResponse',
  StateTransition: 'StateTransition',
  ApprovalRequested: 'ApprovalRequested',
  ApprovalGranted: 'ApprovalGranted',
  Checkpoint: 'Checkpoint',
  // F2 T7 (D7) — the completeness critic's verdict on a finished run.
  CriticVerdict: 'CriticVerdict',
} as const

export type KnownEventType = (typeof EventTypes)[keyof typeof EventTypes]

// --- Zod schemas for payloads -----------------------------------------------

export const ToolCallPayload = z.object({
  toolName: z.string().min(1),
  input: z.record(z.unknown()).default({}),
  toolUseId: z.string().optional(),
})

export const ToolResultPayload = z.object({
  toolUseId: z.string().min(1),
  output: z.unknown(),
  durationMs: z.number().int().nonnegative(),
  success: z.boolean(),
  error: z.string().optional(),
  // Cap 3 keystone — carried on the result (not just the ToolCall) so the resume
  // idempotency ledger can be rebuilt from SUCCESSFUL results, robust to a
  // ToolCall-append failure and excluding failed (retryable) ops.
  toolName: z.string().optional(),
  argHash: z.string().optional(),
  argPreview: z.string().optional(),
})

export const LlmCallPayload = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  messagesHash: z.string().min(1),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
})

export const LlmResponsePayload = z.object({
  response: z.object({
    content: z.string(),
    stopReason: z.string().optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
})

export const StateTransitionPayload = z.object({
  from: z.string(),
  to: z.string(),
  reason: z.string().optional(),
})

export const ApprovalRequestedPayload = z.object({
  kind: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  approvalId: z.string().min(1),
})

export const ApprovalGrantedPayload = z.object({
  approvalId: z.string().min(1),
  grantedBy: z.string().min(1),
})

export const CheckpointPayload = z.object({
  snapshotRef: z.string().min(1),
})

/**
 * F2 T7 (D7) — one completeness-critic round on a run. `round` is the feedback
 * round this verdict belongs to (0 = the original run, 1 = its first feedback
 * resume), so the lineage's rounds are readable from the event stream alone.
 */
export const CriticVerdictPayload = z.object({
  verdict: z.enum(['complete', 'incomplete', 'unavailable']),
  reason: z.string().default(''),
  missing: z.array(z.string()).default([]),
  round: z.number().int().nonnegative().default(0),
})

// --- Base event shape -------------------------------------------------------

const BaseEvent = z.object({
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  type: z.string().min(1),
  actor: z.string().optional(),
  payload: z.record(z.unknown()),
})

export const AgentEventSchema = BaseEvent
export type AgentEvent = z.infer<typeof BaseEvent>

/**
 * Input for append() — sessionId/ts are required, but seq is assigned by the
 * store itself (monotonic per session).
 */
export const AppendEventInput = z.object({
  sessionId: z.string().min(1),
  ts: z.number().int().nonnegative().optional(),
  type: z.string().min(1),
  actor: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
})
export type AppendEventInput = z.infer<typeof AppendEventInput>

// --- Payload validator registry --------------------------------------------

export const payloadSchemas: Record<string, z.ZodTypeAny> = {
  [EventTypes.ToolCall]: ToolCallPayload,
  [EventTypes.ToolResult]: ToolResultPayload,
  [EventTypes.LlmCall]: LlmCallPayload,
  [EventTypes.LlmResponse]: LlmResponsePayload,
  [EventTypes.StateTransition]: StateTransitionPayload,
  [EventTypes.ApprovalRequested]: ApprovalRequestedPayload,
  [EventTypes.ApprovalGranted]: ApprovalGrantedPayload,
  [EventTypes.Checkpoint]: CheckpointPayload,
  [EventTypes.CriticVerdict]: CriticVerdictPayload,
}

/**
 * Validate an event's payload against its known schema (if registered).
 * Unknown types pass through untouched — the store accepts extensible types.
 */
export function validateEventPayload(type: string, payload: unknown): Record<string, unknown> {
  const schema = payloadSchemas[type]
  if (!schema) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return {}
    }
    return payload as Record<string, unknown>
  }
  return schema.parse(payload) as Record<string, unknown>
}

// --- Query options ----------------------------------------------------------

export interface EventQueryOptions {
  fromSeq?: number
  toSeq?: number
  types?: string[]
  limit?: number
}

// --- Reconstructed agent state ---------------------------------------------

export interface ReplayToolCall {
  seq: number
  toolName: string
  input: Record<string, unknown>
  toolUseId?: string
  result?: {
    output: unknown
    durationMs: number
    success: boolean
    error?: string
  }
}

export interface ReplayPendingApproval {
  approvalId: string
  kind: string
  payload: Record<string, unknown>
  requestedAt: number
}

export interface ReplayMessage {
  role: 'assistant' | 'user' | 'system'
  content: string
  ts: number
}

export interface AgentState {
  sessionId: string
  lastSeq: number
  eventCount: number
  currentState: string
  messages: ReplayMessage[]
  toolCalls: ReplayToolCall[]
  pendingApprovals: ReplayPendingApproval[]
  grantedApprovals: string[]
  tokensUsed: {
    input: number
    output: number
  }
  lastCheckpointSeq: number | null
  lastCheckpointRef: string | null
}

// --- Snapshot ---------------------------------------------------------------

export interface SnapshotRecord {
  id: number
  sessionId: string
  seq: number
  ts: number
  state: AgentState
  eventCount: number
}
