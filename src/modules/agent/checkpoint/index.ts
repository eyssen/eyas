// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasDb } from '@core/types'
import type { EventStore } from '@modules/event-store/event-store.js'
import type { SnapshotManager } from '@modules/event-store/snapshot-manager.js'
import { createCheckpointTables } from './schema.js'
import { createCheckpointStore, type CheckpointStoreApi } from './checkpoint-store.js'
import {
  createCheckpointManager,
  type AutoCheckpointPolicy,
  type CheckpointManagerApi,
} from './checkpoint-manager.js'
import { createResumeEngine, type ResumeEngineApi } from './resume-engine.js'
import {
  Checkpoint,
  CheckpointState,
  CreateCheckpointInput,
  PruneOptions,
  ResumeResult,
} from './types.js'

/**
 * Public CheckpointAPI surfaced to the agent-runner (and tests).
 *
 * This is the integration contract documented in the README — the runner
 * holds a single CheckpointAPI instance and calls into it each turn.
 */
export interface CheckpointAPI {
  createCheckpoint(input: {
    sessionId: string
    eventSeq: number
    label: string
    kind: 'auto' | 'manual' | 'before_risky_tool'
    reason?: string
    state: CheckpointState
    actor: string
  }): Promise<Checkpoint>
  list(sessionId: string): Promise<Checkpoint[]>
  load(checkpointId: string): Promise<{ checkpoint: Checkpoint; state: CheckpointState } | null>
  prune(sessionId: string, opts: PruneOptions): Promise<number>
  shouldAutoCheckpoint(
    sessionId: string,
    turn: number,
    context?: { upcomingTool?: string },
  ): boolean
}

export interface CheckpointServices {
  api: CheckpointAPI
  store: CheckpointStoreApi
  manager: CheckpointManagerApi
  resume: ResumeEngineApi
}

export interface CreateCheckpointServicesOptions {
  eventStore?: EventStore
  snapshotManager?: SnapshotManager
  policy?: AutoCheckpointPolicy
}

/**
 * Factory — build all checkpoint services from a db handle and optional
 * event-store references. When eventStore / snapshotManager are present,
 * checkpoints co-create snapshots and resume can replay follow-up events.
 */
export function createCheckpointServices(
  db: EyasDb,
  opts: CreateCheckpointServicesOptions = {},
): CheckpointServices {
  const store = createCheckpointStore(db)
  const manager = createCheckpointManager(store, {
    snapshotManager: opts.snapshotManager,
    policy: opts.policy,
  })
  const resume = createResumeEngine(store, { eventStore: opts.eventStore })

  const api: CheckpointAPI = {
    async createCheckpoint(input) {
      const parsed = CreateCheckpointInput.parse({
        sessionId: input.sessionId,
        eventSeq: input.eventSeq,
        label: input.label,
        kind: input.kind,
        reason: input.reason,
        actor: input.actor,
      })
      return manager.createCheckpoint({ ...parsed, state: input.state })
    },
    async list(sessionId) {
      return manager.list(sessionId)
    },
    async load(checkpointId) {
      const r = await resume.load(checkpointId)
      if (!r) return null
      return { checkpoint: r.checkpoint, state: r.state }
    },
    async prune(sessionId, pruneOpts) {
      return manager.prune(sessionId, pruneOpts)
    },
    shouldAutoCheckpoint(sessionId, turn, context) {
      return manager.shouldAutoCheckpoint(sessionId, turn, context)
    },
  }

  return { api, store, manager, resume }
}

export { createCheckpointTables } from './schema.js'
export { createCheckpointStore } from './checkpoint-store.js'
export type { CheckpointStoreApi } from './checkpoint-store.js'
export { createCheckpointManager } from './checkpoint-manager.js'
export type {
  CheckpointManagerApi,
  AutoCheckpointPolicy,
  AutoCheckpointContext,
  CheckpointManagerOptions,
} from './checkpoint-manager.js'
export { createResumeEngine } from './resume-engine.js'
export type { ResumeEngineApi, ResumeEngineOptions } from './resume-engine.js'
export * from './types.js'
export type { Checkpoint, CheckpointState, ResumeResult, PruneOptions }
