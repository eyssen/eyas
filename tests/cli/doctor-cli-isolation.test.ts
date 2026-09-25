// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas doctor` — the 'CLI isolation' lines: the executable of each CLI
// provider, drift from the version the live isolation lane last proved, and
// the EYAS-owned homes of Grok and Kimi (present, private, managed files
// unchanged). No CLI binary runs here: resolution is injected, the homes are
// real temp folders.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCliIsolation } from '../../src/cli/commands/doctor.js'
import type { ExecutableResolution } from '@modules/model/cli-runtime/executables.js'
import { CLI_VERIFIED_VERSIONS, isolationDrift, type IsolationCliId } from '@modules/model/cli-runtime/verified-versions.js'
import { createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles.js'

const VERIFIED = {
  'claude-code': { version: '2.1.281', verifiedAt: '2026-09-24', paidCanary: false },
  'grok-cli': { version: '1.0.41', verifiedAt: '2026-09-24', paidCanary: false },
  'kimi-cli': { version: null, verifiedAt: null, paidCanary: false },
}

let base: string
let homesDir: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-doctor-isolation-')))
  homesDir = join(base, 'cli-homes')
  mkdirSync(homesDir, { recursive: true, mode: 0o700 })
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function found(id: IsolationCliId, version: string | null, source: 'override' | 'host' = 'host'): ExecutableResolution {
  return { ok: true, id, path: `/usr/local/bin/${id}`, version, source, expectedVersion: null, warnings: [] }
}
const notFound = (id: IsolationCliId): ExecutableResolution => ({ ok: false, id, error: 'not-found', detail: `${id}: no executable found` })

async function run(resolutions: Partial<Record<IsolationCliId, ExecutableResolution>>) {
  const results = await checkCliIsolation({
    homesDir,
    verified: VERIFIED,
    platform: 'darwin',
    resolve: async (id) => resolutions[id] ?? notFound(id),
  })
  return Object.fromEntries(results.map((r) => [r.name, r]))
}

describe('checkCliIsolation', () => {
  it('ok: the installed version is the one the lane proved (positive)', async () => {
    const r = await run({ 'claude-code': found('claude-code', '2.1.281') })
    expect(r['CLI isolation (Claude Code)']).toMatchObject({ status: 'ok' })
    expect(r['CLI isolation (Claude Code)'].message).toContain('claude on PATH /usr/local/bin/claude-code')
    expect(r['CLI isolation (Claude Code)'].message).toContain('version 2.1.281')
    expect(r['CLI isolation (Claude Code)'].message).toContain('isolation proven on this version (2026-09-24)')
  })

  it('warns on drift from the last proven version (negative)', async () => {
    const r = await run({ 'claude-code': found('claude-code', '2.1.290', 'override') })
    expect(r['CLI isolation (Claude Code)'].status).toBe('warn')
    expect(r['CLI isolation (Claude Code)'].message).toContain('EYAS_CLAUDE_CODE_BIN /usr/local/bin/claude-code')
    expect(r['CLI isolation (Claude Code)'].message).toMatch(/last proven on 2\.1\.281 \(2026-09-24\), not on this version/)
    expect(r['CLI isolation (Claude Code)'].message).toContain('EYAS still checks every session at start')
  })

  it('warns when the binary reports no version, or the CLI was never proven (Kimi)', async () => {
    const r = await run({ 'grok-cli': found('grok-cli', null), 'kimi-cli': found('kimi-cli', '1.52.0') })
    expect(r['CLI isolation (Grok CLI)'].status).toBe('warn')
    expect(r['CLI isolation (Grok CLI)'].message).toContain('reported no version')
    expect(r['CLI isolation (Kimi Code CLI)'].status).toBe('warn')
    expect(r['CLI isolation (Kimi Code CLI)'].message).toContain('never proven')
  })

  it('a CLI that is not installed is fine; an invalid override is a failure', async () => {
    const r = await run({
      'grok-cli': { ok: false, id: 'grok-cli', error: 'override-invalid', detail: 'EYAS_GROK_BIN must be an absolute path: grok', remedy: 'Point EYAS_GROK_BIN at an absolute path to the executable, or unset it.' },
    })
    expect(r['CLI isolation (Claude Code)']).toMatchObject({ status: 'ok', message: 'not installed' })
    expect(r['CLI isolation (Grok CLI)'].status).toBe('fail')
    expect(r['CLI isolation (Grok CLI)'].message).toContain('remedy: Point EYAS_GROK_BIN')
  })

  it('Grok: an EYAS home not created yet is fine; a present one with intact managed files is ok (positive)', async () => {
    let r = await run({ 'grok-cli': found('grok-cli', '1.0.41') })
    expect(r['CLI isolation (Grok CLI)']).toMatchObject({ status: 'ok' })
    expect(r['CLI isolation (Grok CLI)'].message).toContain('EYAS home not created yet')

    createAcpProfile('grok-cli', { homesDir, sourceEnv: { PATH: '/usr/bin' } }).ensureHome()
    r = await run({ 'grok-cli': found('grok-cli', '1.0.41') })
    expect(r['CLI isolation (Grok CLI)']).toMatchObject({ status: 'ok' })
    expect(r['CLI isolation (Grok CLI)'].message).toContain('EYAS home and managed files intact')
  })

  it('Grok: a managed file changed between runs is a warning (negative)', async () => {
    const profile = createAcpProfile('grok-cli', { homesDir, sourceEnv: { PATH: '/usr/bin' } })
    profile.ensureHome()
    writeFileSync(join(profile.configDir, 'config.toml'), '[ui]\npermission_mode = "always-approve"\n')
    const r = await run({ 'grok-cli': found('grok-cli', '1.0.41') })
    expect(r['CLI isolation (Grok CLI)'].status).toBe('warn')
    expect(r['CLI isolation (Grok CLI)'].message).toMatch(/config\.toml in the EYAS home differs from what EYAS wrote/)
  })

  it('Grok: a home open to other users is a warning, a symlinked home a failure (negative)', async () => {
    const profile = createAcpProfile('grok-cli', { homesDir, sourceEnv: { PATH: '/usr/bin' } })
    profile.ensureHome()
    chmodSync(profile.home, 0o755)
    let r = await run({ 'grok-cli': found('grok-cli', '1.0.41') })
    expect(r['CLI isolation (Grok CLI)'].status).toBe('warn')
    expect(r['CLI isolation (Grok CLI)'].message).toContain('mode 755')

    rmSync(profile.home, { recursive: true, force: true })
    const elsewhere = join(base, 'elsewhere')
    mkdirSync(elsewhere)
    symlinkSync(elsewhere, profile.home)
    r = await run({ 'grok-cli': found('grok-cli', '1.0.41') })
    expect(r['CLI isolation (Grok CLI)'].status).toBe('fail')
    expect(r['CLI isolation (Grok CLI)'].message).toContain('symbolic link')
  })

  it('Kimi: EYAS keys missing from its config.toml are a warning (negative)', async () => {
    const profile = createAcpProfile('kimi-cli', { homesDir, sourceEnv: { PATH: '/usr/bin' } })
    profile.ensureHome()
    writeFileSync(join(profile.configDir, 'config.toml'), 'default_yolo = true\n')
    const r = await run({ 'kimi-cli': found('kimi-cli', '1.52.0') })
    expect(r['CLI isolation (Kimi Code CLI)'].status).toBe('warn')
  })
})

describe('isolationDrift and the shipped record', () => {
  it('match, drift, never verified, unknown version', () => {
    expect(isolationDrift('claude-code', '2.1.281', VERIFIED)).toBe('match')
    expect(isolationDrift('claude-code', '2.1.282', VERIFIED)).toBe('drift')
    expect(isolationDrift('kimi-cli', '1.52.0', VERIFIED)).toBe('never-verified')
    expect(isolationDrift('grok-cli', null, VERIFIED)).toBe('unknown-version')
  })

  it('the shipped record is well-formed: a version always comes with its day', () => {
    for (const record of Object.values(CLI_VERIFIED_VERSIONS)) {
      expect(record.version === null).toBe(record.verifiedAt === null)
      if (record.verifiedAt) expect(record.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
