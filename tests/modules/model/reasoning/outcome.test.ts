// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Effort outcome: the gateway owns requested/source; a provider can only
// confirm the effective level through readbackOutcome().

import { describe, it, expect } from 'vitest'
import { mergeEffortOutcome, readbackOutcome } from '@modules/model/reasoning/outcome.js'
import type { EffortOutcome } from '@modules/model/reasoning/resolve.js'
import { effortPlanFor } from '../../../helpers/effort-plan.js'

const gatewayOutcome: EffortOutcome = { requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'unsupported' }

describe('readbackOutcome', () => {
  it('marks the runtime-reported level as confirmed', () => {
    expect(readbackOutcome(effortPlanFor('high'), 'high')).toEqual({ requested: 'high', effective: 'high', source: 'model', clamped: false, confirmed: true })
  })

  it('flags a level that differs from the plan as a runtime readback', () => {
    expect(readbackOutcome(effortPlanFor('max'), 'high')).toMatchObject({ effective: 'high', clamped: true, reason: 'runtime-readback', confirmed: true })
  })

  it('an unreadable runtime value claims nothing', () => {
    expect(readbackOutcome(effortPlanFor('high'), 'ultra')).toBeUndefined()
    expect(readbackOutcome(effortPlanFor('high'), undefined)).toBeUndefined()
    expect(readbackOutcome(effortPlanFor('high'), 3)).toBeUndefined()
  })
})

describe('mergeEffortOutcome', () => {
  it('without a provider outcome the gateway\'s stands', () => {
    expect(mergeEffortOutcome(gatewayOutcome)).toBe(gatewayOutcome)
    expect(mergeEffortOutcome(gatewayOutcome, null)).toBe(gatewayOutcome)
  })

  it('an unconfirmed provider outcome is ignored entirely', () => {
    const forged: EffortOutcome = { requested: 'max', effective: 'max', source: 'request', clamped: false }
    expect(mergeEffortOutcome(gatewayOutcome, forged)).toBe(gatewayOutcome)
    expect(mergeEffortOutcome(gatewayOutcome, { ...forged, confirmed: false })).toBe(gatewayOutcome)
  })

  it('a confirmed readback overrides effective and keeps the gateway\'s requested and source', () => {
    const provider = readbackOutcome(effortPlanFor('high'), 'medium')!
    const merged = mergeEffortOutcome(gatewayOutcome, { ...provider, requested: 'low', source: 'request' })
    expect(merged).toEqual({ requested: 'xhigh', effective: 'medium', source: 'conversation', clamped: true, reason: 'runtime-readback', confirmed: true })
  })

  it('clamped is recomputed: a readback equal to the request is not clamped', () => {
    const requestedHigh: EffortOutcome = { requested: 'high', effective: 'high', source: 'agent', clamped: false }
    expect(mergeEffortOutcome(requestedHigh, readbackOutcome(effortPlanFor('high'), 'high')))
      .toEqual({ requested: 'high', effective: 'high', source: 'agent', clamped: false, confirmed: true })
  })

  it('a readback equal to the plan keeps the gateway\'s clamp reason', () => {
    expect(mergeEffortOutcome(gatewayOutcome, readbackOutcome(effortPlanFor('high'), 'high')))
      .toEqual({ requested: 'xhigh', effective: 'high', source: 'conversation', clamped: true, reason: 'unsupported', confirmed: true })
  })

  it('an Auto request is never reported as clamped, even when the runtime names its default', () => {
    const auto: EffortOutcome = { requested: 'auto', effective: 'auto', source: 'model', clamped: false }
    expect(mergeEffortOutcome(auto, readbackOutcome(effortPlanFor('auto'), 'high')))
      .toEqual({ requested: 'auto', effective: 'high', source: 'model', clamped: false, reason: 'runtime-readback', confirmed: true })
  })

  it('a confirmed outcome carrying an invalid level is ignored', () => {
    expect(mergeEffortOutcome(gatewayOutcome, { requested: 'high', effective: 'ultra' as never, source: 'model', clamped: false, confirmed: true }))
      .toBe(gatewayOutcome)
  })
})
