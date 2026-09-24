// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A6 — the ACP runner fails closed, end to end over real stdio against the
// fake ACP agent (tests/fixtures/cli/fake-acp-agent.ts, replaying the A1
// grok 1.0.40 shapes): the preflight runs `grok inspect --json` before the
// session, session/new is checked, the tripwire cancels a session whose CLI
// runs a native tool EYAS never decided, and client-fs requests are jailed
// with one gate decision per operation.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunOptions, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { CliIsolationError, getIsolationStatus, resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import type { StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog, type FakeAcpInspect, type FakeAcpScenario } from '../../../helpers/fake-acp.js'

let root: string
let homesDir: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-isolation-')))
  homesDir = join(root, 'data', 'cli-homes')
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
  resetIsolationStatuses()
  clearAcpPreflightCache()
})

afterEach(() => {
  resetIsolationStatuses()
  clearAcpPreflightCache()
  rmSync(root, { recursive: true, force: true })
})

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

function run(opts: Partial<GrokAcpRunOptions> & {
  log: string
  scenario?: FakeAcpScenario
  inspect?: FakeAcpInspect
  sessionMode?: string
  readPath?: string
  maxTools?: number
  providerId?: 'grok-cli' | 'kimi-cli'
}) {
  const { log, scenario, inspect, sessionMode, readPath, maxTools, providerId, ...rest } = opts
  const profile = fakeAcpProfile({ providerId, homesDir, dir: root, log, scenario, inspect, sessionMode, readPath, maxTools })
  return runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, ...rest })
}

describe.skipIf(process.platform === 'win32')('ACP runner — preflight and session start', () => {
  it('runs `grok inspect --json` in the session cwd with the profile env before the session, then verifies (positive)', async () => {
    const log = join(root, 'ok.log')
    const { result, error } = await drain(run({ log }))
    expect(error).toBeUndefined()
    expect(result?.text).toBe('answer')
    const { inspects, start, received } = readFakeAcpLog(log)
    expect(inspects).toHaveLength(1)
    expect(inspects[0].argv).toEqual(['inspect', '--json'])
    expect(realpathSync(inspects[0].cwd)).toBe(cwd)
    expect(inspects[0].env.GROK_HOME).toBe(join(homesDir, 'grok-cli', '.grok'))
    expect(start.argv).toEqual(['agent', '--no-leader', 'stdio'])
    expect(received.map((m) => m.method)).toContain('session/prompt')
    expect(getIsolationStatus('grok-cli').status).toBe('verified')
  })

  it('a hostile inspect report refuses the turn before the session is spawned (negative)', async () => {
    const log = join(root, 'hostile.log')
    const { error } = await drain(run({ log, inspect: 'hostile' }))
    expect(error).toBeInstanceOf(CliIsolationError)
    const { start, received } = readFakeAcpLog(log)
    expect(start.argv).toEqual([])
    expect(received).toEqual([])
    expect(getIsolationStatus('grok-cli').status).toBe('violation')
  })

  it('an inspect that fails refuses the turn as unverified (fail closed)', async () => {
    const { error } = await drain(run({ log: join(root, 'fail.log'), inspect: 'fail' }))
    expect(error).toBeInstanceOf(CliIsolationError)
    expect((error as CliIsolationError).violations.map((v) => v.check)).toEqual(['unverified'])
    expect(getIsolationStatus('grok-cli').status).toBe('unverified')
  })

  it('a session/new in a bypass mode stops the turn before any prompt is sent (negative)', async () => {
    const log = join(root, 'mode.log')
    const { error } = await drain(run({ log, sessionMode: 'bypassPermissions' }))
    expect(error).toBeInstanceOf(CliIsolationError)
    const methods = readFakeAcpLog(log).received.map((m) => m.method)
    expect(methods).toContain('session/new')
    expect(methods).not.toContain('session/prompt')
    expect(getIsolationStatus('grok-cli').status).toBe('violation')
  })

  it('kimi: no inspect command; a clean EYAS home starts the session and verifies it', async () => {
    const log = join(root, 'kimi.log')
    const { result, error } = await drain(run({ log, providerId: 'kimi-cli' }))
    expect(error).toBeUndefined()
    expect(result?.text).toBe('answer')
    expect(readFakeAcpLog(log).inspects).toEqual([])
    expect(getIsolationStatus('kimi-cli').status).toBe('verified')
  })
})

