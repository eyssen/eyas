// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { applyAnthropicThinking, allowsTemperature } from '@modules/model/submodules/anthropic/adapter.js'
import { ANTHROPIC_MODELS } from '@modules/model/submodules/anthropic/provider.js'

describe('anthropic model list', () => {
  it('exposes the current model ids', () => {
    const ids = ANTHROPIC_MODELS.map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining([
      'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
      'claude-sonnet-4-6', 'claude-haiku-4-5',
    ]))
    expect(ids).not.toContain('claude-sonnet-4-5-20250514')
    expect(ids).not.toContain('claude-opus-4-20250514')
    expect(ids).not.toContain('claude-sonnet-4-20250514')
    expect(ids).not.toContain('claude-haiku-3-5-20241022')
  })
})

describe('anthropic thinking/sampling policy', () => {
  it('uses adaptive thinking for 4.6+ models when enabled', () => {
    const p: Record<string, any> = {}
    applyAnthropicThinking(p, 'claude-opus-4-8', { enabled: true, budgetTokens: 9000 })
    expect(p.thinking).toEqual({ type: 'adaptive' })
  })
  it('omits thinking entirely when not enabled (safe for Fable 5)', () => {
    const p: Record<string, any> = {}
    applyAnthropicThinking(p, 'claude-fable-5', { enabled: false })
    expect(p.thinking).toBeUndefined()
  })
  it('keeps budget_tokens for Haiku 4.5', () => {
    const p: Record<string, any> = {}
    applyAnthropicThinking(p, 'claude-haiku-4-5', { enabled: true, budgetTokens: 5000 })
    expect(p.thinking).toEqual({ type: 'enabled', budget_tokens: 5000 })
  })
  it('bumps max_tokens to fit budget_tokens for budget models', () => {
    const p: Record<string, any> = { max_tokens: 4096 }
    applyAnthropicThinking(p, 'claude-haiku-4-5', { enabled: true, budgetTokens: 10000 })
    expect(p.thinking).toEqual({ type: 'enabled', budget_tokens: 10000 })
    expect(p.max_tokens).toBe(14096)
  })
  it('does not bump max_tokens for adaptive models', () => {
    const p: Record<string, any> = { max_tokens: 4096 }
    applyAnthropicThinking(p, 'claude-opus-4-8', { enabled: true, budgetTokens: 10000 })
    expect(p.max_tokens).toBe(4096)
  })
  it('forbids temperature on 4.7/4.8/Fable, allows on 4.6/sonnet/haiku', () => {
    expect(allowsTemperature('claude-opus-4-8')).toBe(false)
    expect(allowsTemperature('claude-opus-4-7')).toBe(false)
    expect(allowsTemperature('claude-fable-5')).toBe(false)
    expect(allowsTemperature('claude-opus-4-6')).toBe(true)
    expect(allowsTemperature('claude-sonnet-4-6')).toBe(true)
    expect(allowsTemperature('claude-haiku-4-5')).toBe(true)
  })
})
