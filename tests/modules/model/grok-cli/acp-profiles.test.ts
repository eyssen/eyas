// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A5 — the ACP launch profiles: argv, environment, EYAS-owned managed files
// and the session-store lifecycle for Grok and Kimi. The grok files are
// compared with the candidate the A1 spike proved on grok 1.0.40
// (tests/fixtures/cli/grok/1.0.40/managed-files.json).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GROK_CONFIG_TOML,
  GROK_REQUIREMENTS_TOML,
  KIMI_MANAGED_KEYS,
  activeSessionStoreRuns,
  buildGrokArgs,
  buildKimiArgs,
  createAcpProfile,
  openSessionStoreRun,
  startSessionStoreSweeper,
  upsertTomlTopLevelBooleans,
} from '@modules/model/submodules/grok-cli/acp-profiles.js'

const TOML = (globalThis as unknown as { Bun: { TOML: { parse(s: string): any } } }).Bun.TOML
const fixture = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'fixtures', 'cli', 'grok', '1.0.40', 'managed-files.json'), 'utf8'))

let root: string
let homesDir: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-profiles-')))
  homesDir = join(root, 'data', 'cli-homes')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const hostEnv: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  LANG: 'en_US.UTF-8',
  HOME: '/Users/operator',
  GROK_HOME: '/Users/operator/.grok',
  GROK_MEMORY: '1',
  GROK_FOLDER_TRUST: '0',
  GROK_CONFIG: '/Users/operator/grok-overlay.toml',
  KIMI_SHARE_DIR: '/Users/operator/.kimi',
  XAI_API_KEY: 'host-xai',
  OPENAI_API_KEY: 'host-openai',
  XDG_CONFIG_HOME: '/Users/operator/.config',
  EYAS_DATA_DIR: '/srv/eyas/data',
}

describe('argv', () => {
  it('grok: agent --no-leader [--model X] stdio, never --always-approve or --trust', () => {
    expect(buildGrokArgs()).toEqual(['agent', '--no-leader', 'stdio'])
    const args = createAcpProfile('grok-cli', { homesDir }).buildArgs({ model: 'grok-4.5' })
    expect(args).toEqual(['agent', '--no-leader', '--model', 'grok-4.5', 'stdio'])
    expect(args).not.toContain('--always-approve')
    expect(args).not.toContain('--trust')
  })

  it('kimi: exactly [acp], even when a model and thinking are requested (negative)', () => {
    expect(buildKimiArgs()).toEqual(['acp'])
    const profile = createAcpProfile('kimi-cli', { homesDir })
    const args = profile.buildArgs({ model: 'kimi-k3' })
    expect(args).toEqual(['acp'])
    expect(args).not.toContain('--model')
    expect(args).not.toContain('--thinking')
  })
})

