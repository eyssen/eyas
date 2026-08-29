// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { CheapModelPassContext } from '@modules/model/cheap-pass.js'
import { MAX_UPLOAD_BYTES } from './constants.js'
import { scanDirectory } from './scanners/scan-path.js'
import {
  applyInstructionHints,
  inferProfileFromInstructions,
  normalizeInstructions,
} from './scanners/instructions.js'
import { classifyCandidates } from './pipeline/classify.js'
import { transformMemory, transformSkill } from './pipeline/transform.js'
import {
  applyMemoryItem,
  applySkillItem,
  applyWorkspaceProposal,
  type ApplyDeps,
} from './pipeline/apply.js'
import type {
  ImportJob,
  ImportJobSelection,
  ImportJobStats,
  ScanCandidate,
  ScanResult,
  SourceProfile,
  WorkspaceProposal,
} from './types.js'

function emptyStats(): ImportJobStats {
  return { processed: 0, applied: 0, skipped: 0, proposals: 0, errors: 0, byKind: {} }
}

function rowToJob(row: any): ImportJob {
  return {
    id: row.id,
    status: row.status,
    sourceProfile: row.source_profile,
    scanId: row.scan_id,
    instructions: row.instructions ?? null,
    phase: row.phase,
    progress: row.progress,
    stats: JSON.parse(row.stats_json || '{}'),
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? null,
  }
}

function rowToProposal(row: any): WorkspaceProposal {
  return {
    id: row.id,
    jobId: row.job_id,
    agentId: row.agent_id,
    workspaceFile: row.workspace_file,
    title: row.title,
    proposedBody: row.proposed_body,
    existingBody: row.existing_body ?? null,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  }
}

export interface DataPortServiceDeps {
  db: EyasDb
  modelCtx: CheapModelPassContext
  applyDepsFactory: () => ApplyDeps
  dataDir?: string
  logger?: { info: Function; warn: Function; error: Function; debug: Function }
}

