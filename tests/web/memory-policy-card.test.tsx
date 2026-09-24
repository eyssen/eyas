// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B13 — the Security page's 'Memory outside EYAS' card: the protected
// stores present on this server, detected vaults, the owner's extra paths
// (ignored ones flagged), EYAS's own data and workspaces, the kernel sandbox
// of each switched-on CLI provider, and the 24-hour refusal counts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, api: { get: h.get } }
})

import { MemoryPolicyCard, type MemoryPolicyResponse } from '@/pages/security/memory-policy-card'
import { ApiError } from '@/lib/api'
import { useLanguageStore } from '@/stores/language-store'
import en from '@/pages/security/locales/en.json'
import hu from '@/pages/security/locales/hu.json'

const E = en as Record<string, string>
const H = hu as Record<string, string>

function report(overrides: Partial<{ sandbox: MemoryPolicyResponse['sandbox']; refusals: Partial<MemoryPolicyResponse['refusals']> }> = {}): MemoryPolicyResponse {
  return {
    policy: {
      dataDir: '/srv/eyas/data',
      databasePath: '/srv/eyas/data/eyas.db',
      workspacesRoot: '/srv/eyas/workspaces',
      providerHomes: ['/srv/eyas/data/cli-homes'],
      foreignStores: [
        { id: 'claude', label: 'Claude Code', paths: ['/home/op/.claude'], present: true },
        { id: 'agents', label: 'shared agent skills', paths: ['/home/op/.agents'], present: true },
        { id: 'codex', label: 'Codex CLI', paths: ['/home/op/.codex'], present: false },
        { id: 'gemini', label: 'Gemini CLI', paths: ['/home/op/.gemini'], present: false },
      ],
      foreignMemoryPaths: [
        { path: '/home/op/journal', present: true },
        { path: '/mnt/archive', present: false },
      ],
      ignoredForeignMemoryPaths: ['relative/notes'],
      detectedVaults: [
        { path: '/home/op/notes', source: 'registry' },
        { path: '/data/team-vault', source: 'marker' },
      ],
    },
    sandbox: overrides.sandbox ?? {
      mode: 'auto',
      providers: [
        { id: 'claude-code', name: 'Claude Code CLI', fileSandbox: { status: 'active', reason: 'linux-bwrap', mode: 'auto' } },
        { id: 'kimi-cli', name: 'Kimi Code CLI', fileSandbox: { status: 'unsupported', reason: 'cli-has-none', mode: 'auto' } },
      ],
    },
    refusals: { windowHours: 24, memoryPathDenials: 7, unsandboxedEscalations: 2, ...overrides.refusals },
  }
}

