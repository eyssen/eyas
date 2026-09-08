// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Board context at capture time (spec §3: project and task are structural,
// never inferred). Best-effort by design: the hooks run inside other
// modules' persistence paths and partial schemas exist (older installs,
// test fixtures), so every lookup degrades to null instead of throwing.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { effectiveProjectId } from '../types.js'

export interface ConversationScope {
  projectId: string | null
  projectTypeId: string | null
  userId: string | null
  agentId: string | null
  godMode: boolean
  parentConversationId: string | null
}

const EMPTY: ConversationScope = {
  projectId: null, projectTypeId: null, userId: null, agentId: null, godMode: false, parentConversationId: null,
}

interface WideRow {
  project_id: string | null
  user_id?: string | null
  agent_id?: string | null
  god_mode?: number | null
  parent_conversation_id?: string | null
}

export function resolveConversationScope(db: EyasDb, conversationId: string): ConversationScope {
  let row: WideRow | undefined
  try {
    row = db.all<WideRow>(sql`SELECT project_id, user_id, agent_id, god_mode, parent_conversation_id
      FROM conversations WHERE id = ${conversationId}`)[0]
  } catch {
    try {
      row = db.all<WideRow>(sql`SELECT project_id FROM conversations WHERE id = ${conversationId}`)[0]
    } catch {
      return { ...EMPTY }
    }
  }
  if (!row) return { ...EMPTY }
  const projectId = effectiveProjectId(row.project_id ?? null)
  let projectTypeId: string | null = null
  if (projectId) {
    try {
      projectTypeId = db.all<{ type_id: string | null }>(sql`SELECT type_id FROM projects WHERE id = ${projectId}`)[0]?.type_id ?? null
    } catch {
      projectTypeId = null
    }
  }
  return {
    projectId,
    projectTypeId,
    userId: row.user_id ?? null,
    agentId: row.agent_id ?? null,
    godMode: Number(row.god_mode ?? 0) === 1,
    parentConversationId: row.parent_conversation_id ?? null,
  }
}
