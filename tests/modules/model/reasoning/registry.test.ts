// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createReasoningRegistry, loadBundledOverlay, releaseStems } from '@modules/model/reasoning/registry.js'
import { ReasoningCapabilitySchema, type DiscoveredReasoning } from '@modules/model/reasoning/schemas.js'
import { UNKNOWN_CAPABILITY } from '@modules/model/reasoning/capability.js'
import { clampEffort } from '@modules/model/reasoning/clamp.js'
import { resolveEffortPlan } from '@modules/model/reasoning/resolve.js'

const overlay = loadBundledOverlay()

function logger() {
  return { info: vi.fn(), warn: vi.fn() }
}

function sdkDiscovery(levels: string[], extra: Partial<DiscoveredReasoning> = {}) {
  return { source: 'sdk', param: 'effort', levels, discoveredAt: '2026-09-22T12:00:00Z', runtime: '2.1.280', ...extra }
}

describe('reasoning registry', () => {
  it('logs the overlay version at construction', () => {
    const log = logger()
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => null, logger: log })
    expect(registry.overlayVersion).toBe(overlay.version)
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ overlayVersion: overlay.version }), expect.any(String))
  })

  it('discovered levels override the overlay levels while the overlay default and canDisable survive', () => {
    // The runtime only accepts up to high for this model; the overlay says it
    // can be disabled and defaults to high.
    const registry = createReasoningRegistry({
      overlay,
      getDiscovered: () => sdkDiscovery(['low', 'medium', 'high']),
    })
    const c = registry.get('anthropic', 'claude-opus-4-8')
    expect(c.source).toBe('merged')
    expect(c.levels).toEqual(['none', 'low', 'medium', 'high'])
    expect(c.canDisable).toBe(true)
    expect(c.defaultLevel).toBe('high')
    expect(c.runtime).toBe('2.1.280')
    expect(c.overlayRowId).toBe('anthropic-opus-4-7-4-8')
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
  })

  it('a discovered default wins when it is a supported level, and falls back to the overlay default when not', () => {
    const wins = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(['low', 'medium', 'high'], { defaultLevel: 'medium' }) })
    expect(wins.get('anthropic', 'claude-opus-4-8').defaultLevel).toBe('medium')
    const falls = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(['low', 'medium', 'high'], { defaultLevel: 'max' }) })
    expect(falls.get('anthropic', 'claude-opus-4-8').defaultLevel).toBe('high')
  })

  it('a runtime without adaptive thinking falls back to the budget parameter only when the overlay has a budget range', () => {
    const registry = createReasoningRegistry({
      overlay,
      getDiscovered: () => sdkDiscovery(['low', 'medium', 'high', 'max'], { adaptiveThinking: false }),
    })
    // Opus 4.6 has no overlay budget range → no guessed budget.
    expect(registry.get('anthropic', 'claude-opus-4-6').thinkingParam).toBe('none')
  })

  it('an empty discovered level list means no control', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery([]) })
    const c = registry.get('anthropic', 'claude-opus-4-8')
    expect(c.kind).toBe('none')
    expect(c.levels).toEqual([])
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
  })

  it('ignores an invalid discovered record with a warning and uses the overlay', () => {
    const log = logger()
    const registry = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'sdk', param: 'effort', levels: ['ultra'] }),
      logger: log,
    })
    const c = registry.get('anthropic', 'claude-opus-4-8')
    expect(c.source).toBe('overlay')
    expect(c.levels).toContain('xhigh')
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('survives a throwing lookup (degrades to the overlay with a warning)', () => {
    const log = logger()
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => { throw new Error('db gone') }, logger: log })
    expect(registry.get('anthropic', 'claude-opus-5-5').source).toBe('overlay')
    expect(log.warn).toHaveBeenCalled()
  })

  it('matches a Claude Code alias through its real model id', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => null })
    const c = registry.get('claude-code', 'claude-code-opus', 'claude-opus-4-8')
    expect(c.overlayRowId).toBe('anthropic-opus-4-7-4-8')
    // Without the real id the alias is not guessed.
    expect(registry.get('claude-code', 'claude-code-opus').kind).toBe('unknown')
  })

  it('memoizes, and invalidate() refreshes one provider or all', () => {
    let discovered: unknown = null
    const getDiscovered = vi.fn(() => discovered)
    const registry = createReasoningRegistry({ overlay, getDiscovered })
    expect(registry.get('anthropic', 'claude-opus-4-8').source).toBe('overlay')
    registry.get('anthropic', 'claude-opus-4-8')
    expect(getDiscovered).toHaveBeenCalledTimes(1)

    discovered = sdkDiscovery(['low', 'high'])
    registry.invalidate('openai')
    expect(registry.get('anthropic', 'claude-opus-4-8').source).toBe('overlay')
    registry.invalidate('anthropic')
    expect(registry.get('anthropic', 'claude-opus-4-8').source).toBe('merged')

    discovered = null
    registry.invalidate()
    expect(registry.get('anthropic', 'claude-opus-4-8').source).toBe('overlay')
  })

  it('an unknown model is UNKNOWN_CAPABILITY; pre-discovery (null) is the pure overlay', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => null })
    expect(registry.get('ollama', 'qwen3:8b')).toEqual(UNKNOWN_CAPABILITY)
    const c = registry.get('openai', 'gpt-5.4')
    expect(c.source).toBe('overlay')
    expect(c.defaultLevel).toBe('none')
  })

  it('a model only discovery knows gets the discovered levels with safe defaults for the rest', () => {
    const registry = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'catalog-api', param: 'effort', levels: ['high', 'low', 'medium'], defaultLevel: 'medium', discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    const c = registry.get('local-runtime', 'some-local-model')
    expect(c.source).toBe('discovered')
    expect(c.levels).toEqual(['low', 'medium', 'high'])
    expect(c.defaultLevel).toBe('medium')
    expect(c.samplingLocked).toBe(false)
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
  })

  it('a discovered budget model without an overlay range is not drivable (no guessed budget)', () => {
    const registry = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'catalog-api', param: 'budget', levels: ['low', 'high'], discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    const c = registry.get('local-runtime', 'budget-model')
    expect(c.kind).toBe('none')
    expect(c.levels).toEqual([])
  })

  it("a 'none' overlay row wins over discovered levels: the wire has no parameter to send (F9)", () => {
    const registry = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'catalog-api', param: 'effort', levels: ['low', 'medium', 'high'], defaultLevel: 'medium', discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    const c = registry.get('lmstudio', 'openai/gpt-oss-20b')
    expect(c.kind).toBe('none')
    expect(c.levels).toEqual([])
    expect(c.source).toBe('merged')
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
  })

  it('an Ollama gpt-oss on/off discovery keeps the overlay levels (server clamp); a no-thinking discovery wins (F9)', () => {
    const onOff = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'models-api', param: 'toggle', levels: ['none', 'high'], defaultLevel: 'high', discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    const c = onOff.get('ollama', 'gpt-oss:20b')
    expect(c.levels).toEqual(['low', 'medium', 'high'])
    expect(c.canDisable).toBe(false)
    const noThinking = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'models-api', param: 'none', levels: [], discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    expect(noThinking.get('ollama', 'gpt-oss:20b').kind).toBe('none')
  })

  it('a discovered toggle decides whether the off variant exists', () => {
    const plainAndThinking = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'acp', param: 'toggle', levels: ['none', 'high'], discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    expect(plainAndThinking.get('kimi-cli', 'kimi-cli-k2.6', 'kimi-k2.6').levels).toEqual(['none', 'high'])
    const thinkingOnly = createReasoningRegistry({
      overlay,
      getDiscovered: () => ({ source: 'acp', param: 'toggle', levels: ['high'], discoveredAt: '2026-09-22T12:00:00Z' }),
    })
    const c = thinkingOnly.get('kimi-cli', 'kimi-cli-k2.7-code', 'kimi-k2.7-code')
    expect(c.levels).toEqual(['high'])
    expect(c.canDisable).toBe(false)
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
  })

  // E3 — a lookup by the EYAS pair alone (write-time validation, the
  // gateway) matches the concrete model a discovery named.
  it('looks the concrete model up itself when the caller passes none', () => {
    const getRealModelId = vi.fn((_p: string, m: string) => (m === 'claude-code-opus' ? 'claude-opus-4-6' : null))
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => null, getRealModelId })
    const c = registry.get('claude-code', 'claude-code-opus')
    expect(c.overlayRowId).toBe('anthropic-opus-sonnet-4-6')
    expect(c.levels).not.toContain('xhigh')
    expect(getRealModelId).toHaveBeenCalledWith('claude-code', 'claude-code-opus')
  })

  it('an explicit realModelId wins over the lookup, and a failing lookup falls back to the EYAS id (negative)', () => {
    const log = logger()
    const explicit = createReasoningRegistry({ overlay, getDiscovered: () => null, getRealModelId: () => 'claude-opus-4-6' })
    expect(explicit.get('claude-code', 'claude-code-opus', 'claude-opus-4-8').overlayRowId).toBe('anthropic-opus-4-7-4-8')
    const failing = createReasoningRegistry({
      overlay,
      getDiscovered: () => null,
      getRealModelId: () => { throw new Error('db gone') },
      logger: log,
    })
    expect(failing.get('claude-code', 'claude-code-opus').kind).toBe('unknown')
    expect(failing.get('anthropic', 'claude-opus-4-8').overlayRowId).toBe('anthropic-opus-4-7-4-8')
    expect(log.warn).toHaveBeenCalled()
  })
})

