// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createOpsTables, createReconcileLoop } from '@modules/ops'
import { createInMemoryApprovalQueue } from '@modules/ops/actions'
import type { KubectlExecutor } from '@modules/ops/actions/kubectl-executor'
import type { PrProvider } from '@modules/ops/actions/pr-provider'
import type { NewIncident, Runbook } from '@modules/ops/types'

// Fake apply-time collaborators. reconcile-loop no longer fake-succeeds on
// kubectl/gitops-pr apply — a real executor/provider must be supplied, or
// apply() honestly refuses. See reconcile-apply.test.ts for the honesty
// (executor/provider absent, executor error, unresolvable patch) cases.
function fakeKubectlExecutor(): KubectlExecutor {
  return {
    async exec(command, args) {
      return { ok: true, output: `ran: kubectl ${command} ${args.join(' ')}`, durationMs: 1 }
    },
  }
}

function fakePrProvider(): PrProvider {
  return {
    async getFileContent() {
      return 'current content\n'
    },
    async openPullRequest(input) {
      const slug = input.filePath.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()
      return { prUrl: `https://gitea.internal/pulls/${slug}`, number: 1 }
    },
    async openMultiFilePullRequest(input) {
      return { prUrl: `https://gitea.internal/pulls/${input.branch}`, number: 1, status: input.draft ? 'draft' : 'open' }
    },
  }
}

function crashloopRunbook(): Runbook {
  return {
    id: 'pod-crashloop',
    kind: 'pod-crashloop',
    matcher: {
      type: 'k8s-event',
      fields: { reason: 'BackOff' },
    },
    diagnosisTemplate: 'Pod {{namespace}}/{{pod}} is in CrashLoopBackOff.',
    suggestedAction: {
      actionType: 'kubectl',
      command: 'logs',
      args: ['-n', '{{namespace}}', '{{pod}}', '--previous'],
    },
    severity: 'warning',
    requiresApproval: true,
    lastUpdated: 0,
  }
}

function pvcRunbook(): Runbook {
  return {
    id: 'pvc-full',
    kind: 'pvc-full',
    matcher: {
      type: 'prometheus',
      fields: { alertname: 'KubePersistentVolumeFillingUp' },
    },
    diagnosisTemplate: 'PVC filling up in {{namespace}}',
    suggestedAction: {
      actionType: 'gitops-pr',
      prPath: 'clusters/{{namespace}}/pvc.yaml',
      prPatch: 'diff content',
    },
    severity: 'critical',
    requiresApproval: true,
    lastUpdated: 0,
  }
}

function makeIncidentData(overrides: Partial<NewIncident> = {}): NewIncident {
  return {
    source: 'k8s-event',
    severity: 'warning',
    kind: 'pod-crashloop',
    namespace: 'prod',
    resource: 'Pod/foo',
    summary: 'Back-off restarting failed container',
    details: { reason: 'BackOff', pod: 'foo', message: 'crash' },
    verified: true, // pre-verified; verifier path tested separately
    ...overrides,
  }
}

