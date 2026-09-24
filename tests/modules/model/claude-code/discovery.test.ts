// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F5 — zero-cost model discovery on the resolved Claude Code runtime: the
// probe asks the binary EYAS runs (never a `claude` of its own) through the
// SDK's `initialize` answer, on the isolated options, never yields a prompt,
// and maps what the runtime reports — alias, concrete model, effort levels
// including xhigh, adaptive thinking — onto model rows. The runtime is
// untrusted input: malformed entries are dropped, never guessed.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claudeModelSlug,
  claudeModelsFromDiscovery,
  parseRuntimeModels,
  probeClaudeRuntime,
  type ProbeQueryFn,
} from '@modules/model/submodules/claude-code/discovery.js'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { DiscoveredReasoningSchema } from '@modules/model/reasoning/schemas.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'
import { createTestDb } from '../../../helpers/test-db'

const RUNTIME = { path: '/opt/eyas-test/bin/claude', version: '2.1.281', source: 'host' as const }

/** What 2.1.281's `initialize` answer lists (the SDK's supportedModels() returns the same). */
const RUNTIME_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true, supportsFastMode: true },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus (1M context)', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-4-6', displayName: 'Sonnet', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'max'], supportsAdaptiveThinking: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku', description: '' },
]

const ACCOUNT = { email: 'operator@example.invalid', organization: 'Example Org', subscriptionType: 'max' }

interface FakeProbe {
  query: ProbeQueryFn
  calls: Array<{ options: Record<string, any> }>
  /** Whether each call's CLAUDE_CODE_TMPDIR existed when the CLI started. */
  tmpExisted: boolean[]
  /** Values the prompt iterable produced (must stay empty). */
  yielded: unknown[]
  /** Whether the prompt iterable finished (the probe released it). */
  promptDone: () => boolean
  closed: () => number
}

function fakeProbe(opts: { init?: unknown; supported?: () => Promise<unknown>; initFails?: Error; hang?: boolean } = {}): FakeProbe {
  const calls: FakeProbe['calls'] = []
  const tmpExisted: boolean[] = []
  const yielded: unknown[] = []
  let done = false
  let closed = 0
  const query: ProbeQueryFn = ({ prompt, options }) => {
    calls.push({ options })
    tmpExisted.push(existsSync(String((options.env as Record<string, string> | undefined)?.CLAUDE_CODE_TMPDIR)))
    // The SDK reads the prompt as the CLI's input stream.
    void (async () => {
      for await (const message of prompt) yielded.push(message)
      done = true
    })()
    const init = opts.init ?? { commands: [], agents: [], models: RUNTIME_MODELS, account: ACCOUNT }
    return {
      initializationResult: () =>
        opts.hang ? new Promise(() => {}) : opts.initFails ? Promise.reject(opts.initFails) : Promise.resolve(init),
      ...(opts.supported ? { supportedModels: opts.supported } : { supportedModels: async () => (init as any).models }),
      close: () => { closed++ },
    }
  }
  return { query, calls, tmpExisted, yielded, promptDone: () => done, closed: () => closed }
}

