// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The reauth healer reloads a provider's credentials when a call fails with an
// auth error — but only then, and at most once per cooldown so an overload
// spike can't trigger a reload storm. Reload is an ATTEMPT: health stays
// 'auth_error' until a later call actually succeeds (recordSuccess), so the
// badge is honest about unrecoverable cases (e.g. a logged-out host session).

import { describe, it, expect } from 'vitest'
import { createReauthHealer } from '@modules/model/reauth-healer.js'
import { classifyAuthError } from '@shared/classify-auth-error.js'

function harness(opts: { reload?: (id: string) => Promise<void> } = {}) {
  let clock = new Date('2026-06-23T10:00:00.000Z')
  const reloads: string[] = []
  const healer = createReauthHealer({
    classify: classifyAuthError,
    reload: opts.reload ?? (async (id: string) => { reloads.push(id) }),
    now: () => clock,
    cooldownMs: 60_000,
  })
  return { healer, reloads, advanceMs: (ms: number) => { clock = new Date(clock.getTime() + ms) } }
}

describe('reauth healer', () => {
  it('ignores non-auth errors (no reload, no state change)', async () => {
    const h = harness()
    await h.healer.onProviderError('anthropic', { status: 429 })
    await h.healer.onProviderError('anthropic', { status: 529 })
    expect(h.reloads).toHaveLength(0)
    expect(h.healer.getHealth('anthropic').status).toBe('healthy')
  })

  it('on an auth error, marks auth_error and reloads the provider', async () => {
    const h = harness()
    await h.healer.onProviderError('anthropic', { status: 401 })
    expect(h.reloads).toEqual(['anthropic'])
    const health = h.healer.getHealth('anthropic')
    expect(health.status).toBe('auth_error')
    expect(health.lastError).toBeTruthy()
  })

  it('reloads at most once per cooldown (no reload storm)', async () => {
    const h = harness()
    await h.healer.onProviderError('anthropic', { status: 401 })
    await h.healer.onProviderError('anthropic', { status: 401 })
    expect(h.reloads).toHaveLength(1)
    h.advanceMs(60_001)
    await h.healer.onProviderError('anthropic', { status: 401 })
    expect(h.reloads).toHaveLength(2)
  })

  it('recordSuccess clears the auth_error back to healthy', async () => {
    const h = harness()
    await h.healer.onProviderError('anthropic', { status: 403 })
    expect(h.healer.getHealth('anthropic').status).toBe('auth_error')
    h.healer.recordSuccess('anthropic')
    expect(h.healer.getHealth('anthropic').status).toBe('healthy')
  })

  it('keeps auth_error when the reload itself fails', async () => {
    const h = harness({ reload: async () => { throw new Error('reload failed') } })
    await h.healer.onProviderError('anthropic', { status: 401 })
    expect(h.healer.getHealth('anthropic').status).toBe('auth_error')
  })

  it('gives an honest host-login hint for claude-code (cannot self-heal)', async () => {
    const h = harness()
    await h.healer.onProviderError('claude-code', { status: 401 })
    expect(h.healer.getHealth('claude-code').message?.toLowerCase()).toContain('log in')
  })

  it('lists health for all seen providers', async () => {
    const h = harness()
    await h.healer.onProviderError('anthropic', { status: 401 })
    await h.healer.onProviderError('openai', { status: 429 })
    const all = h.healer.listHealth()
    expect(all.anthropic.status).toBe('auth_error')
    // openai only saw a rate-limit → never marked unhealthy
    expect(all.openai?.status ?? 'healthy').toBe('healthy')
  })
})
