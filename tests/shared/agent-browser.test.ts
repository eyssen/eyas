// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CliRunner } from '@modules/studio/cli-runner'
import {
  AGENT_BROWSER_INSTALL_REMEDY,
  AGENT_BROWSER_MCP_TOOLS,
  agentBrowserPolicyEnv,
  assertAgentBrowserProfile,
  defaultAgentBrowserProfileDir,
  doctorAgentBrowser,
  injectAgentBrowserGlobals,
  isAgentBrowserMcp,
  isAgentBrowserNpmWrapper,
  parseAgentBrowserDoctorJson,
  prepareAgentBrowserRun,
  resolveAgentBrowserCli,
  sanitizeAgentBrowserMcpLaunch,
  validateAgentBrowserArgs,
} from '@shared/agent-browser'

function runner(opts: {
  which?: Record<string, string | null>
  version?: { code: number; stdout: string; stderr?: string }
  doctor?: { code: number; stdout: string; stderr?: string }
  runs?: Array<{ command: string; args: string[]; env?: Record<string, string | undefined> }>
}): CliRunner {
  return {
    async which(bin) {
      if (opts.which && bin in opts.which) return opts.which[bin] ?? null
      return null
    },
    async run(command, args, runOpts?) {
      opts.runs?.push({ command, args, env: runOpts?.env })
      if (args[0] === '--version') {
        const v = opts.version ?? { code: 0, stdout: 'agent-browser 0.35.1', stderr: '' }
        return { code: v.code, stdout: v.stdout, stderr: v.stderr ?? '' }
      }
      if (args[0] === 'doctor') {
        const d = opts.doctor ?? { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }
        return { code: d.code, stdout: d.stdout, stderr: d.stderr ?? '' }
      }
      return { code: 0, stdout: 'ok', stderr: '' }
    },
  }
}

const dataDir = '/tmp/eyas-agent-browser-data'
const settings = { enabled: true, cliPath: null as string | null, allowedDomains: [] as string[] }

describe('agent-browser resolve', () => {
  it('EYAS_AGENT_BROWSER_BIN wins when the file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-ab-'))
    const bin = join(dir, 'agent-browser')
    writeFileSync(bin, '')
    const resolved = await resolveAgentBrowserCli({
      runner: runner({ which: { 'agent-browser': '/usr/bin/agent-browser' } }),
      env: { EYAS_AGENT_BROWSER_BIN: bin },
    })
    expect(resolved).toEqual({ kind: 'found', command: bin, path: bin })
  })

  it('set-but-missing BIN is missing with no PATH fallback', async () => {
    const resolved = await resolveAgentBrowserCli({
      runner: runner({ which: { 'agent-browser': '/usr/bin/agent-browser' } }),
      env: { EYAS_AGENT_BROWSER_BIN: '/nope/agent-browser' },
      exists: () => false,
    })
    expect(resolved).toEqual({ kind: 'missing-configured', configured: '/nope/agent-browser' })
  })

  it('empty / whitespace BIN falls through to PATH', async () => {
    const resolved = await resolveAgentBrowserCli({
      runner: runner({ which: { 'agent-browser': '/usr/bin/agent-browser' } }),
      env: { EYAS_AGENT_BROWSER_BIN: '   ' },
    })
    expect(resolved).toEqual({ kind: 'found', command: '/usr/bin/agent-browser', path: '/usr/bin/agent-browser' })
  })

  it('nothing → missing', async () => {
    const resolved = await resolveAgentBrowserCli({
      runner: runner({ which: {} }),
      env: {},
    })
    expect(resolved).toEqual({ kind: 'missing' })
  })
})

describe('agent-browser doctor (fail-closed)', () => {
  it('is missing without a binary and names EYAS_AGENT_BROWSER_BIN', async () => {
    const status = await doctorAgentBrowser(runner({ which: {} }), settings, {
      dataDir,
      env: {},
    })
    expect(status.available).toBe(false)
    expect(status.recommended).toBe(true)
    expect(status.checks.find((c) => c.id === 'cli')?.status).toBe('missing')
    expect(status.checks.find((c) => c.id === 'cli')?.remedy).toContain('EYAS_AGENT_BROWSER_BIN')
    expect(AGENT_BROWSER_INSTALL_REMEDY).toMatch(/agent-browser install/)
  })

  it('is missing when doctor json is ok:false / non-zero / timeout-like', async () => {
    const r = runner({
      which: { 'agent-browser': '/usr/bin/agent-browser' },
      doctor: { code: 1, stdout: JSON.stringify({ ok: false, message: 'stale daemon' }) },
    })
    const status = await doctorAgentBrowser(r, settings, { dataDir, env: {} })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'doctor')?.status).toBe('missing')
  })

  it('is available when PATH CLI + version + ok:true doctor + EYAS profile', async () => {
    const status = await doctorAgentBrowser(
      runner({ which: { 'agent-browser': '/usr/bin/agent-browser' } }),
      settings,
      { dataDir, env: {} },
    )
    expect(status.checks.find((c) => c.id === 'cli')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'version')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'doctor')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'profile')?.status).toBe('ok')
    expect(status.available).toBe(true)
  })

  it('profile check fails for a daily Chrome dir', async () => {
    const status = await doctorAgentBrowser(
      runner({ which: { 'agent-browser': '/usr/bin/agent-browser' } }),
      settings,
      {
        dataDir,
        env: { AGENT_BROWSER_PROFILE: '/Users/x/Library/Application Support/Google/Chrome' },
      },
    )
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'profile')?.status).toBe('missing')
  })
})

