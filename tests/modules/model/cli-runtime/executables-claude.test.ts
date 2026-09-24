// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The claude-code row of the executable policy (Gate 0 option b): the Agent
// SDK stays pinned and EYAS runs the operator's Claude Code —
// EYAS_CLAUDE_CODE_BIN → `claude` on PATH → the SDK-bundled cli.js as a last
// resort. No real CLI is run: binaries are temp-dir scripts and the version
// probe is faked unless a test says otherwise.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  agentSdkFacts,
  clearExecutableCache,
  getExecutablePolicy,
  resolveCliExecutable,
  type VersionProbe,
} from '@modules/model/cli-runtime/executables.js'

const SDK_PKG = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf-8')) as {
  version: string
  claudeCodeVersion: string
}

let tmp: string
let bin: string

function fakeClaude(dir: string, version = '2.1.280', executable = true, name = 'claude'): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\necho "${version} (Claude Code)"\n`)
  chmodSync(path, executable ? 0o755 : 0o644)
  return path
}

const probeReturning = (version: string) => vi.fn<VersionProbe>(async () => ({ code: 0, stdout: `${version} (Claude Code)\n`, stderr: '' }))

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-claude-exe-')))
  bin = join(tmp, 'bin')
  mkdirSync(bin, { recursive: true })
  clearExecutableCache()
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearExecutableCache()
})

describe('agentSdkFacts', () => {
  it('finds the installed Agent SDK, its bundled cli.js and the Claude Code version it was built for', () => {
    const facts = agentSdkFacts()
    expect(facts).not.toBeNull()
    expect(facts!.cliPath.endsWith(join('@anthropic-ai', 'claude-agent-sdk', 'cli.js'))).toBe(true)
    expect(existsSync(facts!.cliPath)).toBe(true)
    expect(facts!.sdkVersion).toBe(SDK_PKG.version)
    expect(facts!.claudeCodeVersion).toBe(SDK_PKG.claudeCodeVersion)
  })
})

describe('claude-code executable policy', () => {
  it('is registered with EYAS_CLAUDE_CODE_BIN, `claude` on PATH and the SDK-bundled last resort', () => {
    const policy = getExecutablePolicy('claude-code')!
    expect(policy.overrideEnv).toBe('EYAS_CLAUDE_CODE_BIN')
    expect(policy.hostNames).toEqual(['claude'])
    expect(policy.bundled?.()).toBe(agentSdkFacts()!.cliPath)
    expect(policy.expectedVersion?.()).toBe(SDK_PKG.claudeCodeVersion)
    expect(policy.remedy).toMatch(/EYAS_CLAUDE_CODE_BIN/)
  })

  it('uses a valid override; a matching version gives no warning', async () => {
    const path = fakeClaude(join(tmp, 'opt'))
    fakeClaude(bin) // a PATH claude never wins over the override
    const r = await resolveCliExecutable('claude-code', {
      env: { EYAS_CLAUDE_CODE_BIN: path, PATH: bin },
      probe: probeReturning(SDK_PKG.claudeCodeVersion),
    })
    expect(r).toMatchObject({ ok: true, path, source: 'override', version: SDK_PKG.claudeCodeVersion, expectedVersion: SDK_PKG.claudeCodeVersion, warnings: [] })
  })

  it('runs the real `--version` probe on the resolved binary', async () => {
    const path = fakeClaude(join(tmp, 'opt'), '2.1.280')
    const r = await resolveCliExecutable('claude-code', { env: { EYAS_CLAUDE_CODE_BIN: path, PATH: '' } })
    expect(r).toMatchObject({ ok: true, version: '2.1.280' })
  })

  it('flags version skew when the binary differs from the SDK\'s claudeCodeVersion', async () => {
    const path = fakeClaude(bin, '999.0.0')
    const r = await resolveCliExecutable('claude-code', { env: { PATH: bin }, probe: probeReturning('999.0.0') })
    expect(r).toMatchObject({ ok: true, path, source: 'host', version: '999.0.0', expectedVersion: SDK_PKG.claudeCodeVersion })
    if (!r.ok) throw new Error('expected a resolution')
    expect(r.warnings.join(' ')).toMatch(/version skew/)
    expect(r.warnings.join(' ')).toContain(SDK_PKG.claudeCodeVersion)
  })

  it('an unreadable version is not reported as skew', async () => {
    fakeClaude(bin)
    const probe = vi.fn<VersionProbe>(async () => ({ code: 1, stdout: '', stderr: 'boom' }))
    const r = await resolveCliExecutable('claude-code', { env: { PATH: bin }, probe })
    expect(r).toMatchObject({ ok: true, version: null, warnings: [] })
  })

  it('prefers `claude` on PATH over the bundled cli.js', async () => {
    const path = fakeClaude(bin)
    const r = await resolveCliExecutable('claude-code', { env: { PATH: bin }, probe: probeReturning('2.1.280') })
    expect(r).toMatchObject({ ok: true, path, source: 'host' })
  })

  it('falls back to the SDK-bundled cli.js last, with a warning, without running it', async () => {
    const probe = probeReturning('9.9.9')
    const r = await resolveCliExecutable('claude-code', { env: { PATH: bin }, probe })
    expect(r).toMatchObject({
      ok: true,
      path: agentSdkFacts()!.cliPath,
      source: 'sdk-bundled',
      version: SDK_PKG.claudeCodeVersion,
      expectedVersion: SDK_PKG.claudeCodeVersion,
    })
    if (r.ok) {
      expect(r.warnings.join(' ')).toMatch(/last resort/)
      expect(r.warnings.join(' ')).not.toMatch(/version skew/)
    }
    expect(probe).not.toHaveBeenCalled()
  })

  it('an invalid override fails closed: no PATH or bundled fallback, no probe', async () => {
    fakeClaude(bin)
    const nonExec = fakeClaude(join(tmp, 'noexec'), '2.1.280', false)
    for (const bad of ['relative/claude', join(tmp, 'missing', 'claude'), nonExec, tmp]) {
      clearExecutableCache()
      const probe = probeReturning('2.1.280')
      const r = await resolveCliExecutable('claude-code', { env: { EYAS_CLAUDE_CODE_BIN: bad, PATH: bin }, probe })
      expect(r, bad).toMatchObject({ ok: false, error: 'override-invalid' })
      if (!r.ok) expect(r.remedy).toMatch(/EYAS_CLAUDE_CODE_BIN/)
      expect(probe).not.toHaveBeenCalled()
    }
  })

  it('probes the version with the claude-code env allowlist only', async () => {
    fakeClaude(bin)
    const probe = probeReturning('2.1.280')
    await resolveCliExecutable('claude-code', {
      env: { PATH: bin, HOME: '/home/op', ANTHROPIC_API_KEY: 'sk-ant-x', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/elsewhere', OPENAI_API_KEY: 'sk-o' },
      probe,
    })
    const env = probe.mock.calls[0][2]
    expect(env.HOME).toBe('/home/op')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-x')
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })
})
