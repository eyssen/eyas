// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The memory-path refusal wording and the markers the Security page counts
// refusals by (B13) stay in step: every reason the policy can produce is
// recognised, and no other deterministic gate reason is.

import { describe, expect, it } from 'vitest'
import {
  MEMORY_PATH_REASON_MARKERS,
  isMemoryPathReason,
  memoryPathFailClosedReason,
  memoryPathReason,
} from '@shared/memory-sovereignty/deny-reason.js'
import { UNSANDBOXED_SHELL_REASON } from '@shared/cli-sandbox.js'
import { parseSearchScopeTag, searchScopeTag, SEARCH_SCOPE_TARGETS } from '@shared/memory-sovereignty/search-scope-code.js'

describe('memory-path refusal markers', () => {
  it('recognises every reason the policy produces', () => {
    const reasons = [
      memoryPathReason({ kind: 'foreign-memory', label: 'Claude Code', rule: 'foreign-store' }),
      memoryPathReason({ kind: 'foreign-memory', label: 'Obsidian vault', rule: 'obsidian-vault' }),
      memoryPathReason({ kind: 'provider-home', label: 'EYAS-owned CLI home', rule: 'provider-home' }),
      memoryPathReason({ kind: 'eyas-data', label: 'workspaces root', rule: 'other-workspace' }),
      memoryPathReason({ kind: 'eyas-data', label: 'vault', rule: 'eyas-data' }),
      memoryPathReason({ kind: 'eyas-data', label: 'database', rule: 'eyas-database' }),
      memoryPathFailClosedReason(new Error('registry unreadable')),
      memoryPathFailClosedReason('plain string'),
      memoryPathReason({ kind: 'foreign-memory', label: 'Obsidian vault', rule: 'obsidian-vault', searchRoot: '/home/u' }),
      memoryPathReason({ kind: 'eyas-data', label: 'data directory', rule: 'eyas-data', searchRoot: '/repo' }),
    ]
    for (const reason of reasons) expect(isMemoryPathReason(reason), reason).toBe(true)
  })

  it('the fail-closed reason keeps the error text', () => {
    expect(memoryPathFailClosedReason(new Error('boom'))).toBe('Memory-path policy could not check this call (fail-closed): boom')
  })

  it('negative: other deterministic reasons, the unsandboxed-shell reason and non-strings are not memory-path refusals', () => {
    const others: unknown[] = [
      'Input matches blocked pattern: sudo',
      'Input touches a sensitive path: master.key',
      'Rate limit: 5 consecutive denials',
      'Green tier — allowed',
      'Read-only command matching ls',
      'unclassified tool "x" — escalating to LLM judge (fail-closed)',
      UNSANDBOXED_SHELL_REASON,
      null,
      undefined,
      42,
    ]
    for (const reason of others) expect(isMemoryPathReason(reason), String(reason)).toBe(false)
  })

  it('markers are distinctive fragments, not short words that other reasons could contain', () => {
    expect(MEMORY_PATH_REASON_MARKERS.length).toBeGreaterThan(0)
    for (const m of MEMORY_PATH_REASON_MARKERS) expect(m.trim().length).toBeGreaterThan(15)
  })
})

describe('search too broad — the coded refusal of a search rooted above a protected place', () => {
  const search = (kind: 'foreign-memory' | 'eyas-data' | 'provider-home', rule: string, label: string) =>
    memoryPathReason({ kind, label, rule: rule as never, searchRoot: '/somewhere' })

  it('(+) tells the model to narrow the folder, and carries the tag of what it would reach', () => {
    const foreign = search('foreign-memory', 'foreign-store', 'Claude Code (~/.claude)')
    expect(foreign).toContain('search a narrower folder')
    expect(foreign).toContain('memory_search / memory_expand')
    expect(parseSearchScopeTag(foreign)).toBe('foreign-memory')
    expect(parseSearchScopeTag(search('eyas-data', 'eyas-data', 'vault'))).toBe('eyas-data')
    expect(parseSearchScopeTag(search('eyas-data', 'eyas-database', 'database'))).toBe('eyas-data')
    expect(parseSearchScopeTag(search('eyas-data', 'other-workspace', "another conversation's workspace"))).toBe('other-workspace')
    expect(parseSearchScopeTag(search('provider-home', 'provider-home', 'EYAS-owned CLI home (grok-cli)'))).toBe('provider-home')
    // The label is a short name, never the searched folder.
    expect(foreign).not.toContain('/somewhere')
  })

  it('(−) a plain path refusal carries no tag; an unknown or missing tag parses to null', () => {
    expect(parseSearchScopeTag(memoryPathReason({ kind: 'foreign-memory', label: 'Obsidian vault', rule: 'obsidian-vault' }))).toBeNull()
    expect(parseSearchScopeTag('[memory-path:search-scope:somewhere-else] x')).toBeNull()
    expect(parseSearchScopeTag(undefined)).toBeNull()
    expect(parseSearchScopeTag(42)).toBeNull()
  })

  it('(+) every target round-trips through its tag', () => {
    for (const target of SEARCH_SCOPE_TARGETS) expect(parseSearchScopeTag(`x ${searchScopeTag(target)} y`)).toBe(target)
  })
})
