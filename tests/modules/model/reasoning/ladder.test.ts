// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  EFFORT_LADDER,
  EFFORT_SETTINGS,
  isEffortLevel,
  ladderIndex,
  normalizeEffortSetting,
  sortEffortLevels,
} from '@modules/model/reasoning/ladder.js'

describe('effort ladder', () => {
  it('keeps the canonical order, cheapest first', () => {
    expect(EFFORT_LADDER).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(EFFORT_SETTINGS).toEqual(['auto', ...EFFORT_LADDER])
    expect(ladderIndex('none')).toBe(0)
    expect(ladderIndex('xhigh')).toBeLessThan(ladderIndex('max'))
    expect(ladderIndex('medium')).toBeGreaterThan(ladderIndex('low'))
  })

  it('normalizes every rung to itself and auto/null to Auto (null)', () => {
    for (const level of EFFORT_LADDER) expect(normalizeEffortSetting(level)).toBe(level)
    expect(normalizeEffortSetting('auto')).toBeNull()
    expect(normalizeEffortSetting(null)).toBeNull()
  })

  it('rejects unknown, mis-cased, padded and non-string values (undefined, never a guess)', () => {
    for (const bad of ['extreme', 'MAX ', 'Max', ' low', '', 42, true, {}, undefined]) {
      expect(normalizeEffortSetting(bad)).toBeUndefined()
    }
    expect(isEffortLevel('auto')).toBe(false)
    expect(ladderIndex('ultra')).toBe(-1)
  })

  it('sorts rungs onto the ladder and drops duplicates and non-rungs', () => {
    expect(sortEffortLevels(['max', 'low', 'high', 'low', 'ultra'])).toEqual(['low', 'high', 'max'])
    expect(sortEffortLevels([])).toEqual([])
  })
})
