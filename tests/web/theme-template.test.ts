// @vitest-environment jsdom
// theme-store.ts touches `localStorage` at module scope (pre-existing pattern for
// the `theme` field, now also used for `template`), so this test needs a DOM
// environment to import the module — the default root vitest environment is 'node'.
import { describe, it, expect } from 'vitest'
import { resolveInitialTemplate } from '../../src/web/src/stores/theme-store'

describe('resolveInitialTemplate', () => {
  it('returns the stored template when valid', () => {
    expect(resolveInitialTemplate('terminal')).toBe('terminal')
  })
  it('falls back to sequoia for null or unknown', () => {
    expect(resolveInitialTemplate(null)).toBe('sequoia')
    expect(resolveInitialTemplate('bogus')).toBe('sequoia')
  })
})
