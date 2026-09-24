// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider'
import { createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { imageOmittedText } from '@modules/model/helpers.js'
import type { ModelMessage, StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../helpers/fake-acp.js'
import type { AcpContentBlock } from '@modules/model/submodules/grok-cli/acp-prompt.js'
import { resetGrokSystemPromptVerdicts } from '@modules/model/submodules/grok-cli/acp-system-prompt.js'

/** A text-only prompt's text (the runner gets content blocks). */
function promptText(blocks: AcpContentBlock[]): string {
  expect(blocks.every((b) => b.type === 'text')).toBe(true)
  return blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

describe('Grok CLI Provider', () => {
  it('has correct id and name', () => {
    const provider = createGrokCliProvider()
    expect(provider.id).toBe('grok-cli')
    expect(provider.name).toBe('Grok CLI')
  })

  it('lists known models without CLI, claiming no concrete model for the default row', async () => {
    const provider = createGrokCliProvider()
    const models = await provider.listModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models[0].provider).toBe('grok-cli')
    expect(models[0].id).toBe('grok-cli-default')
    // Which model the CLI defaults to is the CLI's to say (a refresh records it).
    expect(models[0].metadata).toEqual({ alias: 'default' })
  })

  it('streams text and done from a mocked ACP runner', async () => {
    async function* fakeRun() {
      yield { type: 'text', text: 'Hello' } satisfies StreamEvent
      yield { type: 'thinking', text: '…' } satisfies StreamEvent
      return {
        text: 'Hello',
        inputTokens: 10,
        outputTokens: 5,
        stopReason: 'end' as const,
      }
    }

    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    const events: StreamEvent[] = []
    for await (const ev of provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'grok-cli-default',
    })) {
      events.push(ev)
    }

    expect(events.some((e) => e.type === 'text' && e.text === 'Hello')).toBe(true)
    expect(events.some((e) => e.type === 'thinking')).toBe(true)
    const done = events.find((e) => e.type === 'done')
    expect(done?.type).toBe('done')
    if (done?.type === 'done') {
      expect(done.response).not.toHaveProperty('sessionId')
      expect(done.response.provider).toBe('grok-cli')
      expect(done.response.usage.inputTokens).toBe(10)
    }
  })

  it('starts the ACP session in the conversation working directory, not process.cwd()', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-cwd-')))
    try {
      const seen: string[] = []
      async function* fakeRun(opts: { cwd: string }) {
        seen.push(opts.cwd)
        yield { type: 'text', text: 'ok' } satisfies StreamEvent
        return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
      }
      const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
      for await (const _ of provider.stream({
        messages: [{ role: 'user', content: 'how many modules are there?' }],
        model: 'grok-cli-default',
        metadata: { workingDirectory: folder },
      })) { /* drain */ }
      expect(seen).toEqual([folder])

      // No folder at all: an EYAS run scratch folder, never the server's cwd.
      for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'x' }] })) { /* drain */ }
      expect(seen[1]).not.toBe(process.cwd())
      expect(seen[1]).toContain('_runs')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('hands the runner its launch profile, the model and the tool-call cap', async () => {
    const seen: Array<Record<string, unknown>> = []
    async function* fakeRun(opts: Record<string, unknown>) {
      seen.push(opts)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const profile = createAcpProfile('grok-cli', { homesDir: '/nonexistent/cli-homes' })
    const provider = createGrokCliProvider({ profile, runPrompt: fakeRun as any, maxTurns: 4 })
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'x' }], model: 'grok-cli-grok-4.6' })) { /* drain */ }
    expect(seen[0].profile).toBe(profile)
    expect(seen[0].model).toBe('grok-4.6')
    expect(seen[0].maxTurns).toBe(4)
    expect(seen[0]).not.toHaveProperty('command')
    expect(seen[0]).not.toHaveProperty('buildArgs')
  })

  it('reports a capped turn as done{stopReason:max_turns} with the partial text, not as an error', async () => {
    async function* cappedRun() {
      yield { type: 'text', text: 'partial' } satisfies StreamEvent
      return { text: 'partial', inputTokens: 3, outputTokens: 2, usageReported: true, stopReason: 'max_turns' as const }
    }
    const provider = createGrokCliProvider({ runPrompt: cappedRun as any })
    const events: StreamEvent[] = []
    for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'x' }] })) events.push(ev)
    const done = events.find((e) => e.type === 'done')
    expect(done?.type).toBe('done')
    if (done?.type !== 'done') return
    expect(done.response.stopReason).toBe('max_turns')
    expect(done.response.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(done.response.usage).toEqual({ inputTokens: 3, outputTokens: 2 })
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('complete() aggregates stream into a response', async () => {
    async function* fakeRun() {
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return {
        text: 'ok',
        inputTokens: 1,
        outputTokens: 1,
        stopReason: 'end' as const,
      }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    const res = await provider.complete({ messages: [{ role: 'user', content: 'x' }] })
    expect(res.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(res.provider).toBe('grok-cli')
  })

  // A3 — continuity is EYAS replay only: the provider hands the runner no
  // session id (so it can never session/load a host session) and always
  // replays the earlier turns in the prompt itself.
  it('never passes a session id to the ACP runner, even from a legacy untyped caller', async () => {
    const seen: Array<Record<string, unknown>> = []
    async function* fakeRun(opts: Record<string, unknown>) {
      seen.push(opts)
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    for await (const _ of provider.stream({
      messages: [{ role: 'user', content: 'hi' }],
      sessionId: 'host-session-id',
    } as any)) { /* drain */ }
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toHaveProperty('sessionId')
  })

  it('injects the earlier turns as <conversation-history> on every call', async () => {
    const prompts: string[] = []
    async function* fakeRun(opts: { prompt: AcpContentBlock[] }) {
      prompts.push(promptText(opts.prompt))
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    for await (const _ of provider.stream({
      messages: [
        { role: 'user', content: 'my name is Ada' },
        { role: 'assistant', content: 'Hello Ada' },
        { role: 'user', content: 'what is my name?' },
      ],
      // A stale id from before A3 must not switch the prompt to last-message-only.
      sessionId: 'host-session-id',
    } as any)) { /* drain */ }
    expect(prompts[0]).toContain('<conversation-history>')
    expect(prompts[0]).toContain('User: my name is Ada')
    expect(prompts[0]).toContain('Assistant: Hello Ada')
    expect(prompts[0].endsWith('what is my name?')).toBe(true)
  })

  it('sends a single-message conversation without a history block', async () => {
    const prompts: string[] = []
    async function* fakeRun(opts: { prompt: AcpContentBlock[] }) {
      prompts.push(promptText(opts.prompt))
      yield { type: 'text', text: 'ok' } satisfies StreamEvent
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect(prompts).toEqual(['hi'])
  })

  // D9: a failed ACP run must reach the caller as a THROW. Yielding an error
  // event and returning normally let the gateway record the call as healthy and
  // the run as successful, which is how a dead CLI looked like a working one.
  it('stream() yields the error frame AND throws when the ACP run fails', async () => {
    const boom = new Error('grok CLI exited with code 1')
    async function* failingRun(): AsyncGenerator<StreamEvent, never> {
      yield { type: 'text', text: 'partial' }
      throw boom
    }

    const provider = createGrokCliProvider({ runPrompt: failingRun as any })
    const events: StreamEvent[] = []
    let thrown: unknown
    try {
      for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'x' }] })) {
        events.push(ev)
      }
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBe(boom)
    expect(events.some((e) => e.type === 'error' && e.error === boom)).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })

  it('complete() rejects when the ACP run fails', async () => {
    async function* failingRun(): AsyncGenerator<StreamEvent, never> {
      throw new Error('grok CLI unavailable')
    }
    const provider = createGrokCliProvider({ runPrompt: failingRun as any })
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('grok CLI unavailable')
  })
})

