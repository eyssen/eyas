// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A6 — the fail-closed layers around an ACP session: the preflight (grok
// inspect + read-back of EYAS's files; Kimi's home read-back), the
// session/new check and the runtime tripwire. The inspect reports are the
// ones the A1 spike recorded from grok 1.0.40.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAcpPreflightCache,
  createAcpTripwire,
  createAcpVerifier,
  evaluateGrokInspect,
  evaluateKimiHome,
  evaluateSessionNew,
  parseInspectOutput,
  readBackManagedFiles,
  tomlHasNoSettings,
  tripwirePolicyFor,
  verifyAcpIsolationAtLoad,
  type InspectRunner,
} from '@modules/model/submodules/grok-cli/acp-verify.js'
import { parseAcpSessionUpdate } from '@modules/model/submodules/grok-cli/acp-events.js'
import { createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import { createGrokSandboxProfiles, resetGrokSandboxProfilesForTests } from '@modules/model/submodules/grok-cli/sandbox-profile.js'
import { CliIsolationError, getIsolationStatus, resetIsolationStatuses, setIsolationStatus } from '@modules/model/cli-runtime/isolation.js'
import { classifyModelError } from '@shared/classify-model-error.js'

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures', 'cli', 'grok', '1.0.40')

let base: string
let homesDir: string
let project: string
let hostHome: string

/** A recorded inspect report with this test's real paths in place of the placeholders. */
function inspectFixture(name: string): any {
  const text = readFileSync(join(FIXTURES, `inspect-${name}.json`), 'utf8')
    .replaceAll('<EYAS_HOMES>', homesDir)
    .replaceAll('<ROOT>/workspaces/conv-1', project)
    .replaceAll('<PROJECT>', project)
    .replaceAll('<HOME>', hostHome)
  return JSON.parse(text)
}

const configDir = () => join(homesDir, 'grok-cli', '.grok')
const checksOf = (violations: Array<{ check: string }>) => [...new Set(violations.map((v) => v.check))].sort()

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-verify-')))
  homesDir = join(base, 'data', 'cli-homes')
  project = join(base, 'workspace')
  hostHome = join(base, 'host-home')
  mkdirSync(project, { recursive: true })
  resetIsolationStatuses()
  clearAcpPreflightCache()
})

afterEach(() => {
  resetIsolationStatuses()
  clearAcpPreflightCache()
  rmSync(base, { recursive: true, force: true })
})

