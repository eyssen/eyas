// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createAciFormatter } from '@modules/tools/aci-layer/formatter'
import { resolveStrategy, DEFAULT_TOOL_STRATEGIES } from '@modules/tools/aci-layer/registry'
import { headTailStrategy } from '@modules/tools/aci-layer/strategies/head-tail'
import { lineGrepStrategy } from '@modules/tools/aci-layer/strategies/line-grep'
import { structuredStrategy } from '@modules/tools/aci-layer/strategies/structured'
import { fileChunkStrategy } from '@modules/tools/aci-layer/strategies/file-chunk'
import type { FormattingStrategy } from '@modules/tools/aci-layer/types'

describe('createAciFormatter — dispatcher', () => {
  it('picks head-tail for shell commands', () => {
    const aci = createAciFormatter()
    expect(aci.getStrategy('shell.exec')).toBe(headTailStrategy)
    expect(aci.getStrategy('bash.exec')).toBe(headTailStrategy)
  })

  it('picks structured for search tools', () => {
    const aci = createAciFormatter()
    expect(aci.getStrategy('search.code')).toBe(structuredStrategy)
    expect(aci.getStrategy('search.docs')).toBe(structuredStrategy)
  })

  it('picks file-chunk for file reads', () => {
    const aci = createAciFormatter()
    expect(aci.getStrategy('file.read')).toBe(fileChunkStrategy)
    expect(aci.getStrategy('documents.read')).toBe(fileChunkStrategy)
  })

  it('picks line-grep for grep-like tools', () => {
    const aci = createAciFormatter()
    expect(aci.getStrategy('shell.grep')).toBe(lineGrepStrategy)
    expect(aci.getStrategy('search.grep')).toBe(lineGrepStrategy)
  })

  it('falls back to head-tail for unknown tools', () => {
    const aci = createAciFormatter()
    expect(aci.getStrategy('some.unknown.tool')).toBe(headTailStrategy)
  })

  it('uses longest-prefix match when exact entry missing', () => {
    // search.code.ast → search.code → structured
    const aci = createAciFormatter()
    expect(aci.getStrategy('search.code.ast')).toBe(structuredStrategy)
  })

  it('registerStrategy overrides both exact and prefix lookups', () => {
    const aci = createAciFormatter()
    const custom: FormattingStrategy = (raw) => ({
      formatted: `custom:${String(raw)}`,
      originalSize: String(raw).length,
      truncated: false,
      strategy: 'custom',
    })

    aci.registerStrategy('shell.exec', custom)
    expect(aci.getStrategy('shell.exec')).toBe(custom)

    const result = aci.format('hello', { toolName: 'shell.exec' })
    expect(result.formatted).toBe('custom:hello')
    expect(result.strategy).toBe('custom')
  })

  it('registering an override at a prefix cascades to children without closer defaults', () => {
    const aci = createAciFormatter()
    const custom: FormattingStrategy = (raw, ctx) => ({
      formatted: `ovr:${ctx.toolName}:${String(raw).length}`,
      originalSize: String(raw).length,
      truncated: false,
      strategy: 'override',
    })

    // Register at the root "unknown" prefix where no intermediate default
    // exists. "unknown.child.leaf" has no default at any level, so it must
    // fall through to the "unknown" override.
    aci.registerStrategy('unknown', custom)
    const res = aci.format('xxx', { toolName: 'unknown.child.leaf' })
    expect(res.strategy).toBe('override')
    expect(res.formatted).toContain('unknown.child.leaf')
  })

  it('longest-prefix default wins over shorter-prefix override (resolution order)', () => {
    const aci = createAciFormatter()
    const custom: FormattingStrategy = (raw) => ({
      formatted: `custom:${String(raw)}`,
      originalSize: String(raw).length,
      truncated: false,
      strategy: 'custom',
    })
    // Override at "search" is installed, but the default at the longer
    // prefix "search.code" is closer — it should win per documented order.
    aci.registerStrategy('search', custom)
    const res = aci.format({ hits: [] }, { toolName: 'search.code.x' })
    expect(res.strategy).toBe('structured')
  })

  it('format() threads context through to the strategy', () => {
    const aci = createAciFormatter()
    const text = 'info: a\nerror: b\nwarn: c'
    aci.registerStrategy('t', lineGrepStrategy)
    const res = aci.format(text, { toolName: 't', hintPattern: 'error' })
    expect(res.formatted).toBe('error: b')
    expect(res.truncated).toBe(true)
  })

  it('DEFAULT_TOOL_STRATEGIES is frozen', () => {
    expect(Object.isFrozen(DEFAULT_TOOL_STRATEGIES)).toBe(true)
  })

  it('resolveStrategy function works standalone', () => {
    const overrides = new Map<string, FormattingStrategy>()
    expect(resolveStrategy('shell.exec', overrides)).toBe(headTailStrategy)
    expect(resolveStrategy('unknown.x', overrides)).toBe(headTailStrategy)
    overrides.set('unknown.x', structuredStrategy)
    expect(resolveStrategy('unknown.x', overrides)).toBe(structuredStrategy)
  })
})
