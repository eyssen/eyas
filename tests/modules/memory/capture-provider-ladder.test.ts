// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which model the extractor actually reaches on an instance that is not the
// developer's. Most EYAS installs are a VPS or a pod with no room for a local
// model, so the ladder may assume NOTHING about what is enabled: it works from
// the providers this instance actually registered, whatever they are. The
// CLI-only instance comes first below because it is the common case and the one
// that was broken — the extraction prompt reached a CLI agent, which answered in
// prose, and the batch was dropped every single turn.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryCapture } from '@modules/memory/capture/index'
import { resolveCaptureTarget, createCaptureComplete, attemptedProviderOf } from '@modules/memory/capture/completion'

/** `id` alone, or `id!` for a provider that can isolate a completion. */
function fakeGateway(ids: string[]) {
  const providers = ids.map((raw) => {
    const id = raw.replace(/!$/, '')
    return raw.endsWith('!') ? { id, supportsIsolatedCompletion: true } : { id }
  })
  return {
    getProvider: (id: string) => providers.find((p) => p.id === id),
    listProviders: () => providers,
    complete: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"notes":[]}' }] }),
  }
}

/** Provider config that knows one enabled model per provider. */
function fakeConfig(models: Record<string, string[]>, disabled: string[] = [], defaults: Record<string, string> = {}) {
  return {
    getProvider: (id: string) => ({ id, enabled: !disabled.includes(id), defaultModel: defaults[id] ?? null }),
    listEnabledModels: (id: string) => (models[id] ?? []).map((m) => ({ id: m })),
  }
}

// ── The primary scenario: a CLI-only instance ───────────────────────────────
//
// grok-cli as the gateway default, claude-code also enabled, every API provider
// disabled and therefore unregistered. This is the owner's live box.

