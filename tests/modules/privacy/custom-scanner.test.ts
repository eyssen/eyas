// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCustomScanner } from '@modules/privacy/scanners/custom-scanner'

function fakeLogger() {
  return { warn: vi.fn() }
}

describe('CustomScanner (sync, logged, line-bounded)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('matches synchronously with absolute offsets', () => {
    const scanner = createCustomScanner(
      [{ name: 'project', regex: 'PROJECT-[A-Z]{3}-\\d+', type: 'custom', confidence: 0.9 }],
      fakeLogger(),
    )
    const text = 'intro\nsee PROJECT-ABC-123 now'
    const matches = scanner.scan(text)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ type: 'custom', value: 'PROJECT-ABC-123', scanner: 'custom', confidence: 0.9 })
    expect(text.slice(matches[0].start, matches[0].end)).toBe('PROJECT-ABC-123')
    expect(scanner.rejected).toEqual([])
  })

  it('drops unsafe and non-compiling patterns, reports them and logs through the logger (never console)', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = fakeLogger()
    const scanner = createCustomScanner(
      [
        { name: 'redos', regex: '(a+)+$', type: 'custom', confidence: 0.9 },
        { name: 'broken', regex: '(unclosed', type: 'custom', confidence: 0.9 },
        { name: 'ok', regex: 'SECRET-\\d{4}', type: 'custom', confidence: 0.9 },
      ],
      logger,
    )
    expect(scanner.rejected.map((r) => [r.name, r.reason])).toEqual([
      ['redos', 'unsafe'],
      ['broken', 'invalid'],
    ])
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(consoleWarn).not.toHaveBeenCalled()
    // The valid pattern still works.
    expect(scanner.scan('SECRET-1234').map((m) => m.value)).toEqual(['SECRET-1234'])
    expect(scanner.scan('aaaa')).toEqual([])
  })

  it('does not loop forever on a pattern that matches the empty string', () => {
    const scanner = createCustomScanner([{ name: 'maybe', regex: 'x*', type: 'custom', confidence: 0.5 }], fakeLogger())
    const matches = scanner.scan('ab xx c')
    expect(matches.map((m) => m.value)).toEqual(['xx'])
  })

  it('never matches across a line break; ^ and $ anchor to lines', () => {
    const scanner = createCustomScanner(
      [
        { name: 'span', regex: 'START[\\s\\S]*END', type: 'custom', confidence: 0.9 },
        { name: 'anchored', regex: '^CODE-\\d+$', type: 'custom', confidence: 0.9 },
      ],
      fakeLogger(),
    )
    expect(scanner.scan('START\nEND')).toEqual([])
    expect(scanner.scan('START here END').map((m) => m.value)).toEqual(['START here END'])
    expect(scanner.scan('x\nCODE-42\ny').map((m) => m.value)).toEqual(['CODE-42'])
    expect(scanner.scan('x CODE-42 y')).toEqual([])
  })
})
