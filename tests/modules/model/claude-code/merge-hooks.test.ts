// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A4 — mergeHooks() is the one composer of a Claude Code query's SDK hooks.
// The SDK takes a single `hooks` record per query, so a second writer would
// silently replace the first one's matchers (the memory-policy hook vanishing
// behind an observer). Order is fixed: sovereignty → readback. G6: there is no
// orchestration slot — the agent runner emits the run tree for every provider.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { applyHooks, mergeHooks, CLAUDE_HOOK_SLOT_ORDER } from '@modules/model/submodules/claude-code/hooks.js'
import { stripComments } from '../../../helpers/strip-comments.js'

const m = (label: string): HookCallbackMatcher & { label: string } => ({ label, hooks: [async () => ({ continue: true })] })

describe('mergeHooks', () => {
  it('concatenates per-event matchers in the fixed slot order, whatever order the caller lists them in', () => {
    const merged = mergeHooks({
      readback: { hooks: { PreToolUse: [m('readback-pre')], PostToolUse: [m('readback-post')] } },
      sovereignty: { hooks: { PreToolUse: [m('policy')] } },
    })
    expect((merged.hooks!.PreToolUse as any[]).map((x) => x.label)).toEqual(['policy', 'readback-pre'])
    expect((merged.hooks!.PostToolUse as any[]).map((x) => x.label)).toEqual(['readback-post'])
    expect(CLAUDE_HOOK_SLOT_ORDER).toEqual(['sovereignty', 'readback'])
  })

  it('has no orchestration slot any more (negative)', () => {
    expect(CLAUDE_HOOK_SLOT_ORDER as readonly string[]).not.toContain('orchestration')
    // A stray contributor under the old name adds nothing.
    expect(mergeHooks({ orchestration: { hooks: { PreToolUse: [m('orch')] } } } as any)).toEqual({})
  })

  it('does not mutate the contributors\' arrays', () => {
    const pre = [m('policy')]
    const set = { hooks: { PreToolUse: pre } }
    mergeHooks({ sovereignty: set, readback: { hooks: { PreToolUse: [m('readback')] } } })
    expect(pre).toHaveLength(1)
    expect(set.hooks.PreToolUse).toBe(pre)
  })

  it('an empty slot, an empty set or an empty event list is a no-op', () => {
    expect(mergeHooks({})).toEqual({})
    expect(mergeHooks({ sovereignty: { hooks: {} }, readback: { hooks: { PreToolUse: [] } } })).toEqual({})
    const merged = mergeHooks({ sovereignty: undefined, readback: { hooks: { PreToolUse: [m('readback')] } } })
    expect(Object.keys(merged.hooks!)).toEqual(['PreToolUse'])
  })

  it('asks for hook lifecycle events only when a slot that contributed matchers needs them', () => {
    expect(mergeHooks({ readback: { hooks: { PreToolUse: [m('r')] }, includeHookEvents: true } }).includeHookEvents).toBe(true)
    expect(mergeHooks({ sovereignty: { hooks: { PreToolUse: [m('p')] } } }).includeHookEvents).toBeUndefined()
    // A set that contributes nothing cannot switch the stream option on.
    expect(mergeHooks({ readback: { hooks: {}, includeHookEvents: true } })).toEqual({})
  })
})

describe('applyHooks — the only writer of queryOptions.hooks', () => {
  it('writes the merged hooks once', () => {
    const options: Record<string, unknown> = {}
    applyHooks(options, { readback: { hooks: { PreToolUse: [m('r')] }, includeHookEvents: true } })
    expect((options.hooks as any).PreToolUse).toHaveLength(1)
    expect(options.includeHookEvents).toBe(true)
  })

  it('writes nothing when nobody contributed', () => {
    const options: Record<string, unknown> = {}
    applyHooks(options, {})
    expect(options).not.toHaveProperty('hooks')
    expect(options).not.toHaveProperty('includeHookEvents')
  })

  it('refuses a second write instead of replacing matchers someone else installed', () => {
    const options: Record<string, unknown> = {}
    applyHooks(options, { sovereignty: { hooks: { PreToolUse: [m('p')] } } })
    expect(() => applyHooks(options, { readback: { hooks: { PreToolUse: [m('r')] } } })).toThrow(/only writer/)
    expect((options.hooks as any).PreToolUse.map((x: any) => x.label)).toEqual(['p'])

    const empty: Record<string, unknown> = {}
    applyHooks(empty, {})
    expect(() => applyHooks(empty, { sovereignty: { hooks: { PreToolUse: [m('p')] } } })).toThrow(/only writer/)

    expect(() => applyHooks({ hooks: {} }, {})).toThrow(/only writer/)
  })

  it('the provider never assigns hooks or includeHookEvents itself', () => {
    const src = stripComments(readFileSync(join(process.cwd(), 'src/modules/model/submodules/claude-code/provider.ts'), 'utf-8'))
    expect(src).not.toMatch(/\[\s*['"]hooks['"]\s*\]\s*=/)
    expect(src).not.toMatch(/\.hooks\s*=/)
    expect(src).not.toMatch(/\[\s*['"]includeHookEvents['"]\s*\]\s*=/)
    expect(src).not.toMatch(/\.includeHookEvents\s*=/)
    expect(src.match(/applyHooks\(/g)).toHaveLength(1)
  })
})
