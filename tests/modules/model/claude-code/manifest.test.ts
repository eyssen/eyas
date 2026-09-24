// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code provider loading: the provider is registered only when the
// resolved runtime is signed in, it is built with that runtime, the first
// load persists the known model caps at once without any model call (CCB-2 /
// R2A-14), and every load rediscovers the models in the background through
// the zero-cost runtime probe (F5).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  auth: vi.fn(),
  probe: vi.fn(),
  queryOptions: [] as any[],
}))

// The discovery probe is faked (discovery.test.ts covers the real one): what
// the runtime's `initialize` answer would list.
vi.mock('@modules/model/submodules/claude-code/discovery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@modules/model/submodules/claude-code/discovery.js')>()),
  probeClaudeRuntime: h.probe,
}))

vi.mock('@modules/model/submodules/claude-code/runtime.js', () => ({
  resolveClaudeRuntime: h.resolve,
  readClaudeAuthStatus: h.auth,
  toClaudeRuntime: (r: any) => ({ path: r.path, version: r.version, source: r.source }),
  isClaudeRuntimeUsable: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.queryOptions.push(args.options)
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: () => ({}),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { claudeCodeManifest } from '@modules/model/submodules/claude-code/manifest.js'
import { PROVIDER_WINDOW } from '@modules/model/model-window.js'

const HOST = { ok: true, id: 'claude-code', path: '/usr/local/bin/claude', version: '2.1.280', source: 'host', expectedVersion: '2.1.89', warnings: ['claude-code: version skew — …'] }

function fakeCtx(opts: { enabled?: boolean; existingModels?: number; storedRows?: any[]; settings?: Record<string, unknown> } = {}) {
  const providers = new Map<string, any>()
  let settings: Record<string, unknown> = { ...(opts.settings ?? {}) }
  const reload = new Map<string, () => Promise<void>>()
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    model: {
      registerProvider: vi.fn((p: any) => providers.set(p.id, p)),
      unregisterProvider: vi.fn((id: string) => providers.delete(id)),
      getProvider: (id: string) => providers.get(id),
    },
    providerConfig: {
      ensureProvider: vi.fn(),
      getProvider: vi.fn(() => ({ id: 'claude-code', enabled: opts.enabled ?? true, settings })),
      updateProvider: vi.fn((_id: string, update: { settings?: Record<string, unknown> }) => {
        if (update.settings) settings = update.settings
      }),
      listModels: vi.fn(() => opts.storedRows ?? Array.from({ length: opts.existingModels ?? 0 }, (_, i) => ({ id: `m${i}` }))),
      upsertModels: vi.fn(),
      reconcileDiscoveredModels: vi.fn(() => ({ missing: [], restored: [] })),
      getModelMetadata: vi.fn(() => null),
    },
    reasoningRegistry: { invalidate: vi.fn(), get: vi.fn() },
    providerReload: reload,
  }
  return ctx as any
}

async function drain(gen: AsyncIterable<unknown>) { for await (const _ of gen) { /* consume */ } }

const RUNTIME_MODELS = {
  runtimeVersion: '2.1.280',
  models: [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku' },
  ],
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 2))
}

beforeEach(() => {
  h.resolve.mockReset()
  h.auth.mockReset()
  h.probe.mockReset()
  h.probe.mockResolvedValue(RUNTIME_MODELS)
  h.queryOptions = []
})