describe('MemoryPolicyCard', () => {
  beforeEach(() => {
    h.get.mockReset()
    useLanguageStore.getState().setLang('en')
  })
  afterEach(() => {
    cleanup()
    useLanguageStore.getState().setLang('en')
  })

  it('shows the present stores, vaults, extra paths, EYAS data, workspaces and counts', async () => {
    h.get.mockResolvedValue(report())
    render(<MemoryPolicyCard />)
    await screen.findByText('/home/op/.claude')
    expect(h.get).toHaveBeenCalledWith('/security/memory-policy')

    expect(screen.getByText(E['security.memoryPolicy.title'])).toBeTruthy()
    // Present stores only; a non-brand label is localized.
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText(E['security.memoryPolicy.store.agents'])).toBeTruthy()
    expect(screen.queryByText('/home/op/.codex')).toBeNull()
    expect(screen.getByText(E['security.memoryPolicy.foreignStoresAbsent'].replace('{{count}}', '2'))).toBeTruthy()

    expect(screen.getByText('/home/op/notes')).toBeTruthy()
    expect(screen.getByText(`— ${E['security.memoryPolicy.vaultSourceRegistry']}`, { exact: false })).toBeTruthy()
    expect(screen.getByText(`— ${E['security.memoryPolicy.vaultSourceMarker']}`, { exact: false })).toBeTruthy()

    expect(screen.getByText('/home/op/journal')).toBeTruthy()
    expect(screen.getByText(`— ${E['security.memoryPolicy.notPresent']}`, { exact: false })).toBeTruthy()
    expect(screen.getByText('relative/notes')).toBeTruthy()
    expect(screen.getByText(`— ${E['security.memoryPolicy.extraPathIgnored']}`, { exact: false })).toBeTruthy()

    expect(screen.getByText('/srv/eyas/data')).toBeTruthy()
    expect(screen.getByText('/srv/eyas/workspaces')).toBeTruthy()

    expect(screen.getByTestId('memory-policy-denials').textContent).toContain('7')
    expect(screen.getByTestId('memory-policy-escalations').textContent).toContain('2')
  })

  it('shows each switched-on CLI with its sandbox status, reason and the auto-mode approval hint', async () => {
    h.get.mockResolvedValue(report())
    render(<MemoryPolicyCard />)
    const rows = await screen.findAllByTestId('memory-policy-sandbox')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Claude Code CLI')
    expect(rows[0].textContent).toContain(E['security.memoryPolicy.sandboxActive'])
    expect(rows[1].textContent).toContain(E['security.memoryPolicy.sandboxUnsupported'])
    expect(rows[1].textContent).toContain(E['security.memoryPolicy.sandboxReason.cli'])
    expect(rows[1].textContent).toContain(E['security.memoryPolicy.sandboxUnavailableHint'])
    expect(screen.getByText(E['security.memoryPolicy.sandboxAutoHint'])).toBeTruthy()
    expect(screen.queryByText(E['security.memoryPolicy.sandboxRequiredBlocked'])).toBeNull()
  })

  it("'required' without a sandbox says turns with tools are refused; a failed detection is never shown as active", async () => {
    h.get.mockResolvedValue(report({
      sandbox: {
        mode: 'required',
        providers: [
          { id: 'grok-cli', name: 'Grok CLI', fileSandbox: { status: 'unavailable', reason: 'no-bwrap', mode: 'required' } },
          { id: 'claude-code', name: 'Claude Code CLI', fileSandbox: null },
        ],
      },
    }))
    render(<MemoryPolicyCard />)
    const rows = await screen.findAllByTestId('memory-policy-sandbox')
    expect(rows[0].textContent).toContain(E['security.memoryPolicy.sandboxReason.noBwrap'])
    expect(rows[0].textContent).toContain(E['security.memoryPolicy.sandboxRequiredBlocked'])
    expect(rows[1].textContent).toContain(E['security.memoryPolicy.sandboxUnavailable'])
    expect(rows[1].textContent).not.toContain(E['security.memoryPolicy.sandboxActive'])
    // No active Claude Code sandbox: no approval hint.
    expect(screen.queryByText(E['security.memoryPolicy.sandboxAutoHint'])).toBeNull()
  })

  it('negative: no CLI switched on and nothing refused', async () => {
    h.get.mockResolvedValue(report({ sandbox: { mode: 'auto', providers: [] }, refusals: { memoryPathDenials: 0, unsandboxedEscalations: 0 } }))
    render(<MemoryPolicyCard />)
    await screen.findByText(E['security.memoryPolicy.sandboxNoCli'])
    expect(screen.queryAllByTestId('memory-policy-sandbox')).toHaveLength(0)
    expect(screen.getByTestId('memory-policy-denials').textContent).toContain('0')
  })

  it('negative: a refused request (403) shows the load error, never paths', async () => {
    h.get.mockRejectedValue(new ApiError(403, 'Forbidden: cannot read SecurityEvent'))
    render(<MemoryPolicyCard />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Forbidden')
    expect(screen.queryByText('/srv/eyas/data')).toBeNull()
  })

  it('renders in Hungarian', async () => {
    useLanguageStore.getState().setLang('hu')
    h.get.mockResolvedValue(report())
    render(<MemoryPolicyCard />)
    await screen.findByText(H['security.memoryPolicy.title'])
    expect(screen.getByText(H['security.memoryPolicy.foreignStores'])).toBeTruthy()
    expect(H['security.memoryPolicy.title']).not.toBe(E['security.memoryPolicy.title'])
  })
})
