// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createBrowserUseTools } from '@modules/browser-use/tools'
import { doctorBrowserUse, telemetryOffEnv } from '@modules/browser-use/doctor'
import type { CliRunner } from '@modules/studio/cli-runner'
import type { ToolImplementation } from '@modules/tools/types'
import pino from 'pino'

function byName(list: ToolImplementation[], name: string): ToolImplementation {
  const found = list.find((t) => t.name === name)
  if (!found) throw new Error(`no tool named ${name}`)
  return found
}

function runner(bins: Map<string, string>, runs: Array<{ command: string; args: string[]; input?: string; env?: Record<string, string | undefined> }> = []): CliRunner {
  return {
    async which(bin) {
      return bins.get(bin) ?? null
    },
    async run(command, args, opts) {
      runs.push({ command, args, input: opts?.input, env: opts?.env })
      if (command.includes('python') && args.includes('--version')) {
        return { code: 0, stdout: 'Python 3.12.4', stderr: '' }
      }
      return { code: 0, stdout: '{"ok":true}', stderr: '' }
    },
  }
}

const settings = {
  enabled: true,
  cliPath: null as string | null,
  allowUvx: true,
  allowCloud: false,
  agentBrowser: { enabled: true, cliPath: null as string | null, allowedDomains: [] as string[] },
}

describe('browser-use tools', () => {
  it('registers status (green) and exec (red)', () => {
    const tools = createBrowserUseTools({ getRunner: () => undefined, getSettings: () => settings })
    expect(tools.map((t) => t.name)).toEqual([
      'browser_use_status',
      'browser_use_exec',
      'agent_browser_status',
      'agent_browser_run',
    ])
    expect(byName(tools, 'browser_use_status').riskTier).toBe('green')
    expect(byName(tools, 'browser_use_exec').riskTier).toBe('red')
    expect(byName(tools, 'browser_use_exec').requiresApproval).toBe(true)
    expect(byName(tools, 'agent_browser_status').riskTier).toBe('green')
    expect(byName(tools, 'agent_browser_run').riskTier).toBe('red')
    expect(byName(tools, 'agent_browser_run').requiresApproval).toBe(true)
  })

  it('doctor is missing without python and cli', async () => {
    const status = await doctorBrowserUse(runner(new Map()), settings)
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'python')?.status).toBe('missing')
    expect(status.checks.find((c) => c.id === 'cli')?.status).toBe('missing')
  })

  it('exec pipes python on stdin with telemetry off', async () => {
    const runs: Array<{ command: string; args: string[]; input?: string; env?: Record<string, string | undefined> }> = []
    const bins = new Map([['python3', '/usr/bin/python3'], ['browser-use', '/usr/bin/browser-use']])
    const tools = createBrowserUseTools({
      getRunner: () => runner(bins, runs),
      getSettings: () => settings,
    })
    const result = await byName(tools, 'browser_use_exec').execute(
      { code: 'print(page_info())' },
      { conversationId: 'c1', userId: 'u1', logger: pino({ enabled: false }) },
    ) as { code: number; stdout: string }
    expect(result.code).toBe(0)
    expect(runs.some((r) => r.input === 'print(page_info())')).toBe(true)
    expect(runs.some((r) => r.env?.ANONYMIZED_TELEMETRY === 'false')).toBe(true)
    expect(runs.some((r) => r.env?.BROWSER_USE_API_KEY === '')).toBe(true)
  })

  it('strips cloud key unless allowCloud', () => {
    expect(telemetryOffEnv(false).BROWSER_USE_API_KEY).toBe('')
    expect(telemetryOffEnv(true).BROWSER_USE_API_KEY).toBeUndefined()
  })

  it('agent_browser_run with doctor missing returns a remedy and does not spawn the verb', async () => {
    const runs: Array<{ command: string; args: string[]; input?: string; env?: Record<string, string | undefined> }> = []
    const tools = createBrowserUseTools({
      getRunner: () => runner(new Map(), runs),
      getSettings: () => settings,
      getDataDir: () => '/tmp/eyas-data',
    })
    const result = await byName(tools, 'agent_browser_run').execute(
      { argv: ['snapshot', '-i'] },
      { conversationId: 'c1', userId: 'u1', logger: pino({ enabled: false }) },
    ) as { error: string; remedy?: string }
    expect(result.error).toMatch(/not ready/i)
    expect(result.remedy).toMatch(/EYAS_AGENT_BROWSER_BIN/)
    expect(runs.some((r) => r.args[0] === 'snapshot')).toBe(false)
  })

  it('agent_browser_run spawns argv with telemetry off and no AI Gateway key', async () => {
    const runs: Array<{ command: string; args: string[]; input?: string; env?: Record<string, string | undefined> }> = []
    const bins = new Map([['agent-browser', '/usr/bin/agent-browser']])
    const tools = createBrowserUseTools({
      getRunner: () => ({
        async which(bin) { return bins.get(bin) ?? null },
        async run(command, args, opts) {
          runs.push({ command, args, input: opts?.input, env: opts?.env })
          if (args[0] === '--version') return { code: 0, stdout: 'agent-browser 0.35.1', stderr: '' }
          if (args[0] === 'doctor') return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }
          return { code: 0, stdout: '@e1 button Submit', stderr: '' }
        },
      }),
      getSettings: () => settings,
      getDataDir: () => '/tmp/eyas-data',
    })
    const result = await byName(tools, 'agent_browser_run').execute(
      { argv: ['snapshot', '-i'] },
      { conversationId: 'c1', userId: 'u1', logger: pino({ enabled: false }) },
    ) as { code: number; stdout: string }
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('@e1')
    const spawn = runs.find((r) => r.args.includes('snapshot'))
    expect(spawn).toBeTruthy()
    expect(spawn?.args).toContain('--profile')
    expect(spawn?.env?.DO_NOT_TRACK).toBe('1')
    expect(spawn?.env?.AI_GATEWAY_API_KEY).toBe('')
    expect(runs.some((r) => r.input?.includes('print('))).toBe(false)
  })

  it('agent_browser_run refuses chat', async () => {
    const tools = createBrowserUseTools({
      getRunner: () => ({
        async which(bin) { return bin === 'agent-browser' ? '/usr/bin/agent-browser' : null },
        async run(_command, args) {
          if (args[0] === '--version') return { code: 0, stdout: 'agent-browser 0.35.1', stderr: '' }
          if (args[0] === 'doctor') return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '' }
          return { code: 0, stdout: 'ok', stderr: '' }
        },
      }),
      getSettings: () => settings,
      getDataDir: () => '/tmp/eyas-data',
    })
    const result = await byName(tools, 'agent_browser_run').execute(
      { argv: ['chat', 'open google.com'] },
      { conversationId: 'c1', userId: 'u1', logger: pino({ enabled: false }) },
    ) as { error: string }
    expect(result.error).toMatch(/chat/i)
  })
})
