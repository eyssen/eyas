// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// L(-1) capture bridge — the ONE function every persistence hook calls.
//
// Why a process-global: `ModuleLoader` orders modules by hard dependencies
// only; conversations, tools and event-store all persist before memory's
// onStart on every real boot (src/core/bootstrap.ts registration order), and
// the hooks live in files that have no ctx. Units captured before
// `attachIngest` are held in a bounded queue and drained on attach — the
// same lazy-resolution idea as conversations/memory-hooks.ts, without a
// dynamic import on the hot path. Nothing here ever throws to a caller.

import type { MemoryIngest } from './ingest.js'

export type RawSourceType =
  | 'user_message'
  | 'assistant_message'
  | 'tool_result'
  | 'document'
  | 'r6_sync'
  | 'legacy_episodic'

export type TrustTier = 'owner' | 'derived' | 'ingested' | 'peer' | 'quarantined'

export interface CaptureUnit {
  /** Capture-time ULID (generateId()). The exactly-once key of the flush. */
  id: string
  sourceType: RawSourceType
  actor: string
  /** = task (spec §9: a task is a conversation). */
  conversationId: string
  /** Effective project (D2 already applied: `general-general` → null). */
  projectId: string | null
  projectTypeId: string | null
  occurredAtMs: number
  content: string
  trustTier: TrustTier
  /** Crypto-shred / blob-dedup partition; defaults to the conversation. */
  shredPartitionId?: string
  /** Free-form provenance (message id, attachments, session, tool name…). Stored as meta_json. */
  meta?: Record<string, unknown>
}

/**
 * The pre-attach queue is bounded by item COUNT, not bytes — tool-result
 * clipping happens downstream in the ingest. Normally the window is one boot,
 * so that is fine. It is NOT fine when the memory module is disabled outright
 * (`modules.disabled: [memory]`): the three capture hooks are static imports in
 * other modules and keep calling `captureUnit` for the life of the process,
 * with nothing ever attaching or disabling. The bridge then holds 5 000 units
 * of unknown size and evicts silently. Every other non-attach path now calls
 * `disableIngestBridge()`; this one cannot, because the hooks have no way to
 * know the module is absent. Accepted, and recorded here rather than left to be
 * rediscovered.
 */
export const BRIDGE_MAX_PENDING = 5_000

type BridgeLogger = {
  warn: (obj: unknown, msg?: string) => void
  info?: (obj: unknown, msg?: string) => void
}

let ingest: MemoryIngest | null = null
let disabled = false
const pending: CaptureUnit[] = []
let dropped = 0

export function captureUnit(unit: CaptureUnit): void {
  if (disabled) return
  if (ingest) {
    try {
      ingest.enqueue(unit)
    } catch {
      /* the ingest logs its own failures; a hook must never see one */
    }
    return
  }
  if (pending.length >= BRIDGE_MAX_PENDING) {
    pending.shift()
    dropped++
  }
  pending.push(unit)
}

/**
 * Attaching clears `disabled`: a config flip from off to on is exactly how the
 * bridge is meant to come back. Whether that flip really happened is the
 * caller's to check — `wireL0Capture` branches on `memory.l0.enabled` and calls
 * either this or `disableIngestBridge`, never both.
 */
export function attachIngest(next: MemoryIngest, logger?: BridgeLogger): void {
  ingest = next
  disabled = false
  // Units dropped while nothing was attached, i.e. the pre-attach buffer filled.
  const overflowed = dropped
  const drained = pending.splice(0, pending.length)
  let rejected = 0
  for (const unit of drained) {
    try {
      next.enqueue(unit)
    } catch (err) {
      rejected++
      logger?.warn({ err, unitId: unit.id }, 'L0 bridge: buffered unit rejected by the ingest')
    }
  }
  // The overflow is reported here and then forgotten; the rejections are not.
  // L0 is meant to be complete, so a unit the ingest refused stays visible
  // through droppedUnits() even when the caller supplied no logger.
  dropped = rejected
  if (overflowed > 0 || rejected > 0) {
    logger?.warn(
      { dropped: overflowed, rejected, drained: drained.length },
      'L0 bridge: units captured before memory started were lost (pre-attach buffer full, or rejected by the ingest)',
    )
  } else if (drained.length > 0) {
    logger?.info?.({ drained: drained.length }, 'L0 bridge: drained units captured before memory started')
  }
}

export function detachIngest(): void {
  ingest = null
  // Same reason as disableIngestBridge: a count belonging to this lifecycle must
  // not resurface at the next attach labelled as a pre-attach buffer overflow.
  dropped = 0
}

export function pendingUnits(): number {
  return pending.length
}

export function droppedUnits(): number {
  return dropped
}

/** memory.l0.enabled=false: capture nothing, buffer nothing. */
export function disableIngestBridge(): void {
  disabled = true
  ingest = null
  pending.length = 0
  // Without this, a stale count resurfaces at the next attach as a warning that
  // contradicts itself: "the buffer overflowed" for an attach that drained nothing.
  dropped = 0
}

/** Tests only — module state is process-global. */
export function resetIngestBridge(): void {
  ingest = null
  disabled = false
  pending.length = 0
  dropped = 0
}
