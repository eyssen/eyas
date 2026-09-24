// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F10 — ACP session config options. The runner sets each requested option
// (Grok's reasoning_effort) with session/set_config_option after session/new
// and before session/prompt, and reports what the session REALLY ran with,
// read back from the CLI's own answers: never the value EYAS asked for.
// Shapes and semantics: grok 1.0.41 recording (acp-config-options.json).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGrokAcpPrompt, type GrokAcpRunOptions, type GrokAcpRunResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import {
  acpConfigValues,
  findAcpConfigOption,
  parseAcpConfigOptions,
  parseAcpSessionNew,
  parseAcpSessionUpdate,
} from '@modules/model/submodules/grok-cli/acp-events.js'
import { clearAcpPreflightCache, evaluateSessionNew } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { CliModelIdError } from '@modules/model/cli-model-id.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import type { StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog, type FakeAcpModels } from '../../../helpers/fake-acp.js'

const FIXTURES = join(__dirname, '..', '..', '..', 'fixtures', 'cli', 'grok')
const recorded = JSON.parse(readFileSync(join(FIXTURES, '1.0.41', 'acp-config-options.json'), 'utf8'))

describe('ACP config option parsing (one parser, recorded grok 1.0.41 shapes)', () => {
  it('reads the recorded session/new: the model and reasoning_effort options with their values (positive)', () => {
    const opened = parseAcpSessionNew(recorded.sessionNew)
    expect(opened.sessionId).toBe('<SESSION>')
    expect(opened.configOptions).toEqual([
      { id: 'model', name: 'Model', category: 'model', currentValue: 'grok-4.7', values: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-code-fast'] },
      { id: 'reasoning_effort', name: 'Reasoning Effort', category: 'thought_level', currentValue: 'high', values: ['xhigh', 'high', 'medium', 'low'] },
    ])
    expect(opened.models?.currentModelId).toBe('grok-4.7')
    const byId = Object.fromEntries(opened.models!.availableModels.map((m) => [m.modelId, m]))
    expect(byId['grok-4.5']).toMatchObject({ name: 'Grok 4.5', contextTokens: 500000, defaultEffort: 'high', efforts: ['high', 'medium', 'low'] })
    expect(byId['grok-code-fast']).toEqual({ modelId: 'grok-code-fast', name: 'Grok Code Fast', contextTokens: 256000 })
    expect(acpConfigValues(opened.configOptions)).toEqual({ model: 'grok-4.7', reasoning_effort: 'high' })
  })

  it('finds an option by id, else by category; grouped values are flattened', () => {
    const options = parseAcpConfigOptions([
      { id: 'effort-x', category: 'thought_level', currentValue: 'low', options: [{ group: 'a', name: 'A', options: [{ value: 'low' }, { value: 'high' }] }, { group: 'b', options: [{ value: 'high' }, { value: 'xhigh' }] }] },
    ])!
    expect(findAcpConfigOption(options, { id: 'reasoning_effort', category: 'thought_level' })?.values).toEqual(['low', 'high', 'xhigh'])
    expect(findAcpConfigOption(options, { id: 'reasoning_effort' })).toBeUndefined()
  })

  it('drops an invalid option and keeps the rest; a non-list is nothing (negative)', () => {
    expect(parseAcpConfigOptions({ id: 'model' })).toBeNull()
    expect(parseAcpConfigOptions([
      { id: 'model', currentValue: 'grok-4.7', options: [{ value: 'grok-4.7' }] },
      { id: '', currentValue: 'x' },
      { id: 'reasoning_effort', currentValue: 42 },
      'garbage',
    ])).toEqual([{ id: 'model', currentValue: 'grok-4.7', values: ['grok-4.7'] }])
  })

  it('a malformed configOptions never hides the permission mode from the isolation check (negative)', () => {
    const hostile = { sessionId: 's', modes: { currentModeId: 'always-approve' }, configOptions: 'not a list', models: 7 }
    expect(parseAcpSessionNew(hostile)).toEqual({ sessionId: 's', modeId: 'always-approve', configOptions: [], models: null })
    expect(evaluateSessionNew(hostile).map((v) => v.check)).toEqual(['permissionMode'])
    // A very long mode name is still checked.
    expect(evaluateSessionNew({ modes: { currentModeId: `always-approve-${'x'.repeat(500)}` } })).toHaveLength(1)
  })

  it('config_option_update joins the parsed session/update union; a malformed one is reported (positive + negative)', () => {
    const [, lowStep] = recorded.setConfigOption
    const parsed = parseAcpSessionUpdate({ sessionId: 's', update: lowStep.notifications[0] })
    expect(parsed.ok && parsed.event.kind).toBe('config_option_update')
    if (parsed.ok && parsed.event.kind === 'config_option_update') {
      expect(findAcpConfigOption(parsed.event.configOptions, { id: 'reasoning_effort' })?.currentValue).toBe('low')
    }
    expect(parseAcpSessionUpdate({ update: { sessionUpdate: 'config_option_update', configOptions: {} } }).ok).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('ACP runner — session config options (fake grok, 1.0.41 semantics)', () => {
  let root: string
  let cwd: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-config-')))
    cwd = join(root, 'workspace')
    mkdirSync(cwd, { recursive: true })
    clearAcpPreflightCache()
    resetIsolationStatuses()
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetIsolationStatuses()
  })

  async function drain(gen: AsyncGenerator<StreamEvent, GrokAcpRunResult>): Promise<{ events: StreamEvent[]; result: GrokAcpRunResult }> {
    const events: StreamEvent[] = []
    let step = await gen.next()
    while (!step.done) {
      events.push(step.value)
      step = await gen.next()
    }
    return { events, result: step.value }
  }

  function run(opts: Partial<GrokAcpRunOptions> & { models?: FakeAcpModels; scenario?: 'text' | 'script'; script?: string } = {}) {
    const log = join(root, `grok-${Math.random().toString(36).slice(2)}.log`)
    const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log, models: opts.models ?? 'recorded', scenario: opts.scenario, script: opts.script })
    const { models: _m, scenario: _s, script: _p, ...rest } = opts
    const logger = { debug: vi.fn(), warn: vi.fn() }
    const gen = runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, logger, ...rest })
    return { gen, log, logger }
  }

  const methods = (log: string) => readFakeAcpLog(log).received.map((m) => m.method).filter(Boolean)

  it("sets 'xhigh' after session/new and before session/prompt, and reads it back (positive)", async () => {
    const { gen, log } = run({ sessionConfig: { reasoning_effort: 'xhigh' } })
    const { result } = await drain(gen)
    expect(result.text).toBe('answer')
    const seen = methods(log)
    const at = (m: string) => seen.indexOf(m)
    expect(at('session/new')).toBeLessThan(at('session/set_config_option'))
    expect(at('session/set_config_option')).toBeLessThan(at('session/prompt'))
    const set = readFakeAcpLog(log).received.find((m) => m.method === 'session/set_config_option')!
    // A plain string value: the documented {value: …} object is refused by grok 1.0.41.
    expect(set.params).toEqual({ sessionId: 'fake-session-1', configId: 'reasoning_effort', value: 'xhigh' })
    expect(result.appliedConfig).toEqual({ model: 'grok-4.7', reasoning_effort: 'xhigh' })
    expect(result.resolvedModelId).toBe('grok-4.7')
  })

  it('a config_option_update during the turn updates the read-back value (positive)', async () => {
    const script = join(root, 'update.json')
    const [low] = recorded.setConfigOption.filter((s: any) => s.label === 'effort low (plain string)')
    writeFileSync(script, JSON.stringify({
      steps: [{ update: low.notifications[0] }, { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } } }],
      result: { stopReason: 'end_turn' },
    }))
    const { gen } = run({ sessionConfig: { reasoning_effort: 'high' }, scenario: 'script', script })
    const { result } = await drain(gen)
    expect(result.appliedConfig?.reasoning_effort).toBe('low')
  })

  it('the model the session runs is read back, not assumed: --model grok-4.5 reports grok-4.5 (positive)', async () => {
    const { gen, log } = run({ model: 'grok-4.5', sessionConfig: { reasoning_effort: 'medium' } })
    const { result } = await drain(gen)
    expect(readFakeAcpLog(log).start.argv).toEqual(['agent', '--no-leader', '--model', 'grok-4.5', 'stdio'])
    expect(result.resolvedModelId).toBe('grok-4.5')
    expect(result.appliedConfig).toEqual({ model: 'grok-4.5', reasoning_effort: 'medium' })
  })

  it('a model without the option: nothing is set, no effort is read back, the turn succeeds (negative)', async () => {
    const { gen, log } = run({ model: 'grok-code-fast', sessionConfig: { reasoning_effort: 'high' } })
    const { result } = await drain(gen)
    expect(result.text).toBe('answer')
    expect(methods(log)).not.toContain('session/set_config_option')
    expect(result.appliedConfig).toEqual({ model: 'grok-code-fast' })
  })

  it('a value the CLI refuses keeps the session value, which is what is reported; the turn succeeds (negative)', async () => {
    const { gen, log, logger } = run({ model: 'grok-4.5', sessionConfig: { reasoning_effort: 'xhigh' } })
    const { result } = await drain(gen)
    expect(result.text).toBe('answer')
    expect(methods(log)).toContain('session/set_config_option')
    expect(result.appliedConfig?.reasoning_effort).toBe('high')
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ configId: 'reasoning_effort', value: 'xhigh' }), expect.stringContaining('refused'))
  })

  it('no sessionConfig (Auto): no set_config_option at all; the default is still read back (negative)', async () => {
    const { gen, log } = run()
    const { result } = await drain(gen)
    expect(methods(log)).not.toContain('session/set_config_option')
    expect(result.appliedConfig).toEqual({ model: 'grok-4.7', reasoning_effort: 'high' })
  })

  it('an ill-formed config id or value is never sent (negative)', async () => {
    const { gen, log } = run({ sessionConfig: { reasoning_effort: '--yolo', 'bad id': 'high' } })
    await drain(gen)
    expect(methods(log)).not.toContain('session/set_config_option')
  })

  it('a --model the CLI does not offer fails before the prompt instead of silently running the default (negative)', async () => {
    const { gen, log } = run({ model: 'grok-9-nope' })
    let thrown: unknown
    try {
      await drain(gen)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(CliModelIdError)
    expect(String((thrown as Error).message)).toContain('grok-9-nope')
    expect(String((thrown as Error).message)).toContain('grok-4.7')
    expect(methods(log)).not.toContain('session/prompt')
  })

  it('the recorded grok 1.0.40 session (a model option only) reports its model and no effort (positive)', async () => {
    const log = join(root, 'legacy.log')
    const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log })
    const { result } = await drain(runGrokAcpPrompt({ profile, cwd, prompt: [{ type: 'text', text: 'hi' }], turnTimeouts: { idleMs: 20_000, toolMs: 20_000 }, sessionConfig: { reasoning_effort: 'high' } }))
    expect(result.resolvedModelId).toBe('grok-4.6')
    expect(result.appliedConfig).toEqual({ model: 'grok-4.6' })
    expect(methods(log)).not.toContain('session/set_config_option')
  })
})

