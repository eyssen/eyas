import { describe, it, expect, vi } from 'vitest'
import {
  checkPlatform, checkDatabase, checkMasterKey, checkConfig, checkSqliteCapabilities, checkZstd, type CheckResult,
} from '../../src/cli/commands/doctor'
import { customSqliteStatus } from '@core/db/connection.js'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// checkSqliteCapabilities() obtains customSqliteStatus() via `await import('../../core/db/connection.js')`
// at call time — resolving through the '@core' alias here (rather than a repo-relative path from this
// file's own location) is what makes it land on the same mocked module record; other tests in this repo
// mocking a local source file all go through an alias for the same reason (e.g.
// tests/modules/skills/dead-scan-orphan-wiring.test.ts's `@modules/skills/skill-inventory.js`). Wrapped as
// a spy that calls through to the real implementation by default, so only the one test below that sets
// `mockReturnValueOnce` observes the null-libraryPath shape — every other test in this file still
// exercises the real darwin custom-SQLite probe.
vi.mock('@core/db/connection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/db/connection.js')>()
  return { ...actual, customSqliteStatus: vi.fn(actual.customSqliteStatus) }
})

describe('Doctor checks', () => {
  it('detects platform info', () => {
    const result = checkPlatform()
    expect(result.status).toBe('ok')
    expect(result.name).toBe('Platform')
    expect(result.message).toMatch(/darwin|linux|win32/)
    expect(result.message).toMatch(/Bun|Node/)
  })

  it('validates config files', () => {
    // Valid config — config/default.yaml exists in project
    const result = checkConfig('config/default.yaml')
    expect(result.status).toBe('ok')
  })

  it('reports missing config gracefully', () => {
    const result = checkConfig('/tmp/nonexistent-eyas-config.yaml')
    // loadConfig returns defaultConfig when file doesn't exist, so it should still be ok
    expect(result.status).toBe('ok')
  })

  it('checks database path — existing writable file', () => {
    const tmpDir = join(tmpdir(), 'eyas-test-doctor-' + Date.now())
    mkdirSync(tmpDir, { recursive: true })
    const dbPath = join(tmpDir, 'test.db')
    writeFileSync(dbPath, '')

    const result = checkDatabase(dbPath)
    expect(result.status).toBe('ok')
    expect(result.message).toContain('writable')

    rmSync(tmpDir, { recursive: true })
  })

  it('checks database path — missing file with writable parent', () => {
    const tmpDir = join(tmpdir(), 'eyas-test-doctor-' + Date.now())
    mkdirSync(tmpDir, { recursive: true })
    const dbPath = join(tmpDir, 'new.db')

    const result = checkDatabase(dbPath)
    expect(result.status).toBe('warn')
    expect(result.message).toContain('does not exist')

    rmSync(tmpDir, { recursive: true })
  })

  it('checks master key', () => {
    const result = checkMasterKey()
    // In test environment, master.key may or may not exist
    expect(['ok', 'warn']).toContain(result.status)
    expect(result.name).toBe('Master Key')
  })

  it('probes SQLite capabilities live and prints one line', async () => {
    const result = await checkSqliteCapabilities()
    expect(result.name).toBe('SQLite')
    expect(['ok', 'warn']).toContain(result.status) // FTS5 is present wherever the suite runs; vec0 depends on the box
    expect(result.message).toMatch(/^SQLite 3\.\d+\.\d+ · FTS5 ok/)
    if (result.status === 'warn') expect(result.message).toMatch(/remedy:/)
  })

  it('never implies "no custom SQLite" when libraryPath is null but extensions still work', async () => {
    // The hazard: libraryPath is null both when the bundled build was used (extensions genuinely
    // can't load) AND when another caller's setCustomSQLite() guard won the race first (extensions
    // may well work fine) — tests/helpers/test-db.ts is exactly such a caller. The authoritative
    // answer to "can this connection do extensions" must be the live probe, never libraryPath.
    vi.mocked(customSqliteStatus).mockReturnValueOnce({
      attempted: true,
      libraryPath: null,
      note: 'SQLite already loaded — another caller set the custom SQLite first',
    })
    const result = await checkSqliteCapabilities()
    // vec0 depends on the box (Homebrew SQLite + sqlite-vec here, but not on every runner), so this
    // asserts only that the live probe still reports a valid status with libraryPath null — never
    // that it reports 'ok'. The two assertions below carry this test's actual purpose: a null
    // libraryPath must never leak into the operator line, in either branch.
    expect(['ok', 'warn']).toContain(result.status)
    expect(result.message).not.toMatch(/no custom/i)
    expect(result.message).not.toMatch(/ via /)
  })

  it('reports the zstd tier', async () => {
    const result = await checkZstd()
    expect(result.name).toBe('zstd')
    expect(result.status).not.toBe('fail')
    expect(result.message).toMatch(/Bun native|node:zlib native|WASM fallback/)
  })
})
