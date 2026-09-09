// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { resolveContextWindow } from '../../src/web/src/pages/conversations/context-window'

describe('resolveContextWindow', () => {
  it('prefers the model catalog window', () => {
    expect(resolveContextWindow(256_000, 'grok-cli')).toBe(256_000)
    expect(resolveContextWindow(200_000, 'anthropic')).toBe(200_000)
  })

  it('does not paint a Grok first turn against a 200k hardcoded window', () => {
    const window = resolveContextWindow(null, 'grok-cli')
    expect(window).toBeGreaterThanOrEqual(256_000)
    const pct = (166_255 / window) * 100
    expect(pct).toBeLessThan(75)
  })

  it('falls back to 200k when provider and catalog are unknown', () => {
    expect(resolveContextWindow(null, null)).toBe(200_000)
    expect(resolveContextWindow(0, 'anthropic')).toBe(200_000)
  })
})