/** Talk to the fake agent directly: send `messages` in order, collect every answer by id. */
async function exchange(executable: string, cwd: string, env: Record<string, string>, messages: Array<Record<string, unknown>>): Promise<Map<number, any>> {
  const { spawn } = await import('node:child_process')
  const { createInterface } = await import('node:readline')
  const proc = spawn(executable, ['agent', '--no-leader', 'stdio'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const answers = new Map<number, any>()
  const rl = createInterface({ input: proc.stdout! })
  let next = 0
  await new Promise<void>((resolve) => {
    const send = () => {
      if (next >= messages.length) { resolve(); return }
      proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...messages[next++] }) + '\n')
    }
    rl.on('line', (line) => {
      const msg = JSON.parse(line)
      if (msg.id != null && !msg.method) { answers.set(msg.id, msg); send() }
    })
    send()
  })
  proc.kill()
  return answers
}

describe.skipIf(process.platform === 'win32')('fake ACP agent fidelity', () => {
  it('answers session/new and set_config_option exactly as grok 1.0.41 did in the recording', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-fidelity-')))
    try {
      const cwd = join(root, 'w')
      mkdirSync(cwd)
      const profile = fakeAcpProfile({ homesDir: join(root, 'homes'), dir: root, log: join(root, 'f.log'), models: 'recorded' })
      const executable = await profile.resolveExecutable()
      const steps = recorded.setConfigOption as Array<{ label: string; params: Record<string, unknown>; result?: any; error?: any }>
      const answers = await exchange(executable, cwd, profile.env(), [
        { id: 1, method: 'initialize', params: { protocolVersion: 1 } },
        { id: 2, method: 'session/new', params: { cwd, mcpServers: [] } },
        ...steps.map((step, i) => ({ id: 3 + i, method: 'session/set_config_option', params: { ...step.params, sessionId: 'fake-session-1' } })),
      ])
      const created = answers.get(2).result
      expect(created.configOptions).toEqual(recorded.sessionNew.configOptions)
      expect(created.models).toEqual(recorded.sessionNew.models)
      steps.forEach((step, i) => {
        const answer = answers.get(3 + i)
        if (step.error) {
          expect(answer.error?.code, step.label).toBe(step.error.code)
          expect(String(answer.error?.data), step.label).toContain(String(step.error.data).split(' at line')[0])
        } else {
          expect(answer.result, step.label).toEqual(step.result)
        }
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
