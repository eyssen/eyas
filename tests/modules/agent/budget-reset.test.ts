// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The scheduler emits `model:budget:reset` monthly. Without a subscriber the
// per-agent token counters (AND the budget engine's alert dedup — F2 T8) are
// never cleared, so every agent that hits its monthly budget stays blocked
// forever, and a threshold band it crossed last month stays suppressed.

import { describe, it, expect, vi } from 'vitest'
import { createLocalBus } from '@core/bus/local-bus'
import { wireBudgetReset } from '@modules/agent/index'

function noopLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any
}

describe('monthly budget reset wiring', () => {
  it('calls budgetEngine.resetAll() when the scheduler emits model:budget:reset', async () => {
    const bus = createLocalBus()
    const budgetEngine = { resetAll: vi.fn() }
    const logger = noopLogger()

    wireBudgetReset({ bus, budgetEngine, logger })
    bus.emit('model:budget:reset', { period: 'monthly' })
    await Promise.resolve()

    expect(budgetEngine.resetAll).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalled()
  })

  it('a failing reset is logged, not thrown at the bus', async () => {
    const bus = createLocalBus()
    const budgetEngine = {
      resetAll: vi.fn(() => { throw new Error('db locked') }),
    }
    const logger = noopLogger()

    wireBudgetReset({ bus, budgetEngine, logger })
    expect(() => bus.emit('model:budget:reset', {})).not.toThrow()
    await Promise.resolve()

    expect(logger.error).toHaveBeenCalled()
  })

  it('unsubscribing stops the reset', async () => {
    const bus = createLocalBus()
    const budgetEngine = { resetAll: vi.fn() }

    const sub = wireBudgetReset({ bus, budgetEngine, logger: noopLogger() })
    sub.unsubscribe()
    bus.emit('model:budget:reset', {})
    await Promise.resolve()

    expect(budgetEngine.resetAll).not.toHaveBeenCalled()
  })
})