describe('environment', () => {
  it('grok: GROK_HOME under the EYAS home, isolation switches on', () => {
    const profile = createAcpProfile('grok-cli', { homesDir, sourceEnv: hostEnv })
    const env = profile.env()
    expect(profile.home).toBe(join(homesDir, 'grok-cli'))
    expect(env.HOME).toBe(profile.home)
    expect(env.GROK_HOME).toBe(join(homesDir, 'grok-cli', '.grok'))
    expect(env.GROK_MEMORY).toBe('0')
    for (const key of ['SKILLS', 'RULES', 'AGENTS', 'MCPS', 'HOOKS', 'SESSIONS']) {
      expect(env[`GROK_CLAUDE_${key}_ENABLED`]).toBe('false')
    }
    for (const key of ['SKILLS', 'RULES', 'AGENTS', 'MCPS', 'HOOKS']) {
      expect(env[`GROK_CURSOR_${key}_ENABLED`]).toBe('false')
    }
    expect(env.GROK_TELEMETRY_TRACE_UPLOAD).toBe('0')
    expect(env.GROK_SESSION_SEARCH).toBe('0')
    expect(env.GROK_REMEMBER_TOOL_APPROVALS).toBe('false')
    expect(env.GROK_DISABLE_AUTOUPDATER).toBe('1')
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(env.LANG).toBe('en_US.UTF-8')
  })

  it('grok: lacks the host HOME, host GROK_*, GROK_FOLDER_TRUST and provider keys (negative)', () => {
    const env = createAcpProfile('grok-cli', { homesDir, sourceEnv: hostEnv }).env()
    expect(env.HOME).not.toBe('/Users/operator')
    expect(env.GROK_HOME).not.toBe('/Users/operator/.grok')
    for (const key of ['GROK_FOLDER_TRUST', 'GROK_CONFIG', 'KIMI_SHARE_DIR', 'XAI_API_KEY', 'OPENAI_API_KEY', 'XDG_CONFIG_HOME', 'EYAS_DATA_DIR', 'GROK_STORAGE_MODE']) {
      expect(env, key).not.toHaveProperty(key)
    }
    expect(JSON.stringify(env)).not.toContain('/Users/operator')
  })

  it('kimi: its share dir under the EYAS home, auto-update off, nothing of Grok (negative)', () => {
    const profile = createAcpProfile('kimi-cli', { homesDir, sourceEnv: hostEnv })
    const env = profile.env()
    expect(env.HOME).toBe(join(homesDir, 'kimi-cli'))
    expect(env.KIMI_SHARE_DIR).toBe(join(homesDir, 'kimi-cli', '.kimi'))
    expect(env.KIMI_CLI_NO_AUTO_UPDATE).toBe('1')
    expect(Object.keys(env).some((k) => k.startsWith('GROK_'))).toBe(false)
    expect(env).not.toHaveProperty('XAI_API_KEY')
  })

  it('extraEnv (the sign-in seam) and the call-site extra are applied last; undefined removes', () => {
    const profile = createAcpProfile('grok-cli', {
      homesDir,
      sourceEnv: hostEnv,
      extraEnv: () => ({ XAI_API_KEY: 'eyas-stored', GROK_MEMORY: '0' }),
    })
    expect(profile.env().XAI_API_KEY).toBe('eyas-stored')
    const env = profile.env({ GROK_SANDBOX: 'workspace', XAI_API_KEY: undefined })
    expect(env.GROK_SANDBOX).toBe('workspace')
    expect(env).not.toHaveProperty('XAI_API_KEY')
  })
})

