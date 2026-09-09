// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createOpsTables, createOpsServices } from '@modules/ops'
import { createAutonomyApprovalQueue } from '@modules/ops/actions/autonomy-approval-queue'
import { createAutonomyTables, createAutonomyPolicy } from '@modules/security-gate/autonomy-policy'
import type { KubectlExecResult } from '@modules/ops/actions/kubectl-executor'
import type { OpenPrInput, PrProvider } from '@modules/ops/actions/pr-provider'
import type { NewIncident, Runbook } from '@modules/ops/types'

// Seeding follows the same pattern as the existing reconcile-loop tests
// (tests/modules/ops/reconcile-loop.test.ts): define a runbook, record() an
// incident, reconcile() it to get a real, DB-backed proposal, approve() it,
// then apply() and assert on the honest result — no direct row inserts.

function crashloopRunbook(): Runbook {
  return {
    id: 'pod-crashloop',
    kind: 'pod-crashloop',
    matcher: { type: 'k8s-event', fields: { reason: 'BackOff' } },
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
    matcher: { type: 'prometheus', fields: { alertname: 'KubePersistentVolumeFillingUp' } },
    diagnosisTemplate: 'PVC filling up in {{namespace}}',
    suggestedAction: {
      actionType: 'gitops-pr',
      prPath: 'clusters/{{namespace}}/pvc.yaml',
      // A real unified-diff hunk so applyPatch() can actually resolve it
      // against the fake provider's current file content ('old: 1\n').
      prPatch: `Index: clusters/{{namespace}}/pvc.yaml
===================================================================
--- clusters/{{namespace}}/pvc.yaml
+++ clusters/{{namespace}}/pvc.yaml
@@ -1,1 +1,1 @@
-old: 1
+old: 2
`,
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
    verified: true,
    ...overrides,
  }
}

function pvcIncidentData(overrides: Partial<NewIncident> = {}): NewIncident {
  return makeIncidentData({
    source: 'prometheus',
    kind: 'pvc-full',
    namespace: 'gitlab',
    resource: 'Pod/postgres-0',
    summary: 'pvc filling',
    details: { alertname: 'KubePersistentVolumeFillingUp' },
    ...overrides,
  })
}

function fakeExecutor(res: KubectlExecResult, capture?: { command?: string; args?: string[] }) {
  return {
    async exec(command: string, args: string[]) {
      if (capture) {
        capture.command = command
        capture.args = args
      }
      return res
    },
  }
}

function fakePrProvider(overrides: Partial<PrProvider> = {}, capture?: { input?: OpenPrInput }): PrProvider {
  return {
    async getFileContent() {
      return 'old: 1\n'
    },
    async openPullRequest(input) {
      if (capture) capture.input = input
      return { prUrl: 'https://x/pr/1', number: 1 }
    },
    async openMultiFilePullRequest(input) {
      return { prUrl: 'https://x/pr/1', number: 1, status: input.draft ? 'draft' : 'open' }
    },
    ...overrides,
  }
}

describe('reconcile-loop apply — kubectl (real executor wiring)', () => {
  it('maps the executor result (no fake success)', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const capture: { command?: string; args?: string[] } = {}
    const svc = createOpsServices({
      db,
      runbooks: [crashloopRunbook()],
      strictSigned: false,
      kubectlExecutor: fakeExecutor({ ok: true, output: 'pod/foo Running', durationMs: 5 }, capture),
    })

    const incident = await svc.loop.record(makeIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    expect(r.proposal?.payload.command).toBe('kubectl logs')
    await svc.loop.approve(proposalId, 'owner-1')

    const applied = await svc.loop.apply(proposalId)
    expect(applied.ok).toBe(true)
    expect(applied.output).toBe('pod/foo Running')
    expect(applied.durationMs).toBe(5)
    // The 'kubectl ' prefix baked into the proposal payload must be stripped
    // before hitting the executor's allow-list (which only knows bare verbs).
    expect(capture.command).toBe('logs')
    expect(capture.args).toEqual(['-n', 'prod', 'foo', '--previous'])

    const incidentAfter = await svc.loop.get(incident.id)
    expect(incidentAfter?.status).toBe('applied')
  })

  it('surfaces an honest executor error', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const svc = createOpsServices({
      db,
      runbooks: [crashloopRunbook()],
      strictSigned: false,
      kubectlExecutor: fakeExecutor({ ok: false, error: 'kubectl execution disabled', durationMs: 0 }),
    })

    const incident = await svc.loop.record(makeIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    await svc.loop.approve(proposalId, 'owner-1')

    const applied = await svc.loop.apply(proposalId)
    expect(applied.ok).toBe(false)
    expect(applied.error).toMatch(/disabled/)

    const incidentAfter = await svc.loop.get(incident.id)
    expect(incidentAfter?.status).toBe('proposed')
  })

  it('is honest when no executor is configured', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const svc = createOpsServices({ db, runbooks: [crashloopRunbook()], strictSigned: false }) // no kubectlExecutor

    const incident = await svc.loop.record(makeIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    await svc.loop.approve(proposalId, 'owner-1')

    const applied = await svc.loop.apply(proposalId)
    expect(applied.ok).toBe(false)
    expect(applied.error).toMatch(/not configured/i)
  })
})

describe('reconcile-loop apply — gitops-pr (real PrProvider wiring)', () => {
  it('opens a real PR via the provider, resolving the patch against current content', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const capture: { input?: OpenPrInput } = {}
    const svc = createOpsServices({
      db,
      runbooks: [pvcRunbook()],
      strictSigned: false,
      prProvider: fakePrProvider({}, capture),
    })

    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    await svc.loop.approve(proposalId, 'owner-1')

    const applied = await svc.loop.apply(proposalId)
    expect(applied.ok).toBe(true)
    expect(applied.prUrl).toBe('https://x/pr/1')
    // The resolved content must reflect the patch applied against 'old: 1\n'.
    expect(capture.input?.content).toBe('old: 2\n')
    expect(capture.input?.filePath).toBe('clusters/gitlab/pvc.yaml')
    expect(capture.input?.branch).toBe(`ops/${proposalId}`)
    expect(capture.input?.title).toBeTruthy()

    const incidentAfter = await svc.loop.get(incident.id)
    expect(incidentAfter?.status).toBe('applied')
  })

  it('is honest when no provider is configured', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const svc = createOpsServices({ db, runbooks: [pvcRunbook()], strictSigned: false }) // no prProvider

    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    await svc.loop.approve(proposalId, 'owner-1')

    const applied = await svc.loop.apply(proposalId)
    expect(applied.ok).toBe(false)
    expect(applied.error).toMatch(/not configured/i)
  })

  it('is honest when the patch cannot be resolved against the current file content', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const svc = createOpsServices({
      db,
      runbooks: [pvcRunbook()],
      strictSigned: false,
      // getFileContent returns content that does not match the patch's context
      // lines, so applyPatch() must fail (return false) rather than silently
      // producing garbage or a fake success.
      prProvider: fakePrProvider({ async getFileContent() { return 'totally: unrelated\n' } }),
    })

    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    await svc.loop.approve(proposalId, 'owner-1')

    const applied = await svc.loop.apply(proposalId)
    expect(applied.ok).toBe(false)
    expect(applied.error).toMatch(/patch/i)
  })
})