describe('reconcile-loop', () => {
  let db: ReturnType<typeof createMemoryDb>
  let loop: ReturnType<typeof createReconcileLoop>

  beforeEach(() => {
    db = createMemoryDb()
    createOpsTables(db)
    loop = createReconcileLoop({
      db,
      runbooks: [crashloopRunbook(), pvcRunbook()],
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
      kubectlExecutor: fakeKubectlExecutor(),
      prProvider: fakePrProvider(),
    })
  })

  it('records an incident with id + open status', async () => {
    const i = await loop.record(makeIncidentData())
    expect(i.id).toBeTruthy()
    expect(i.status).toBe('open')
    const loaded = await loop.get(i.id)
    expect(loaded?.id).toBe(i.id)
  })

  it('matches a runbook and produces a kubectl proposal', async () => {
    const i = await loop.record(makeIncidentData())
    const r = await loop.reconcile(i.id)
    expect(r.status).toBe('proposed')
    expect(r.diagnosis?.source).toBe('runbook')
    expect(r.diagnosis?.runbookId).toBe('pod-crashloop')
    expect(r.proposal?.actionType).toBe('kubectl')
    expect(r.proposal?.payload.command).toBe('kubectl logs')
    // Template args fully interpolated
    expect(r.proposal?.payload.args).toEqual(['-n', 'prod', 'foo', '--previous'])
  })

  it('produces a gitops-pr proposal for the pvc runbook', async () => {
    const i = await loop.record(
      makeIncidentData({
        source: 'prometheus',
        kind: 'pvc-full',
        namespace: 'gitlab',
        resource: 'Pod/postgres-0',
        summary: 'pvc filling',
        details: { alertname: 'KubePersistentVolumeFillingUp' },
      }),
    )
    const r = await loop.reconcile(i.id)
    expect(r.proposal?.actionType).toBe('gitops-pr')
    expect(r.proposal?.payload.filePath).toBe('clusters/gitlab/pvc.yaml')
  })

  it('uses LLM fallback when no runbook matches', async () => {
    const llmOnly = createReconcileLoop({
      db,
      runbooks: [], // no runbooks at all
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
      llm: { async complete() { return 'likely root cause X' } },
    })
    const i = await llmOnly.record(makeIncidentData())
    const r = await llmOnly.reconcile(i.id)
    expect(r.diagnosis?.source).toBe('llm')
    expect(r.diagnosis?.explanation).toContain('likely root cause X')
    // No runbook → no proposal
    expect(r.proposal).toBeUndefined()
    // Incident stays open so an operator can take over manually.
    expect(r.status).toBe('open')
  })

  it('requires approval before apply (happy path)', async () => {
    const i = await loop.record(makeIncidentData())
    const r = await loop.reconcile(i.id)
    const proposalId = r.proposal!.id

    await expect(loop.apply(proposalId)).rejects.toThrow(/requires approval/)

    const approved = await loop.approve(proposalId, 'owner-1')
    expect(approved.approvedAt).toBeTruthy()
    expect(approved.approvedBy).toBe('owner-1')

    const applied = await loop.apply(proposalId)
    expect(applied.ok).toBe(true)
    // kubectl apply now really runs through the injected executor.
    expect(applied.output).toContain('ran: kubectl logs')

    const incident = await loop.get(i.id)
    expect(incident?.status).toBe('applied')
  })

  it('opens a real PR for gitops proposals on apply', async () => {
    const i = await loop.record(
      makeIncidentData({
        source: 'prometheus',
        kind: 'pvc-full',
        details: { alertname: 'KubePersistentVolumeFillingUp' },
      }),
    )
    const r = await loop.reconcile(i.id)
    const pid = r.proposal!.id
    await loop.approve(pid, 'owner-1')
    const applied = await loop.apply(pid)
    expect(applied.ok).toBe(true)
    // gitops-pr apply now really opens a PR through the injected provider.
    expect(applied.prUrl).toContain('gitea.internal/pulls/')
  })

  it('refuses double-apply', async () => {
    const i = await loop.record(makeIncidentData())
    const r = await loop.reconcile(i.id)
    const pid = r.proposal!.id
    await loop.approve(pid, 'owner-1')
    await loop.apply(pid)
    await expect(loop.apply(pid)).rejects.toThrow(/already applied/)
  })

  it('list filters by status and severity', async () => {
    const a = await loop.record(makeIncidentData({ severity: 'warning' }))
    const b = await loop.record(makeIncidentData({ severity: 'critical' }))
    await loop.reconcile(a.id) // proposed
    const open = await loop.list({ status: 'open' })
    const proposed = await loop.list({ status: 'proposed' })
    expect(open.some((x) => x.id === b.id)).toBe(true)
    expect(proposed.some((x) => x.id === a.id)).toBe(true)
    const crit = await loop.list({ severity: 'critical' })
    expect(crit.every((x) => x.severity === 'critical')).toBe(true)
  })

  it('throws clean 404-like error for missing incident', async () => {
    await expect(loop.reconcile('nope')).rejects.toThrow(/not found/)
  })

  it('FIX 1 (I-2): forces requiresApproval=true for a gitops-pr proposal even when the runbook says false', async () => {
    // A runbook author could set requires_approval: false in the YAML (e.g. by
    // mistake, or for a category later reclassified as risky). Mutations
    // (gitops-pr, helm-upgrade) must NEVER skip approval regardless of the
    // runbook's authored value — this is a server-enforced safety floor.
    const looseGitopsRunbook: Runbook = { ...pvcRunbook(), requiresApproval: false }
    const unsafeLoop = createReconcileLoop({
      db,
      runbooks: [looseGitopsRunbook],
      approvalQueue: createInMemoryApprovalQueue(),
      strictSigned: false,
      prProvider: fakePrProvider(),
    })
    const i = await unsafeLoop.record(
      makeIncidentData({
        source: 'prometheus',
        kind: 'pvc-full',
        namespace: 'gitlab',
        resource: 'Pod/postgres-0',
        summary: 'pvc filling',
        details: { alertname: 'KubePersistentVolumeFillingUp' },
      }),
    )
    const r = await unsafeLoop.reconcile(i.id)
    expect(r.proposal?.actionType).toBe('gitops-pr')
    expect(r.proposal?.requiresApproval).toBe(true)

    // And apply() must actually honor that — no approve() call → refused.
    await expect(unsafeLoop.apply(r.proposal!.id)).rejects.toThrow(/requires approval/)
  })
})
