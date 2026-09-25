// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  DEFAULT_REDACT_KEYS,
  KIMI_SOURCE_FACTS,
  PAID_FLAG,
  SPIKE_STEPS,
  candidateGrokConfigToml,
  candidateGrokEnv,
  candidateGrokRequirementsToml,
  findFixtureLeaks,
  paidLaneEnabled,
  planSpike,
  redact,
  writeFixture,
} from '../../scripts/cli-isolation-spike'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'eyas-spike-test-'))
  dirs.push(d)
  return d
}

describe('spike plan', () => {
  it('skips every paid step without EYAS_SPIKE_ALLOW_PAID (negative)', () => {
    for (const env of [{}, { [PAID_FLAG]: '0' }, { [PAID_FLAG]: 'true' }, { [PAID_FLAG]: 'yes' }]) {
      expect(paidLaneEnabled(env)).toBe(false)
      const paid = planSpike(env).filter((s) => s.paid)
      expect(paid.length).toBeGreaterThan(0)
      for (const step of paid) {
        expect(step.run).toBe(false)
        expect(step.skipReason).toContain(PAID_FLAG)
      }
    }
  })

  it('runs every free step by default and the paid ones only with the flag (positive)', () => {
    const free = planSpike({}).filter((s) => !s.paid)
    expect(free.every((s) => s.run)).toBe(true)
    const withFlag = planSpike({ [PAID_FLAG]: '1' })
    expect(paidLaneEnabled({ [PAID_FLAG]: '1' })).toBe(true)
    expect(withFlag.filter((s) => s.paid).every((s) => s.run)).toBe(true)
  })

  it('honours --only and EYAS_SPIKE_SKIP_NETWORK', () => {
    const onlyKimi = planSpike({}, ['kimi'])
    expect(onlyKimi.filter((s) => s.run).map((s) => s.cli)).toEqual(['kimi'])
    const offline = planSpike({ EYAS_SPIKE_SKIP_NETWORK: '1' })
    const deviceAuth = offline.find((s) => s.id === 'grok.device-auth')
    expect(deviceAuth?.run).toBe(false)
    expect(offline.filter((s) => s.network).every((s) => !s.run)).toBe(true)
  })

  it('has unique step ids and never marks a network step as paid', () => {
    const ids = SPIKE_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(SPIKE_STEPS.filter((s) => s.network && s.paid)).toEqual([])
  })
})

describe('fixture writer', () => {
  it('writes well-formed JSON with a trailing newline (positive)', () => {
    const dir = tempDir()
    const path = writeFixture(dir, 'grok/1.0.40/x.json', { a: [1, { b: 'c' }] })
    const text = readFileSync(path, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({ a: [1, { b: 'c' }] })
  })

  it('writes text fixtures verbatim with one trailing newline', () => {
    const dir = tempDir()
    expect(readFileSync(writeFixture(dir, 'a.txt', 'line'), 'utf8')).toBe('line\n')
    expect(readFileSync(writeFixture(dir, 'b.txt', 'line\n'), 'utf8')).toBe('line\n')
  })

  it('redacts paths in values and keys, and machine identifiers by key', () => {
    const value = {
      cwd: '/tmp/root/project/x',
      nested: [{ '/tmp/root/key': 'ok' }],
      _meta: { hostname: 'host.local', agentId: 'abc', keep: 'visible' },
      nothing: null,
    }
    const out = redact(value, [{ from: '/tmp/root', to: '<ROOT>' }, { from: /\d+/g, to: 'N' }])
    expect(out.cwd).toBe('<ROOT>/project/x')
    expect(Object.keys(out.nested[0] ?? {})).toEqual(['<ROOT>/key'])
    expect(out._meta.hostname).toBe('<REDACTED>')
    expect(out._meta.agentId).toBe('<REDACTED>')
    expect(out._meta.keep).toBe('visible')
    expect(out.nothing).toBeNull()
    expect(DEFAULT_REDACT_KEYS).toContain('machineID')
  })

  it('flags a fixture that leaks a forbidden string (negative) and passes a clean one (positive)', () => {
    const dir = tempDir()
    writeFixture(dir, 'clean.json', { path: '<ROOT>/x' })
    expect(findFixtureLeaks(dir, ['/secret/root'])).toEqual([])
    writeFixture(dir, 'sub/leak.json', { path: '/secret/root/x' })
    expect(findFixtureLeaks(dir, ['/secret/root'])).toEqual(['sub/leak.json: /secret/root'])
  })
})

describe('candidate EYAS-owned grok home (A5 input)', () => {
  it('uses only keys grok 1.0.40 accepts and the planned ask rules', () => {
    const cfg = candidateGrokConfigToml()
    expect(cfg).toContain('permission_mode = "ask"')
    expect(cfg).toContain('ask = ["Read", "Edit", "Grep", "Bash", "WebFetch", "WebSearch"]')
    expect(cfg).toContain('allow = ["MCPTool(eyas__*)"]')
    // Rejected by 1.0.40 as unknown config keys (inspect configWarnings).
    expect(cfg).not.toContain('[folder_trust]')
    expect(cfg).not.toContain('save_on_end')
    expect(cfg).not.toContain('disable_bypass_permissions_mode')
  })

  it('puts the always-approve lock and the MCP allowlist in requirements.toml', () => {
    expect(candidateGrokRequirementsToml()).toContain('disable_bypass_permissions_mode = true')
    expect(candidateGrokRequirementsToml()).not.toContain('allowed_mcp_servers')
    const allow = candidateGrokRequirementsToml({ mcpAllowlist: ['eyas'] })
    expect(allow).toContain('enable_all_project_mcp_servers = false')
    expect(allow).toContain('[[allowed_mcp_servers]]\nserver_name = "eyas"')
  })

  it('points HOME and GROK_HOME at the EYAS home and adds no credential by itself', () => {
    const env = candidateGrokEnv('/x/cli-homes/grok-cli', '/x/tmp')
    expect(env.HOME).toBe('/x/cli-homes/grok-cli')
    expect(env.GROK_HOME).toBe('/x/cli-homes/grok-cli/.grok')
    expect(env.GROK_MEMORY).toBe('0')
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.GROK_FOLDER_TRUST).toBeUndefined()
    expect(candidateGrokEnv('/h', '/t', { XAI_API_KEY: 'k' }).XAI_API_KEY).toBe('k')
  })
})

