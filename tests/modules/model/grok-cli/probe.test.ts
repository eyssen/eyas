// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F10 — zero-cost Grok discovery over ACP. The probe runs the CLI through
// its isolated launch profile, passes the same fail-closed checks as a turn,
// opens one session, switches it to every model it offers and reads each
// model's reasoning_effort option back — and never sends a prompt. The
// catalog rows it produces name their concrete model, the CLI version and
// the per-model effort levels in THE discovered-reasoning shape.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAcpProbe, type AcpProbeResult } from '@modules/model/submodules/grok-cli/acp-client.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { CliIsolationError, getIsolationStatus, resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { createGrokCliProvider, grokModelsFromProbe } from '@modules/model/submodules/grok-cli/provider.js'
import { DiscoveredReasoningSchema } from '@modules/model/reasoning/schemas.js'
import { createReasoningRegistry } from '@modules/model/reasoning/registry.js'
import { fakeAcpProfile, readFakeAcpLog, type FakeAcpProfileOptions } from '../../../helpers/fake-acp.js'

const NOW = '2026-09-23T10:00:00.000Z'

describe.skipIf(process.platform === 'win32')('runAcpProbe (fake grok, recorded 1.0.41 models)', () => {
  let root: string
  let cwd: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-probe-')))
    cwd = join(root, 'scratch', 'model-probe')
    mkdirSync(cwd, { recursive: true })
    clearAcpPreflightCache()
    resetIsolationStatuses()
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetIsolationStatuses()
  })

  function probeWith(opts: Partial<FakeAcpProfileOptions> = {}) {
    const log = join(root, `probe-${Math.random().toString(36).slice(2)}.log`)
    const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log, models: 'recorded', ...opts })
    return { log, profile, run: () => runAcpProbe({ profile, cwd, enumerate: 'model', timeoutMs: 20_000 }) }
  }

  it('reads every model and its effort option: grok-4.5 without xhigh, grok-code-fast without control (positive)', async () => {
    const { run } = probeWith()
    const probe = await run()
    expect(probe.cliVersion).toBe('1.0.40')
    expect(probe.defaultModelId).toBe('grok-4.7')
    expect(probe.models.map((m) => m.modelId)).toEqual(['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-code-fast'])
    const effort = (id: string) => probe.models.find((m) => m.modelId === id)!.configOptions?.find((o) => o.id === 'reasoning_effort')
    expect(effort('grok-4.7')?.values).toEqual(['xhigh', 'high', 'medium', 'low'])
    expect(effort('grok-4.5')?.values).toEqual(['high', 'medium', 'low'])
    expect(probe.models.find((m) => m.modelId === 'grok-code-fast')!.configOptions).not.toBeNull()
    expect(effort('grok-code-fast')).toBeUndefined()
    expect(probe.models.find((m) => m.modelId === 'grok-4.5')).toMatchObject({ contextTokens: 500000, defaultEffort: 'high', name: 'Grok 4.5' })
  })

  it('spawns through the profile: the EYAS home and switches, the plain argv, the store purged (positive)', async () => {
    const { run, log, profile } = probeWith()
    await run()
    const { start, inspects } = readFakeAcpLog(log)
    expect(start.argv).toEqual(['agent', '--no-leader', 'stdio'])
    expect(start.env.HOME).toBe(profile.home)
    expect(start.env.GROK_HOME).toBe(join(profile.home, '.grok'))
    expect(start.env.GROK_MEMORY).toBe('0')
    expect(inspects).toHaveLength(1)
    expect(existsSync(profile.sessionStorePath) ? readdirSync(profile.sessionStorePath) : []).toEqual([])
    // A passed session start is recorded like a turn's.
    expect(getIsolationStatus('grok-cli').status).toBe('verified')
  })

  it('never sends session/prompt and never asks for tools; the model switches are the only changes (negative)', async () => {
    const { run, log } = probeWith()
    await run()
    const received = readFakeAcpLog(log).received
    expect(received.some((m) => m.method === 'session/prompt')).toBe(false)
    const sets = received.filter((m) => m.method === 'session/set_config_option').map((m) => m.params)
    expect(sets.map((p) => [p.configId, p.value])).toEqual([['model', 'grok-4.6'], ['model', 'grok-4.5'], ['model', 'grok-code-fast']])
    expect(received.find((m) => m.method === 'session/new')?.params).toEqual({ cwd, mcpServers: [] })
  })

  it('a CLI that would load a host MCP server is refused before it is spawned (A6 preflight, negative)', async () => {
    const { run, log } = probeWith({ inspect: 'hostile' })
    await expect(run()).rejects.toBeInstanceOf(CliIsolationError)
    expect(readFakeAcpLog(log).start.argv).toEqual([])
  })

  it('a session that starts in an always-approve mode is refused before any model switch (A6 check, negative)', async () => {
    const { run, log } = probeWith({ sessionMode: 'always-approve' })
    await expect(run()).rejects.toBeInstanceOf(CliIsolationError)
    const received = readFakeAcpLog(log).received
    expect(received.some((m) => m.method === 'session/set_config_option')).toBe(false)
    expect(received.some((m) => m.method === 'session/prompt')).toBe(false)
  })

  it('the recorded 1.0.40 session (one model, no effort option) is read as such (positive)', async () => {
    const { run } = probeWith({ models: undefined })
    const probe = await run()
    expect(probe.defaultModelId).toBe('grok-4.6')
    expect(probe.models).toEqual([{ modelId: 'grok-4.6', name: 'grok-4.6', contextTokens: 256000, configOptions: [
      { id: 'model', name: 'Model', category: 'model', currentValue: 'grok-4.6', values: ['grok-4.6'] },
    ] }])
  })
})

