import { describe, it, expect } from 'vitest'
import {
  buildAttentionItems,
  dayKey,
  isDueToday,
  isOverdue,
  pickDueFocus,
  pickNextJobs,
  pickPinned,
  pickRecent,
  type DashboardConversation,
} from '../../src/web/src/pages/dashboard/dashboard-utils'

function conv(over: Partial<DashboardConversation> = {}): DashboardConversation {
  return {
    id: 'c1',
    taskId: 'abcd1234',
    title: 'Task',
    status: 'idle',
    pinned: false,
    priority: 'normal',
    dueDate: null,
    updatedAt: '2026-08-02T12:00:00.000Z',
    projectId: null,
    ...over,
  }
}

describe('dashboard-utils due dates', () => {
  it('detects overdue and due-today against local day key', () => {
    const today = dayKey(new Date(2026, 7, 2)) // 2026-08-02 local
    expect(isOverdue('2026-08-01', today)).toBe(true)
    expect(isOverdue('2026-08-02', today)).toBe(false)
    expect(isDueToday('2026-08-02T18:00:00.000Z', today)).toBe(true)
    expect(isDueToday(null, today)).toBe(false)
  })

  it('splits overdue vs due-today lists', () => {
    const today = '2026-08-02'
    const list = [
      conv({ id: 'o1', dueDate: '2026-08-01', title: 'Old' }),
      conv({ id: 't1', dueDate: '2026-08-02', title: 'Today' }),
      conv({ id: 'f1', dueDate: '2026-08-03', title: 'Future' }),
      conv({ id: 'n1', dueDate: null, title: 'None' }),
    ]
    const { overdue, dueToday } = pickDueFocus(list, today)
    expect(overdue.map((c) => c.id)).toEqual(['o1'])
    expect(dueToday.map((c) => c.id)).toEqual(['t1'])
  })
})

describe('dashboard-utils conversation picks', () => {
  it('picks pinned sorted by updatedAt desc', () => {
    const list = [
      conv({ id: 'a', pinned: true, updatedAt: '2026-08-01T10:00:00.000Z' }),
      conv({ id: 'b', pinned: true, updatedAt: '2026-08-02T10:00:00.000Z' }),
      conv({ id: 'c', pinned: false, updatedAt: '2026-08-03T10:00:00.000Z' }),
    ]
    expect(pickPinned(list).map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('picks recent excluding pinned ids', () => {
    const list = [
      conv({ id: 'a', updatedAt: '2026-08-03T10:00:00.000Z' }),
      conv({ id: 'b', updatedAt: '2026-08-02T10:00:00.000Z' }),
      conv({ id: 'c', updatedAt: '2026-08-01T10:00:00.000Z' }),
    ]
    expect(pickRecent(list, 2, new Set(['a'])).map((c) => c.id)).toEqual(['b', 'c'])
  })
})

describe('dashboard-utils attention + jobs', () => {
  it('prioritizes approvals over due-today', () => {
    const items = buildAttentionItems({
      approvals: [
        {
          id: 9,
          category: 'tools',
          toolName: 'shell',
          reason: 'run rm',
          requestedAt: '2026-08-02T10:00:00.000Z',
          runId: 'run1',
          conversationId: 'c9',
          resumeError: null,
        },
      ],
      stuck: [],
      waitingAgents: [],
      overdue: [],
      dueToday: [conv({ id: 'd1', title: 'Due', dueDate: '2026-08-02' })],
      proactive: [{ id: 'p1', title: 'High alert', body: 'x', priority: 'high' }],
    })
    expect(items[0].kind).toBe('approval')
    expect(items.some((i) => i.kind === 'due_today')).toBe(true)
    expect(items.some((i) => i.kind === 'proactive')).toBe(true)
  })

  it('picks next active jobs with future nextRunAt', () => {
    const now = Date.parse('2026-08-02T12:00:00.000Z')
    const next = pickNextJobs(
      [
        { id: 'j1', name: 'Soon', status: 'active', nextRunAt: '2026-08-02T13:00:00.000Z' },
        { id: 'j2', name: 'Later', status: 'active', nextRunAt: '2026-08-03T13:00:00.000Z' },
        { id: 'j3', name: 'Paused', status: 'paused', nextRunAt: '2026-08-02T12:30:00.000Z' },
        { id: 'j4', name: 'Past', status: 'active', nextRunAt: '2026-08-01T12:00:00.000Z' },
      ],
      5,
      now,
    )
    expect(next.map((j) => j.id)).toEqual(['j1', 'j2'])
  })
})
