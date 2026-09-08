// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Heartbeat autonomy (Cap 5). A periodic, leader-gated tick collects cheap
// signals (board / scheduler / system) and a DETERMINISTIC gate decides whether
// there is anything worth telling the user — so a quiet system spends 0 LLM
// tokens. It is off by default (privacy) and respects quiet hours.

import { describe, it, expect } from 'vitest'
import { shouldNotify, isQuietHours, createHeartbeat } from '@modules/proactive-assistant/heartbeat.js'

describe('shouldNotify', () => {
  it('does not notify when there is no news (0-token gate)', () => {
    expect(shouldNotify({}).notify).toBe(false)
    expect(shouldNotify({ boardStuck: 0, schedulerFailures: 0 }).notify).toBe(false)
  })

  it('notifies and names the source when a signal is present', () => {
    const d = shouldNotify({ boardStuck: 2 })
    expect(d.notify).toBe(true)
    expect(d.reasons.join(' ')).toMatch(/board/i)
  })

  it('collects reasons across multiple signals', () => {
    const d = shouldNotify({ boardStuck: 1, schedulerFailures: 3, systemAlerts: 1 })
    expect(d.notify).toBe(true)
    expect(d.reasons.length).toBeGreaterThanOrEqual(3)
  })
})

describe('isQuietHours', () => {
  const at = (h: number) => new Date(`2026-06-23T${String(h).padStart(2, '0')}:00:00.000Z`)

  it('handles a wraparound window (22:00 → 07:00)', () => {
    expect(isQuietHours(at(23), { startHour: 22, endHour: 7 })).toBe(true)
    expect(isQuietHours(at(3), { startHour: 22, endHour: 7 })).toBe(true)
    expect(isQuietHours(at(12), { startHour: 22, endHour: 7 })).toBe(false)
  })

  it('handles a same-day window (01:00 → 05:00)', () => {
    expect(isQuietHours(at(3), { startHour: 1, endHour: 5 })).toBe(true)
    expect(isQuietHours(at(6), { startHour: 1, endHour: 5 })).toBe(false)
  })
})

function harness(opts: {
  enabled?: boolean
  signals?: Record<string, number>
  hour?: number
  quietHours?: { startHour: number; endHour: number }
} = {}) {
  const notified: { reasons: string[] }[] = []
  const heartbeat = createHeartbeat({
    enabled: opts.enabled ?? false,
    now: () => new Date(`2026-06-23T${String(opts.hour ?? 12).padStart(2, '0')}:00:00.000Z`),
    quietHours: opts.quietHours,
    collect: async () => opts.signals ?? {},
    notify: async (_signals, reasons) => { notified.push({ reasons }) },
  })
  return { heartbeat, notified }
}

describe('createHeartbeat.tick', () => {
  it('does nothing when disabled (no collect, no notify)', async () => {
    const h = harness({ enabled: false, signals: { boardStuck: 5 } })
    const r = await h.heartbeat.tick()
    expect(r.notified).toBe(false)
    expect(h.notified).toHaveLength(0)
  })

  it('does nothing during quiet hours', async () => {
    const h = harness({ enabled: true, signals: { boardStuck: 5 }, hour: 23, quietHours: { startHour: 22, endHour: 7 } })
    const r = await h.heartbeat.tick()
    expect(r.notified).toBe(false)
  })

  it('does not notify when enabled but there is no news', async () => {
    const h = harness({ enabled: true, signals: {}, hour: 12 })
    const r = await h.heartbeat.tick()
    expect(r.notified).toBe(false)
    expect(h.notified).toHaveLength(0)
  })

  it('notifies when enabled, awake, and there is news', async () => {
    const h = harness({ enabled: true, signals: { boardStuck: 2 }, hour: 12 })
    const r = await h.heartbeat.tick()
    expect(r.notified).toBe(true)
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].reasons.join(' ')).toMatch(/board/i)
  })
})
