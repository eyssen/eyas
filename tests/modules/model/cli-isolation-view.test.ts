// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — what the provider panel is told about a CLI provider: the binary EYAS
// runs, its sign-in, the recorded isolation status and what the live lane
// proved. The panel may claim nothing the resolver and the store do not say.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { describeCliIsolation, isIsolationCliId } from '@modules/model/cli-isolation-view.js'
import { registerIsolationVerifier, resetIsolationStatuses, setIsolationStatus } from '@modules/model/cli-runtime/isolation.js'
import type { ExecutableResolution } from '@modules/model/cli-runtime/executables.js'
import type { CliVerifiedVersion, IsolationCliId } from '@modules/model/cli-runtime/verified-versions.js'

const VERIFIED: Record<IsolationCliId, CliVerifiedVersion> = {
  'claude-code': { version: '2.1.281', verifiedAt: '2026-09-24', paidCanary: false },
  'grok-cli': { version: '1.0.41', verifiedAt: '2026-09-24', paidCanary: false },
  'kimi-cli': { version: null, verifiedAt: null, paidCanary: false },
}

function found(id: IsolationCliId, over: Partial<Extract<ExecutableResolution, { ok: true }>> = {}): ExecutableResolution {
  return { ok: true, id, path: `/usr/bin/${id}`, version: '1.0.41', source: 'host', expectedVersion: null, warnings: [], ...over }
}

afterEach(() => {
  registerIsolationVerifier('grok-cli', null)
  registerIsolationVerifier('kimi-cli', null)
  resetIsolationStatuses()
})

describe('isIsolationCliId', () => {
  it('(+) the three CLI providers; (−) anything else', () => {
    for (const id of ['claude-code', 'grok-cli', 'kimi-cli']) expect(isIsolationCliId(id)).toBe(true)
    for (const id of ['anthropic', 'opencode', 'claude-code-sdk', '']) expect(isIsolationCliId(id)).toBe(false)
  })
})

describe('describeCliIsolation', () => {
  it('(+) Grok: the host runtime, the EYAS sign-in, the recorded status and a matching proof', async () => {
    setIsolationStatus('grok-cli', { status: 'verified', checks: [], runtime: null, checkedAt: '2026-09-24T08:00:00.000Z' })
    registerIsolationVerifier('grok-cli', async () => {})
    const isSignedIn = vi.fn(() => true)
    const view = await describeCliIsolation('grok-cli', {
      resolve: async (id) => found(id),
      hostCli: async () => null,
      cliSignIn: { isSignedIn },
      verified: VERIFIED,
    })
    expect(view).toEqual({
      providerId: 'grok-cli',
      status: 'verified',
      checks: [],
      checkedAt: '2026-09-24T08:00:00.000Z',
      runtime: { available: true, path: '/usr/bin/grok-cli', version: '1.0.41', source: 'host', expectedVersion: null, skew: false },
      hostCli: null,
      signedIn: true,
      proof: { version: '1.0.41', verifiedAt: '2026-09-24', paidCanary: false, drift: 'match' },
      canVerify: true,
    })
    expect(isSignedIn).toHaveBeenCalledWith('grok-cli')
  })

  it('(+) Kimi with no live proof reads as never verified and unverified until a check ran', async () => {
    const view = await describeCliIsolation('kimi-cli', {
      resolve: async (id) => found(id, { version: '1.52.0' }),
      hostCli: async () => null,
      cliSignIn: { isSignedIn: () => false },
      verified: VERIFIED,
    })
    expect(view).toMatchObject({ status: 'unverified', checkedAt: null, signedIn: false, canVerify: false })
    expect(view.proof).toEqual({ version: null, verifiedAt: null, paidCanary: false, drift: 'never-verified' })
  })

  it('(+) Claude Code: an override with version skew, the shadowed host CLI and its own sign-in', async () => {
    const claudeSignedIn = vi.fn(async () => false)
    const view = await describeCliIsolation('claude-code', {
      resolve: async (id) => found(id, { source: 'override', path: '/opt/claude', version: '2.1.290', expectedVersion: '2.1.89' }),
      hostCli: async () => ({ path: '/usr/local/bin/claude', version: '2.1.281' }),
      claudeSignedIn,
      verified: VERIFIED,
    })
    expect(view.runtime).toEqual({ available: true, path: '/opt/claude', version: '2.1.290', source: 'override', expectedVersion: '2.1.89', skew: true })
    expect(view.hostCli).toEqual({ path: '/usr/local/bin/claude', version: '2.1.281' })
    expect(view.signedIn).toBe(false)
    expect(view.proof.drift).toBe('drift')
    // Claude Code is checked only by a real turn: never on demand.
    expect(view.canVerify).toBe(false)
    expect(claudeSignedIn).toHaveBeenCalledTimes(1)
  })

  it('(+) a recorded violation carries its failed checks', async () => {
    setIsolationStatus('grok-cli', { status: 'violation', checks: [{ check: 'mcpServers', detail: 'vault' }], runtime: null })
    const view = await describeCliIsolation('grok-cli', { resolve: async (id) => found(id), hostCli: async () => null, verified: VERIFIED })
    expect(view).toMatchObject({ status: 'violation', checks: [{ check: 'mcpServers', detail: 'vault' }] })
  })

  it('(−) an invalid override: no runtime, no proof comparison, no sign-in read', async () => {
    const claudeSignedIn = vi.fn(async () => true)
    const view = await describeCliIsolation('claude-code', {
      resolve: async (id) => ({ ok: false, id, error: 'override-invalid', detail: 'EYAS_CLAUDE_CODE_BIN must be an absolute path: x' }),
      claudeSignedIn,
      verified: VERIFIED,
    })
    expect(view.runtime).toEqual({ available: false, error: 'override-invalid' })
    expect(view.proof.drift).toBeNull()
    expect(view.signedIn).toBeNull()
    expect(view.hostCli).toBeNull()
    expect(claudeSignedIn).not.toHaveBeenCalled()
    // The raw detail (which names the operator's path) is not part of the view.
    expect(JSON.stringify(view)).not.toContain('absolute path')
  })

  it('(−) a sign-in or host lookup that fails reads as unknown, never as signed in', async () => {
    const view = await describeCliIsolation('claude-code', {
      resolve: async (id) => found(id),
      hostCli: async () => { throw new Error('probe failed') },
      claudeSignedIn: async () => { throw new Error('spawn failed') },
      verified: VERIFIED,
    })
    expect(view.signedIn).toBeNull()
    expect(view.hostCli).toBeNull()
  })

  it('(−) Grok without a sign-in service reports null, and an unreadable version is unknown-version', async () => {
    const view = await describeCliIsolation('grok-cli', {
      resolve: async (id) => found(id, { version: null }),
      hostCli: async () => null,
      verified: VERIFIED,
    })
    expect(view.signedIn).toBeNull()
    expect(view.proof.drift).toBe('unknown-version')
  })
})
