// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BoardConversation, BoardStage } from '@/stores/board-store'

export type GroupBy = 'stage' | 'priority' | 'assignee'

export const GROUP_BY_OPTIONS: readonly GroupBy[] = ['stage', 'priority', 'assignee']

/** Bucket order when grouping by priority. Unknown values sort after these. */
export const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** Bucket key for conversations nobody owns. Always ordered last. */
export const UNASSIGNED_KEY = 'assignee:__unassigned__'

/** A conversation flattened together with the stage it came from. */
export interface ListRow extends BoardConversation {
  stageId: string
  stageName: string
  stageColor: string | null
  stageIsClosed: boolean
}

export interface RowGroup {
  key: string
  /** Raw label from the record (stage / assignee name). Empty when `labelKey` carries the text. */
  label: string
  /** i18n key for fixed terms (priority, unassigned). Takes precedence over `label`. */
  labelKey?: string
  color: string | null
  rows: ListRow[]
}

export function flattenRows(stages: BoardStage[]): ListRow[] {
  return stages.flatMap((stage) =>
    stage.conversations.map((c) => ({
      ...c,
      stageId: stage.id,
      stageName: stage.name,
      stageColor: stage.color,
      stageIsClosed: stage.isClosed,
    })),
  )
}

function priorityRank(priority: string): number {
  const rank = PRIORITY_ORDER[priority]
  return rank === undefined ? PRIORITY_ORDER.normal : rank
}

/** Pinned first, then by priority, then the board's own ordering. */
function compareRows(a: ListRow, b: ListRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
  if (byPriority !== 0) return byPriority
  if (a.position !== b.position) return a.position - b.position
  return a.taskId.localeCompare(b.taskId)
}

function bucket<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

function groupByStage(stages: BoardStage[]): RowGroup[] {
  // Stages are structural: an empty one still gets a heading, so the board's
  // shape stays visible and doesn't jump around as the last row moves out.
  return stages.map((stage) => ({
    key: stage.id,
    label: stage.name,
    color: stage.color,
    rows: flattenRows([stage]).sort(compareRows),
  }))
}

function groupByPriority(rows: ListRow[]): RowGroup[] {
  const buckets = new Map<string, ListRow[]>()
  for (const row of rows) bucket(buckets, row.priority, row)

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      const ra = PRIORITY_ORDER[a] ?? Number.MAX_SAFE_INTEGER
      const rb = PRIORITY_ORDER[b] ?? Number.MAX_SAFE_INTEGER
      return ra !== rb ? ra - rb : a.localeCompare(b)
    })
    .map(([priority, list]) => ({
      key: `priority:${priority}`,
      label: priority,
      // A priority outside the known set has no translation — show it verbatim
      // rather than rendering a missing key.
      labelKey: priority in PRIORITY_ORDER ? `board.priority.${priority}` : undefined,
      color: null,
      rows: list.sort(compareRows),
    }))
}

function groupByAssignee(rows: ListRow[]): RowGroup[] {
  const buckets = new Map<string, ListRow[]>()
  const unassigned: ListRow[] = []

  for (const row of rows) {
    if (row.assignees.length === 0) {
      unassigned.push(row)
      continue
    }
    // A conversation with several assignees is genuinely on each of their
    // plates, so it appears under every one of them.
    for (const assignee of row.assignees) bucket(buckets, assignee, row)
  }

  const groups: RowGroup[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([assignee, list]) => ({
      key: `assignee:${assignee}`,
      label: assignee,
      color: null,
      rows: list.sort(compareRows),
    }))

  if (unassigned.length > 0) {
    groups.push({
      key: UNASSIGNED_KEY,
      label: '',
      labelKey: 'board.groupBy.unassigned',
      color: null,
      rows: unassigned.sort(compareRows),
    })
  }

  return groups
}

export function groupRows(stages: BoardStage[], groupBy: GroupBy): RowGroup[] {
  if (groupBy === 'stage') return groupByStage(stages)
  if (groupBy === 'priority') return groupByPriority(flattenRows(stages))
  return groupByAssignee(flattenRows(stages))
}

function isBoundaryChar(ch: string): boolean {
  return ch === ' ' || ch === '-' || ch === '_' || ch === '/' || ch === '.' || ch === ':' || ch === '#'
}

/** Anything the subsequence branch can score stays below this, so a contiguous
 *  hit always outranks a scattered one for the same query. */
const SUBSEQUENCE_CEILING = 900
const SUBSTRING_BASE = 1000

/**
 * Score `text` against `query`: higher is better, `null` means no match.
 * Case-insensitive; an empty query matches everything with a neutral 0.
 *
 * Scores are only comparable within one query — they rank candidates against
 * each other, they are not an absolute quality measure.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const hay = text.toLowerCase()
  if (hay === '') return null

  const at = hay.indexOf(q)
  if (at !== -1) {
    let score = SUBSTRING_BASE
    if (at === 0) score += 60
    else if (isBoundaryChar(hay[at - 1])) score += 40
    score -= Math.min(30, at) // earlier hit wins
    score -= Math.min(20, hay.length - q.length) // denser hit wins
    return score
  }

  let queryIdx = 0
  let score = 0
  let run = 0
  let prev = -2
  for (let i = 0; i < hay.length && queryIdx < q.length; i++) {
    if (hay[i] !== q[queryIdx]) continue
    let bonus = 2
    if (prev === i - 1) {
      run += 1
      bonus += run * 3
    } else {
      run = 0
    }
    if (i === 0) bonus += 8
    else if (isBoundaryChar(hay[i - 1])) bonus += 6
    score += bonus
    prev = i
    queryIdx += 1
  }
  if (queryIdx < q.length) return null
  return Math.min(score, SUBSEQUENCE_CEILING)
}

/**
 * Filter + sort `items` by the best-scoring of each item's texts. Ties keep the
 * incoming order. An empty query returns everything untouched.
 */
export function rankByText<T>(query: string, items: T[], getTexts: (item: T) => string[]): T[] {
  if (query.trim() === '') return [...items]

  const scored: { item: T; score: number; idx: number }[] = []
  items.forEach((item, idx) => {
    let best: number | null = null
    for (const text of getTexts(item)) {
      const score = fuzzyScore(query, text)
      if (score !== null && (best === null || score > best)) best = score
    }
    if (best !== null) scored.push({ item, score: best, idx })
  })

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx)
  return scored.map((s) => s.item)
}

export interface RankableConversation {
  taskId: string
  title: string | null
}

/** Rank conversations by title or task id — `#12` and `12` both find task 12. */
export function rankConversations<T extends RankableConversation>(query: string, rows: T[]): T[] {
  return rankByText(query, rows, (row) => [row.title ?? '', `#${row.taskId}`])
}

/** Up to two initials for an avatar fallback. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
