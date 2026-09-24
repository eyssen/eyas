// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as realFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'

// Record every path the module under test reads, to prove it never opens a
// host CLI file.
const reads: string[] = []
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const track = <F extends (...args: any[]) => any>(fn: F): F =>
    ((...args: any[]) => {
      if (typeof args[0] === 'string') reads.push(args[0])
      return fn(...args)
    }) as F
  return {
    ...fs,
    readFileSync: track(fs.readFileSync),
    readdirSync: track(fs.readdirSync),
    statSync: track(fs.statSync),
    existsSync: track(fs.existsSync),
    lstatSync: track(fs.lstatSync),
    openSync: track(fs.openSync),
  }
})

const { cliHome, writeManagedFiles, readManagedFile, homeFileExists, removeHomeFile, purgeSessionStore, sweepSessionStore, SESSION_STORE_MAX_AGE_MS } = await import('@modules/model/cli-runtime/homes.js')

let tmp: string
let homesDir: string

beforeEach(() => {
  tmp = realFs.realpathSync(realFs.mkdtempSync(join(tmpdir(), 'eyas-homes-')))
  homesDir = join(tmp, 'data', 'cli-homes')
  reads.length = 0
})
afterEach(() => {
  realFs.rmSync(tmp, { recursive: true, force: true })
})

function mode(path: string): number {
  return realFs.statSync(path).mode & 0o777
}

describe('cliHome', () => {
  it('creates <cliHomesDir>/<id> with mode 0700, parent included', () => {
    const home = cliHome('grok-cli', { homesDir })
    expect(home).toBe(join(homesDir, 'grok-cli'))
    expect(mode(home)).toBe(0o700)
    expect(mode(homesDir)).toBe(0o700)
  })

  it('tightens an existing home that was left world-readable', () => {
    realFs.mkdirSync(join(homesDir, 'kimi-cli'), { recursive: true, mode: 0o755 })
    realFs.chmodSync(join(homesDir, 'kimi-cli'), 0o755)
    expect(mode(cliHome('kimi-cli', { homesDir }))).toBe(0o700)
  })

  it('refuses an id that is not a plain provider name', () => {
    for (const bad of ['../x', 'a/b', '', '.grok', 'Grok']) {
      expect(() => cliHome(bad, { homesDir }), bad).toThrow(/invalid CLI home id/)
    }
  })
})

describe('writeManagedFiles', () => {
  it('writes each file once and is idempotent by content', () => {
    const home = cliHome('grok-cli', { homesDir })
    const files = [
      { path: '.grok/config.toml', content: '[memory]\nenabled = false\n' },
      { path: '.grok/trusted_folders.toml', content: '' },
    ]
    const first = writeManagedFiles(home, files)
    expect(first.written).toHaveLength(2)
    expect(realFs.readFileSync(join(home, '.grok', 'config.toml'), 'utf-8')).toBe(files[0].content)
    expect(mode(join(home, '.grok', 'config.toml'))).toBe(0o600)

    const mtime = realFs.statSync(join(home, '.grok', 'config.toml')).mtimeMs
    const second = writeManagedFiles(home, files)
    expect(second.written).toEqual([])
    expect(second.unchanged).toHaveLength(2)
    expect(realFs.statSync(join(home, '.grok', 'config.toml')).mtimeMs).toBe(mtime)
  })

  it('rewrites a file whose content drifted', () => {
    const home = cliHome('grok-cli', { homesDir })
    writeManagedFiles(home, [{ path: 'config.toml', content: 'a = 1\n' }])
    realFs.writeFileSync(join(home, 'config.toml'), 'a = 2 # edited by hand\n')
    expect(writeManagedFiles(home, [{ path: 'config.toml', content: 'a = 1\n' }]).written).toEqual([join(home, 'config.toml')])
    expect(realFs.readFileSync(join(home, 'config.toml'), 'utf-8')).toBe('a = 1\n')
  })

  it('refuses paths that leave the home', () => {
    const home = cliHome('grok-cli', { homesDir })
    expect(() => writeManagedFiles(home, [{ path: '../escape.toml', content: 'x' }])).toThrow(/escapes/)
    expect(() => writeManagedFiles(home, [{ path: '/etc/passwd', content: 'x' }])).toThrow(/relative/)
    expect(realFs.existsSync(join(homesDir, 'escape.toml'))).toBe(false)
  })

  it('never reads the host ~/.grok', () => {
    const hostHome = join(tmp, 'operator-home')
    realFs.mkdirSync(join(hostHome, '.grok'), { recursive: true })
    realFs.writeFileSync(join(hostHome, '.grok', 'config.toml'), '[ui]\npermission_mode = "always-approve"\n')
    const prevHome = process.env.HOME
    process.env.HOME = hostHome
    try {
      const home = cliHome('grok-cli', { homesDir })
      writeManagedFiles(home, [{ path: '.grok/config.toml', content: '[ui]\npermission_mode = "ask"\n' }])
      writeManagedFiles(home, [{ path: '.grok/config.toml', content: '[ui]\npermission_mode = "ask"\n' }])
    } finally {
      process.env.HOME = prevHome
    }
    expect(reads.length).toBeGreaterThan(0)
    const hostReads = reads.filter((p) => {
      const rel = relative(hostHome, p)
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    })
    expect(hostReads).toEqual([])
  })
})

