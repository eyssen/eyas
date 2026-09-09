// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 dream-engine — Task 7 bridge. A reflection's ImprovementCandidate[]
// (Task 3) must reach forge's feedback store, and must never break the
// reflection job if forge is absent or the collector throws.

import { describe, it, expect, vi } from 'vitest'
import { bridgeImprovementsToForge } from '@modules/memory/reflection-forge-bridge'
import type { ImprovementCandidate } from '@modules/memory/reflection-engine'

function candidate(overrides: Partial<ImprovementCandidate> = {}): ImprovementCandidate {
  return {
    target: 'tool',
    targetId: 'web_search',
    friction: 'web_search timed out on 2 of 2 runs today',
    suggestion: 'lower the timeout and retry once before failing',
    confidence: 0.8,
    evidenceSessions: ['s1', 's2'],
    ...overrides,
  }
}

describe('bridgeImprovementsToForge', () => {
  it('records a forge feedback entry for a target:tool candidate, mapped + marked', () => {
    const record = vi.fn()
    const bridged = bridgeImprovementsToForge({ collector: { record } }, [candidate()], 'reflection:2026-07-11')

    expect(bridged).toBe(1)
    expect(record).toHaveBeenCalledWith({
      target: 'tool',
      targetId: 'web_search',
      conversationId: 'reflection:2026-07-11',
      useful: false,
      friction: 'web_search timed out on 2 of 2 runs today',
      betterApproach: 'lower the timeout and retry once before failing',
    })
    // forge's own tools:executed auto-collector drops falsy conversationId —
    // guard that the marker we pass through is always non-falsy.
    const [[call]] = record.mock.calls
    expect(call.conversationId).toBeTruthy()
  })

  it('records a forge feedback entry for a target:skill candidate', () => {
    const record = vi.fn()
    bridgeImprovementsToForge({ collector: { record } }, [candidate({ target: 'skill', targetId: 'daily-digest' })], 'reflection:2026-07-11')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ target: 'skill', targetId: 'daily-digest' }))
  })

  it('skips target:prompt candidates — forge has no prompt target (schema CHECK would reject it)', () => {
    const record = vi.fn()
    const bridged = bridgeImprovementsToForge({ collector: { record } }, [candidate({ target: 'prompt', targetId: 'agent-x' })], 'reflection:2026-07-11')
    expect(bridged).toBe(0)
    expect(record).not.toHaveBeenCalled()
  })

  it('is a no-op when forge is absent — never throws', () => {
    expect(() => bridgeImprovementsToForge(undefined, [candidate()], 'reflection:2026-07-11')).not.toThrow()
    expect(bridgeImprovementsToForge(undefined, [candidate()], 'reflection:2026-07-11')).toBe(0)
  })

  it('is a no-op when the collector is absent on the forge service object', () => {
    expect(bridgeImprovementsToForge({}, [candidate()], 'reflection:2026-07-11')).toBe(0)
  })

  it('fails open when collector.record throws — logs a warning, keeps processing remaining candidates', () => {
    const warn = vi.fn()
    const record = vi.fn()
      .mockImplementationOnce(() => { throw new Error('db down') })
      .mockImplementationOnce(() => undefined)
    const bridged = bridgeImprovementsToForge(
      { collector: { record } },
      [candidate({ targetId: 'a' }), candidate({ targetId: 'b' })],
      'reflection:2026-07-11',
      { warn },
    )
    expect(bridged).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an empty improvements list', () => {
    const record = vi.fn()
    expect(bridgeImprovementsToForge({ collector: { record } }, [], 'reflection:2026-07-11')).toBe(0)
    expect(record).not.toHaveBeenCalled()
  })
})
