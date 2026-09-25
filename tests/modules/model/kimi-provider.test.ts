// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import { createKimiProvider, KIMI_MODELS, KIMI_API_BASE_URL } from '@modules/model/submodules/kimi/provider'
import { createKimiCliProvider, KIMI_CLI_KNOWN_MODELS } from '@modules/model/submodules/kimi-cli/provider'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildKimiArgs, createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles'
import { estimateCost } from '@shared/model-pricing'
import { MODEL_DOWNGRADE_PATH } from '@modules/model/routing/types'
import { isCliProviderId, KIMI_CLI_PROVIDER_ID, CLI_DEFAULT_MODELS } from '@modules/model/onboarding-reconcile'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import type { StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../helpers/fake-acp.js'
import { createOpenAIProvider } from '@modules/model/submodules/openai/provider'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry'
import type { ModelMessage } from '@modules/model/types.js'
import { effortPlanFor } from '../../helpers/effort-plan.js'
import { installOpenAIWire, okCompletion, type OpenAIWire } from '../../helpers/openai-wire.js'

describe('Kimi API provider', () => {
  it('lists known Moonshot models', async () => {
    const p = createKimiProvider('test-key')
    expect(p.id).toBe('kimi')
    expect(p.name).toBe('Kimi')
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(KIMI_MODELS.map((m) => m.id))
    expect(models.some((m) => m.id === 'kimi-k3')).toBe(true)
    expect(models.some((m) => m.id === 'kimi-k2.7-code')).toBe(true)
  })

  it('uses the Moonshot OpenAI-compatible base URL', () => {
    expect(KIMI_API_BASE_URL).toBe('https://api.moonshot.ai/v1')
  })

  it('seeds only the models in the current model reference (no kimi-k2.5)', () => {
    expect(KIMI_MODELS.map((m) => m.id)).not.toContain('kimi-k2.5')
  })
})

// F7 — the Kimi dialect on the real OpenAI SDK against a fake fetch: the body
// is exactly what reaches Moonshot. Plans come from the real overlay rows.
describe('Kimi API provider — reasoning (kimi dialect)', () => {
  const registry = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => null })
  const planOf = (model: string, level: Parameters<typeof effortPlanFor>[0]) => effortPlanFor(level, registry.get('kimi', model))
  let wire: OpenAIWire
  afterEach(() => wire?.restore())

  async function body(model: string, level: Parameters<typeof effortPlanFor>[0], extra: Record<string, unknown> = {}) {
    wire = installOpenAIWire()
    wire.respondWith(okCompletion(model))
    await createKimiProvider('test-key').complete({ model, messages: [{ role: 'user', content: 'hi' }], effortPlan: planOf(model, level), ...extra })
    return wire.bodies[0]
  }

  it("K3 'high' sends reasoning_effort high, and no temperature (sampling is fixed)", async () => {
    const sent = await body('kimi-k3', 'high', { temperature: 0.2, maxTokens: 1000 })
    expect(sent.reasoning_effort).toBe('high')
    expect(sent).not.toHaveProperty('thinking')
    expect(sent).not.toHaveProperty('temperature')
    expect(sent.max_tokens).toBeGreaterThanOrEqual(1000)
    expect(sent).not.toHaveProperty('max_completion_tokens')
  })

  it("K2.6 'none' sends thinking disabled; 'high' sends thinking enabled; never reasoning_effort", async () => {
    const off = await body('kimi-k2.6', 'none')
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off).not.toHaveProperty('reasoning_effort')
    wire.restore()
    const on = await body('kimi-k2.6', 'high')
    expect(on.thinking).toEqual({ type: 'enabled' })
  })

  it("K2.7 Code (always thinking, no control) sends nothing for 'auto' — or for any level", async () => {
    for (const level of ['auto', 'high'] as const) {
      const sent = await body('kimi-k2.7-code', level)
      expect(sent).not.toHaveProperty('reasoning_effort')
      expect(sent).not.toHaveProperty('thinking')
      wire.restore()
    }
  })

  it('replays reasoning_content on the assistant tool_calls turn of a tool loop', async () => {
    wire = installOpenAIWire()
    wire.respondWith({
      id: 'k-1', object: 'chat.completion', model: 'kimi-k3',
      choices: [{ index: 0, finish_reason: 'tool_calls', message: {
        role: 'assistant', content: '', reasoning_content: 'Need the weather first.',
        tool_calls: [{ id: 'call_w', type: 'function', function: { name: 'weather', arguments: '{"city":"X"}' } }],
      } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = createKimiProvider('test-key')
    const first = await provider.complete({ model: 'kimi-k3', messages: [{ role: 'user', content: 'weather?' }], effortPlan: planOf('kimi-k3', 'high') })
    wire.respondWith(okCompletion('kimi-k3', 'Sunny.'))
    const messages: ModelMessage[] = [
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: first.content },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'call_w', content: 'sunny' }] },
    ]
    await provider.complete({ model: 'kimi-k3', messages, effortPlan: planOf('kimi-k3', 'high') })
    const assistant = wire.bodies[1].messages.find((m: any) => m.role === 'assistant')
    expect(assistant.reasoning_content).toBe('Need the weather first.')
    expect(assistant.tool_calls[0].id).toBe('call_w')
  })

  it('the openai dialect never sends reasoning_content back (negative)', async () => {
    wire = installOpenAIWire()
    wire.respondWith(okCompletion())
    const provider = createOpenAIProvider({ apiKey: 'k', baseURL: 'https://compat.example/v1', providerId: 'deepseek' })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'HIDDEN', origin: 'openai-reasoning-content', providerId: 'deepseek', modelId: 'deepseek-reasoner' },
        { type: 'tool_use', id: 'c1', name: 'fn', input: {} },
      ] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'r' }] },
    ]
    await provider.complete({ model: 'deepseek-reasoner', messages })
    expect(JSON.stringify(wire.bodies[0])).not.toContain('HIDDEN')
    expect(wire.bodies[0].messages[1]).not.toHaveProperty('reasoning_content')
  })
})