describe('grok managed files', () => {
  it('config.toml: ask mode, ask rules for every native tool class, memory/compat/leader/telemetry off', () => {
    const config = TOML.parse(GROK_CONFIG_TOML)
    expect(config.ui.permission_mode).toBe('ask')
    expect(config.ui.remember_tool_approvals).toBe(false)
    expect(config.permission.ask).toEqual(['Read', 'Edit', 'Grep', 'Bash', 'WebFetch', 'WebSearch'])
    expect(config.permission.allow).toEqual(['MCPTool(eyas__*)'])
    expect(config.memory.enabled).toBe(false)
    expect(Object.values(config.memory_v2)).toEqual([false, false, false, false])
    expect(config.cli).toEqual({ auto_update: false, use_leader: false, session_registry: false })
    expect(config.features).toEqual({ session_search: false, telemetry: false })
    expect(config.telemetry.trace_upload).toBe(false)
    for (const cells of Object.values(config.compat) as Array<Record<string, boolean>>) {
      expect(Object.values(cells).every((v) => v === false)).toBe(true)
    }
    expect(config).not.toHaveProperty('paths')
  })

  it('config.toml carries no key grok 1.0.40 rejects as unknown (negative)', () => {
    const config = TOML.parse(GROK_CONFIG_TOML)
    expect(config).not.toHaveProperty('folder_trust')
    expect(config.session?.save_on_end).toBeUndefined()
    expect(config.ui).not.toHaveProperty('disable_bypass_permissions_mode')
  })

  it('config.toml and requirements.toml are the candidate the A1 spike proved on grok 1.0.40', () => {
    expect(TOML.parse(GROK_CONFIG_TOML)).toEqual(TOML.parse(fixture.files['config.toml']))
    expect(TOML.parse(GROK_REQUIREMENTS_TOML)).toEqual(TOML.parse(fixture.requirementsWithMcpAllowlist))
  })

  it('requirements.toml locks always-approve out and allows only the eyas MCP server', () => {
    const req = TOML.parse(GROK_REQUIREMENTS_TOML)
    expect(req.ui.disable_bypass_permissions_mode).toBe(true)
    expect(req.enable_all_project_mcp_servers).toBe(false)
    expect(req.allowed_mcp_servers).toEqual([{ server_name: 'eyas' }])
    expect(req.memory.enabled).toBe(false)
    expect(req.memory_v2.enabled).toBe(false)
    expect(req.telemetry.trace_upload).toBe(false)
    expect(req.cli.use_leader).toBe(false)
    expect(req.features.session_search).toBe(false)
  })

  it('ensureHome writes a 0700 home with 0600 files, idempotently, and resets folder trust', () => {
    const profile = createAcpProfile('grok-cli', { homesDir })
    profile.ensureHome()
    const grokDir = join(profile.home, '.grok')
    expect(statSync(profile.home).mode & 0o777).toBe(0o700)
    expect(statSync(join(grokDir, 'config.toml')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(grokDir, 'config.toml'), 'utf8')).toBe(GROK_CONFIG_TOML)
    expect(readFileSync(join(grokDir, 'requirements.toml'), 'utf8')).toBe(GROK_REQUIREMENTS_TOML)
    expect(readFileSync(join(grokDir, 'trusted_folders.toml'), 'utf8')).toBe('')

    // Something (the model's own shell, a grok prompt) granted trust in between.
    writeFileSync(join(grokDir, 'trusted_folders.toml'), '"/some/project" = true\n')
    const before = statSync(join(grokDir, 'config.toml')).mtimeMs
    profile.ensureHome()
    expect(readFileSync(join(grokDir, 'trusted_folders.toml'), 'utf8')).toBe('')
    expect(statSync(join(grokDir, 'config.toml')).mtimeMs).toBe(before)
  })

  it('refuses a config.toml replaced by a symlink to a host file, which stays untouched (negative)', () => {
    const hostFile = join(root, 'host-config.toml')
    writeFileSync(hostFile, 'permission_mode = "always-approve"\n')
    const profile = createAcpProfile('grok-cli', { homesDir })
    mkdirSync(join(profile.home, '.grok'), { recursive: true })
    symlinkSync(hostFile, join(profile.home, '.grok', 'config.toml'))
    expect(() => profile.ensureHome()).toThrow(/not a regular file/)
    expect(readFileSync(hostFile, 'utf8')).toBe('permission_mode = "always-approve"\n')
  })

  it('creating a profile touches nothing on disk (pure until ensureHome)', () => {
    createAcpProfile('grok-cli', { homesDir })
    createAcpProfile('kimi-cli', { homesDir })
    expect(existsSync(homesDir)).toBe(false)
  })
})

