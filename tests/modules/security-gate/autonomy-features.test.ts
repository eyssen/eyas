// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Loop enable/disable flags for the Phase-3 self-improvement loops. This is a
// SEPARATE, minimal on/off store from the autonomy_categories trust-ladder
// (autonomy-policy.ts) — the ladder measures action-RISK autonomy (1 =
// strictest floor, never off), so mapping loop-enable onto it would be a
// category error. See autonomy-features.ts header for the full rationale.

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createAutonomyFeatures } from '@modules/security-gate/autonomy-features.js'

const LOOP_KEYS = ['proactive.heartbeat', 'memory.reflection', 'forge.apply', 'selfLearning.apply', 'skill.adopt']

describe('autonomy-features', () => {
  it('seeds all 5 Phase-3 loop keys OFF by default', () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)

    for (const key of LOOP_KEYS) {
      expect(features.isEnabled(key)).toBe(false)
    }
  })

  it('setEnabled() flips a key on, read fresh (no restart/caching)', () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)

    expect(features.isEnabled('proactive.heartbeat')).toBe(false)
    features.setEnabled('proactive.heartbeat', true, 'owner')
    expect(features.isEnabled('proactive.heartbeat')).toBe(true)
  })

  it('setEnabled() can flip a key back off', () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)

    features.setEnabled('forge.apply', true, 'owner')
    expect(features.isEnabled('forge.apply')).toBe(true)
    features.setEnabled('forge.apply', false, 'owner')
    expect(features.isEnabled('forge.apply')).toBe(false)
  })

  it('list() returns all 5 seeded flags, all disabled', () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)

    const flags = features.list()
    expect(flags).toHaveLength(5)
    expect(flags.every((f) => f.enabled === false)).toBe(true)
    expect(flags.map((f) => f.key).sort()).toEqual([...LOOP_KEYS].sort())
  })

  it('is idempotent — creating the store twice on the same db does not error or duplicate rows', () => {
    const db = createMemoryDb()
    createAutonomyFeatures(db)
    const features = createAutonomyFeatures(db)
    expect(features.list()).toHaveLength(5)
  })

  it('an unknown key reads as not enabled (fail-safe)', () => {
    const db = createMemoryDb()
    const features = createAutonomyFeatures(db)
    expect(features.isEnabled('some_unmapped_future_loop')).toBe(false)
  })
})