describe('evaluateGrokInspect (grok 1.0.40 reports)', () => {
  it('the hostile setup fails permission mode, MCP servers, hooks, memory, rules, compat and leader (negative)', () => {
    const verdict = evaluateGrokInspect(inspectFixture('hostile'), { configDir: configDir(), roots: [project] })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(checksOf(verdict.violations)).toEqual(['compat', 'hooks', 'leader', 'mcpServers', 'memory', 'permissionMode', 'rules'])
    // Every host MCP server is named in the details.
    const mcp = verdict.violations.filter((v) => v.check === 'mcpServers').map((v) => v.detail).join('\n')
    expect(mcp).toContain('eyas-sentinel-claude-home')
    expect(mcp).toContain('eyas-sentinel-grok-home')
  })

  it('the isolated setup passes (positive)', () => {
    const verdict = evaluateGrokInspect(inspectFixture('isolated'), { configDir: configDir(), roots: [project] })
    expect(verdict).toEqual({ ok: true, version: '1.0.40', violations: [] })
  })

  it("an untrusted in-root project's listed MCP servers fail unless the allowlist disables them", () => {
    const listed = evaluateGrokInspect(inspectFixture('in-root-project'), { configDir: configDir(), roots: [project] })
    expect(listed.ok && checksOf(listed.violations)).toEqual(['mcpServers'])
    // With EYAS's requirements allowlist grok marks them disabled: harmless.
    const allowlisted = evaluateGrokInspect(inspectFixture('mcp-allowlist'), { configDir: join(homesDir, 'grok-cli-allowlist', '.grok'), roots: [project] })
    expect(allowlisted).toEqual({ ok: true, version: '1.0.40', violations: [] })
  })

  it("the in-root project's AGENTS.md alone is not a violation (positive)", () => {
    const report = inspectFixture('in-root-project')
    report.mcpServers = []
    report.projectInstructions = [{ path: join(project, 'AGENTS.md'), scope: 'project', fileType: 'agents_md' }]
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict).toEqual({ ok: true, version: '1.0.40', violations: [] })
  })

  it('an AGENTS.md in GROK_HOME or a ~/.claude compat rule is a rules violation (negative)', () => {
    const report = inspectFixture('isolated')
    report.projectInstructions = [
      { path: join(configDir(), 'AGENTS.md'), scope: 'global', fileType: 'agents_md' },
      { path: join(homesDir, 'grok-cli', '.claude', 'CLAUDE.md'), scope: 'global', vendor: 'claude' },
    ]
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict.ok && verdict.violations.map((v) => v.check)).toEqual(['rules', 'rules'])
  })

  it('a project instruction file outside the roots is a rules violation (negative)', () => {
    const report = inspectFixture('isolated')
    report.projectInstructions = [{ path: join(base, 'AGENTS.md'), scope: 'project' }]
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict.ok && checksOf(verdict.violations)).toEqual(['rules'])
  })

  it('a skill planted in the EYAS home is a rules violation; a built-in agent is not', () => {
    const report = inspectFixture('isolated')
    report.skills = [{ name: 'planted', source: { type: 'user', path: join(configDir(), 'skills', 'planted', 'SKILL.md') } }]
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict.ok && checksOf(verdict.violations)).toEqual(['rules'])
  })

  it('an MCP server, hook or plugin in the EYAS home fails its check (negative)', () => {
    const report = inspectFixture('isolated')
    report.mcpServers = [{ name: 'mcpvault', transport: 'stdio', source: { type: 'configToml', path: join(configDir(), 'config.toml') } }]
    report.hooks = [{ event: 'session_start', source: { type: 'user', path: join(configDir(), 'hooks') } }]
    report.plugins = [{ name: 'memory-plugin' }]
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict.ok && checksOf(verdict.violations)).toEqual(['hooks', 'mcpServers', 'plugins'])
  })

  it('a missing or disabled always-approve lock is a permission-mode violation (negative)', () => {
    const missing = inspectFixture('isolated')
    delete missing.permissions.enforced
    expect(checksOf((evaluateGrokInspect(missing, { configDir: configDir(), roots: [project] }) as any).violations)).toEqual(['permissionMode'])
    const off = inspectFixture('isolated')
    off.permissions.enforced = [{ setting: 'alwaysApprove', enabled: true, source: 'x' }]
    expect(checksOf((evaluateGrokInspect(off, { configDir: configDir(), roots: [project] }) as any).violations)).toEqual(['permissionMode'])
  })

  it('a trusted project folder whose config applies is a folder-trust violation (negative)', () => {
    const report = inspectFixture('in-root-project')
    report.mcpServers = []
    report.projectTrusted = true
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict.ok && checksOf(verdict.violations)).toEqual(['folderTrust'])
  })

  it("grok's empty cache of the vendor-managed layer passes; one with a setting, or a managed layer elsewhere, fails (1.0.41)", () => {
    const withManaged = (path: string) => {
      const report = inspectFixture('isolated')
      report.configSources.layers.push({ role: 'managed', path })
      return report
    }
    const own = join(configDir(), 'managed_config.toml')
    expect(evaluateGrokInspect(withManaged(own), { configDir: configDir(), roots: [project], managedLayerEmpty: () => true })).toMatchObject({ ok: true, violations: [] })

    const withSetting = evaluateGrokInspect(withManaged(own), { configDir: configDir(), roots: [project], managedLayerEmpty: () => false })
    expect(checksOf((withSetting as any).violations)).toEqual(['leader', 'memory', 'permissionMode'])
    // No reader at all: fail closed.
    expect(checksOf((evaluateGrokInspect(withManaged(own), { configDir: configDir(), roots: [project] }) as any).violations)).toEqual(['leader', 'memory', 'permissionMode'])
    // A managed layer from anywhere but GROK_HOME's own cache is never waved through.
    const elsewhere = evaluateGrokInspect(withManaged(join(hostHome, '.grok', 'managed_config.toml')), { configDir: configDir(), roots: [project], managedLayerEmpty: () => true })
    expect(checksOf((elsewhere as any).violations)).toEqual(['leader', 'memory', 'permissionMode'])
  })

  it('tomlHasNoSettings: blank lines and comments only', () => {
    expect(tomlHasNoSettings('')).toBe(true)
    expect(tomlHasNoSettings('# managed by the vendor\n\n  # nothing\n')).toBe(true)
    expect(tomlHasNoSettings('[memory]\n')).toBe(false)
    expect(tomlHasNoSettings('# x\nenabled = true\n')).toBe(false)
  })

  it('a report missing a section it must prove is not understood (fail closed)', () => {
    const report = inspectFixture('isolated')
    delete report.mcpServers
    const verdict = evaluateGrokInspect(report, { configDir: configDir(), roots: [project] })
    expect(verdict.ok).toBe(false)
    expect(evaluateGrokInspect('garbage', { configDir: configDir(), roots: [project] }).ok).toBe(false)
  })

  it('parseInspectOutput tolerates noise around the JSON document', () => {
    expect(parseInspectOutput('notice: update available\n{"a":1}\n')).toEqual({ a: 1 })
    expect(() => parseInspectOutput('nothing here')).toThrow()
  })
})