// R1B-03 — a fetched id inherits its family row by the one prefix rule:
// family id + release stamps (date snapshot, -latest, [1m]). Nothing else.
describe('reasoning registry — family inheritance by release stamps', () => {
  const registry = createReasoningRegistry({ overlay, getDiscovered: () => null })

  it('releaseStems strips trailing release stamps only, longest stem first', () => {
    expect(releaseStems('gpt-5.4-mini-2026-03-17')).toEqual(['gpt-5.4-mini'])
    expect(releaseStems('claude-opus-4-8-20260801[1m]')).toEqual(['claude-opus-4-8-20260801', 'claude-opus-4-8'])
    expect(releaseStems('grok-3-mini-fast-latest')).toEqual(['grok-3-mini-fast'])
    expect(releaseStems('kimi-k3-0115')).toEqual(['kimi-k3'])
    expect(releaseStems('kimi-k3-2026-01-15-LATEST')).toEqual(['kimi-k3-2026-01-15', 'kimi-k3'])
  })

  it('never strips a variant segment, a date that is not one, or the whole id (negative)', () => {
    for (const id of [
      'gpt-5.4-pro', 'gpt-5-codex', 'o1-preview', 'gpt-5.2-chat', 'grok-3-mini-beta', 'grok-3-mini-fast',
      'gemini-3-flash-preview', 'kimi-k2-thinking', 'o3-2025-13-40', 'model-1399', 'qwen3-2507', 'latest', '[1m]', '',
    ]) {
      expect(releaseStems(id), id).toEqual([])
    }
  })

  it('a fetched snapshot or alias no row names inherits its family row', () => {
    const kimi = registry.get('kimi', 'kimi-k3-0115')
    expect(kimi.overlayRowId).toBe('kimi-k3')
    expect(kimi.levels).toEqual(['low', 'high', 'max'])
    expect(registry.get('xai', 'grok-3-mini-fast-latest').overlayRowId).toBe('xai-grok-3-mini')
    expect(registry.get('grok-cli', 'grok-cli-grok-4.7-latest').overlayRowId).toBe('grok-cli-grok-4-7-4-6')
    // Through the concrete model id behind an alias too.
    expect(registry.get('grok-cli', 'grok-cli-default', 'grok-4.5-latest').overlayRowId).toBe('grok-cli-grok-4-5')
    // A provider without any row inherits nothing.
    expect(registry.get('kimi-cli', 'kimi-cli-k3', 'kimi-k3-latest').kind).toBe('unknown')
    expect(ReasoningCapabilitySchema.safeParse(kimi).success).toBe(true)
  })

  it('the exact row wins over a shorter family: a named variant never falls back to its base model', () => {
    expect(registry.get('openai', 'gpt-5.4-mini-2026-03-17').overlayRowId).toBe('openai-gpt-5-4-mini-nano')
    expect(registry.get('openai', 'gpt-5.2-2025-12-11').overlayRowId).toBe('openai-gpt-5-2')
  })

  it('an unknown family stays Auto-only, release stamp or not (negative)', () => {
    for (const [provider, id] of [
      ['openai', 'gpt-5.7'], ['openai', 'gpt-5.7-2027-01-01'], ['openai', 'o5-mini-2027-01-01'], ['openai', 'gpt-5.4-pro-2026-03-05'],
      ['openai', 'o1-preview'], ['openai', 'codex-mini-latest'], ['xai', 'grok-5-latest'], ['kimi', 'kimi-k4-0101'],
    ] as const) {
      const c = registry.get(provider, id)
      expect(c.kind, id).toBe('unknown')
      expect(c.levels, id).toEqual([])
      expect(clampEffort('high', c).effective, id).toBe('auto')
    }
  })

  it('inheritance never crosses providers (negative)', () => {
    expect(registry.get('openrouter', 'gpt-5.2-2025-12-11').kind).toBe('unknown')
    expect(registry.get('vercel-ai-gateway', 'openai/gpt-5.4-2026-03-05').kind).toBe('unknown')
    expect(registry.get('xai', 'kimi-k3-0115').kind).toBe('unknown')
  })
})

