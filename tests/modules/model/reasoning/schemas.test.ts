// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { z } from 'zod'
import {
  DiscoveredReasoningSchema,
  EffortIntentSchema,
  EffortSettingSchema,
  OverlayFileSchema,
  ReasoningCapabilitySchema,
} from '@modules/model/reasoning/schemas.js'
import { UNKNOWN_CAPABILITY, type ReasoningCapability } from '@modules/model/reasoning/capability.js'

const discovered = {
  source: 'sdk',
  param: 'effort',
  levels: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaultLevel: 'high',
  adaptiveThinking: true,
  runtime: '2.x',
  discoveredAt: '2026-09-22T10:00:00.000Z',
}

const capability: ReasoningCapability = {
  kind: 'effort',
  levels: ['none', 'low', 'medium', 'high'],
  defaultLevel: 'high',
  canDisable: true,
  thinking: 'default-off',
  thinkingParam: 'adaptive',
  samplingLocked: false,
  reasoningVisible: 'summary',
  displayParam: false,
  source: 'overlay',
}

describe('EffortSettingSchema / EffortIntentSchema', () => {
  it('accepts every rung and auto', () => {
    for (const v of ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      expect(EffortSettingSchema.safeParse(v).success).toBe(true)
    }
    expect(EffortIntentSchema.safeParse({ level: 'max', source: 'deep' }).success).toBe(true)
  })

  it('rejects anything else', () => {
    for (const v of ['ultra', 'MAX', ' high', null, 3]) expect(EffortSettingSchema.safeParse(v).success).toBe(false)
    expect(EffortIntentSchema.safeParse({ level: 'max', source: 'guess' }).success).toBe(false)
    expect(EffortIntentSchema.safeParse({ level: 'max', source: 'deep', extra: 1 }).success).toBe(false)
  })
})

describe('DiscoveredReasoningSchema', () => {
  it('accepts an F-style discovery sample', () => {
    expect(DiscoveredReasoningSchema.parse(discovered)).toEqual(discovered)
  })

  it('strips unknown keys so a row written by a newer EYAS still reads', () => {
    expect(DiscoveredReasoningSchema.parse({ ...discovered, futureField: 1 })).toEqual(discovered)
  })

  it('rejects an unknown level, a missing discoveredAt and an unknown param', () => {
    expect(DiscoveredReasoningSchema.safeParse({ ...discovered, levels: ['low', 'ultra'] }).success).toBe(false)
    const { discoveredAt: _drop, ...noDate } = discovered
    expect(DiscoveredReasoningSchema.safeParse(noDate).success).toBe(false)
    expect(DiscoveredReasoningSchema.safeParse({ ...discovered, param: 'dial' }).success).toBe(false)
    expect(DiscoveredReasoningSchema.safeParse({ ...discovered, discoveredAt: 'yesterday' }).success).toBe(false)
  })

  it('carries whether the runtime can be asked for a thinking display (a boolean, or absent)', () => {
    for (const thinkingDisplay of [true, false]) {
      expect(DiscoveredReasoningSchema.parse({ ...discovered, thinkingDisplay })).toEqual({ ...discovered, thinkingDisplay })
    }
    expect(DiscoveredReasoningSchema.parse(discovered)).not.toHaveProperty('thinkingDisplay')
    for (const bad of ['no', 1, null]) {
      expect(DiscoveredReasoningSchema.safeParse({ ...discovered, thinkingDisplay: bad }).success, String(bad)).toBe(false)
    }
  })
})

describe('ReasoningCapabilitySchema', () => {
  it('accepts a consistent record and the unknown record', () => {
    expect(ReasoningCapabilitySchema.safeParse(capability).success).toBe(true)
    expect(ReasoningCapabilitySchema.safeParse(UNKNOWN_CAPABILITY).success).toBe(true)
  })

  it('rejects a defaultLevel outside levels', () => {
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, defaultLevel: 'max' }).success).toBe(false)
  })

  it("rejects canDisable without 'none' (and 'none' without canDisable)", () => {
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, levels: ['low', 'high'], defaultLevel: 'high' }).success).toBe(false)
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, canDisable: false }).success).toBe(false)
  })

  it('rejects levels out of ladder order, an inverted budget and a clamp to an unsupported level', () => {
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, levels: ['none', 'high', 'low'] }).success).toBe(false)
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, thinkingParam: 'budget', budget: { min: 5000, max: 1024 } }).success).toBe(false)
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, thinkingParam: 'budget' }).success).toBe(false)
    expect(ReasoningCapabilitySchema.safeParse({ ...capability, clampMap: { xhigh: 'max' } }).success).toBe(false)
  })

  it('infers exactly the ReasoningCapability interface', () => {
    expectTypeOf<z.infer<typeof ReasoningCapabilitySchema>>().toEqualTypeOf<ReasoningCapability>()
  })
})

describe('OverlayFileSchema', () => {
  const { source: _derived, ...overlayCapability } = capability
  const ok = {
    id: 'row-a',
    match: { providers: ['anthropic'], model: '^claude-x$' },
    capability: overlayCapability,
    source: 'https://example.invalid/docs',
    verified: '2026-09-22',
    evidence: 'verified-docs',
  }

  it('accepts a well-formed file', () => {
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [ok] }).success).toBe(true)
  })

  it('rejects derived provenance inside a row capability', () => {
    const withSource = { ...ok, capability: { ...overlayCapability, source: 'overlay' } }
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [withSource] }).success).toBe(false)
  })

  it('rejects a duplicate row id, an invalid regex, a bad date and an unverified row', () => {
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [ok, ok] }).success).toBe(false)
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [{ ...ok, match: { model: '(' } }] }).success).toBe(false)
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-02-30', rows: [ok] }).success).toBe(false)
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [{ ...ok, evidence: 'uncertain' }] }).success).toBe(false)
  })

  it("accepts clampPolicy 'server' and rejects any other clamp policy (F7)", () => {
    expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [{ ...ok, clampPolicy: 'server' }] }).success).toBe(true)
    for (const clampPolicy of ['client', 'SERVER', true]) {
      expect(OverlayFileSchema.safeParse({ version: 1, updated: '2026-09-22', rows: [{ ...ok, clampPolicy }] }).success).toBe(false)
    }
  })
})