describe('claude-code manifest — loading on the resolved runtime', () => {
  it('registers a provider built with the resolved runtime when it is signed in', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true, authMethod: 'claude.ai' })
    const ctx = fakeCtx()
    await claudeCodeManifest.onStart!(ctx)

    const provider = ctx.model.getProvider('claude-code')
    expect(provider).toBeDefined()
    expect(h.resolve).toHaveBeenCalledWith({ refresh: true })
    expect(h.auth.mock.calls[0][0]).toMatchObject({ path: HOST.path })
    // Resolver warnings (skew, last resort) reach the log.
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ path: HOST.path }), HOST.warnings[0])

    await drain(provider.stream({ messages: [{ role: 'user', content: 'hi' }] }))
    expect(h.queryOptions[0].pathToClaudeCodeExecutable).toBe(HOST.path)
  })

  it('first load persists the known caps at once, then reconciles what the runtime reports — no model call', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx({ existingModels: 0 })
    await claudeCodeManifest.onStart!(ctx)

    expect(ctx.providerConfig.upsertModels).toHaveBeenCalledTimes(1)
    const [, models] = ctx.providerConfig.upsertModels.mock.calls[0]
    expect(models.map((m: any) => m.id).sort()).toEqual(['claude-code-fable', 'claude-code-haiku', 'claude-code-opus', 'claude-code-sonnet'])

    await until(() => ctx.reasoningRegistry.invalidate.mock.calls.length > 0)
    // The probe runs on the very runtime the provider was built with.
    expect(h.probe.mock.calls[0][0]).toMatchObject({ path: HOST.path, version: HOST.version })
    expect(ctx.providerConfig.reconcileDiscoveredModels).toHaveBeenCalledTimes(1)
    const [providerId, discovered] = ctx.providerConfig.reconcileDiscoveredModels.mock.calls[0]
    expect(providerId).toBe('claude-code')
    expect(discovered.map((m: any) => m.id)).toEqual(['claude-code-default', 'claude-code-haiku'])
    expect(discovered[0].metadata).toMatchObject({ alias: 'default', realModelId: 'claude-opus-5-5', reasoning: { source: 'sdk', param: 'effort', levels: ['low', 'medium', 'high', 'xhigh', 'max'] } })
    expect(ctx.reasoningRegistry.invalidate).toHaveBeenCalledWith('claude-code')
    // Discovery is no chat query: nothing was sent to a model.
    expect(h.queryOptions).toHaveLength(0)
  })

  it('a load with stored rows keeps them as they are and still rediscovers', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx({ existingModels: 4 })
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.providerConfig.upsertModels).not.toHaveBeenCalled()
    await until(() => ctx.providerConfig.reconcileDiscoveredModels.mock.calls.length > 0)
    expect(ctx.providerConfig.reconcileDiscoveredModels).toHaveBeenCalledTimes(1)
  })

  // CCB-3: an earlier seed stored the bare fable/opus/sonnet aliases with a
  // 1M window. Until a discovery confirms them, a load re-applies the seed's
  // window — also when discovery keeps failing.
  it('a load re-applies the seed window to undiscovered seed rows that drifted, even when discovery fails', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    h.probe.mockRejectedValue(new Error('Claude Code runtime did not report its models within 30000 ms'))
    const storedRows = [
      { modelId: 'claude-code-fable', contextWindow: 1_000_000, metadata: { alias: 'fable' } },
      { modelId: 'claude-code-opus', contextWindow: 1_000_000, metadata: null },
      { modelId: 'claude-code-sonnet', contextWindow: 1_000_000, metadata: { alias: 'sonnet', discoveredAt: '2026-09-23T10:00:00.000Z' } },
      { modelId: 'claude-code-haiku', contextWindow: 200_000, metadata: { alias: 'haiku' } },
      { modelId: 'claude-code-opus-1m', contextWindow: 1_000_000, metadata: { alias: 'opus[1m]', discoveredAt: '2026-09-23T10:00:00.000Z' } },
    ]
    const ctx = fakeCtx({ storedRows })
    await claudeCodeManifest.onStart!(ctx)

    expect(ctx.providerConfig.upsertModels).toHaveBeenCalledTimes(1)
    const [providerId, repaired] = ctx.providerConfig.upsertModels.mock.calls[0]
    expect(providerId).toBe('claude-code')
    // Only undiscovered seed rows whose window differs; the discovered sonnet
    // row, the runtime's 1M variant and haiku are left alone.
    expect(repaired.map((m: any) => m.id).sort()).toEqual(['claude-code-fable', 'claude-code-opus'])
    for (const m of repaired) expect(m.contextWindow).toBe(PROVIDER_WINDOW['claude-code'])
    await until(() => ctx.logger.warn.mock.calls.some((c: any[]) => /discovery unavailable/.test(String(c[1]))))
    expect(ctx.providerConfig.reconcileDiscoveredModels).not.toHaveBeenCalled()
  })

  it('stored seed rows already on the seed window are not rewritten (negative)', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const storedRows = ['fable', 'opus', 'sonnet', 'haiku'].map((alias) => ({ modelId: `claude-code-${alias}`, contextWindow: PROVIDER_WINDOW['claude-code'], metadata: { alias } }))
    const ctx = fakeCtx({ storedRows })
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.providerConfig.upsertModels).not.toHaveBeenCalled()
  })

  it('the first-boot seed claims no 1M window', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx({ existingModels: 0 })
    await claudeCodeManifest.onStart!(ctx)
    const [, models] = ctx.providerConfig.upsertModels.mock.calls[0]
    for (const m of models) expect(m.contextWindow).toBe(PROVIDER_WINDOW['claude-code'])
  })

  it('a failed discovery leaves every stored row as it was (negative)', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    h.probe.mockRejectedValue(new Error('Claude Code runtime did not report its models within 30000 ms'))
    const ctx = fakeCtx({ existingModels: 4 })
    await claudeCodeManifest.onStart!(ctx)
    await until(() => ctx.logger.warn.mock.calls.some((c: any[]) => /discovery unavailable/.test(String(c[1]))))
    expect(ctx.providerConfig.reconcileDiscoveredModels).not.toHaveBeenCalled()
    expect(ctx.reasoningRegistry.invalidate).not.toHaveBeenCalled()
    expect(ctx.model.getProvider('claude-code')).toBeDefined()
  })

  it('a signed-out runtime is skipped (PATH presence alone is not enough)', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: false })
    const ctx = fakeCtx()
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.model.getProvider('claude-code')).toBeUndefined()
    expect(ctx.providerConfig.upsertModels).not.toHaveBeenCalled()
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'signed-out' }), expect.stringMatching(/not signed in/))
    // Nothing is discovered through a runtime that is not signed in.
    expect(h.probe).not.toHaveBeenCalled()
  })

  it('an invalid override fails closed with an error log and no sign-in check', async () => {
    h.resolve.mockResolvedValue({ ok: false, id: 'claude-code', error: 'override-invalid', detail: 'EYAS_CLAUDE_CODE_BIN must be an absolute path: claude', remedy: 'Point EYAS_CLAUDE_CODE_BIN at …' })
    const ctx = fakeCtx()
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.model.getProvider('claude-code')).toBeUndefined()
    expect(h.auth).not.toHaveBeenCalled()
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.objectContaining({ error: 'override-invalid' }), expect.any(String))
  })

  it('a missing runtime is skipped with the remedy in the log', async () => {
    h.resolve.mockResolvedValue({ ok: false, id: 'claude-code', error: 'not-found', detail: 'no executable found', remedy: 'Install Claude Code' })
    const ctx = fakeCtx()
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.model.getProvider('claude-code')).toBeUndefined()
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ remedy: 'Install Claude Code' }), expect.any(String))
  })

  it('a disabled provider resolves nothing', async () => {
    const ctx = fakeCtx({ enabled: false })
    await claudeCodeManifest.onStart!(ctx)
    expect(h.resolve).not.toHaveBeenCalled()
    expect(ctx.model.getProvider('claude-code')).toBeUndefined()
  })

  // H8 — one specialist mechanism: an enabled EYAS agent roster never becomes
  // a Claude Code subagent roster; specialists run through run_specialist.
  it('hands the provider no agent roster, even when the agent module has enabled agents', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx()
    const list = vi.fn(() => [{ id: 'dev', name: 'Dev', goal: 'write code', systemPrompt: 'You write code', tools: ['read_file'], model: 'claude-code-haiku' }])
    ctx.agents = { registry: { list, get: vi.fn() } }
    ctx.securityGate = { validateToolCall: () => ({ decision: 'allow', reason: 'ok', riskTier: 'green' }) }
    await claudeCodeManifest.onStart!(ctx)

    await drain(ctx.model.getProvider('claude-code').stream({ messages: [{ role: 'user', content: 'hi' }], orchestration: 'deep', metadata: { conversationId: 'c-deep' } }))
    const o = h.queryOptions[0]
    expect(o).not.toHaveProperty('agents')
    expect(o.tools).not.toContain('Agent')
    expect(o.tools).not.toContain('Task')
    expect(list).not.toHaveBeenCalled()
  })

  it('a reload resolves the runtime again', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx()
    await claudeCodeManifest.onStart!(ctx)
    await ctx.providerReload.get('claude-code')!()
    expect(h.resolve).toHaveBeenCalledTimes(2)
    expect(h.resolve).toHaveBeenLastCalledWith({ refresh: true })
  })
})

