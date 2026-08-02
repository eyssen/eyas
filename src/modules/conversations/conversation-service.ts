// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasBus } from '@core/types'

export interface Conversation {
  id: string
  taskId: string
  title: string | null
  status: string
  providerId: string | null
  modelId: string | null
  userId: string
  tokensUsed: number
  projectId: string | null
  stageId: string | null
  priority: string
  pinned: boolean
  position: number
  dueDate: string | null
  prompt: string | null
  sdkSessionId: string | null
  assignees: string[]
  tags: string[]
  mode: string
  agentId: string | null
  parentConversationId: string | null
  goalDescription: string | null
  complexity: string | null
  totalCostUsd: number
  teamSessionId: string | null
  thinking: 'off' | 'on' | 'auto'
  thinkingBudget: number | null
  effort: 'low' | 'medium' | 'high' | 'max' | null
  orchestration: 'solo' | 'auto' | 'deep'
  createdAt: string
  updatedAt: string
}

// Safe charset: excludes 0/O, 1/l/I/i — 29 characters
const TASK_ID_CHARSET = '23456789abcdefghjkmnpqrstvwxyz'
const TASK_ID_LENGTH = 8

export function generateTaskId(): string {
  const bytes = new Uint8Array(TASK_ID_LENGTH)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < TASK_ID_LENGTH; i++) {
    id += TASK_ID_CHARSET[bytes[i] % TASK_ID_CHARSET.length]
  }
  return id
}

export interface ConversationMessage {
  id: number
  conversationId: string
  role: string
  content: string
  model: string | null
  provider: string | null
  tokensIn: number
  tokensOut: number
  attachmentIds: string[]
  createdAt: string
}

export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[]
}

export interface CreateConversationInput {
  userId: string
  title?: string
  providerId?: string
  modelId?: string
}

export interface AddMessageInput {
  role: string
  content: string
  model?: string
  provider?: string
  tokensIn?: number
  tokensOut?: number
  attachmentIds?: string[]
}

export interface ConversationWithCount extends Conversation {
  messageCount: number
}

export interface CreateSubConversationInput {
  title: string
  goalDescription: string
  parentConversationId: string
  agentId?: string
  /**
   * Status the child is created with. Default 'idle' — the delegation path runs
   * the child inline and must NOT leave a row a background picker could claim
   * as well. Pass 'waiting' for an async handoff (`assign_task`), where the
   * bot-executor is the intended runner.
   */
  initialStatus?: 'idle' | 'waiting'
}

/** Everything a caller may write on an existing conversation. */
export interface ConversationUpdate {
  title?: string
  status?: string
  providerId?: string
  modelId?: string
  projectId?: string
  stageId?: string
  priority?: string
  pinned?: boolean
  position?: number
  dueDate?: string | null
  prompt?: string | null
  sdkSessionId?: string | null
  assignees?: string[]
  tags?: string[]
  mode?: string
  agentId?: string | null
  parentConversationId?: string | null
  goalDescription?: string | null
  complexity?: string | null
  totalCostUsd?: number
  teamSessionId?: string | null
  thinking?: string
  thinkingBudget?: number | null
  effort?: string | null
  orchestration?: string
  voiceScopeOverride?: 'internal' | 'external' | null
}

interface UpdateFieldSpec {
  column: string
  serialize?: (v: unknown) => unknown
  /** 'in' = write even when the value is undefined-in-payload (null-clearing). Default: skip undefined. */
  presence?: 'defined' | 'in'
}

/**
 * The single source of truth for "which payload field writes which column".
 *
 * `satisfies Record<keyof ConversationUpdate, UpdateFieldSpec>` is the point of
 * the whole construct: adding a field to ConversationUpdate without a row here
 * (or a row here without a field) is a COMPILE error. update() was previously a
 * hand-written if-chain, and the field it forgot (teamSessionId) was accepted
 * from callers and silently dropped for as long as it existed.
 */
