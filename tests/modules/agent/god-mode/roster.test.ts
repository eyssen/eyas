// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { validateRoster } from '@modules/agent/god-mode/roster'

const a = { id: 'a', providerId: 'anthropic', modelId: 'claude' }
const b = { id: 'b', providerId: 'xai', modelId: 'grok' }
const c = { id: 'c', providerId: 'openai', modelId: 'gpt' }

function body(over: Record<string, unknown> = {}) {
  return {
    participants: [a, b, c],
    chairParticipantId: 'a',
    costCeilingUsd: null,
    workspaceRetentionHours: 72,
    ...over,
  }
}

describe('validateRoster', () => {
  it('accepts 3 unique models with optional chair', () => {
    const r = validateRoster(body(), { min: 2, max: 5 })
    expect(r.ok).toBe(true)
  })

  it('rejects fewer than min', () => {
    const r = validateRoster(body({ participants: [a] }), { min: 2, max: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least 2/i)
  })

  it('rejects even count without chair', () => {
    const r = validateRoster(body({ participants: [a, b], chairParticipantId: null }), { min: 2, max: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/chair/i)
  })

  it('accepts even count with chair in the roster', () => {
    const r = validateRoster(body({ participants: [a, b], chairParticipantId: 'b' }), { min: 2, max: 5 })
    expect(r.ok).toBe(true)
  })

  it('rejects chair not in roster', () => {
    const r = validateRoster(body({ chairParticipantId: 'z' }), { min: 2, max: 5 })
    expect(r.ok).toBe(false)
  })

  it('rejects duplicate provider/model pairs', () => {
    const r = validateRoster(body({ participants: [a, { ...a, id: 'a2' }, c] }), { min: 2, max: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/duplicate/i)
  })

  it('rejects a participant not in liveKeys', () => {
    const r = validateRoster(body(), {
      min: 2, max: 5,
      liveKeys: new Set(['anthropic/claude', 'xai/grok']),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/openai\/gpt/)
  })

  it('rejects more than max', () => {
    // 1 + 5 extras = 6 > max 5 (range is inclusive on both ends)
    const extras = [1, 2, 3, 4, 5].map((i) => ({ id: `x${i}`, providerId: `p${i}`, modelId: `m${i}` }))
    const r = validateRoster(body({ participants: [a, ...extras] }), { min: 2, max: 5 })
    expect(r.ok).toBe(false)
  })

  it('accepts empty participants when allowEmpty is true', () => {
    const r = validateRoster(body({ participants: [], chairParticipantId: null }), {
      min: 2, max: 5, allowEmpty: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.participants).toEqual([])
  })

  it('rejects empty participants when allowEmpty is omitted', () => {
    const r = validateRoster(body({ participants: [] }), { min: 2, max: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least 2/i)
  })
})