// loadClaudeMd is retired: Claude Code always runs isolated. The stored key is
// stripped once, and a config that still carries it loads exactly like one
// that never had it.
describe('claude-code manifest — retired loadClaudeMd setting', () => {
  it('strips loadClaudeMd from the stored settings and keeps every other key', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx({ settings: { loadClaudeMd: true, maxTurns: 7 } })
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.providerConfig.updateProvider).toHaveBeenCalledTimes(1)
    expect(ctx.providerConfig.updateProvider).toHaveBeenCalledWith('claude-code', { settings: { maxTurns: 7 } })
    expect(ctx.logger.info).toHaveBeenCalledWith({ removed: ['loadClaudeMd'] }, expect.any(String))
  })

  it('leaves a config without the key untouched (idempotent)', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const ctx = fakeCtx({ settings: { maxTurns: 7 } })
    await claudeCodeManifest.onStart!(ctx)
    await claudeCodeManifest.onStart!(ctx)
    expect(ctx.providerConfig.updateProvider).not.toHaveBeenCalled()
  })

  it('a legacy loadClaudeMd=true config produces the same isolated query options', async () => {
    h.resolve.mockResolvedValue(HOST)
    h.auth.mockResolvedValue({ loggedIn: true })
    const legacy = fakeCtx({ settings: { loadClaudeMd: true } })
    // Simulate a store the cleanup could not write: the key stays, and is ignored.
    legacy.providerConfig.updateProvider.mockImplementation(() => { throw new Error('read-only store') })
    await claudeCodeManifest.onStart!(legacy)
    expect(legacy.logger.warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.stringContaining('read-only store') }), expect.any(String))
    await drain(legacy.model.getProvider('claude-code').stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c-legacy' } }))

    const plain = fakeCtx()
    await claudeCodeManifest.onStart!(plain)
    await drain(plain.model.getProvider('claude-code').stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { conversationId: 'c-legacy' } }))

    const [a, b] = h.queryOptions
    for (const o of [a, b]) {
      expect(o.settingSources).toEqual([])
      expect(o.persistSession).toBe(false)
      expect(o.strictMcpConfig).toBe(true)
      expect(o.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1')
      expect(o.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS).toBe('1')
    }
    // Hook callbacks are per-query closures: compare their shape (events,
    // matcher counts), not function identity.
    const hookShape = (hooks: any) => Object.fromEntries(Object.entries(hooks ?? {}).map(([event, ms]) => [event, (ms as any[]).map((m) => m.hooks.length)]))
    // Each query has its own temp root (CLAUDE_CODE_TMPDIR, also in the sandbox's
    // writable folders): compare where it is used, not its random name.
    const strip = (o: any) => {
      const { abortController: _a, hooks, ...rest } = o
      const shape = JSON.stringify({ ...rest, hooks: hookShape(hooks) })
      return JSON.parse(shape.split(String(o.env.CLAUDE_CODE_TMPDIR)).join('<query tmp>'))
    }
    expect(strip(a)).toEqual(strip(b))
  })
})