export const UPDATE_FIELD_MAP = {
  title: { column: 'title' },
  status: { column: 'status' },
  providerId: { column: 'provider_id' },
  modelId: { column: 'model_id' },
  projectId: { column: 'project_id' },
  stageId: { column: 'stage_id' },
  priority: { column: 'priority' },
  pinned: { column: 'pinned', serialize: (v: unknown) => (v ? 1 : 0) },
  position: { column: 'position' },
  dueDate: { column: 'due_date' },
  prompt: { column: 'prompt' },
  sdkSessionId: { column: 'sdk_session_id' },
  assignees: { column: 'assignees', serialize: (v: unknown) => JSON.stringify(v) },
  tags: { column: 'tags', serialize: (v: unknown) => JSON.stringify(v) },
  mode: { column: 'mode' },
  agentId: { column: 'agent_id' },
  parentConversationId: { column: 'parent_conversation_id' },
  goalDescription: { column: 'goal_description' },
  complexity: { column: 'complexity' },
  totalCostUsd: { column: 'total_cost_usd' },
  teamSessionId: { column: 'team_session_id' },
  thinking: { column: 'thinking' },
  thinkingBudget: { column: 'thinking_budget' },
  effort: { column: 'effort' },
  orchestration: { column: 'orchestration' },
  // Presence-based: `{ voiceScopeOverride: null }` clears the override, while an
  // omitted key leaves the stored value alone.
  voiceScopeOverride: { column: 'voice_scope_override', presence: 'in', serialize: (v: unknown) => v ?? null },
} satisfies Record<keyof ConversationUpdate, UpdateFieldSpec>

/**
 * F2 T9 (R1/R7) — the ONLY writer of `conversations.total_cost_usd`. `tokens`
 * is optional and additionally increments `tokens_used`: pass it ONLY from a
 * caller that does not already track tokens via `addMessage`'s tokensIn/
 * tokensOut (background/team/delegation runs never call addMessage with
 * those) — the interactive chat route already increments tokens_used through
 * addMessage and must omit `tokens` here, or the same turn would be double-
 * counted. A no-op cost (0 and no tokens) skips the write entirely.
 */
export interface RunCost {
  costUsd: number
  tokens?: number
}

export interface ConversationService {
  create(input: CreateConversationInput): Conversation
  createSubConversation(input: CreateSubConversationInput): Conversation
  list(userId: string, options?: { excludeArchived?: boolean; status?: string }): Conversation[]
  get(id: string): ConversationWithMessages | null
  update(id: string, update: ConversationUpdate): void
  addMessage(conversationId: string, input: AddMessageInput): ConversationMessage
  addRunCost(id: string, cost: RunCost): void
  softDelete(id: string): void
  listByProject(projectId: string, stageId: string, userId?: string): ConversationWithCount[]
  /** All projects for a stage (board "All" view). Root conversations only. */
  listByStage(stageId: string, userId?: string): ConversationWithCount[]
  getChildren(parentId: string): ConversationWithCount[]
  getAncestry(conversationId: string): Conversation[]
  /**
   * D14 — does `userId` own this conversation? Orchestrator/executeAgent
   * child conversations (team + delegation runs) are stamped with
   * `userId: 'system'` (F0 R4 — nobody is directly at the keyboard), so a
   * direct `conv.userId === userId` check would read every such run as
   * foreign to its actual human owner. Walks the parent chain for the
   * NEAREST non-'system' owner instead — same semantics as
   * session-registry-adapter.ts's resolveOwnerUserId. Unresolvable (no such
   * conversation, or every ancestor is 'system') → false, fail-closed.
   */
  ownsConversation(conversationId: string, userId: string): boolean
}

/** Sentinel userId the orchestrator/executeAgent stamp onto team/delegation child conversations (F0 R4). */
const SYSTEM_OWNER = 'system'

/**
 * F2 T9 — standalone form of the single-writer increment, for callers that
 * hold a raw `db` handle rather than a full ConversationService instance
 * (conversation-runner.ts already writes to the `conversations` table
 * directly via `db`, same as this). `createConversationService`'s
 * `addRunCost` method delegates here, so there is exactly one SQL shape that
 * ever touches this column.
 */
export function addRunCost(db: any, conversationId: string, cost: RunCost): void {
  if (!cost.costUsd && !cost.tokens) return
  const now = new Date().toISOString()
  if (cost.tokens) {
    db.run(sql`UPDATE conversations SET tokens_used = tokens_used + ${cost.tokens}, total_cost_usd = total_cost_usd + ${cost.costUsd}, updated_at = ${now} WHERE id = ${conversationId}`)
  } else {
    db.run(sql`UPDATE conversations SET total_cost_usd = total_cost_usd + ${cost.costUsd}, updated_at = ${now} WHERE id = ${conversationId}`)
  }
}