describe('reconcile-loop apply — approval gate regression (Task 8)', () => {
  it('refuses a gitops-pr proposal with no approvedAt, and proceeds once approved', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    const capture: { input?: OpenPrInput } = {}
    const svc = createOpsServices({
      db,
      runbooks: [pvcRunbook()], // requiresApproval: true — a real infra mutation
      strictSigned: false,
      prProvider: fakePrProvider({}, capture),
    })

    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposal = r.proposal!
    expect(proposal.actionType).toBe('gitops-pr')
    expect(proposal.requiresApproval).toBe(true)
    expect(proposal.approvedAt).toBeUndefined()

    // No approval yet — apply() must refuse and MUST NOT call the PR provider.
    await expect(svc.loop.apply(proposal.id)).rejects.toThrow(/requires approval/i)
    expect(capture.input).toBeUndefined()

    // Once a human approves it, apply() proceeds and really opens the PR.
    const approved = await svc.loop.approve(proposal.id, 'owner-1')
    expect(approved.approvedAt).toBeTruthy()
    const applied = await svc.loop.apply(proposal.id)
    expect(applied.ok).toBe(true)
    expect(applied.prUrl).toBe('https://x/pr/1')
    expect(capture.input).toBeTruthy()
  })

  it('a read-only kubectl proposal built from a requiresApproval:false runbook auto-runs (no approve() call needed)', async () => {
    // NOTE: requiresApproval is per-runbook config (Runbook.requiresApproval,
    // copied verbatim onto the Proposal in reconcile-loop.propose()) — the
    // kubectl/gitops-pr builders themselves carry no such field. This runbook
    // fixture models what a read-only diagnostic runbook opting into
    // auto-run would look like; the executor's own allow-list (kubectl-
    // generator.ts / kubectl-executor.ts) independently guarantees only
    // read-only verbs can ever be proposed or executed this way.
    const readOnlyRunbook = { ...crashloopRunbook(), requiresApproval: false }
    const db = createMemoryDb()
    createOpsTables(db)
    const capture: { command?: string; args?: string[] } = {}
    const svc = createOpsServices({
      db,
      runbooks: [readOnlyRunbook],
      strictSigned: false,
      kubectlExecutor: fakeExecutor({ ok: true, output: 'pod/foo Running', durationMs: 3 }, capture),
    })

    const incident = await svc.loop.record(makeIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposal = r.proposal!
    expect(proposal.actionType).toBe('kubectl')
    expect(proposal.requiresApproval).toBe(false)

    // No svc.loop.approve() call — must succeed directly.
    const applied = await svc.loop.apply(proposal.id)
    expect(applied.ok).toBe(true)
    expect(applied.output).toBe('pod/foo Running')
    expect(capture.command).toBe('logs')
  })
})

