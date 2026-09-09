// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioSampler,
} from '@modules/observability/otel/sampler'
import type { Sampler, SpanContext, TraceId } from '@modules/observability/otel/types'

const noAttrs = {}

function sample(s: Sampler, parent: SpanContext | null, tid: TraceId) {
  return s.shouldSample(parent, tid, 'n', 'INTERNAL', noAttrs)
}

describe('AlwaysOn / AlwaysOff', () => {
  it('AlwaysOn records and samples', () => {
    const r = sample(new AlwaysOnSampler(), null, 'x'.repeat(32) as TraceId)
    expect(r.decision).toBe('RECORD_AND_SAMPLE')
  })
  it('AlwaysOff drops', () => {
    const r = sample(new AlwaysOffSampler(), null, 'x'.repeat(32) as TraceId)
    expect(r.decision).toBe('DROP')
  })
})

describe('TraceIdRatioSampler', () => {
  it('ratio=1 samples everything', () => {
    const s = new TraceIdRatioSampler(1)
    for (let i = 0; i < 20; i++) {
      const id = (i.toString(16).padStart(32, '0')) as TraceId
      expect(s.shouldSample(null, id, 'n', 'INTERNAL', noAttrs).decision).toBe('RECORD_AND_SAMPLE')
    }
  })

  it('ratio=0 drops everything', () => {
    const s = new TraceIdRatioSampler(0)
    expect(
      s.shouldSample(null, 'ffffffffffffffffffffffffffffffff' as TraceId, 'n', 'INTERNAL', noAttrs).decision,
    ).toBe('DROP')
  })

  it('is deterministic for same trace id', () => {
    const s = new TraceIdRatioSampler(0.5)
    const tid = '4bf92f3577b34da6a3ce929d0e0e4736' as TraceId
    const a = s.shouldSample(null, tid, 'n', 'INTERNAL', noAttrs).decision
    const b = s.shouldSample(null, tid, 'n', 'INTERNAL', noAttrs).decision
    expect(a).toBe(b)
  })

  it('approximates the target ratio across many trace ids', () => {
    const s = new TraceIdRatioSampler(0.25)
    let sampled = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      // Random hex 32 chars
      const tid = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('') as TraceId
      if (s.shouldSample(null, tid, 'n', 'INTERNAL', noAttrs).decision === 'RECORD_AND_SAMPLE') sampled++
    }
    // Expect around 0.25 * N = 500; allow a wide band.
    expect(sampled).toBeGreaterThan(N * 0.15)
    expect(sampled).toBeLessThan(N * 0.35)
  })

  it('rejects ratios outside [0,1]', () => {
    expect(() => new TraceIdRatioSampler(-0.1)).toThrow()
    expect(() => new TraceIdRatioSampler(1.5)).toThrow()
    expect(() => new TraceIdRatioSampler(NaN)).toThrow()
  })
})

describe('ParentBasedSampler', () => {
  const tid = '4bf92f3577b34da6a3ce929d0e0e4736' as TraceId
  const parentSampled: SpanContext = { traceId: tid, spanId: '00f067aa0ba902b7', traceFlags: 0x01, isRemote: true }
  const parentUnsampled: SpanContext = { ...parentSampled, traceFlags: 0x00 }

  it('falls through to root for missing parent', () => {
    const s = new ParentBasedSampler(new AlwaysOffSampler())
    expect(s.shouldSample(null, tid, 'n', 'INTERNAL', noAttrs).decision).toBe('DROP')
  })

  it('respects sampled remote parent', () => {
    const s = new ParentBasedSampler(new AlwaysOffSampler())
    expect(s.shouldSample(parentSampled, tid, 'n', 'INTERNAL', noAttrs).decision).toBe('RECORD_AND_SAMPLE')
  })

  it('drops when parent not sampled', () => {
    const s = new ParentBasedSampler(new AlwaysOnSampler())
    expect(s.shouldSample(parentUnsampled, tid, 'n', 'INTERNAL', noAttrs).decision).toBe('DROP')
  })
})
