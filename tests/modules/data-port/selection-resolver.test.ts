// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileSelection, normaliseSelection } from '@modules/data-port/selection'

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/data-port/selection-cases.json'), 'utf-8'))

describe('selection resolver (shared fixture)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const sel = compileSelection(c.wire)
      const got = Object.fromEntries(fixture.rows.map((r: any) => [r.id, sel.resolve(r)]))
      expect(got).toEqual(c.expect)
      for (const [id, target] of Object.entries(c.targets ?? {})) expect(sel.target(fixture.rows.find((r: any) => r.id === id))).toBe(target)
    })
  }
  it('normalises the legacy id array', () => {
    const sel = compileSelection(normaliseSelection(fixture.legacy.input))
    expect(Object.fromEntries(fixture.rows.map((r: any) => [r.id, sel.resolve(r)]))).toEqual(fixture.legacy.expect)
    expect(sel.target(fixture.rows[0])).toBe('vault.procedural')
  })
  it('refuses a payload over the transport limits', () => {
    expect(() => compileSelection({ base: 'all', groups: Array.from({ length: 5001 }, () => ({ kind: 'memory', selected: true })), rows: [] })).toThrow(RangeError)
    expect(() => compileSelection({ base: 'all', groups: [], rows: Array.from({ length: 50001 }, (_, i) => ({ candidateId: `c${i}`, selected: true })) })).toThrow(RangeError)
  })
  it('gives the same key for the same wire, whatever the object key order', () => {
    expect(compileSelection({ base: 'all', groups: [{ folder: 'a', selected: true }], rows: [] }).key)
      .toBe(compileSelection({ rows: [], groups: [{ selected: true, folder: 'a' }], base: 'all' } as any).key)
  })
})
