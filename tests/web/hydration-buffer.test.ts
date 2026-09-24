// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createHydrationBuffer } from '../../src/web/src/lib/hydration-buffer'

describe('createHydrationBuffer', () => {
  it('passes events straight through while no hydration is in flight', () => {
    const buffer = createHydrationBuffer<string>()
    expect(buffer.push('a')).toBe(false)
    expect(buffer.flush()).toEqual([])
  })

  it('queues events while hydration is pending and flushes them in arrival order', () => {
    const buffer = createHydrationBuffer<string>()
    buffer.begin()
    expect(buffer.push('a')).toBe(true)
    expect(buffer.push('b')).toBe(true)
    expect(buffer.flush()).toEqual(['a', 'b'])
  })

  it('stops buffering after a flush', () => {
    const buffer = createHydrationBuffer<string>()
    buffer.begin()
    buffer.push('a')
    buffer.flush()
    expect(buffer.push('b')).toBe(false)
    expect(buffer.flush()).toEqual([])
  })

  it('does not replay the same events twice', () => {
    const buffer = createHydrationBuffer<string>()
    buffer.begin()
    buffer.push('a')
    expect(buffer.flush()).toEqual(['a'])
    expect(buffer.flush()).toEqual([])
  })

  it('begin() drops anything left over from an earlier hydration', () => {
    const buffer = createHydrationBuffer<string>()
    buffer.begin()
    buffer.push('stale')
    buffer.begin()
    buffer.push('fresh')
    expect(buffer.flush()).toEqual(['fresh'])
  })

  it('clear() discards queued events and resumes pass-through (conversation switch)', () => {
    const buffer = createHydrationBuffer<string>()
    buffer.begin()
    buffer.push('stale')
    buffer.clear()
    expect(buffer.push('live')).toBe(false)
    expect(buffer.flush()).toEqual([])
  })
})
