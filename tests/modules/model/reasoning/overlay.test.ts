// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The static overlay is data the effort UI and the provider mappers trust, so
// every row must be verified and the headline facts per family are pinned.

import { describe, it, expect } from 'vitest'
import rawOverlay from '@modules/model/reasoning/overlay.json'
import { OverlayFileSchema, ReasoningCapabilitySchema } from '@modules/model/reasoning/schemas.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'

const overlay = loadBundledOverlay()
const registry = createReasoningRegistry({ overlay, getDiscovered: () => null })
const cap = (provider: string, model: string, real?: string) => registry.get(provider, model, real)

describe('overlay.json', () => {
  it('parses with OverlayFileSchema and is versioned', () => {
    expect(OverlayFileSchema.safeParse(rawOverlay).success).toBe(true)
    expect(overlay.version).toBeGreaterThanOrEqual(1)
    expect(overlay.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('has a source, an ISO verified date and verified evidence on every row', () => {
    for (const row of overlay.rows) {
      expect(row.source.length, row.id).toBeGreaterThan(0)
      expect(row.verified, row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(['verified-docs', 'verified-sdk'], row.id).toContain(row.evidence)
    }
  })

  it('yields a schema-valid effective capability for every row', () => {
    for (const row of overlay.rows) {
      const result = ReasoningCapabilitySchema.safeParse({ ...row.capability, source: 'overlay', overlayRowId: row.id, verified: row.verified })
      expect(result.success, row.id).toBe(true)
    }
    expect(ReasoningCapabilitySchema.safeParse(cap('anthropic', 'claude-opus-4-8')).success).toBe(true)
  })

  it('never lists a row with no provider restriction (every row names its providers)', () => {
    for (const row of overlay.rows) expect(row.match.providers?.length, row.id).toBeGreaterThan(0)
  })
})

describe('overlay facts per family', () => {
  it('Claude Opus 5.5: default medium, thinking cannot be disabled', () => {
    const c = cap('anthropic', 'claude-opus-5-5')
    expect(c.defaultLevel).toBe('medium')
    expect(c.levels).not.toContain('none')
    expect(c.canDisable).toBe(false)
    expect(c.levels).toContain('xhigh')
  })

  it('Claude Opus 4.6: no xhigh', () => {
    const c = cap('anthropic', 'claude-opus-4-6')
    expect(c.levels).not.toContain('xhigh')
    expect(c.levels).toContain('max')
    expect(c.canDisable).toBe(true)
  })

  it('a dated id matches its family row; Opus 5 does not swallow Opus 5.5', () => {
    expect(cap('anthropic', 'claude-opus-4-8-20260801').overlayRowId).toBe('anthropic-opus-4-7-4-8')
    expect(cap('anthropic', 'claude-opus-5').overlayRowId).toBe('anthropic-opus-5')
    expect(cap('anthropic', 'claude-opus-5-5').overlayRowId).toBe('anthropic-opus-5-5')
    expect(cap('anthropic', 'claude-sonnet-4-5-20250929').kind).toBe('budget')
  })

  it('GPT-5.5: none through xhigh, no max; GPT-5: no none', () => {
    const c = cap('openai', 'gpt-5.5')
    expect(c.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
    expect(c.levels).not.toContain('max')
    expect(cap('openai', 'gpt-5').levels).not.toContain('none')
    expect(cap('openai', 'gpt-5-pro').levels).toEqual(['high'])
  })

  it('Gemini 3.1 Pro: no minimal, no none', () => {
    const c = cap('gemini', 'gemini-3.1-pro-preview')
    expect(c.levels).not.toContain('minimal')
    expect(c.levels).not.toContain('none')
    expect(c.defaultLevel).toBe('high')
  })

  it('Grok 4.5: no xhigh, on the CLI and on the xAI API', () => {
    expect(cap('grok-cli', 'grok-cli-grok-4.5', 'grok-4.5').levels).not.toContain('xhigh')
    expect(cap('xai', 'grok-4.5').levels).not.toContain('xhigh')
    expect(cap('grok-cli', 'grok-cli-grok-4.7', 'grok-4.7').levels).toContain('xhigh')
  })

  it('Kimi K3: low | high | max, default max; kimi-cli has no overlay row (F11: only discovery knows its thinking)', () => {
    const c = cap('kimi', 'kimi-k3')
    expect(c.levels).toEqual(['low', 'high', 'max'])
    expect(c.defaultLevel).toBe('max')
    // Without a discovered models state EYAS sends no thinking choice to Kimi.
    expect(cap('kimi-cli', 'kimi-cli-k3', 'kimi-k3').kind).toBe('unknown')
    expect(overlay.rows.some((r) => r.match.providers?.includes('kimi-cli'))).toBe(false)
  })

  it('OpenAI o-series: low | medium | high, default medium, sampling locked', () => {
    for (const id of ['o3-mini', 'o3', 'o4-mini', 'o1', 'o3-mini-2025-01-31']) {
      const c = cap('openai', id)
      expect(c.overlayRowId, id).toBe('openai-o-series')
      expect(c.levels).toEqual(['low', 'medium', 'high'])
      expect(c.defaultLevel).toBe('medium')
      expect(c.samplingLocked).toBe(true)
    }
    // o1-mini / o1-preview take no reasoning_effort: not matched.
    expect(cap('openai', 'o1-mini').kind).toBe('unknown')
  })

  // R1B-03 — the SDK's Chat Completions reasoning models that had no row.
  it('GPT-5.2 and GPT-5.4 mini/nano: none (default) through xhigh, dated snapshots included', () => {
    for (const id of ['gpt-5.2', 'gpt-5.2-2025-12-11']) {
      const c = cap('openai', id)
      expect(c.overlayRowId, id).toBe('openai-gpt-5-2')
      expect(c.levels).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
      expect(c.defaultLevel).toBe('none')
      expect(c.canDisable).toBe(true)
    }
    for (const id of ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-mini-2026-03-17', 'gpt-5.4-nano-2026-03-17']) {
      const c = cap('openai', id)
      expect(c.overlayRowId, id).toBe('openai-gpt-5-4-mini-nano')
      expect(c.levels, id).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
      expect(c.defaultLevel, id).toBe('none')
    }
    // gpt-5.4 itself keeps its own row; mini/nano never fall back to it.
    expect(cap('openai', 'gpt-5.4').overlayRowId).toBe('openai-gpt-5-4')
  })

  it('Responses-only OpenAI models, chat variants and undocumented ids stay unknown on the openai provider (negative)', () => {
    // EYAS's openai provider speaks Chat Completions: the model pages mark the
    // pro, codex and deep-research models "Chat Completions: Not supported",
    // gpt-5.x-chat-latest is not a reasoning model, and gpt-5.1-mini has no
    // documented ladder. None of them gets a guessed control.
    for (const id of [
      'gpt-5.2-pro', 'gpt-5.2-pro-2025-12-11', 'gpt-5.4-pro', 'gpt-5.5-pro', 'gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-max',
      'gpt-5.2-codex', 'gpt-5.3-codex', 'codex-mini-latest', 'o1-pro', 'o3-pro-2025-06-10', 'o3-deep-research', 'o4-mini-deep-research',
      'gpt-5.1-mini', 'gpt-5-chat-latest', 'gpt-5.2-chat-latest', 'gpt-5.3-chat-latest',
    ]) {
      const c = cap('openai', id)
      expect(c.kind, id).toBe('unknown')
      expect(c.levels, id).toEqual([])
    }
  })

  it('OpenRouter serves the Responses-only GPT-5.x reasoning models with their own ladders', () => {
    expect(cap('openrouter', 'openai/gpt-5.2')).toMatchObject({ overlayRowId: 'openrouter-openai-gpt-5-2', levels: ['none', 'low', 'medium', 'high', 'xhigh'], defaultLevel: 'none' })
    expect(cap('openrouter', 'openai/gpt-5.2-pro')).toMatchObject({ levels: ['medium', 'high', 'xhigh'], defaultLevel: null, canDisable: false })
    expect(cap('openrouter', 'openai/gpt-5.4-pro:batch')).toMatchObject({ overlayRowId: 'openrouter-openai-gpt-5-4-pro', defaultLevel: 'medium' })
    expect(cap('openrouter', 'openai/gpt-5.5-pro')).toMatchObject({ levels: ['medium', 'high', 'xhigh'], defaultLevel: 'high' })
    expect(cap('openrouter', 'openai/gpt-5.4-nano').overlayRowId).toBe('openrouter-openai-gpt-5-4-mini-nano')
    for (const id of ['openai/gpt-5.2-codex', 'openai/gpt-5.3-codex']) {
      expect(cap('openrouter', id)).toMatchObject({ levels: ['low', 'medium', 'high', 'xhigh'], defaultLevel: null })
    }
    // Codex and o-pro models without a documented ladder get no row.
    for (const id of ['openai/gpt-5.1-codex', 'openai/gpt-5.1-codex-max', 'openai/o3-pro', 'openai/o1-pro']) {
      expect(cap('openrouter', id).kind, id).toBe('unknown')
    }
  })

  // R1B-02 — grok-3-mini is in the xAI seed catalog.
  it('xAI grok-3-mini (and -fast): reasoning_effort low | high, always reasoning, thinking shown', () => {
    for (const id of ['grok-3-mini', 'grok-3-mini-fast', 'grok-3-mini-latest', 'grok-3-mini-fast-latest']) {
      const c = cap('xai', id)
      expect(c.overlayRowId, id).toBe('xai-grok-3-mini')
      expect(c.kind, id).toBe('effort')
      expect(c.levels, id).toEqual(['low', 'high'])
      expect(c.canDisable, id).toBe(false)
      expect(c.reasoningVisible, id).toBe('summary')
    }
    // grok-3 is not a reasoning model; an unverified suffix is not inherited; no other provider.
    expect(cap('xai', 'grok-3').kind).toBe('unknown')
    expect(cap('xai', 'grok-3-mini-beta').kind).toBe('unknown')
    expect(cap('openrouter', 'grok-3-mini').kind).toBe('unknown')
  })

  it('xAI over Chat Completions: always reasoning, no effort control EYAS can send', () => {
    for (const id of ['grok-4.7', 'grok-4.5']) {
      const c = cap('xai', id)
      expect(c.kind).toBe('none')
      expect(c.levels).toEqual([])
      expect(c.thinking).toBe('always-on')
    }
  })

  it('every OpenRouter row is an upstream-family narrowing that OpenRouter clamps server-side', () => {
    const openrouterRows = overlay.rows.filter((row) => row.match.providers?.includes('openrouter'))
    expect(openrouterRows.length).toBeGreaterThan(0)
    for (const row of openrouterRows) {
      expect(row.clampPolicy, row.id).toBe('server')
      expect(row.match.providers, row.id).toEqual(['openrouter'])
    }
    // The only other server-clamped row: Ollama's gpt-oss, whose on/off
    // discovery (a server without thinking values) is generic.
    expect(overlay.rows.filter((row) => row.clampPolicy === 'server').every((row) =>
      row.match.providers?.includes('openrouter') || row.id === 'ollama-gpt-oss')).toBe(true)
  })

  it('an unknown id, or a known id on a provider the row does not list, is unknown', () => {
    expect(cap('anthropic', 'claude-3-7-sonnet').kind).toBe('unknown')
    expect(cap('ollama', 'llama3.3').source).toBe('unknown')
    // OpenAI rows do not apply to the same id served by another provider.
    expect(cap('openrouter', 'gpt-5.5').kind).toBe('unknown')
  })

  it('Ollama gpt-oss: named levels low | medium | high only, default medium, cannot be switched off', () => {
    for (const id of ['gpt-oss', 'gpt-oss:20b', 'gpt-oss:120b-cloud', 'library/gpt-oss:latest']) {
      const c = cap('ollama', id)
      expect(c.kind, id).toBe('effort')
      expect(c.levels, id).toEqual(['low', 'medium', 'high'])
      expect(c.defaultLevel, id).toBe('medium')
      expect(c.canDisable, id).toBe(false)
    }
    // Not a gpt-oss tag, and not on another provider.
    expect(cap('ollama', 'gpt-oss-safeguard:20b').kind).toBe('unknown')
    expect(cap('lmstudio', 'gpt-oss:20b').kind).toBe('none')
  })

  it('Ollama: no id-based row for other thinking models (only /api/show proves the capability)', () => {
    for (const id of ['qwen3:8b', 'qwen3:30b-a3b-instruct-2507', 'deepseek-r1:8b']) {
      expect(cap('ollama', id).kind, id).toBe('unknown')
    }
  })

  it('LM Studio: no reasoning control EYAS can send, for every model', () => {
    for (const id of ['openai/gpt-oss-20b', 'qwen/qwen3-8b', 'default']) {
      const c = cap('lmstudio', id)
      expect(c.kind, id).toBe('none')
      expect(c.levels, id).toEqual([])
    }
  })
})
