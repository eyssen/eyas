import { describe, it, expect } from 'vitest'
import { evaluateCuratorGate } from '@modules/skill-generation/curator-gate'

describe('skill curator gate', () => {
  const now = new Date('2026-08-08T12:00:00Z')

  it('blocks without snapshot', () => {
    const r = evaluateCuratorGate(null, {}, now)
    expect(r.allowed).toBe(false)
  })

  it('allows healthy recent eval', () => {
    const r = evaluateCuratorGate(
      { ranAt: '2026-08-07T12:00:00Z', passed: 8, failed: 2, errored: 0, avgScore: 78 },
      {},
      now,
    )
    expect(r.allowed).toBe(true)
  })

  it('blocks low pass ratio', () => {
    const r = evaluateCuratorGate(
      { ranAt: '2026-08-07T12:00:00Z', passed: 2, failed: 8, errored: 0, avgScore: 80 },
      {},
      now,
    )
    expect(r.allowed).toBe(false)
  })
})
