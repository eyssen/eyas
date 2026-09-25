// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — the host CLI an override shadows, for every CLI row (the panel's
// Runtime line and Claude Code's doctor/runtime info share this one helper).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearExecutableCache,
  findShadowedHostCli,
  resolveCliExecutable,
  type VersionProbe,
} from '@modules/model/cli-runtime/executables.js'

let tmp: string

function fakeCli(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\necho "x 0.0.0"\n')
  chmodSync(path, 0o755)
  return path
}

/** Reports a version per path, so the host and the override can be told apart. */
const probeByPath = (versions: Record<string, string>): VersionProbe =>
  vi.fn(async (path: string) => ({ code: 0, stdout: `x ${versions[path] ?? '0.0.0'}\n`, stderr: '' }))

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-shadow-')))
  clearExecutableCache()
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  clearExecutableCache()
})

describe('findShadowedHostCli', () => {
  it('(+) an override that shadows another grok on PATH reports that one with its version', async () => {
    const override = fakeCli(join(tmp, 'opt'), 'grok')
    const host = fakeCli(join(tmp, 'bin'), 'grok')
    const env = { EYAS_GROK_BIN: override, PATH: join(tmp, 'bin') }
    const probe = probeByPath({ [override]: '1.0.41', [host]: '1.0.50' })
    const r = await resolveCliExecutable('grok-cli', { env, probe })
    expect(r).toMatchObject({ ok: true, source: 'override', version: '1.0.41' })
    await expect(findShadowedHostCli(r, { env, probe })).resolves.toEqual({ path: host, version: '1.0.50' })
  })

  it('(−) the host binary EYAS runs is not "shadowed"', async () => {
    fakeCli(join(tmp, 'bin'), 'kimi')
    const env = { PATH: join(tmp, 'bin') }
    const r = await resolveCliExecutable('kimi-cli', { env, probe: probeByPath({}) })
    expect(r).toMatchObject({ ok: true, source: 'host' })
    await expect(findShadowedHostCli(r, { env })).resolves.toBeNull()
  })

  it('(−) an override with nothing on PATH, or the same file on PATH, shadows nothing', async () => {
    const override = fakeCli(join(tmp, 'opt'), 'grok')
    const alone = { EYAS_GROK_BIN: override, PATH: join(tmp, 'empty') }
    const r1 = await resolveCliExecutable('grok-cli', { env: alone, probe: probeByPath({}) })
    await expect(findShadowedHostCli(r1, { env: alone })).resolves.toBeNull()

    clearExecutableCache()
    const same = { EYAS_GROK_BIN: override, PATH: join(tmp, 'opt') }
    const r2 = await resolveCliExecutable('grok-cli', { env: same, probe: probeByPath({}) })
    await expect(findShadowedHostCli(r2, { env: same })).resolves.toBeNull()
  })

  it('(−) an unresolved runtime has no shadowed host', async () => {
    const env = { EYAS_GROK_BIN: 'relative/grok', PATH: '' }
    const r = await resolveCliExecutable('grok-cli', { env })
    expect(r).toMatchObject({ ok: false, error: 'override-invalid' })
    await expect(findShadowedHostCli(r, { env })).resolves.toBeNull()
  })
})