describe('kimi source facts', () => {
  it('are marked unverified and pin the argv to exactly [acp]', () => {
    expect(KIMI_SOURCE_FACTS.verified).toBe(false)
    expect(KIMI_SOURCE_FACTS.acpEntry.argv).toEqual(['acp'])
    expect(KIMI_SOURCE_FACTS.shareDir.env).toBe('KIMI_SHARE_DIR')
    expect(Object.keys(KIMI_SOURCE_FACTS.configKeys)).toEqual(expect.arrayContaining(['default_yolo', 'default_model', 'default_thinking']))
  })
})

// ── The committed fixtures ────────────────────────────────────────────────────

const FIXTURES = resolve(__dirname, '..', 'fixtures', 'cli')

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'))
}

describe('committed CLI fixtures', () => {
  const files = listFiles(FIXTURES)

  it('are all well-formed JSON (or text) and carry no machine-specific path', () => {
    expect(files.length).toBeGreaterThan(20)
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      if (f.endsWith('.json')) expect(() => JSON.parse(text), relative(FIXTURES, f)).not.toThrow()
      expect(text, relative(FIXTURES, f)).not.toContain(homedir())
      expect(text, relative(FIXTURES, f)).not.toMatch(/\/private\/var\/folders|\/var\/folders\/|\/Users\/|\/home\/[a-z]|-var-folders-/)
    }
  })

  it('pin the grok 1.0.40 permission routing: every native tool class asks over ACP under the EYAS config', () => {
    const kinds = readJson('grok/1.0.40/permission-requests.json').map((p: any) => p.toolCall?.kind)
    expect(kinds).toEqual(expect.arrayContaining(['read', 'other', 'search', 'execute', 'edit']))
    const hostile = readJson('grok/1.0.40/hostile-control.json')
    expect(hostile.permissionRequests).toBe(0)
    expect(hostile.markersFired.length).toBeGreaterThan(0)
    expect(hostile.sentinelsInModelRequests.length).toBeGreaterThan(0)
  })

  it('pin the grok 1.0.40 facts A5/A6/I8 build on', () => {
    expect(readJson('grok/1.0.40/session-new.json')).not.toHaveProperty('modes')
    const sp = readJson('grok/1.0.40/system-prompt-file.json')
    expect(sp.atSessionNew.containsNonce).toBe(false)
    expect(sp.atFirstModelRequest.containsNonce).toBe(true)
    const lock = readJson('grok/1.0.40/always-approve-lock.json')
    expect(lock['control-no-command'].readRanWithoutPermission).toBe(false)
    expect(lock['with-requirements-lock'].readRanWithoutPermission).toBe(true)
    const allow = readJson('grok/1.0.40/mcp-allowlist.json')
    expect(allow['allowlist-eyas'].started).toEqual(['acp-eyas'])
    expect(readJson('grok/1.0.40/in-root-project-run.json').projectMcpOrHookRan).toEqual([])
    expect(readJson('grok/1.0.40/hostile-home-untouched.json')).toMatchObject({ added: [], modified: [], removed: [] })
  })

  it('pin the Claude Code host-write baseline: no transcript or content-bearing file under the isolated options', () => {
    const dirs = readdirSync(join(FIXTURES, 'claude-code'))
    expect(dirs.length).toBeGreaterThan(0)
    for (const v of dirs) {
      const init = readJson(`claude-code/${v}/host-writes.json`)
      expect(init.modelRequestSent).toBe(false)
      expect(init.contentBearingWrites).toEqual([])
      const turn = readJson(`claude-code/${v}/host-writes-full-turn.json`)
      expect(turn.contentBearingWrites).toEqual([])
      expect(turn.canaryInHostFiles).toEqual([])
      expect(turn.sentinelsInModelRequests).toEqual([])
      const control = readJson(`claude-code/${v}/control-unisolated.json`)
      expect(control.contentBearingWrites.some((p: string) => p.endsWith('.jsonl'))).toBe(true)
    }
  })
})

it('fixtures dir resolves inside the repo', () => {
  expect(relative(resolve(__dirname, '..', '..'), FIXTURES)).toBe(join('tests', 'fixtures', 'cli'))
})
