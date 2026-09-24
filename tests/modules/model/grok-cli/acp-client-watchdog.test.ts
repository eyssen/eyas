// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G8 — an ACP turn (Grok, Kimi) is stopped only when the CLI goes quiet:
// idleMs with no tool call open, toolMs while one is — never after a fixed
// whole-turn time. A stopped turn fails with a TimeoutError ('timeout'), not
// with "ACP request aborted". Driven end to end against the fake ACP agent
// over real stdio ('script' scenario), with short budgets. The providers read
// the budgets from their lazy getter at every turn.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunOptions, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { resetCliSandboxForTests, type CliSandboxDeps } from '@modules/model/cli-runtime/sandbox/index.js'
import { classifyModelError } from '@shared/classify-model-error.js'
import { DEFAULT_CLI_IDLE_TIMEOUT_MS, DEFAULT_CLI_TOOL_TIMEOUT_MS } from '@modules/model/cli-turn-watchdog.js'
import type { StreamEvent } from '@modules/model/types.js'
import type { AcpScriptStep } from '../stream-contract/fixtures/acp.js'
import { fakeAcpProfile } from '../../../helpers/fake-acp.js'

let root: string
let homesDir: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-watchdog-')))
  homesDir = join(root, 'data', 'cli-homes')
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
  // Any folder a turn falls back to stays inside this test's root.
  vi.stubEnv('EYAS_WORKSPACES_DIR', join(root, 'workspaces'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetCliSandboxForTests()
  rmSync(root, { recursive: true, force: true })
})

const text = (t: string): AcpScriptStep => ({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } } })

/** An EYAS tool the CLI calls through the MCP bridge (grok's use_tool form). */
const bridgedCall = (id: string): AcpScriptStep => ({
  update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'use_tool', status: 'in_progress', rawInput: { tool_name: 'eyas__run_specialist', arguments: { task: 'research' } } },
})
const completed = (id: string): AcpScriptStep => ({ update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed' } })

function runScript(steps: AcpScriptStep[], turnTimeouts: GrokAcpRunOptions['turnTimeouts']): AsyncGenerator<StreamEvent, GrokAcpRunResult> {
  const script = join(root, `script-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(script, JSON.stringify({ steps, result: { stopReason: 'end_turn' } }))
  const profile = fakeAcpProfile({ homesDir, dir: root, log: join(root, 'acp.log'), scenario: 'script', script })
  return runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'go' }], turnTimeouts })
}

async function drain(gen: AsyncGenerator<StreamEvent, GrokAcpRunResult>): Promise<{ events: StreamEvent[]; result?: GrokAcpRunResult; error?: unknown }> {
  const events: StreamEvent[] = []
  try {
    let step = await gen.next()
    while (!step.done) {
      events.push(step.value)
      step = await gen.next()
    }
    return { events, result: step.value }
  } catch (error) {
    return { events, error }
  }
}

describe.skipIf(process.platform === 'win32')('ACP runner — turn watchdog', () => {
  it('a tool call that runs longer than the idle budget completes: the tool budget applies while it is open', async () => {
    const { events, result, error } = await drain(runScript(
      [text('Asking a specialist.'), bridgedCall('call_1'), { sleep: 3_500 }, completed('call_1'), text(' Done.')],
      { idleMs: 2_000, toolMs: 20_000 },
    ))

    expect(error).toBeUndefined()
    expect(result?.text).toBe('Asking a specialist. Done.')
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', toolUseId: 'call_1', outcome: 'success', executedBy: 'eyas' }))
  }, 20_000)

  it('silence with no tool call open stops the turn at the idle budget, as a timeout', async () => {
    const started = Date.now()
    const { events, error } = await drain(runScript([text('Thinking.'), { sleep: 30_000 }, text('never')], { idleMs: 2_000, toolMs: 20_000 }))

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('TimeoutError')
    expect((error as Error).message).toMatch(/turn timed out: no activity for 2s$/)
    expect((error as Error).message).not.toMatch(/ACP request aborted/)
    expect(classifyModelError(error)).toMatchObject({ kind: 'timeout', retryable: true })
    // The error frame carries the same error, and the CLI was not waited out.
    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', error })
    expect(Date.now() - started).toBeLessThan(20_000)
  }, 25_000)
})

describe('ACP providers — turn timeouts are read at every turn', () => {
  const NO_SANDBOX: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'linux', which: () => null } }

  function capture() {
    const seen: Array<Record<string, unknown>> = []
    async function* fakeRun(opts: Record<string, unknown>) {
      seen.push(opts)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, usageReported: true, stopReason: 'end' as const }
    }
    return { seen, fakeRun: fakeRun as any }
  }
  async function drainStream(gen: AsyncIterable<StreamEvent>) { for await (const _ of gen) { /* consume */ } }
  const request = () => ({ messages: [{ role: 'user' as const, content: 'x' }], metadata: { workingDirectories: [cwd] } })

  for (const providerId of ['grok-cli', 'kimi-cli'] as const) {
    it(`${providerId}: the getter's current value reaches the runner on every turn (reload-safe)`, async () => {
      const { seen, fakeRun } = capture()
      let idleMs = 60_000
      const profile = createAcpProfile(providerId, { homesDir })
      const common = { profile, runPrompt: fakeRun, sandbox: NO_SANDBOX, turnTimeouts: () => ({ idleMs, toolMs: 900_000 }) }
      const provider = providerId === 'grok-cli' ? createGrokCliProvider(common) : createKimiCliProvider(common)

      await drainStream(provider.stream(request()))
      idleMs = 30_000
      await drainStream(provider.stream(request()))

      expect(seen.map((o) => o.turnTimeouts)).toEqual([{ idleMs: 60_000, toolMs: 900_000 }, { idleMs: 30_000, toolMs: 900_000 }])
      // The fixed whole-turn timeout is gone.
      expect(seen.every((o) => !('timeoutMs' in o))).toBe(true)
    })

    it(`${providerId}: no getter, or one that throws, means the defaults — never an instant abort`, async () => {
      const { seen, fakeRun } = capture()
      const profile = createAcpProfile(providerId, { homesDir })
      const defaults = { idleMs: DEFAULT_CLI_IDLE_TIMEOUT_MS, toolMs: DEFAULT_CLI_TOOL_TIMEOUT_MS }
      const make = (extra: Record<string, unknown>) => {
        const common = { profile, runPrompt: fakeRun, sandbox: NO_SANDBOX, ...extra }
        return providerId === 'grok-cli' ? createGrokCliProvider(common) : createKimiCliProvider(common)
      }

      await drainStream(make({}).stream(request()))
      await drainStream(make({ turnTimeouts: () => { throw new Error('config gone') } }).stream(request()))
      await drainStream(make({ turnTimeouts: () => ({ idleMs: 0, toolMs: -1 }) }).stream(request()))

      expect(seen.map((o) => o.turnTimeouts)).toEqual([defaults, defaults, defaults])
    })
  }
})
