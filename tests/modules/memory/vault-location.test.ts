// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B9 — the vault lives in <dataDir>/vault and follows EYAS_DATA_DIR. Notes a
// pre-move install kept in <home>/data/vault are copied (never moved) once,
// and only into a vault that holds no note of its own.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveInstance } from '@core/instance'
import {
  copyLegacyVaultIfNeeded,
  inspectLegacyVault,
  legacyVaultDir,
  prepareVaultDir,
} from '@modules/memory/vault/legacy-location'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultWatcher, isIgnoredVaultPath } from '@modules/memory/vault/vault-watcher'

const ENV_KEYS = ['EYAS_HOME', 'EYAS_DATA_DIR'] as const

let root: string
let home: string
let saved: Record<string, string | undefined>

function fakeLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }
}

function writeNote(dir: string, rel: string, body: string): string {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, body, 'utf-8')
  return full
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  root = mkdtempSync(join(tmpdir(), 'eyas-vault-location-'))
  home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  process.env.EYAS_HOME = home
  delete process.env.EYAS_DATA_DIR
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { chmodSync(join(root, 'volume'), 0o755) } catch { /* not made read-only */ }
  rmSync(root, { recursive: true, force: true })
})

describe('vault location follows EYAS_DATA_DIR', () => {
  it('the service writes into <dataDir>/vault, never the legacy home folder', () => {
    process.env.EYAS_DATA_DIR = join(root, 'volume')
    const instance = resolveInstance({ ensureDirs: false })
    const vaultDir = prepareVaultDir(instance, fakeLogger())
    expect(vaultDir).toBe(resolve(root, 'volume', 'vault'))

    const vault = createVaultService(vaultDir)
    vault.write('semantic/alpha.md', { title: 'Alpha' } as any, 'body')
    expect(existsSync(join(root, 'volume', 'vault', 'semantic', 'alpha.md'))).toBe(true)
    expect(vault.getBasePath()).toBe(vaultDir)
    expect(existsSync(legacyVaultDir(home))).toBe(false)
  })

  it('the watcher re-indexes a note written into <dataDir>/vault', async () => {
    process.env.EYAS_DATA_DIR = join(root, 'volume')
    const vaultDir = prepareVaultDir(resolveInstance({ ensureDirs: false }), fakeLogger())
    createVaultService(vaultDir)
    const indexAll = vi.fn(() => 1)
    const removeStale = vi.fn()
    const watcher = createVaultWatcher(vaultDir, { indexAll, removeStale } as any, fakeLogger() as any)
    watcher.start()
    try {
      // chokidar needs its initial scan before it reports new files.
      await new Promise((r) => setTimeout(r, 300))
      writeNote(vaultDir, 'semantic/watched.md', '# watched')
      await vi.waitFor(() => expect(indexAll).toHaveBeenCalled(), { timeout: 8_000, interval: 100 })
    } finally {
      await watcher.stop()
    }
  })

  it('still watches a vault whose data dir sits under a dot-folder', async () => {
    // The vault path is absolute now; a hidden ancestor must not hide its notes.
    process.env.EYAS_DATA_DIR = join(root, '.hidden-volume', 'data')
    const vaultDir = prepareVaultDir(resolveInstance({ ensureDirs: false }), fakeLogger())
    createVaultService(vaultDir)
    const indexAll = vi.fn(() => 1)
    const watcher = createVaultWatcher(vaultDir, { indexAll, removeStale: vi.fn() } as any, fakeLogger() as any)
    watcher.start()
    try {
      await new Promise((r) => setTimeout(r, 300))
      writeNote(vaultDir, 'procedural/seen.md', '# seen')
      await vi.waitFor(() => expect(indexAll).toHaveBeenCalled(), { timeout: 8_000, interval: 100 })
    } finally {
      await watcher.stop()
    }
  })

  it('ignores dot-entries and node_modules inside the vault, judged relative to its root', () => {
    const vaultDir = join(root, '.hidden', 'vault')
    expect(isIgnoredVaultPath(vaultDir, vaultDir)).toBe(false)
    expect(isIgnoredVaultPath(vaultDir, join(vaultDir, 'semantic', 'a.md'))).toBe(false)
    expect(isIgnoredVaultPath(vaultDir, join(vaultDir, '.obsidian', 'workspace.json'))).toBe(true)
    expect(isIgnoredVaultPath(vaultDir, join(vaultDir, 'semantic', '.draft.md'))).toBe(true)
    expect(isIgnoredVaultPath(vaultDir, join(vaultDir, 'node_modules', 'x.md'))).toBe(true)
    // A relative vault path is judged the same way.
    expect(isIgnoredVaultPath('data/vault', 'data/vault/semantic/a.md')).toBe(false)
    expect(isIgnoredVaultPath('data/vault', 'data/vault/.quarantine/a.md')).toBe(true)
  })

  it('with the default data dir the vault IS the legacy folder: nothing to copy', () => {
    const instance = resolveInstance({ ensureDirs: false })
    writeNote(legacyVaultDir(home), 'semantic/a.md', 'a')
    const logger = fakeLogger()

    expect(inspectLegacyVault(instance).kind).toBe('same-location')
    const result = copyLegacyVaultIfNeeded(instance, logger)
    expect(result.action).toBe('none')
    expect(prepareVaultDir(instance, logger)).toBe(resolve(home, 'data', 'vault'))
    expect(logger.warn).not.toHaveBeenCalled()
    expect(existsSync(join(home, 'data', '.vault-legacy-copy'))).toBe(false)
  })

  it('treats a data dir that is a symlink to <home>/data as the same folder', () => {
    mkdirSync(join(home, 'data'), { recursive: true })
    writeNote(legacyVaultDir(home), 'semantic/a.md', 'a')
    symlinkSync(join(home, 'data'), join(root, 'linked-data'))
    process.env.EYAS_DATA_DIR = join(root, 'linked-data')
    const instance = resolveInstance({ ensureDirs: false })

    expect(inspectLegacyVault(instance).kind).toBe('same-location')
    expect(copyLegacyVaultIfNeeded(instance).action).toBe('none')
  })
})

