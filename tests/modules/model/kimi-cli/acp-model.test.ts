// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F11 — Kimi Code CLI: `kimi acp` takes no --model (kimi-cli 1.52.0
// cli/__init__.py returns before reading options for a subcommand), so EYAS
// selects the model and its thinking variant inside the ACP session with
// session/set_model, from the models state session/new reports: `<key>` is
// the plain variant, `<key>,thinking` the thinking one (acp/server.py
// _ModelIDConv / _expand_llm_models). Discovery reads that state with a
// session/new only. Kimi is not installed on the dev host: the fake agent's
// 'kimi' dialect answers as the 1.52.0 source does
// (tests/fixtures/cli/kimi/1.52.0/session-new-models.json).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  createKimiCliProvider,
  groupKimiModels,
  kimiModelsFromProbe,
  kimiSessionModelId,
  kimiThinkingApplied,
  kimiThinkingFor,
  parseKimiModelId,
} from '@modules/model/submodules/kimi-cli/provider.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { CliIsolationError, getIsolationStatus, resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { CliModelIdError } from '@modules/model/cli-model-id.js'
import { createReasoningRegistry } from '@modules/model/reasoning/registry.js'
import { DiscoveredReasoningSchema } from '@modules/model/reasoning/schemas.js'
import type { AcpSessionModels } from '@modules/model/submodules/grok-cli/acp-events.js'
import type { AcpProbeResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import type { EffortSetting } from '@modules/model/reasoning/ladder.js'
import type { ModelInfo, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types.js'
import { effortPlanFor } from '../../../helpers/effort-plan.js'
import { fakeAcpProfile, readFakeAcpLog, type FakeAcpProfileOptions } from '../../../helpers/fake-acp.js'

const NOW = '2026-09-23T10:00:00.000Z'

/** The derived kimi-cli 1.52.0 models state the fake's 'kimi' dialect reports. */
const STATE: AcpSessionModels = {
  currentModelId: 'kimi-code/kimi-for-coding,thinking',
  availableModels: [
    { modelId: 'kimi-code/kimi-for-coding', name: 'kimi-for-coding' },
    { modelId: 'kimi-code/kimi-for-coding,thinking', name: 'kimi-for-coding (thinking)' },
    { modelId: 'k2.6', name: 'kimi-k2.6' },
    { modelId: 'k2.6,thinking', name: 'kimi-k2.6 (thinking)' },
    { modelId: 'k2-thinking,thinking', name: 'kimi-k2-thinking' },
    { modelId: 'moonshot-v1-8k', name: 'moonshot-v1-8k' },
  ],
}

describe('Kimi model ids and variants (pure)', () => {
  it('splits an ACP id into the model key and its thinking variant', () => {
    expect(parseKimiModelId('k2.6,thinking')).toEqual({ key: 'k2.6', thinking: true })
    expect(parseKimiModelId('kimi-code/kimi-for-coding')).toEqual({ key: 'kimi-code/kimi-for-coding', thinking: false })
  })

  it('groups the variants: plain + thinking = toggle, thinking only = always on, plain only = no control', () => {
    expect(groupKimiModels(STATE.availableModels)).toEqual([
      { key: 'kimi-code/kimi-for-coding', name: 'kimi-for-coding', plain: true, thinking: true },
      { key: 'k2.6', name: 'kimi-k2.6', plain: true, thinking: true },
      { key: 'k2-thinking', name: 'kimi-k2-thinking', plain: false, thinking: true },
      { key: 'moonshot-v1-8k', name: 'moonshot-v1-8k', plain: true, thinking: false },
    ])
  })

  it('maps the effort plan: none → off, any other level → on, Auto (or no plan) → keep', () => {
    const cap = { kind: 'toggle', levels: ['none', 'high'], defaultLevel: null, canDisable: true, thinking: 'n/a', thinkingParam: 'none', samplingLocked: false, reasoningVisible: 'hidden', displayParam: false, source: 'discovered' } as const
    expect(kimiThinkingFor(effortPlanFor('none', { ...cap, levels: [...cap.levels] }))).toBe('off')
    expect(kimiThinkingFor(effortPlanFor('high', { ...cap, levels: [...cap.levels] }))).toBe('on')
    expect(kimiThinkingFor(effortPlanFor('auto', { ...cap, levels: [...cap.levels] }))).toBe('keep')
    expect(kimiThinkingFor(undefined)).toBe('keep')
  })

  it('selects the variant of a toggle model as asked, and keeps the current one for Auto', () => {
    expect(kimiSessionModelId(STATE, 'k2.6', 'off')).toBe('k2.6')
    expect(kimiSessionModelId(STATE, 'k2.6', 'on')).toBe('k2.6,thinking')
    // Auto on another model keeps the thinking state the session runs (on here).
    expect(kimiSessionModelId(STATE, 'k2.6', 'keep')).toBe('k2.6,thinking')
    // Auto on the current model: the current id, so nothing is sent.
    expect(kimiSessionModelId(STATE, 'kimi-code/kimi-for-coding', 'keep')).toBe(STATE.currentModelId)
    // The default row (no key) switches only the current model's variant.
    expect(kimiSessionModelId(STATE, undefined, 'off')).toBe('kimi-code/kimi-for-coding')
    expect(kimiSessionModelId(STATE, undefined, 'keep')).toBe(STATE.currentModelId)
  })

  it('a single-variant model always gets that variant, whatever was asked (negative)', () => {
    expect(kimiSessionModelId(STATE, 'k2-thinking', 'off')).toBe('k2-thinking,thinking')
    expect(kimiSessionModelId(STATE, 'moonshot-v1-8k', 'on')).toBe('moonshot-v1-8k')
  })

  it('a pinned key the session does not offer, or a session listing no models, is refused (negative)', () => {
    expect(() => kimiSessionModelId(STATE, 'kimi-k3', 'keep')).toThrow(CliModelIdError)
    expect(() => kimiSessionModelId(STATE, 'kimi-k3', 'keep')).toThrow(/does not offer it/)
    expect(() => kimiSessionModelId(null, 'k2.6', 'on')).toThrow(/lists no models/)
    // Nothing pinned and nothing known: the session keeps its own.
    expect(kimiSessionModelId(null, undefined, 'on')).toBeUndefined()
  })

  it('reads the thinking that ran from the model id the session ran', () => {
    expect(kimiThinkingApplied(STATE, 'k2.6,thinking')).toBe('high')
    expect(kimiThinkingApplied(STATE, 'k2.6')).toBe('none')
    expect(kimiThinkingApplied(STATE, 'k2-thinking,thinking')).toBe('high')
    // Nothing to choose, or not in the list: nothing is claimed.
    expect(kimiThinkingApplied(STATE, 'moonshot-v1-8k')).toBeUndefined()
    expect(kimiThinkingApplied(STATE, 'kimi-k3')).toBeUndefined()
    expect(kimiThinkingApplied(null, 'k2.6')).toBeUndefined()
  })
})

describe('kimiModelsFromProbe', () => {
  const probe: AcpProbeResult = {
    cliVersion: '1.52.0',
    defaultModelId: STATE.currentModelId!,
    models: STATE.availableModels.map((m) => ({ modelId: m.modelId, name: m.name, configOptions: [] })),
  }

  it('one row per model key plus the default row, each with its discovered thinking control (positive)', () => {
    const rows = kimiModelsFromProbe(probe, NOW)
    expect(rows.map((r) => r.id)).toEqual([
      'kimi-cli-default',
      'kimi-cli-kimi-code/kimi-for-coding',
      'kimi-cli-k2.6',
      'kimi-cli-k2-thinking',
      'kimi-cli-moonshot-v1-8k',
    ])
    // No row is ever a `,thinking` id: the variant is the effort, not the model.
    expect(rows.some((r) => r.id.includes(','))).toBe(false)
    const meta = (id: string) => rows.find((r) => r.id === id)!.metadata as Record<string, any>
    expect(meta('kimi-cli-default')).toMatchObject({ alias: 'default', realModelId: 'kimi-code/kimi-for-coding', cliVersion: '1.52.0' })
    expect(meta('kimi-cli-k2.6').reasoning).toEqual({ source: 'acp', param: 'toggle', levels: ['none', 'high'], runtime: '1.52.0', discoveredAt: NOW })
    expect(meta('kimi-cli-k2-thinking').reasoning).toMatchObject({ param: 'toggle', levels: ['high'], defaultLevel: 'high' })
    expect(meta('kimi-cli-moonshot-v1-8k').reasoning).toMatchObject({ param: 'none', levels: [] })
    for (const row of rows) expect(DiscoveredReasoningSchema.safeParse(meta(row.id).reasoning).success, row.id).toBe(true)
    expect(rows.find((r) => r.id === 'kimi-cli-k2.6')!.name).toBe('Kimi Code CLI (kimi-k2.6)')
  })

  it('the registry turns them into a toggle, an always-on model with no off switch, and no control', () => {
    const rows = kimiModelsFromProbe(probe, NOW)
    const registry = createReasoningRegistry({ getDiscovered: (_p, id) => (rows.find((r) => r.id === id)?.metadata as any)?.reasoning ?? null })
    expect(registry.get('kimi-cli', 'kimi-cli-k2.6').levels).toEqual(['none', 'high'])
    const alwaysOn = registry.get('kimi-cli', 'kimi-cli-k2-thinking')
    expect(alwaysOn.levels).toEqual(['high'])
    expect(alwaysOn.canDisable).toBe(false)
    expect(registry.get('kimi-cli', 'kimi-cli-moonshot-v1-8k').kind).toBe('none')
  })

  it('a probe that offered no usable model throws instead of emptying the catalog (negative)', () => {
    expect(() => kimiModelsFromProbe({ cliVersion: null, defaultModelId: null, models: [] }, NOW)).toThrow(/offered no model/)
    expect(() => kimiModelsFromProbe({ cliVersion: null, defaultModelId: null, models: [{ modelId: '--model,thinking', configOptions: null }] }, NOW)).toThrow(/offered no model/)
  })
})

describe.skipIf(process.platform === 'win32')('Kimi CLI provider over ACP (fake kimi 1.52.0 dialect)', () => {
  let root: string
  let cwd: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-kimi-f11-')))
    cwd = join(root, 'workspace')
    mkdirSync(cwd, { recursive: true })
    clearAcpPreflightCache()
    resetIsolationStatuses()
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetIsolationStatuses()
  })

  function setup(opts: Partial<FakeAcpProfileOptions> = {}) {
    const log = join(root, `kimi-${Math.random().toString(36).slice(2)}.log`)
    const profile = fakeAcpProfile({ providerId: 'kimi-cli', homesDir: join(root, 'data', 'cli-homes'), dir: root, log, dialect: 'kimi', ...opts })
    let catalog: ModelInfo[] = []
    const provider = createKimiCliProvider({
      profile,
      probeCwd: () => cwd,
      lookupModelMetadata: (id) => (catalog.find((m) => m.id === id)?.metadata as any) ?? null,
    })
    const registry = () => createReasoningRegistry({ getDiscovered: (_p, id) => (catalog.find((m) => m.id === id)?.metadata as any)?.reasoning ?? null })
    return {
      log,
      profile,
      provider,
      discover: async () => { catalog = await provider.fetchModels!() },
      /** One turn on `model` at `level`, planned against the discovered capability as the gateway would. */
      turn: async (model: string, level: EffortSetting): Promise<{ response: ModelResponse | null; error?: unknown }> => {
        const request: ModelRequest = {
          model,
          messages: [{ role: 'user', content: 'hi' }],
          metadata: { workingDirectory: cwd },
          effortPlan: effortPlanFor(level, registry().get('kimi-cli', model)),
        }
        let response: ModelResponse | null = null
        try {
          for await (const ev of provider.stream(request) as AsyncIterable<StreamEvent>) if (ev.type === 'done') response = ev.response
          return { response }
        } catch (error) {
          return { response, error }
        }
      },
      setModels: () => readFakeAcpLog(log).received.filter((m) => m.method === 'session/set_model').map((m) => m.params.modelId),
    }
  }

  it('discovery is a session/new only: the grouped catalog, no prompt, no model switch, argv exactly [acp] (positive)', async () => {
    const k = setup()
    await k.discover()
    const received = readFakeAcpLog(k.log).received.map((m) => m.method).filter(Boolean)
    expect(received).toContain('session/new')
    expect(received).not.toContain('session/prompt')
    expect(received).not.toContain('session/set_model')
    expect(readFakeAcpLog(k.log).start.argv).toEqual(['acp'])
    // The session check passed on this host: Kimi now counts as verified.
    expect(getIsolationStatus('kimi-cli').status).toBe('verified')
  })

  it("'none' selects the plain variant, 'high' the thinking variant, and the outcome is confirmed (positive)", async () => {
    const k = setup()
    await k.discover()
    const off = await k.turn('kimi-cli-k2.6', 'none')
    expect(off.error).toBeUndefined()
    const on = await k.turn('kimi-cli-k2.6', 'high')
    expect(k.setModels()).toEqual(['k2.6', 'k2.6,thinking'])
    expect(off.response).toMatchObject({ model: 'kimi-cli-k2.6', resolvedModelId: 'k2.6', effortOutcome: { effective: 'none', confirmed: true } })
    expect(on.response).toMatchObject({ resolvedModelId: 'k2.6', effortOutcome: { effective: 'high', confirmed: true } })
    // The model is chosen before the prompt, never on the argv.
    const methods = readFakeAcpLog(k.log).received.map((m) => m.method).filter(Boolean)
    expect(methods.indexOf('session/set_model')).toBeLessThan(methods.indexOf('session/prompt'))
    expect(readFakeAcpLog(k.log).start.argv).toEqual(['acp'])
  })

  it('the write set_model makes lands in the EYAS Kimi home, never elsewhere', async () => {
    const k = setup()
    await k.discover()
    await k.turn('kimi-cli-k2.6', 'high')
    const writes = readFakeAcpLog(k.log).configWrites
    expect(writes).toEqual([{ path: join(k.profile.configDir, 'config.toml'), default_model: 'k2.6', default_thinking: true }])
    expect(relative(k.profile.home, writes[0].path).startsWith('..')).toBe(false)
  })

  it('a thinking-only model offers no off switch: its thinking variant runs even for a clamped request', async () => {
    const k = setup()
    await k.discover()
    const r = await k.turn('kimi-cli-k2-thinking', 'none')
    expect(k.setModels()).toEqual(['k2-thinking,thinking'])
    expect(r.response).toMatchObject({ resolvedModelId: 'k2-thinking', effortOutcome: { effective: 'high' } })
  })

  it("'auto' sends no set_model when the session already runs the model (negative)", async () => {
    const k = setup()
    await k.discover()
    const pinned = await k.turn('kimi-cli-kimi-code/kimi-for-coding', 'auto')
    const byDefault = await k.turn('kimi-cli-default', 'auto')
    expect(k.setModels()).toEqual([])
    expect(pinned.response).toMatchObject({ resolvedModelId: 'kimi-code/kimi-for-coding' })
    expect(byDefault.response).toMatchObject({ model: 'kimi-cli-default', resolvedModelId: 'kimi-code/kimi-for-coding' })
    expect(readFakeAcpLog(k.log).configWrites).toEqual([])
  })

  it('a model that cannot think gets no thinking claim, whatever was asked (negative)', async () => {
    const k = setup()
    await k.discover()
    const r = await k.turn('kimi-cli-moonshot-v1-8k', 'high')
    expect(k.setModels()).toEqual(['moonshot-v1-8k'])
    expect(r.response?.resolvedModelId).toBe('moonshot-v1-8k')
    expect(r.response).not.toHaveProperty('effortOutcome')
  })

  it('a model the session does not offer ends the turn before any prompt (negative)', async () => {
    const k = setup()
    const r = await k.turn('kimi-cli-kimi-k3', 'auto')
    expect(r.error).toBeInstanceOf(CliModelIdError)
    const methods = readFakeAcpLog(k.log).received.map((m) => m.method)
    expect(methods).not.toContain('session/set_model')
    expect(methods).not.toContain('session/prompt')
  })

  it('a Kimi pointed at a share dir outside its EYAS home never starts: no spawn, no set_model, no outcome (negative)', async () => {
    const foreign = join(root, 'host', '.kimi')
    const k = setup({ extraEnv: () => ({ KIMI_SHARE_DIR: foreign }) })
    const r = await k.turn('kimi-cli-k2.6', 'high')
    expect(r.error).toBeInstanceOf(CliIsolationError)
    expect((r.error as CliIsolationError).violations.map((v) => v.check)).toContain('permissionMode')
    expect(r.response).toBeNull()
    const log = readFakeAcpLog(k.log)
    expect(log.start.argv).toEqual([])
    expect(log.received).toEqual([])
    expect(log.configWrites).toEqual([])
    // Discovery fails closed the same way: nothing is learned, so no thinking control.
    await expect(k.provider.fetchModels!()).rejects.toBeInstanceOf(CliIsolationError)
  })
})
