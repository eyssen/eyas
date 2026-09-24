// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// MISSED-M-1 — an isolated ACP completion (Grok, Kimi) honours
// ModelRequest.maxTokens. Neither CLI takes an output limit from EYAS, so the
// runner counts the streamed answer: once it passes maxTokens × 4 characters,
// EYAS sends session/cancel and the turn ends as done with stopReason
// 'max_tokens' and the answer clipped to the cap — never a throw. A turn with
// tools is not capped by maxTokens. Driven end to end over real stdio against
// the fake ACP agent ('script' scenario), through the runner and through both
// providers.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunOptions, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import type { AIProvider, StreamEvent } from '@modules/model/types.js'
import type { AcpScriptStep } from '../stream-contract/fixtures/acp.js'
import { checkStreamContract } from '../stream-contract/harness.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'

let root: string
let homesDir: string
let cwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-output-cap-')))
  homesDir = join(root, 'data', 'cli-homes')
  cwd = join(root, 'workspace')
  mkdirSync(cwd, { recursive: true })
  vi.stubEnv('EYAS_WORKSPACES_DIR', join(root, 'workspaces'))
  resetIsolationStatuses()
  clearAcpPreflightCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetIsolationStatuses()
  clearAcpPreflightCache()
  rmSync(root, { recursive: true, force: true })
})

const text = (t: string): AcpScriptStep => ({ update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } } })
const thought = (t: string): AcpScriptStep => ({ update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: t } } })

/**
 * An answer that runs past a 3-token cap (12 characters) in its second chunk,
 * then keeps talking: a thought and more text in the same burst (sent before
 * the cancel can arrive), then more after a pause the cancel cuts short.
 */
const LONG_ANSWER: AcpScriptStep[] = [
  text('Hello, '),
  text('world and much more'),
  thought('THOUGHT-AFTER-CAP'),
  text('TEXT-AFTER-CAP'),
  { sleep: 5_000 },
  text('NEVER'),
]

