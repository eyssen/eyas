import { describe, it, expect } from 'vitest'
import {
  bucketRows,
  clampToWindow,
  conversationVisible,
  isTimelineWindow,
  isVisible,
  parseTime,
  spanOverlaps,
  timeToX,
  windowRange,
  DEFAULT_TIMELINE_WINDOW,
  FUTURE_FRACTION,
  TIMELINE_WINDOWS,
  type TimelineWindow,
} from '../../src/web/src/pages/board/board-timeline-utils'
import type { BoardConversation, BoardStage } from '../../src/web/src/stores/board-store'

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0)
const HOUR = 3_600_000
const DAY = 24 * HOUR

function conv(over: Partial<BoardConversation> & { id: string }): BoardConversation {
  return {
    taskId: over.id,
    title: 'x',
    priority: 'normal',
    pinned: false,
    position: 0,
    dueDate: null,
    assignees: [],
    tags: [],
    tokensUsed: 0,
    messageCount: 0,
    status: 'open',
    ...over,
  }
}

function stage(over: Partial<BoardStage> & { id: string }): BoardStage {
  return {
    name: over.id,
    color: null,
    sortOrder: 0,
    isClosed: false,
    isFolded: false,
    conversations: [],
    ...over,
  }
}

describe('windowRange', () => {
  it('spans exactly the named duration', () => {
    const spans: Record<TimelineWindow, number> = { '1h': HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }
    for (const w of TIMELINE_WINDOWS) {
      const r = windowRange(w, NOW)
      expect(r.end - r.start).toBe(spans[w])
    }
  })

  it('anchors now at 75% — a quarter of the window is future headroom for deadlines', () => {
    for (const w of TIMELINE_WINDOWS) {
      const r = windowRange(w, NOW)
      const span = r.end - r.start
      expect(r.end).toBe(NOW + span * FUTURE_FRACTION)
      expect(r.start).toBe(NOW - span * (1 - FUTURE_FRACTION))
      expect(timeToX(NOW, r, 100)).toBeCloseTo(75, 10)
    }
  })

  it('computes concrete bounds for 1h and 30d', () => {
    expect(windowRange('1h', NOW)).toEqual({ start: NOW - 45 * 60_000, end: NOW + 15 * 60_000 })
    expect(windowRange('30d', NOW)).toEqual({ start: NOW - 22.5 * DAY, end: NOW + 7.5 * DAY })
  })

  it('is deterministic — never reads the clock itself', () => {
    expect(windowRange('24h', 0)).toEqual({ start: -18 * HOUR, end: 6 * HOUR })
  })

  it('validates window ids and defaults to 24h', () => {
    expect(isTimelineWindow('7d')).toBe(true)
    expect(isTimelineWindow('90d')).toBe(false)
    expect(DEFAULT_TIMELINE_WINDOW).toBe('24h')
  })
})

describe('timeToX', () => {
  const range = { start: 1_000, end: 2_000 }

  it('maps start, mid and end onto the full width', () => {
    expect(timeToX(1_000, range, 400)).toBe(0)
    expect(timeToX(1_500, range, 400)).toBe(200)
    expect(timeToX(2_000, range, 400)).toBe(400)
  })

  it('stays linear and unclamped outside the range', () => {
    expect(timeToX(500, range, 400)).toBe(-200)
    expect(timeToX(2_500, range, 400)).toBe(600)
  })

  it('returns 0 for a degenerate range instead of dividing by zero', () => {
    expect(timeToX(1_000, { start: 5, end: 5 }, 400)).toBe(0)
    expect(timeToX(1_000, { start: 9, end: 4 }, 400)).toBe(0)
  })
})

