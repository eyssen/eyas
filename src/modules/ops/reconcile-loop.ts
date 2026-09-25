// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { applyPatch } from 'diff'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type { SignedRecord } from '@modules/observability/signed-metrics'
import {
  buildRunbookDiagnosis,
  matchRunbook,
} from './diagnosers/runbook-matcher.js'
import type { LlmClient } from './diagnosers/llm-diagnoser.js'
import { createLlmDiagnoser } from './diagnosers/llm-diagnoser.js'
import { buildKubectlProposal } from './actions/kubectl-generator.js'
import { buildGitopsProposal } from './actions/gitops-committer.js'
import type { ApprovalQueue } from './actions/approval-bridge.js'
import { createApprovalBridge } from './actions/approval-bridge.js'
import type { KubectlExecutor } from './actions/kubectl-executor.js'
import type { PrProvider } from './actions/pr-provider.js'
import type {
  ActionType,
  ApplyResult,
  Diagnosis,
  Incident,
  IncidentStatus,
  NewIncident,
  Proposal,
  ProposalPayload,
  ReconcileResult,
  Runbook,
  SignedVerifier,
} from './types.js'

export interface ReconcileLoopDeps {
  db: EyasDb
  runbooks: Runbook[]
  /**
   * Verifier from the signed-metrics module. When provided, every incident
   * bearing a `signedRecord` is verified before diagnosis. `valid: false`
   * causes the incident to be suppressed.
   */
  signedVerify?: SignedVerifier
  /** LLM fallback for incidents that don't match any runbook. Optional. */
  llm?: LlmClient
  /** Approval queue implementation. */
  approvalQueue: ApprovalQueue
  /**
   * Strict mode: when true (default), incidents without a signedRecord are
   * ALSO suppressed. Dev/test can pass false to allow unsigned incidents.
   */
  strictSigned?: boolean
  /** Executes read-only kubectl proposals. Absent → kubectl apply is honestly refused. */
  kubectlExecutor?: KubectlExecutor
  /** Opens real PRs for gitops-pr proposals. Absent → gitops-pr apply is honestly refused. */
  prProvider?: PrProvider
}

export interface ReconcileLoop {
  /** Record a new incident. Returns the stored, id-assigned form. */
  record(incident: NewIncident): Promise<Incident>
  /** Run the full pipeline for an already-stored incident. */
  reconcile(incidentId: string): Promise<ReconcileResult>
  /** List incidents matching simple filters. */
  list(filter?: { status?: IncidentStatus; severity?: string; limit?: number }): Promise<Incident[]>
  /** Get an incident by id, or null. */
  get(id: string): Promise<Incident | null>
  /** Get a proposal by id, or null. */
  getProposal(id: string): Promise<Proposal | null>
  /**
   * Get the incident's current actionable proposal: the latest non-applied
   * (still 'proposed' or 'approved') ops_actions row for this incident, or
   * null if none exists yet or the most recent one was already applied.
   * Lets callers (e.g. the incident-detail route) show the current proposal
   * without triggering another reconcile().
   */
  getProposalForIncident(incidentId: string): Promise<Proposal | null>
  /** Mark a proposal approved. Throws if already applied. */
  approve(proposalId: string, approver: string): Promise<Proposal>
  /** Apply an approved proposal. Throws if not approved yet. */
  apply(proposalId: string): Promise<ApplyResult>
}

