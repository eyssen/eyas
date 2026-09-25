// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import {
  HOSTILE_MARKERS,
  HOSTILE_MCP_SERVERS,
  HostileHomeRefusedError,
  assertNotRealHome,
  buildHostileHome,
  claudeProjectSlug,
  diffSnapshots,
  firedMarkers,
  hostileProcessEnv,
  snapshotTree,
  tomlString,
  type HostileHome,
} from './hostile-home.js'

const built: HostileHome[] = []
const scratch: string[] = []
afterEach(() => {
  for (const h of built.splice(0)) h.cleanup()
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true })
})

function build(): HostileHome {
  const h = buildHostileHome()
  built.push(h)
  return h
}

const rel = (h: HostileHome, p: string) => relative(h.root, p).split(sep).join('/')

describe('buildHostileHome', () => {
  it('plants every hostile file, including the in-root project fixture', () => {
    const h = build()
    const planted = h.files.map((f) => rel(h, f)).sort()
    expect(planted).toEqual(
      [
        'home/.grok/config.toml',
        'home/.grok/AGENTS.md',
        'home/.grok/rules/x.md',
        'home/.grok/hooks/eyas-sentinel.json',
        'home/.claude/settings.json',
        'home/.claude.json',
        'home/.claude/CLAUDE.md',
        `home/.claude/projects/${h.claudeProjectSlug}/memory/MEMORY.md`,
        'home/.claude/skills/eyas-sentinel-skill/SKILL.md',
        'home/.claude/agents/eyas-sentinel-agent.md',
        'home/.kimi/config.toml',
        'home/.agents/skills/eyas-sentinel-shared-skill/SKILL.md',
        'home/.config/opencode/opencode.json',
        'home/.config/opencode/AGENTS.md',
        'home/Documents/EyasSentinelVault/.obsidian/app.json',
        'home/Documents/EyasSentinelVault/99_Meta/ai-memory/MEMORY.md',
        'project/AGENTS.md',
        'project/CLAUDE.md',
        'project/.grok/config.toml',
        'project/.grok/hooks/eyas-sentinel.json',
        'project/.mcp.json',
        'project/.claude/settings.json',
      ].sort(),
    )
    for (const f of h.files) expect(existsSync(f)).toBe(true)
    expect(existsSync(h.eyasHomes)).toBe(true)
    expect(firedMarkers(h)).toEqual([])
  })

  it('writes the hostile settings a CLI must never inherit', () => {
    const h = build()
    const grok = readFileSync(join(h.home, '.grok', 'config.toml'), 'utf8')
    expect(grok).toContain('permission_mode = "always-approve"')
    expect(grok).toMatch(/\[memory\]\nenabled = true/)
    expect(grok).toMatch(/\[compat\.claude\][^[]*mcps = true/)
    expect(grok).toContain(`[mcp_servers.${HOSTILE_MCP_SERVERS.grokHome}]`)

    const claude = JSON.parse(readFileSync(join(h.home, '.claude', 'settings.json'), 'utf8'))
    expect(claude.permissions.defaultMode).toBe('bypassPermissions')
    expect(claude.permissions.allow).toContain('Read(*)')
    expect(JSON.stringify(claude.hooks.Stop)).toContain(HOSTILE_MARKERS.claudeHomeStopHook)

    const claudeJson = JSON.parse(readFileSync(join(h.home, '.claude.json'), 'utf8'))
    expect(Object.keys(claudeJson.mcpServers)).toEqual([HOSTILE_MCP_SERVERS.claudeHome])

    const project = readFileSync(join(h.project, '.grok', 'config.toml'), 'utf8')
    expect(project).toContain(`[mcp_servers.${HOSTILE_MCP_SERVERS.grokProject}]`)
    expect(readFileSync(join(h.project, '.grok', 'hooks', 'eyas-sentinel.json'), 'utf8')).toContain(HOSTILE_MARKERS.grokProjectHook)
    expect(existsSync(join(h.vault, '.obsidian'))).toBe(true)
  })

  it('puts a unique sentinel in every instruction and memory file', () => {
    const h = build()
    const values = Object.values(h.sentinels)
    expect(new Set(values).size).toBe(values.length)
    const all = h.files.map((f) => readFileSync(f, 'utf8')).join('\n')
    for (const s of values) expect(all).toContain(s)
    expect(readFileSync(join(h.project, 'AGENTS.md'), 'utf8')).toContain(h.sentinels.projectAgents)
    expect(h.claudeProjectSlug).toBe(claudeProjectSlug(h.project))
    expect(h.claudeProjectSlug).not.toMatch(/[^a-zA-Z0-9-]/)
  })

  it('makes every hostile command only append to the markers dir', () => {
    const h = build()
    const commands = [
      readFileSync(join(h.home, '.grok', 'hooks', 'eyas-sentinel.json'), 'utf8'),
      readFileSync(join(h.home, '.claude.json'), 'utf8'),
      readFileSync(join(h.project, '.mcp.json'), 'utf8'),
    ].join('\n')
    expect(commands).toContain(h.markers)
    expect(commands).not.toMatch(/\brm\b|curl|wget/)
  })

  it('builds into an explicit empty root and cleans up', () => {
    const parent = mkdtempSync(join(tmpdir(), 'eyas-hh-test-'))
    scratch.push(parent)
    const h = buildHostileHome({ root: join(parent, 'explicit') })
    expect(existsSync(join(parent, 'explicit', 'home', '.claude.json'))).toBe(true)
    h.cleanup()
    expect(existsSync(join(parent, 'explicit'))).toBe(false)
  })

  it('refuses a non-empty explicit root (negative)', () => {
    const parent = mkdtempSync(join(tmpdir(), 'eyas-hh-test-'))
    scratch.push(parent)
    writeFileSync(join(parent, 'keep.txt'), 'x')
    expect(() => buildHostileHome({ root: parent })).toThrow(HostileHomeRefusedError)
    expect(readdirSync(parent)).toEqual(['keep.txt'])
  })
})

describe('real-home refusal (negative)', () => {
  it('refuses the real home directory itself', () => {
    expect(() => buildHostileHome({ root: homedir() })).toThrow(HostileHomeRefusedError)
    try {
      assertNotRealHome(homedir())
      expect.unreachable()
    } catch (err) {
      expect((err as HostileHomeRefusedError).reason).toBe('real-home')
    }
  })

  it('refuses a symlink that resolves to the real home', () => {
    const parent = mkdtempSync(join(tmpdir(), 'eyas-hh-test-'))
    scratch.push(parent)
    const link = join(parent, 'looks-harmless')
    symlinkSync(homedir(), link)
    expect(() => buildHostileHome({ root: link })).toThrow(HostileHomeRefusedError)
    unlinkSync(link)
  })

  it('refuses an ancestor of the real home', () => {
    expect(() => assertNotRealHome(dirname(homedir()))).toThrow(/real-home-ancestor/)
  })

  it('refuses any path inside the real home outside the OS temp dir', () => {
    // A name that never exists: the check resolves it lexically and touches no store.
    expect(() => assertNotRealHome(join(homedir(), '.eyas-hostile-home-test-never-created', 'x'))).toThrow(/inside-real-home/)
  })

  it('accepts a fresh dir under the OS temp dir', () => {
    expect(() => assertNotRealHome(join(tmpdir(), 'eyas-hh-not-created'))).not.toThrow()
  })
})

describe('snapshotTree / diffSnapshots', () => {
  it('reports added, modified and removed files (positive)', () => {
    const h = build()
    const before = snapshotTree(h.home)
    writeFileSync(join(h.home, 'new.txt'), 'n')
    writeFileSync(join(h.home, '.claude.json'), '{}\n')
    rmSync(join(h.home, '.grok', 'AGENTS.md'))
    mkdirSync(join(h.home, '.claude', 'sessions'))
    const diff = diffSnapshots(before, snapshotTree(h.home))
    expect(diff.added).toEqual(['.claude/sessions', 'new.txt'])
    expect(diff.modified).toEqual(['.claude.json'])
    expect(diff.removed).toEqual(['.grok/AGENTS.md'])
  })

  it('reports nothing when nothing changed, and never follows symlinks (negative)', () => {
    const h = build()
    const outside = mkdtempSync(join(tmpdir(), 'eyas-hh-outside-'))
    scratch.push(outside)
    symlinkSync(outside, join(h.home, 'link-out'))
    const before = snapshotTree(h.home)
    writeFileSync(join(outside, 'changed.txt'), 'x')
    const diff = diffSnapshots(before, snapshotTree(h.home))
    expect(diff).toEqual({ added: [], modified: [], removed: [] })
    expect(before.get('link-out')?.type).toBe('symlink')
  })

  it('honours the exclude filter', () => {
    const h = build()
    const snap = snapshotTree(h.home, { exclude: (p) => p.startsWith('.grok') })
    expect([...snap.keys()].some((k) => k.startsWith('.grok'))).toBe(false)
    expect(snap.has('.claude.json')).toBe(true)
  })
})

describe('helpers', () => {
  it('hostileProcessEnv carries every variable an env allowlist must strip', () => {
    const h = build()
    const env = hostileProcessEnv(h)
    expect(env.HOME).toBe(h.home)
    for (const key of ['GROK_MEMORY', 'GROK_FOLDER_TRUST', 'CLAUDECODE', 'CLAUDE_CODE_SIMPLE', 'XAI_API_KEY', 'OPENAI_API_KEY', 'XDG_CONFIG_HOME']) {
      expect(env[key]).toBeTruthy()
    }
    expect(env.CLAUDECODE).toBe('1')
  })

  it('tomlString escapes quotes, backslashes and control characters', () => {
    expect(tomlString('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(tomlString('x\ny')).toBe('"x\\u000ay"')
  })

  it('claudeProjectSlug replaces every non-alphanumeric character', () => {
    expect(claudeProjectSlug('/tmp/a b/c.d')).toBe('-tmp-a-b-c-d')
  })
})