export function createDataPortService(deps: DataPortServiceDeps) {
  const dataDir = deps.dataDir ?? 'data'
  const tmpRoot = join(dataDir, 'tmp', 'data-port')
  mkdirSync(tmpRoot, { recursive: true })

  // In-memory content cache for scans (content not always persisted fully)
  const scanCache = new Map<string, ScanCandidate[]>()

  function persistScan(result: ScanResult): ScanResult {
    // Store candidates without huge content in DB preview; keep content in memory cache
    const publicCandidates = result.candidates.map(({ content: _c, ...rest }) => rest)
    const now = new Date().toISOString()
    deps.db.run(sql`INSERT INTO data_port_scans
      (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json, instructions, created_at)
      VALUES (
        ${result.scanId},
        ${result.sourceProfile},
        ${result.detectedProfile},
        ${result.rootPath},
        ${JSON.stringify(result.candidates.map((c) => ({ ...c, content: c.content })))},
        ${JSON.stringify(result.stats)},
        ${JSON.stringify(result.warnings)},
        ${result.instructions},
        ${now}
      )`)
    scanCache.set(result.scanId, result.candidates)
    return {
      ...result,
      candidates: publicCandidates.map((c) => ({
        ...c,
        // include short preview only for UI
      })),
    }
  }

  function finalizeScan(
    result: ScanResult,
    sourceProfile: SourceProfile,
    instructions: string | null,
  ): ScanResult {
    const profile = inferProfileFromInstructions(sourceProfile, instructions)
    let detected = result.detectedProfile
    if (sourceProfile === 'auto' && profile !== 'auto') {
      detected = profile
    }
    const candidates = applyInstructionHints(result.candidates, instructions)
    // Prefer instruction-matched items first in the list
    candidates.sort((a, b) => {
      const sa = a.selectedByDefault ? 1 : 0
      const sb = b.selectedByDefault ? 1 : 0
      if (sb !== sa) return sb - sa
      return b.confidence - a.confidence
    })
    const warnings = [...result.warnings]
    if (instructions) {
      warnings.unshift('User instructions applied to ranking and default selection')
    }
    return persistScan({
      ...result,
      sourceProfile,
      detectedProfile: detected,
      instructions,
      candidates,
      warnings,
    })
  }

  function loadScanCandidates(scanId: string): ScanCandidate[] | null {
    if (scanCache.has(scanId)) return scanCache.get(scanId)!
    const rows = deps.db.all(sql`SELECT candidates_json FROM data_port_scans WHERE id = ${scanId}`) as any[]
    if (!rows.length) return null
    try {
      const candidates = JSON.parse(rows[0].candidates_json) as ScanCandidate[]
      scanCache.set(scanId, candidates)
      return candidates
    } catch {
      return null
    }
  }

  function updateJob(
    id: string,
    patch: Partial<{
      status: string
      phase: string
      progress: number
      stats: ImportJobStats
      error: string | null
      finishedAt: string | null
    }>,
  ) {
    const now = new Date().toISOString()
    const current = getJob(id)
    if (!current) return
    const status = patch.status ?? current.status
    const phase = patch.phase ?? current.phase
    const progress = patch.progress ?? current.progress
    const stats = patch.stats ?? current.stats
    const error = patch.error !== undefined ? patch.error : current.error
    const finishedAt = patch.finishedAt !== undefined ? patch.finishedAt : current.finishedAt
    deps.db.run(sql`UPDATE data_port_jobs SET
      status = ${status},
      phase = ${phase},
      progress = ${progress},
      stats_json = ${JSON.stringify(stats)},
      error = ${error},
      updated_at = ${now},
      finished_at = ${finishedAt}
      WHERE id = ${id}`)
  }

  function getJob(id: string): ImportJob | null {
    const rows = deps.db.all(sql`SELECT * FROM data_port_jobs WHERE id = ${id}`) as any[]
    return rows.length ? rowToJob(rows[0]) : null
  }

  async function runJob(jobId: string): Promise<void> {
    const job = getJob(idOrThrow(jobId))
    if (!job) return
    const rows = deps.db.all(sql`SELECT selection_json FROM data_port_jobs WHERE id = ${jobId}`) as any[]
    const selection = JSON.parse(rows[0]?.selection_json || '[]') as ImportJobSelection[]
    const candidates = loadScanCandidates(job.scanId)
    if (!candidates) {
      updateJob(jobId, {
        status: 'failed',
        phase: 'error',
        error: 'Scan data expired or missing — re-scan and try again',
        finishedAt: new Date().toISOString(),
      })
      return
    }

    // O(1) lookup — selection can be 1000+ items
    const byId = new Map(candidates.map((c) => [c.id, c]))
    const selected = selection
      .map((s) => {
        const c = byId.get(s.candidateId)
        if (!c) return null
        return { candidate: c, target: s.target ?? c.target }
      })
      .filter(Boolean) as Array<{ candidate: ScanCandidate; target: ScanCandidate['target'] }>

    const stats = emptyStats()
    updateJob(jobId, { status: 'running', phase: 'classify', progress: 0.05, stats })

    /**
     * Bulk imports must NOT call the model once per item — that hangs the job
     * for hours (and pins progress at 5% during classify). Threshold: small
     * selections get AI classify + transform; large ones use scan heuristics
     * and deterministic normalizers only.
     */
    const AI_ITEM_LIMIT = 48
    const useAi = selected.length > 0 && selected.length <= AI_ITEM_LIMIT
    const modelCtx = useAi ? deps.modelCtx : { logger: deps.modelCtx.logger }

    try {
      const toClassify = selected.map((s) => s.candidate)
      let classified: Map<string, import('./types.js').ClassifyItem>

      if (useAi) {
        classified = await classifyCandidates(
          modelCtx,
          job.sourceProfile,
          toClassify,
          job.instructions,
        )
      } else {
        // Heuristic map from scan — honour user's chosen target
        classified = new Map(
          toClassify.map((c) => [
            c.id,
            {
              id: c.id,
              action: c.kind === 'noise' || c.target === 'none' ? 'skip' : 'import',
              kind: c.kind,
              target: c.target,
              title: c.title,
              confidence: c.confidence,
              reason: c.reason,
              pii_risk: 'none' as const,
            },
          ]),
        )
        deps.logger?.info?.(
          { jobId, selected: selected.length, AI_ITEM_LIMIT },
          'data-port: bulk import — skipping AI classify/transform (heuristic only)',
        )
      }

      updateJob(jobId, {
        phase: useAi ? 'transform' : 'apply',
        progress: 0.12,
        stats,
      })

      const applyDeps = deps.applyDepsFactory()
      const total = selected.length || 1
      // Throttle DB progress writes
      let lastProgressWrite = 0

      for (let i = 0; i < selected.length; i++) {
        const { candidate, target: userTarget } = selected[i]!
        stats.processed++
        const cls = classified.get(candidate.id)
        // Honour user target override; if AI says skip due to PII, skip
        if (cls?.action === 'skip' || cls?.pii_risk === 'likely' || userTarget === 'none') {
          stats.skipped++
          stats.byKind[candidate.kind] = (stats.byKind[candidate.kind] ?? 0) + 1
        } else {
          const target = userTarget
          const kind = cls?.kind ?? candidate.kind

          try {
            if (
              target === 'workspace.agents' ||
              target === 'workspace.soul' ||
              target === 'workspace.identity' ||
              target === 'workspace.tools' ||
              target === 'workspace.memory'
            ) {
              const body = (candidate.content ?? candidate.preview)
                .replace(/^---[\s\S]*?---\s*/m, '')
                .trim()
              const result = await applyWorkspaceProposal(applyDeps, {
                jobId,
                target,
                title: cls?.title ?? candidate.title,
                body,
              })
              if (result.status === 'proposal') stats.proposals++
              else if (result.status === 'skipped') stats.skipped++
              else if (result.status === 'error') stats.errors++
              else stats.applied++
            } else if (target === 'skill' || kind === 'skill') {
              const transformed = await transformSkill(modelCtx, candidate)
              const result = await applySkillItem(applyDeps, {
                jobId,
                sourceProfile: job.sourceProfile,
                transformed,
              })
              if (result.status === 'applied') stats.applied++
              else if (result.status === 'skipped') stats.skipped++
              else stats.errors++
            } else if (
              target === 'episodic' ||
              target === 'vault.semantic' ||
              target === 'vault.procedural'
            ) {
              const transformed = await transformMemory(
                modelCtx,
                candidate,
                target,
                job.sourceProfile,
              )
              const result = await applyMemoryItem(applyDeps, {
                jobId,
                sourceProfile: job.sourceProfile,
                target,
                transformed,
              })
              if (result.status === 'applied') stats.applied++
              else if (result.status === 'skipped') stats.skipped++
              else stats.errors++
            } else {
              stats.skipped++
            }
          } catch (err) {
            stats.errors++
            deps.logger?.warn?.(
              { err: String(err), path: candidate.relativePath },
              'data-port item failed',
            )
          }

          stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1
        }

        const progress = 0.12 + (0.85 * (i + 1)) / total
        // Update every item for small jobs; every 10 for bulk
        if (total <= 50 || i === total - 1 || i - lastProgressWrite >= 9) {
          lastProgressWrite = i
          updateJob(jobId, {
            phase: 'apply',
            progress,
            stats: { ...stats },
          })
        }
      }

      updateJob(jobId, {
        status: 'completed',
        phase: 'done',
        progress: 1,
        stats,
        finishedAt: new Date().toISOString(),
        error: null,
      })
    } catch (err) {
      updateJob(jobId, {
        status: 'failed',
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
        stats,
        finishedAt: new Date().toISOString(),
      })
    }
  }

  function idOrThrow(id: string): string {
    return id
  }

  return {
    scanPath(
      sourceProfile: SourceProfile,
      path: string,
      instructions?: string | null,
    ): ScanResult {
      const instr = normalizeInstructions(instructions)
      const resolved = resolve(path)
      const result = scanDirectory({ rootPath: resolved, sourceProfile })
      return finalizeScan(result, sourceProfile, instr)
    },

    async scanUpload(
      sourceProfile: SourceProfile,
      file: { name: string; buffer: Buffer },
      instructions?: string | null,
    ): Promise<ScanResult> {
      const instr = normalizeInstructions(instructions)
      if (file.buffer.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error(`Upload exceeds ${MAX_UPLOAD_BYTES} bytes limit`)
      }
      const scanDir = join(tmpRoot, generateId())
      mkdirSync(scanDir, { recursive: true })
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.zip')) {
        const zipPath = join(scanDir, 'upload.zip')
        writeFileSync(zipPath, file.buffer)
        const extractDir = join(scanDir, 'extracted')
        mkdirSync(extractDir, { recursive: true })
        const proc = Bun.spawn(['unzip', '-q', '-o', zipPath, '-d', extractDir], {
          stdout: 'ignore',
          stderr: 'pipe',
        })
        const code = await proc.exited
        if (code !== 0) {
          const errText = await new Response(proc.stderr).text()
          rmSync(scanDir, { recursive: true, force: true })
          throw new Error(`Failed to unzip upload: ${errText || code}`)
        }
        const result = scanDirectory({ rootPath: extractDir, sourceProfile })
        return finalizeScan(result, sourceProfile, instr)
      }

      // Single text file
      if (
        lower.endsWith('.md') ||
        lower.endsWith('.txt') ||
        lower.endsWith('.markdown') ||
        lower.endsWith('.json') ||
        lower.endsWith('.jsonl')
      ) {
        const singleDir = join(scanDir, 'single')
        mkdirSync(singleDir, { recursive: true })
        writeFileSync(join(singleDir, file.name.replace(/[/\\]/g, '_')), file.buffer)
        const result = scanDirectory({ rootPath: singleDir, sourceProfile })
        return finalizeScan(result, sourceProfile, instr)
      }

      rmSync(scanDir, { recursive: true, force: true })
      throw new Error('Unsupported upload type — use .zip or a text/markdown file')
    },

    createJob(input: {
      scanId: string
      sourceProfile: SourceProfile
      selection: ImportJobSelection[]
      instructions?: string | null
    }): ImportJob {
      const candidates = loadScanCandidates(input.scanId)
      if (!candidates) throw new Error('Scan not found or expired')
      if (!input.selection.length) throw new Error('No items selected')

      // Prefer job-level instructions; fall back to scan-stored instructions
      let instructions = normalizeInstructions(input.instructions)
      if (!instructions) {
        const scanRows = deps.db.all(
          sql`SELECT instructions FROM data_port_scans WHERE id = ${input.scanId}`,
        ) as Array<{ instructions: string | null }>
        instructions = normalizeInstructions(scanRows[0]?.instructions)
      }

      const id = generateId()
      const now = new Date().toISOString()
      const stats = emptyStats()
      deps.db.run(sql`INSERT INTO data_port_jobs
        (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, error, instructions, created_at, updated_at, finished_at)
        VALUES (
          ${id}, 'pending', ${input.sourceProfile}, ${input.scanId},
          ${JSON.stringify(input.selection)}, 'queued', 0,
          ${JSON.stringify(stats)}, NULL, ${instructions}, ${now}, ${now}, NULL
        )`)

      // Fire-and-forget background processing
      void runJob(id)

      return getJob(id)!
    },

    getJob,
    listJobs(limit = 20): ImportJob[] {
      const rows = deps.db.all(
        sql`SELECT * FROM data_port_jobs ORDER BY created_at DESC LIMIT ${limit}`,
      ) as any[]
      return rows.map(rowToJob)
    },

    listProposals(filter?: { status?: string; jobId?: string }): WorkspaceProposal[] {
      let rows: any[]
      if (filter?.jobId && filter?.status) {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals WHERE job_id = ${filter.jobId} AND status = ${filter.status} ORDER BY created_at DESC`,
        ) as any[]
      } else if (filter?.jobId) {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals WHERE job_id = ${filter.jobId} ORDER BY created_at DESC`,
        ) as any[]
      } else if (filter?.status) {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals WHERE status = ${filter.status} ORDER BY created_at DESC`,
        ) as any[]
      } else {
        rows = deps.db.all(
          sql`SELECT * FROM data_port_proposals ORDER BY created_at DESC LIMIT 100`,
        ) as any[]
      }
      return rows.map(rowToProposal)
    },

    getProposal(id: string): WorkspaceProposal | null {
      const rows = deps.db.all(sql`SELECT * FROM data_port_proposals WHERE id = ${id}`) as any[]
      return rows.length ? rowToProposal(rows[0]) : null
    },

    createProposal(input: {
      jobId: string
      agentId: string
      workspaceFile: string
      title: string
      proposedBody: string
      existingBody: string | null
    }): string {
      const id = generateId()
      const now = new Date().toISOString()
      deps.db.run(sql`INSERT INTO data_port_proposals
        (id, job_id, agent_id, workspace_file, title, proposed_body, existing_body, status, created_at, resolved_at)
        VALUES (
          ${id}, ${input.jobId}, ${input.agentId}, ${input.workspaceFile}, ${input.title},
          ${input.proposedBody}, ${input.existingBody}, 'pending', ${now}, NULL
        )`)
      return id
    },

    async approveProposal(
      id: string,
      writer: { write: (req: { agentId: string; file: string; body: string }) => Promise<void> },
    ): Promise<WorkspaceProposal> {
      const proposal = this.getProposal(id)
      if (!proposal) throw new Error('Proposal not found')
      if (proposal.status !== 'pending') throw new Error(`Proposal already ${proposal.status}`)

      // Append-merge strategy: if existing body, put proposed after a separator
      let body = proposal.proposedBody
      if (proposal.existingBody && proposal.existingBody.trim()) {
        body = `${proposal.existingBody.trim()}\n\n---\n\n## Imported: ${proposal.title}\n\n${proposal.proposedBody.trim()}\n`
      }

      await writer.write({
        agentId: proposal.agentId,
        file: proposal.workspaceFile,
        body,
      })

      const now = new Date().toISOString()
      deps.db.run(sql`UPDATE data_port_proposals SET status = 'approved', resolved_at = ${now} WHERE id = ${id}`)
      return this.getProposal(id)!
    },

    rejectProposal(id: string): WorkspaceProposal {
      const proposal = this.getProposal(id)
      if (!proposal) throw new Error('Proposal not found')
      if (proposal.status !== 'pending') throw new Error(`Proposal already ${proposal.status}`)
      const now = new Date().toISOString()
      deps.db.run(sql`UPDATE data_port_proposals SET status = 'rejected', resolved_at = ${now} WHERE id = ${id}`)
      return this.getProposal(id)!
    },

    /** Safe path check helper for callers. */
    pathExists(path: string): boolean {
      try {
        return existsSync(resolve(path))
      } catch {
        return false
      }
    },
  }
}

export type DataPortService = ReturnType<typeof createDataPortService>