describe.skipIf(process.platform === 'win32')('ACP runner — tripwire', () => {
  it('a native tool that runs without an EYAS decision cancels the session and ends the turn with CliIsolationError', async () => {
    const log = join(root, 'ungoverned.log')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { events, error } = await drain(run({ log, scenario: 'ungoverned', canUseTool }))
    expect(error).toBeInstanceOf(CliIsolationError)
    expect((error as CliIsolationError).violations.map((v) => v.check)).toEqual(['ungovernedTool'])
    // Nothing the CLI said after the trip reaches the caller.
    expect(events.some((e) => e.type === 'text' && e.text.includes('LEAKED-AFTER-TRIP'))).toBe(false)
    expect(events.some((e) => e.type === 'error')).toBe(true)
    // The CLI is stopped (session/cancel, then the process is ended): the
    // turn never gets its final answer from it.
    expect(readFakeAcpLog(log).received.some((m) => m.method === 'session/prompt')).toBe(true)
    expect(canUseTool).not.toHaveBeenCalled()
    expect(getIsolationStatus('grok-cli')).toMatchObject({ status: 'violation', checks: [{ check: 'ungovernedTool' }] })
  })

  it('the same calls with EYAS decisions run to the end (positive)', async () => {
    const { result, error } = await drain(run({ log: join(root, 'governed.log'), scenario: 'tools', maxTools: 3, canUseTool: async () => ({ behavior: 'allow' }) }))
    expect(error).toBeUndefined()
    expect(result?.stopReason).toBe('end')
  })
})

describe.skipIf(process.platform === 'win32')('ACP runner — client fs', () => {
  it('an in-root read_file: one gate decision, then the fs read is served (line 2, limit 2)', async () => {
    const probe = join(cwd, 'probe.txt')
    writeFileSync(probe, 'one\ntwo\nthree\nfour\n', 'utf8')
    const log = join(root, 'read.log')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { result, error } = await drain(run({ log, scenario: 'read', readPath: probe, canUseTool }))
    expect(error).toBeUndefined()
    expect(result?.text).toBe('read done')
    expect(canUseTool).toHaveBeenCalledTimes(1)
    // The gate hears which call it decides (G3: the row's outcome is keyed on it).
    expect(canUseTool).toHaveBeenCalledWith('Read', expect.objectContaining({ target_file: probe }), { toolCallId: 'call_main_0' })
    expect(readFakeAcpLog(log).fsReads).toEqual([{ content: 'two\nthree' }])
  })

  it('a read outside the conversation folders is refused even after the gate allowed the tool call (negative)', async () => {
    const secret = join(root, 'secret.txt')
    writeFileSync(secret, 'SECRET', 'utf8')
    const log = join(root, 'escape.log')
    const { error } = await drain(run({ log, scenario: 'read', readPath: secret, canUseTool: async () => ({ behavior: 'allow' }) }))
    expect(error).toBeUndefined()
    const [answer] = readFakeAcpLog(log).fsReads
    expect(answer).toHaveProperty('error')
    expect(JSON.stringify(answer)).not.toContain('SECRET')
  })

  it('an isolated completion refuses the tool call and ends the turn at the first one (tool cap 0)', async () => {
    const probe = join(cwd, 'probe.txt')
    writeFileSync(probe, 'x', 'utf8')
    const log = join(root, 'isolated.log')
    const canUseTool = vi.fn(async () => ({ behavior: 'allow' as const }))
    const { result, error } = await drain(run({ log, scenario: 'tools', isolated: true, canUseTool }))
    expect(error).toBeUndefined()
    expect(result?.stopReason).toBe('max_turns')
    expect(canUseTool).not.toHaveBeenCalled()
    const { received, permissionAnswers } = readFakeAcpLog(log)
    expect(permissionAnswers[0]?.decision).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(received.find((m) => m.method === 'session/new')?.params.mcpServers).toEqual([])
  })
})
