// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-ai-runs.ts
//
// One row per AI edit attempt.
//
// This is not an audit log — it is what makes a long synchronous request
// survivable. `POST /designs/:id/ai` was measured at 8 min 43 s on a CLI
// provider, and until now the only record that it happened lived in a React
// boolean: a reload, a dropped connection, or a proxy hitting its read timeout
// (nginx defaults to 60 s) destroyed the answer even though the server went on
// to finish the work. With the outcome in a table, losing the response stops
// meaning losing the result — the panel simply reads the row.
//
// Time is stored as epoch milliseconds, against this module's ISO habit,
// because these two columns exist to be subtracted. `datetime('now')` yields
// `YYYY-MM-DD HH:MM:SS`, which `new Date()` parses as LOCAL time — a silent
// off-by-hours in every browser outside UTC.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'

export const DESIGN_AI_RUN_STATUSES = ['running', 'ok', 'failed', 'interrupted'] as const
export type DesignAiRunStatus = (typeof DESIGN_AI_RUN_STATUSES)[number]

/** Older attempts on one canvas, beyond this, are pruned as each run starts. */
export const MAX_RUNS_PER_DESIGN = 50

/** Validator output can run to pages; no panel shows more than this. */
export const MAX_RUN_MESSAGE_CHARS = 2_000

export const INTERRUPTED_MESSAGE = 'Interrupted by a server restart. The edit was not applied.'

export interface DesignAiRun {
  id: string
  designId: string
  instruction: string
  targetFile: string | null
  status: DesignAiRunStatus
  tier: string | null
  attempts: number | null
  message: string | null
  versionBefore: number | null
  versionAfter: number | null
  /** Epoch ms. */
  startedAt: number
  /** Epoch ms, null while running. */
  finishedAt: number | null
  /** Derived; null while running. */
  durationMs: number | null
  createdBy: string | null
}

export interface StartRunInput {
  designId: string
  instruction: string
  targetFile?: string
  versionBefore?: number
  createdBy?: string
}

export interface FinishRunInput {
  status: Exclude<DesignAiRunStatus, 'running'>
  tier?: string
  attempts?: number
  message?: string
  versionAfter?: number
}

export interface DesignAiRunService {
  start(input: StartRunInput): DesignAiRun
  /** Closes a run that is still `running`. Null for an unknown or already-closed id. */
  finish(id: string, input: FinishRunInput): DesignAiRun | null
  /** Newest first. */
  list(designId: string, limit?: number): DesignAiRun[]
  latest(designId: string): DesignAiRun | null
  /**
   * Close every row a vanished process left `running`. Called at module
   * registration: nothing else can distinguish an orphan from a live run,
   * because a live run only exists inside a request this process is serving.
   */
  reconcileInterrupted(): number
  /** The clock these rows are stamped with, so callers agree on "now". */
  now(): number
}

function toRun(raw: any): DesignAiRun {
  const startedAt = Number(raw.started_at)
  const finishedAt = raw.finished_at === null || raw.finished_at === undefined ? null : Number(raw.finished_at)
  return {
    id: raw.id,
    designId: raw.design_id,
    instruction: raw.instruction,
    targetFile: raw.target_file ?? null,
    status: raw.status as DesignAiRunStatus,
    tier: raw.tier ?? null,
    attempts: raw.attempts === null || raw.attempts === undefined ? null : Number(raw.attempts),
    message: raw.message ?? null,
    versionBefore: raw.version_before === null || raw.version_before === undefined ? null : Number(raw.version_before),
    versionAfter: raw.version_after === null || raw.version_after === undefined ? null : Number(raw.version_after),
    startedAt,
    finishedAt,
    durationMs: finishedAt === null ? null : Math.max(0, finishedAt - startedAt),
    createdBy: raw.created_by ?? null,
  }
}

function clip(message: string | undefined): string | null {
  if (message === undefined) return null
  return message.length > MAX_RUN_MESSAGE_CHARS ? `${message.slice(0, MAX_RUN_MESSAGE_CHARS - 1)}…` : message
}

export function createDesignAiRunService(db: EyasDb, now: () => number = Date.now): DesignAiRunService {
  function byId(id: string): DesignAiRun | null {
    const rows = db.all(sql`SELECT * FROM design_ai_runs WHERE id = ${id}`) as any[]
    return rows.length ? toRun(rows[0]) : null
  }

  /**
   * Keep the newest MAX_RUNS_PER_DESIGN for this canvas. Ordering falls back to
   * `seq` because two runs can share a millisecond and "newest" must not be a
   * coin toss.
   */
  function prune(designId: string): void {
    db.run(sql`DELETE FROM design_ai_runs
      WHERE design_id = ${designId}
        AND seq NOT IN (
          SELECT seq FROM design_ai_runs
          WHERE design_id = ${designId}
          ORDER BY started_at DESC, seq DESC
          LIMIT ${MAX_RUNS_PER_DESIGN}
        )`)
  }

  return {
    now,

    start(input) {
      const id = generateId()
      db.run(sql`INSERT INTO design_ai_runs
        (id, design_id, instruction, target_file, status, version_before, started_at, created_by)
        VALUES (${id}, ${input.designId}, ${input.instruction}, ${input.targetFile ?? null}, 'running',
                ${input.versionBefore ?? null}, ${now()}, ${input.createdBy ?? null})`)
      prune(input.designId)
      // Read back rather than reconstruct: the row is the truth, and a prune
      // that removed this very row would otherwise go unnoticed.
      return byId(id) ?? {
        id,
        designId: input.designId,
        instruction: input.instruction,
        targetFile: input.targetFile ?? null,
        status: 'running',
        tier: null,
        attempts: null,
        message: null,
        versionBefore: input.versionBefore ?? null,
        versionAfter: null,
        startedAt: now(),
        finishedAt: null,
        durationMs: null,
        createdBy: input.createdBy ?? null,
      }
    },

    finish(id, input) {
      const existing = byId(id)
      // A closed run keeps its first outcome. Two writers racing to explain the
      // same attempt is a bug worth failing quietly rather than overwriting.
      if (!existing || existing.status !== 'running') return null
      db.run(sql`UPDATE design_ai_runs SET
          status = ${input.status},
          tier = ${input.tier ?? null},
          attempts = ${input.attempts ?? null},
          message = ${clip(input.message)},
          version_after = ${input.versionAfter ?? null},
          finished_at = ${now()}
        WHERE id = ${id} AND status = 'running'`)
      return byId(id)
    },

    list(designId, limit = 10) {
      const capped = Math.max(1, Math.min(limit, MAX_RUNS_PER_DESIGN))
      return (db.all(sql`SELECT * FROM design_ai_runs
        WHERE design_id = ${designId}
        ORDER BY started_at DESC, seq DESC
        LIMIT ${capped}`) as any[]).map(toRun)
    },

    latest(designId) {
      return this.list(designId, 1)[0] ?? null
    },

    reconcileInterrupted() {
      const open = db.all(sql`SELECT id FROM design_ai_runs WHERE status = 'running'`) as any[]
      if (open.length === 0) return 0
      db.run(sql`UPDATE design_ai_runs
        SET status = 'interrupted', message = ${INTERRUPTED_MESSAGE}, finished_at = ${now()}
        WHERE status = 'running'`)
      return open.length
    },
  }
}
