// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SignedRecord, VerificationResult } from '@modules/observability/signed-metrics'

// ─── Incident ──────────────────────────────────────────

export type IncidentSource = 'k8s-event' | 'prometheus' | 'log-anomaly'
export type IncidentSeverity = 'info' | 'warning' | 'critical'
export type IncidentStatus =
  | 'open'
  | 'diagnosing'
  | 'proposed'
  | 'approved'
  | 'applied'
  | 'closed'
  | 'suppressed'

/**
 * An observation that may warrant operator attention. Produced by observers,
 * funneled into the reconcile loop. `signedRecord` is the base64 SignedRecord
 * wrapper from the signed-metrics module, bound to the telemetry payload.
 */
export interface Incident {
  id: string
  source: IncidentSource
  severity: IncidentSeverity
  /** e.g. 'pod-crashloop', 'pvc-full', 'oom-memory-limit' */
  kind: string
  namespace: string
  resource: string
  summary: string
  /** Free-form JSON details: metrics sample, event body, log excerpt */
  details: Record<string, unknown>
  /** base64-encoded JSON SignedRecord<telemetry> from signed-metrics */
  signedRecord?: string
  /** 1 iff verified; 0 otherwise. Tri-state null means "not yet verified". */
  verified: boolean | null
  status: IncidentStatus
  createdAt: number
  updatedAt: number
}

export type NewIncident = Omit<Incident, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'verified'> & {
  verified?: boolean | null
}

// ─── Runbook ───────────────────────────────────────────

export interface RunbookMatcher {
  type: IncidentSource
  /** Arbitrary key/value equality filter (e.g. reason: 'BackOff'). */
  fields?: Record<string, string>
  /** Optional regex applied to incident.summary or a named details field. */
  regex?: string
  /** Which detail field the regex runs against; defaults to 'summary'. */
  regexTarget?: string
}

export interface RunbookSuggestedAction {
  actionType: ActionType
  /** kubectl sub-command ('logs', 'describe', 'rollout') */
  command?: string
  /** Template args with {{variable}} placeholders resolved from incident.details. */
  args?: string[]
  /** For gitops-pr: path to file in the infra repo and the patch body. */
  prPath?: string
  prPatch?: string
}

export interface Runbook {
  id: string
  kind: string
  matcher: RunbookMatcher
  /** Markdown template with {{variable}} placeholders resolved from incident.details. */
  diagnosisTemplate: string
  suggestedAction: RunbookSuggestedAction
  severity: IncidentSeverity
  requiresApproval: boolean
  lastUpdated: number
}

// ─── Diagnosis / Proposal / Action ─────────────────────

export type DiagnosisSource = 'runbook' | 'llm' | 'none'

export interface Diagnosis {
  incidentId: string
  source: DiagnosisSource
  rootCause: string
  /** Runbook id if source === 'runbook'. */
  runbookId?: string
  /** Confidence in [0,1]. Runbook matches default to 0.9, LLM to 0.5. */
  confidence: number
  /** Template-rendered diagnosis markdown. */
  explanation: string
}

export type ActionType = 'kubectl' | 'helm-upgrade' | 'gitops-pr' | 'manual'

export interface Proposal {
  id: string
  incidentId: string
  actionType: ActionType
  /** Serialisable payload: command + args, helm values, PR diff, etc. */
  payload: ProposalPayload
  approvedBy?: string
  approvedAt?: number
  appliedAt?: number
  /** Free-form result from apply(): stdout/stderr, PR URL, error message. */
  result?: Record<string, unknown>
  /** Copied from the runbook so apply() has a permission anchor. */
  requiresApproval: boolean
  /**
   * Opaque id returned by `ApprovalQueue.enqueue()` (approvalBridge.request())
   * at propose time. apply() consults this — via approvalBridge.resolve() —
   * as an alternate approval path alongside `approvedAt`, so a decision made
   * through the real HIL approval queue (e.g. the security-gate autonomy
   * queue) actually gates apply(), not just the ops approve() route.
   */
  approvalQueueId?: string
  createdAt: number
  updatedAt: number
}

export interface ProposalPayload {
  /** kubectl actions: rendered command + args */
  command?: string
  args?: string[]
  /** helm upgrade actions */
  release?: string
  chart?: string
  values?: Record<string, unknown>
  /** gitops-pr actions */
  repoPath?: string
  filePath?: string
  patch?: string
  commitMessage?: string
  /** Human-readable summary for the approval UI */
  summary?: string
}

export interface ReconcileResult {
  incidentId: string
  status: IncidentStatus
  diagnosis?: Diagnosis
  proposal?: Proposal
  applied?: ApplyResult
  /** If suppressed, why. */
  suppressedReason?: string
}

export interface ApplyResult {
  proposalId: string
  ok: boolean
  durationMs: number
  output?: string
  error?: string
  /** For gitops-pr: the created PR URL (stubbed). */
  prUrl?: string
}

// ─── Observer interface ────────────────────────────────

/**
 * An observer turns a source (k8s events, Prometheus alert webhooks, log
 * anomalies from the bus) into Incidents. Implementations MUST NOT perform
 * side effects beyond producing incidents — the reconcile loop handles the
 * rest.
 */
export interface Observer {
  readonly source: IncidentSource
  /**
   * Parse a single raw input into zero or one incidents. Return null when
   * the input is not actionable (noise, duplicate, already-acked).
   */
  parse(raw: unknown, signedRecord?: string): Incident | null
}

// ─── Signed-metrics guard ──────────────────────────────

/**
 * Minimal contract we need from signed-metrics. We take a verifier function
 * rather than the full service so tests can stub without pulling in crypto.
 */
export type SignedVerifier = (record: SignedRecord<unknown>) => VerificationResult
