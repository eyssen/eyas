// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  isFaulted,
  blocksManualRun,
  applyInfraFilter,
  applyFaultedFilter,
  faultLabelKey,
  faultTooltipKey,
} from '../../src/web/src/pages/scheduler/runnability-view'

const healthySystem = { id: 'a', source: 'system', kind: 'handler', runnability: { runnable: true } }
const brokenSystem = {
  id: 'b', source: 'system', kind: 'handler',
  runnability: { runnable: false, fault: 'no_handler' as const, detail: 'gone.handler' },
}
const userJob = { id: 'c', source: 'user', kind: 'handler', runnability: { runnable: true } }
const agentRun = { id: 'd', source: 'system', kind: 'agent_run', runnability: { runnable: true } }

describe('isFaulted', () => {
  it('is false when runnability is absent', () => {
    expect(isFaulted({})).toBe(false)
  })
  it('is false for a runnable job and true for a faulted one', () => {
    expect(isFaulted(healthySystem)).toBe(false)
    expect(isFaulted(brokenSystem)).toBe(true)
  })
})

describe('blocksManualRun', () => {
  it('blocks a job with no handler', () => {
    expect(blocksManualRun(brokenSystem)).toBe(true)
  })

  it('blocks a disabled or dead-lettered job', () => {
    expect(blocksManualRun({ status: 'disabled', runnability: { runnable: true } })).toBe(true)
    expect(blocksManualRun({ status: 'dead_letter', runnability: { runnable: true } })).toBe(true)
  })

  // The whole point of the narrowing: these two faults do NOT stop executeJob,
  // and for an event trigger Run Now is the only way the job ever runs.
  it('does not block an unarmable trigger — Run Now is its only route', () => {
    expect(
      blocksManualRun({
        status: 'active',
        runnability: { runnable: false, fault: 'unarmable_trigger', detail: 'event' },
      }),
    ).toBe(false)
  })

  it('does not block a job whose cron never armed', () => {
    expect(
      blocksManualRun({
        status: 'active',
        runnability: { runnable: false, fault: 'not_armed', detail: 'every minute' },
      }),
    ).toBe(false)
  })

  it('does not block a healthy job', () => {
    expect(blocksManualRun({ status: 'active', runnability: { runnable: true } })).toBe(false)
    expect(blocksManualRun({})).toBe(false)
  })

  // isFaulted stays broad: the badge and the infra-filter override must react to
  // every fault, only the run gate narrows.
  it('is strictly narrower than isFaulted', () => {
    const unarmable = {
      status: 'active',
      runnability: { runnable: false, fault: 'unarmable_trigger' as const, detail: 'event' },
    }
    expect(isFaulted(unarmable)).toBe(true)
    expect(blocksManualRun(unarmable)).toBe(false)
  })
})

describe('applyInfraFilter', () => {
  const all = [healthySystem, brokenSystem, userJob, agentRun]

  // The rule the whole feature rests on: without it, the jobs most likely to
  // break — the module-seeded ones — stay invisible.
  it('never hides a faulted system job', () => {
    expect(applyInfraFilter(all, false, '').map((j) => j.id)).toEqual(['b', 'c', 'd'])
  })

  it('hides a healthy system job when infra is off', () => {
    expect(applyInfraFilter(all, false, '').some((j) => j.id === 'a')).toBe(false)
  })

  it('shows everything when infra is on', () => {
    expect(applyInfraFilter(all, true, '')).toHaveLength(4)
  })

  it('shows everything when the user explicitly filters to system', () => {
    expect(applyInfraFilter(all, false, 'system')).toHaveLength(4)
  })
})

describe('applyFaultedFilter', () => {
  const all = [healthySystem, brokenSystem, userJob, agentRun]

  it('leaves the list untouched when faultedOnly is false', () => {
    expect(applyFaultedFilter(all, false)).toEqual(all)
  })

  it('keeps only faulted jobs when faultedOnly is true', () => {
    expect(applyFaultedFilter(all, true).map((j) => j.id)).toEqual(['b'])
  })

  it('never treats a job with no runnability as faulted', () => {
    expect(applyFaultedFilter([{ id: 'e' }, ...all], true).map((j) => j.id)).toEqual(['b'])
  })
})

describe('i18n key mapping', () => {
  it('maps each fault to its label and tooltip key', () => {
    expect(faultLabelKey('no_handler')).toBe('scheduler.fault.no_handler')
    expect(faultTooltipKey('not_armed')).toBe('scheduler.fault.not_armed.tooltip')
  })
})