export function createReconcileLoop(deps: ReconcileLoopDeps): ReconcileLoop {
  const { db, runbooks, signedVerify, llm, approvalQueue, kubectlExecutor, prProvider } = deps
  const dbAny = db as any
  const strictSigned = deps.strictSigned ?? true
  const approvalBridge = createApprovalBridge(approvalQueue)
  const llmDiagnose = llm ? createLlmDiagnoser(llm) : null

  // ─── Persistence helpers ────────────────────────────

  async function insertIncident(i: Incident): Promise<void> {
    dbAny.run(sql`INSERT INTO ops_incidents (
      id, source, severity, kind, namespace, resource, summary, details,
      signed_record, verified, status, created_at, updated_at
    ) VALUES (
      ${i.id}, ${i.source}, ${i.severity}, ${i.kind}, ${i.namespace}, ${i.resource},
      ${i.summary}, ${JSON.stringify(i.details)}, ${i.signedRecord ?? null},
      ${i.verified === null ? null : i.verified ? 1 : 0}, ${i.status},
      ${i.createdAt}, ${i.updatedAt}
    )`)
  }

  async function updateIncidentStatus(
    id: string,
    status: IncidentStatus,
    verified?: boolean | null,
  ): Promise<void> {
    const now = Date.now()
    if (verified === undefined) {
      dbAny.run(sql`UPDATE ops_incidents SET status = ${status}, updated_at = ${now} WHERE id = ${id}`)
    } else {
      const v = verified === null ? null : verified ? 1 : 0
      dbAny.run(
        sql`UPDATE ops_incidents SET status = ${status}, verified = ${v}, updated_at = ${now} WHERE id = ${id}`,
      )
    }
  }

  async function loadIncident(id: string): Promise<Incident | null> {
    const rows = dbAny.all(sql`SELECT * FROM ops_incidents WHERE id = ${id} LIMIT 1`) as any[]
    if (!rows || rows.length === 0) return null
    return rowToIncident(rows[0])
  }

  async function insertProposal(p: Proposal): Promise<void> {
    dbAny.run(sql`INSERT INTO ops_actions (
      id, incident_id, action_type, payload, requires_approval,
      approval_queue_id, approved_by, approved_at, applied_at, result, created_at, updated_at
    ) VALUES (
      ${p.id}, ${p.incidentId}, ${p.actionType}, ${JSON.stringify(p.payload)},
      ${p.requiresApproval ? 1 : 0}, ${p.approvalQueueId ?? null}, ${p.approvedBy ?? null}, ${p.approvedAt ?? null},
      ${p.appliedAt ?? null}, ${p.result ? JSON.stringify(p.result) : null},
      ${p.createdAt}, ${p.updatedAt}
    )`)
  }

  async function loadProposal(id: string): Promise<Proposal | null> {
    const rows = dbAny.all(sql`SELECT * FROM ops_actions WHERE id = ${id} LIMIT 1`) as any[]
    if (!rows || rows.length === 0) return null
    return rowToProposal(rows[0])
  }

  /**
   * The incident's current *actionable* proposal: the most recent
   * ops_actions row for this incident that has NOT been applied yet
   * (applied_at IS NULL — covers both 'proposed' and already-'approved'
   * states, since approval alone doesn't set applied_at). Returns null when
   * no proposal exists yet, or the most recent one was already applied.
   *
   * This is the single source of truth for reconcile()'s idempotency check
   * (see propose step below) AND for getProposalForIncident() — a pending
   * proposal is exactly what reconcile() must reuse instead of duplicating,
   * and exactly what the incident-detail route should surface to the
   * frontend without requiring another reconcile() call.
   */
  async function loadPendingProposalForIncident(incidentId: string): Promise<Proposal | null> {
    const rows = dbAny.all(sql`SELECT * FROM ops_actions
      WHERE incident_id = ${incidentId} AND applied_at IS NULL
      ORDER BY created_at DESC LIMIT 1`) as any[]
    if (!rows || rows.length === 0) return null
    return rowToProposal(rows[0])
  }

  async function updateProposal(p: Proposal): Promise<void> {
    dbAny.run(sql`UPDATE ops_actions SET
      approval_queue_id = ${p.approvalQueueId ?? null},
      approved_by = ${p.approvedBy ?? null},
      approved_at = ${p.approvedAt ?? null},
      applied_at = ${p.appliedAt ?? null},
      result = ${p.result ? JSON.stringify(p.result) : null},
      updated_at = ${p.updatedAt}
    WHERE id = ${p.id}`)
  }

  // ─── Pipeline steps ─────────────────────────────────

  function verifyIncident(i: Incident): { ok: boolean; reason?: string } {
    if (!i.signedRecord) {
      if (strictSigned) {
        return { ok: false, reason: 'no signed record (strict mode)' }
      }
      return { ok: true }
    }
    if (!signedVerify) {
      // Verifier not wired — in strict mode, reject.
      if (strictSigned) return { ok: false, reason: 'no verifier configured' }
      return { ok: true }
    }
    let parsed: SignedRecord<unknown>
    try {
      const decoded = Buffer.from(i.signedRecord, 'base64').toString('utf-8')
      parsed = JSON.parse(decoded) as SignedRecord<unknown>
    } catch (err) {
      return { ok: false, reason: `malformed signed record: ${String((err as Error).message)}` }
    }
    const result = signedVerify(parsed)
    if (result.valid) return { ok: true }
    return { ok: false, reason: result.reason }
  }

  async function diagnose(i: Incident): Promise<Diagnosis> {
    const rb = matchRunbook(i, runbooks)
    if (rb) return buildRunbookDiagnosis(rb, i)
    if (llmDiagnose) return llmDiagnose(i)
    return {
      incidentId: i.id,
      source: 'none',
      rootCause: 'no matching runbook and no LLM configured',
      confidence: 0,
      explanation: 'Operator review required — no diagnosis path available.',
    }
  }

  async function propose(i: Incident, d: Diagnosis): Promise<Proposal | null> {
    if (d.source !== 'runbook' || !d.runbookId) return null
    const rb = runbooks.find((r) => r.id === d.runbookId)
    if (!rb) return null

    let payload: ProposalPayload
    let actionType: ActionType = rb.suggestedAction.actionType
    try {
      if (actionType === 'kubectl') {
        payload = buildKubectlProposal(i, rb, d)
      } else if (actionType === 'gitops-pr') {
        payload = buildGitopsProposal(i, rb, d)
      } else if (actionType === 'manual') {
        payload = { summary: `Manual action required: ${rb.id}` }
      } else {
        // helm-upgrade stub — not fully fleshed out yet.
        payload = {
          release: rb.suggestedAction.args?.[0] ?? 'unknown',
          chart: rb.suggestedAction.args?.[1] ?? 'unknown',
          values: {},
          summary: `helm upgrade (stub) for ${rb.id}`,
        }
      }
    } catch (err) {
      return null
    }

    // FIX 1 (I-2, safety floor): mutations (gitops-pr, helm-upgrade) must
    // ALWAYS require approval, regardless of what the runbook YAML says —
    // a runbook author cannot opt a cluster mutation out of human review.
    // Read-only kubectl proposals keep the runbook's authored value.
    const requiresApproval =
      actionType === 'gitops-pr' || actionType === 'helm-upgrade' ? true : rb.requiresApproval

    const now = Date.now()
    const proposal: Proposal = {
      id: generateId(),
      incidentId: i.id,
      actionType,
      payload,
      requiresApproval,
      createdAt: now,
      updatedAt: now,
    }
    // Enqueue BEFORE persisting so the returned queueId can be stored on the
    // proposal row itself (FIX 2 / I-1) — this is what lets apply() later
    // consult the real approval queue's decision, not just approvedAt.
    const { queueId } = await approvalBridge.request(proposal)
    proposal.approvalQueueId = queueId
    await insertProposal(proposal)
    return proposal
  }

  // ─── Public surface ─────────────────────────────────

  return {
    async record(raw: NewIncident): Promise<Incident> {
      const now = Date.now()
      const incident: Incident = {
        id: generateId(),
        status: 'open',
        verified: raw.verified ?? null,
        createdAt: now,
        updatedAt: now,
        source: raw.source,
        severity: raw.severity,
        kind: raw.kind,
        namespace: raw.namespace,
        resource: raw.resource,
        summary: raw.summary,
        details: raw.details,
        signedRecord: raw.signedRecord,
      }
      await insertIncident(incident)
      return incident
    },

    async reconcile(incidentId: string): Promise<ReconcileResult> {
      const incident = await loadIncident(incidentId)
      if (!incident) throw new Error(`incident ${incidentId} not found`)

      // 1. Signed-metrics gate
      const v = verifyIncident(incident)
      if (!v.ok) {
        await updateIncidentStatus(incident.id, 'suppressed', false)
        return {
          incidentId: incident.id,
          status: 'suppressed',
          suppressedReason: v.reason,
        }
      }
      await updateIncidentStatus(incident.id, 'diagnosing', true)

      // 2. Diagnose
      const diagnosis = await diagnose(incident)

      // 3. Propose — idempotent: reuse a pending (non-applied) proposal for
      // this incident instead of minting a duplicate ops_actions row. Only
      // propose (insert) a fresh one when none is pending. Once a proposal
      // has been applied it no longer blocks — the next reconcile() is free
      // to mint a new one (e.g. the incident recurs after a prior fix).
      let proposal = await loadPendingProposalForIncident(incident.id)
      if (!proposal) {
        proposal = await propose(incident, diagnosis)
      }
      const nextStatus: IncidentStatus = proposal ? 'proposed' : 'open'
      await updateIncidentStatus(incident.id, nextStatus)

      return {
        incidentId: incident.id,
        status: nextStatus,
        diagnosis,
        proposal: proposal ?? undefined,
      }
    },

    async list(filter = {}) {
      const limit = Math.max(1, Math.min(filter.limit ?? 50, 500))
      let rows: any[]
      if (filter.status && filter.severity) {
        rows = dbAny.all(sql`SELECT * FROM ops_incidents
          WHERE status = ${filter.status} AND severity = ${filter.severity}
          ORDER BY created_at DESC LIMIT ${limit}`) as any[]
      } else if (filter.status) {
        rows = dbAny.all(sql`SELECT * FROM ops_incidents
          WHERE status = ${filter.status}
          ORDER BY created_at DESC LIMIT ${limit}`) as any[]
      } else if (filter.severity) {
        rows = dbAny.all(sql`SELECT * FROM ops_incidents
          WHERE severity = ${filter.severity}
          ORDER BY created_at DESC LIMIT ${limit}`) as any[]
      } else {
        rows = dbAny.all(sql`SELECT * FROM ops_incidents
          ORDER BY created_at DESC LIMIT ${limit}`) as any[]
      }
      return (rows ?? []).map(rowToIncident)
    },

    get(id) {
      return loadIncident(id)
    },

    getProposal(id) {
      return loadProposal(id)
    },

    getProposalForIncident(incidentId) {
      return loadPendingProposalForIncident(incidentId)
    },

    async approve(proposalId, approver) {
      const p = await loadProposal(proposalId)
      if (!p) throw new Error(`proposal ${proposalId} not found`)
      if (p.appliedAt) throw new Error(`proposal ${proposalId} is already applied`)
      const now = Date.now()
      p.approvedBy = approver
      p.approvedAt = now
      p.updatedAt = now
      await updateProposal(p)
      await updateIncidentStatus(p.incidentId, 'approved')
      return p
    },

    async apply(proposalId) {
      const p = await loadProposal(proposalId)
      if (!p) throw new Error(`proposal ${proposalId} not found`)
      if (p.requiresApproval) {
        // FIX 2 (I-1): honor EITHER approval path — the ops approve() route
        // (approvedAt) OR a real decision made in the approval queue this
        // proposal was enqueued into (e.g. the security-gate autonomy HIL
        // queue), resolved via approvalBridge.resolve(approvalQueueId).
        // Fully fail-safe: unknown/pending/rejected/expired/missing queueId
        // all resolve to "not approved" — apply() stays blocked. Neither
        // path can be short-circuited into an auto-approve.
        const approvedViaQueue = p.approvalQueueId
          ? (await approvalBridge.resolve(p.approvalQueueId)) === 'approved'
          : false
        if (!p.approvedAt && !approvedViaQueue) {
          throw new Error(`proposal ${proposalId} requires approval before apply`)
        }
      }
      if (p.appliedAt) throw new Error(`proposal ${proposalId} already applied`)

      const started = Date.now()
      let result: ApplyResult
      try {
        if (p.actionType === 'kubectl') {
          if (!kubectlExecutor) {
            result = {
              proposalId: p.id,
              ok: false,
              durationMs: 0,
              error: 'kubectl executor not configured',
            }
          } else {
            const raw = (p.payload.command ?? '').trim()
            if (!raw) {
              result = {
                proposalId: p.id,
                ok: false,
                durationMs: 0,
                error: 'proposal payload missing kubectl command',
              }
            } else {
              // buildKubectlProposal renders payload.command as "kubectl <verb>"
              // (see kubectl-generator.ts), but the executor's allow-list checks
              // the bare verb — strip a leading 'kubectl' token before exec'ing.
              const tokens = raw.split(/\s+/)
              const verb = tokens[0] === 'kubectl' ? (tokens[1] ?? '') : tokens[0]
              const r = await kubectlExecutor.exec(verb, p.payload.args ?? [])
              result = {
                proposalId: p.id,
                ok: r.ok,
                durationMs: r.durationMs,
                output: r.output,
                error: r.error,
              }
            }
          }
        } else if (p.actionType === 'gitops-pr') {
          if (!prProvider) {
            result = {
              proposalId: p.id,
              ok: false,
              durationMs: 0,
              error: 'PR provider not configured',
            }
          } else if (!p.payload.filePath || !p.payload.patch) {
            result = {
              proposalId: p.id,
              ok: false,
              durationMs: 0,
              error: 'proposal payload missing filePath or patch',
            }
          } else {
            const filePath = p.payload.filePath
            const current = (await prProvider.getFileContent(filePath)) ?? ''
            const patched = applyPatch(current, p.payload.patch)
            if (patched === false) {
              result = {
                proposalId: p.id,
                ok: false,
                durationMs: Date.now() - started,
                error: 'could not apply patch to current file content',
              }
            } else {
              const pr = await prProvider.openPullRequest({
                filePath,
                content: patched,
                title: p.payload.commitMessage ?? p.payload.summary ?? `ops: ${p.id}`,
                body: p.payload.summary ?? '',
                branch: `ops/${p.id}`,
              })
              result = {
                proposalId: p.id,
                ok: true,
                durationMs: Date.now() - started,
                prUrl: pr.prUrl,
              }
            }
          }
        } else if (p.actionType === 'manual') {
          result = {
            proposalId: p.id,
            ok: true,
            durationMs: 0,
            output: 'manual action acknowledged',
          }
        } else {
          result = {
            proposalId: p.id,
            ok: false,
            durationMs: 0,
            error: `action type '${p.actionType}' is not apply-able yet`,
          }
        }
      } catch (err) {
        result = {
          proposalId: p.id,
          ok: false,
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        }
      }

      const now = Date.now()
      // FIX 3 (M-4): only mark appliedAt on success. A transient failure
      // (ok:false) leaves appliedAt unset so the proposal remains eligible
      // for retry instead of being permanently stuck behind "already
      // applied" — the failed result is still persisted for audit purposes.
      if (result.ok) {
        p.appliedAt = now
      }
      p.updatedAt = now
      p.result = result as unknown as Record<string, unknown>
      await updateProposal(p)
      await updateIncidentStatus(p.incidentId, result.ok ? 'applied' : 'proposed')
      return result
    },
  }
}

// ─── Row helpers ──────────────────────────────────────

function rowToIncident(r: any): Incident {
  return {
    id: r.id,
    source: r.source,
    severity: r.severity,
    kind: r.kind,
    namespace: r.namespace,
    resource: r.resource,
    summary: r.summary,
    details: typeof r.details === 'string' ? JSON.parse(r.details) : (r.details ?? {}),
    signedRecord: r.signed_record ?? undefined,
    verified: r.verified === null || r.verified === undefined ? null : r.verified === 1 || r.verified === true,
    status: r.status,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

function rowToProposal(r: any): Proposal {
  return {
    id: r.id,
    incidentId: r.incident_id,
    actionType: r.action_type,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : (r.payload ?? {}),
    requiresApproval: r.requires_approval === 1 || r.requires_approval === true,
    approvalQueueId: r.approval_queue_id ?? undefined,
    approvedBy: r.approved_by ?? undefined,
    approvedAt: r.approved_at ? Number(r.approved_at) : undefined,
    appliedAt: r.applied_at ? Number(r.applied_at) : undefined,
    result: r.result ? (typeof r.result === 'string' ? JSON.parse(r.result) : r.result) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}
