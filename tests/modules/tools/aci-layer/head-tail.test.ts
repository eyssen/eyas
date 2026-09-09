// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { headTailStrategy } from '@modules/tools/aci-layer/strategies/head-tail'

describe('head-tail strategy', () => {
  it('passes through input that fits under the combined head+tail cap', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const result = headTailStrategy(text, { toolName: 'shell.exec' })

    expect(result.truncated).toBe(false)
    expect(result.followUpHint).toBeUndefined()
    expect(result.formatted).toBe(text)
    expect(result.strategy).toBe('head-tail')
    expect(result.originalSize).toBe(text.length)
  })

  it('truncates long output, keeping first N and last M lines with marker', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`)
    const text = lines.join('\n')

    const result = headTailStrategy(text, { toolName: 'shell.exec' })

    expect(result.truncated).toBe(true)
    expect(result.formatted.startsWith('line 1\n')).toBe(true)
    expect(result.formatted.endsWith('line 500')).toBe(true)
    expect(result.formatted).toContain('... <350 lines truncated> ...')
  })

  it('emits a followUpHint when truncation happens', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n')
    const result = headTailStrategy(lines, { toolName: 'shell.exec' })

    expect(result.truncated).toBe(true)
    expect(result.followUpHint).toBeDefined()
    expect(result.followUpHint!).toContain('1000 lines')
  })

  it('honours custom head/tail options from ctx.options', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`).join('\n')
    const result = headTailStrategy(lines, {
      toolName: 'shell.exec',
      options: { headLines: 3, tailLines: 2 },
    })

    expect(result.truncated).toBe(true)
    expect(result.formatted.split('\n')[0]).toBe('L0')
    expect(result.formatted.split('\n').slice(-1)[0]).toBe('L49')
    expect(result.formatted).toContain('... <45 lines truncated> ...')
  })

  it('serialises non-string input through JSON', () => {
    const result = headTailStrategy({ a: 1, b: 2 }, { toolName: 'x' })
    expect(result.formatted).toContain('"a": 1')
  })

  it('respects maxOutputChars char cap', () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    const result = headTailStrategy(text, {
      toolName: 'shell.exec',
      maxOutputChars: 50,
    })
    expect(result.formatted.length).toBeLessThanOrEqual(50 + '\n... <char cap reached> ...'.length)
    expect(result.formatted).toContain('<char cap reached>')
  })
})
