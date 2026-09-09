// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Channel health watchdog. A bot's polling loop fails in two very different
// ways: transient (network blip, 5xx, rate-limit → keep going, just degraded)
// vs fatal (bad token 401, or a 409 conflict from a second poller → the channel
// is broken and an operator must act). Fatal failures alert ONCE, not on every
// retry, and clear when the channel recovers.

import { describe, it, expect } from 'vitest'
import { createChannelHealth } from '@modules/communication/channel-health.js'

function harness() {
  const alerts: { channelId: string; reason?: string }[] = []
  const health = createChannelHealth({
    now: () => new Date('2026-06-23T10:00:00.000Z'),
    onAlert: (channelId, state) => alerts.push({ channelId, reason: state.fatalReason }),
  })
  return { health, alerts }
}

describe('channel health', () => {
  it('defaults to healthy for an unseen channel', () => {
    const { health } = harness()
    expect(health.get('telegram').status).toBe('healthy')
  })

  it('marks transient errors as degraded without alerting', () => {
    const { health, alerts } = harness()
    health.record('telegram', new Error('network timeout'))
    expect(health.get('telegram').status).toBe('degraded')
    expect(alerts).toHaveLength(0)
  })

  it('marks a 401 (bad token) as fatal/auth and alerts once', () => {
    const { health, alerts } = harness()
    health.record('telegram', { error_code: 401, description: 'Unauthorized' })
    const state = health.get('telegram')
    expect(state.status).toBe('fatal')
    expect(state.fatalReason).toBe('auth')
    expect(alerts).toHaveLength(1)
  })

  it('marks a 409 conflict (second poller) as fatal/conflict and alerts once', () => {
    const { health, alerts } = harness()
    health.record('telegram', { error_code: 409, description: 'Conflict: terminated by other getUpdates' })
    expect(health.get('telegram').status).toBe('fatal')
    expect(health.get('telegram').fatalReason).toBe('conflict')
    expect(alerts).toEqual([{ channelId: 'telegram', reason: 'conflict' }])
  })

  it('alerts only once while the fatal condition persists', () => {
    const { health, alerts } = harness()
    health.record('telegram', { error_code: 401 })
    health.record('telegram', { error_code: 401 })
    health.record('telegram', { error_code: 401 })
    expect(alerts).toHaveLength(1)
  })

  it('recovery clears health and re-arms alerting', () => {
    const { health, alerts } = harness()
    health.record('telegram', { error_code: 401 })
    health.recordOk('telegram')
    expect(health.get('telegram').status).toBe('healthy')
    health.record('telegram', { error_code: 401 })
    expect(alerts).toHaveLength(2) // re-armed after recovery
  })

  it('lists health for all seen channels', () => {
    const { health } = harness()
    health.record('telegram', { error_code: 409 })
    health.record('discord', new Error('blip'))
    const all = health.list()
    expect(all.telegram.status).toBe('fatal')
    expect(all.discord.status).toBe('degraded')
  })
})