describe('session stores', () => {
  it('purgeSessionStore empties the store and keeps the folder', () => {
    const home = cliHome('grok-cli', { homesDir })
    const store = join(home, '.grok', 'sessions')
    realFs.mkdirSync(join(store, 'enc-cwd', 'session-1'), { recursive: true })
    realFs.writeFileSync(join(store, 'enc-cwd', 'session-1', 'chat_history.jsonl'), '{}')
    realFs.writeFileSync(join(store, 'prompt_history.jsonl'), '{}')
    expect(purgeSessionStore(store, { homesDir })).toBe(2)
    expect(realFs.readdirSync(store)).toEqual([])
  })

  it('purgeSessionStore is a no-op for a store that does not exist yet', () => {
    const home = cliHome('kimi-cli', { homesDir })
    expect(purgeSessionStore(join(home, '.kimi', 'sessions'), { homesDir })).toBe(0)
  })

  it('refuses to purge anything that is not a store inside a CLI home', () => {
    const home = cliHome('grok-cli', { homesDir })
    const outside = join(tmp, 'operator-home', '.grok', 'sessions')
    realFs.mkdirSync(outside, { recursive: true })
    realFs.writeFileSync(join(outside, 'keep.jsonl'), 'x')
    expect(() => purgeSessionStore(outside, { homesDir })).toThrow(/inside a CLI home/)
    expect(() => purgeSessionStore(home, { homesDir })).toThrow(/inside a CLI home/)
    expect(() => purgeSessionStore(homesDir, { homesDir })).toThrow(/inside a CLI home/)
    expect(realFs.existsSync(join(outside, 'keep.jsonl'))).toBe(true)
  })

  it('sweepSessionStore removes entries older than an hour and keeps fresh ones', () => {
    const home = cliHome('grok-cli', { homesDir })
    const store = join(home, '.grok', 'sessions')
    realFs.mkdirSync(join(store, 'old'), { recursive: true })
    realFs.mkdirSync(join(store, 'fresh'), { recursive: true })
    const old = (Date.now() - SESSION_STORE_MAX_AGE_MS - 60_000) / 1000
    realFs.utimesSync(join(store, 'old'), old, old)
    expect(sweepSessionStore(store, { homesDir })).toBe(1)
    expect(realFs.readdirSync(store)).toEqual(['fresh'])
  })

  it('sweepSessionStore is a no-op for a missing store', () => {
    const home = cliHome('grok-cli', { homesDir })
    expect(sweepSessionStore(join(home, '.grok', 'sessions'), { homesDir })).toBe(0)
  })
})

