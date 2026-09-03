// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { escapeFtsQuery } from '../schema.js'

export const CONVERSATION_FTS_CLIP = 4_000
export const CONVERSATION_FTS_BATCH = 500

export interface ConversationFtsHit {
  messageId: number
  conversationId: string
  title: string | null
  role: string
  body: string
  score: number
}

export interface ConversationFtsSearchOpts {
  limit: number
  projectId?: string | null
  scope?: 'current' | 'all'
  excludeConversationId?: string | null
  /** When true, `query` is already an FTS5 MATCH expression (do not AND-escape). */
  escaped?: boolean
}

export interface ConversationFtsBackfillResult {
  done: boolean
  lastRowId: number
  indexed: number
}

const GENERAL_PROJECT_ID = 'general-general'
const INDEXED_ROLES = "('user','assistant')" as const

function tableExists(db: EyasDb, name: string): boolean {
  const rows = (db as any).all(
    sql`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ${name} LIMIT 1`,
  ) as Array<{ ok: number }>
  return rows.length > 0
}

function createConversationFtsTable(db: EyasDb): void {
  try {
    db.run(sql.raw(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      body,
      content='conversation_messages',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    )`))
  } catch {
    db.run(sql`DROP TABLE IF EXISTS conversation_fts`)
    db.run(sql.raw(`CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
      body,
      content='conversation_messages',
      content_rowid='rowid',
      tokenize='unicode61'
    )`))
  }
}

function createConversationFtsTriggers(db: EyasDb): void {
  const clip = String(CONVERSATION_FTS_CLIP)
  db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS conversation_fts_ai
    AFTER INSERT ON conversation_messages
    WHEN new.role IN ${INDEXED_ROLES}
    BEGIN
      INSERT INTO conversation_fts(rowid, body)
        VALUES (new.rowid, substr(new.content, 1, ${clip}));
    END`))
  db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS conversation_fts_ad
    AFTER DELETE ON conversation_messages
    WHEN old.role IN ${INDEXED_ROLES}
    BEGIN
      INSERT INTO conversation_fts(conversation_fts, rowid, body)
        VALUES ('delete', old.rowid, substr(old.content, 1, ${clip}));
    END`))
  // Delete only previously indexed rows — an FTS5 'delete' of a never-indexed
  // rowid corrupts the external-content index.
  db.run(sql.raw(`CREATE TRIGGER IF NOT EXISTS conversation_fts_au
    AFTER UPDATE ON conversation_messages
    WHEN old.role IN ${INDEXED_ROLES} OR new.role IN ${INDEXED_ROLES}
    BEGIN
      INSERT INTO conversation_fts(conversation_fts, rowid, body)
        SELECT 'delete', old.rowid, substr(old.content, 1, ${clip})
        WHERE old.role IN ${INDEXED_ROLES};
      INSERT INTO conversation_fts(rowid, body)
        SELECT new.rowid, substr(new.content, 1, ${clip})
        WHERE new.role IN ${INDEXED_ROLES};
    END`))
}

export function ensureConversationFts(db: EyasDb): void {
  if (!tableExists(db, 'conversation_messages')) return
  createConversationFtsTable(db)
  createConversationFtsTriggers(db)
}

export function backfillConversationFts(
  db: EyasDb,
  opts?: { afterRowId?: number; limit?: number },
): ConversationFtsBackfillResult {
  const afterRowId = opts?.afterRowId ?? 0
  const limit = Math.max(0, Math.floor(opts?.limit ?? CONVERSATION_FTS_BATCH))
  if (limit === 0 || !tableExists(db, 'conversation_messages') || !tableExists(db, 'conversation_fts')) {
    return { done: true, lastRowId: afterRowId, indexed: 0 }
  }

  const clip = String(CONVERSATION_FTS_CLIP)
  const after = Number(afterRowId)
  // External-content FTS5 cannot `SELECT rowid FROM conversation_fts` without
  // MATCH — the FTS column is `body`, which conversation_messages does not
  // have. `_docsize.id` is the indexed docid list.
  const candidates = (db as any).all(sql.raw(`
    SELECT rowid AS rowid FROM conversation_messages
    WHERE role IN ${INDEXED_ROLES}
      AND rowid > ${after}
      AND rowid NOT IN (SELECT id FROM conversation_fts_docsize)
    ORDER BY rowid
    LIMIT ${limit}
  `)) as Array<{ rowid: number }>

  if (candidates.length === 0) {
    return { done: true, lastRowId: afterRowId, indexed: 0 }
  }

  const lastRowId = Number(candidates[candidates.length - 1].rowid)
  db.run(sql.raw(`INSERT INTO conversation_fts(rowid, body)
    SELECT rowid, substr(content, 1, ${clip})
    FROM conversation_messages
    WHERE role IN ${INDEXED_ROLES}
      AND rowid > ${after}
      AND rowid <= ${lastRowId}
      AND rowid NOT IN (SELECT id FROM conversation_fts_docsize)`))

  return {
    indexed: candidates.length,
    lastRowId,
    done: candidates.length < limit,
  }
}

export function ftsConversation(
  db: EyasDb,
  query: string,
  opts: ConversationFtsSearchOpts,
): ConversationFtsHit[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const fts = opts.escaped ? trimmed : escapeFtsQuery(trimmed)
  if (!fts || fts === '""') return []

  const limit = Math.max(0, Math.floor(opts.limit))
  if (limit === 0) return []
  const clip = String(CONVERSATION_FTS_CLIP)

  let extra = sql``
  if (opts.excludeConversationId) {
    extra = sql`${extra} AND m.conversation_id != ${opts.excludeConversationId}`
  }
  // Only `current` applies D1/D2. Omitted scope and `all` stay unfiltered
  // (HTTP diagnostic, same as vaultNoteInScope). Deleted + exclude still apply.
  if (opts.scope === 'current') {
    if (opts.projectId) {
      extra = sql`${extra} AND c.project_id = ${opts.projectId}`
    } else {
      extra = sql`${extra} AND (c.project_id IS NULL OR c.project_id = ${GENERAL_PROJECT_ID})`
    }
  }

  const rows = (db as any).all(sql`
    SELECT m.id AS messageId,
           m.conversation_id AS conversationId,
           c.title AS title,
           m.role AS role,
           substr(m.content, 1, ${sql.raw(clip)}) AS body,
           -bm25(conversation_fts) AS score
    FROM conversation_fts
    JOIN conversation_messages m ON m.rowid = conversation_fts.rowid
    JOIN conversations c ON c.id = m.conversation_id
    WHERE conversation_fts MATCH ${fts}
      AND c.status != 'deleted'
      ${extra}
    ORDER BY -bm25(conversation_fts) DESC
    LIMIT ${sql.raw(String(limit))}
  `) as Array<{
    messageId: number
    conversationId: string
    title: string | null
    role: string
    body: string
    score: number
  }>

  return rows.map((r) => ({
    messageId: Number(r.messageId),
    conversationId: r.conversationId,
    title: r.title ?? null,
    role: r.role,
    body: r.body ?? '',
    score: Number(r.score) || 0,
  }))
}
