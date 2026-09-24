// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The data-port adapters name where each assistant keeps its memory; the
// memory-sovereignty policy must protect every one of those home locations
// from model tools. One list, checked here, instead of two that drift.

import { describe, it, expect } from 'vitest'
import { ADAPTERS } from '@modules/data-port/adapters/registry.js'
import { FOREIGN_MEMORY_STORES } from '@shared/memory-sovereignty/foreign-stores.js'

/** Adapters whose `~/` hints are a provider's own home store. */
const PROVIDER_ADAPTERS = ['claude-code', 'codex', 'gemini-cli', 'cursor', 'windsurf', 'grok-cli'] as const

/** `~/…` store roots from the table (dir stores and the fallback of $VAR stores). */
const HOME_STORE_ROOTS = FOREIGN_MEMORY_STORES.flatMap((s) => [s.path, s.fallback])
  .filter((p): p is string => typeof p === 'string' && p.startsWith('~/'))

/** Placeholders and wildcards in a hint stand for one concrete segment. */
function concrete(hint: string): string {
  return hint.replace(/<[^>]+>/g, 'x').replace(/\*/g, 'x')
}

function covered(hint: string): boolean {
  const path = concrete(hint)
  return HOME_STORE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
}

function homeHints(id: string): string[] {
  const adapter = ADAPTERS.find((a) => a.id === id)
  if (!adapter) throw new Error(`no data-port adapter ${id}`)
  return adapter.rootHints.filter((h) => h.startsWith('~/'))
}

describe('FOREIGN_MEMORY_STORES covers the data-port provider homes', () => {
  it.each(PROVIDER_ADAPTERS)('%s', (id) => {
    const hints = homeHints(id)
    expect(hints.length).toBeGreaterThan(0)
    for (const hint of hints) expect(covered(hint), hint).toBe(true)
  })

  it('ignores repository hints, which are project files, not a provider home', () => {
    const repoHints = PROVIDER_ADAPTERS.flatMap((id) => ADAPTERS.find((a) => a.id === id)?.rootHints ?? [])
      .filter((h) => h.startsWith('<repo>'))
    expect(repoHints.length).toBeGreaterThan(0)
    for (const hint of repoHints) {
      expect(PROVIDER_ADAPTERS.some((id) => homeHints(id).includes(hint))).toBe(false)
      expect(covered(hint), hint).toBe(false)
    }
  })

  it('is not vacuous: an unknown home folder is not covered', () => {
    expect(covered('~/.some-other-tool/memory')).toBe(false)
    expect(covered('~/.claudette/x')).toBe(false)
  })
})