// After A5 the CLI runs with HOME = its EYAS home, so its own tools can plant
// symlinks there. No EYAS operation may follow one out of the homes.
describe('symlinks planted in a CLI home', () => {
  function hostDir(...parts: string[]): string {
    const dir = join(tmp, 'operator-home', ...parts)
    realFs.mkdirSync(dir, { recursive: true })
    return dir
  }

  it('(−) a managed file that is a symlink to a host file: throws, the host file is untouched', () => {
    const home = cliHome('grok-cli', { homesDir })
    const hostFile = join(hostDir('.grok'), 'config.toml')
    realFs.writeFileSync(hostFile, 'host = true\n')
    realFs.mkdirSync(join(home, '.grok'), { recursive: true })
    realFs.symlinkSync(hostFile, join(home, '.grok', 'config.toml'))
    reads.length = 0
    expect(() => writeManagedFiles(home, [{ path: '.grok/config.toml', content: 'eyas = true\n' }])).toThrow(/not a regular file/)
    // The module never opened the host file (the check below reads it itself).
    expect(reads.filter((p) => p.startsWith(join(tmp, 'operator-home')))).toEqual([])
    expect(realFs.readFileSync(hostFile, 'utf-8')).toBe('host = true\n')
  })

  it('(−) a dangling managed-file symlink: throws, nothing is created at its target', () => {
    const home = cliHome('grok-cli', { homesDir })
    const target = join(hostDir('.grok'), 'new.toml')
    realFs.symlinkSync(target, join(home, 'config.toml'))
    expect(() => writeManagedFiles(home, [{ path: 'config.toml', content: 'x' }])).toThrow(/not a regular file/)
    expect(realFs.existsSync(target)).toBe(false)
  })

  it('(−) a symlinked parent folder: throws, nothing is written into the host folder', () => {
    const home = cliHome('grok-cli', { homesDir })
    const host = hostDir('.grok')
    realFs.symlinkSync(host, join(home, '.grok'))
    expect(() => writeManagedFiles(home, [{ path: '.grok/config.toml', content: 'x' }])).toThrow(/symbolic link/)
    expect(realFs.readdirSync(host)).toEqual([])
  })

  it('(−) a symlinked home: writeManagedFiles and cliHome refuse it, the host folder keeps its mode', () => {
    const host = hostDir('grok-home')
    realFs.chmodSync(host, 0o755)
    realFs.mkdirSync(homesDir, { recursive: true })
    const home = join(homesDir, 'grok-cli')
    realFs.symlinkSync(host, home)
    expect(() => cliHome('grok-cli', { homesDir })).toThrow(/symbolic link/)
    expect(() => writeManagedFiles(home, [{ path: 'config.toml', content: 'x' }])).toThrow(/symbolic link/)
    expect(mode(host)).toBe(0o755)
    expect(realFs.readdirSync(host)).toEqual([])
  })

  it('(−) a symlinked sessions store: purge and sweep throw, the host folder keeps its files', () => {
    const home = cliHome('grok-cli', { homesDir })
    const host = hostDir('.grok', 'sessions')
    realFs.writeFileSync(join(host, 'keep.jsonl'), 'x')
    const old = (Date.now() - SESSION_STORE_MAX_AGE_MS - 60_000) / 1000
    realFs.utimesSync(join(host, 'keep.jsonl'), old, old)
    realFs.mkdirSync(join(home, '.grok'), { recursive: true })
    const store = join(home, '.grok', 'sessions')
    realFs.symlinkSync(host, store)
    expect(() => purgeSessionStore(store, { homesDir })).toThrow(/symbolic link/)
    expect(() => sweepSessionStore(store, { homesDir })).toThrow(/symbolic link/)
    expect(realFs.readdirSync(host)).toEqual(['keep.jsonl'])
  })

  it('(−) a symlinked folder above the store (the home itself): purge refuses it', () => {
    const host = hostDir('kimi-home')
    realFs.mkdirSync(join(host, '.kimi', 'sessions'), { recursive: true })
    realFs.writeFileSync(join(host, '.kimi', 'sessions', 'keep.jsonl'), 'x')
    realFs.mkdirSync(homesDir, { recursive: true })
    realFs.symlinkSync(host, join(homesDir, 'kimi-cli'))
    expect(() => purgeSessionStore(join(homesDir, 'kimi-cli', '.kimi', 'sessions'), { homesDir })).toThrow(/symbolic link/)
    expect(realFs.readdirSync(join(host, '.kimi', 'sessions'))).toEqual(['keep.jsonl'])
  })

  it('(+) a symlink entry inside a real store is removed as a link; its target survives', () => {
    const home = cliHome('grok-cli', { homesDir })
    const store = join(home, '.grok', 'sessions')
    realFs.mkdirSync(store, { recursive: true })
    const host = hostDir('projects')
    realFs.writeFileSync(join(host, 'keep.md'), 'x')
    realFs.symlinkSync(host, join(store, 'planted'))
    expect(purgeSessionStore(store, { homesDir })).toBe(1)
    expect(realFs.readdirSync(store)).toEqual([])
    expect(realFs.readdirSync(host)).toEqual(['keep.md'])
  })

  it('(+) sweep judges a link entry by its own age, not its target\'s', () => {
    const home = cliHome('grok-cli', { homesDir })
    const store = join(home, '.grok', 'sessions')
    realFs.mkdirSync(store, { recursive: true })
    const host = hostDir('fresh-target')
    realFs.writeFileSync(join(host, 'keep.md'), 'x')
    realFs.symlinkSync(host, join(store, 'planted'))
    const old = (Date.now() - SESSION_STORE_MAX_AGE_MS - 60_000) / 1000
    realFs.lutimesSync(join(store, 'planted'), old, old)
    expect(sweepSessionStore(store, { homesDir })).toBe(1)
    expect(realFs.readdirSync(host)).toEqual(['keep.md'])
  })
})

