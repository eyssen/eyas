// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createOpencodeTools } from '@modules/opencode/tools'
import { doctorOpencode } from '@modules/opencode/doctor'
import type { CliRunner } from '@modules/studio/cli-runner'
import type { ToolImplementation } from '@modules/tools/types'

function byName(list: ToolImplementation[], name: string): ToolImplementation {
  const found = list.find((t) => t.name === name)
  if (!found) throw new Error(`no tool named ${name}`)
  return found
}

function runner(bins: Map<string, string>): CliRunner {
  return {
    async which(bin) { return bins.get(bin) ?? null },
    async run(command, args) {
      if (args.includes('--version')) return { code: 0, stdout: 'opencode 1.2.5', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

const settings = {
  enabled: true,
  cliPath: null as string | null,
  attachUrl: null as string | null,
  isolatedConfig: true,
  maxPtySessions: 4,
  defaultCols: 120,
  defaultRows: 32,
}

describe('opencode tools', () => {
  it('registers status (green) and run (red, approval)', () => {
    const tools = createOpencodeTools({
      getRunner: () => undefined,
      getSettings: () => settings,
      getAgent: () => undefined,
    })
    expect(tools.map((t) => t.name)).toEqual(['opencode_status', 'opencode_run'])
    expect(byName(tools, 'opencode_status').riskTier).toBe('green')
    expect(byName(tools, 'opencode_run').riskTier).toBe('red')
    expect(byName(tools, 'opencode_run').requiresApproval).toBe(true)
  })

  it('doctor is missing without the CLI', async () => {
    const status = await doctorOpencode(runner(new Map()), settings)
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'cli')?.status).toBe('missing')
  })

  it('doctor is ready when the CLI is on PATH', async () => {
    const status = await doctorOpencode(runner(new Map([['opencode', '/usr/local/bin/opencode']])), settings)
    expect(status.checks.find((c) => c.id === 'cli')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'version')?.detail).toContain('1.2.5')
  })

  it('run fails closed when disabled', async () => {
    const tools = createOpencodeTools({
      getRunner: () => runner(new Map()),
      getSettings: () => ({ ...settings, enabled: false }),
      getAgent: () => ({ run: async () => ({ ok: true, sessionId: 's', summary: 'x', diffs: [] }) }),
    })
    const result = await byName(tools, 'opencode_run').execute({ prompt: 'hi' }) as { error?: string }
    expect(result.error).toMatch(/disabled/)
  })
})