describe('kimi managed config', () => {
  function kimiConfig(profile: ReturnType<typeof createAcpProfile>): string {
    return readFileSync(join(profile.home, '.kimi', 'config.toml'), 'utf8')
  }

  it('upserts only EYAS keys: a sign-in [providers] table and set_model defaults survive', () => {
    const profile = createAcpProfile('kimi-cli', { homesDir })
    mkdirSync(join(profile.home, '.kimi'), { recursive: true })
    writeFileSync(join(profile.home, '.kimi', 'config.toml'), [
      'default_model = "x"',
      'default_thinking = true',
      '',
      '[models.x]',
      'provider = "managed:kimi-code"',
      'model = "kimi-k3"',
      '',
      '[providers."managed:kimi-code"]',
      'type = "kimi"',
      'base_url = "https://api.example.invalid/v1"',
      '',
    ].join('\n'))
    profile.ensureHome()
    const parsed = TOML.parse(kimiConfig(profile))
    expect(parsed.default_model).toBe('x')
    expect(parsed.default_thinking).toBe(true)
    expect(parsed.models.x).toEqual({ provider: 'managed:kimi-code', model: 'kimi-k3' })
    expect(parsed.providers['managed:kimi-code'].type).toBe('kimi')
    for (const [key, value] of Object.entries(KIMI_MANAGED_KEYS)) expect(parsed[key]).toBe(value)
    expect(readFileSync(join(profile.home, '.kimi', 'mcp.json'), 'utf8')).toBe('{\n  "mcpServers": {}\n}\n')
  })

  it('flips default_yolo=true back to false and re-disables telemetry/skill merging (negative)', () => {
    const profile = createAcpProfile('kimi-cli', { homesDir })
    mkdirSync(join(profile.home, '.kimi'), { recursive: true })
    writeFileSync(join(profile.home, '.kimi', 'config.toml'), 'default_yolo = true\ntelemetry = true\nmerge_all_available_skills = true\n')
    profile.ensureHome()
    const parsed = TOML.parse(kimiConfig(profile))
    expect(parsed.default_yolo).toBe(false)
    expect(parsed.telemetry).toBe(false)
    expect(parsed.merge_all_available_skills).toBe(false)
    // Idempotent: a second run leaves the file as it is.
    const once = kimiConfig(profile)
    profile.ensureHome()
    expect(kimiConfig(profile)).toBe(once)
  })

  it('creates the config from nothing and empties a planted mcp.json', () => {
    const profile = createAcpProfile('kimi-cli', { homesDir })
    mkdirSync(join(profile.home, '.kimi'), { recursive: true })
    writeFileSync(join(profile.home, '.kimi', 'mcp.json'), '{"mcpServers":{"vault":{"command":"mcpvault"}}}')
    profile.ensureHome()
    expect(TOML.parse(kimiConfig(profile))).toEqual({ ...KIMI_MANAGED_KEYS })
    expect(JSON.parse(readFileSync(join(profile.home, '.kimi', 'mcp.json'), 'utf8'))).toEqual({ mcpServers: {} })
  })

  it('refuses a config.toml that is a symlink to a host file (negative)', () => {
    const hostFile = join(root, 'host-kimi.toml')
    writeFileSync(hostFile, 'default_yolo = true\n')
    const profile = createAcpProfile('kimi-cli', { homesDir })
    mkdirSync(join(profile.home, '.kimi'), { recursive: true })
    symlinkSync(hostFile, join(profile.home, '.kimi', 'config.toml'))
    expect(() => profile.ensureHome()).toThrow(/not a regular file/)
    expect(readFileSync(hostFile, 'utf8')).toBe('default_yolo = true\n')
  })

  it('refuses a config it cannot update safely instead of handing it to the CLI (negative)', () => {
    const profile = createAcpProfile('kimi-cli', { homesDir })
    mkdirSync(join(profile.home, '.kimi'), { recursive: true })
    // A dotted top-level `telemetry` table collides with the managed boolean.
    writeFileSync(join(profile.home, '.kimi', 'config.toml'), 'telemetry.endpoint = "https://example.invalid"\n')
    expect(() => profile.ensureHome()).toThrow(/kimi-cli/)
  })
})