// R1B-16 — a runtime that cannot be asked for the thinking display.
describe('reasoning registry — runtime thinking display', () => {
  const ALL = ['low', 'medium', 'high', 'xhigh', 'max']

  it('thinkingDisplay false hides the reasoning of a model that needs the display parameter; its effort control is unchanged', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(ALL, { thinkingDisplay: false, runtime: '2.1.279' }) })
    const c = registry.get('claude-code', 'claude-code-opus', 'claude-opus-4-8')
    expect(c.displayParam).toBe(false)
    expect(c.reasoningVisible).toBe('hidden')
    expect(c.levels).toEqual(['none', ...ALL])
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
    // So no display is planned, on Auto or on an explicit level.
    expect(resolveEffortPlan({ capability: c, streaming: true }).plan.display).toBeUndefined()
    expect(resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: c, streaming: true }).plan.display).toBeUndefined()
  })

  it('a runtime that can (true) or was not asked (absent) keeps the overlay; a model that shows its thinking anyway is unchanged (negative)', () => {
    for (const extra of [{ thinkingDisplay: true }, {}]) {
      const registry = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(ALL, extra) })
      const c = registry.get('claude-code', 'claude-code-opus', 'claude-opus-4-8')
      expect(c.displayParam).toBe(true)
      expect(c.reasoningVisible).toBe('summary')
      expect(resolveEffortPlan({ intent: { level: 'high', source: 'request' }, capability: c, streaming: true }).plan.display).toBe('summarized')
    }
    // Opus 4.6 streams its thinking without the parameter.
    const old = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(['low', 'medium', 'high', 'max'], { thinkingDisplay: false }) })
    expect(old.get('claude-code', 'claude-code-opus', 'claude-opus-4-6').reasoningVisible).toBe('summary')
  })

  it('a non-boolean thinkingDisplay makes the discovered record invalid: the overlay stands, with a warning (negative)', () => {
    const log = logger()
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(ALL, { thinkingDisplay: 'no' as never }), logger: log })
    const c = registry.get('claude-code', 'claude-code-opus', 'claude-opus-4-8')
    expect(c.source).toBe('overlay')
    expect(c.reasoningVisible).toBe('summary')
    expect(log.warn).toHaveBeenCalledTimes(1)
  })
})

