// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E3 — the one write-time effort rule every write route shares.

import { describe, it, expect } from 'vitest'
import { EFFORT_UNSUPPORTED, effortUnsupportedBody, unsupportedEffort } from '@modules/model/reasoning/validate.js'
import { createReasoningRegistry } from '@modules/model/reasoning/registry.js'
import { UNKNOWN_CAPABILITY } from '@modules/model/reasoning/capability.js'
import { EFFORT_LADDER } from '@modules/model/reasoning/ladder.js'

const registry = createReasoningRegistry({ getDiscovered: () => null })

describe('unsupportedEffort', () => {
  it('a supported rung fits (positive)', () => {
    expect(unsupportedEffort('xhigh', registry.get('anthropic', 'claude-opus-4-8'))).toBeNull()
    expect(unsupportedEffort('none', registry.get('anthropic', 'claude-opus-4-8'))).toBeNull()
  })

  it('an unsupported rung is rejected with the model levels (negative)', () => {
    expect(unsupportedEffort('xhigh', registry.get('anthropic', 'claude-opus-4-6')))
      .toEqual({ level: 'xhigh', levels: ['none', 'low', 'medium', 'high', 'max'] })
    // Opus 5.5 cannot switch reasoning off.
    expect(unsupportedEffort('none', registry.get('anthropic', 'claude-opus-5-5'))?.levels).not.toContain('none')
  })

  it('Auto (null) always fits, even on a model with no reasoning control', () => {
    expect(unsupportedEffort(null, registry.get('anthropic', 'claude-opus-4-6'))).toBeNull()
    expect(unsupportedEffort(null, { kind: 'none', levels: [] })).toBeNull()
  })

  it('an unknown model, or no capability at all, accepts every rung', () => {
    for (const level of EFFORT_LADDER) {
      expect(unsupportedEffort(level, UNKNOWN_CAPABILITY)).toBeNull()
      expect(unsupportedEffort(level, undefined)).toBeNull()
      expect(unsupportedEffort(level, null)).toBeNull()
    }
  })

  it('a model with no reasoning control accepts only Auto (negative)', () => {
    expect(unsupportedEffort('high', { kind: 'none', levels: [] })).toEqual({ level: 'high', levels: [] })
  })

  it('a thinking toggle accepts only its own rungs (negative)', () => {
    const toggle = { kind: 'toggle' as const, levels: ['none', 'high'] as ('none' | 'high')[] }
    expect(unsupportedEffort('high', toggle)).toBeNull()
    expect(unsupportedEffort('medium', toggle)).toEqual({ level: 'medium', levels: ['none', 'high'] })
  })
})

describe('effortUnsupportedBody', () => {
  it('carries the code, the rung, the levels and the model', () => {
    const body = effortUnsupportedBody({ level: 'xhigh', levels: ['low', 'high'] }, { providerId: 'anthropic', modelId: 'claude-opus-4-6' })
    expect(body).toMatchObject({ code: EFFORT_UNSUPPORTED, level: 'xhigh', levels: ['low', 'high'], providerId: 'anthropic', modelId: 'claude-opus-4-6' })
    expect(body.error).toBe(body.message)
    expect(body.error).toContain('claude-opus-4-6')
  })

  it('explains a model with no control and omits an absent provider', () => {
    const body = effortUnsupportedBody({ level: 'high', levels: [] }, { modelId: 'kimi-k2.7-code' })
    expect(body).not.toHaveProperty('providerId')
    expect(body.error).toContain('only Auto')
  })
})