describe('upsertTomlTopLevelBooleans', () => {
  const keys = { a: false, b: true }

  it('replaces existing top-level assignments in place and keeps tables byte for byte', () => {
    const doc = '# head\na = true\nb = false\n\n[t]\na = true\n'
    expect(upsertTomlTopLevelBooleans(doc, keys)).toBe('# head\na = false\nb = true\n\n[t]\na = true\n')
  })

  it('adds missing keys above the first table, never inside it', () => {
    const out = upsertTomlTopLevelBooleans('x = 1\n\n[t]\ny = 2\n', keys)
    expect(out).toBe('x = 1\na = false\nb = true\n\n[t]\ny = 2\n')
    expect(TOML.parse(out)).toEqual({ x: 1, a: false, b: true, t: { y: 2 } })
  })

  it('handles an empty document and a document that starts with a table', () => {
    expect(upsertTomlTopLevelBooleans('', keys)).toBe('a = false\nb = true\n')
    const out = upsertTomlTopLevelBooleans('[[arr]]\nz = 1\n', keys)
    expect(TOML.parse(out)).toEqual({ a: false, b: true, arr: [{ z: 1 }] })
  })

  it('does not treat a same-named key inside a table as top level (negative)', () => {
    const out = upsertTomlTopLevelBooleans('[t]\na = true\n', { a: false })
    expect(TOML.parse(out)).toEqual({ a: false, t: { a: true } })
  })
})

describe('session store lifecycle', () => {
  function plant(profile: ReturnType<typeof createAcpProfile>, name: string, ageMs = 0): string {
    const dir = join(profile.sessionStorePath, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'chat_history.jsonl'), '{"role":"user","text":"secret"}\n')
    if (ageMs > 0) {
      const at = (Date.now() - ageMs) / 1000
      utimesSync(dir, at, at)
    }
    return dir
  }

  it('purges the store when the last run on it ends, not while another run is active', () => {
    const profile = createAcpProfile('grok-cli', { homesDir })
    profile.ensureHome()
    const endA = openSessionStoreRun(profile)
    const endB = openSessionStoreRun(profile)
    plant(profile, 'enc-cwd-a')
    plant(profile, 'enc-cwd-b')
    expect(activeSessionStoreRuns(profile)).toBe(2)

    endA()
    endA() // idempotent: does not end run B
    expect(activeSessionStoreRuns(profile)).toBe(1)
    expect(readdirSync(profile.sessionStorePath).sort()).toEqual(['enc-cwd-a', 'enc-cwd-b'])

    endB()
    expect(activeSessionStoreRuns(profile)).toBe(0)
    expect(readdirSync(profile.sessionStorePath)).toEqual([])
    expect(existsSync(join(profile.home, '.grok', 'config.toml'))).toBe(true)
  })

  it('never follows a store replaced by a symlink out of the homes (negative)', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'keep')
    const profile = createAcpProfile('grok-cli', { homesDir })
    profile.ensureHome()
    symlinkSync(outside, profile.sessionStorePath)
    const end = openSessionStoreRun(profile)
    end() // logs and keeps going, never throws
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
    expect(lstatSync(profile.sessionStorePath).isSymbolicLink()).toBe(true)
  })

  it('the sweeper removes stale entries at boot and skips a store a run is using', () => {
    const profile = createAcpProfile('kimi-cli', { homesDir })
    profile.ensureHome()
    plant(profile, 'stale', 2 * 60 * 60 * 1000)
    plant(profile, 'fresh')

    const end = openSessionStoreRun(profile)
    const stopBusy = startSessionStoreSweeper(profile)
    stopBusy()
    expect(readdirSync(profile.sessionStorePath).sort()).toEqual(['fresh', 'stale'])
    // Ending the run purges everything anyway; plant again for the idle sweep.
    end()
    plant(profile, 'stale', 2 * 60 * 60 * 1000)
    plant(profile, 'fresh')

    const stop = startSessionStoreSweeper(profile)
    stop()
    expect(readdirSync(profile.sessionStorePath)).toEqual(['fresh'])
  })

  it('the sweeper is a no-op when the homes do not exist yet (negative)', () => {
    const profile = createAcpProfile('grok-cli', { homesDir })
    const stop = startSessionStoreSweeper(profile)
    stop()
    expect(existsSync(homesDir)).toBe(false)
  })
})
