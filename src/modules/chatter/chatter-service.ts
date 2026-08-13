// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasBus } from '@core/types'

// ─── Types ──────────────────────────────────────────────

export interface TrackingChange {
  field: string
  oldValue: string | null
  newValue: string | null
}

export interface ChatterMessage {
  id: string
  resModel: string
  resId: string
  authorId: string | null
  /** Resolved display name when available (users table / system labels). */
  authorName: string | null
  messageType: 'comment' | 'note' | 'tracking'
  body: string
  parentId: string | null
  tracking?: TrackingChange[]
  createdAt: string
}

export interface ChatterFollower {
  id: string
  resModel: string
  resId: string
  userId: string
  subtypes: string[]
  createdAt: string
}

export interface PostMessageInput {
  messageType: 'comment' | 'note'
  body: string
  authorId: string
  parentId?: string
}

export interface TrackingInput {
  changes: TrackingChange[]
  authorId: string
}

export interface ListOpts {
  messageType?: string
  limit?: number
  offset?: number
}

export interface ChatterService {
  postMessage(resModel: string, resId: string, input: PostMessageInput): ChatterMessage
  logTracking(resModel: string, resId: string, input: TrackingInput): ChatterMessage
  listMessages(resModel: string, resId: string, opts?: ListOpts): ChatterMessage[]
  addFollower(resModel: string, resId: string, userId: string, subtypes?: string[]): void
  removeFollower(resModel: string, resId: string, userId: string): void
  getFollowers(resModel: string, resId: string): ChatterFollower[]
}

// ─── Mappers ────────────────────────────────────────────

function resolveAuthorName(db: any, authorId: string | null): string | null {
  if (!authorId) return null
  if (authorId === 'user') return 'User'
  if (authorId === 'ai' || authorId === 'agent') return 'Agent'
  if (authorId === 'system') return 'System'
  try {
    const rows = db.all(
      sql`SELECT display_name, username FROM users WHERE id = ${authorId} LIMIT 1`,
    ) as Array<{ display_name: string | null; username: string | null }>
    if (rows.length > 0) {
      return rows[0].display_name || rows[0].username || authorId
    }
  } catch {
    // users table may be absent in isolated unit tests
  }
  return null
}

function toMessage(raw: any, authorName: string | null = null): ChatterMessage {
  return {
    id: raw.id,
    resModel: raw.res_model,
    resId: raw.res_id,
    authorId: raw.author_id ?? null,
    authorName,
    messageType: raw.message_type,
    body: raw.body,
    parentId: raw.parent_id ?? null,
    createdAt: raw.created_at,
  }
}

/** Runtime agent status — never surface as business history on the context rail. */
const RUNTIME_STATUS = new Set(['idle', 'working'])

function isRuntimeOnlyChange(c: TrackingChange): boolean {
  if (c.field !== 'status') return false
  const oldR = c.oldValue != null && RUNTIME_STATUS.has(c.oldValue)
  const newR = c.newValue != null && RUNTIME_STATUS.has(c.newValue)
  return oldR && newR
}

function toFollower(raw: any): ChatterFollower {
  return {
    id: raw.id,
    resModel: raw.res_model,
    resId: raw.res_id,
    userId: raw.user_id,
    subtypes: JSON.parse(raw.subtypes || '[]'),
    createdAt: raw.created_at,
  }
}

// ─── Service ────────────────────────────────────────────