describe('managed-file read-back', () => {
  it('passes right after ensureHome, fails for a changed config or a granted folder trust', () => {
    const profile = createAcpProfile('grok-cli', { homesDir, resolveExecutable: async () => '/bin/false' })
    profile.ensureHome()
    expect(readBackManagedFiles(profile)).toEqual([])

    writeFileSync(join(profile.configDir, 'config.toml'), '[ui]\npermission_mode = "always-approve"\n')
    writeFileSync(join(profile.configDir, 'trusted_folders.toml'), `"${project}" = true\n`)
    expect(checksOf(readBackManagedFiles(profile))).toEqual(['folderTrust', 'leader', 'memory', 'permissionMode'])
  })
})

describe('evaluateKimiHome', () => {
  const kimi = () => {
    const profile = createAcpProfile('kimi-cli', { homesDir, resolveExecutable: async () => '/bin/false' })
    profile.ensureHome()
    return profile
  }

  for (const [label, parseToml] of [['text scan', null], ['TOML parser', undefined]] as const) {
    it(`EYAS's keys in place pass (${label})`, () => {
      expect(evaluateKimiHome(kimi(), { parseToml })).toEqual([])
    })

    it(`auto-approve, the host-skill merge, hooks and extra skill dirs fail (${label})`, () => {
      const profile = kimi()
      writeFileSync(join(profile.configDir, 'config.toml'), [
        'default_yolo = true',
        'telemetry = false',
        'merge_all_available_skills = true',
        'extra_skill_dirs = ["/host/skills"]',
        '',
        '[[hooks]]',
        'event = "SessionStart"',
        'command = "sh -c x"',
        '',
      ].join('\n'))
      expect(checksOf(evaluateKimiHome(profile, { parseToml }))).toEqual(['hooks', 'permissionMode', 'rules'])
    })
  }

  it('a skill planted in the EYAS home or a non-empty mcp.json fails (negative)', () => {
    const profile = kimi()
    mkdirSync(join(profile.home, '.claude', 'skills', 'planted'), { recursive: true })
    writeFileSync(join(profile.home, '.claude', 'skills', 'planted', 'SKILL.md'), 'x')
    writeFileSync(join(profile.configDir, 'mcp.json'), '{"mcpServers":{"vault":{"command":"x"}}}')
    expect(checksOf(evaluateKimiHome(profile, { parseToml: null }))).toEqual(['mcpServers', 'rules'])
  })
})

