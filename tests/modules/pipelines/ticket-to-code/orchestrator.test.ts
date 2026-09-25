// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { createTicketToCodeOrchestrator } from '../../../../src/modules/pipelines/ticket-to-code/orchestrator'
import type { PipelineRunConfig } from '../../../../src/modules/pipelines/ticket-to-code/types'

function agentResponseBag() {
  return {
    'product-owner': {
      text: '',
      json: {
        problem: 'Admins need a validated bulk CSV import for partners to save time',
        personas: [{ name: 'Admin', goals: ['Upload CSV'] }],
        successMetrics: ['1000 rows < 10s'],
        requirements: { functional: ['Validate VAT'] },
        outOfScope: [],
        openQuestions: [],
      },
    },
    'architect': {
      text: '',
      json: {
        summary: 'Introduce CSV importer service with streaming validation pipeline',
        architecture: {
          components: [{ name: 'CsvImporter', responsibility: 'Parse and validate' }],
          dataFlow: ['CSV → Importer'],
        },
        interfaces: [],
        dataModel: [],
        risks: [],
        alternatives: [],
      },
    },
    'developer': {
      text: '',
      json: {
        summary: 'Scaffold importer endpoint',
        branch: 'feature/csv',
        files: [{ path: 'src/importer.ts', action: 'add' as const, newContent: 'export {}' }],
      },
    },
    'qa-engineer': {
      text: '',
      json: {
        testPlan: {
          scope: 'End-to-end CSV import smoke tests',
          environments: ['ci'],
          cases: [
            {
              id: 'TC-1',
              title: 'Valid CSV imports',
              kind: 'integration' as const,
              steps: ['Upload sample.csv'],
              expected: 'All rows imported',
              severity: 'critical' as const,
            },
          ],
        },
        reviewComments: [],
      },
    },
  }
}