function toConversation(raw: any): Conversation {
  return {
    id: raw.id,
    taskId: raw.task_id ?? '',
    title: raw.title,
    status: raw.status,
    providerId: raw.provider_id,
    modelId: raw.model_id,
    userId: raw.user_id,
    tokensUsed: raw.tokens_used,
    projectId: raw.project_id ?? null,
    stageId: raw.stage_id ?? null,
    priority: raw.priority ?? 'normal',
    pinned: raw.pinned === 1,
    position: raw.position ?? 0,
    dueDate: raw.due_date ?? null,
    prompt: raw.prompt ?? null,
    sdkSessionId: raw.sdk_session_id ?? null,
    assignees: raw.assignees ? JSON.parse(raw.assignees) : [],
    tags: raw.tags ? JSON.parse(raw.tags) : [],
    mode: raw.mode ?? 'simple',
    agentId: raw.agent_id ?? null,
    parentConversationId: raw.parent_conversation_id ?? null,
    goalDescription: raw.goal_description ?? null,
    complexity: raw.complexity ?? null,
    totalCostUsd: raw.total_cost_usd ?? 0,
    teamSessionId: raw.team_session_id ?? null,
    thinking: raw.thinking ?? 'off',
    thinkingBudget: raw.thinking_budget ?? null,
    effort: raw.effort ?? null,
    orchestration: raw.orchestration ?? 'auto',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function toMessage(raw: any): ConversationMessage {
  return {
    id: raw.id,
    conversationId: raw.conversation_id,
    role: raw.role,
    content: raw.content,
    model: raw.model,
    provider: raw.provider,
    tokensIn: raw.tokens_in ?? 0,
    tokensOut: raw.tokens_out ?? 0,
    attachmentIds: raw.attachments ? JSON.parse(raw.attachments) : [],
    createdAt: raw.created_at,
  }
}

/** Business statuses that belong on the context-rail history. Runtime idle/working are excluded. */
const CHATTER_BUSINESS_STATUS = new Set(['archived', 'deleted', 'waiting_approval', 'waiting'])

/**
 * Resolve stage/project IDs to human-readable names for chatter display.
 * Lifecycle bus events keep raw IDs separately — this is only for record:updated.
 */
function resolveTrackingLabel(db: any, field: string, value: string | null): string | null {
  if (value == null || value === '') return null
  if (field === 'stage') {
    const rows = db.all(sql`SELECT name FROM stages WHERE id = ${value}`) as Array<{ name: string }>
    return rows[0]?.name ?? value
  }
  if (field === 'project') {
    const rows = db.all(sql`SELECT name FROM projects WHERE id = ${value}`) as Array<{ name: string }>
    return rows[0]?.name ?? value
  }
  return value
}

/**
 * Filter runtime noise and attach display labels for the context-rail timeline.
 * Exported for unit tests.
 */
export function toChatterChanges(
  db: any,
  rawChanges: { field: string; oldValue: string | null; newValue: string | null }[],
): { field: string; oldValue: string | null; newValue: string | null }[] {
  const out: { field: string; oldValue: string | null; newValue: string | null }[] = []
  for (const ch of rawChanges) {
    if (ch.field === 'status') {
      const oldBiz = ch.oldValue != null && CHATTER_BUSINESS_STATUS.has(ch.oldValue)
      const newBiz = ch.newValue != null && CHATTER_BUSINESS_STATUS.has(ch.newValue)
      if (!oldBiz && !newBiz) continue
    }
    out.push({
      field: ch.field,
      oldValue: resolveTrackingLabel(db, ch.field, ch.oldValue),
      newValue: resolveTrackingLabel(db, ch.field, ch.newValue),
    })
  }
  return out
}

export function createConversationService(db: any, bus?: EyasBus): ConversationService {
  return {
    create(input: CreateConversationInput): Conversation {
      const id = generateId()
      const now = new Date().toISOString()
      let taskId = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        taskId = generateTaskId()
        try {
          db.run(sql`INSERT INTO conversations (id, task_id, title, status, provider_id, model_id, user_id, tokens_used, created_at, updated_at)
            VALUES (${id}, ${taskId}, ${input.title ?? null}, 'idle', ${input.providerId ?? null}, ${input.modelId ?? null}, ${input.userId}, 0, ${now}, ${now})`)
          break
        } catch (err: any) {
          if (attempt === 2 || !err.message?.includes('UNIQUE')) throw err
        }
      }
      return { id, taskId, title: input.title ?? null, status: 'idle', providerId: input.providerId ?? null, modelId: input.modelId ?? null, userId: input.userId, tokensUsed: 0, projectId: null, stageId: null, priority: 'normal', pinned: false, position: 0, dueDate: null, prompt: null, sdkSessionId: null, assignees: [], tags: [], mode: 'simple', agentId: null, parentConversationId: null, goalDescription: null, complexity: null, totalCostUsd: 0, teamSessionId: null, thinking: 'off', thinkingBudget: null, effort: null, orchestration: 'auto' as const, createdAt: now, updatedAt: now }
    },

    createSubConversation(input: CreateSubConversationInput): Conversation {
      // Look up the parent to inherit userId, projectId, stageId
      const parentRows = db.all(sql`SELECT * FROM conversations WHERE id = ${input.parentConversationId}`) as any[]
      if (parentRows.length === 0) {
        throw new Error(`Parent conversation not found: ${input.parentConversationId}`)
      }
      const parent = toConversation(parentRows[0])

      const id = generateId()
      const now = new Date().toISOString()
      const status = input.initialStatus ?? 'idle'
      let taskId = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        taskId = generateTaskId()
        try {
          // D7: a sub-conversation belongs to the same team session as its
          // parent — inherited at INSERT so a subagent's tools resolve the team
          // without a second write that could be lost.
          //
          // mode 'managed', not 'agent': 'agent' was outside the ConversationMode
          // union and consumed nowhere, so every sub-conversation was invisible
          // to the bot-executor's `mode IN ('managed','autonomous')` scan (D11).
          db.run(sql`INSERT INTO conversations (id, task_id, title, status, provider_id, model_id, user_id, tokens_used, project_id, stage_id, mode, agent_id, parent_conversation_id, goal_description, team_session_id, created_at, updated_at)
            VALUES (${id}, ${taskId}, ${input.title}, ${status}, ${parent.providerId}, ${parent.modelId}, ${parent.userId}, 0, ${parent.projectId}, ${parent.stageId}, 'managed', ${input.agentId ?? null}, ${input.parentConversationId}, ${input.goalDescription}, ${parent.teamSessionId}, ${now}, ${now})`)
          break
        } catch (err: any) {
          if (attempt === 2 || !err.message?.includes('UNIQUE')) throw err
        }
      }

      const conv: Conversation = {
        id, taskId, title: input.title, status,
        providerId: parent.providerId, modelId: parent.modelId,
        userId: parent.userId, tokensUsed: 0,
        projectId: parent.projectId, stageId: parent.stageId,
        priority: 'normal', pinned: false, position: 0,
        dueDate: null, prompt: null, sdkSessionId: null,
        assignees: [], tags: [], mode: 'managed',
        agentId: input.agentId ?? null,
        parentConversationId: input.parentConversationId,
        goalDescription: input.goalDescription,
        complexity: null, totalCostUsd: 0,
        teamSessionId: parent.teamSessionId,
        thinking: 'off', thinkingBudget: null, effort: null, orchestration: 'auto' as const,
        createdAt: now, updatedAt: now,
      }

      if (bus) {
        bus.emit('eyas.conversation.sub_created', { conversationId: input.parentConversationId, childConversationId: id })
      }

      return conv
    },

    list(userId: string, options?: { excludeArchived?: boolean; status?: string }): Conversation[] {
      // Only return root-level conversations (parent_conversation_id IS NULL)
      // Sub-conversations are accessed via getChildren()
      let rows: any[]
      if (options?.status) {
        rows = db.all(sql`SELECT * FROM conversations WHERE user_id = ${userId} AND status = ${options.status} AND parent_conversation_id IS NULL ORDER BY updated_at DESC`) as any[]
      } else if (options?.excludeArchived) {
        rows = db.all(sql`SELECT * FROM conversations WHERE user_id = ${userId} AND status NOT IN ('deleted', 'archived') AND parent_conversation_id IS NULL ORDER BY updated_at DESC`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM conversations WHERE user_id = ${userId} AND status != 'deleted' AND parent_conversation_id IS NULL ORDER BY updated_at DESC`) as any[]
      }
      return rows.map(toConversation)
    },

    get(id: string): ConversationWithMessages | null {
      const rows = db.all(sql`SELECT * FROM conversations WHERE id = ${id}`) as any[]
      if (rows.length === 0) return null
      const conv = toConversation(rows[0])
      const msgRows = db.all(sql`SELECT * FROM conversation_messages WHERE conversation_id = ${id} ORDER BY id ASC`) as any[]
      return { ...conv, messages: msgRows.map(toMessage) }
    },

    update(id: string, update: ConversationUpdate): void {
      const now = new Date().toISOString()

      // Capture raw field diffs before write. Lifecycle events need IDs;
      // chatter gets a filtered + display-resolved subset (see below).
      const tracked: { field: string; key: keyof ConversationUpdate; dbKey: string }[] = [
        { field: 'status', key: 'status', dbKey: 'status' },
        { field: 'stage', key: 'stageId', dbKey: 'stage_id' },
        { field: 'priority', key: 'priority', dbKey: 'priority' },
        { field: 'project', key: 'projectId', dbKey: 'project_id' },
        { field: 'dueDate', key: 'dueDate', dbKey: 'due_date' },
      ]
      let rawChanges: { field: string; oldValue: string | null; newValue: string | null }[] = []
      if (bus) {
        const rows = db.all(sql`SELECT status, stage_id, priority, project_id, due_date FROM conversations WHERE id = ${id}`) as any[]
        if (rows.length > 0) {
          const current = rows[0]
          for (const t of tracked) {
            const newVal = update[t.key]
            if (newVal !== undefined) {
              const next = newVal === null ? null : String(newVal)
              const prev = current[t.dbKey] ?? null
              if (next !== prev) {
                rawChanges.push({ field: t.field, oldValue: prev, newValue: next })
              }
            }
          }
        }
      }

      // One statement per supplied field, driven by UPDATE_FIELD_MAP.
      // sql.raw on the column name is SAFE here and ONLY here: `spec.column` is
      // a literal from the compile-time map above, never anything derived from
      // caller input. Any change that computes a column from a payload value
      // turns this into SQL injection and must be rejected in review.
      for (const [key, spec] of Object.entries(UPDATE_FIELD_MAP) as [keyof ConversationUpdate, UpdateFieldSpec][]) {
        const supplied = spec.presence === 'in' ? key in update : update[key] !== undefined
        if (!supplied) continue
        const value = spec.serialize ? spec.serialize(update[key]) : update[key]
        db.run(sql`UPDATE conversations SET ${sql.raw(spec.column)} = ${value}, updated_at = ${now} WHERE id = ${id}`)
      }

      if (bus && rawChanges.length > 0) {
        // Context-rail tracking: business history only (not agent runtime).
        const chatterChanges = toChatterChanges(db, rawChanges)
        if (chatterChanges.length > 0) {
          bus.emit('record:updated', {
            resModel: 'conversation',
            resId: id,
            changes: chatterChanges,
            authorId: 'user',
          })
        }

        // Drive document retention lifecycle: when a conversation moves stages
        // or is closed/archived, downstream (documents module) applies the local
        // file retention window. Without these emissions retain_local_until stays
        // NULL forever and synced local files are never reclaimed.
        // Use raw IDs (not display labels) for stage_changed consumers.
        for (const ch of rawChanges) {
          if (ch.field === 'stage') {
            bus.emit('eyas.conversations.stage_changed', {
              conversationId: id,
              fromStageId: ch.oldValue,
              toStageId: ch.newValue,
            })
          } else if (ch.field === 'status' && (ch.newValue === 'archived' || ch.newValue === 'deleted')) {
            bus.emit('eyas.conversations.closed', { conversationId: id, status: ch.newValue })
          }
        }
      }
    },

    addMessage(conversationId: string, input: AddMessageInput): ConversationMessage {
      const now = new Date().toISOString()
      const tokensIn = input.tokensIn ?? 0
      const tokensOut = input.tokensOut ?? 0
      const attachmentsJson = JSON.stringify(input.attachmentIds ?? [])
      db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, model, provider, tokens_in, tokens_out, attachments, created_at)
        VALUES (${conversationId}, ${input.role}, ${input.content}, ${input.model ?? null}, ${input.provider ?? null}, ${tokensIn}, ${tokensOut}, ${attachmentsJson}, ${now})`)
      const rows = db.all(sql`SELECT * FROM conversation_messages WHERE conversation_id = ${conversationId} ORDER BY id DESC LIMIT 1`) as any[]
      const totalTokens = tokensIn + tokensOut
      if (totalTokens > 0) {
        db.run(sql`UPDATE conversations SET tokens_used = tokens_used + ${totalTokens}, updated_at = ${now} WHERE id = ${conversationId}`)
      }
      return toMessage(rows[0])
    },

    addRunCost(id: string, cost: RunCost): void {
      addRunCost(db, id, cost)
    },

    softDelete(id: string): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE conversations SET status = 'deleted', updated_at = ${now} WHERE id = ${id}`)
      // A soft-deleted conversation is closed: let document retention reclaim
      // its local attachments after the short close-window.
      if (bus) {
        bus.emit('eyas.conversations.closed', { conversationId: id, status: 'deleted' })
      }
    },

    listByProject(projectId: string, stageId: string, userId?: string): ConversationWithCount[] {
      // Conversations are private per-user (mirrors the ownership checks on the
      // direct conversation routes). When a userId is supplied, scope the board
      // query to that user so one user's cards never leak onto another's board.
      // Root only: sub-conversations belong to the team tree, not the kanban.
      const rows = (userId !== undefined
        ? db.all(sql`SELECT c.*, (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count FROM conversations c WHERE c.project_id = ${projectId} AND c.stage_id = ${stageId} AND c.user_id = ${userId} AND c.parent_conversation_id IS NULL AND c.status != 'deleted' ORDER BY c.position ASC`)
        : db.all(sql`SELECT c.*, (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count FROM conversations c WHERE c.project_id = ${projectId} AND c.stage_id = ${stageId} AND c.parent_conversation_id IS NULL AND c.status != 'deleted' ORDER BY c.position ASC`)) as any[]
      return rows.map(r => ({ ...toConversation(r), messageCount: r.message_count ?? 0 }))
    },

    listByStage(stageId: string, userId?: string): ConversationWithCount[] {
      const rows = (userId !== undefined
        ? db.all(sql`SELECT c.*, (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count FROM conversations c WHERE c.stage_id = ${stageId} AND c.user_id = ${userId} AND c.parent_conversation_id IS NULL AND c.status != 'deleted' ORDER BY c.position ASC, c.updated_at DESC`)
        : db.all(sql`SELECT c.*, (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count FROM conversations c WHERE c.stage_id = ${stageId} AND c.parent_conversation_id IS NULL AND c.status != 'deleted' ORDER BY c.position ASC, c.updated_at DESC`)) as any[]
      return rows.map(r => ({ ...toConversation(r), messageCount: r.message_count ?? 0 }))
    },

    getChildren(parentId: string): ConversationWithCount[] {
      const rows = db.all(sql`SELECT c.*, (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count FROM conversations c WHERE c.parent_conversation_id = ${parentId} AND c.status != 'deleted' ORDER BY c.created_at ASC`) as any[]
      return rows.map(r => ({ ...toConversation(r), messageCount: r.message_count ?? 0 }))
    },

    getAncestry(conversationId: string): Conversation[] {
      const chain: Conversation[] = []
      const visited = new Set<string>()
      let currentId: string | null = conversationId
      while (currentId) {
        if (visited.has(currentId)) break // cycle guard
        visited.add(currentId)
        const rows = db.all(sql`SELECT * FROM conversations WHERE id = ${currentId}`) as any[]
        if (rows.length === 0) break
        const conv = toConversation(rows[0])
        chain.unshift(conv)
        currentId = conv.parentConversationId
      }
      return chain
    },

    ownsConversation(conversationId: string, userId: string): boolean {
      const chain = this.getAncestry(conversationId) // root-first, queried conversation last
      for (let i = chain.length - 1; i >= 0; i--) {
        const owner = chain[i].userId
        if (owner && owner !== SYSTEM_OWNER) return owner === userId
      }
      return false
    },
  }
}
