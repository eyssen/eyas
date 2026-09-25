// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { generateId } from '@shared/crypto'
import {
  Checkpoint,
  CheckpointError,
  CheckpointKind,
  CheckpointState,
  CreateCheckpointInput,
  PruneOptions,
} from './types.js'

/**
 * CheckpointStore — CRUD over agent_checkpoints.
 *
 * Deliberately thin: no business logic about when to create, which events
 * to cross-reference, etc. Those decisions live in checkpoint-manager.
 */
export interface CheckpointStoreApi {
  insert(input: CreateCheckpointInput & { state: CheckpointState }): Promise<Checkpoint>
  getById(id: string): Promise<Checkpoint | null>
  listBySession(sessionId: string, limit?: number): Promise<Checkpoint[]>
  latestForSession(sessionId: string): Promise<Checkpoint | null>
  delete(id: string): Promise<boolean>
  pruneBySession(sessionId: string, opts: PruneOptions): Promise<number>
}

function rowToCheckpoint(r: any): Checkpoint {
  let state: CheckpointState
  try {
    state = JSON.parse(r.state_blob) as CheckpointState
  } catch {
    state = {
      sessionId: r.session_id,
      lastSeq: Number(r.event_seq),
      eventCount: 0,
      currentState: 'unknown',
      messages: [],
      toolCalls: [],
      pendingApprovals: [],
      grantedApprovals: [],
      tokensUsed: { input: 0, output: 0 },
      lastCheckpointSeq: null,
      lastCheckpointRef: null,
    }
  }
  return {
    id: r.id,
    sessionId: r.session_id,
    eventSeq: Number(r.event_seq),
    snapshotRef: r.snapshot_ref ?? null,
    label: r.label,
    kind: r.kind as CheckpointKind,
    reason: r.reason ?? null,
    createdAt: Number(r.created_at),
    createdBy: r.created_by,
    state,
  }
}

export function createCheckpointStore(db: EyasDb): CheckpointStoreApi {
  const dbAny = db as any

  async function insert(
    input: CreateCheckpointInput & { state: CheckpointState },
  ): Promise<Checkpoint> {
    // Validate input (state is not part of the Zod schema intentionally —
    // it is opaque to the DTO but required by the store).
    const parsed = CreateCheckpointInput.parse({
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      label: input.label,
      kind: input.kind,
      reason: input.reason,
      actor: input.actor,
      snapshotRef: input.snapshotRef,
    })

    const id = generateId()
    const now = Date.now()
    const stateBlob = JSON.stringify(input.state ?? {})

    dbAny.run(
      sql`INSERT INTO agent_checkpoints
        (id, session_id, event_seq, snapshot_ref, label, kind, reason, state_blob, created_at, created_by)
        VALUES (${id}, ${parsed.sessionId}, ${parsed.eventSeq}, ${parsed.snapshotRef ?? null},
                ${parsed.label}, ${parsed.kind}, ${parsed.reason ?? null},
                ${stateBlob}, ${now}, ${parsed.actor})`,
    )

    const row = dbAny.all(
      sql`SELECT * FROM agent_checkpoints WHERE id = ${id} LIMIT 1`,
    )[0] as any
    if (!row) {
      throw new CheckpointError('checkpoint insert failed', 'insert_failed')
    }
    return rowToCheckpoint(row)
  }

  async function getById(id: string): Promise<Checkpoint | null> {
    const rows = dbAny.all(
      sql`SELECT * FROM agent_checkpoints WHERE id = ${id} LIMIT 1`,
    ) as any[]
    if (!rows.length) return null
    return rowToCheckpoint(rows[0])
  }

  async function listBySession(sessionId: string, limit = 100): Promise<Checkpoint[]> {
    const safeLimit = Math.max(1, Math.min(limit, 1000))
    const rows = dbAny.all(
      sql`SELECT * FROM agent_checkpoints
          WHERE session_id = ${sessionId}
          ORDER BY created_at DESC, id DESC
          LIMIT ${safeLimit}`,
    ) as any[]
    return rows.map(rowToCheckpoint)
  }

  async function latestForSession(sessionId: string): Promise<Checkpoint | null> {
    const rows = dbAny.all(
      sql`SELECT * FROM agent_checkpoints
          WHERE session_id = ${sessionId}
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
    ) as any[]
    if (!rows.length) return null
    return rowToCheckpoint(rows[0])
  }

  async function deleteCheckpoint(id: string): Promise<boolean> {
    const existing = dbAny.all(
      sql`SELECT id FROM agent_checkpoints WHERE id = ${id} LIMIT 1`,
    ) as any[]
    if (!existing.length) return false
    dbAny.run(sql`DELETE FROM agent_checkpoints WHERE id = ${id}`)
    return true
  }

  /**
   * Prune a session's checkpoints:
   *  1. Keep the `keepLast` most recent (by created_at DESC).
   *  2. From the remaining candidates, optionally also drop anything older
   *     than `olderThanDays` days.
   *
   * Returns the number of rows actually deleted.
   */
  async function pruneBySession(sessionId: string, opts: PruneOptions): Promise<number> {
    const keepLast = Math.max(0, Math.floor(opts.keepLast))
    const olderThanDays =
      typeof opts.olderThanDays === 'number' && opts.olderThanDays >= 0
        ? opts.olderThanDays
        : null

    const all = dbAny.all(
      sql`SELECT id, created_at FROM agent_checkpoints
          WHERE session_id = ${sessionId}
          ORDER BY created_at DESC, id DESC`,
    ) as any[]

    if (!all.length) return 0

    // keepSet = first keepLast ids
    const protectedIds = new Set<string>(all.slice(0, keepLast).map((r: any) => r.id))
    const candidates = all.slice(keepLast)

    let toDelete: string[]
    if (olderThanDays === null) {
      toDelete = candidates.map((r: any) => r.id)
    } else {
      const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
      toDelete = candidates.filter((r: any) => Number(r.created_at) < cutoff).map((r: any) => r.id)
    }

    if (!toDelete.length) return 0

    let deleted = 0
    for (const id of toDelete) {
      if (protectedIds.has(id)) continue
      dbAny.run(sql`DELETE FROM agent_checkpoints WHERE id = ${id}`)
      deleted++
    }
    return deleted
  }

  return {
    insert,
    getById,
    listBySession,
    latestForSession,
    delete: deleteCheckpoint,
    pruneBySession,
  }
}
