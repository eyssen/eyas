// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import {
  clearExecutableCache,
  findOnPath,
  getExecutablePolicy,
  parseVersion,
  registerExecutablePolicy,
  resolveCliExecutable,
  type VersionProbe,
} from '@modules/model/cli-runtime/executables.js'

let tmp: string
let bin: string

function fakeCli(dir: string, name: string, version = '1.0.40', executable = true): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, `#!/bin/sh\necho "${name} ${version}"\n`)
  chmodSync(path, executable ? 0o755 : 0o644)
  return path
}

const okProbe = (version: string): VersionProbe => vi.fn(async () => ({ code: 0, stdout: `x ${version}\n`, stderr: '' }))

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-exe-')))
  bin = join(tmp, 'bin')
  clearExecutableCache()
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearExecutableCache()
})

describe('resolveCliExecutable — sources', () => {
  it('uses a valid override and reads its version', async () => {
    const path = fakeCli(join(tmp, 'opt'), 'grok', '1.0.40')
    const r = await resolveCliExecutable('grok-cli', { env: { EYAS_GROK_BIN: path, PATH: '' }, probe: okProbe('1.0.40') })
    expect(r).toMatchObject({ ok: true, path, source: 'override', version: '1.0.40', warnings: [] })
  })

  it('runs the real version probe with the allowlisted env', async () => {
    const path = fakeCli(join(tmp, 'opt'), 'kimi', '1.52.0')
    const r = await resolveCliExecutable('kimi-cli', { env: { EYAS_KIMI_BIN: path } })
    expect(r).toMatchObject({ ok: true, version: '1.52.0', source: 'override' })
  })

  it('an invalid override fails closed with no fallback, even when PATH has the binary', async () => {
    fakeCli(bin, 'grok')
    const nonExec = fakeCli(join(tmp, 'opt'), 'grok-noexec', '1.0.0', false)
    for (const bad of ['relative/grok', join(tmp, 'missing', 'grok'), nonExec, tmp]) {
      clearExecutableCache()
      const r = await resolveCliExecutable('grok-cli', { env: { EYAS_GROK_BIN: bad, PATH: bin }, probe: okProbe('1.0.40') })
      expect(r, bad).toMatchObject({ ok: false, error: 'override-invalid' })
      if (!r.ok) expect(r.remedy).toMatch(/EYAS_GROK_BIN/)
    }
  })

  it('an empty override is treated as unset', async () => {
    const path = fakeCli(bin, 'grok')
    const r = await resolveCliExecutable('grok-cli', { env: { EYAS_GROK_BIN: '  ', PATH: bin }, probe: okProbe('1.0.40') })
    expect(r).toMatchObject({ ok: true, path, source: 'host' })
  })

  it('finds the host binary on PATH', async () => {
    const path = fakeCli(bin, 'opencode', '1.2.3')
    const r = await resolveCliExecutable('opencode', { env: { PATH: ['/nonexistent', bin].join(delimiter) }, probe: okProbe('1.2.3') })
    expect(r).toMatchObject({ ok: true, path, source: 'host', version: '1.2.3' })
  })

  it('reports not-found with a remedy when nothing resolves', async () => {
    const r = await resolveCliExecutable('kimi-cli', { env: { PATH: bin }, probe: okProbe('x') })
    expect(r).toMatchObject({ ok: false, error: 'not-found' })
    if (!r.ok) expect(r.remedy).toMatch(/EYAS_KIMI_BIN/)
  })

  it('keeps a found binary whose version probe failed, with version null', async () => {
    const path = fakeCli(bin, 'grok')
    const probe: VersionProbe = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'boom' }))
    const r = await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe })
    expect(r).toMatchObject({ ok: true, path, version: null })
  })

  it('never hands the version probe provider keys from the host env', async () => {
    fakeCli(bin, 'grok')
    const probe = vi.fn<VersionProbe>(async () => ({ code: 0, stdout: '1.0.40', stderr: '' }))
    await resolveCliExecutable('grok-cli', { env: { PATH: bin, XAI_API_KEY: 'xai-secret', GROK_MEMORY: '1' }, probe })
    const env = probe.mock.calls[0][2]
    expect(env.PATH).toBe(bin)
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.GROK_MEMORY).toBeUndefined()
    expect(env.GIT_CEILING_DIRECTORIES).toBeDefined()
  })
})

