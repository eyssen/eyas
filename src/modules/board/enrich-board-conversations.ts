// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { ConversationWithCount } from '@modules/conversations/conversation-service'
import {
  loadConversationContext,
  type ConversationContextFields,
} from '@modules/conversations/context-occupancy.js'
import { resolveContextWindow } from '@modules/conversations/context-window.js'

/** Board kanban payload extras beyond the conversation row. */
export type BoardConversationDto = ConversationWithCount & {
  agentName: string | null
  childCount: number
  childrenDone: number
} & ConversationContextFields

/**
 * Attach agent display names, subtask progress, and the same context
 * occupancy inputs the conversation header uses (composed size + model
 * window). Uses lightweight bulk reads — suitable for typical kanban sizes.
 */
export function enrichBoardConversations(db: any, list: ConversationWithCount[]): BoardConversationDto[] {
  if (list.length === 0) return []

  const parentIds = new Set(list.map((c) => c.id))
  const agentIds = [...new Set(list.map((c) => c.agentId).filter((id): id is string => Boolean(id)))]

  const agentNames = new Map<string, string>()
  if (agentIds.length > 0) {
    try {
      const rows = db.all(sql`SELECT id, name FROM agent_definitions`) as Array<{ id: string; name: string }>
      for (const r of rows) {
        if (agentIds.includes(r.id)) agentNames.set(r.id, r.name)
      }
    } catch {
      // agent_definitions may be absent in isolated tests
    }
  }

  const closedStages = new Set<string>()
  try {
    const stages = db.all(sql`SELECT id FROM stages WHERE is_closed = 1`) as Array<{ id: string }>
    for (const s of stages) closedStages.add(s.id)
  } catch {
    /* stages table missing in some tests */
  }

  const childTotal = new Map<string, number>()
  const childDone = new Map<string, number>()
  try {
    const children = db.all(
      sql`SELECT parent_conversation_id, status, stage_id FROM conversations WHERE parent_conversation_id IS NOT NULL AND status != 'deleted'`,
    ) as Array<{ parent_conversation_id: string; status: string; stage_id: string | null }>
    for (const ch of children) {
      const pid = ch.parent_conversation_id
      if (!parentIds.has(pid)) continue
      childTotal.set(pid, (childTotal.get(pid) ?? 0) + 1)
      const done =
        ch.status === 'archived' ||
        (ch.stage_id != null && closedStages.has(ch.stage_id))
      if (done) childDone.set(pid, (childDone.get(pid) ?? 0) + 1)
    }
  } catch {
    /* ignore */
  }

  const occupancy = loadConversationContext(db, list)

  return list.map((c) => {
    const ctx = occupancy.get(c.id) ?? {
      estimatedTokens: null,
      contextWindow: resolveContextWindow(null, c.providerId),
    }
    return {
      ...c,
      agentName: c.agentId ? (agentNames.get(c.agentId) ?? null) : null,
      childCount: childTotal.get(c.id) ?? 0,
      childrenDone: childDone.get(c.id) ?? 0,
      ...ctx,
    }
  })
}
