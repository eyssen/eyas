// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { structuredStrategy } from '@modules/tools/aci-layer/strategies/structured'

describe('structured strategy', () => {
  it('passes through small objects unchanged', () => {
    const input = { a: 1, b: ['x', 'y'], c: { nested: true } }
    const result = structuredStrategy(input, { toolName: 'search.code' })

    expect(result.truncated).toBe(false)
    expect(result.followUpHint).toBeUndefined()
    const parsed = JSON.parse(result.formatted)
    expect(parsed).toEqual(input)
  })

  it('truncates long arrays and keeps a placeholder', () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `n${i}` }))
    const result = structuredStrategy({ results: arr }, {
      toolName: 'search.code',
      options: { maxArrayItems: 10 },
    })

    expect(result.truncated).toBe(true)
    const parsed = JSON.parse(result.formatted)
    // 10 real items + 1 placeholder
    expect(parsed.results).toHaveLength(11)
    expect(parsed.results[10]).toContain('+90 more items')
  })

  it('clips long string leaves', () => {
    const big = 'x'.repeat(10_000)
    const result = structuredStrategy({ blob: big }, {
      toolName: 'search.docs',
      options: { maxStringChars: 100 },
    })

    expect(result.truncated).toBe(true)
    const parsed = JSON.parse(result.formatted)
    expect(parsed.blob.length).toBeLessThan(200)
    expect(parsed.blob).toContain('<+9900 chars>')
  })

  it('halts at maxDepth and emits followUpHint', () => {
    const deep: Record<string, unknown> = { level: 0 }
    let node: Record<string, unknown> = deep
    for (let i = 1; i <= 15; i++) {
      const next: Record<string, unknown> = { level: i }
      node.child = next
      node = next
    }

    const result = structuredStrategy(deep, {
      toolName: 'search.code',
      options: { maxDepth: 3 },
    })

    expect(result.truncated).toBe(true)
    expect(result.formatted).toContain('depth cap reached')
    expect(result.followUpHint).toBeDefined()
  })

  it('emits followUpHint summarising all truncation types', () => {
    const result = structuredStrategy(
      {
        bigArr: Array.from({ length: 200 }, (_, i) => i),
        bigStr: 'y'.repeat(5000),
      },
      { toolName: 'search.code', options: { maxArrayItems: 20, maxStringChars: 100 } },
    )
    expect(result.truncated).toBe(true)
    expect(result.followUpHint).toBeDefined()
    expect(result.followUpHint!).toMatch(/array/)
    expect(result.followUpHint!).toMatch(/string/)
  })

  it('handles raw string input by returning as-is under limit', () => {
    const result = structuredStrategy('short', {
      toolName: 'search.code',
      options: { maxStringChars: 100 },
    })
    expect(result.formatted).toBe('short')
    expect(result.truncated).toBe(false)
  })

  it('truncates raw string input over limit', () => {
    const result = structuredStrategy('z'.repeat(500), {
      toolName: 'search.code',
      options: { maxStringChars: 50 },
    })
    expect(result.truncated).toBe(true)
    expect(result.formatted).toContain('<+450 chars>')
    expect(result.followUpHint).toBeDefined()
  })
})