// H6 — every turn replays EYAS's own history as ACP content blocks, images
// inline in turn order; the images reach the CLI only when its initialize
// says it takes them, and the catalog's Vision flag follows that report.
describe('Grok CLI Provider — prompt content blocks and image capability', () => {
  const IMG1 = 'SU1BR0UtT05F'
  const IMG2 = 'SU1BR0UtVFdP'
  const png = (data: string) => ({ type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data } })
  const turn1: ModelMessage[] = [{ role: 'user', content: [png(IMG1), { type: 'text', text: 'what is this?' }] }]
  const turn2: ModelMessage[] = [
    ...turn1,
    { role: 'assistant', content: 'A cat.' },
    { role: 'user', content: [{ type: 'text', text: 'and this one?' }, png(IMG2)] },
  ]

  afterEach(() => resetIsolationStatuses())

  it('hands the runner the full EYAS history as content blocks on every turn, turn 1 image inline (positive)', async () => {
    const prompts: AcpContentBlock[][] = []
    async function* fakeRun(opts: { prompt: AcpContentBlock[] }) {
      prompts.push(opts.prompt)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createGrokCliProvider({ runPrompt: fakeRun as any })
    for await (const _ of provider.stream({ messages: turn1 })) { /* drain */ }
    for await (const _ of provider.stream({ messages: turn2 })) { /* drain */ }

    expect(prompts[0]).toEqual([
      { type: 'image', mimeType: 'image/png', data: IMG1 },
      { type: 'text', text: 'what is this?' },
    ])
    // Turn 2 carries turn 1 again, its image at the place it was sent.
    expect(prompts[1]).toEqual([
      { type: 'text', text: '<conversation-history>\nUser: ' },
      { type: 'image', mimeType: 'image/png', data: IMG1 },
      { type: 'text', text: 'what is this?\n\nAssistant: A cat.\n</conversation-history>\n\nand this one?' },
      { type: 'image', mimeType: 'image/png', data: IMG2 },
    ])
  })

  it('forwards the reported capability and its models follow it; before a report Grok claims no image input', async () => {
    const reports: Array<{ image: boolean }> = []
    let advertise = true
    async function* fakeRun(opts: { onPromptCapabilities?: (c: { image: boolean }) => void }) {
      opts.onPromptCapabilities?.({ image: advertise })
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const profile = createAcpProfile('grok-cli', { homesDir: '/nonexistent/cli-homes', resolveExecutable: async () => '/nonexistent/grok' })
    const provider = createGrokCliProvider({ profile, runPrompt: fakeRun as any, onPromptCapabilities: (c) => reports.push(c) })
    // grok 1.0.40 advertises no image input (A1 fixture), so the catalog starts there.
    expect((await provider.listModels()).every((m) => m.supportsImages === false)).toBe(true)

    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect(reports).toEqual([{ image: true }])
    expect((await provider.listModels()).every((m) => m.supportsImages === true)).toBe(true)

    advertise = false
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect(reports).toEqual([{ image: true }, { image: false }])
    expect((await provider.listModels()).every((m) => m.supportsImages === false)).toBe(true)
  })

  describe.skipIf(process.platform === 'win32')('through the real runner and a fake grok', () => {
    let root: string
    let cwd: string
    afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })

    async function runTurn(promptImage: boolean, messages: ModelMessage[] = turn2) {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-h6-')))
      cwd = join(root, 'workspace')
      mkdirSync(cwd, { recursive: true })
      const log = join(root, 'grok.log')
      const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log, promptImage })
      const reports: Array<{ image: boolean }> = []
      const provider = createGrokCliProvider({ profile, onPromptCapabilities: (c) => reports.push(c) })
      const events: StreamEvent[] = []
      for await (const ev of provider.stream({ messages, metadata: { workingDirectory: cwd } })) events.push(ev)
      const sent = readFakeAcpLog(log).received.find((m) => m.method === 'session/prompt')!
      return { events, reports, sent: sent.params.prompt as Array<Record<string, unknown>>, provider }
    }

    it('sends the image blocks when initialize advertises promptCapabilities.image (positive)', async () => {
      const { events, reports, sent, provider } = await runTurn(true)
      expect(events.some((e) => e.type === 'done')).toBe(true)
      expect(reports).toEqual([{ image: true }])
      expect(sent.filter((b) => b.type === 'image')).toEqual([
        { type: 'image', mimeType: 'image/png', data: IMG1 },
        { type: 'image', mimeType: 'image/png', data: IMG2 },
      ])
      expect(sent[0]).toEqual({ type: 'text', text: '<conversation-history>\nUser: ' })
      expect((await provider.listModels())[0].supportsImages).toBe(true)
    })

    it('without the capability sends the text stub, reports image:false and no image payload (negative)', async () => {
      const { events, reports, sent, provider } = await runTurn(false)
      expect(events.some((e) => e.type === 'done')).toBe(true)
      expect(reports).toEqual([{ image: false }])
      expect(sent.every((b) => b.type === 'text')).toBe(true)
      const wire = JSON.stringify(sent)
      expect(wire).not.toContain(IMG1)
      expect(wire).not.toContain(IMG2)
      const text = sent.map((b) => b.text).join('')
      expect(text.split(imageOmittedText('image/png')).length - 1).toBe(2)
      expect(text).toContain('what is this?')
      expect(text).toContain('and this one?')
      expect((await provider.listModels())[0].supportsImages).toBe(false)
    })

    it('a text block after an image still cannot start a CLI slash command (negative)', async () => {
      const { sent } = await runTurn(true, [{ role: 'user', content: [png(IMG1), { type: 'text', text: '/always-approve on' }] }])
      expect(sent[0]).toEqual({ type: 'image', mimeType: 'image/png', data: IMG1 })
      const text = sent[1].text as string
      expect(text.trimStart().startsWith('/')).toBe(false)
      expect(text).toContain('/always-approve on')
    })
  })
})

