import { describe, it, expect } from 'vitest'
import {
  groupRows,
  fuzzyScore,
  rankConversations,
  flattenRows,
  initials,
  UNASSIGNED_KEY,
} from '../../src/web/src/pages/board/board-list-utils'
import type { BoardConversation, BoardStage } from '../../src/web/src/stores/board-store'

function conv(over: Partial<BoardConversation> & { id: string }): BoardConversation {
  return {
    taskId: over.id,
    title: `Task ${over.id}`,
    priority: 'normal',
    pinned: false,
    position: 0,
    dueDate: null,
    assignees: [],
    tags: [],
    tokensUsed: 0,
    messageCount: 0,
    status: 'idle',
    ...over,
  }
}

function stage(id: string, name: string, conversations: BoardConversation[], over: Partial<BoardStage> = {}): BoardStage {
  return {
    id,
    name,
    color: '#58a6ff',
    sortOrder: 0,
    isClosed: false,
    isFolded: false,
    conversations,
    ...over,
  }
}

describe('flattenRows', () => {
  it('carries the stage down onto every row without mutating the stage', () => {
    const stages = [stage('s1', 'Todo', [conv({ id: '1' })], { color: '#f00', isClosed: true })]
    const rows = flattenRows(stages)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: '1', stageId: 's1', stageName: 'Todo', stageColor: '#f00', stageIsClosed: true })
    expect(stages[0].conversations[0]).not.toHaveProperty('stageName')
  })
})

describe('groupRows — by stage', () => {
  it('keeps the given stage order and keeps empty stages', () => {
    const stages = [
      stage('s2', 'Doing', [conv({ id: '2' })]),
      stage('s1', 'Todo', []),
      stage('s3', 'Done', [conv({ id: '3' })]),
    ]
    const groups = groupRows(stages, 'stage')

    expect(groups.map((g) => g.key)).toEqual(['s2', 's1', 's3'])
    expect(groups.map((g) => g.label)).toEqual(['Doing', 'Todo', 'Done'])
    expect(groups[1].rows).toEqual([])
  })

  it('uses the stage color and the raw stage name as label (no i18n key)', () => {
    const groups = groupRows([stage('s1', 'Todo', [conv({ id: '1' })], { color: '#abcdef' })], 'stage')
    expect(groups[0].color).toBe('#abcdef')
    expect(groups[0].labelKey).toBeUndefined()
  })

  it('sorts rows pinned first, then by priority, then by position', () => {
    const stages = [stage('s1', 'Todo', [
      conv({ id: 'low', priority: 'low', position: 0 }),
      conv({ id: 'urgent', priority: 'urgent', position: 1 }),
      conv({ id: 'pinned-low', priority: 'low', pinned: true, position: 2 }),
      conv({ id: 'normal-a', priority: 'normal', position: 5 }),
      conv({ id: 'normal-b', priority: 'normal', position: 3 }),
    ])]

    expect(groupRows(stages, 'stage')[0].rows.map((r) => r.id))
      .toEqual(['pinned-low', 'urgent', 'normal-b', 'normal-a', 'low'])
  })

  it('returns no groups for no stages', () => {
    expect(groupRows([], 'stage')).toEqual([])
  })
})

describe('groupRows — by priority', () => {
  it('orders buckets urgent, high, normal, low and drops empty ones', () => {
    const stages = [stage('s1', 'Todo', [
      conv({ id: '1', priority: 'low' }),
      conv({ id: '2', priority: 'urgent' }),
      conv({ id: '3', priority: 'normal' }),
      conv({ id: '4', priority: 'urgent' }),
    ])]
    const groups = groupRows(stages, 'priority')

    // No `high` conversation exists, so no `high` bucket is invented.
    expect(groups.map((g) => g.key)).toEqual(['priority:urgent', 'priority:normal', 'priority:low'])
    expect(groups[0].rows.map((r) => r.id)).toEqual(['2', '4'])
  })

  it('translates known priorities by key and shows unknown ones verbatim', () => {
    const stages = [stage('s1', 'Todo', [
      conv({ id: '1', priority: 'urgent' }),
      conv({ id: '2', priority: 'blocker' }),
    ])]
    const groups = groupRows(stages, 'priority')

    expect(groups[0].labelKey).toBe('board.priority.urgent')
    // Unknown priorities sort after the known ones and render their raw value.
    expect(groups[1].key).toBe('priority:blocker')
    expect(groups[1].labelKey).toBeUndefined()
    expect(groups[1].label).toBe('blocker')
  })

  it('collects rows across stages into one bucket', () => {
    const stages = [
      stage('s1', 'Todo', [conv({ id: '1', priority: 'high' })]),
      stage('s2', 'Doing', [conv({ id: '2', priority: 'high' })]),
    ]
    const groups = groupRows(stages, 'priority')

    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map((r) => r.stageName)).toEqual(['Todo', 'Doing'])
  })
})

