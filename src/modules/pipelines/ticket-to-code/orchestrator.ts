// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { PipelineDeps } from './port-types.js'
import {
  STAGE_NAMES,
  type PipelineRunConfig,
  type PipelineRunRow,
  type PipelineStageRunRow,
  type PipelineState,
  type PipelineStatus,
  type StageContext,
  type StageName,
  type StageResult,
  type StageStatus,
  type StartRunInput,
  type TicketSource,
} from './types.js'
import { runIngestStage } from './stages/ingest.js'
import { runPmClarifyStage } from './stages/pm-clarify.js'
import { runArchitectDesignStage } from './stages/architect-design.js'
import { runDevImplementStage } from './stages/dev-implement.js'
import { runReviewStage } from './stages/review.js'
import { runPrOpenStage } from './stages/pr-open.js'
import { runDeployStage } from './stages/deploy.js'

// ─── Row helpers ─────────────────────────────────────────────

function rowToRun(r: any): PipelineRunRow {
  let cfg: PipelineRunConfig = {}
  try {
    cfg = r.config ? (JSON.parse(r.config) as PipelineRunConfig) : {}
  } catch {
    cfg = {}
  }
  return {
    id: r.id,
    ticketSource: r.ticket_source as TicketSource,
    ticketId: r.ticket_id,
    status: r.status as PipelineStatus,
    currentStage: (r.current_stage as StageName) ?? null,
    startedAt: Number(r.started_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
    startedBy: r.started_by ?? null,
    config: cfg,
  }
}

function rowToStage(r: any): PipelineStageRunRow {
  return {
    id: r.id,
    pipelineRunId: r.pipeline_run_id,
    stageName: r.stage_name as StageName,
    status: r.status as StageStatus,
    startedAt: r.started_at == null ? null : Number(r.started_at),
    finishedAt: r.finished_at == null ? null : Number(r.finished_at),
    artifactId: r.artifact_id ?? null,
    error: r.error ?? null,
  }
}

// ─── Orchestrator service ────────────────────────────────────

export class PipelineNotFoundError extends Error {
  constructor(id: string) {
    super(`Pipeline run not found: ${id}`)
    this.name = 'PipelineNotFoundError'
  }
}

export class InvalidPipelineStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPipelineStateError'
  }
}

export interface TicketToCodeOrchestrator {
  start(input: StartRunInput): Promise<PipelineState>
  getState(runId: string): PipelineState
  listRuns(limit?: number): PipelineRunRow[]
  approve(runId: string, stageName: StageName): Promise<PipelineState>
  cancel(runId: string): PipelineState
  resume(runId: string): Promise<PipelineState>
}

export interface TicketToCodeOrchestratorOptions {
  /**
   * Operator-configured default approval gates (from
   * `config.pipelines.ticketToCode.approvalGates`). Applied to a run's
   * config only when the `start()` caller doesn't supply its own
   * `config.approvalGates` — an explicit per-run value (including `{}`)
   * always wins over this default.
   */
  defaultApprovalGates?: Partial<Record<StageName, boolean>>
}

