// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — Grok's kernel sandbox profile: a custom [profiles.eyas-<hash>] in
// $GROK_HOME/sandbox.toml extending 'workspace', with the memory-sovereignty
// deny list and the session's extra folders; one profile per live session,
// written atomically, pruned when its last session ends.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GROK_SANDBOX_FILE,
  buildGrokSandboxProfile,
  createGrokSandboxProfiles,
  grokBinaryDirs,
  grokDenyEntry,
  grokSandboxEnv,
  renderGrokSandboxToml,
  resetGrokSandboxProfilesForTests,
  tomlString,
} from '@modules/model/submodules/grok-cli/sandbox-profile.js'
import { createSovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture'

const parseToml = (text: string): any => (globalThis as any).Bun.TOML.parse(text)

let root: string
let home: string
let configDir: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-sandbox-')))
  home = join(root, 'cli-homes', 'grok-cli')
  configDir = join(home, '.grok')
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
})

afterEach(() => {
  resetGrokSandboxProfilesForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('tomlString', () => {
  it('escapes backslash, quote and control characters; keeps unicode', () => {
    expect(tomlString('a"b\\c\nd\te\u0001f')).toBe('"a\\"b\\\\c\\nd\\te\\u0001f"')
    expect(tomlString('/Users/Žofia/Dokumenty')).toBe('"/Users/Žofia/Dokumenty"')
    // Round trip through a real TOML parser.
    const tricky = '/tmp/we"ird\\path\u007f'
    expect(parseToml(`x = ${tomlString(tricky)}`).x).toBe(tricky)
  })
})

describe('grokDenyEntry', () => {
  it('replaces a path grok would read as a glob with its nearest clean parent', () => {
    expect(grokDenyEntry('/data/notes[1]/vault')).toBe('/data')
    expect(grokDenyEntry('/data/a*b/x')).toBe('/data')
    expect(grokDenyEntry('/data/what?/x')).toBe('/data')
    expect(grokDenyEntry('/data/plain/x')).toBe('/data/plain/x')
  })

  it('replaces a segment with edge whitespace (grok skips it) by its parent; never denies /', () => {
    expect(grokDenyEntry('/data/trailing /x')).toBe('/data')
    expect(grokDenyEntry('/[x]')).toBeNull()
    expect(grokDenyEntry('/')).toBeNull()
  })
})

describe('buildGrokSandboxProfile', () => {
  it('extends workspace, lists deny and read_write, and parses back as built', () => {
    const p = buildGrokSandboxProfile({ deny: ['/h/.claude', '/h/notes'], readWrite: ['/w/extra', '/h/cli'] })
    expect(p.name).toMatch(/^eyas-[0-9a-f]{16}$/)
    const doc = parseToml(renderGrokSandboxToml([p]))
    expect(doc.profiles[p.name]).toEqual({ extends: 'workspace', read_write: ['/h/cli', '/w/extra'], deny: ['/h/.claude', '/h/notes'] })
  })

  it('names are stable for the same folders (order-insensitive) and differ for different ones', () => {
    const a = buildGrokSandboxProfile({ deny: ['/a', '/b'], readWrite: ['/w'] })
    const b = buildGrokSandboxProfile({ deny: ['/b', '/a', '/a'], readWrite: ['/w'] })
    const c = buildGrokSandboxProfile({ deny: ['/a'], readWrite: ['/w'] })
    expect(a.name).toBe(b.name)
    expect(a.body).toBe(b.body)
    expect(c.name).not.toBe(a.name)
  })

  it('drops read_write grants grok would skip (globs, edge whitespace, /)', () => {
    const p = buildGrokSandboxProfile({ deny: [], readWrite: ['/w/ok', '/w/a*', '/w/sp ', '/'] })
    expect(p.readWrite).toEqual(['/w/ok'])
  })

  it('negative: an empty deny list still renders an eyas-<hash> profile extending workspace, never an unrestricted one', () => {
    const p = buildGrokSandboxProfile({ deny: [], readWrite: [] })
    expect(p.name).toMatch(/^eyas-[0-9a-f]{16}$/)
    expect(['off', 'workspace', 'devbox', 'read-only', 'strict']).not.toContain(p.name)
    expect(parseToml(renderGrokSandboxToml([p])).profiles[p.name]).toEqual({ extends: 'workspace', read_write: [], deny: [] })
    expect(grokSandboxEnv(p.name, configDir).GROK_SANDBOX).toBe(p.name)
  })

  it('grokSandboxEnv refuses anything but an EYAS profile name and never auto-allows the shell', () => {
    expect(() => grokSandboxEnv('off', configDir)).toThrow(/refusing/)
    expect(() => grokSandboxEnv('workspace', configDir)).toThrow(/refusing/)
    const env = grokSandboxEnv('eyas-0123456789abcdef', configDir)
    expect(env).toEqual({ GROK_SANDBOX: 'eyas-0123456789abcdef', GROK_SANDBOX_AUTO_ALLOW_BASH: 'false', GROK_HOME: configDir })
  })

  it('selects GROK_HOME by its real path (grok refuses a symlinked GROK_HOME)', () => {
    const link = join(root, 'linked-grok-home')
    symlinkSync(configDir, link)
    expect(grokSandboxEnv('eyas-0123456789abcdef', link).GROK_HOME).toBe(configDir)
  })
})

describe('createGrokSandboxProfiles', () => {
  const file = () => join(configDir, GROK_SANDBOX_FILE)

  it('writes the live profile into GROK_HOME/sandbox.toml and prunes it when the session ends', () => {
    const profiles = createGrokSandboxProfiles({ home, configDir })
    const lease = profiles.acquire({ deny: ['/h/.claude'], readWrite: [home] })
    const doc = parseToml(readFileSync(file(), 'utf8'))
    expect(Object.keys(doc.profiles)).toEqual([lease.name])
    expect(doc.profiles[lease.name].deny).toEqual(['/h/.claude'])
    expect(lease.env).toMatchObject({ GROK_SANDBOX: lease.name, GROK_SANDBOX_AUTO_ALLOW_BASH: 'false' })
    // Written 0600 as a regular file (never through a link).
    expect(lstatSync(file()).isFile()).toBe(true)
    expect(lstatSync(file()).mode & 0o777).toBe(0o600)

    lease.release()
    lease.release() // idempotent
    expect(parseToml(readFileSync(file(), 'utf8')).profiles ?? {}).toEqual({})
    expect(profiles.liveNames()).toEqual([])
  })

  it('concurrent sessions keep both profiles; the shared one stays until its last session ends', () => {
    const profiles = createGrokSandboxProfiles({ home, configDir })
    const a1 = profiles.acquire({ deny: ['/a'], readWrite: [] })
    const b = profiles.acquire({ deny: ['/b'], readWrite: [] })
    const a2 = profiles.acquire({ deny: ['/a'], readWrite: [] })
    expect(a2.name).toBe(a1.name)
    expect(Object.keys(parseToml(readFileSync(file(), 'utf8')).profiles).sort()).toEqual([a1.name, b.name].sort())

    a1.release()
    expect(Object.keys(parseToml(readFileSync(file(), 'utf8')).profiles).sort()).toEqual([a1.name, b.name].sort())
    b.release()
    expect(Object.keys(parseToml(readFileSync(file(), 'utf8')).profiles)).toEqual([a1.name])
    a2.release()
    expect(profiles.liveNames()).toEqual([])
  })

  it('a second provider instance on the same GROK_HOME (a reload) shares the live set', () => {
    const first = createGrokSandboxProfiles({ home, configDir })
    const lease = first.acquire({ deny: ['/a'], readWrite: [] })
    const second = createGrokSandboxProfiles({ home, configDir })
    const other = second.acquire({ deny: ['/b'], readWrite: [] })
    expect(Object.keys(parseToml(readFileSync(file(), 'utf8')).profiles)).toHaveLength(2)
    lease.release()
    other.release()
  })

  it('an unchanged file is not rewritten (no temp file left, content stable)', () => {
    const profiles = createGrokSandboxProfiles({ home, configDir })
    const a = profiles.acquire({ deny: ['/a'], readWrite: [] })
    const before = readFileSync(file(), 'utf8')
    const again = profiles.acquire({ deny: ['/a'], readWrite: [] })
    expect(readFileSync(file(), 'utf8')).toBe(before)
    a.release()
    again.release()
  })

  it('negative: refuses to write through a planted symlink and leaves no live profile behind', () => {
    const target = join(root, 'host-file.toml')
    symlinkSync(target, file())
    const profiles = createGrokSandboxProfiles({ home, configDir })
    expect(() => profiles.acquire({ deny: ['/a'], readWrite: [] })).toThrow()
    expect(existsSync(target)).toBe(false)
    expect(profiles.liveNames()).toEqual([])
  })
})

describe('the deny list a Grok session gets (path-policy kernelDenyList)', () => {
  it("denies other tools' memory, EYAS's data and other homes, never its own CLI HOME or the grok binary folder", () => {
    const fx = createSovereigntyFixture()
    try {
      const cliHome = join(fx.dataDir, 'cli-homes', 'grok-cli')
      const otherHome = join(fx.dataDir, 'cli-homes', 'kimi-cli')
      const grokInstall = join(fx.home, '.grok', 'bin')
      mkdirSync(join(cliHome, '.grok'), { recursive: true })
      mkdirSync(otherHome, { recursive: true })
      mkdirSync(grokInstall, { recursive: true })
      // A vault known only by its `.obsidian` marker is listed once the policy
      // has met it (a registered vault always is).
      expect(fx.policy.classify(fx.vaultNote).kind).toBe('foreign-memory')
      const deny = fx.policy.kernelDenyList({
        workingDirectories: [fx.ownWorkspace],
        exclude: [cliHome, ...grokBinaryDirs(join(grokInstall, 'grok'))],
      })
      const p = buildGrokSandboxProfile({ deny, readWrite: [cliHome, fx.ownWorkspace] })
      const denied = (path: string) => p.deny.some((d) => path === d || path.startsWith(`${d}/`))
      expect(denied(fx.claudeMemory)).toBe(true)
      expect(denied(fx.grokMemory)).toBe(true)
      expect(denied(fx.vaultNote)).toBe(true)
      expect(denied(fx.eyasVaultNote)).toBe(true)
      expect(denied(fx.otherFile)).toBe(true)
      expect(denied(otherHome)).toBe(true)
      // Kept usable.
      expect(denied(join(cliHome, '.grok', 'config.toml'))).toBe(false)
      expect(denied(join(grokInstall, 'grok'))).toBe(false)
      expect(denied(fx.ownFile)).toBe(false)
      // Granted as written and through symlinks (the fixture lives under a linked temp dir on macOS).
      for (const dir of [cliHome, fx.ownWorkspace]) {
        expect(p.readWrite).toContain(dir)
        expect(p.readWrite).toContain(realpathSync(dir))
      }
    } finally {
      fx.cleanup()
    }
  })
})