describe('groupRows — by assignee', () => {
  it('sorts assignees alphabetically with unassigned last', () => {
    const stages = [stage('s1', 'Todo', [
      conv({ id: '1', assignees: ['Zoe'] }),
      conv({ id: '2', assignees: [] }),
      conv({ id: '3', assignees: ['alice'] }),
    ])]
    const groups = groupRows(stages, 'assignee')

    expect(groups.map((g) => g.key)).toEqual(['assignee:alice', 'assignee:Zoe', UNASSIGNED_KEY])
    expect(groups[2].labelKey).toBe('board.groupBy.unassigned')
    expect(groups[2].label).toBe('')
  })

  it('omits the unassigned bucket when everyone has an owner', () => {
    const stages = [stage('s1', 'Todo', [conv({ id: '1', assignees: ['alice'] })])]
    expect(groupRows(stages, 'assignee').map((g) => g.key)).toEqual(['assignee:alice'])
  })

  it('lists a multi-assignee conversation under each assignee', () => {
    const stages = [stage('s1', 'Todo', [conv({ id: '1', assignees: ['alice', 'bob'] })])]
    const groups = groupRows(stages, 'assignee')

    expect(groups.map((g) => g.key)).toEqual(['assignee:alice', 'assignee:bob'])
    expect(groups[0].rows[0].id).toBe('1')
    expect(groups[1].rows[0].id).toBe('1')
  })
})

describe('fuzzyScore', () => {
  it('returns null when the characters are not all there', () => {
    expect(fuzzyScore('zzz', 'abc')).toBeNull()
    expect(fuzzyScore('bugs', 'bug')).toBeNull()
  })

  it('returns null for an empty text but a neutral score for an empty query', () => {
    expect(fuzzyScore('bug', '')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
    expect(fuzzyScore('   ', 'anything')).toBe(0)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('BUG', 'fix bug')).toBe(fuzzyScore('bug', 'FIX BUG'))
    expect(fuzzyScore('BuG', 'fix bug')).not.toBeNull()
  })

  it('scores a contiguous hit above a scattered subsequence', () => {
    const contiguous = fuzzyScore('bug', 'a bug here')
    const scattered = fuzzyScore('bug', 'big ugly graph')

    expect(contiguous).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(contiguous!).toBeGreaterThan(scattered!)
  })

  it('prefers a start-of-string hit, then a start-of-word hit, then mid-word', () => {
    const atStart = fuzzyScore('bug', 'bug report')!
    const atWord = fuzzyScore('bug', 'fix bug')!
    const midWord = fuzzyScore('bug', 'debugger')!

    expect(atStart).toBeGreaterThan(atWord)
    expect(atWord).toBeGreaterThan(midWord)
  })

  it('prefers the denser of two matches', () => {
    expect(fuzzyScore('bug', 'bug')!).toBeGreaterThan(fuzzyScore('bug', 'bug in a very long title')!)
  })

  it('rewards contiguous runs inside a subsequence match', () => {
    // Neither is a substring, but 'ab' + 'cd' beats four scattered letters.
    const runs = fuzzyScore('abcd', 'abxcd')!
    const spread = fuzzyScore('abcd', 'axbxcxd')!
    expect(runs).toBeGreaterThan(spread)
  })
})

describe('rankConversations', () => {
  const rows = [
    { taskId: '10', title: 'Something with a bug' },
    { taskId: '11', title: 'Bug in the parser' },
    { taskId: '12', title: 'Completely unrelated' },
    { taskId: '13', title: null },
  ]

  it('returns every row untouched for an empty query', () => {
    expect(rankConversations('', rows)).toEqual(rows)
    expect(rankConversations('   ', rows)).toEqual(rows)
  })

  it('drops non-matching rows and ranks the best title hit first', () => {
    const ranked = rankConversations('bug', rows)
    expect(ranked.map((r) => r.taskId)).toEqual(['11', '10'])
  })

  it('is case-insensitive', () => {
    expect(rankConversations('BUG', rows).map((r) => r.taskId)).toEqual(['11', '10'])
  })

  it('matches the task id with and without the hash', () => {
    expect(rankConversations('12', rows).map((r) => r.taskId)).toEqual(['12'])
    expect(rankConversations('#12', rows).map((r) => r.taskId)).toEqual(['12'])
  })

  it('matches a row with no title on its task id alone', () => {
    expect(rankConversations('13', rows).map((r) => r.taskId)).toEqual(['13'])
  })

  it('returns nothing when nothing matches', () => {
    expect(rankConversations('zzzzz', rows)).toEqual([])
  })

  it('keeps the incoming order for equally scored rows', () => {
    const tied = [
      { taskId: 'a', title: 'same title' },
      { taskId: 'b', title: 'same title' },
    ]
    expect(rankConversations('same', tied).map((r) => r.taskId)).toEqual(['a', 'b'])
  })
})

describe('initials', () => {
  it('takes the first and last word initials', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('Jean Luc Picard')).toBe('JP')
  })

  it('falls back to the first two characters of a single word', () => {
    expect(initials('krisz')).toBe('KR')
  })

  it('handles blank input', () => {
    expect(initials('   ')).toBe('?')
  })
})
