// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The rule "would a manual run actually be declined?" is written twice: once on
// the server (`faultBlocksManualRun`, which gates the /run route and the
// schedule_run_now tool) and once in the web app (`blocksManualRun`, which
// disables the Run Now button). They are duplicated because
// `src/modules/scheduler/runnability.ts` imports cron-utils → croner, which is
// not among the web app's dependencies — importing it would pull croner into the
// browser bundle for a two-line predicate.
//
// Nothing else pins the two halves together. If they drift, the UI and the server
// disagree about what the button does. The build-time reason for the duplication
// does not apply to tests: the root vitest config aliases both `@modules` and
// `@`, so one test can hold both sides against the same table.

import { describe, it, expect } from 'vitest'
import { faultBlocksManualRun } from '@modules/scheduler/runnability'
import type { RunnabilityFault } from '@modules/scheduler/types'
// Relative, not the '@' alias: vitest resolves '@' at runtime but the root
// tsconfig does not map it, so an aliased import lints clean at runtime and
// fails tsc. Every other root-level test that reaches into the web app does the
// same (e.g. tests/web/inventory-sort.test.ts).
import { blocksManualRun } from '../../../src/web/src/pages/scheduler/runnability-view'

/** Every (fault, status) pair the UI can hand the gate. */
const FAULTS: Array<RunnabilityFault | undefined> = [
  undefined,
  'no_handler',
  'unarmable_trigger',
  'not_armed',
]
const STATUSES = ['active', 'paused', 'disabled', 'dead_letter'] as const

describe('the two halves of the manual-run gate agree', () => {
  it.each(FAULTS)('fault=%s: the web predicate refuses on fault exactly when the server does', (fault) => {
    // Held at status 'active' so only the fault half can differ — the status
    // clauses are the web side's own and have no server counterpart here.
    expect(blocksManualRun({ status: 'active', runnability: { runnable: fault == null, fault } })).toBe(
      faultBlocksManualRun(fault),
    )
  })

  // The web predicate adds two status clauses the server checks separately
  // (routes.ts and schedule_run_now both test job.status before the fault).
  // This pins that addition so it cannot quietly grow a third.
  it.each(STATUSES)('status=%s with no fault: blocked iff disabled or dead_letter', (status) => {
    const blocked = blocksManualRun({ status, runnability: { runnable: true } })
    expect(blocked).toBe(status === 'disabled' || status === 'dead_letter')
  })

  // The narrowing that Ruling 23 exists for: an event-trigger or bad-cron job is
  // faulted, shows a badge, and is still runnable by hand. If either half starts
  // refusing these again, this fails.
  it.each(['unarmable_trigger', 'not_armed'] as const)('%s never blocks a manual run', (fault) => {
    expect(faultBlocksManualRun(fault)).toBe(false)
    expect(blocksManualRun({ status: 'active', runnability: { runnable: false, fault } })).toBe(false)
  })
})