describe('readManagedFile', () => {
  it('(+) reads a file inside the home; null when it or its folder does not exist yet', () => {
    const home = cliHome('kimi-cli', { homesDir })
    expect(readManagedFile(home, '.kimi/config.toml')).toBeNull()
    writeManagedFiles(home, [{ path: '.kimi/config.toml', content: 'default_yolo = false\n' }])
    expect(readManagedFile(home, '.kimi/config.toml')).toBe('default_yolo = false\n')
    expect(readManagedFile(home, '.kimi/other.toml')).toBeNull()
  })

  it('(-) refuses a path outside the home', () => {
    const home = cliHome('kimi-cli', { homesDir })
    expect(() => readManagedFile(home, '../grok-cli/x')).toThrow(/escapes the CLI home/)
    expect(() => readManagedFile(home, '/etc/hosts')).toThrow(/must be relative/)
  })

  it('(-) never reads through a symlinked file or folder', () => {
    const home = cliHome('kimi-cli', { homesDir })
    const host = join(tmp, 'host-kimi')
    realFs.mkdirSync(host, { recursive: true })
    realFs.writeFileSync(join(host, 'config.toml'), 'HOST')
    realFs.symlinkSync(host, join(home, '.kimi'))
    expect(() => readManagedFile(home, '.kimi/config.toml')).toThrow(/symbolic link/)
    realFs.unlinkSync(join(home, '.kimi'))
    realFs.mkdirSync(join(home, '.kimi'))
    realFs.symlinkSync(join(host, 'config.toml'), join(home, '.kimi', 'config.toml'))
    expect(() => readManagedFile(home, '.kimi/config.toml')).toThrow(/not a regular file/)
  })
})