describe('reconcile-loop apply — autonomy approval queue gate (FIX 2 / I-1)', () => {
  // A real security-gate autonomy queue (not the in-memory stub) wired in as
  // approvalQueue, so a decision made through the HIL approvals mechanism
  // (policy.decide) actually gates apply() — not just the ops approve()
  // route's approvedAt.
  function wireWithAutonomyQueue(runbooks: Runbook[]) {
    const opsDb = createMemoryDb()
    createOpsTables(opsDb)
    const gateDb = createMemoryDb()
    createAutonomyTables(gateDb)
    const policy = createAutonomyPolicy(gateDb)
    policy.seedDefaults()
    const approvalQueue = createAutonomyApprovalQueue(policy)
    const svc = createOpsServices({
      db: opsDb,
      runbooks,
      strictSigned: false,
      kubectlExecutor: undefined,
      prProvider: fakePrProvider(),
      approvalQueue,
    })
    return { svc, policy }
  }

  it('deciding the autonomy row to approved unblocks apply() — without ever calling loop.approve()', async () => {
    const { svc, policy } = wireWithAutonomyQueue([pvcRunbook()])
    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposal = r.proposal!
    expect(proposal.requiresApproval).toBe(true)
    expect(proposal.approvedAt).toBeUndefined()

    // Not yet decided — must refuse.
    await expect(svc.loop.apply(proposal.id)).rejects.toThrow(/requires approval/i)

    // Resolve the queueId the ops module recorded on the proposal, and decide
    // it 'approved' through the security-gate autonomy mechanism directly —
    // never touching the ops loop.approve() route/method.
    const stored = await svc.loop.getProposal(proposal.id)
    expect(stored?.approvalQueueId).toBeTruthy()
    const decision = policy.decide(Number(stored!.approvalQueueId), 'approved', 'owner-1')
    expect(decision.ok).toBe(true)

    const applied = await svc.loop.apply(proposal.id)
    expect(applied.ok).toBe(true)
    expect(applied.prUrl).toBeTruthy()
  })

  it('a pending autonomy row keeps apply() blocked', async () => {
    const { svc } = wireWithAutonomyQueue([pvcRunbook()])
    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposal = r.proposal!

    await expect(svc.loop.apply(proposal.id)).rejects.toThrow(/requires approval/i)
  })

  it('a rejected autonomy row keeps apply() blocked, even though a queueId exists', async () => {
    const { svc, policy } = wireWithAutonomyQueue([pvcRunbook()])
    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposal = r.proposal!

    const stored = await svc.loop.getProposal(proposal.id)
    policy.decide(Number(stored!.approvalQueueId), 'rejected', 'owner-1')

    await expect(svc.loop.apply(proposal.id)).rejects.toThrow(/requires approval/i)
  })

  it('the existing ops approve() / approvedAt path still works even with a real autonomy queue wired in', async () => {
    const { svc } = wireWithAutonomyQueue([pvcRunbook()])
    const incident = await svc.loop.record(pvcIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposal = r.proposal!

    // Autonomy row stays 'pending' the whole time — approval comes from the
    // ops approve() route/method instead.
    await svc.loop.approve(proposal.id, 'owner-1')
    const applied = await svc.loop.apply(proposal.id)
    expect(applied.ok).toBe(true)
  })
})

describe('reconcile-loop apply — retry after transient failure (FIX 3 / M-4)', () => {
  it('does not set appliedAt on a failed apply, so a subsequent apply() is permitted (not "already applied")', async () => {
    const db = createMemoryDb()
    createOpsTables(db)
    let callCount = 0
    const svc = createOpsServices({
      db,
      runbooks: [crashloopRunbook()],
      strictSigned: false,
      kubectlExecutor: {
        async exec() {
          callCount++
          if (callCount === 1) return { ok: false, error: 'transient network blip', durationMs: 1 }
          return { ok: true, output: 'pod/foo Running', durationMs: 2 }
        },
      },
    })

    const incident = await svc.loop.record(makeIncidentData())
    const r = await svc.loop.reconcile(incident.id)
    const proposalId = r.proposal!.id
    await svc.loop.approve(proposalId, 'owner-1')

    const first = await svc.loop.apply(proposalId)
    expect(first.ok).toBe(false)
    const afterFirst = await svc.loop.getProposal(proposalId)
    expect(afterFirst?.appliedAt).toBeUndefined()
    // The failed result is still persisted for audit purposes.
    expect(afterFirst?.result).toBeTruthy()

    // Retry — must NOT throw "already applied".
    const second = await svc.loop.apply(proposalId)
    expect(second.ok).toBe(true)
    const afterSecond = await svc.loop.getProposal(proposalId)
    expect(afterSecond?.appliedAt).toBeTruthy()

    // Now a third apply() really is a double-apply and must be refused.
    await expect(svc.loop.apply(proposalId)).rejects.toThrow(/already applied/)
  })
})
