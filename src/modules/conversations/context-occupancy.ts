// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Single source for conversation context occupancy inputs. Board cards and
// the conversation header both display these fields — they must not compute
// a second numerator or window of their own.

import { sql } from 'drizzle-orm'
import { hasKnownProviderWindow, resolveContextWindow } from './context-window.js'

export interface ConversationContextInput {
  id: string
  providerId: string | null
  modelId: string | null
}

export interface ConversationContextFields {
  /** Latest composition's composed size; null when none is on file. */
  estimatedTokens: number | null
  /** Denominator for the context stripe. */
  contextWindow: number
}

/**
 * Latest composition size + resolved context window for each conversation.
 * One query for compositions, one for the model catalog; call this from every
 * surface that shows occupancy rather than fetching those inputs again.
 */
export function loadConversationContext(
  db: any,
  list: ConversationContextInput[],
): Map<string, ConversationContextFields> {
  const out = new Map<string, ConversationContextFields>()
  if (list.length === 0) return out

  const compositions = latestCompositions(db, list.map((c) => c.id))
  const catalogWindows = modelCatalogWindows(db)

  for (const c of list) {
    const comp = compositions.get(c.id)
    const catalogKey = c.providerId && c.modelId ? `${c.providerId}\0${c.modelId}` : null
    const catalogWindow = catalogKey ? catalogWindows.get(catalogKey) : undefined
    const recordedWindow = comp && comp.contextWindow > 0 ? comp.contextWindow : undefined
    // CLI providers have a known window in resolveContextWindow. A stale
    // model_config row must not win over it — the conversation header used to
    // read listModels() and the board used to read this table, and they disagreed.
    const windowHint = hasKnownProviderWindow(c.providerId)
      ? recordedWindow
      : (catalogWindow ?? recordedWindow)
    out.set(c.id, {
      estimatedTokens: comp?.estimatedTokens ?? null,
      contextWindow: resolveContextWindow(windowHint, c.providerId),
    })
  }
  return out
}

export function attachConversationContext<T extends ConversationContextInput>(
  db: any,
  conv: T,
): T & ConversationContextFields {
  const ctx = loadConversationContext(db, [conv]).get(conv.id) ?? {
    estimatedTokens: null,
    contextWindow: resolveContextWindow(null, conv.providerId),
  }
  return { ...conv, ...ctx }
}

function latestCompositions(
  db: any,
  ids: string[],
): Map<string, { estimatedTokens: number; contextWindow: number }> {
  const out = new Map<string, { estimatedTokens: number; contextWindow: number }>()
  if (ids.length === 0) return out
  try {
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `)
    const rows = db.all(sql`
      SELECT conversation_id, estimated_tokens, context_window
      FROM context_compositions
      WHERE conversation_id IN (${idList})
      ORDER BY created_at DESC
    `) as Array<{ conversation_id: string; estimated_tokens: number; context_window: number }>
    for (const row of rows) {
      if (out.has(row.conversation_id)) continue
      out.set(row.conversation_id, {
        estimatedTokens: row.estimated_tokens,
        contextWindow: row.context_window,
      })
    }
  } catch {
    /* context_compositions may be absent in isolated tests */
  }
  return out
}

function modelCatalogWindows(db: any): Map<string, number> {
  const out = new Map<string, number>()
  try {
    const rows = db.all(sql`SELECT provider_id, model_id, context_window FROM model_config`) as Array<{
      provider_id: string
      model_id: string
      context_window: number | null
    }>
    for (const row of rows) {
      if (typeof row.context_window === 'number' && row.context_window > 0) {
        out.set(`${row.provider_id}\0${row.model_id}`, row.context_window)
      }
    }
  } catch {
    /* model_config may be absent in isolated tests */
  }
  return out
}
