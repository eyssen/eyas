// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from '@modules/observability/prometheus/registry'
import {
  escapeHelp,
  escapeLabelValue,
  formatFamily,
  formatValue,
  scrape,
} from '@modules/observability/prometheus/formatter'

describe('escape helpers', () => {
  it('escapes backslash, quote, and newline in label values', () => {
    expect(escapeLabelValue('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd')
  })

  it('escapes backslash and newline in HELP text (not quotes)', () => {
    expect(escapeHelp('a\\b\nc"d')).toBe('a\\\\b\\nc"d')
  })
})

describe('formatValue', () => {
  it('formats infinity and NaN per spec', () => {
    expect(formatValue(Infinity)).toBe('+Inf')
    expect(formatValue(-Infinity)).toBe('-Inf')
    expect(formatValue(Number.NaN)).toBe('NaN')
    expect(formatValue(42)).toBe('42')
    expect(formatValue(1.5)).toBe('1.5')
  })
})

describe('formatFamily', () => {
  it('emits HELP and TYPE lines for a counter', () => {
    const reg = new Registry()
    const c = reg.register(
      new Counter({
        name: 'eyas_test_total',
        help: 'A test counter',
        labelNames: ['k'],
      }),
    )
    c.inc({ k: 'a' }, 3)
    const text = formatFamily(c.collect())
    expect(text).toContain('# HELP eyas_test_total A test counter')
    expect(text).toContain('# TYPE eyas_test_total counter')
    expect(text).toContain('eyas_test_total{k="a"} 3')
  })

  it('emits sorted histogram buckets with +Inf at the end', () => {
    const reg = new Registry()
    const h = reg.register(
      new Histogram({
        name: 'h_ms',
        help: 'hist',
        labelNames: ['t'],
        buckets: [10, 100, 1000],
      }),
    )
    h.observe({ t: 'x' }, 5)
    h.observe({ t: 'x' }, 200)
    h.observe({ t: 'x' }, 2000)

    const text = formatFamily(h.collect())
    const lines = text.split('\n').filter((l) => l.startsWith('h_ms_bucket'))
    expect(lines[0]).toContain('le="10"')
    expect(lines[1]).toContain('le="100"')
    expect(lines[2]).toContain('le="1000"')
    expect(lines[3]).toContain('le="+Inf"')
    expect(text).toContain('h_ms_sum{t="x"}')
    expect(text).toContain('h_ms_count{t="x"} 3')
  })

  it('escapes special characters in label values', () => {
    const reg = new Registry()
    const g = reg.register(new Gauge({ name: 'g', help: 'h', labelNames: ['v'] }))
    g.set({ v: 'a"b\\c\nd' }, 1)
    const text = formatFamily(g.collect())
    expect(text).toContain('v="a\\"b\\\\c\\nd"')
  })
})

describe('scrape', () => {
  it('returns an empty string for an empty registry', () => {
    const reg = new Registry()
    const r = scrape(reg)
    expect(r.text).toBe('')
    expect(r.familyCount).toBe(0)
    expect(r.truncated).toBe(false)
  })

  it('sorts families by name', () => {
    const reg = new Registry()
    reg.register(new Counter({ name: 'zzz_total', help: 'z' })).inc({})
    reg.register(new Counter({ name: 'aaa_total', help: 'a' })).inc({})
    const text = scrape(reg).text
    expect(text.indexOf('aaa_total')).toBeLessThan(text.indexOf('zzz_total'))
  })

  it('truncates output past maxBytes and sets the flag', () => {
    const reg = new Registry()
    for (let i = 0; i < 50; i++) {
      reg.register(
        new Counter({
          name: `m_${i}_total`,
          help: 'long help text that repeats a lot, a lot, a lot',
        }),
      ).inc({})
    }
    const r = scrape(reg, { maxBytes: 200 })
    expect(r.truncated).toBe(true)
    expect(r.byteSize).toBeLessThanOrEqual(200)
    expect(r.familyCount).toBeLessThan(50)
  })

  it('ends each family on a newline (so concat stays valid)', () => {
    const reg = new Registry()
    reg.register(new Counter({ name: 'a_total', help: 'a' })).inc({})
    reg.register(new Counter({ name: 'b_total', help: 'b' })).inc({})
    const text = scrape(reg).text
    expect(text.endsWith('\n')).toBe(true)
  })
})