describe('homeFileExists / removeHomeFile (A7 credential check and sign-out)', () => {
  it('sees a non-empty credential file without opening it, even when it is unreadable (positive)', () => {
    const home = cliHome('grok-cli', { homesDir })
    realFs.mkdirSync(join(home, '.grok'), { recursive: true })
    const credential = join(home, '.grok', 'auth.json')
    realFs.writeFileSync(credential, '{"token":"secret"}')
    // Unreadable: a check that opened it would throw.
    realFs.chmodSync(credential, 0o000)
    expect(homeFileExists(home, '.grok/auth.json')).toBe(true)
    realFs.chmodSync(credential, 0o600)
  })

  it('is false for a missing, empty or symlinked credential, or a symlinked folder (negative)', () => {
    const home = cliHome('grok-cli', { homesDir })
    expect(homeFileExists(home, '.grok/auth.json')).toBe(false)
    realFs.mkdirSync(join(home, '.grok'), { recursive: true })
    realFs.writeFileSync(join(home, '.grok', 'auth.json'), '')
    expect(homeFileExists(home, '.grok/auth.json')).toBe(false)

    // A link to a host credential is not an EYAS sign-in.
    const host = join(tmp, 'host-auth.json')
    realFs.writeFileSync(host, '{"token":"host"}')
    realFs.rmSync(join(home, '.grok', 'auth.json'))
    realFs.symlinkSync(host, join(home, '.grok', 'auth.json'))
    expect(homeFileExists(home, '.grok/auth.json')).toBe(false)

    const kimi = cliHome('kimi-cli', { homesDir })
    realFs.mkdirSync(join(tmp, 'host-kimi', 'credentials'), { recursive: true })
    realFs.writeFileSync(join(tmp, 'host-kimi', 'credentials', 'kimi-code.json'), '{}')
    realFs.symlinkSync(join(tmp, 'host-kimi'), join(kimi, '.kimi'))
    expect(homeFileExists(kimi, '.kimi/credentials/kimi-code.json')).toBe(false)
  })

  it('refuses a path outside the home (negative)', () => {
    const home = cliHome('grok-cli', { homesDir })
    expect(() => homeFileExists(home, '../kimi-cli/x')).toThrow(/escapes the CLI home/)
    expect(() => removeHomeFile(home, '/etc/passwd')).toThrow(/must be relative/)
  })

  it('removes the credential; a planted link is unlinked, its target kept', () => {
    const home = cliHome('grok-cli', { homesDir })
    realFs.mkdirSync(join(home, '.grok'), { recursive: true })
    realFs.writeFileSync(join(home, '.grok', 'auth.json'), '{"token":"eyas"}')
    expect(removeHomeFile(home, '.grok/auth.json')).toBe(true)
    expect(realFs.existsSync(join(home, '.grok', 'auth.json'))).toBe(false)
    expect(removeHomeFile(home, '.grok/auth.json')).toBe(false)

    const host = join(tmp, 'host-auth.json')
    realFs.writeFileSync(host, '{"token":"host"}')
    realFs.symlinkSync(host, join(home, '.grok', 'auth.json'))
    expect(removeHomeFile(home, '.grok/auth.json')).toBe(true)
    expect(realFs.readFileSync(host, 'utf-8')).toBe('{"token":"host"}')
  })

  it('never walks through a symlinked folder to remove a host file (negative)', () => {
    const kimi = cliHome('kimi-cli', { homesDir })
    realFs.mkdirSync(join(tmp, 'host-kimi', 'credentials'), { recursive: true })
    const hostCredential = join(tmp, 'host-kimi', 'credentials', 'kimi-code.json')
    realFs.writeFileSync(hostCredential, '{}')
    realFs.symlinkSync(join(tmp, 'host-kimi'), join(kimi, '.kimi'))
    expect(() => removeHomeFile(kimi, '.kimi/credentials/kimi-code.json')).toThrow(/symbolic link/)
    expect(realFs.existsSync(hostCredential)).toBe(true)
  })
})
