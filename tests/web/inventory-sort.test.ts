// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { lastUsedValue, sortSkillRows, type SortableSkillRow } from '../../src/web/src/pages/skills/inventory-sort'

describe('lastUsedValue', () => {
  it('sorts never-used (undefined) as older than any real timestamp', () => {
    expect(lastUsedValue(undefined)).toBeLessThan(lastUsedValue('2020-01-01T00:00:00Z'))
  })

  it('converts an ISO timestamp to its epoch millis', () => {
    expect(lastUsedValue('2026-01-01T00:00:00Z')).toBe(new Date('2026-01-01T00:00:00Z').getTime())
  })
})

describe('sortSkillRows', () => {
  const rows: SortableSkillRow[] = [
    { name: 'zulu', category: 'own', source: 'user', useCount: 5, lastUsedAt: '2026-06-01T00:00:00Z' },
    { name: 'alpha', category: 'bundled', source: 'bundled', useCount: 0, lastUsedAt: undefined },
    { name: 'mike', category: 'own', source: 'generated', useCount: 12, lastUsedAt: '2026-01-01T00:00:00Z' },
  ]

  // This ordering IS the dead-skill report per the Task 25 brief: never-used
  // skills (no lastUsedAt) must lead an ascending sort.
  it('default view: last-used ascending puts never-used first, most-recent last', () => {
    const sorted = sortSkillRows(rows, 'lastUsedAt', 'asc')
    expect(sorted.map((r) => r.name)).toEqual(['alpha', 'mike', 'zulu'])
  })

  it('descending last-used reverses that order', () => {
    const sorted = sortSkillRows(rows, 'lastUsedAt', 'desc')
    expect(sorted.map((r) => r.name)).toEqual(['zulu', 'mike', 'alpha'])
  })

  it('sorts by name alphabetically', () => {
    expect(sortSkillRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['alpha', 'mike', 'zulu'])
  })

  it('sorts by useCount numerically, not lexically', () => {
    expect(sortSkillRows(rows, 'useCount', 'asc').map((r) => r.useCount)).toEqual([0, 5, 12])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortSkillRows(rows, 'name', 'asc')
    expect(rows).toEqual(copy)
  })
})