// F7 — an endpoint that clamps server-side (OpenRouter) discovers only a
// generic ladder; the upstream family's row (clampPolicy 'server') wins.
describe('reasoning registry — clampPolicy server rows', () => {
  const catalog = (levels: string[], param: DiscoveredReasoning['param'] = 'effort') =>
    ({ source: 'catalog-api', param, levels, discoveredAt: '2026-09-23T12:00:00Z' })
  const generic = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

  it('keeps the row\'s upstream ladder over the discovered generic one (positive)', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => catalog(generic) })
    const c = registry.get('openrouter', 'openai/gpt-5.5')
    expect(c.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
    expect(c.defaultLevel).toBe('medium')
    expect(c.source).toBe('merged')
    expect(c.overlayRowId).toBe('openrouter-openai-gpt-5-5')
    expect(ReasoningCapabilitySchema.safeParse(c).success).toBe(true)
  })

  it('discovery that reports no reasoning control still wins over a server row (negative)', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => catalog([], 'none') })
    const c = registry.get('openrouter', 'anthropic/claude-opus-4.6')
    expect(c.kind).toBe('none')
    expect(c.levels).toEqual([])
  })

  it('a row without clampPolicy keeps discovery as the truth for the levels (negative)', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => sdkDiscovery(['low', 'medium']) })
    expect(registry.get('claude-code', 'claude-code-opus', 'claude-opus-4-6').levels).toEqual(['none', 'low', 'medium'])
  })

  it('server rows need the upstream vendor prefix, so a bare id on OpenRouter stays unknown', () => {
    const registry = createReasoningRegistry({ overlay, getDiscovered: () => null })
    expect(registry.get('openrouter', 'gpt-5.5').kind).toBe('unknown')
    expect(registry.get('openrouter', 'anthropic/claude-sonnet-4.6:thinking').overlayRowId).toBe('openrouter-claude-4-6')
  })
})
