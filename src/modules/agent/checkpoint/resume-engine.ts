// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EventStore } from '@modules/event-store/event-store.js'
import { applyEvent } from '@modules/event-store/replay-engine.js'
import type { CheckpointStoreApi } from './checkpoint-store.js'
import { CheckpointError, CheckpointState, ResumeResult } from './types.js'

/**
 * ResumeEngine — given a checkpoint id, reconstruct the CheckpointState
 * that the runner should pick up from.
 *
 * Two paths:
 *
 *   1. Happy path: state_blob alone is sufficient. This is the default —
 *      the checkpoint was created from a known-good in-memory state and no
 *      further events were appended to the session after it.
 *
 *   2. Follow-up events path: if events were appended after the checkpoint
 *      (seq > checkpoint.eventSeq), those events are folded on top of the
 *      stored state using the event-store replay engine. This handles the
 *      case where the session continued for a few events before a crash.
 */
export interface ResumeEngineApi {
  /** Load a checkpoint and return its state. Optionally fold follow-up events. */
  load(
    checkpointId: string,
    opts?: { replayFollowUp?: boolean },
  ): Promise<ResumeResult | null>
  /** Convenience alias that returns just the state, throwing on missing id. */
  loadState(checkpointId: string): Promise<CheckpointState>
}

export interface ResumeEngineOptions {
  eventStore?: EventStore
}

export function createResumeEngine(
  store: CheckpointStoreApi,
  opts: ResumeEngineOptions = {},
): ResumeEngineApi {
  async function load(
    checkpointId: string,
    loadOpts?: { replayFollowUp?: boolean },
  ): Promise<ResumeResult | null> {
    const cp = await store.getById(checkpointId)
    if (!cp) return null

    let state: CheckpointState = cp.state
    let followUpEvents = 0

    const replay = loadOpts?.replayFollowUp !== false
    if (replay && opts.eventStore) {
      // Fold events strictly after the checkpoint's eventSeq.
      const events = await opts.eventStore.queryArray(cp.sessionId, {
        fromSeq: cp.eventSeq + 1,
      })
      for (const ev of events) {
        state = applyEvent(state, ev) as CheckpointState
        followUpEvents++
      }
    }

    return { checkpoint: cp, state, followUpEvents }
  }

  async function loadState(checkpointId: string): Promise<CheckpointState> {
    const result = await load(checkpointId)
    if (!result) {
      throw new CheckpointError(
        `checkpoint not found: ${checkpointId}`,
        'checkpoint_not_found',
      )
    }
    return result.state
  }

  return { load, loadState }
}
