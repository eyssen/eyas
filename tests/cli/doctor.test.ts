import { describe, it, expect } from 'vitest'
import { checkPlatform, checkDatabase, checkMasterKey, checkConfig, type CheckResult } from '../../src/cli/commands/doctor'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
})
