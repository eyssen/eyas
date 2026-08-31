// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SnapshotManager } from '@modules/event-store/snapshot-manager.js'
import { Checkpoint, CheckpointState, CreateCheckpointInput, PruneOptions } from './types.js'
import type { CheckpointStoreApi } from './checkpoint-store.js'

/**
 * Policy config for automatic checkpointing.
 *
 * The runner calls shouldAutoCheckpoint(sessionId, turn) each turn; the
 * manager returns true on the turn boundaries that match the policy.
 */
export interface AutoCheckpointPolicy {
  /** Create a checkpoint every N turns. Default: 5. Set to 0 to disable. */
  everyTurns?: number
  /** Create one before any turn involving a red-tier tool. Default: true. */
  beforeRiskyTools?: boolean
  /** Tool names considered risky when `beforeRiskyTools` is true. */
  riskyToolNames?: string[]
}

export interface CheckpointManagerOptions {
  /** Optional event-store snapshot manager to co-create a snapshot alongside the checkpoint. */
  snapshotManager?: SnapshotManager
  /** Auto-checkpoint policy. */
  policy?: AutoCheckpointPolicy
}

export interface CheckpointManagerApi {
  createCheckpoint(
    input: CreateCheckpointInput & { state: CheckpointState },
  ): Promise<Checkpoint>
  list(sessionId: string, limit?: number): Promise<Checkpoint[]>
  latest(sessionId: string): Promise<Checkpoint | null>
  prune(sessionId: string, opts: PruneOptions): Promise<number>
  shouldAutoCheckpoint(sessionId: string, turn: number, context?: AutoCheckpointContext): boolean
}

export interface AutoCheckpointContext {
  /** The tool that is about to be invoked this turn (if any). */
  upcomingTool?: string
}

const DEFAULT_POLICY: Required<AutoCheckpointPolicy> = {
  everyTurns: 5,
  beforeRiskyTools: true,
  riskyToolNames: ['bash', 'shell', 'write_file', 'delete_file', 'db_exec', 'http_call'],
}

export function createCheckpointManager(
  store: CheckpointStoreApi,
  opts: CheckpointManagerOptions = {},
): CheckpointManagerApi {
  const policy: Required<AutoCheckpointPolicy> = {
    ...DEFAULT_POLICY,
    ...(opts.policy ?? {}),
    riskyToolNames: opts.policy?.riskyToolNames ?? DEFAULT_POLICY.riskyToolNames,
  }

  /**
   * Create a checkpoint. If a SnapshotManager was provided, also materialise
   * an event-store snapshot so resume can skip replay.
   */
  async function createCheckpoint(
    input: CreateCheckpointInput & { state: CheckpointState },
  ): Promise<Checkpoint> {
    let snapshotRef = input.snapshotRef ?? null
    if (!snapshotRef && opts.snapshotManager) {
      try {
        const snap = await opts.snapshotManager.createSnapshot(input.sessionId)
        snapshotRef = String(snap.id)
      } catch {
        // Snapshot co-creation is best-effort — a missing snapshot does not
        // invalidate the checkpoint (state_blob is sufficient to resume).
        snapshotRef = null
      }
    }
    return store.insert({ ...input, snapshotRef: snapshotRef ?? undefined })
  }

  async function list(sessionId: string, limit?: number): Promise<Checkpoint[]> {
    return store.listBySession(sessionId, limit)
  }

  async function latest(sessionId: string): Promise<Checkpoint | null> {
    return store.latestForSession(sessionId)
  }

  async function prune(sessionId: string, options: PruneOptions): Promise<number> {
    return store.pruneBySession(sessionId, options)
  }

  /**
   * Auto-checkpoint decision:
   *   - policy.beforeRiskyTools AND upcoming tool ∈ riskyToolNames  → true
   *   - turn > 0 AND turn % everyTurns === 0                        → true
   */
  function shouldAutoCheckpoint(
    _sessionId: string,
    turn: number,
    context?: AutoCheckpointContext,
  ): boolean {
    if (policy.beforeRiskyTools && context?.upcomingTool) {
      if (policy.riskyToolNames.includes(context.upcomingTool)) return true
    }
    if (policy.everyTurns > 0 && turn > 0 && turn % policy.everyTurns === 0) {
      return true
    }
    return false
  }

  return { createCheckpoint, list, latest, prune, shouldAutoCheckpoint }
}
