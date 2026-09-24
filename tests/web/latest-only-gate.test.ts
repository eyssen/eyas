// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createLatestOnlyGate } from '../../src/web/src/lib/latest-only-gate'

describe('createLatestOnlyGate', () => {
  it('accepts a lone request', () => {
    const gate = createLatestOnlyGate()
    expect(gate.accept(gate.issue())).toBe(true)
  })

  it('accepts responses that resolve in issue order', () => {
    const gate = createLatestOnlyGate()
    const first = gate.issue()
    const second = gate.issue()
    expect(gate.accept(first)).toBe(true)
    expect(gate.accept(second)).toBe(true)
  })

  it('drops an older response that resolves after a newer one', () => {
    // The bug this exists for: mount + reconnect + ping all fetch at once and
    // the slow first response would otherwise overwrite the fresh third.
    const gate = createLatestOnlyGate()
    const slow = gate.issue()
    const fast = gate.issue()
    expect(gate.accept(fast)).toBe(true)
    expect(gate.accept(slow)).toBe(false)
  })

  it('drops every straggler once the newest has been applied', () => {
    const gate = createLatestOnlyGate()
    const tickets = [gate.issue(), gate.issue(), gate.issue()]
    expect(gate.accept(tickets[2])).toBe(true)
    expect(gate.accept(tickets[0])).toBe(false)
    expect(gate.accept(tickets[1])).toBe(false)
  })

  it('refuses to apply the same ticket twice', () => {
    const gate = createLatestOnlyGate()
    const ticket = gate.issue()
    expect(gate.accept(ticket)).toBe(true)
    expect(gate.accept(ticket)).toBe(false)
  })

  it('keeps accepting newer tickets after a rejection', () => {
    const gate = createLatestOnlyGate()
    const stale = gate.issue()
    expect(gate.accept(gate.issue())).toBe(true)
    expect(gate.accept(stale)).toBe(false)
    expect(gate.accept(gate.issue())).toBe(true)
  })

  it('gives independent gates independent state', () => {
    const a = createLatestOnlyGate()
    const b = createLatestOnlyGate()
    a.issue()
    expect(a.accept(a.issue())).toBe(true)
    expect(b.accept(b.issue())).toBe(true)
  })
})
