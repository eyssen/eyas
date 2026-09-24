// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code availability = the resolved runtime is signed in, read with the
// zero-cost `<bin> auth status --json`. No real CLI runs here: binaries are
// temp-dir shell scripts, and most tests inject the command runner.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentSdkFacts, clearExecutableCache, type VersionProbe } from '@modules/model/cli-runtime/executables.js'
import {
  claudeCommand,
  getClaudeRuntimeInfo,
  isClaudeRuntimeUsable,
  parseClaudeAuthStatus,
  readClaudeAuthStatus,
  type ClaudeCommandRunner,
} from '@modules/model/submodules/claude-code/runtime.js'

const IDENTITY = {
  email: 'operator@example.test',
  orgId: '00000000-0000-4000-8000-000000000000',
  orgName: 'Example Org Name',
}

const statusJson = (loggedIn: boolean, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ loggedIn, authMethod: 'claude.ai', apiProvider: 'firstParty', ...IDENTITY, subscriptionType: 'max', ...extra }, null, 2) + '\n'

const runnerReturning = (stdout: string, code = 0, extra: Partial<{ stderr: string; timedOut: boolean }> = {}) =>
  vi.fn<ClaudeCommandRunner>(async () => ({ code, stdout, stderr: extra.stderr ?? '', timedOut: extra.timedOut ?? false }))

const okProbe: VersionProbe = async () => ({ code: 0, stdout: '2.1.280 (Claude Code)', stderr: '' })

let tmp: string
let bin: string

function script(dir: string, name: string, body: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-claude-auth-')))
  bin = join(tmp, 'bin')
  mkdirSync(bin, { recursive: true })
  clearExecutableCache()
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearExecutableCache()
})

describe('parseClaudeAuthStatus', () => {
  it('keeps only loggedIn, authMethod and apiProvider — identity fields are dropped', () => {
    const parsed = parseClaudeAuthStatus(statusJson(true))
    expect(parsed).toEqual({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })
    expect(JSON.stringify(parsed)).not.toContain(IDENTITY.email)
  })

  it('tolerates a malformed optional field and surrounding noise', () => {
    expect(parseClaudeAuthStatus(`note\n{"loggedIn":true,"authMethod":42}\n`)).toEqual({ loggedIn: true })
  })

  it('rejects output that is not the status JSON', () => {
    expect(parseClaudeAuthStatus('Not logged in. Run claude auth login to authenticate.')).toBeNull()
    expect(parseClaudeAuthStatus('{"authMethod":"api_key"}')).toBeNull()
    expect(parseClaudeAuthStatus('{"loggedIn":"yes"}')).toBeNull()
    expect(parseClaudeAuthStatus('{broken')).toBeNull()
  })
})