export function createTicketToCodeOrchestrator(
  db: EyasDb,
  deps: PipelineDeps,
  options: TicketToCodeOrchestratorOptions = {},
): TicketToCodeOrchestrator {
  const now = deps.now ?? (() => Date.now())
  const newId =
    deps.newId ??
    (() =>
      // Fallback for test environments; pipelines module uses crypto.randomUUID in prod.
      `pr_${Math.random().toString(36).slice(2, 10)}_${now().toString(36)}`)

  function getRunRow(id: string): PipelineRunRow {
    const rows = (db as any).all(sql`SELECT * FROM pipeline_runs WHERE id = ${id}`) as any[]
    if (rows.length === 0) throw new PipelineNotFoundError(id)
    return rowToRun(rows[0])
  }

  function getStageRows(runId: string): PipelineStageRunRow[] {
    const rows = (db as any).all(
      sql`SELECT * FROM pipeline_stage_runs WHERE pipeline_run_id = ${runId} ORDER BY rowid ASC`,
    ) as any[]
    return rows.map(rowToStage)
  }

  function stageIndex(name: StageName): number {
    return STAGE_NAMES.indexOf(name)
  }

  function updateRun(id: string, patch: Partial<PipelineRunRow>) {
    const sets: string[] = []
    const values: unknown[] = []
    if (patch.status !== undefined) {
      sets.push('status = ?')
      values.push(patch.status)
    }
    if (patch.currentStage !== undefined) {
      sets.push('current_stage = ?')
      values.push(patch.currentStage)
    }
    if (patch.finishedAt !== undefined) {
      sets.push('finished_at = ?')
      values.push(patch.finishedAt)
    }
    if (sets.length === 0) return
    // Use parameterized sql.raw to avoid dynamic SQL pitfalls: build tagged
    // template via multiple statements since drizzle sql`` is positional.
    // Simple approach: run targeted UPDATEs per field.
    if (patch.status !== undefined) {
      db.run(sql`UPDATE pipeline_runs SET status = ${patch.status} WHERE id = ${id}`)
    }
    if (patch.currentStage !== undefined) {
      db.run(sql`UPDATE pipeline_runs SET current_stage = ${patch.currentStage} WHERE id = ${id}`)
    }
    if (patch.finishedAt !== undefined) {
      db.run(sql`UPDATE pipeline_runs SET finished_at = ${patch.finishedAt} WHERE id = ${id}`)
    }
  }

  function updateStage(stageId: string, patch: Partial<PipelineStageRunRow>) {
    if (patch.status !== undefined) {
      db.run(sql`UPDATE pipeline_stage_runs SET status = ${patch.status} WHERE id = ${stageId}`)
    }
    if (patch.startedAt !== undefined) {
      db.run(sql`UPDATE pipeline_stage_runs SET started_at = ${patch.startedAt} WHERE id = ${stageId}`)
    }
    if (patch.finishedAt !== undefined) {
      db.run(sql`UPDATE pipeline_stage_runs SET finished_at = ${patch.finishedAt} WHERE id = ${stageId}`)
    }
    if (patch.artifactId !== undefined) {
      db.run(sql`UPDATE pipeline_stage_runs SET artifact_id = ${patch.artifactId} WHERE id = ${stageId}`)
    }
    if (patch.error !== undefined) {
      db.run(sql`UPDATE pipeline_stage_runs SET error = ${patch.error} WHERE id = ${stageId}`)
    }
  }

  function stateOf(runId: string): PipelineState {
    const run = getRunRow(runId)
    const stages = getStageRows(runId)
    return { run, stages }
  }

  function getStage(runId: string, stageName: StageName): PipelineStageRunRow {
    const stage = getStageRows(runId).find((s) => s.stageName === stageName)
    if (!stage) {
      throw new InvalidPipelineStateError(`Stage "${stageName}" not found for run ${runId}`)
    }
    return stage
  }

  /**
   * Run a single stage. Updates row statuses and calls the checkpoint
   * port BEFORE any work. On failure, marks the pipeline `failed` so
   * the caller can call `resume` to retry.
   */
  async function runStage(
    runId: string,
    stageName: StageName,
    ticketCtx: { source: TicketSource; id: string },
    config: PipelineRunConfig,
    startedBy: string | null,
  ): Promise<StageStatus> {
    const stage = getStage(runId, stageName)
    // Skip if already terminal
    if (stage.status === 'succeeded' || stage.status === 'skipped') return stage.status

    // Mark running
    const tNow = now()
    updateStage(stage.id, { status: 'running', startedAt: stage.startedAt ?? tNow, error: null })
    updateRun(runId, { currentStage: stageName, status: 'running' })

    // Checkpoint
    try {
      await deps.checkpoint?.save(`pipeline:${runId}:${stageName}:start`, {
        runId,
        stageName,
        startedAt: tNow,
      })
    } catch (err) {
      deps.logger?.warn?.('checkpoint save failed', err)
    }

    const prevArtifactId = findPreviousArtifactId(runId, stageName)
    const ctx: StageContext = {
      runId,
      sessionId: config.sessionId ?? null,
      startedBy,
      stageName,
      previousArtifactId: prevArtifactId,
      config,
    }

    try {
      let result: StageResult
      switch (stageName) {
        case 'ingest':
          result = await runIngestStage(deps, ctx, ticketCtx.source, ticketCtx.id)
          break
        case 'pm-clarify':
          result = await runPmClarifyStage(deps, ctx)
          break
        case 'architect-design':
          result = await runArchitectDesignStage(deps, ctx)
          break
        case 'dev-implement':
          result = await runDevImplementStage(deps, ctx)
          break
        case 'review':
          result = await runReviewStage(deps, ctx)
          break
        case 'pr-open': {
          const diffId = findArtifactIdForStage(runId, 'dev-implement')
          if (!diffId) throw new Error('pr-open requires dev-implement artifact')
          result = await runPrOpenStage(deps, ctx, diffId)
          break
        }
        case 'deploy': {
          const diffId = findArtifactIdForStage(runId, 'dev-implement')
          if (!diffId) throw new Error('deploy requires dev-implement artifact')
          result = await runDeployStage(deps, ctx, diffId)
          break
        }
        default:
          throw new Error(`Unknown stage: ${stageName}`)
      }

      updateStage(stage.id, {
        status: 'succeeded',
        finishedAt: now(),
        artifactId: result.artifactId,
        error: null,
      })

      // Approval gate? Gates fire AFTER a successful stage.
      const gate = config.approvalGates?.[stageName] === true
      if (gate) {
        updateStage(stage.id, { status: 'awaiting_approval' })
        updateRun(runId, { status: 'waiting_approval' })
        return 'awaiting_approval'
      }

      return 'succeeded'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateStage(stage.id, { status: 'failed', finishedAt: now(), error: msg })
      updateRun(runId, { status: 'failed' })
      deps.logger?.error?.(`Stage ${stageName} failed for run ${runId}: ${msg}`)
      return 'failed'
    }
  }

  function findPreviousArtifactId(runId: string, stageName: StageName): string | null {
    const idx = stageIndex(stageName)
    if (idx <= 0) return null
    const stages = getStageRows(runId)
    // Walk backwards from the previous stage; skip stages that don't
    // produce a new artifact (pr-open reuses dev-implement's artifact).
    for (let i = idx - 1; i >= 0; i--) {
      const name = STAGE_NAMES[i]!
      const s = stages.find((x) => x.stageName === name)
      if (s?.artifactId) return s.artifactId
    }
    return null
  }

  function findArtifactIdForStage(runId: string, stageName: StageName): string | null {
    const s = getStageRows(runId).find((x) => x.stageName === stageName)
    return s?.artifactId ?? null
  }

  /**
   * Execute stages sequentially from the current position. Honors:
   *  - approval gates: stop when a stage produces `awaiting_approval`
   *  - failure: stop when a stage returns `failed`
   *  - cancellation: stop when the run status becomes `cancelled`
   */
  async function executeFrom(runId: string): Promise<PipelineState> {
    const run = getRunRow(runId)
    const stages = getStageRows(runId)

    for (const stageName of STAGE_NAMES) {
      const stage = stages.find((s) => s.stageName === stageName)
      if (!stage) continue
      if (stage.status === 'succeeded' || stage.status === 'skipped') continue
      // awaiting_approval: caller must call approve() first.
      if (stage.status === 'awaiting_approval') {
        updateRun(runId, { status: 'waiting_approval' })
        return stateOf(runId)
      }

      // If an earlier stage failed hard, stop.
      const current = getRunRow(runId)
      if (current.status === 'cancelled') return stateOf(runId)

      const outcome = await runStage(
        runId,
        stageName,
        { source: run.ticketSource, id: run.ticketId },
        run.config,
        run.startedBy,
      )
      if (outcome === 'failed' || outcome === 'awaiting_approval') {
        return stateOf(runId)
      }
    }

    // All stages succeeded
    updateRun(runId, { status: 'completed', currentStage: null, finishedAt: now() })
    return stateOf(runId)
  }

  return {
    async start(input) {
      const runId = newId()
      const tNow = now()
      // Operator default gates apply unless the caller's config explicitly
      // sets its own `approvalGates` (even `{}`, which means "no gates").
      const cfg: PipelineRunConfig = {
        ...(options.defaultApprovalGates ? { approvalGates: options.defaultApprovalGates } : {}),
        ...(input.config ?? {}),
      }
      db.run(sql`INSERT INTO pipeline_runs (
        id, ticket_source, ticket_id, status, current_stage, started_at, finished_at, started_by, config
      ) VALUES (
        ${runId}, ${input.ticketSource}, ${input.ticketId}, ${'running'}, ${STAGE_NAMES[0]},
        ${tNow}, ${null}, ${input.startedBy ?? null}, ${JSON.stringify(cfg)}
      )`)

      for (const name of STAGE_NAMES) {
        const sid = newId()
        db.run(sql`INSERT INTO pipeline_stage_runs (
          id, pipeline_run_id, stage_name, status, started_at, finished_at, artifact_id, error
        ) VALUES (
          ${sid}, ${runId}, ${name}, ${'pending'}, ${null}, ${null}, ${null}, ${null}
        )`)
      }

      return executeFrom(runId)
    },

    getState(runId) {
      return stateOf(runId)
    },

    listRuns(limit = 50) {
      const rows = (db as any).all(
        sql`SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ${limit}`,
      ) as any[]
      return rows.map(rowToRun)
    },

    async approve(runId, stageName) {
      const stage = getStage(runId, stageName)
      if (stage.status !== 'awaiting_approval') {
        throw new InvalidPipelineStateError(
          `Stage "${stageName}" is not awaiting approval (current: ${stage.status})`,
        )
      }
      updateStage(stage.id, { status: 'succeeded' })
      const run = getRunRow(runId)
      if (run.status === 'waiting_approval') updateRun(runId, { status: 'running' })
      return executeFrom(runId)
    },

    cancel(runId) {
      const run = getRunRow(runId)
      if (run.status === 'completed' || run.status === 'cancelled') {
        return stateOf(runId)
      }
      updateRun(runId, { status: 'cancelled', finishedAt: now() })
      return stateOf(runId)
    },

    async resume(runId) {
      const run = getRunRow(runId)
      if (run.status !== 'failed' && run.status !== 'cancelled') {
        throw new InvalidPipelineStateError(
          `Cannot resume run ${runId}: status is ${run.status}`,
        )
      }
      // Reset failed stage so it re-runs; leave succeeded ones.
      for (const stage of getStageRows(runId)) {
        if (stage.status === 'failed') {
          updateStage(stage.id, { status: 'pending', error: null, startedAt: null, finishedAt: null })
        }
      }
      updateRun(runId, { status: 'running', finishedAt: null })
      return executeFrom(runId)
    },
  }
}