describe('TicketToCodeOrchestrator', () => {
  async function setup(config: PipelineRunConfig = {}) {
    const fixture = loadTicketFixture('ticket-feature-request')
    const harness = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
      agentResponses: agentResponseBag(),
    })
    const orch = createTicketToCodeOrchestrator(harness.db, harness.deps)
    const state = await orch.start({
      ticketSource: fixture.source,
      ticketId: fixture.id,
      startedBy: 'tester',
      config,
    })
    return { ...harness, orch, state, fixture }
  }

  it('runs all seven stages end-to-end to completion', async () => {
    const { state, orch } = await setup()
    expect(state.run.status).toBe('completed')
    expect(state.stages).toHaveLength(7)
    for (const s of state.stages) {
      expect(s.status).toBe('succeeded')
      expect(s.artifactId).toBeTruthy()
    }
    // currentStage cleared on completion
    const again = orch.getState(state.run.id)
    expect(again.run.currentStage).toBeNull()
  })

  it('persists checkpoints before each stage', async () => {
    const { state, checkpoint } = await setup()
    expect(checkpoint.saves.length).toBeGreaterThanOrEqual(7)
    const keys = checkpoint.saves.map((s) => s.key)
    expect(keys.some((k) => k.includes(':ingest:start'))).toBe(true)
    expect(keys.some((k) => k.includes(':deploy:start'))).toBe(true)
    expect(state.run.status).toBe('completed')
  })

  it('pauses at an approval gate and resumes on approve()', async () => {
    const { orch, state } = await setup({ approvalGates: { 'pm-clarify': true } })
    expect(state.run.status).toBe('waiting_approval')
    const pm = state.stages.find((s) => s.stageName === 'pm-clarify')!
    expect(pm.status).toBe('awaiting_approval')

    const next = await orch.approve(state.run.id, 'pm-clarify')
    expect(next.run.status).toBe('completed')
  })

  it('marks the run failed when a stage throws, and resume re-runs just the failed stage', async () => {
    const fixture = loadTicketFixture('ticket-feature-request')
    const harness = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
      agentResponses: agentResponseBag(),
    })

    // Make the architect stage throw the first time, succeed the second time.
    let architectCalls = 0
    harness.agentRunner.setResponder((input) => {
      if (input.agentId === 'architect') {
        architectCalls++
        if (architectCalls === 1) throw new Error('boom: architect agent timed out')
        return agentResponseBag().architect
      }
      const bag = agentResponseBag() as Record<string, any>
      return bag[input.agentId]
    })

    const orch = createTicketToCodeOrchestrator(harness.db, harness.deps)
    const first = await orch.start({
      ticketSource: fixture.source,
      ticketId: fixture.id,
    })
    expect(first.run.status).toBe('failed')
    const failed = first.stages.find((s) => s.status === 'failed')!
    expect(failed.stageName).toBe('architect-design')
    expect(failed.error).toMatch(/boom/)

    const resumed = await orch.resume(first.run.id)
    expect(resumed.run.status).toBe('completed')
    // Previously-succeeded stages should not have been re-run.
    const ingestAfter = resumed.stages.find((s) => s.stageName === 'ingest')!
    const ingestBefore = first.stages.find((s) => s.stageName === 'ingest')!
    expect(ingestAfter.artifactId).toBe(ingestBefore.artifactId)
  })

  it('cancel() halts a running pipeline and resume() restarts it', async () => {
    const { orch, state } = await setup({ approvalGates: { 'dev-implement': true } })
    expect(state.run.status).toBe('waiting_approval')
    const cancelled = orch.cancel(state.run.id)
    expect(cancelled.run.status).toBe('cancelled')

    // Cancelled + awaiting_approval stage still awaiting — resume should
    // flip status back to running and stop again at the gate.
    const resumed = await orch.resume(state.run.id)
    expect(['waiting_approval', 'running', 'completed']).toContain(resumed.run.status)
  })

  it('throws InvalidPipelineStateError on approve of a non-awaiting stage', async () => {
    const { orch, state } = await setup()
    await expect(orch.approve(state.run.id, 'ingest')).rejects.toThrow(/not awaiting approval/)
  })

  it('applies the orchestrator default approvalGates when start() is called without config', async () => {
    const fixture = loadTicketFixture('ticket-feature-request')
    const harness = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
      agentResponses: agentResponseBag(),
    })
    const orch = createTicketToCodeOrchestrator(harness.db, harness.deps, {
      defaultApprovalGates: { 'pr-open': true },
    })
    const state = await orch.start({ ticketSource: fixture.source, ticketId: fixture.id })
    expect(state.run.status).toBe('waiting_approval')
    const prOpen = state.stages.find((s) => s.stageName === 'pr-open')!
    expect(prOpen.status).toBe('awaiting_approval')
  })

  it('REGRESSION (FIX C1): default gate on "review" pauses BEFORE pr-open opens a PR; approve() then opens it', async () => {
    const fixture = loadTicketFixture('ticket-feature-request')
    const harness = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
      agentResponses: agentResponseBag(),
    })
    // Mirrors the post-fix config schema default: approvalGates: { review: true }
    // (src/core/config/schema.ts). The orchestrator gates AFTER a stage runs,
    // so gating 'review' — the stage immediately before 'pr-open' in
    // STAGE_NAMES — must pause the run before any PR is opened.
    const orch = createTicketToCodeOrchestrator(harness.db, harness.deps, {
      defaultApprovalGates: { review: true },
    })

    const state = await orch.start({ ticketSource: fixture.source, ticketId: fixture.id })

    expect(state.run.status).toBe('waiting_approval')
    const review = state.stages.find((s) => s.stageName === 'review')!
    expect(review.status).toBe('awaiting_approval')
    const prOpen = state.stages.find((s) => s.stageName === 'pr-open')!
    expect(prOpen.status).toBe('pending')
    // No PR opened yet — the whole point of the fix.
    expect(harness.prClient.calls.length).toBe(0)

    const next = await orch.approve(state.run.id, 'review')

    expect(next.run.status).toBe('completed')
    expect(harness.prClient.calls.length).toBe(1)
  })

  it('lets an explicit per-run config.approvalGates override the orchestrator default', async () => {
    const fixture = loadTicketFixture('ticket-feature-request')
    const harness = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
      agentResponses: agentResponseBag(),
    })
    const orch = createTicketToCodeOrchestrator(harness.db, harness.deps, {
      defaultApprovalGates: { 'pr-open': true },
    })
    // Caller explicitly disables all gates — the default must not apply.
    const state = await orch.start({
      ticketSource: fixture.source,
      ticketId: fixture.id,
      config: { approvalGates: {} },
    })
    expect(state.run.status).toBe('completed')
  })
})
