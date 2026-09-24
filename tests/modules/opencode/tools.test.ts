// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createOpencodeTools } from '@modules/opencode/tools'
import { doctorOpencode } from '@modules/opencode/doctor'
import type { CliRunner } from '@modules/studio/cli-runner'
import type { ToolImplementation } from '@modules/tools/types'
import type { OpencodeSettings } from '@modules/opencode/types'

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

const settings: OpencodeSettings = {
  enabled: true,
  cliPath: null,
  attachUrl: null,
  maxPtySessions: 4,
  defaultCols: 120,
  defaultRows: 32,
  model: null,
  variant: null,
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

  it('doctor reports the EYAS-owned isolation for a spawned server', async () => {
    const status = await doctorOpencode(runner(new Map([['opencode', '/usr/local/bin/opencode']])), settings)
    const isolation = status.checks.find((c) => c.id === 'isolation')
    const attach = status.checks.find((c) => c.id === 'attach')
    expect(isolation).toMatchObject({ status: 'ok', detailId: 'detail' })
    expect(isolation?.detail).toMatch(/EYAS owns the OpenCode config, data, state and cache/)
    expect(attach).toMatchObject({ status: 'ok', detailId: 'detailSpawn' })
    expect(status.available).toBe(true)
  })

  it('doctor warns that an attach URL is an external, non-isolated server', async () => {
    const status = await doctorOpencode(
      runner(new Map([['opencode', '/usr/local/bin/opencode']])),
      { ...settings, attachUrl: 'http://127.0.0.1:4096' },
    )
    const attach = status.checks.find((c) => c.id === 'attach')
    const isolation = status.checks.find((c) => c.id === 'isolation')
    expect(attach).toMatchObject({ status: 'warn', detailId: 'detailExternal', detailVars: { url: 'http://127.0.0.1:4096' } })
    expect(attach?.detail).toMatch(/does not start or isolate it/)
    expect(isolation).toMatchObject({ status: 'warn', detailId: 'detailExternal' })
    // A warning is a disclosure, not a missing prerequisite.
    expect(status.available).toBe(true)
  })

  it('run passes the agent and run of the tool call to the task', async () => {
    let seen: Record<string, unknown> | null = null
    const tools = createOpencodeTools({
      getRunner: () => runner(new Map()),
      getSettings: () => settings,
      getAgent: () => ({
        run: async (input) => {
          seen = input as unknown as Record<string, unknown>
          return { ok: true, sessionId: 's', summary: 'x', diffs: [] }
        },
      }),
    })
    await byName(tools, 'opencode_run').execute(
      { prompt: 'hi' },
      { conversationId: 'c1', userId: 'u1', agentId: 'a1', runId: 'r1', turnId: 't1', projectId: 'claimed', logger: undefined as never },
    )
    // The turn rides along (the session shares its memory drill budget); the
    // project is never taken from the context — it is resolved from the conversation.
    expect(seen).toMatchObject({ conversationId: 'c1', userId: 'u1', agentId: 'a1', runId: 'r1', turnId: 't1' })
    expect(seen).not.toHaveProperty('projectId')
  })

  it('(−) run refuses without a conversation: no stand-in id', async () => {
    let called = false
    const tools = createOpencodeTools({
      getRunner: () => runner(new Map()),
      getSettings: () => settings,
      getAgent: () => ({
        run: async () => {
          called = true
          return { ok: true, sessionId: 's', summary: 'x', diffs: [] }
        },
      }),
    })
    const run = byName(tools, 'opencode_run')
    const none = await run.execute({ prompt: 'hi' }) as { error?: string }
    const empty = await run.execute({ prompt: 'hi' }, { conversationId: '', userId: 'u1', logger: undefined as never }) as { error?: string }
    expect(none.error).toMatch(/inside a conversation/)
    expect(empty.error).toMatch(/inside a conversation/)
    expect(called).toBe(false)
  })

  it('(+) run takes the model and reasoning variant from the settings, not from the tool input', async () => {
    let seen: Record<string, unknown> | null = null
    const tools = createOpencodeTools({
      getRunner: () => runner(new Map()),
      getSettings: () => ({ ...settings, model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'xhigh' }),
      getAgent: () => ({
        run: async (input) => {
          seen = input as unknown as Record<string, unknown>
          return { ok: true, sessionId: 's', summary: 'x', diffs: [] }
        },
      }),
    })
    const run = byName(tools, 'opencode_run')
    // No model or variant in the tool's own input schema: the operator picks them.
    expect(Object.keys((run.inputSchema as { properties: Record<string, unknown> }).properties)).toEqual(['prompt', 'cwd'])
    await run.execute({ prompt: 'hi', model: 'evil/other', variant: 'max' } as never, { conversationId: 'c1', userId: 'u1', logger: undefined as never })
    expect(seen).toMatchObject({ model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'xhigh' })
  })

  it('(−) run sends no model and no variant when none is set (OpenCode\'s default)', async () => {
    let seen: Record<string, unknown> | null = null
    const tools = createOpencodeTools({
      getRunner: () => runner(new Map()),
      getSettings: () => settings,
      getAgent: () => ({
        run: async (input) => {
          seen = input as unknown as Record<string, unknown>
          return { ok: true, sessionId: 's', summary: 'x', diffs: [] }
        },
      }),
    })
    await byName(tools, 'opencode_run').execute({ prompt: 'hi' }, { conversationId: 'c1', userId: 'u1', logger: undefined as never })
    expect(seen).toMatchObject({ model: null, variant: null })
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