describe('a CLI-only instance', () => {
  const CLI_ONLY = ['grok-cli', 'claude-code']

  it('attempts the extraction rather than skipping it', () => {
    // There is no completion-shaped provider anywhere on this box. Capture must
    // still run: an attempt leaves a memory_capture_runs row and is therefore
    // measurable, a skip leaves nothing and is invisible.
    expect(resolveCaptureTarget({ gateway: fakeGateway(CLI_ONLY) })).toEqual({ rung: 'gateway-fallback' })
  })

  it('falls through whatever the routing tier happens to name', () => {
    // Whether the tier names a provider this box does not have, or a CLI it
    // does, the answer is the same: no pin, and the gateway's own default
    // answers. The ladder never depends on the tier table being right.
    for (const tier of [
      { provider: 'anthropic', model: 'claude-haiku' },   // configured, not installed here
      { provider: 'grok-cli', model: 'grok-cli-default' }, // auto-filled by CLI onboarding
      null,
    ]) {
      expect(resolveCaptureTarget({ gateway: fakeGateway(CLI_ONLY), resolveTier: () => tier }))
        .toEqual({ rung: 'gateway-fallback' })
    }
  })

  it('sends the request with no pin at all, so the gateway picks its default', async () => {
    const gateway = fakeGateway(CLI_ONLY)
    const logger = { debug: vi.fn() }
    await createCaptureComplete({
      getGateway: () => gateway as any,
      getDecisionEngine: () => ({ resolveForTier: () => ({ provider: 'anthropic', model: 'claude-haiku' }) }),
      getProviderConfig: () => fakeConfig({}, ['anthropic', 'openai']) as any,
      logger,
    })({ system: 'S', user: 'U' })

    const req = gateway.complete.mock.calls[0][0]
    expect(req.provider).toBeUndefined()
    expect(req.model).toBeUndefined()
    expect(req.maxTokens).toBe(2_000)
    // Every extraction is isolated, whichever rung answered: a provider that
    // can honour the flag must, and one that cannot is unaffected by it.
    expect(req.isolated).toBe(true)
    // The rung is logged, so "which model answered this" is answerable from the
    // log alone next time an extraction comes back unusable.
    expect(JSON.stringify(logger.debug.mock.calls[0])).toContain('gateway-fallback')
  })

  it('records WHAT IT TRIED on the error row when the call fails', async () => {
    // The run-#5 shape, end to end: the row alone has to name the target, or
    // the next diagnosis needs another live test to find out.
    const db = createMemoryDb()
    createMemoryTables(db)
    const gateway = fakeGateway(['claude-code!'])
    gateway.complete.mockRejectedValueOnce(new Error('There\'s an issue with the selected model'))

    const capture = createMemoryCapture({
      db,
      config: () => ({ enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }),
      complete: createCaptureComplete({ getGateway: () => gateway as any }),
      writer: { write: vi.fn() } as any,
      logger: { warn: vi.fn(), debug: vi.fn() },
    })
    await capture({
      conversationId: 'cli-err',
      projectId: null,
      userMessage: 'Please always answer me in Hungarian, that is how I work.',
      assistantMessage: 'Rendben.',
    })

    const runs = db.all(sql`SELECT skipped_reason, provider FROM memory_capture_runs WHERE conversation_id = 'cli-err'`) as any[]
    expect(runs[0].skipped_reason).toBe('error')
    expect(runs[0].provider).toBe('claude-code/isolated-cli')
  })

  it('extracts a note end to end from a CLI\'s prose-wrapped answer', async () => {
    // The whole point, exercised together: the hardened prompt reaches the CLI,
    // the CLI narrates anyway (they all do), and the balanced-object scan finds
    // the batch inside the narration. Before F1.1 this turn wrote an
    // `unparsable` row and no note.
    const db = createMemoryDb()
    createMemoryTables(db)

    const batch = JSON.stringify({
      notes: [{ kind: 'user', title: 'Working language', summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.' }],
    })
    const gateway = fakeGateway(['grok-cli'])
    gateway.complete.mockResolvedValueOnce({
      provider: 'grok-cli',
      model: 'grok-code-fast-1',
      content: [{ type: 'text', text: `I read through the exchange and found one durable fact.\n\n${batch}\n\nLet me know if you'd like me to keep going.` }],
    })
    const writer = { write: vi.fn().mockResolvedValue({ action: 'created', path: 'semantic/working-language.md' }) }

    const capture = createMemoryCapture({
      db,
      config: () => ({ enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }),
      complete: createCaptureComplete({ getGateway: () => gateway as any }),
      writer: writer as any,
      logger: { warn: vi.fn(), debug: vi.fn() },
    })
    await capture({
      conversationId: 'cli-1',
      projectId: null,
      userMessage: 'Please always answer me in Hungarian, that is how I work.',
      assistantMessage: 'Rendben.',
    })

    // The CLI was told, in its own prompt, to answer with the object alone.
    const system: string = gateway.complete.mock.calls[0][0].system
    expect(system).toMatch(/nothing else/i)
    expect(system).toMatch(/do not call\s*\n?\s*tools/i)

    expect(writer.write).toHaveBeenCalledTimes(1)
    expect(writer.write.mock.calls[0][0]).toMatchObject({ kind: 'user', summary: 'Answers in Hungarian' })
    const runs = db.all(sql`SELECT notes_written, skipped_reason, provider FROM memory_capture_runs WHERE conversation_id = 'cli-1'`) as any[]
    expect(runs).toHaveLength(1)
    expect(runs[0].notes_written).toBe(1)
    expect(runs[0].skipped_reason).toBeNull()
    // F1.2: the row says WHICH model produced this outcome. Nothing was pinned,
    // so the label is what actually answered, from the response itself.
    expect(runs[0].provider).toBe('grok-cli/grok-code-fast-1')
  })
})

// ── The ladder's other rungs ────────────────────────────────────────────────

describe('the capture provider ladder', () => {
  it('uses the heartbeat tier when the tier resolves to a REGISTERED provider', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['anthropic', 'grok-cli']),
      resolveTier: () => ({ provider: 'anthropic', model: 'claude-haiku' }),
    })
    expect(target).toEqual({ rung: 'tier', provider: 'anthropic', model: 'claude-haiku' })
  })

  it('ignores a tier that names a provider nothing registered — the live failure', () => {
    // The tier table is configuration: it names whatever it was configured
    // with, installed here or not. Pinning a provider this instance does not
    // have either fails the call or silently lands on the gateway default.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['grok-cli', 'openai']),
      resolveTier: () => ({ provider: 'a-provider-this-box-does-not-have', model: 'some-model' }),
      providerConfig: fakeConfig({ openai: ['gpt-5-mini'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'openai', model: 'gpt-5-mini' })
  })

  it('ignores a tier that names a CLI, even a registered one', () => {
    // CLI onboarding auto-fills every empty routing tier with its own models,
    // so heartbeat→grok-cli is usually a machine default, not a decision. A
    // provider that answers prompts outranks it.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['grok-cli', 'anthropic']),
      resolveTier: () => ({ provider: 'grok-cli', model: 'grok-cli-default' }),
      providerConfig: fakeConfig({ anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic' })
  })

  it('passes over CLI providers for a completion-shaped one', () => {
    // A CLI provider's complete() runs a full agent turn and answers in prose.
    // It is the LAST resort, never a peer of an API provider.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code', 'grok-cli', 'kimi-cli', 'anthropic']),
      providerConfig: fakeConfig({ anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic' })
  })

  it('treats every non-CLI provider alike — registration order decides, nothing is privileged', () => {
    // No provider is special-cased: not a local runner, not a cloud API. A box
    // that has one is served by it; a box that has neither is served by rung (c).
    const models = { ollama: ['llama3'], openai: ['gpt-5-mini'] }
    expect(resolveCaptureTarget({ gateway: fakeGateway(['ollama', 'openai']), providerConfig: fakeConfig(models) }))
      .toMatchObject({ provider: 'ollama' })
    expect(resolveCaptureTarget({ gateway: fakeGateway(['openai', 'ollama']), providerConfig: fakeConfig(models) }))
      .toMatchObject({ provider: 'openai' })
  })

  it('names the provider row default model when no model row is enabled', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['openai']),
      providerConfig: fakeConfig({}, [], { openai: 'gpt-5-mini' }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'openai', model: 'gpt-5-mini' })
  })

  it('skips a provider still registered but switched off in config', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['openai', 'gemini']),
      providerConfig: fakeConfig({ openai: ['gpt-5-mini'], gemini: ['gemini-flash'] }, ['openai']),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'gemini', model: 'gemini-flash' })
  })

  it('passes over a candidate whose model cannot be named', () => {
    // A pin without a model is a request several providers reject outright, so
    // it is not a candidate at all — the next provider is.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['lmstudio', 'anthropic']),
      providerConfig: fakeConfig({ anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic', model: 'claude-haiku' })
  })

  it('prefers a CLI that can ISOLATE a completion over one that cannot — either way round', () => {
    // The preference is for the CAPABILITY, never for a provider id: a CLI that
    // loads its own memory into an extraction call answers from that memory
    // instead of from the exchange. Both orderings, so registration accident
    // cannot be what decides.
    const config = fakeConfig({ 'claude-code': ['claude-code-sonnet'] })
    expect(resolveCaptureTarget({ gateway: fakeGateway(['grok-cli', 'claude-code!']), providerConfig: config }))
      .toEqual({ rung: 'isolated-cli', provider: 'claude-code' })
    expect(resolveCaptureTarget({ gateway: fakeGateway(['claude-code!', 'grok-cli']), providerConfig: config }))
      .toMatchObject({ rung: 'isolated-cli', provider: 'claude-code' })

    // Symmetry: put the capability on the OTHER provider and the choice moves
    // with it. Nothing in the ladder knows what a 'claude-code' is.
    const flipped = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code', 'grok-cli!']),
      providerConfig: fakeConfig({ 'grok-cli': ['grok-cli-default'] }),
    })
    expect(flipped).toMatchObject({ rung: 'isolated-cli', provider: 'grok-cli' })
  })

  it('never names a MODEL for a CLI, however many model rows it has', () => {
    // Live test #5: the pin named the first enabled model row for claude-code —
    // claude-code-fable — whose CLI alias 'fable' the spawned CLI rejected
    // outright ("There's an issue with the selected model"). EYAS's model rows
    // are display candidates, not guaranteed-valid CLI aliases. The CLI's own
    // default is the only alias known to work, so a CLI is pinned by PROVIDER
    // and nothing else.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code!']),
      providerConfig: fakeConfig(
        { 'claude-code': ['claude-code-fable', 'claude-code-sonnet'] },
        [],
        { 'claude-code': 'claude-code-opus' },
      ),
    })
    expect(target).toEqual({ rung: 'isolated-cli', provider: 'claude-code' })
    expect(target.model).toBeUndefined()
  })

  it('does not reach for a CLI while a non-CLI provider can answer', () => {
    // Isolation makes a CLI usable, not preferable: an API provider needs no
    // isolating and runs no agent loop.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['claude-code!', 'anthropic']),
      providerConfig: fakeConfig({ 'claude-code': ['claude-code-sonnet'], anthropic: ['claude-haiku'] }),
    })
    expect(target).toMatchObject({ rung: 'non-cli', provider: 'anthropic' })
  })

  it('falls to the gateway when no CLI can isolate', () => {
    expect(resolveCaptureTarget({ gateway: fakeGateway(['grok-cli', 'kimi-cli']) })).toEqual({ rung: 'gateway-fallback' })
  })

  it('never half-pins a NON-CLI provider, capability or not', () => {
    // The half-pin is allowed at the isolation rung because a CLI resolves its
    // own default model. That reasoning does not transfer: an API provider
    // handed no model is the M7 failure mode wearing a capability flag.
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['some-isolating-api!']),   // capability, no nameable model
      providerConfig: fakeConfig({}),
    })
    expect(target).toEqual({ rung: 'gateway-fallback' })

    // …and with a model it is an ordinary rung-(b) candidate, not an isolation pick.
    expect(resolveCaptureTarget({
      gateway: fakeGateway(['some-isolating-api!']),
      providerConfig: fakeConfig({ 'some-isolating-api': ['m1'] }),
    })).toEqual({ rung: 'non-cli', provider: 'some-isolating-api', model: 'm1' })
  })

  it('falls through when NO candidate has a nameable model, rather than pinning a modelless one', () => {
    // M7: a half-pin (provider, no model) is worse than no pin — the gateway's
    // fallback at least picks a provider and lets it choose its own default
    // model, where the half-pin forces a model-less request onto a provider
    // that may require one.
    expect(resolveCaptureTarget({ gateway: fakeGateway(['anthropic']) })).toEqual({ rung: 'gateway-fallback' })
  })

  it('falls through when no provider is registered at all, and when no gateway exists', () => {
    expect(resolveCaptureTarget({ gateway: fakeGateway([]) })).toEqual({ rung: 'gateway-fallback' })
    expect(resolveCaptureTarget({ gateway: undefined })).toEqual({ rung: 'gateway-fallback' })
  })

  it('never throws when the decision engine or the provider config throws', () => {
    const target = resolveCaptureTarget({
      gateway: fakeGateway(['anthropic']),
      resolveTier: () => { throw new Error('routing table gone') },
      providerConfig: {
        getProvider: () => { throw new Error('db locked') },
        listEnabledModels: () => { throw new Error('db locked') },
      },
    })
    // Resolution is best-effort at every rung: a broken lookup costs the pin,
    // never the capture. With no config reachable, no model can be named, so
    // the ladder ends at the gateway's fallback rather than half-pinning.
    expect(target).toEqual({ rung: 'gateway-fallback' })
  })

  it('never throws when the gateway itself throws while listing', () => {
    const target = resolveCaptureTarget({
      gateway: {
        getProvider: () => { throw new Error('gateway broken') },
        listProviders: () => { throw new Error('gateway broken') },
      },
      resolveTier: () => ({ provider: 'anthropic', model: 'm' }),
    })
    expect(target).toEqual({ rung: 'gateway-fallback' })
  })
})