describe.skipIf(process.platform === 'win32')('Grok CLI Provider — system prompt channel (I8), temp GROK_HOME', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    resetGrokSystemPromptVerdicts()
    resetIsolationStatuses()
  })

  function setup(fake: { systemOverride?: 'honour' | 'ignore'; promptError?: boolean; scenario?: 'text' | 'ungoverned' } = {}) {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-i8-')))
    const cwd = join(root, 'workspace')
    mkdirSync(cwd, { recursive: true })
    const log = join(root, 'grok.log')
    const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log, ...fake })
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const provider = createGrokCliProvider({ profile, logger: logger as any })
    const turn = async (system?: string) => {
      const events: StreamEvent[] = []
      try {
        for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'hi' }], system, metadata: { workingDirectory: cwd } })) events.push(ev)
      } catch { /* the error frame is in events */ }
      const done = events.find((e) => e.type === 'done')
      return done?.type === 'done' ? done.response : null
    }
    /** The n-th session/new and session/prompt the fake received. */
    const wire = (n: number) => {
      const received = readFakeAcpLog(log).received
      return {
        created: received.filter((m) => m.method === 'session/new')[n],
        prompt: received.filter((m) => m.method === 'session/prompt')[n],
      }
    }
    return { profile, logger, turn, wire }
  }

  const overrideWarnings = (logger: { warn: ReturnType<typeof vi.fn> }) =>
    logger.warn.mock.calls.filter((c) => String(c[1]).includes('system prompt override did not reach the model'))

  it('nonce found: the first turn carries both, is meta-verified, and later turns send the override alone (positive)', async () => {
    const { profile, logger, turn, wire } = setup()
    const first = await turn('EYAS SYSTEM')
    expect(first?.systemPromptChannel).toBe('meta-verified')
    const one = wire(0)
    expect(one.created.params._meta.systemPromptOverride).toMatch(/^EYAS SYSTEM\n\n<!-- eyas-system-prompt-check [0-9a-f]+ -->$/)
    expect(one.prompt.params.prompt[0].text).toContain('<eyas-system-prompt>')

    const second = await turn('EYAS SYSTEM')
    expect(second?.systemPromptChannel).toBe('meta-verified')
    const two = wire(1)
    // The same marker (the system prompt stays identical from turn to turn), no fenced copy.
    expect(two.created.params._meta.systemPromptOverride).toBe(one.created.params._meta.systemPromptOverride)
    expect(two.prompt.params.prompt).toEqual([{ type: 'text', text: 'hi' }])
    expect(overrideWarnings(logger)).toHaveLength(0)
    // The check read the record before the purge: proven above, and nothing is left now.
    expect(existsSync(profile.sessionStorePath) ? readdirSync(profile.sessionStorePath) : []).toEqual([])
  })

  it('nonce missing: the same turn still had the prompt copy, a warning, and the next turn skips the override (negative)', async () => {
    const { logger, turn, wire } = setup({ systemOverride: 'ignore' })
    const first = await turn('EYAS SYSTEM')
    expect(first?.systemPromptChannel).toBe('prompt')
    expect(wire(0).prompt.params.prompt[0].text).toContain('EYAS SYSTEM')
    expect(overrideWarnings(logger)).toHaveLength(1)

    const second = await turn('EYAS SYSTEM')
    expect(second?.systemPromptChannel).toBe('prompt')
    expect(wire(1).created.params).not.toHaveProperty('_meta')
    expect(wire(1).prompt.params.prompt[0].text).toContain('<eyas-system-prompt>')
    expect(overrideWarnings(logger)).toHaveLength(1)
  })

  it('a turn that failed before the model request proves nothing: the next turn probes again (negative)', async () => {
    const { logger, turn, wire } = setup({ promptError: true })
    expect(await turn('EYAS SYSTEM')).toBeNull()
    await turn('EYAS SYSTEM')
    expect(wire(1).created.params._meta.systemPromptOverride).toContain('EYAS SYSTEM')
    expect(wire(1).prompt.params.prompt[0].text).toContain('<eyas-system-prompt>')
    expect(overrideWarnings(logger)).toHaveLength(0)
  })

  it('a failed turn that reached the model still decides the next turns (negative)', async () => {
    // The tripwire ends the turn after the model called a tool; the override was ignored.
    const { logger, turn, wire } = setup({ systemOverride: 'ignore', scenario: 'ungoverned' })
    expect(await turn('EYAS SYSTEM')).toBeNull()
    expect(overrideWarnings(logger)).toHaveLength(1)
    await turn('EYAS SYSTEM')
    expect(wire(1).created.params).not.toHaveProperty('_meta')
    expect(wire(1).prompt.params.prompt[0].text).toContain('<eyas-system-prompt>')
  })

  it('no system prompt: no override, no fence, no channel on the response (negative)', async () => {
    const { turn, wire } = setup()
    const response = await turn(undefined)
    expect(response).not.toBeNull()
    expect(response).not.toHaveProperty('systemPromptChannel')
    expect(wire(0).created.params).not.toHaveProperty('_meta')
    expect(wire(0).prompt.params.prompt).toEqual([{ type: 'text', text: 'hi' }])
  })
})

