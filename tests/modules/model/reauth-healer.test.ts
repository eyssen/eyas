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

function harness(opts: { reload?: (id: string) => Promise<void>; signInRequired?: (id: string) => boolean } = {}) {
  let clock = new Date('2026-06-23T10:00:00.000Z')
  const reloads: string[] = []
  const healer = createReauthHealer({
    classify: classifyAuthError,
    reload: opts.reload ?? (async (id: string) => { reloads.push(id) }),
    signInRequired: opts.signInRequired,
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

  it('badges a CLI whose EYAS home is not signed in before any call fails, with the cliSignIn code (positive)', () => {
    let signedIn = false
    const h = harness({ signInRequired: (id) => id === 'grok-cli' && !signedIn })
    expect(h.healer.getHealth('grok-cli')).toMatchObject({ status: 'auth_error', code: 'cliSignIn' })
    expect(h.healer.getHealth('grok-cli').message).toMatch(/does not use the host login/)
    expect(h.healer.listHealth()['grok-cli']).toMatchObject({ status: 'auth_error', code: 'cliSignIn' })
    expect(h.reloads).toHaveLength(0)
    signedIn = true
    expect(h.healer.getHealth('grok-cli').status).toBe('healthy')
    expect(h.healer.listHealth()['grok-cli']).toBeUndefined()
  })

  it('a signed-in CLI or another provider is not badged; a failing check never breaks health (negative)', () => {
    const h = harness({ signInRequired: (id) => { if (id === 'kimi-cli') throw new Error('stat failed'); return false } })
    expect(h.healer.getHealth('grok-cli').status).toBe('healthy')
    expect(h.healer.getHealth('kimi-cli').status).toBe('healthy')
    expect(h.healer.getHealth('anthropic').status).toBe('healthy')
  })

  it('a Grok/Kimi auth failure points at the EYAS sign-in, not a host login', async () => {
    const h = harness()
    await h.healer.onProviderError('kimi-cli', { status: 401 })
    const health = h.healer.getHealth('kimi-cli')
    expect(health).toMatchObject({ status: 'auth_error', code: 'cliSignIn' })
    expect(health.message).not.toMatch(/log in on the host/)
    await h.healer.onProviderError('anthropic', { status: 401 })
    expect(h.healer.getHealth('anthropic').code).toBeUndefined()
  })
})
