// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — Verify now: a loaded provider that can check itself without a turn
// registers its verifier; the panel's POST runs it and reads the status it
// recorded. A provider without one (Claude Code, or a provider not loaded)
// cannot be verified on demand.

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  canVerifyIsolation,
  getIsolationStatus,
  registerIsolationVerifier,
  resetIsolationStatuses,
  setIsolationStatus,
  verifyIsolationNow,
} from '@modules/model/cli-runtime/isolation.js'

afterEach(() => {
  registerIsolationVerifier('grok-cli', null)
  registerIsolationVerifier('kimi-cli', null)
  resetIsolationStatuses()
})

describe('isolation verifier registry', () => {
  it('(+) runs the registered verifier and resolves to the status it recorded', async () => {
    const verify = vi.fn(async () => {
      setIsolationStatus('grok-cli', { status: 'verified', checks: [], runtime: null })
    })
    registerIsolationVerifier('grok-cli', verify)
    expect(canVerifyIsolation('grok-cli')).toBe(true)

    const status = await verifyIsolationNow('grok-cli')
    expect(verify).toHaveBeenCalledTimes(1)
    expect(status).toMatchObject({ status: 'verified', checks: [] })
    expect(status?.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('(+) concurrent requests share one run', async () => {
    let release!: () => void
    const verify = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    registerIsolationVerifier('kimi-cli', verify)
    const a = verifyIsolationNow('kimi-cli')
    const b = verifyIsolationNow('kimi-cli')
    expect(a).toBe(b)
    release()
    await a
    expect(verify).toHaveBeenCalledTimes(1)
    // A later request runs again.
    const c = verifyIsolationNow('kimi-cli')
    release()
    await c
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('(−) a verifier that throws still resolves to the status it left behind', async () => {
    registerIsolationVerifier('grok-cli', async () => {
      setIsolationStatus('grok-cli', { status: 'violation', checks: [{ check: 'hooks', detail: 'a hook' }], runtime: null })
      throw new Error('refused')
    })
    await expect(verifyIsolationNow('grok-cli')).resolves.toMatchObject({ status: 'violation', checks: [{ check: 'hooks' }] })
  })

  it('(−) nothing registered (Claude Code, or a provider not loaded): no run, null', () => {
    expect(canVerifyIsolation('claude-code')).toBe(false)
    expect(verifyIsolationNow('claude-code')).toBeNull()
    expect(getIsolationStatus('claude-code').status).toBe('unverified')
  })

  it('(−) registering null removes the verifier (provider disabled or reloaded)', () => {
    registerIsolationVerifier('grok-cli', async () => {})
    registerIsolationVerifier('grok-cli', null)
    expect(canVerifyIsolation('grok-cli')).toBe(false)
    expect(verifyIsolationNow('grok-cli')).toBeNull()
  })
})
