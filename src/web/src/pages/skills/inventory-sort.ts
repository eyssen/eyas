// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Pure sort logic for the skills inventory table, split out of the component
// so it has something to actually test — inventory-view.tsx has no render
// harness in this repo. See inventory-sort.test.ts.

export type SortKey = 'name' | 'category' | 'source' | 'useCount' | 'lastUsedAt'
export type SortDir = 'asc' | 'desc'

export interface SortableSkillRow {
  name: string
  category?: string
  source: string
  useCount: number
  lastUsedAt?: string
}

/**
 * Missing last-used sorts as "oldest" so never-used skills lead an ascending
 * sort — that ordering is literally the dead-skill report.
 */
export function lastUsedValue(ts?: string): number {
  return ts ? new Date(ts).getTime() : -Infinity
}

export function compareSkillRows<T extends SortableSkillRow>(a: T, b: T, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name) * sign
    case 'category':
      return (a.category ?? '').localeCompare(b.category ?? '') * sign
    case 'source':
      return a.source.localeCompare(b.source) * sign
    case 'useCount':
      return (a.useCount - b.useCount) * sign
    case 'lastUsedAt':
    default:
      return (lastUsedValue(a.lastUsedAt) - lastUsedValue(b.lastUsedAt)) * sign
  }
}

export function sortSkillRows<T extends SortableSkillRow>(rows: T[], key: SortKey, dir: SortDir): T[] {
  return [...rows].sort((a, b) => compareSkillRows(a, b, key, dir))
}
