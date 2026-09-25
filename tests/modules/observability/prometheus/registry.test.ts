// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  labelKey,
  validateMetricName,
  validateLabelName,
} from '@modules/observability/prometheus/registry'

describe('labelKey', () => {
  it('produces deterministic output regardless of insertion order', () => {
    expect(labelKey({ a: '1', b: '2' })).toBe(labelKey({ b: '2', a: '1' }))
  })

  it('returns empty string for no labels', () => {
    expect(labelKey({})).toBe('')
  })
})

describe('validateMetricName / validateLabelName', () => {
  it('accepts legal names', () => {
    expect(() => validateMetricName('eyas_foo_total')).not.toThrow()
    expect(() => validateMetricName('namespace:metric')).not.toThrow()
    expect(() => validateLabelName('agent_id')).not.toThrow()
  })

  it('rejects invalid names', () => {
    expect(() => validateMetricName('1bad')).toThrow()
    expect(() => validateMetricName('no-dash')).toThrow()
    expect(() => validateLabelName('__internal')).toThrow()
    expect(() => validateLabelName('bad-label')).toThrow()
  })
})

describe('Counter', () => {
  it('increments and reads values', () => {
    const reg = new Registry()
    const c = reg.register(
      new Counter({ name: 'c_total', help: 'c', labelNames: ['k'] }),
    )
    c.inc({ k: 'a' })
    c.inc({ k: 'a' }, 4)
    c.inc({ k: 'b' }, 2)
    expect(c.get({ k: 'a' })).toBe(5)
    expect(c.get({ k: 'b' })).toBe(2)
    expect(c.get({ k: 'c' })).toBe(0)
  })

  it('throws on negative increment', () => {
    const reg = new Registry()
    const c = reg.register(new Counter({ name: 'c2_total', help: 'h' }))
    expect(() => c.inc({}, -1)).toThrow()
  })

  it('collects one sample per label set', () => {
    const reg = new Registry()
    const c = reg.register(
      new Counter({ name: 'c3_total', help: 'h', labelNames: ['k'] }),
    )
    c.inc({ k: 'x' })
    c.inc({ k: 'y' })
    const fam = c.collect()
    expect(fam.samples).toHaveLength(2)
  })
})

describe('Gauge', () => {
  it('set/inc/dec', () => {
    const reg = new Registry()
    const g = reg.register(new Gauge({ name: 'g', help: 'h' }))
    g.set({}, 10)
    g.inc({}, 3)
    g.dec({}, 1)
    expect(g.get({})).toBe(12)
  })
})

describe('Histogram', () => {
  it('observes into buckets, sums and counts', () => {
    const reg = new Registry()
    const h = reg.register(
      new Histogram({
        name: 'h_ms',
        help: 'dur',
        labelNames: ['t'],
        buckets: [10, 100, 1000],
      }),
    )
    h.observe({ t: 'x' }, 5) // <=10, 100, 1000
    h.observe({ t: 'x' }, 50) // <=100, 1000
    h.observe({ t: 'x' }, 500) // <=1000
    h.observe({ t: 'x' }, 2000) // only +Inf

    const fam = h.collect()
    const s = fam.histogramSamples![0]
    expect(s.buckets['10']).toBe(1)
    expect(s.buckets['100']).toBe(2)
    expect(s.buckets['1000']).toBe(3)
    expect(s.buckets['+Inf']).toBe(4)
    expect(s.count).toBe(4)
    expect(s.sum).toBe(5 + 50 + 500 + 2000)
  })

  it('rejects non-ascending bucket bounds', () => {
    const reg = new Registry()
    expect(() =>
      reg.register(
        new Histogram({
          name: 'h_bad',
          help: 'x',
          buckets: [10, 10],
        }),
      ),
    ).toThrow()
  })
})

describe('Registry cardinality cap', () => {
  it('drops label sets past the limit and emits one warning', () => {
    const reg = new Registry({ maxCardinality: 3 })
    const c = reg.register(
      new Counter({ name: 'cap_total', help: 'h', labelNames: ['id'] }),
    )
    c.inc({ id: '1' })
    c.inc({ id: '2' })
    c.inc({ id: '3' })
    c.inc({ id: '4' }) // dropped
    c.inc({ id: '5' }) // dropped (still 1 warning)
    const warnings = reg.drainWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0].metricName).toBe('cap_total')
    // Fourth/fifth values are not tracked.
    expect(c.get({ id: '4' })).toBe(0)
    expect(c.get({ id: '1' })).toBe(1)
  })

  it('handles the 11k scenario (>10k label sets)', () => {
    const reg = new Registry({ maxCardinality: 10_000 })
    const c = reg.register(
      new Counter({ name: 'big_total', help: 'h', labelNames: ['id'] }),
    )
    for (let i = 0; i < 11_000; i++) {
      c.inc({ id: String(i) })
    }
    const fam = c.collect()
    expect(fam.samples.length).toBe(10_000)
    const warnings = reg.peekWarnings()
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0].metricName).toBe('big_total')
  })
})

describe('Registry duplicate register', () => {
  it('throws when the same metric name is registered twice', () => {
    const reg = new Registry()
    reg.register(new Counter({ name: 'x_total', help: 'h' }))
    expect(() =>
      reg.register(new Counter({ name: 'x_total', help: 'h' })),
    ).toThrow()
  })
})
