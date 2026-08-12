// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { CheckpointPort } from '../port-types.js'

/**
 * No-op CheckpointPort. Pipeline runs already persist their state in the
 * pipeline_runs/pipeline_stage_runs tables (see schema.ts), so a real
 * checkpoint store is not required for correctness today — this stub keeps
 * the port satisfied until a resumable-crash-recovery checkpoint store
 * (Phase 3B) is implemented.
 */
export function createNoopCheckpoint(): CheckpointPort {
  return {
    async save(): Promise<void> {},
    async load(): Promise<unknown | undefined> {
      return undefined
    },
  }
}