describe('Kimi Code CLI provider', () => {
  // F11 — the CLI names its own models (its config's [models] keys): the
  // seed is the CLI's default row only, and it claims no concrete model.
  it('seeds only the CLI default row, naming no model of its own', async () => {
    const p = createKimiCliProvider()
    expect(p.id).toBe('kimi-cli')
    const models = await p.listModels()
    expect(models.map((m) => m.id)).toEqual(['kimi-cli-default'])
    expect(models.length).toBe(KIMI_CLI_KNOWN_MODELS.length)
    expect(models[0].metadata).not.toHaveProperty('realModelId')
  })

  // `kimi acp` returns before reading any option (kimi-cli 1.52.0 source), so
  // a --model/--thinking on the argv would be ignored and misreport the model.
  it('builds ACP argv as exactly `kimi acp`, even when a model is requested', () => {
    expect(buildKimiArgs()).toEqual(['acp'])
    const profile = createAcpProfile('kimi-cli', { homesDir: '/nonexistent/cli-homes' })
    expect(profile.buildArgs({ model: 'kimi-k3' })).toEqual(['acp'])
    expect(profile.buildArgs({ model: 'kimi-k3' })).not.toContain('--model')
  })

  it('hands the runner its profile and no model (in-session selection only)', async () => {
    const seen: Array<Record<string, unknown>> = []
    async function* fakeRun(opts: Record<string, unknown>) {
      seen.push(opts)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const profile = createAcpProfile('kimi-cli', { homesDir: '/nonexistent/cli-homes' })
    const p = createKimiCliProvider({ profile, runPrompt: fakeRun as any, maxTurns: 7 })
    for await (const _ of p.stream({ model: 'kimi-cli-k3', messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect(seen[0].profile).toBe(profile)
    expect(seen[0].maxTurns).toBe(7)
    expect(seen[0].model).toBeUndefined()
  })

  it('starts the ACP session in the conversation folder, never process.cwd()', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-kimi-cwd-')))
    try {
      const seen: string[] = []
      async function* fakeRun(opts: { cwd: string }) {
        seen.push(opts.cwd)
        return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
      }
      const p = createKimiCliProvider({ runPrompt: fakeRun as any })
      for await (const _ of p.stream({
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { workingDirectory: folder },
      })) { /* drain */ }
      expect(seen).toEqual([folder])

      // No folder: an EYAS run scratch folder, not the server's cwd.
      for await (const _ of p.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
      expect(seen[1]).not.toBe(process.cwd())
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('reports a capped turn as done{stopReason:max_turns}, not as an error', async () => {
    async function* cappedRun() {
      return { text: 'partial', inputTokens: 0, outputTokens: 0, usageReported: false, stopReason: 'max_turns' as const }
    }
    const p = createKimiCliProvider({ runPrompt: cappedRun as any })
    const events: any[] = []
    for await (const ev of p.stream({ messages: [{ role: 'user', content: 'hi' }] })) events.push(ev)
    const done = events.find((e) => e.type === 'done')
    expect(done.response.stopReason).toBe('max_turns')
    expect(done.response.content).toEqual([{ type: 'text', text: 'partial' }])
    expect(done.response.usage.reported).toBe(false)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  // A3 — continuity is EYAS replay only: no session id reaches the ACP runner
  // and the earlier turns always travel in the prompt.
  it('never passes a session id to the ACP runner and always replays history', async () => {
    const seen: Array<{ prompt: Array<{ type: string; text?: string }> } & Record<string, unknown>> = []
    async function* fakeRun(opts: { prompt: Array<{ type: string; text?: string }> } & Record<string, unknown>) {
      seen.push(opts)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const p = createKimiCliProvider({ runPrompt: fakeRun as any })
    let done: any
    for await (const ev of p.stream({
      messages: [
        { role: 'user', content: 'my name is Ada' },
        { role: 'assistant', content: 'Hello Ada' },
        { role: 'user', content: 'what is my name?' },
      ],
      sessionId: 'host-session-id',
    } as any)) { if (ev.type === 'done') done = ev }
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toHaveProperty('sessionId')
    // A text-only conversation is one text block (H6: content blocks).
    expect(seen[0].prompt).toHaveLength(1)
    const text = seen[0].prompt[0].text ?? ''
    expect(text).toContain('<conversation-history>')
    expect(text).toContain('User: my name is Ada')
    expect(text.endsWith('what is my name?')).toBe(true)
    expect(done.response).not.toHaveProperty('sessionId')
  })
})

describe('Kimi pricing + routing', () => {
  it('prices K3 and K2.7 Code correctly', () => {
    expect(estimateCost('kimi', 'kimi-k3', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(3 + 15, 6)
    expect(estimateCost('kimi', 'kimi-k2.7-code', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.95 + 4, 6)
    expect(estimateCost('kimi-cli', 'kimi-cli-default', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.95 + 4, 6)
  })

  it('downgrades K3 → K2.7 code; the CLI has no downgrade path (its models are discovered per install)', () => {
    expect(MODEL_DOWNGRADE_PATH['kimi-k3']).toBe('kimi-k2.7-code')
    expect(Object.keys(MODEL_DOWNGRADE_PATH).filter((id) => id.startsWith('kimi-cli-'))).toEqual([])
  })

  it('prices a discovered CLI model at the default row rate, not the unrecognized fallback', () => {
    expect(estimateCost('kimi-cli', 'kimi-cli-kimi-code/kimi-for-coding', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.95 + 4, 6)
  })

  it('never downgrades to a model the Kimi catalog no longer seeds (kimi-k2.6 is the floor)', () => {
    const seeded = new Set(KIMI_MODELS.map((m) => m.id))
    for (const id of seeded) {
      const target = MODEL_DOWNGRADE_PATH[id]
      if (target) expect(seeded.has(target), `${id} → ${target}`).toBe(true)
    }
    expect(MODEL_DOWNGRADE_PATH['kimi-k2.6']).toBeUndefined()
  })

  it('registers kimi-cli as a host CLI provider', () => {
    expect(isCliProviderId(KIMI_CLI_PROVIDER_ID)).toBe(true)
    expect(CLI_DEFAULT_MODELS['kimi-cli']).toBe('kimi-cli-default')
  })
})

describe.skipIf(process.platform === 'win32')('Kimi Code CLI provider — system prompt channel (I8)', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    resetIsolationStatuses()
  })

  async function runTurn(system?: string) {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-kimi-i8-')))
    const cwd = join(root, 'workspace')
    mkdirSync(cwd, { recursive: true })
    const log = join(root, 'kimi.log')
    const profile = fakeAcpProfile({ providerId: 'kimi-cli', homesDir: join(root, 'data', 'cli-homes'), dir: root, log })
    const provider = createKimiCliProvider({ profile })
    const events: StreamEvent[] = []
    for await (const ev of provider.stream({ messages: [{ role: 'user', content: 'hi' }], system, metadata: { workingDirectory: cwd } })) events.push(ev)
    const received = readFakeAcpLog(log).received
    const done = events.find((e) => e.type === 'done')
    return {
      response: done?.type === 'done' ? done.response : null,
      created: received.find((m) => m.method === 'session/new')!,
      prompt: received.find((m) => m.method === 'session/prompt')!.params.prompt as Array<{ type: string; text?: string }>,
    }
  }

  it('prepends the fenced system prompt as the first text block and records the prompt channel (positive)', async () => {
    const { response, prompt } = await runTurn('EYAS SYSTEM')
    expect(prompt[0].text!.startsWith('<eyas-system-prompt>\n')).toBe(true)
    expect(prompt[0].text).toContain('EYAS SYSTEM')
    expect(prompt[1]).toEqual({ type: 'text', text: 'hi' })
    expect(response?.systemPromptChannel).toBe('prompt')
  })

  it('never sends the _meta systemPromptOverride (negative)', async () => {
    const { created } = await runTurn('EYAS SYSTEM')
    expect(created.params).not.toHaveProperty('_meta')
    expect(JSON.stringify(created.params)).not.toContain('systemPromptOverride')
  })

  it('no system prompt: no fence and no channel on the response (negative)', async () => {
    const { response, prompt } = await runTurn(undefined)
    expect(prompt).toEqual([{ type: 'text', text: 'hi' }])
    expect(response).not.toHaveProperty('systemPromptChannel')
  })
})