describe('grokModelsFromProbe', () => {
  const probe: AcpProbeResult = {
    cliVersion: '1.0.41',
    defaultModelId: 'grok-4.7',
    models: [
      {
        modelId: 'grok-4.7', name: 'Grok 4.7', contextTokens: 500000, defaultEffort: 'high',
        configOptions: [
          { id: 'model', currentValue: 'grok-4.7', values: ['grok-4.7', 'grok-4.5', 'grok-code-fast', 'grok-lost'] },
          { id: 'reasoning_effort', category: 'thought_level', currentValue: 'high', values: ['xhigh', 'high', 'medium', 'low'] },
        ],
      },
      {
        modelId: 'grok-4.5', contextTokens: 400000,
        configOptions: [
          { id: 'model', currentValue: 'grok-4.5', values: ['grok-4.7', 'grok-4.5'] },
          // Carried over from the previous model, not grok-4.5's default.
          { id: 'reasoning_effort', category: 'thought_level', currentValue: 'low', values: ['high', 'medium', 'low'] },
        ],
      },
      { modelId: 'grok-code-fast', configOptions: [{ id: 'model', currentValue: 'grok-code-fast', values: ['grok-code-fast'] }] },
      { modelId: 'grok-lost', configOptions: null },
      { modelId: '--always-approve', configOptions: null },
    ],
  }

  it('a default row plus one per model, each naming its concrete model, the CLI version and its effort levels (positive)', () => {
    const rows = grokModelsFromProbe(probe, NOW)
    expect(rows.map((r) => r.id)).toEqual(['grok-cli-default', 'grok-cli-grok-4.7', 'grok-cli-grok-4.5', 'grok-cli-grok-code-fast', 'grok-cli-grok-lost'])
    const meta = (id: string) => rows.find((r) => r.id === id)!.metadata as Record<string, any>
    expect(meta('grok-cli-default')).toMatchObject({ alias: 'default', realModelId: 'grok-4.7', cliVersion: '1.0.41', discoveredAt: NOW })
    expect(meta('grok-cli-grok-4.7').reasoning).toEqual({
      source: 'acp', param: 'effort', levels: ['low', 'medium', 'high', 'xhigh'], defaultLevel: 'high', runtime: '1.0.41', discoveredAt: NOW,
    })
    expect(meta('grok-cli-default').reasoning).toEqual(meta('grok-cli-grok-4.7').reasoning)
    expect(rows.find((r) => r.id === 'grok-cli-grok-4.5')!.contextWindow).toBe(400000)
    for (const row of rows) {
      const reasoning = (row.metadata as any).reasoning
      if (reasoning) expect(DiscoveredReasoningSchema.safeParse(reasoning).success).toBe(true)
    }
  })

  it('a model without the option has no control; a switched model never takes a carried-over value as its default (negative)', () => {
    const rows = grokModelsFromProbe(probe, NOW)
    const meta = (id: string) => rows.find((r) => r.id === id)!.metadata as Record<string, any>
    expect(meta('grok-cli-grok-code-fast').reasoning).toEqual({ source: 'acp', param: 'none', levels: [], runtime: '1.0.41', discoveredAt: NOW })
    expect(meta('grok-cli-grok-4.5').reasoning.levels).toEqual(['low', 'medium', 'high'])
    expect(meta('grok-cli-grok-4.5').reasoning).not.toHaveProperty('defaultLevel')
    // A model that could not be selected claims nothing about its reasoning.
    expect(meta('grok-cli-grok-lost')).not.toHaveProperty('reasoning')
    // A name the CLI must never receive as --model is not a row.
    expect(rows.some((r) => r.id.includes('always-approve'))).toBe(false)
  })

  it('an empty probe throws: a failed discovery is never "no models" (negative)', () => {
    expect(() => grokModelsFromProbe({ cliVersion: null, defaultModelId: null, models: [] }, NOW)).toThrow(/no model/)
  })

  it('the registry reads the discovered levels over the overlay: grok-4.5 caps at high, the default row follows its model', () => {
    const rows = grokModelsFromProbe(probe, NOW)
    const stored = new Map(rows.map((r) => [r.id, r.metadata as Record<string, any>]))
    const registry = createReasoningRegistry({
      getDiscovered: (_p, id) => stored.get(id)?.reasoning ?? null,
      getRealModelId: (_p, id) => stored.get(id)?.realModelId,
    })
    expect(registry.get('grok-cli', 'grok-cli-grok-4.5').levels).toEqual(['low', 'medium', 'high'])
    expect(registry.get('grok-cli', 'grok-cli-default').levels).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(registry.get('grok-cli', 'grok-cli-grok-code-fast').kind).toBe('none')
  })
})

