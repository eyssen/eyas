// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { BoardConversation } from '@/stores/board-store'

/**
 * Board tag filter key is the tag id. Junction `tagIds` win when present so a
 * project + area/module tag slice does not need a nested project.
 */
export function conversationHasBoardTag(conv: BoardConversation, tagId: string): boolean {
  if (conv.tagIds && conv.tagIds.length > 0) return conv.tagIds.includes(tagId)
  return conv.tags.includes(tagId)
}
