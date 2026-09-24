// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — `eyas doctor` reports the kernel file sandbox of every installed CLI
// provider under security.cliSandbox: active, unavailable with the reason and
// the remedy, or none (Kimi). A missing sandbox is a warning, never a failure.

import { describe, expect, it } from 'vitest'
import { checkCliSandbox } from '../../src/cli/commands/doctor.js'
import type { FileSandboxInfo, SandboxCli } from '../../src/modules/model/cli-runtime/sandbox/types.js'

const installed = (ids: SandboxCli[]) => async (cli: SandboxCli) => ids.includes(cli)
const describeAs = (map: Partial<Record<SandboxCli, Omit<FileSandboxInfo, 'mode'>>>) =>
  async (cli: SandboxCli, mode: 'auto' | 'required'): Promise<FileSandboxInfo> => ({ ...(map[cli] ?? { status: 'unsupported', reason: 'cli-has-none' }), mode })

describe('doctor — CLI sandbox', () => {
  it('ok when every installed CLI runs sandboxed (auto by default)', async () => {
    const r = await checkCliSandbox(undefined, {
      installed: installed(['claude-code', 'grok-cli']),
      describe: describeAs({ 'claude-code': { status: 'active', reason: 'linux-bwrap' }, 'grok-cli': { status: 'active', reason: 'linux-bwrap' } }),
    })
    expect(r).toMatchObject({ name: 'CLI sandbox', status: 'ok' })
    expect(r.message).toBe('mode auto; Claude Code: active (linux-bwrap); Grok CLI: active (linux-bwrap)')
  })

  it('warns with the reason and the remedy when one is missing', async () => {
    const r = await checkCliSandbox('auto', {
      installed: installed(['claude-code', 'grok-cli']),
      describe: describeAs({ 'claude-code': { status: 'unavailable', reason: 'no-socat' }, 'grok-cli': { status: 'unavailable', reason: 'no-bwrap' } }),
    })
    expect(r.status).toBe('warn')
    expect(r.message).toContain('Claude Code: unavailable (no-socat) — runs without it; remedy: install socat')
    expect(r.message).toContain('Grok CLI: unavailable (no-bwrap) — runs without it; remedy: install bubblewrap')
  })

  it("under 'required' says the turns are refused; Kimi (none) is only a warning there", async () => {
    const r = await checkCliSandbox('required', {
      installed: installed(['grok-cli', 'kimi-cli']),
      describe: describeAs({ 'grok-cli': { status: 'unavailable', reason: 'bwrap-unusable' } }),
    })
    expect(r.status).toBe('warn')
    expect(r.message).toMatch(/^mode required; /)
    expect(r.message).toContain('Grok CLI: unavailable (bwrap-unusable) — turns with tools are refused; remedy: allow unprivileged user namespaces')
    expect(r.message).toContain('Kimi Code CLI: none — the CLI has no kernel sandbox; its turns with tools are refused')
  })

  it("Kimi without a sandbox under 'auto' is informational, not a warning", async () => {
    const r = await checkCliSandbox('auto', { installed: installed(['kimi-cli']), describe: describeAs({}) })
    expect(r).toMatchObject({ status: 'ok', message: 'mode auto; Kimi Code CLI: none — the CLI has no kernel sandbox' })
  })

  it('negative: no installed CLI is ok; an unknown mode is reported as required (fail closed); a throw is a warning', async () => {
    expect(await checkCliSandbox('auto', { installed: installed([]), describe: describeAs({}) }))
      .toMatchObject({ status: 'ok', message: 'mode auto; no CLI provider installed' })
    const odd = await checkCliSandbox('off', { installed: installed(['grok-cli']), describe: describeAs({ 'grok-cli': { status: 'active', reason: 'darwin-seatbelt' } }) })
    expect(odd.message).toMatch(/^mode required; /)
    const broken = await checkCliSandbox('auto', { installed: async () => { throw new Error('boom') } })
    expect(broken).toMatchObject({ status: 'warn', message: 'could not be checked — boom' })
  })
})