describe.skipIf(process.platform === 'win32')('Grok CLI provider — fetchModels over ACP', () => {
  let root: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-fetch-')))
    clearAcpPreflightCache()
    resetIsolationStatuses()
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetIsolationStatuses()
  })

  it('discovers through the probe in the given scratch folder and keeps the reported Vision flag (positive)', async () => {
    const cwd = join(root, 'scratch')
    mkdirSync(cwd)
    const profile = fakeAcpProfile({ homesDir: join(root, 'data', 'cli-homes'), dir: root, log: join(root, 'p.log'), models: 'recorded', promptImage: true })
    const provider = createGrokCliProvider({ profile, probeCwd: () => cwd })
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { workingDirectory: cwd } })) { /* drain */ }
    const models = await provider.fetchModels!()
    expect(models.map((m) => m.id)).toEqual(['grok-cli-default', 'grok-cli-grok-4.7', 'grok-cli-grok-4.6', 'grok-cli-grok-4.5', 'grok-cli-grok-code-fast'])
    expect(models.every((m) => m.supportsImages === true)).toBe(true)
  })

  it('a failed probe rejects, never answering with the static list (negative)', async () => {
    const provider = createGrokCliProvider({
      runProbe: async () => { throw new Error('grok: not signed in') },
      probeCwd: () => root,
    })
    await expect(provider.fetchModels!()).rejects.toThrow(/not signed in/)
  })
})