function writeScript(steps: AcpScriptStep[]): string {
  const script = join(root, `script-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(script, JSON.stringify({ steps, result: { stopReason: 'end_turn', _meta: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } } }))
  return script
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

function runScript(steps: AcpScriptStep[], opts: Partial<GrokAcpRunOptions> & { log: string; providerId?: 'grok-cli' | 'kimi-cli' }) {
  const { log, providerId, ...rest } = opts
  const profile = fakeAcpProfile({ providerId, homesDir, dir: root, log, scenario: 'script', script: writeScript(steps), dialect: providerId === 'kimi-cli' ? 'kimi' : undefined })
  return runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'title this' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, ...rest })
}

const streamedText = (events: readonly StreamEvent[]) => events.map((e) => (e.type === 'text' ? e.text : '')).join('')
const cancels = (log: string) => readFakeAcpLog(log).received.filter((m) => m.method === 'session/cancel')

describe.skipIf(process.platform === 'win32')('ACP runner — the output cap of an isolated completion', () => {
  for (const providerId of ['grok-cli', 'kimi-cli'] as const) {
    it(`${providerId}: an answer past maxTokens × 4 characters cancels the session and ends as max_tokens with the clipped answer`, async () => {
      const log = join(root, `${providerId}-capped.log`)
      const started = Date.now()
      const { events, result, error } = await drain(runScript(LONG_ANSWER, { log, providerId, isolated: true, maxTokens: 3 }))

      expect(error).toBeUndefined()
      expect(result?.stopReason).toBe('max_tokens')
      expect(result?.text).toBe('Hello, world')
      // What streamed is exactly the answer the turn ends with.
      expect(streamedText(events)).toBe('Hello, world')
      // Nothing the model said after the cap reaches the caller.
      expect(events.some((e) => e.type === 'thinking')).toBe(false)
      expect(JSON.stringify(events)).not.toMatch(/AFTER-CAP|NEVER/)
      expect(events.some((e) => e.type === 'error')).toBe(false)
      // The CLI was told to stop, and the turn did not wait out its pause.
      expect(cancels(log)).toHaveLength(1)
      expect(Date.now() - started).toBeLessThan(4_000)
    }, 15_000)
  }

  it('an answer exactly at the cap runs to the end: no cancel, stopReason end (negative)', async () => {
    const log = join(root, 'exact.log')
    const { result, error } = await drain(runScript([text('Hello, '), text('world')], { log, isolated: true, maxTokens: 3 }))
    expect(error).toBeUndefined()
    expect(result?.stopReason).toBe('end')
    expect(result?.text).toBe('Hello, world')
    expect(cancels(log)).toEqual([])
  })

  it('a turn with tools is not capped by maxTokens: the whole answer, no cancel (negative)', async () => {
    const log = join(root, 'tools-turn.log')
    const steps = [text('Hello, '), text('world and much more')]
    const { result, error } = await drain(runScript(steps, { log, maxTokens: 3 }))
    expect(error).toBeUndefined()
    expect(result?.stopReason).toBe('end')
    expect(result?.text).toBe('Hello, world and much more')
    expect(cancels(log)).toEqual([])
  })

  it('an isolated completion without maxTokens is not capped (negative)', async () => {
    const log = join(root, 'no-max.log')
    const { result, error } = await drain(runScript([text('Hello, '), text('world and much more')], { log, isolated: true }))
    expect(error).toBeUndefined()
    expect(result?.stopReason).toBe('end')
    expect(result?.text).toBe('Hello, world and much more')
    expect(cancels(log)).toEqual([])
  })

  it('the thinking before the cap still streams; only the answer counts toward it', async () => {
    const log = join(root, 'thinking.log')
    const steps = [thought('a long line of reasoning well past twelve characters'), text('Short.')]
    const { events, result, error } = await drain(runScript(steps, { log, isolated: true, maxTokens: 3 }))
    expect(error).toBeUndefined()
    expect(result?.stopReason).toBe('end')
    expect(result?.text).toBe('Short.')
    expect(events.filter((e) => e.type === 'thinking')).toHaveLength(1)
    expect(cancels(log)).toEqual([])
  })
})

describe.skipIf(process.platform === 'win32')('Grok and Kimi providers — maxTokens reaches the runner', () => {
  function providerFor(providerId: 'grok-cli' | 'kimi-cli', steps: AcpScriptStep[], log: string): AIProvider {
    const profile = fakeAcpProfile({ providerId, homesDir, dir: root, log, scenario: 'script', script: writeScript(steps), dialect: providerId === 'kimi-cli' ? 'kimi' : undefined })
    return providerId === 'kimi-cli' ? createKimiCliProvider({ profile }) : createGrokCliProvider({ profile })
  }

  async function collect(provider: AIProvider, extra: Record<string, unknown>): Promise<{ events: StreamEvent[]; error?: unknown }> {
    const events: StreamEvent[] = []
    try {
      for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'title this' }], metadata: { workingDirectories: [cwd] }, ...extra } as any)) events.push(ev)
    } catch (error) {
      return { events, error }
    }
    return { events }
  }

  const doneOf = (events: StreamEvent[]) => events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done')

  for (const providerId of ['grok-cli', 'kimi-cli'] as const) {
    it(`${providerId}: an isolated one-shot past its maxTokens ends as done{max_tokens} with the partial answer, never a throw`, async () => {
      const log = join(root, `${providerId}-provider.log`)
      const { events, error } = await collect(providerFor(providerId, LONG_ANSWER, log), { isolated: true, maxTokens: 3 })

      expect(error).toBeUndefined()
      expect(events.some((e) => e.type === 'error')).toBe(false)
      const done = doneOf(events)!
      expect(done.response.stopReason).toBe('max_tokens')
      expect(done.response.content).toEqual([{ type: 'text', text: 'Hello, world' }])
      expect(checkStreamContract(events).violations).toEqual([])
      expect(cancels(log)).toHaveLength(1)
    }, 15_000)

    it(`${providerId}: the same answer within its maxTokens ends as done{end} with all of it (negative)`, async () => {
      const log = join(root, `${providerId}-provider-ok.log`)
      const { events, error } = await collect(providerFor(providerId, [text('Hello, '), text('world and much more')], log), { isolated: true, maxTokens: 100 })

      expect(error).toBeUndefined()
      const done = doneOf(events)!
      expect(done.response.stopReason).toBe('end')
      expect(done.response.content).toEqual([{ type: 'text', text: 'Hello, world and much more' }])
      expect(cancels(log)).toEqual([])
    })
  }
})