describe('agent-browser args policy', () => {
  it('rejects chat, --no-sandbox, --auto-connect, --profile Default', () => {
    expect(() => validateAgentBrowserArgs(['chat', 'open google.com'], { dataDir })).toThrow(/chat/i)
    expect(() => validateAgentBrowserArgs(['snapshot', '--no-sandbox'], { dataDir })).toThrow(/no-sandbox/)
    expect(() => validateAgentBrowserArgs(['open', 'https://example.com', '--auto-connect'], { dataDir })).toThrow(/auto-connect/)
    expect(() => assertAgentBrowserProfile('Default')).toThrow(/Default/)
    expect(() => validateAgentBrowserArgs(['open', 'https://example.com', '--profile', 'Default'], { dataDir })).toThrow(/Default/)
  })

  it('accepts snapshot -i and injects EYAS profile + session + content-boundaries', () => {
    validateAgentBrowserArgs(['snapshot', '-i'], { dataDir })
    const args = injectAgentBrowserGlobals(['snapshot', '-i'], { dataDir })
    expect(args).toContain('--profile')
    expect(args).toContain(defaultAgentBrowserProfileDir(dataDir))
    expect(args).toContain('--session')
    expect(args).toContain('eyas')
    expect(args).toContain('--content-boundaries')
    expect(args[args.length - 2]).toBe('snapshot')
  })

  it('prepare batch writes JSON stdin, not Python', () => {
    const prepared = prepareAgentBrowserRun({
      batch: [['open', 'https://example.com'], ['snapshot', '-i']],
      dataDir,
    })
    expect(prepared.args).toContain('batch')
    expect(prepared.args).toContain('--json')
    expect(prepared.stdin).toBe(JSON.stringify([['open', 'https://example.com'], ['snapshot', '-i']]))
  })

  it('policy env blanks AI Gateway keys so process.env cannot leak through', () => {
    const env = agentBrowserPolicyEnv({ dataDir })
    expect(env.DO_NOT_TRACK).toBe('1')
    expect(env.AI_GATEWAY_API_KEY).toBe('')
    expect(env.AI_GATEWAY_URL).toBe('')
  })
})

describe('agent-browser MCP sanitize', () => {
  it('rewrites --tools all/debug to core,state and drops chat', () => {
    const out = sanitizeAgentBrowserMcpLaunch({
      command: 'agent-browser',
      args: ['mcp', '--tools', 'all', 'chat'],
    }, { dataDir })
    expect(out.args).toContain('mcp')
    expect(out.args).toContain('--tools')
    expect(out.args).toContain(AGENT_BROWSER_MCP_TOOLS)
    expect(out.args).not.toContain('chat')
    expect(out.args).not.toContain('all')
    expect(out.env.DO_NOT_TRACK).toBe('1')
    expect(out.env.AI_GATEWAY_API_KEY).toBe('')
  })

  it('detects native CLI and rejects the npm wrapper', () => {
    expect(isAgentBrowserMcp({ command: 'agent-browser', args: ['mcp'] })).toBe(true)
    expect(isAgentBrowserNpmWrapper({ command: 'npx', args: ['-y', 'mcp-agent-browser'] })).toBe(true)
    expect(() => sanitizeAgentBrowserMcpLaunch({
      command: 'npx',
      args: ['-y', 'mcp-agent-browser'],
    }, { dataDir })).toThrow(/mcp-agent-browser/)
  })
})

describe('parseAgentBrowserDoctorJson', () => {
  it('reads ok:true / ok:false / chrome missing checks', () => {
    expect(parseAgentBrowserDoctorJson('{"ok":true}')).toEqual({ ok: true, chromeMissing: false, detail: undefined })
    expect(parseAgentBrowserDoctorJson('{"ok":false}')).toMatchObject({ ok: false })
    expect(parseAgentBrowserDoctorJson('not json').ok).toBe(false)
    expect(parseAgentBrowserDoctorJson(JSON.stringify({
      ok: true,
      checks: [{ id: 'chrome', status: 'missing' }],
    })).chromeMissing).toBe(true)
  })
})

describe('EYAS-owned dirs', () => {
  it('accepts the default data dir profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-ab-prof-'))
    mkdirSync(join(dir, 'browser', 'agent-browser', 'profile'), { recursive: true })
    expect(assertAgentBrowserProfile(join(dir, 'browser', 'agent-browser', 'profile'))).toContain('agent-browser')
  })
})
