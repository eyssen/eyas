// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G5 — one ledger key per tool call, whatever runtime executed it.

import { describe, it, expect } from 'vitest'
import { argHash, toolArgHash, toolLedgerKey } from '@shared/arg-hash.js'

describe('toolLedgerKey / toolArgHash', () => {
  it('keys a Claude Code builtin under its canonical EYAS name', () => {
    expect(toolLedgerKey('Bash', { command: 'ls' })).toBe(toolLedgerKey('run_command', { command: 'ls' }))
    expect(toolLedgerKey('mcp__eyas__save_memory', { content: 'n' })).toBe(toolLedgerKey('save_memory', { content: 'n' }))
  })

  it("normalizes Claude Code's file_path onto path", () => {
    expect(toolLedgerKey('Write', { file_path: '/a', content: 'x' })).toBe(toolLedgerKey('write_file', { path: '/a', content: 'x' }))
  })

  it('equals the plain argHash for inputs without runtime-specific keys (older recorded hashes still match)', () => {
    expect(toolArgHash({ path: '/y' })).toBe(argHash({ path: '/y' }))
    expect(toolArgHash(undefined)).toBe(argHash(undefined))
    expect(toolLedgerKey('write_file', { path: '/y' })).toBe(`write_file:${argHash({ path: '/y' })}`)
  })

  it('different arguments or a different tool give a different key', () => {
    expect(toolLedgerKey('Bash', { command: 'ls' })).not.toBe(toolLedgerKey('Bash', { command: 'ls -la' }))
    expect(toolLedgerKey('Read', { path: '/a' })).not.toBe(toolLedgerKey('Write', { path: '/a' }))
  })
})