export function createChatterService(db: any, bus: EyasBus): ChatterService {
  // Create tables
  db.run(sql`CREATE TABLE IF NOT EXISTS chatter_messages (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, author_id TEXT, message_type TEXT NOT NULL DEFAULT 'comment' CHECK (message_type IN ('comment', 'note', 'tracking')), body TEXT NOT NULL, parent_id TEXT REFERENCES chatter_messages(id) ON DELETE SET NULL, created_at TEXT DEFAULT (datetime('now')))`)
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_chatter_record ON chatter_messages(res_model, res_id, created_at)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS chatter_tracking (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL REFERENCES chatter_messages(id) ON DELETE CASCADE, field TEXT NOT NULL, old_value TEXT, new_value TEXT)`)
  db.run(sql`CREATE TABLE IF NOT EXISTS chatter_followers (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, user_id TEXT NOT NULL, subtypes TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')), UNIQUE(res_model, res_id, user_id))`)

  function getTrackingChanges(messageId: string): TrackingChange[] {
    const rows = db.all(sql`SELECT field, old_value, new_value FROM chatter_tracking WHERE message_id = ${messageId}`) as any[]
    return rows.map((r: any) => ({
      field: r.field,
      oldValue: r.old_value ?? null,
      newValue: r.new_value ?? null,
    }))
  }

  function getById(id: string): ChatterMessage | null {
    const rows = db.all(sql`SELECT * FROM chatter_messages WHERE id = ${id}`) as any[]
    if (rows.length === 0) return null
    const authorId = rows[0].author_id ?? null
    const msg = toMessage(rows[0], resolveAuthorName(db, authorId))
    if (msg.messageType === 'tracking') {
      msg.tracking = getTrackingChanges(msg.id)
    }
    return msg
  }

  const service: ChatterService = {
    postMessage(resModel: string, resId: string, input: PostMessageInput): ChatterMessage {
      const id = generateId()
      db.run(sql`INSERT INTO chatter_messages (id, res_model, res_id, author_id, message_type, body, parent_id)
        VALUES (${id}, ${resModel}, ${resId}, ${input.authorId}, ${input.messageType}, ${input.body}, ${input.parentId ?? null})`)
      return getById(id)!
    },

    logTracking(resModel: string, resId: string, input: TrackingInput): ChatterMessage {
      const changes = input.changes.filter(c => !isRuntimeOnlyChange(c))
      if (changes.length === 0) {
        // Return a synthetic empty result only if caller expects a message —
        // bus path never calls when filtered empty. Keep type safety for direct calls.
        const id = generateId()
        return {
          id,
          resModel,
          resId,
          authorId: input.authorId,
          authorName: resolveAuthorName(db, input.authorId),
          messageType: 'tracking',
          body: '',
          parentId: null,
          tracking: [],
          createdAt: new Date().toISOString(),
        }
      }

      const id = generateId()
      // Build human-readable body
      const lines = changes.map(c => `${c.field}: ${c.oldValue ?? '(empty)'} \u2192 ${c.newValue ?? '(empty)'}`)
      const body = lines.join('\n')

      db.run(sql`INSERT INTO chatter_messages (id, res_model, res_id, author_id, message_type, body)
        VALUES (${id}, ${resModel}, ${resId}, ${input.authorId}, 'tracking', ${body})`)

      for (const change of changes) {
        db.run(sql`INSERT INTO chatter_tracking (message_id, field, old_value, new_value)
          VALUES (${id}, ${change.field}, ${change.oldValue ?? null}, ${change.newValue ?? null})`)
      }

      return getById(id)!
    },

    listMessages(resModel: string, resId: string, opts?: ListOpts): ChatterMessage[] {
      const limit = opts?.limit ?? 100
      const offset = opts?.offset ?? 0

      // Newest first — activity-feed semantics for the context rail
      let rows: any[]
      if (opts?.messageType) {
        rows = db.all(sql`SELECT * FROM chatter_messages WHERE res_model = ${resModel} AND res_id = ${resId} AND message_type = ${opts.messageType} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM chatter_messages WHERE res_model = ${resModel} AND res_id = ${resId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`) as any[]
      }

      return rows.map((r: any) => {
        const msg = toMessage(r, resolveAuthorName(db, r.author_id ?? null))
        if (msg.messageType === 'tracking') {
          msg.tracking = getTrackingChanges(msg.id)
        }
        return msg
      })
    },

    addFollower(resModel: string, resId: string, userId: string, subtypes?: string[]): void {
      const id = generateId()
      const subtypesJson = JSON.stringify(subtypes ?? [])
      db.run(sql`INSERT OR IGNORE INTO chatter_followers (id, res_model, res_id, user_id, subtypes)
        VALUES (${id}, ${resModel}, ${resId}, ${userId}, ${subtypesJson})`)
    },

    removeFollower(resModel: string, resId: string, userId: string): void {
      db.run(sql`DELETE FROM chatter_followers WHERE res_model = ${resModel} AND res_id = ${resId} AND user_id = ${userId}`)
    },

    getFollowers(resModel: string, resId: string): ChatterFollower[] {
      const rows = db.all(sql`SELECT * FROM chatter_followers WHERE res_model = ${resModel} AND res_id = ${resId} ORDER BY created_at ASC`) as any[]
      return rows.map(toFollower)
    },
  }

  // Bus integration: auto-create tracking messages on record:updated
  bus.on('record:updated', async (data: unknown) => {
    const event = data as { resModel: string; resId: string; changes: TrackingChange[]; authorId: string }
    const changes = (event.changes ?? []).filter(c => !isRuntimeOnlyChange(c))
    if (changes.length > 0) {
      service.logTracking(event.resModel, event.resId, {
        changes,
        authorId: event.authorId,
      })
    }
  })

  return service
}