// F10 — the effort the gateway resolved reaches grok as the session's
// reasoning_effort option, and the response reports what the session REALLY
// ran with, read back from grok: the model and the effort, never the ids and
// levels EYAS asked for.
describe('Grok CLI Provider — per-turn effort and real model identity (F10)', () => {
  const GROK_45: import('@modules/model/reasoning/capability.js').ReasoningCapability = {
    kind: 'effort', levels: ['low', 'medium', 'high'], defaultLevel: 'high', canDisable: false, thinking: 'always-on',
    thinkingParam: 'none', samplingLocked: false, reasoningVisible: 'summary', displayParam: false, source: 'merged',
  }

  function capture(result: Record<string, unknown> = {}) {
    const seen: Array<Record<string, unknown>> = []
    async function* fakeRun(opts: Record<string, unknown>) {
      seen.push(opts)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const, ...result }
    }
    return { seen, provider: createGrokCliProvider({ runPrompt: fakeRun as any }) }
  }
  async function done(provider: ReturnType<typeof createGrokCliProvider>, request: Record<string, unknown>) {
    let response: any
    for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'x' }], ...request } as any)) if (ev.type === 'done') response = ev.response
    return response
  }

  it("hands the gateway's effort to the runner as the session's reasoning_effort (positive)", async () => {
    const { effortPlanFor } = await import('../../helpers/effort-plan.js')
    const { seen, provider } = capture()
    await done(provider, { effortPlan: effortPlanFor('medium', GROK_45) })
    expect(seen[0].sessionConfig).toEqual({ reasoning_effort: 'medium' })
  })

  it('Auto (or no plan) sets nothing: the model runs its own default (negative)', async () => {
    const { effortPlanFor } = await import('../../helpers/effort-plan.js')
    const { seen, provider } = capture()
    await done(provider, { effortPlan: effortPlanFor('auto', GROK_45) })
    await done(provider, {})
    expect(seen.map((o) => o.sessionConfig)).toEqual([undefined, undefined])
  })

  it('the response names the model grok ran and the confirmed effort, read back (positive)', async () => {
    const { effortPlanFor } = await import('../../helpers/effort-plan.js')
    const { provider } = capture({ resolvedModelId: 'grok-4.7', appliedConfig: { model: 'grok-4.7', reasoning_effort: 'high' } })
    const response = await done(provider, { model: 'grok-cli-default', effortPlan: effortPlanFor('xhigh', { ...GROK_45, levels: ['low', 'medium', 'high', 'xhigh'] }) })
    expect(response.model).toBe('grok-cli-default')
    expect(response.resolvedModelId).toBe('grok-4.7')
    expect(response.effortOutcome).toMatchObject({ effective: 'high', confirmed: true, clamped: true, reason: 'runtime-readback' })
  })

  it('a session without an effort option confirms nothing; no read-back model, no resolvedModelId (negative)', async () => {
    const { effortPlanFor } = await import('../../helpers/effort-plan.js')
    const { provider } = capture({ appliedConfig: { model: 'grok-code-fast' } })
    const response = await done(provider, { effortPlan: effortPlanFor('high', GROK_45) })
    expect(response).not.toHaveProperty('effortOutcome')
    const bare = await done(capture().provider, {})
    expect(bare).not.toHaveProperty('resolvedModelId')
    expect(bare).not.toHaveProperty('effortOutcome')
  })

  describe.skipIf(process.platform === 'win32')('through the gateway, the real runner and a fake grok (recorded 1.0.41 models)', () => {
    let root: string
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true })
      resetIsolationStatuses()
    })

    async function setup(lookup?: (id: string) => { realModelId?: string } | null) {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-f10-')))
      const cwd = join(root, 'workspace')
      mkdirSync(cwd, { recursive: true })
      const log = join(root, 'grok.log')
      const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log, models: 'recorded' })
      const provider = createGrokCliProvider({ profile, lookupModelMetadata: lookup })
      const { createModelGateway } = await import('@modules/model/gateway.js')
      const capabilities: Record<string, typeof GROK_45> = {
        'grok-cli-grok-4.5': GROK_45,
        // A stale record: claims xhigh, which grok refuses for grok-4.5.
        'grok-cli-stale-4.5': { ...GROK_45, levels: ['low', 'medium', 'high', 'xhigh'] },
      }
      const gateway = createModelGateway(undefined, { getReasoningCapability: (_p, id) => capabilities[id] ?? GROK_45 })
      gateway.registerProvider(provider)
      const turn = async (request: Record<string, unknown>) => {
        let response: any
        for await (const ev of gateway.stream({ provider: 'grok-cli', messages: [{ role: 'user', content: 'x' }], metadata: { workingDirectory: cwd }, ...request } as any)) {
          if (ev.type === 'done') response = ev.response
        }
        return response
      }
      return { turn, log }
    }

    it("'max' on grok-4.5 is clamped to 'high', sent, and confirmed by grok (positive)", async () => {
      const { turn, log } = await setup()
      const response = await turn({ model: 'grok-cli-grok-4.5', effort: { level: 'max', source: 'request' } })
      const set = readFakeAcpLog(log).received.find((m) => m.method === 'session/set_config_option')!
      expect(set.params.value).toBe('high')
      expect(readFakeAcpLog(log).start.argv).toEqual(['agent', '--no-leader', '--model', 'grok-4.5', 'stdio'])
      expect(response.resolvedModelId).toBe('grok-4.5')
      expect(response.effortOutcome).toEqual({ requested: 'max', effective: 'high', source: 'request', clamped: true, reason: 'unsupported', confirmed: true })
    })

    it('a level grok refuses is reported as what grok really ran, not as sent (negative)', async () => {
      const { turn } = await setup((id) => (id === 'grok-cli-stale-4.5' ? { realModelId: 'grok-4.5' } : null))
      const response = await turn({ model: 'grok-cli-stale-4.5', effort: { level: 'xhigh', source: 'conversation' } })
      expect(response.effortOutcome).toEqual({ requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'runtime-readback', confirmed: true })
    })

    it('the default row spawns without --model and reports the model grok chose (positive)', async () => {
      const { turn, log } = await setup()
      const response = await turn({ model: 'grok-cli-default' })
      expect(readFakeAcpLog(log).start.argv).toEqual(['agent', '--no-leader', 'stdio'])
      expect(response.model).toBe('grok-cli-default')
      expect(response.resolvedModelId).toBe('grok-4.7')
      // Auto: nothing was sent; the model's own default is what ran.
      expect(readFakeAcpLog(log).received.some((m) => m.method === 'session/set_config_option')).toBe(false)
      expect(response.effortOutcome).toMatchObject({ requested: 'auto', effective: 'high', confirmed: true })
    })

    it("a persisted 'grok-cli-grok-4.6' spawns --model grok-4.6 on a fresh provider and reports it from the read-back", async () => {
      const { turn, log } = await setup((id) => (id === 'grok-cli-grok-4.6' ? { realModelId: 'grok-4.6' } : null))
      const response = await turn({ model: 'grok-cli-grok-4.6' })
      expect(readFakeAcpLog(log).start.argv).toEqual(['agent', '--no-leader', '--model', 'grok-4.6', 'stdio'])
      expect(response.resolvedModelId).toBe('grok-4.6')
    })

    it('a model grok no longer offers fails the turn instead of silently running its default (negative)', async () => {
      const { turn, log } = await setup((id) => (id === 'grok-cli-grok-4.1' ? { realModelId: 'grok-4.1' } : null))
      await expect(turn({ model: 'grok-cli-grok-4.1' })).rejects.toThrow(/grok-4\.1.*does not offer it/)
      expect(readFakeAcpLog(log).received.some((m) => m.method === 'session/prompt')).toBe(false)
    })
  })
})