const dirs: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eyas-cc-discovery-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('claude-code discovery — the probe', () => {
  it('runs on the resolved runtime with the isolated options, no tools, in the given scratch folder (positive)', async () => {
    const fake = fakeProbe()
    const cwd = scratch()
    await probeClaudeRuntime(RUNTIME, { query: fake.query, cwd, envSource: { PATH: '/usr/bin', HOME: '/home/op', SECRET_TOKEN: 'x' } })
    expect(fake.calls).toHaveLength(1)
    const o = fake.calls[0].options
    expect(o.pathToClaudeCodeExecutable).toBe(RUNTIME.path)
    expect(o.cwd).toBe(cwd)
    expect(o.persistSession).toBe(false)
    expect(o.settingSources).toEqual([])
    expect(o.strictMcpConfig).toBe(true)
    expect(o.enableFileCheckpointing).toBe(false)
    expect(o.tools).toEqual([])
    expect(o.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
    expect(o.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe('1')
    // Its own temp root in the run scratch area, there while the CLI answers, gone after.
    expect(String(o.env.CLAUDE_CODE_TMPDIR).startsWith(join(process.env.EYAS_WORKSPACES_DIR!, '_runs', 'clitmp-'))).toBe(true)
    expect(fake.tmpExisted).toEqual([true])
    expect(existsSync(o.env.CLAUDE_CODE_TMPDIR)).toBe(false)
    // The allowlisted env, never a process.env spread.
    expect(o.env.SECRET_TOKEN).toBeUndefined()
    // No EYAS bridge, no hooks, no model, no prompt of any kind.
    expect(o.mcpServers).toBeUndefined()
    expect(o.hooks).toBeUndefined()
    expect(o.model).toBeUndefined()
  })

  it('never yields a prompt, releases the empty input and closes the query (negative)', async () => {
    const fake = fakeProbe()
    const result = await probeClaudeRuntime(RUNTIME, { query: fake.query, cwd: scratch() })
    await new Promise((r) => setTimeout(r, 0))
    expect(fake.yielded).toEqual([])
    expect(fake.promptDone()).toBe(true)
    expect(fake.closed()).toBe(1)
    expect(result.runtimeVersion).toBe('2.1.281')
    expect(result.models.map((m) => m.value)).toEqual(['default', 'opus', 'opus[1m]', 'sonnet', 'haiku'])
  })

  it('never reads or logs the signed-in account the same answer carries', async () => {
    const logger = { debug: vi.fn() }
    const result = await probeClaudeRuntime(RUNTIME, { query: fakeProbe().query, cwd: scratch(), logger })
    const seen = JSON.stringify([result, logger.debug.mock.calls])
    expect(seen).not.toContain(ACCOUNT.email)
    expect(seen).not.toContain(ACCOUNT.organization)
  })

  it('falls back to the init answer\'s list when supportedModels() fails', async () => {
    const fake = fakeProbe({ supported: () => Promise.reject(new Error('not supported')) })
    const result = await probeClaudeRuntime(RUNTIME, { query: fake.query, cwd: scratch() })
    expect(result.models).toHaveLength(RUNTIME_MODELS.length)
  })

  it('a failed initialize throws and still closes the query and removes its temp root (negative)', async () => {
    const fake = fakeProbe({ initFails: new Error('spawn ENOENT') })
    await expect(probeClaudeRuntime(RUNTIME, { query: fake.query, cwd: scratch() })).rejects.toThrow(/ENOENT/)
    expect(fake.closed()).toBe(1)
    expect(fake.yielded).toEqual([])
    expect(existsSync(fake.calls[0].options.env.CLAUDE_CODE_TMPDIR)).toBe(false)
  })

  it('a runtime that never answers times out and is closed (negative)', async () => {
    const fake = fakeProbe({ hang: true })
    await expect(probeClaudeRuntime(RUNTIME, { query: fake.query, cwd: scratch(), timeoutMs: 20 })).rejects.toThrow(/did not report its models/)
    expect(fake.closed()).toBe(1)
  })

  it('an answer with no usable model is a failure, never "no models" (negative)', async () => {
    const fake = fakeProbe({ init: { models: [{ value: '--dangerous' }, { displayName: 'no value' }] } })
    await expect(probeClaudeRuntime(RUNTIME, { query: fake.query, cwd: scratch() })).rejects.toThrow(/offered no model/)
  })
})

describe('claude-code discovery — parsing the runtime\'s rows tolerantly', () => {
  it('keeps readable entries and drops malformed, disabled and flag-like ones', () => {
    const models = parseRuntimeModels([
      { value: 'opus', supportsEffort: 'yes', supportedEffortLevels: 'high', displayName: 42 },
      { value: 'fable', disabled: true },
      { value: '-rf' },
      { value: '' },
      null,
      'sonnet',
      { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', futureField: { x: 1 } },
    ])
    expect(models.map((m) => m.value)).toEqual(['opus', 'claude-opus-4-8'])
    // A malformed optional field reads as absent.
    expect(models[0]).toMatchObject({ value: 'opus', supportsEffort: undefined, supportedEffortLevels: undefined, displayName: undefined })
    expect(parseRuntimeModels({ models: [] })).toEqual([])
  })

  it('slugs runtime values into stable EYAS ids', () => {
    expect(claudeModelSlug('default')).toBe('default')
    expect(claudeModelSlug('opus')).toBe('opus')
    expect(claudeModelSlug('opus[1m]')).toBe('opus-1m')
    expect(claudeModelSlug('claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(claudeModelSlug('Sonnet 4.6')).toBe('sonnet-4.6')
  })
})

describe('claude-code discovery — model rows', () => {
  const discoveredAt = '2026-09-23T10:00:00.000Z'
  const rows = () => claudeModelsFromDiscovery({ models: parseRuntimeModels(RUNTIME_MODELS), runtimeVersion: '2.1.281' }, discoveredAt)

  it('names each alias, the concrete model it runs and its effort levels — xhigh included when reported (positive)', () => {
    const models = rows()
    expect(models.map((m) => m.id)).toEqual(['claude-code-default', 'claude-code-opus', 'claude-code-opus-1m', 'claude-code-sonnet', 'claude-code-haiku'])
    const opus = models.find((m) => m.id === 'claude-code-opus')!
    expect(opus).toMatchObject({ name: 'Claude Code (Opus)', provider: 'claude-code', supportsTools: true, supportsImages: true, contextWindow: 200_000, maxOutputTokens: 128_000 })
    expect(opus.metadata).toEqual({
      alias: 'opus',
      realModelId: 'claude-opus-5-5',
      cliVersion: '2.1.281',
      reasoning: { source: 'sdk', param: 'effort', levels: ['low', 'medium', 'high', 'xhigh', 'max'], adaptiveThinking: true, thinkingDisplay: true, runtime: '2.1.281', discoveredAt },
      discoveredAt,
    })
    expect(models.find((m) => m.id === 'claude-code-default')!.name).toBe('Claude Code (Default)')
    expect(models.find((m) => m.id === 'claude-code-opus-1m')!.contextWindow).toBe(1_000_000)
    // Every reasoning block is THE discovered shape the registry reads.
    for (const m of models) expect(DiscoveredReasoningSchema.safeParse((m.metadata as any).reasoning).success).toBe(true)
  })

  it('a model the runtime offers no effort for has no reasoning control; a level it does not list is never claimed (negative)', () => {
    const models = rows()
    const haiku = models.find((m) => m.id === 'claude-code-haiku')!
    expect((haiku.metadata as any).reasoning).toMatchObject({ source: 'sdk', param: 'none', levels: [] })
    expect(haiku.maxOutputTokens).toBe(64_000)
    const sonnet = models.find((m) => m.id === 'claude-code-sonnet')!
    expect((sonnet.metadata as any).reasoning.levels).toEqual(['low', 'medium', 'high', 'max'])
    // Unknown rungs are dropped rather than guessed; supportsEffort false wins.
    const odd = claudeModelsFromDiscovery({ models: parseRuntimeModels([
      { value: 'a', supportsEffort: true, supportedEffortLevels: ['ultra', 'high', 'none', 'minimal'] },
      { value: 'b', supportsEffort: false, supportedEffortLevels: ['high'] },
    ]), runtimeVersion: null }, discoveredAt)
    expect((odd[0].metadata as any).reasoning).toMatchObject({ param: 'effort', levels: ['high'], adaptiveThinking: false })
    expect((odd[0].metadata as any).reasoning.runtime).toBeUndefined()
    expect((odd[1].metadata as any).reasoning).toMatchObject({ param: 'none', levels: [] })
  })

  it('the registry merges the runtime\'s levels over the overlay: Opus 5.5 keeps its default and cannot switch off', () => {
    const models = rows()
    const stored = new Map(models.map((m) => [m.id, m.metadata as any]))
    const registry = createReasoningRegistry({
      overlay: loadBundledOverlay(),
      getDiscovered: (_p, id) => stored.get(id)?.reasoning ?? null,
      getRealModelId: (_p, id) => stored.get(id)?.realModelId,
    })
    const opus = registry.get('claude-code', 'claude-code-opus')
    expect(opus.levels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(opus.defaultLevel).toBe('medium')
    expect(opus.canDisable).toBe(false)
    expect(opus.source).toBe('merged')
    const sonnet = registry.get('claude-code', 'claude-code-sonnet')
    expect(sonnet.levels).not.toContain('xhigh')
    expect(registry.get('claude-code', 'claude-code-haiku').kind).toBe('none')
    // 2.1.281 can be asked for the thinking display: the reasoning stays visible.
    expect(opus.displayParam).toBe(true)
    expect(opus.reasoningVisible).toBe('summary')
  })

  // R1B-16: a runtime older than the display flag, or one whose version is
  // unknown, cannot be asked for the thinking text — its models say so.
  it('a runtime without the display flag reports thinkingDisplay false, and the registry shows that reasoning as hidden (negative)', () => {
    for (const runtimeVersion of ['2.1.279', null]) {
      const models = claudeModelsFromDiscovery({ models: parseRuntimeModels(RUNTIME_MODELS), runtimeVersion }, discoveredAt)
      const stored = new Map(models.map((m) => [m.id, m.metadata as any]))
      for (const m of models) expect((m.metadata as any).reasoning.thinkingDisplay, `${m.id} on ${runtimeVersion}`).toBe(false)
      const registry = createReasoningRegistry({
        overlay: loadBundledOverlay(),
        getDiscovered: (_p, id) => stored.get(id)?.reasoning ?? null,
        getRealModelId: (_p, id) => stored.get(id)?.realModelId,
      })
      const opus = registry.get('claude-code', 'claude-code-opus')
      expect(opus.levels, 'the effort control itself is unchanged').toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
      expect(opus.displayParam).toBe(false)
      expect(opus.reasoningVisible).toBe('hidden')
    }
    // The flag's own minimum reports true.
    const current = claudeModelsFromDiscovery({ models: parseRuntimeModels(RUNTIME_MODELS), runtimeVersion: '2.1.280' }, discoveredAt)
    expect((current[0].metadata as any).reasoning.thinkingDisplay).toBe(true)
  })
})

describe('claude-code discovery — rediscovery on a stored catalog', () => {
  const testDb = createTestDb('claude-code-discovery')
  afterEach(() => testDb.cleanup())

  it('a later discovery updates the concrete model and flags an alias the runtime no longer offers', () => {
    const svc = createProviderConfigService(testDb.open())
    svc.ensureProvider('claude-code')
    const first = claudeModelsFromDiscovery({ models: parseRuntimeModels(RUNTIME_MODELS), runtimeVersion: '2.1.280' }, '2026-09-22T10:00:00.000Z')
    svc.reconcileDiscoveredModels('claude-code', first)
    expect(svc.getModelMetadata('claude-code', 'claude-code-opus')?.realModelId).toBe('claude-opus-5-5')

    const next = RUNTIME_MODELS
      .filter((m) => m.value !== 'haiku')
      .map((m) => (m.value === 'opus' ? { ...m, resolvedModel: 'claude-opus-5-6' } : m))
    const second = claudeModelsFromDiscovery({ models: parseRuntimeModels(next), runtimeVersion: '2.1.281' }, '2026-09-23T10:00:00.000Z')
    const outcome = svc.reconcileDiscoveredModels('claude-code', second)

    const opus = svc.getModelMetadata('claude-code', 'claude-code-opus')!
    expect(opus.realModelId).toBe('claude-opus-5-6')
    expect(opus.reasoning?.runtime).toBe('2.1.281')
    expect(outcome.missing).toEqual(['claude-code-haiku'])
    const haiku = svc.listModels('claude-code').find((r) => r.modelId === 'claude-code-haiku')!
    expect(haiku.enabled).toBe(false)
    expect(haiku.metadata?.missingSince).toBeTruthy()
  })
})
