// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G8 — a CLI turn has no whole-turn time limit any more (it is stopped only
// when the CLI goes quiet), so the bridge secret's TTL — the backstop for a
// turn that crashed without revoking it — runs from the secret's last use,
// not from its issue: a long, busy turn keeps its EYAS tools; an abandoned
// secret still expires.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BRIDGE_SECRET_TTL_MS,
  getBridgeBinding,
  issueBridgeSecret,
  revokeBridgeSecret,
} from '@modules/model/cli-mcp/bridge-routes.js'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-23T08:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bridge secret TTL', () => {
  it('a secret in use stays live past twice the TTL', () => {
    const secret = issueBridgeSecret({ conversationId: 'conv-1' })
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(BRIDGE_SECRET_TTL_MS / 2)
      expect(getBridgeBinding(secret)?.conversationId).toBe('conv-1')
    }
    revokeBridgeSecret(secret)
  })

  it('a secret unused for longer than the TTL expires', () => {
    const secret = issueBridgeSecret({ conversationId: 'conv-1' })
    expect(getBridgeBinding(secret)).toBeDefined()
    vi.advanceTimersByTime(BRIDGE_SECRET_TTL_MS + 1)
    expect(getBridgeBinding(secret)).toBeUndefined()
    // Expired is gone for good: time does not bring it back.
    vi.advanceTimersByTime(1)
    expect(getBridgeBinding(secret)).toBeUndefined()
  })

  it('a revoked secret is gone at once, whatever its TTL', () => {
    const secret = issueBridgeSecret({ conversationId: 'conv-1' })
    revokeBridgeSecret(secret)
    expect(getBridgeBinding(secret)).toBeUndefined()
  })

  it('an abandoned secret is purged when the next one is issued', () => {
    const stale = issueBridgeSecret({ conversationId: 'conv-old' })
    vi.advanceTimersByTime(BRIDGE_SECRET_TTL_MS + 1)
    const fresh = issueBridgeSecret({ conversationId: 'conv-new' })
    expect(getBridgeBinding(stale)).toBeUndefined()
    expect(getBridgeBinding(fresh)?.conversationId).toBe('conv-new')
    revokeBridgeSecret(fresh)
  })
})
