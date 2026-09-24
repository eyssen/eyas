// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { AgentState } from '@modules/event-store/types.js'

/**
 * Checkpoint — named pointer into a session's event stream plus a cached
 * snapshot of the runtime state (messages, pending tool calls, approvals,
 * token usage, turn counter).
 *
 * A checkpoint is cheap to create and is independent from event-store
 * snapshots: it references a seq, but does not require a snapshot to exist
 * at that seq. If one does (snapshot_ref), resume is accelerated; otherwise
 * the state_blob is sufficient on its own.
 */

export const CheckpointKinds = {
  auto: 'auto',
  manual: 'manual',
  beforeRiskyTool: 'before_risky_tool',
} as const

export type CheckpointKind = (typeof CheckpointKinds)[keyof typeof CheckpointKinds]

export const CheckpointKindSchema = z.enum(['auto', 'manual', 'before_risky_tool'])

/**
 * Structured state blob stored with every checkpoint. Mirrors the
 * event-store AgentState but is framed as its own type so the checkpoint
 * module can evolve independently (e.g. add budget counters beyond tokens).
 */
export interface CheckpointState extends AgentState {
  /** Turn counter — how many agent turns have completed in this session. */
  turn?: number
  /** Free-form metadata the runner may attach (e.g. active tool-use IDs). */
  meta?: Record<string, unknown>
}

export interface CheckpointMetadata {
  /** When this checkpoint was created (unix ms). */
  createdAt: number
  /** Identifier of who / what created the checkpoint (user, agent, policy). */
  createdBy: string
  /** Reason surfaced in the UI / audit log. */
  reason?: string
}

export interface Checkpoint {
  id: string
  sessionId: string
  eventSeq: number
  snapshotRef: string | null
  label: string
  kind: CheckpointKind
  reason: string | null
  createdAt: number
  createdBy: string
  /** Note: state is parsed lazily; prefer load() / loadState() when you need it. */
  state: CheckpointState
}

export interface ResumeResult {
  checkpoint: Checkpoint
  state: CheckpointState
  /** Events that arrived after the checkpoint's eventSeq (empty on idle session). */
  followUpEvents: number
}

/**
 * Input DTO for checkpoint creation.
 */
export const CreateCheckpointInput = z.object({
  sessionId: z.string().min(1),
  eventSeq: z.number().int().nonnegative(),
  label: z.string().min(1).max(200),
  kind: CheckpointKindSchema,
  reason: z.string().max(2000).optional(),
  actor: z.string().min(1),
  snapshotRef: z.string().min(1).optional(),
})

export type CreateCheckpointInput = z.infer<typeof CreateCheckpointInput>

export interface PruneOptions {
  keepLast: number
  olderThanDays?: number
}

export class CheckpointError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'CheckpointError'
  }
}