describe('readClaudeAuthStatus', () => {
  it('signed in: runs `auth status --json` on the runtime path, outside any project, with the allowlisted env', async () => {
    const runner = runnerReturning(statusJson(true))
    const status = await readClaudeAuthStatus(
      { path: '/opt/claude/bin/claude' },
      { runner, env: { PATH: '/usr/bin', HOME: '/home/op', ANTHROPIC_API_KEY: 'sk-ant-x', CLAUDECODE: '1', OPENAI_API_KEY: 'sk-o' } },
    )
    expect(status).toEqual({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })
    const [command, args, opts] = runner.mock.calls[0]
    expect(command).toBe('/opt/claude/bin/claude')
    expect(args).toEqual(['auth', 'status', '--json'])
    expect(opts.cwd).toBe(tmpdir())
    expect(opts.env.HOME).toBe('/home/op')
    expect(opts.env.ANTHROPIC_API_KEY).toBe('sk-ant-x')
    expect(opts.env.CLAUDECODE).toBeUndefined()
    expect(opts.env.OPENAI_API_KEY).toBeUndefined()
    // The same isolated env every query() gets (buildClaudeIsolationEnv).
    expect(opts.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    expect(opts.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe('1')
    expect(opts.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('eyas')
  })

  it('launches the SDK-bundled cli.js through the JS runtime', async () => {
    const runner = runnerReturning(statusJson(true))
    await readClaudeAuthStatus({ path: '/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js' }, { runner })
    const [command, args] = runner.mock.calls[0]
    expect(command).toBe(process.execPath)
    expect(args).toEqual(['/app/node_modules/@anthropic-ai/claude-agent-sdk/cli.js', 'auth', 'status', '--json'])
    expect(claudeCommand('/usr/local/bin/claude')).toEqual({ command: '/usr/local/bin/claude', args: [] })
  })

  it('signed out (exit 1, loggedIn false) is not usable', async () => {
    expect(await readClaudeAuthStatus({ path: '/x/claude' }, { runner: runnerReturning(statusJson(false), 1) })).toMatchObject({ loggedIn: false })
  })

  it('fails closed when the exit code and loggedIn disagree', async () => {
    expect(await readClaudeAuthStatus({ path: '/x/claude' }, { runner: runnerReturning(statusJson(true), 1) })).toMatchObject({ loggedIn: false })
  })

  it('non-JSON output, a spawn failure and a timeout all read as not signed in', async () => {
    expect(await readClaudeAuthStatus({ path: '/x/claude' }, { runner: runnerReturning('error: unknown command auth', 1) }))
      .toEqual({ loggedIn: false, error: 'unparseable' })
    const failing = vi.fn<ClaudeCommandRunner>(async () => { throw Object.assign(new Error('spawn /x/claude ENOENT'), { code: 'ENOENT' }) })
    expect(await readClaudeAuthStatus({ path: '/x/claude' }, { runner: failing })).toEqual({ loggedIn: false, error: 'spawn' })
    expect(await readClaudeAuthStatus({ path: '/x/claude' }, { runner: runnerReturning('', 1, { timedOut: true }) }))
      .toEqual({ loggedIn: false, error: 'timeout' })
  })

  it('never lets the account identity reach the logger', async () => {
    const logger = { warn: vi.fn() }
    const cases: ClaudeCommandRunner[] = [
      runnerReturning(statusJson(true)),
      runnerReturning(statusJson(false), 1, { stderr: IDENTITY.email }),
      runnerReturning(statusJson(true), 1),
      runnerReturning(`${IDENTITY.orgName} not json`, 1, { stderr: IDENTITY.email }),
      runnerReturning('', 1, { timedOut: true, stderr: IDENTITY.email }),
      async () => { throw Object.assign(new Error(`EACCES ${IDENTITY.email}`), { code: 'EACCES' }) },
    ]
    for (const runner of cases) await readClaudeAuthStatus({ path: '/x/claude' }, { runner, logger })
    const logged = JSON.stringify(logger.warn.mock.calls)
    for (const value of Object.values(IDENTITY)) expect(logged).not.toContain(value)
  })

  it('works end to end with the real runner on a stub binary', async () => {
    const signedIn = script(bin, 'claude-in', `echo '${statusJson(true).trim()}'`)
    const signedOut = script(bin, 'claude-out', `echo '{"loggedIn":false,"authMethod":"none"}'; exit 1`)
    expect(await readClaudeAuthStatus({ path: signedIn })).toMatchObject({ loggedIn: true, authMethod: 'claude.ai' })
    expect(await readClaudeAuthStatus({ path: signedOut })).toMatchObject({ loggedIn: false })
    expect(await readClaudeAuthStatus({ path: join(tmp, 'missing', 'claude') })).toEqual({ loggedIn: false, error: 'spawn' })
  })
})

describe('isClaudeRuntimeUsable', () => {
  it('true only when the runtime resolves and is signed in', async () => {
    const path = script(join(tmp, 'opt'), 'claude', 'exit 0')
    const env = { EYAS_CLAUDE_CODE_BIN: path, PATH: bin }
    expect(await isClaudeRuntimeUsable({ env, probe: okProbe, runner: runnerReturning(statusJson(true)) })).toBe(true)
    expect(await isClaudeRuntimeUsable({ env, probe: okProbe, runner: runnerReturning(statusJson(false), 1) })).toBe(false)
  })

  it('an invalid override is unusable without running anything', async () => {
    script(bin, 'claude', 'exit 0') // PATH presence alone never counts
    const runner = runnerReturning(statusJson(true))
    const probe = vi.fn(okProbe)
    expect(await isClaudeRuntimeUsable({ env: { EYAS_CLAUDE_CODE_BIN: 'relative/claude', PATH: bin }, probe, runner })).toBe(false)
    expect(runner).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('getClaudeRuntimeInfo', () => {
  it('override: reports source, version, skew, sign-in and the host claude it shadows', async () => {
    const override = script(join(tmp, 'opt'), 'claude', 'exit 0')
    const host = script(bin, 'claude', 'exit 0')
    const info = await getClaudeRuntimeInfo({ env: { EYAS_CLAUDE_CODE_BIN: override, PATH: bin }, probe: okProbe, runner: runnerReturning(statusJson(true)) })
    expect(info).toMatchObject({
      ok: true,
      source: 'override',
      path: override,
      version: '2.1.280',
      expectedVersion: agentSdkFacts()!.claudeCodeVersion,
      signedIn: true,
      authMethod: 'claude.ai',
      hostCli: { path: host, version: '2.1.280' },
    })
    expect(info.skew).toBe(agentSdkFacts()!.claudeCodeVersion !== '2.1.280')
    expect(JSON.stringify(info)).not.toContain(IDENTITY.email)
  })

  it('host runtime: no shadowed host CLI, and checkAuth:false runs no sign-in check', async () => {
    const host = script(bin, 'claude', 'exit 0')
    const runner = runnerReturning(statusJson(true))
    const info = await getClaudeRuntimeInfo({ env: { PATH: bin }, probe: okProbe, runner, checkAuth: false })
    expect(info).toMatchObject({ ok: true, source: 'host', path: host, hostCli: null, signedIn: null })
    expect(runner).not.toHaveBeenCalled()
  })

  it('SDK-bundled last resort: a warning, no skew', async () => {
    const info = await getClaudeRuntimeInfo({ env: { PATH: bin }, probe: okProbe, runner: runnerReturning(statusJson(false), 1) })
    expect(info).toMatchObject({ ok: true, source: 'sdk-bundled', skew: false, signedIn: false, hostCli: null })
    expect(info.warnings.join(' ')).toMatch(/last resort/)
  })

  it('an invalid override: not ok, with the remedy, and no sign-in check', async () => {
    const runner = runnerReturning(statusJson(true))
    const info = await getClaudeRuntimeInfo({ env: { EYAS_CLAUDE_CODE_BIN: join(tmp, 'missing'), PATH: bin }, runner })
    expect(info).toMatchObject({ ok: false, error: 'override-invalid', source: null, path: null, signedIn: null, expectedVersion: agentSdkFacts()!.claudeCodeVersion })
    expect(info.remedy).toMatch(/EYAS_CLAUDE_CODE_BIN/)
    expect(runner).not.toHaveBeenCalled()
  })
})
