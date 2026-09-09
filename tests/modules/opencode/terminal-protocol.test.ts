// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { parseClientFrame, encodeServerFrame } from '@modules/opencode/terminal-protocol'
import { stripAnsi } from '@modules/opencode/ansi'

describe('terminal protocol', () => {
  it('parses input, resize, ping', () => {
    expect(parseClientFrame(JSON.stringify({ type: 'input', data: 'ls\n' }))).toEqual({ type: 'input', data: 'ls\n' })
    expect(parseClientFrame(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))).toEqual({ type: 'resize', cols: 80, rows: 24 })
    expect(parseClientFrame(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' })
  })

  it('treats raw text as input', () => {
    expect(parseClientFrame('x')).toEqual({ type: 'input', data: 'x' })
  })

  it('rejects oversized resize', () => {
    expect(parseClientFrame(JSON.stringify({ type: 'resize', cols: 9_000, rows: 24 }))).toBeNull()
  })

  it('encodes server frames as JSON', () => {
    expect(JSON.parse(encodeServerFrame({ type: 'pong' }))).toEqual({ type: 'pong' })
  })
})

describe('stripAnsi', () => {
  it('removes CSI color sequences', () => {
    expect(stripAnsi('\x1B[31mred\x1B[0m')).toBe('red')
  })
})