describe('clampToWindow / visibility', () => {
  const range = { start: 100, end: 200 }

  it('clamps to the window bounds', () => {
    expect(clampToWindow(50, range)).toBe(100)
    expect(clampToWindow(150, range)).toBe(150)
    expect(clampToWindow(250, range)).toBe(200)
  })

  it('treats the bounds as visible and null as invisible', () => {
    expect(isVisible(100, range)).toBe(true)
    expect(isVisible(200, range)).toBe(true)
    expect(isVisible(99, range)).toBe(false)
    expect(isVisible(201, range)).toBe(false)
    expect(isVisible(null, range)).toBe(false)
  })

  it('detects any overlap for a span, including one that straddles the window', () => {
    expect(spanOverlaps(0, 50, range)).toBe(false)
    expect(spanOverlaps(0, 100, range)).toBe(true)
    expect(spanOverlaps(120, 130, range)).toBe(true)
    expect(spanOverlaps(0, 999, range)).toBe(true)
    expect(spanOverlaps(200, 999, range)).toBe(true)
    expect(spanOverlaps(201, 999, range)).toBe(false)
  })

  it('parses timestamps and rejects junk', () => {
    expect(parseTime('2026-07-15T12:00:00.000Z')).toBe(NOW)
    expect(parseTime(null)).toBeNull()
    expect(parseTime(undefined)).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(parseTime('not-a-date')).toBeNull()
  })

  it('shows a conversation when either its activity or its deadline is in view', () => {
    const range24 = windowRange('24h', NOW)
    const recent = conv({ id: 'a', updatedAt: new Date(NOW - HOUR).toISOString() })
    const stale = conv({ id: 'b', updatedAt: new Date(NOW - 10 * DAY).toISOString() })
    const staleButDue = conv({
      id: 'c',
      updatedAt: new Date(NOW - 10 * DAY).toISOString(),
      dueDate: new Date(NOW + 5 * 60_000).toISOString(),
    })
    const undated = conv({ id: 'd' })

    expect(conversationVisible(recent, range24)).toBe(true)
    expect(conversationVisible(stale, range24)).toBe(false)
    expect(conversationVisible(staleButDue, range24)).toBe(true)
    expect(conversationVisible(undated, range24)).toBe(false)
  })
})

describe('bucketRows — stage', () => {
  it('orders lanes by sortOrder and carries the stage colour', () => {
    const rows = bucketRows(
      [
        stage({ id: 's2', name: 'Doing', sortOrder: 2, color: '#f00', conversations: [conv({ id: 'a' })] }),
        stage({ id: 's1', name: 'Todo', sortOrder: 1, conversations: [conv({ id: 'b' })] }),
      ],
      'stage',
    )
    expect(rows.map((r) => r.key)).toEqual(['s1', 's2'])
    expect(rows.map((r) => r.label)).toEqual(['Todo', 'Doing'])
    expect(rows[1].color).toBe('#f00')
    expect(rows[1].items.map((c) => c.id)).toEqual(['a'])
  })

  it('drops stages with no conversations', () => {
    const rows = bucketRows(
      [stage({ id: 's1', conversations: [conv({ id: 'a' })] }), stage({ id: 'empty' })],
      'stage',
    )
    expect(rows.map((r) => r.key)).toEqual(['s1'])
  })

  it('does not mutate the input order', () => {
    const stages = [stage({ id: 'b', sortOrder: 2, conversations: [conv({ id: 'x' })] }), stage({ id: 'a', sortOrder: 1, conversations: [conv({ id: 'y' })] })]
    bucketRows(stages, 'stage')
    expect(stages.map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('bucketRows — assignee', () => {
  const stages = [
    stage({
      id: 's1',
      conversations: [
        conv({ id: 'a', assignees: ['zoe'] }),
        conv({ id: 'b', assignees: ['ann', 'zoe'] }),
        conv({ id: 'c' }),
      ],
    }),
    stage({ id: 's2', conversations: [conv({ id: 'd', assignees: ['ann'] }), conv({ id: 'e', assignees: [] })] }),
  ]

  it('sorts assignees alphabetically and pins unassigned last', () => {
    const rows = bucketRows(stages, 'assignee')
    expect(rows.map((r) => r.key)).toEqual(['assignee:ann', 'assignee:zoe', 'assignee:__unassigned__'])
  })

  it('collects conversations across stages per assignee', () => {
    const rows = bucketRows(stages, 'assignee')
    expect(rows[0].items.map((c) => c.id)).toEqual(['b', 'd'])
  })

  it('puts a co-assigned conversation in every assignee lane', () => {
    const rows = bucketRows(stages, 'assignee')
    expect(rows[0].items.map((c) => c.id)).toContain('b')
    expect(rows[1].items.map((c) => c.id)).toContain('b')
  })

  it('buckets the unassigned lane via an i18n key, not a literal label', () => {
    const rows = bucketRows(stages, 'assignee')
    const un = rows[rows.length - 1]
    expect(un.labelKey).toBe('board.groupBy.unassigned')
    expect(un.label).toBe('')
    expect(un.items.map((c) => c.id)).toEqual(['c', 'e'])
  })

  it('omits the unassigned lane when everything is assigned', () => {
    const rows = bucketRows([stage({ id: 's', conversations: [conv({ id: 'a', assignees: ['ann'] })] })], 'assignee')
    expect(rows.map((r) => r.key)).toEqual(['assignee:ann'])
  })

  it('returns no lanes for an empty board', () => {
    expect(bucketRows([], 'assignee')).toEqual([])
    expect(bucketRows([], 'stage')).toEqual([])
  })
})
