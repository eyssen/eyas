// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BoardConversation, BoardStage } from '@/stores/board-store'

export type TimelineWindow = '1h' | '24h' | '7d' | '30d'
export type TimelineGroupBy = 'stage' | 'assignee'

export const TIMELINE_WINDOWS: readonly TimelineWindow[] = ['1h', '24h', '7d', '30d']
export const DEFAULT_TIMELINE_WINDOW: TimelineWindow = '24h'

export interface TimeRange {
  start: number
  end: number
}

export interface TimelineRow {
  key: string
  /** Literal label (stage/assignee name). Empty when `labelKey` is set. */
  label: string
  /** i18n key for rows whose name is not a data value (the unassigned lane). */
  labelKey?: string
  color: string | null
  items: BoardConversation[]
}

const WINDOW_MS: Record<TimelineWindow, number> = {
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
}

/**
 * Share of the window that lies ahead of `now`. The viewport is exactly the
 * named duration wide, but it is not "the last N hours": deadlines are future
 * events, so the window is anchored with `now` at 75% and the remaining quarter
 * reserved for upcoming due dates. Without it every deadline diamond would be
 * clipped and only overdue work would ever render.
 */
export const FUTURE_FRACTION = 0.25

export function isTimelineWindow(v: string): v is TimelineWindow {
  return (TIMELINE_WINDOWS as readonly string[]).includes(v)
}

export function windowRange(window: TimelineWindow, now: number): TimeRange {
  const span = WINDOW_MS[window]
  const end = now + span * FUTURE_FRACTION
  return { start: end - span, end }
}

/**
 * Time → horizontal offset. Deliberately unclamped: callers need to know an
 * item fell outside the viewport, and the axis is the same linear mapping the
 * d3 scale applies, so the two can never drift.
 */
export function timeToX(t: number, range: TimeRange, width: number): number {
  const span = range.end - range.start
  if (span <= 0) return 0
  return ((t - range.start) / span) * width
}

export function clampToWindow(t: number, range: TimeRange): number {
  if (t < range.start) return range.start
  if (t > range.end) return range.end
  return t
}

export function isVisible(t: number | null, range: TimeRange): boolean {
  if (t === null) return false
  return t >= range.start && t <= range.end
}

/** Interval overlap — an agent run is visible if any part of it is in view. */
export function spanOverlaps(startT: number, endT: number, range: TimeRange): boolean {
  const lo = Math.min(startT, endT)
  const hi = Math.max(startT, endT)
  return hi >= range.start && lo <= range.end
}

export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * A conversation has no start/end — only the moment it last moved (`updatedAt`)
 * and an optional deadline. It is in view if either of those instants is.
 */
export function conversationVisible(c: BoardConversation, range: TimeRange): boolean {
  return isVisible(parseTime(c.updatedAt), range) || isVisible(parseTime(c.dueDate), range)
}

/**
 * Group conversations into the timeline's lanes. Stage lanes keep the board's
 * own order; assignee lanes are alphabetical with the unassigned lane pinned
 * last. A conversation with several assignees appears in each of their lanes —
 * it is genuinely on both their plates.
 */
export function bucketRows(stages: BoardStage[], groupBy: TimelineGroupBy): TimelineRow[] {
  if (groupBy === 'stage') {
    return [...stages]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((s) => s.conversations.length > 0)
      .map((s) => ({ key: s.id, label: s.name, color: s.color, items: s.conversations }))
  }

  const byAssignee = new Map<string, BoardConversation[]>()
  const unassigned: BoardConversation[] = []

  for (const stage of stages) {
    for (const c of stage.conversations) {
      if (c.assignees.length === 0) {
        unassigned.push(c)
        continue
      }
      for (const a of c.assignees) {
        const bucket = byAssignee.get(a)
        if (bucket) bucket.push(c)
        else byAssignee.set(a, [c])
      }
    }
  }

  const rows: TimelineRow[] = [...byAssignee.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => ({ key: `assignee:${name}`, label: name, color: null, items }))

  if (unassigned.length > 0) {
    rows.push({
      key: 'assignee:__unassigned__',
      label: '',
      labelKey: 'board.groupBy.unassigned',
      color: null,
      items: unassigned,
    })
  }

  return rows
}