describe('resolveCliExecutable — policy table', () => {
  afterEach(() => {
    // Restore the shipped grok row after the registration tests.
    registerExecutablePolicy({ id: 'grok-cli', overrideEnv: 'EYAS_GROK_BIN', hostNames: ['grok'], remedy: 'Install the Grok CLI, or set EYAS_GROK_BIN to the absolute path of the grok executable.' })
  })

  it('has a row for every CLI provider (claude-code covered in executables-claude.test.ts)', () => {
    expect(getExecutablePolicy('claude-code')?.overrideEnv).toBe('EYAS_CLAUDE_CODE_BIN')
    expect(getExecutablePolicy('grok-cli')?.overrideEnv).toBe('EYAS_GROK_BIN')
    expect(getExecutablePolicy('kimi-cli')?.overrideEnv).toBe('EYAS_KIMI_BIN')
    expect(getExecutablePolicy('opencode')?.overrideEnv).toBe('EYAS_OPENCODE_BIN')
  })

  it('falls back to a bundled entry point last, with a doctor warning, without running it', async () => {
    // A bundled JS entry point is launched through the runtime: it need not be executable.
    const bundled = fakeCli(join(tmp, 'node_modules', 'sdk'), 'cli.js', '2.1.89', false)
    registerExecutablePolicy({ id: 'grok-cli', overrideEnv: 'EYAS_GROK_BIN', hostNames: ['grok'], bundled: () => bundled, bundledVersion: () => '2.1.89', remedy: 'Install it.' })
    const probe = okProbe('9.9.9')
    const r = await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe })
    expect(r).toMatchObject({ ok: true, path: bundled, source: 'sdk-bundled', version: '2.1.89' })
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/last resort/)
    expect(probe).not.toHaveBeenCalled()
  })

  it('reports not-found when the bundled entry point is missing too', async () => {
    registerExecutablePolicy({ id: 'grok-cli', hostNames: ['grok'], bundled: () => join(tmp, 'gone', 'cli.js'), remedy: 'x' })
    const r = await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe: okProbe('1') })
    expect(r).toMatchObject({ ok: false, error: 'not-found' })
  })

  it('prefers the host binary over the bundled one', async () => {
    const host = fakeCli(bin, 'grok')
    const bundled = fakeCli(join(tmp, 'node_modules', 'sdk'), 'cli.js')
    registerExecutablePolicy({ id: 'grok-cli', hostNames: ['grok'], bundled: () => bundled, remedy: 'x' })
    const r = await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe: okProbe('1') })
    expect(r).toMatchObject({ ok: true, path: host, source: 'host' })
  })

  it('a row with no host names never consults PATH', async () => {
    fakeCli(bin, 'grok')
    registerExecutablePolicy({ id: 'grok-cli', hostNames: [], remedy: 'x' })
    const r = await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe: okProbe('1') })
    expect(r).toMatchObject({ ok: false, error: 'not-found' })
  })
})

describe('resolveCliExecutable — cache', () => {
  it('probes a found binary once per configuration; refresh probes again', async () => {
    fakeCli(bin, 'grok')
    const probe = okProbe('1.0.40')
    await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe })
    await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe })
    expect(probe).toHaveBeenCalledTimes(1)
    await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe, refresh: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('does not remember a miss: a CLI installed later is found', async () => {
    const probe = okProbe('1.0.40')
    expect(await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe })).toMatchObject({ ok: false })
    fakeCli(bin, 'grok')
    expect(await resolveCliExecutable('grok-cli', { env: { PATH: bin }, probe })).toMatchObject({ ok: true, source: 'host' })
  })

  it('a different override value is a different configuration', async () => {
    const a = fakeCli(join(tmp, 'a'), 'grok')
    const b = fakeCli(join(tmp, 'b'), 'grok')
    const probe = okProbe('1')
    expect(await resolveCliExecutable('grok-cli', { env: { EYAS_GROK_BIN: a }, probe })).toMatchObject({ path: a })
    expect(await resolveCliExecutable('grok-cli', { env: { EYAS_GROK_BIN: b }, probe })).toMatchObject({ path: b })
  })
})

describe('findOnPath / parseVersion', () => {
  it('skips relative PATH entries and non-executable files', () => {
    fakeCli(join(tmp, 'noexec'), 'grok', '1', false)
    const good = fakeCli(bin, 'grok')
    expect(findOnPath(['grok'], { PATH: ['relative/bin', join(tmp, 'noexec'), bin].join(delimiter) })).toBe(good)
    expect(findOnPath(['grok'], { PATH: 'relative/bin' })).toBeNull()
  })

  it('tries PATHEXT extensions on Windows', () => {
    const exe = fakeCli(bin, 'kimi.EXE')
    expect(findOnPath(['kimi'], { PATH: bin, PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(exe)
    expect(findOnPath(['kimi'], { PATH: bin }, 'linux')).toBeNull()
  })

  it('parses a semver out of --version output', () => {
    expect(parseVersion('grok 1.0.40 (abc)')).toBe('1.0.40')
    expect(parseVersion('2.1.280 (Claude Code)')).toBe('2.1.280')
    expect(parseVersion('kimi, version 1.52.0-rc.1')).toBe('1.52.0-rc.1')
    expect(parseVersion('no version here')).toBeNull()
  })
})