describe('the capture completion', () => {
  it('pins the ladder\'s choice, with capture\'s own limits', async () => {
    const gateway = fakeGateway(['anthropic'])
    const complete = createCaptureComplete({
      getGateway: () => gateway as any,
      getProviderConfig: () => fakeConfig({ anthropic: ['claude-haiku'] }) as any,
    })
    await complete({ system: 'S', user: 'U' })

    expect(gateway.complete).toHaveBeenCalledTimes(1)
    expect(gateway.complete.mock.calls[0][0]).toMatchObject({
      system: 'S',
      provider: 'anthropic',
      model: 'claude-haiku',
      maxTokens: 2_000,
      temperature: 0.2,
    })
  })

  it('sends a CLI request with a provider and NO model', async () => {
    // The end of the fable failure: whatever the model rows say, the request
    // that reaches a CLI names no model.
    const gateway = fakeGateway(['claude-code!'])
    await createCaptureComplete({
      getGateway: () => gateway as any,
      getProviderConfig: () => fakeConfig({ 'claude-code': ['claude-code-fable'] }) as any,
    })({ system: 'S', user: 'U' })

    const req = gateway.complete.mock.calls[0][0]
    expect(req.provider).toBe('claude-code')
    expect(req.model).toBeUndefined()
    expect(req.isolated).toBe(true)
  })

  it('attributes a FAILED call to the target it attempted', async () => {
    // Run #5 recorded 'error' with a NULL provider, so the row could not say
    // what had been attempted — the one thing needed to diagnose it.
    const gateway = fakeGateway(['claude-code!'])
    gateway.complete.mockRejectedValueOnce(new Error('There\'s an issue with the selected model'))
    const complete = createCaptureComplete({ getGateway: () => gateway as any })

    const err = await complete({ system: 'S', user: 'U' }).then(() => null, (e) => e)
    expect(err).toBeInstanceOf(Error)
    // The label rides on the error itself, so nothing is remembered between
    // calls: two conversations failing at once cannot swap attributions.
    expect(attemptedProviderOf(err)).toBe('claude-code/isolated-cli')
  })

  it('reports no attempted provider for an error from anywhere else', () => {
    expect(attemptedProviderOf(new Error('unrelated'))).toBeNull()
    expect(attemptedProviderOf(null)).toBeNull()
  })

  it('resolves the gateway per call, so a later module swap is honoured', async () => {
    // privacy and observability REPLACE ctx.model in their own onStart, which
    // may run after memory's. A captured gateway would be the pre-swap one.
    let gateway = fakeGateway(['anthropic'])
    const complete = createCaptureComplete({ getGateway: () => gateway as any })
    const swapped = fakeGateway(['anthropic'])
    gateway = swapped
    await complete({ system: 'S', user: 'U' })
    expect(swapped.complete).toHaveBeenCalledTimes(1)
  })

  it('throws when no gateway is wired — capture records the error row', async () => {
    const complete = createCaptureComplete({ getGateway: () => undefined })
    await expect(complete({ system: 'S', user: 'U' })).rejects.toThrow(/gateway/i)
  })

  it('joins the reply\'s text blocks, and names what answered', async () => {
    const gateway = fakeGateway(['anthropic'])
    gateway.complete.mockResolvedValueOnce({
      provider: 'anthropic',
      model: 'claude-haiku',
      content: [{ type: 'text', text: '{"notes":' }, { type: 'thinking' }, { type: 'text', text: '[]}' }],
    })
    const out = await createCaptureComplete({ getGateway: () => gateway as any })({ system: 'S', user: 'U' })
    expect(out).toEqual({ text: '{"notes":\n\n[]}', provider: 'anthropic/claude-haiku' })
  })

  it('names the rung when the response does not say which model answered', async () => {
    // A provider that returns no provider/model on its response still has to be
    // attributable, or the row is blank about a call that really happened.
    const gateway = fakeGateway(['grok-cli'])
    const out = await createCaptureComplete({ getGateway: () => gateway as any })({ system: 'S', user: 'U' })
    expect(out).toMatchObject({ provider: 'gateway-fallback' })
  })
})
