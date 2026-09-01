import { describe, it, expect } from 'vitest'
import { conversationHasBoardTag } from '../../src/web/src/pages/board/board-filter-utils'
import type { BoardConversation } from '../../src/web/src/stores/board-store'

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

describe('conversationHasBoardTag', () => {
  it('matches the junction tag id when tagIds are present', () => {
    const card = conv({ id: 'c1', tags: ['alpha'], tagIds: ['tag-area-alpha'] })
    expect(conversationHasBoardTag(card, 'tag-area-alpha')).toBe(true)
    expect(conversationHasBoardTag(card, 'tag-area-bravo')).toBe(false)
    // Display names are not the filter key.
    expect(conversationHasBoardTag(card, 'alpha')).toBe(false)
  })

  it('falls back to the JSON tags column when the junction is empty', () => {
    const card = conv({ id: 'c1', tags: ['tag-area-alpha'] })
    expect(conversationHasBoardTag(card, 'tag-area-alpha')).toBe(true)
    expect(conversationHasBoardTag(card, 'tag-area-bravo')).toBe(false)
  })
})