describe('evaluateSessionNew', () => {
  it('a mode that approves on its own is a violation (negative)', () => {
    for (const mode of ['bypassPermissions', 'always-approve', 'yolo']) {
      expect(evaluateSessionNew({ sessionId: 's', modes: { currentModeId: mode } }).map((v) => v.check)).toEqual(['permissionMode'])
    }
  })
  it("grok 1.0.40's session/new (no modes) and kimi's 'default' pass (positive)", () => {
    expect(evaluateSessionNew(JSON.parse(readFileSync(join(FIXTURES, 'session-new.json'), 'utf8')))).toEqual([])
    expect(evaluateSessionNew({ sessionId: 's', modes: { currentModeId: 'default', availableModes: [{ id: 'default' }] } })).toEqual([])
    expect(evaluateSessionNew(null)).toEqual([])
  })
})

describe('tripwire', () => {
  const ev = (update: Record<string, unknown>, sessionId = 's-main') => {
    const parsed = parseAcpSessionUpdate({ sessionId, update })
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.event
  }

  it('an execute that runs without a permission request is a violation (negative)', () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'run_terminal_command', rawInput: { command: 'ls' } }))).toEqual([])
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', kind: 'execute' }))).toEqual([])
    const v = tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' }))
    expect(v.map((x) => x.check)).toEqual(['ungovernedTool'])
  })

  it('with a prior EYAS decision the same call is fine (positive)', () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'run_terminal_command' }))
    tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', kind: 'execute' }))
    tw.noteDecision('c1')
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress' }))).toEqual([])
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' }))).toEqual([])
  })

  it('describe: the tool\'s own name (first title) and its latest kind, for the permission decision (K3)', () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'run_terminal_command' }))
    expect(tw.describe('c1')).toEqual({ name: 'run_terminal_command' })
    tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', title: 'Execute `ls`', kind: 'execute' }))
    expect(tw.describe('c1')).toEqual({ name: 'run_terminal_command', kind: 'execute' })
    // (−) a call the session never mentioned is described by nothing.
    expect(tw.describe('nope')).toEqual({})
  })

  it('a pending tool_call alone is not a violation', () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'read_file', kind: 'read', status: 'pending' }))).toEqual([])
  })

  it("list_dir, spawn_subagent and search_tool (ACP kind 'other') are governed by name", () => {
    for (const name of ['list_dir', 'spawn_subagent', 'search_tool']) {
      const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
      tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: name }))
      tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', kind: 'other' }))
      expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' })).map((x) => x.check)).toEqual(['ungovernedTool'])
    }
  })

  it("EYAS's own bridge tools through use_tool need no decision; any other use_tool does", () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'use_tool', rawInput: { tool_name: 'eyas__memory_search', tool_input: {} } }))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' }))).toEqual([])
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c2', title: 'use_tool', rawInput: { tool_name: 'mcpvault__read_note' } }))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: 'completed' })).map((x) => x.check)).toEqual(['ungovernedTool'])
  })

  it("an ungoverned tool of kind 'other' (a todo list) is not a violation", () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'todo_write' }))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', kind: 'other', status: 'completed' }))).toEqual([])
  })

  it("the CLI's own memory tool is a memory violation at once", () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'memory_search' })).map((x) => x.check)).toEqual(['memory'])
  })

  it('a subagent call is keyed on its toolCallId, whatever session it reports under', () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'call_sub_0', title: 'read_file' }, 's-sub'))
    tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'call_sub_0', kind: 'read' }, 's-sub'))
    // The permission request came with the PARENT session id and this toolCallId.
    tw.noteDecision('call_sub_0')
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'call_sub_0', status: 'completed' }, 's-sub'))).toEqual([])
  })

  it('the recorded grok 1.0.40 turn (fs-call-trace) passes with its permission decisions (positive)', () => {
    const trace: any[] = JSON.parse(readFileSync(join(FIXTURES, 'fs-call-trace.json'), 'utf8'))
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    const found: string[] = []
    for (const step of trace) {
      if (step.event === 'session/request_permission') {
        tw.noteDecision(step.toolCallId)
        continue
      }
      if (step.event !== 'tool_call' && step.event !== 'tool_call_update') continue
      const rawInput = step.rawInputKeys
        ? Object.fromEntries(step.rawInputKeys.map((k: string) => [k, k === 'tool_name' ? 'eyas__spike_ping' : 'x']))
        : undefined
      const update = { sessionUpdate: step.event, toolCallId: step.toolCallId, title: step.title, kind: step.kind, status: step.status, locations: step.locations, rawInput }
      found.push(...tw.observe(ev(JSON.parse(JSON.stringify(update)), step.sessionId)).map((v) => v.check))
    }
    expect(found).toEqual([])
  })

  it("the same turn without its permission decisions trips on every native tool (negative)", () => {
    const trace: any[] = JSON.parse(readFileSync(join(FIXTURES, 'fs-call-trace.json'), 'utf8'))
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    const tripped = new Set<string>()
    for (const step of trace) {
      if (step.event !== 'tool_call' && step.event !== 'tool_call_update') continue
      const rawInput = step.rawInputKeys
        ? Object.fromEntries(step.rawInputKeys.map((k: string) => [k, k === 'tool_name' ? 'eyas__spike_ping' : 'x']))
        : undefined
      const update = { sessionUpdate: step.event, toolCallId: step.toolCallId, title: step.title, kind: step.kind, status: step.status, locations: step.locations, rawInput }
      if (tw.observe(ev(JSON.parse(JSON.stringify(update)), step.sessionId)).length > 0) tripped.add(step.toolCallId)
    }
    // Every call but the EYAS bridge call (call_main_6, use_tool eyas__spike_ping).
    expect([...tripped].sort()).toEqual(['call_main_0', 'call_main_1', 'call_main_2', 'call_main_3', 'call_main_4', 'call_main_5', 'call_main_7', 'call_sub_0'])
  })

  it("kimi: a read served by EYAS's client fs is governed; one that never came through EYAS trips at completion", () => {
    const tw = createAcpTripwire(tripwirePolicyFor('kimi-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'k1', title: 'ReadFile', kind: 'read', locations: [{ path: join(project, 'a.md') }] }))
    // Kimi reads without asking: nothing yet while it runs.
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'k1', status: 'in_progress' }))).toEqual([])
    tw.noteFsServed(join(project, 'a.md'))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'k1', status: 'completed' }))).toEqual([])

    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'k2', title: 'Grep', kind: 'search' }))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'k2', status: 'completed' })).map((x) => x.check)).toEqual(['ungovernedTool'])
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'k3', title: 'ReadFile', kind: 'read', locations: [{ path: '/elsewhere/x' }] }))
    expect(tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'k3', status: 'completed' })).map((x) => x.check)).toEqual(['ungovernedTool'])
  })

  it('pathsOf reports every path a call named (rawInput and locations)', () => {
    const tw = createAcpTripwire(tripwirePolicyFor('grok-cli'))
    tw.observe(ev({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'read_file', rawInput: { target_file: '/w/a.txt' } }))
    tw.observe(ev({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', kind: 'read', locations: [{ path: '/w/b.txt', line: 2 }] }))
    expect(tw.pathsOf('c1').sort()).toEqual(['/w/a.txt', '/w/b.txt'])
    expect(tw.pathsOf('nope')).toEqual([])
  })
})

describe('createAcpVerifier', () => {
  const grokProfile = () => createAcpProfile('grok-cli', { homesDir, resolveExecutable: async () => '/bin/false', sourceEnv: { PATH: '/usr/bin' } })

  function inspectRunner(report: () => unknown, result: Partial<{ code: number; stderr: string; raw: string }> = {}) {
    return vi.fn<InspectRunner>(async () => ({
      code: result.code ?? 0,
      stdout: result.raw ?? JSON.stringify(report()),
      stderr: result.stderr ?? '',
    }))
  }

  const ctx = { executable: '/bin/false', cwd: '', roots: [] as string[] }
  beforeEach(() => {
    ctx.cwd = project
    ctx.roots = [project]
  })

  it('an isolated grok passes, runs inspect with the profile env in the cwd, and is verified (positive)', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const runInspect = inspectRunner(() => inspectFixture('isolated'))
    const verifier = createAcpVerifier(profile, { runInspect, runtime: { source: 'host' } })
    await verifier.preflight(ctx)
    expect(runInspect).toHaveBeenCalledTimes(1)
    const [exe, args, opts] = runInspect.mock.calls[0]
    expect(exe).toBe('/bin/false')
    expect(args).toEqual(['inspect', '--json'])
    expect(opts.cwd).toBe(project)
    expect(opts.env.GROK_HOME).toBe(configDir())
    expect(opts.env.HOME).toBe(profile.home)
    expect(getIsolationStatus('grok-cli')).toMatchObject({ status: 'verified', checks: [], runtime: { path: '/bin/false', version: '1.0.40', source: 'host' } })
  })

  it("reads GROK_HOME's managed layer cache itself: empty passes, a setting or a symlink is refused", async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const managed = join(profile.configDir, 'managed_config.toml')
    const report = () => {
      const r = inspectFixture('isolated')
      r.configSources.layers.push({ role: 'managed', path: managed })
      return r
    }
    writeFileSync(managed, '')
    await createAcpVerifier(profile, { runInspect: inspectRunner(report) }).preflight({ ...ctx, refresh: true })
    expect(getIsolationStatus('grok-cli').status).toBe('verified')

    writeFileSync(managed, '[memory]\nenabled = true\n')
    const err = await createAcpVerifier(profile, { runInspect: inspectRunner(report) }).preflight({ ...ctx, refresh: true }).catch((e) => e)
    expect(err).toBeInstanceOf(CliIsolationError)
    expect(err.violations.map((v: any) => v.check)).toContain('memory')

    rmSync(managed)
    const empty = join(base, 'empty.toml')
    writeFileSync(empty, '')
    symlinkSync(empty, managed)
    const linked = await createAcpVerifier(profile, { runInspect: inspectRunner(report) }).preflight({ ...ctx, refresh: true }).catch((e) => e)
    expect(linked).toBeInstanceOf(CliIsolationError)
  })

  it("a cached pass survives grok rewriting its empty managed-layer cache, but not a setting appearing in it", async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const managed = join(profile.configDir, 'managed_config.toml')
    writeFileSync(managed, '')
    const report = () => {
      const r = inspectFixture('isolated')
      r.configSources.layers.push({ role: 'managed', path: managed })
      return r
    }
    const runInspect = inspectRunner(report)
    const verifier = createAcpVerifier(profile, { runInspect })
    await verifier.preflight(ctx)
    writeFileSync(managed, '')
    await verifier.preflight(ctx)
    expect(runInspect).toHaveBeenCalledTimes(1)
    writeFileSync(managed, '[memory]\nenabled = true\n')
    const err = await verifier.preflight(ctx).catch((e) => e)
    expect(runInspect).toHaveBeenCalledTimes(2)
    expect(err).toBeInstanceOf(CliIsolationError)
  })

  it('a hostile grok is refused with the failed checks and recorded as a violation (negative)', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const verifier = createAcpVerifier(profile, { runInspect: inspectRunner(() => inspectFixture('hostile')) })
    const err = await verifier.preflight(ctx).catch((e) => e)
    expect(err).toBeInstanceOf(CliIsolationError)
    expect(classifyModelError(err)).toMatchObject({ kind: 'isolation', retryable: false, code: 'cliIsolation' })
    expect(err.violations.map((v: any) => v.check)).toContain('mcpServers')
    expect(getIsolationStatus('grok-cli').status).toBe('violation')
  })

  it('an inspect that fails or prints no JSON leaves grok unverified and refuses the turn (fail closed)', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    for (const runInspect of [
      inspectRunner(() => ({}), { code: 3, stderr: 'boom' }),
      inspectRunner(() => ({}), { raw: 'not json' }),
      vi.fn<InspectRunner>(async () => { throw new Error('ENOENT') }),
    ]) {
      const err = await createAcpVerifier(profile, { runInspect }).preflight(ctx).catch((e) => e)
      expect(err).toBeInstanceOf(CliIsolationError)
      expect(err.violations.map((v: any) => v.check)).toEqual(['unverified'])
      expect(getIsolationStatus('grok-cli').status).toBe('unverified')
    }
  })

  it('a pass is cached for the same binary, folder and home; refresh and a planted skill re-run inspect', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const runInspect = inspectRunner(() => inspectFixture('isolated'))
    const verifier = createAcpVerifier(profile, { runInspect })
    await verifier.preflight(ctx)
    await verifier.preflight(ctx)
    expect(runInspect).toHaveBeenCalledTimes(1)
    await verifier.preflight({ ...ctx, refresh: true })
    expect(runInspect).toHaveBeenCalledTimes(2)
    mkdirSync(join(profile.configDir, 'skills', 'planted'), { recursive: true })
    await verifier.preflight(ctx)
    expect(runInspect).toHaveBeenCalledTimes(3)
    const other = join(base, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'README.md'), 'x')
    await verifier.preflight({ ...ctx, cwd: other, roots: [other] })
    expect(runInspect).toHaveBeenCalledTimes(4)
  })

  it('the sandbox profile file EYAS rewrites every sandboxed turn keeps the cached pass; any other new GROK_HOME entry does not (B5)', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const runInspect = inspectRunner(() => inspectFixture('isolated'))
    const verifier = createAcpVerifier(profile, { runInspect })
    await verifier.preflight(ctx)
    const profiles = createGrokSandboxProfiles({ home: profile.home, configDir: profile.configDir })
    const lease = profiles.acquire({ deny: ['/nowhere/a'], readWrite: [] })
    await verifier.preflight(ctx)
    lease.release()
    await verifier.preflight(ctx)
    expect(runInspect).toHaveBeenCalledTimes(1)
    // Negative: a file planted next to it is a change the CLI may load.
    writeFileSync(join(profile.configDir, 'AGENTS.md'), 'planted\n')
    await verifier.preflight(ctx)
    expect(runInspect).toHaveBeenCalledTimes(2)
    resetGrokSandboxProfilesForTests()
  })

  it('fresh empty scratch folders under one parent share a verdict; a folder with content gets its own', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const runInspect = inspectRunner(() => inspectFixture('isolated'))
    const verifier = createAcpVerifier(profile, { runInspect })
    const runs = join(base, 'workspaces', '_runs')
    for (const id of ['adhoc-1', 'adhoc-2']) {
      mkdirSync(join(runs, id), { recursive: true })
      await verifier.preflight({ executable: '/bin/false', cwd: join(runs, id), roots: [join(runs, id)] })
    }
    expect(runInspect).toHaveBeenCalledTimes(1)
    mkdirSync(join(runs, 'adhoc-3'))
    writeFileSync(join(runs, 'adhoc-3', 'AGENTS.md'), 'x')
    await verifier.preflight({ executable: '/bin/false', cwd: join(runs, 'adhoc-3'), roots: [join(runs, 'adhoc-3')] })
    expect(runInspect).toHaveBeenCalledTimes(2)
  })

  it('a failure is never cached (negative)', async () => {
    const profile = grokProfile()
    profile.ensureHome()
    const runInspect = inspectRunner(() => inspectFixture('hostile'))
    const verifier = createAcpVerifier(profile, { runInspect })
    await verifier.preflight(ctx).catch(() => {})
    await verifier.preflight(ctx).catch(() => {})
    expect(runInspect).toHaveBeenCalledTimes(2)
  })

  it("a pass keeps the sign-in's 'auth-required' status", async () => {
    const profile = grokProfile()
    profile.ensureHome()
    setIsolationStatus('grok-cli', { status: 'auth-required', checks: [], runtime: null })
    await createAcpVerifier(profile, { runInspect: inspectRunner(() => inspectFixture('isolated')) }).preflight(ctx)
    expect(getIsolationStatus('grok-cli').status).toBe('auth-required')
  })

  it('a tampered managed file fails the preflight even when inspect looks clean', async () => {
    const profile = grokProfile()
    const verifier = createAcpVerifier(profile, { runInspect: inspectRunner(() => inspectFixture('isolated')) })
    // No ensureHome: nothing EYAS owns is in place.
    const err = await verifier.preflight(ctx).catch((e) => e)
    expect(err).toBeInstanceOf(CliIsolationError)
    expect(err.violations.map((v: any) => v.check)).toContain('permissionMode')
  })

  it('checkSessionNew: a bypass mode is refused and recorded; a normal start is verified', () => {
    const verifier = createAcpVerifier(grokProfile(), { runInspect: inspectRunner(() => ({})) })
    expect(() => verifier.checkSessionNew({ sessionId: 's', modes: { currentModeId: 'bypassPermissions' } })).toThrow(CliIsolationError)
    expect(getIsolationStatus('grok-cli').status).toBe('violation')
    verifier.checkSessionNew({ sessionId: 's' })
    expect(getIsolationStatus('grok-cli').status).toBe('verified')
  })

  it('fail() records the tripwire violation and returns the isolation error', () => {
    const verifier = createAcpVerifier(grokProfile(), { runInspect: inspectRunner(() => ({})) })
    const err = verifier.fail([{ check: 'ungovernedTool', detail: 'run_terminal_command (c1) ran without an EYAS decision' }])
    expect(err).toBeInstanceOf(CliIsolationError)
    expect(getIsolationStatus('grok-cli')).toMatchObject({ status: 'violation', checks: [{ check: 'ungovernedTool' }] })
  })

  it('kimi: a clean home lets the turn start but stays unverified until a session starts on this host', async () => {
    const profile = createAcpProfile('kimi-cli', { homesDir, resolveExecutable: async () => '/bin/false' })
    profile.ensureHome()
    const runInspect = vi.fn<InspectRunner>()
    const verifier = createAcpVerifier(profile, { runInspect })
    await verifier.preflight(ctx)
    expect(runInspect).not.toHaveBeenCalled()
    expect(getIsolationStatus('kimi-cli').status).toBe('unverified')
    verifier.checkSessionNew({ sessionId: 's', modes: { currentModeId: 'default' } })
    expect(getIsolationStatus('kimi-cli').status).toBe('verified')
  })

  it('kimi: auto-approve in its config refuses the turn (negative)', async () => {
    const profile = createAcpProfile('kimi-cli', { homesDir, resolveExecutable: async () => '/bin/false' })
    profile.ensureHome()
    writeFileSync(join(profile.configDir, 'config.toml'), 'default_yolo = true\ntelemetry = false\nmerge_all_available_skills = false\n')
    const err = await createAcpVerifier(profile).preflight(ctx).catch((e) => e)
    expect(err).toBeInstanceOf(CliIsolationError)
    expect(getIsolationStatus('kimi-cli').status).toBe('violation')
  })

  it('verifyAcpIsolationAtLoad prepares the home, seeds the status and never throws', async () => {
    // No ensureHome here: loading the provider prepares the home as a turn would.
    const profile = grokProfile()
    await verifyAcpIsolationAtLoad(createAcpVerifier(profile, { runInspect: inspectRunner(() => inspectFixture('isolated')) }), { profile, executable: '/bin/false', cwd: project })
    expect(getIsolationStatus('grok-cli').status).toBe('verified')
    const warn = vi.fn()
    await expect(verifyAcpIsolationAtLoad(createAcpVerifier(profile, { runInspect: inspectRunner(() => inspectFixture('hostile')) }), { profile, executable: '/bin/false', cwd: project }, { warn })).resolves.toBeUndefined()
    expect(getIsolationStatus('grok-cli').status).toBe('violation')
    expect(warn).toHaveBeenCalled()
  })
})