describe('one-time copy of the legacy vault', () => {
  beforeEach(() => {
    process.env.EYAS_DATA_DIR = join(root, 'volume')
    mkdirSync(join(root, 'volume'), { recursive: true })
  })

  it('copies (never moves) legacy notes into an empty vault, keeping their bytes and times', () => {
    const legacy = legacyVaultDir(home)
    const a = writeNote(legacy, 'semantic/a.md', '---\ntitle: A\n---\nalpha\n')
    writeNote(legacy, 'procedural/b.md', 'beta')
    writeNote(legacy, '.hidden/c.md', 'gamma')
    utimesSync(a, new Date('2025-01-02T03:04:05Z'), new Date('2025-01-02T03:04:05Z'))
    const instance = resolveInstance({ ensureDirs: false })
    const logger = fakeLogger()

    expect(inspectLegacyVault(instance)).toMatchObject({ kind: 'pending', notes: 3 })
    const result = copyLegacyVaultIfNeeded(instance, logger)

    expect(result).toMatchObject({ action: 'copied', notes: 3 })
    const copied = join(instance.vaultDir, 'semantic', 'a.md')
    expect(readFileSync(copied, 'utf-8')).toBe('---\ntitle: A\n---\nalpha\n')
    expect(statSync(copied).mtimeMs).toBe(statSync(a).mtimeMs)
    expect(readFileSync(join(instance.vaultDir, 'procedural', 'b.md'), 'utf-8')).toBe('beta')
    expect(existsSync(join(instance.vaultDir, '.hidden', 'c.md'))).toBe(true)
    // The original stays where it was.
    expect(readFileSync(a, 'utf-8')).toBe('---\ntitle: A\n---\nalpha\n')
    // No staging folder is left behind, and the owner is told what to do.
    expect(existsSync(join(root, 'volume', '.vault-legacy-copy'))).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0][1])).toMatch(/Remedy/)
  })

  it('copies into a vault folder that holds only the empty scaffold of an earlier start', () => {
    const legacy = legacyVaultDir(home)
    writeNote(legacy, 'semantic/a.md', 'alpha')
    const instance = resolveInstance({ ensureDirs: false })
    createVaultService(instance.vaultDir) // semantic/, procedural/, projects/ — no notes

    const result = copyLegacyVaultIfNeeded(instance, fakeLogger())
    expect(result.action).toBe('copied')
    expect(readFileSync(join(instance.vaultDir, 'semantic', 'a.md'), 'utf-8')).toBe('alpha')
    expect(existsSync(join(instance.vaultDir, 'projects'))).toBe(true)
  })

  it('never overwrites or merges into a vault that already has a note', () => {
    const legacy = legacyVaultDir(home)
    writeNote(legacy, 'semantic/a.md', 'legacy alpha')
    writeNote(legacy, 'semantic/only-legacy.md', 'legacy only')
    const instance = resolveInstance({ ensureDirs: false })
    writeNote(instance.vaultDir, 'semantic/a.md', 'current alpha')
    const logger = fakeLogger()

    expect(inspectLegacyVault(instance)).toMatchObject({ kind: 'diverged', notes: 2 })
    const result = copyLegacyVaultIfNeeded(instance, logger)

    expect(result.action).toBe('kept')
    expect(readFileSync(join(instance.vaultDir, 'semantic', 'a.md'), 'utf-8')).toBe('current alpha')
    expect(existsSync(join(instance.vaultDir, 'semantic', 'only-legacy.md'))).toBe(false)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0][1])).toMatch(/Remedy/)
  })

  it('happens once: a second start finds the vault populated and copies nothing', () => {
    writeNote(legacyVaultDir(home), 'semantic/a.md', 'alpha')
    const instance = resolveInstance({ ensureDirs: false })
    expect(copyLegacyVaultIfNeeded(instance).action).toBe('copied')

    writeNote(legacyVaultDir(home), 'semantic/later.md', 'written to the old folder afterwards')
    expect(copyLegacyVaultIfNeeded(instance).action).toBe('kept')
    expect(existsSync(join(instance.vaultDir, 'semantic', 'later.md'))).toBe(false)
  })

  it('does nothing when there is no legacy folder, or it holds no note', () => {
    const instance = resolveInstance({ ensureDirs: false })
    expect(copyLegacyVaultIfNeeded(instance)).toMatchObject({ action: 'none', state: { kind: 'no-legacy' } })

    mkdirSync(join(legacyVaultDir(home), 'semantic'), { recursive: true })
    writeFileSync(join(legacyVaultDir(home), 'semantic', 'not-a-note.txt'), 'x')
    const logger = fakeLogger()
    expect(copyLegacyVaultIfNeeded(instance, logger)).toMatchObject({ action: 'none', state: { kind: 'no-legacy' } })
    expect(existsSync(instance.vaultDir)).toBe(false)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('a copy that fails leaves the vault empty, cleans up, and is retried on the next start', () => {
    // Root ignores directory permissions, so the failure cannot be staged there.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return
    writeNote(legacyVaultDir(home), 'semantic/a.md', 'alpha')
    const instance = resolveInstance({ ensureDirs: false })
    chmodSync(join(root, 'volume'), 0o555)
    const logger = fakeLogger()

    const failed = copyLegacyVaultIfNeeded(instance, logger)
    expect(failed.action).toBe('failed')
    expect(existsSync(instance.vaultDir)).toBe(false)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0][1])).toMatch(/Remedy/)

    chmodSync(join(root, 'volume'), 0o755)
    expect(readdirSync(join(root, 'volume'))).toEqual([])
    expect(copyLegacyVaultIfNeeded(instance).action).toBe('copied')
    expect(readFileSync(join(instance.vaultDir, 'semantic', 'a.md'), 'utf-8')).toBe('alpha')
  })
})

describe('memory module wiring', () => {
  it('hands one prepared vault dir to both the vault service and its watcher (no cwd-relative data/vault)', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/memory/index.ts'), 'utf-8')
    expect(source).not.toMatch(/['"`]data\/vault['"`]/)
    expect(source).toMatch(/const vaultDir = prepareVaultDir\(resolveInstance\(\{ ensureDirs: false \}\)/)
    expect(source).toMatch(/createVaultService\(vaultDir\)/)
    expect(source).toMatch(/createVaultWatcher\(vaultDir,/)
  })
})
