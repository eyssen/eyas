// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One recall query per spec §7 ("task title + description + last 1–2 user
// turns"), built without a model and the same way on every entry path. Before
// this, the interactive route searched with the bare message — a follow-up
// such as 'igen, csináld' retrieved on noise — and a background run searched
// with the goal alone, so the same conversation recalled differently
// depending on who drove it. Callers hand over only the turn text they have
// (or ''); the rest comes from the conversation itself, never from another
// one.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { isUntitledTitle } from '@shared/conversation-title.js'

/** The whole query, turn text first; later parts are cut when it is full. */
export const RECALL_QUERY_MAX_CHARS = 1_200
export const PREVIOUS_TURN_MAX_CHARS = 400
export const TITLE_MAX_CHARS = 120
export const GOAL_MAX_CHARS = 400

/** How far back the previous distinct user turn is looked for. */
const USER_TURN_SCAN = 20

export interface RecallQueryInput {
  conversationId: string
  /** The current turn's text; empty means "the last stored user message". */
  turnText?: string | null
}

function collapse(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** Cut at a word boundary when one is close, so no half word becomes a stem. */
function clip(text: string, max: number): string {
  const chars = [...text]
  if (chars.length <= max) return text
  const cut = chars.slice(0, max).join('')
  const sp = cut.lastIndexOf(' ')
  return (sp >= max * 0.75 ? cut.slice(0, sp) : cut).trim()
}

/** Comparison key: case-folded, trailing ellipsis and punctuation dropped (a title snippet ends in '…'). */
function keyOf(text: string): string {
  return text.toLowerCase().replace(/[\s.,;:!?…]+$/u, '').trim()
}

/** This conversation's latest user messages, newest first. Empty when the table is absent. */
function recentUserTurns(db: EyasDb, conversationId: string): string[] {
  try {
    const rows = db.all<{ content: string | null }>(sql`
      SELECT content FROM conversation_messages
      WHERE conversation_id = ${conversationId} AND role = 'user'
      ORDER BY created_at DESC, id DESC
      LIMIT ${USER_TURN_SCAN}`)
    return rows.map((r) => collapse(r.content)).filter((c) => c.length > 0)
  } catch {
    return []
  }
}

/** Title and goal_description; SELECT * so a database without the goal column still yields the title. */
function conversationTask(db: EyasDb, conversationId: string): { title: string; goal: string } {
  try {
    const row = db.all<Record<string, unknown>>(sql`SELECT * FROM conversations WHERE id = ${conversationId} LIMIT 1`)[0]
    if (!row) return { title: '', goal: '' }
    const rawTitle = typeof row.title === 'string' ? row.title : ''
    return {
      title: isUntitledTitle(rawTitle) ? '' : collapse(rawTitle),
      goal: typeof row.goal_description === 'string' ? collapse(row.goal_description) : '',
    }
  } catch {
    return { title: '', goal: '' }
  }
}

/**
 * The recall query for one turn: the turn text (else the last stored user
 * message), the previous distinct user turn (≤ 400 chars), the title
 * (≤ 120) and the goal description (≤ 400). A part already contained in an
 * earlier one is dropped, so a first-turn title snippet or a goal that is the
 * message itself is not searched twice. Newline-joined, ≤ 1 200 chars.
 * Returns '' when the conversation has nothing to search with.
 */
export function buildRecallQuery(db: EyasDb, input: RecallQueryInput): string {
  const conversationId = input.conversationId
  const turns = conversationId ? recentUserTurns(db, conversationId) : []
  const current = collapse(input.turnText) || turns[0] || ''
  const currentKey = keyOf(current)
  const previous = turns.find((t) => keyOf(t) !== currentKey) ?? ''
  const task = conversationId ? conversationTask(db, conversationId) : { title: '', goal: '' }

  const parts: string[] = []
  const keys: string[] = []
  const add = (text: string, max: number): void => {
    const part = clip(text, max)
    const key = keyOf(part)
    if (!key) return
    if (keys.some((k) => k.includes(key))) return
    parts.push(part)
    keys.push(key)
  }
  add(current, RECALL_QUERY_MAX_CHARS)
  add(previous, PREVIOUS_TURN_MAX_CHARS)
  add(task.title, TITLE_MAX_CHARS)
  add(task.goal, GOAL_MAX_CHARS)

  return clip(parts.join('\n'), RECALL_QUERY_MAX_CHARS)
}
