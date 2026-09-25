// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas doctor` — the Claude Code runtime line: source, path and version from
// the same resolver the provider uses, SDK/CLI version skew, sign-in yes/no.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkClaudeRuntime } from '../../src/cli/commands/doctor.js'
import { getClaudeRuntimeInfo, type ClaudeRuntimeInfo } from '@modules/model/submodules/claude-code/runtime.js'
import { clearExecutableCache } from '@modules/model/cli-runtime/executables.js'

const base: ClaudeRuntimeInfo = {
  ok: true,
  source: 'host',
  path: '/usr/local/bin/claude',
  version: '2.1.89',
  expectedVersion: '2.1.89',
  skew: false,
  warnings: [],
  signedIn: true,
  authMethod: 'claude.ai',
  hostCli: null,
}

const info = (patch: Partial<ClaudeRuntimeInfo>) => async () => ({ ...base, ...patch })

describe('checkClaudeRuntime', () => {
  it('ok: host runtime, matching version, signed in', async () => {
    const r = await checkClaudeRuntime(info({}))
    expect(r).toMatchObject({ name: 'Claude Code runtime', status: 'ok' })
    expect(r.message).toContain('claude on PATH /usr/local/bin/claude')
    expect(r.message).toContain('version 2.1.89')
    expect(r.message).toContain('signed in: yes')
  })

  it('warns on the SDK-bundled last resort', async () => {
    const r = await checkClaudeRuntime(info({ source: 'sdk-bundled', path: '/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js', warnings: ['last resort'] }))
    expect(r.status).toBe('warn')
    expect(r.message).toMatch(/SDK-bundled/)
    expect(r.message).toMatch(/EYAS_CLAUDE_CODE_BIN/)
  })

  it('warns on version skew between the Agent SDK and the CLI', async () => {
    const r = await checkClaudeRuntime(info({ version: '2.1.280', skew: true, warnings: ['claude-code: version skew'] }))
    expect(r.status).toBe('warn')
    expect(r.message).toContain('version 2.1.280')
    expect(r.message).toMatch(/version skew: the Agent SDK was built for 2\.1\.89/)
  })

  it('warns when the runtime is not signed in', async () => {
    const r = await checkClaudeRuntime(info({ signedIn: false }))
    expect(r.status).toBe('warn')
    expect(r.message).toContain('signed in: no')
  })

  it('a host claude shadowed by the override is information only', async () => {
    const r = await checkClaudeRuntime(info({ source: 'override', path: '/opt/claude/claude', hostCli: { path: '/usr/local/bin/claude', version: '2.1.300' } }))
    expect(r.status).toBe('ok')
    expect(r.message).toContain('EYAS_CLAUDE_CODE_BIN /opt/claude/claude')
    expect(r.message).toContain('host claude 2.1.300 at /usr/local/bin/claude is not used by EYAS')
  })

  it('fails on an invalid override and prints the remedy', async () => {
    const r = await checkClaudeRuntime(async () => ({
      ...base, ok: false, source: null, path: null, version: null, signedIn: null,
      error: 'override-invalid', detail: 'EYAS_CLAUDE_CODE_BIN must be an absolute path: claude', remedy: 'Point EYAS_CLAUDE_CODE_BIN at an absolute path',
    }))
    expect(r.status).toBe('fail')
    expect(r.message).toContain('must be an absolute path')
    expect(r.message).toContain('remedy: Point EYAS_CLAUDE_CODE_BIN')
  })

  it('a missing runtime is a warning (the provider is optional)', async () => {
    const r = await checkClaudeRuntime(async () => ({ ...base, ok: false, source: null, path: null, version: null, signedIn: null, error: 'not-found', detail: 'no executable found' }))
    expect(r.status).toBe('warn')
  })

  it('a check that throws degrades to a warning', async () => {
    const r = await checkClaudeRuntime(async () => { throw new Error('boom') })
    expect(r).toMatchObject({ status: 'warn' })
    expect(r.message).toContain('boom')
  })

  it('end to end on the real resolver: an invalid override fails without running anything', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'eyas-doctor-claude-'))
    try {
      clearExecutableCache()
      const r = await checkClaudeRuntime(() => getClaudeRuntimeInfo({
        env: { EYAS_CLAUDE_CODE_BIN: join(tmp, 'missing-claude'), PATH: tmp },
        runner: async () => { throw new Error('must not run') },
      }))
      expect(r.status).toBe('fail')
      expect(r.message).toMatch(/EYAS_CLAUDE_CODE_BIN/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      clearExecutableCache()
    }
  })
})
