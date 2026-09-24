// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Single source for conversation context occupancy inputs. Board cards and
// the conversation header both display these fields — they must not compute
// a second numerator or window of their own.
//
// Numerator: the prompt size the provider reported for the latest
// composition's last model call (measured); when none was reported, the
// estimate of what was sent: the recorded sections plus the conversation
// history.
// Window, most specific first: the window the runtime reported for the model
// that answered → the window the prompt was sized for (resolved at record) →
// the model's catalog row → the provider's known window → the default. The
// two recorded windows count only while the composition is for the model the
// conversation runs on now; the rest is the one window resolver
// (model/model-window.ts resolveModelContextWindow).

import { sql } from 'drizzle-orm'
import {
  resolveModelContextWindow,
  type ModelWindowCatalog,
  type ModelWindowCatalogRow,
} from '@modules/model/model-window.js'

export interface ConversationContextInput {
  id: string
  providerId: string | null
  modelId: string | null
}

export interface ConversationContextFields {
  /**
   * The occupancy numerator: the measured prompt size of the latest
   * composition's last model call, else its estimate (sections + history).
   * null when no composition is on file.
   */
  estimatedTokens: number | null
  /** Denominator for the context stripe. */
  contextWindow: number
  /** true: the numerator is the size the provider reported, not an estimate. */
  measured: boolean
}

/** One stored composition as far as occupancy is concerned. */
interface CompositionOccupancy {
  provider: string | null
  model: string | null
  estimatedTokens: number
  historyEstimatedTokens: number | null
  observedPromptTokens: number | null
  contextWindow: number
  observedContextWindow: number | null
}

/**
 * Latest composition + resolved context window for each conversation. One
 * query for compositions, one for the model catalog (read through the window
 * resolver); call this from every surface that shows occupancy rather than
 * fetching those inputs again.
 */
export function loadConversationContext(
  db: any,
  list: ConversationContextInput[],
): Map<string, ConversationContextFields> {
  const out = new Map<string, ConversationContextFields>()
  if (list.length === 0) return out

  const compositions = latestCompositions(db, list.map((c) => c.id))
  const catalog = catalogOf(db)

  for (const c of list) {
    out.set(c.id, occupancyOf(c, compositions.get(c.id), catalog))
  }
  return out
}

/**
 * `target`: the pair the conversation effectively runs on (the binding
 * resolver's — an agent's pair, Auto's tier, the default a new conversation
 * will fix), when the caller knows it. The window is sized for that pair; the
 * returned row keeps its own stored fields.
 */
export function attachConversationContext<T extends ConversationContextInput>(
  db: any,
  conv: T,
  target?: { providerId: string; modelId: string } | null,
): T & ConversationContextFields {
  const input: ConversationContextInput = target
    ? { id: conv.id, providerId: target.providerId, modelId: target.modelId }
    : conv
  const ctx = loadConversationContext(db, [input]).get(conv.id) ?? emptyConversationContext(input)
  return { ...conv, ...ctx }
}

/** The occupancy of a conversation with no composition on file: no reading, the pair's window. */
export function emptyConversationContext(target: { providerId?: string | null; modelId?: string | null }): ConversationContextFields {
  return {
    estimatedTokens: null,
    contextWindow: resolveModelContextWindow({ providerId: target.providerId, modelId: target.modelId }).contextWindow,
    measured: false,
  }
}

function occupancyOf(
  c: ConversationContextInput,
  comp: CompositionOccupancy | undefined,
  catalog: ModelWindowCatalog,
): ConversationContextFields {
  // The pair the window is for: the conversation's own; with none stored,
  // the pair its latest composition ran on.
  const target = c.providerId
    ? { providerId: c.providerId, modelId: c.modelId }
    : { providerId: comp?.provider ?? null, modelId: comp?.model ?? null }
  // A window recorded for another model (the conversation switched since)
  // says nothing about this one.
  const sameModel = comp !== undefined
    && (!c.providerId || (comp.provider === c.providerId && (comp.model ?? null) === (c.modelId ?? null)))
  const contextWindow = sameModel && positive(comp.observedContextWindow)
    ? comp.observedContextWindow!
    : sameModel && positive(comp.contextWindow)
      ? comp.contextWindow
      : resolveModelContextWindow(target, { catalog }).contextWindow

  if (!comp) return { estimatedTokens: null, contextWindow, measured: false }
  const measured = positive(comp.observedPromptTokens)
  return {
    estimatedTokens: measured
      ? comp.observedPromptTokens!
      : comp.estimatedTokens + (comp.historyEstimatedTokens ?? 0),
    contextWindow,
    measured,
  }
}

function positive(n: number | null | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function latestCompositions(db: any, ids: string[]): Map<string, CompositionOccupancy> {
  const out = new Map<string, CompositionOccupancy>()
  if (ids.length === 0) return out
  try {
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `)
    const rows = db.all(sql`
      SELECT conversation_id, provider, model, estimated_tokens, history_estimated_tokens,
             observed_prompt_tokens, context_window, observed_context_window
      FROM context_compositions
      WHERE conversation_id IN (${idList})
      ORDER BY created_at DESC
    `) as Array<{
      conversation_id: string
      provider: string | null
      model: string | null
      estimated_tokens: number
      history_estimated_tokens: number | null
      observed_prompt_tokens: number | null
      context_window: number
      observed_context_window: number | null
    }>
    for (const row of rows) {
      if (out.has(row.conversation_id)) continue
      out.set(row.conversation_id, {
        provider: row.provider,
        model: row.model,
        estimatedTokens: row.estimated_tokens,
        historyEstimatedTokens: row.history_estimated_tokens,
        observedPromptTokens: row.observed_prompt_tokens,
        contextWindow: row.context_window,
        observedContextWindow: row.observed_context_window,
      })
    }
  } catch {
    /* context_compositions may be absent (observability off, isolated tests) */
  }
  return out
}

/**
 * The model catalog as the window resolver reads it (a ModelWindowCatalog),
 * loaded with ONE query for the whole list instead of one per conversation.
 */
function catalogOf(db: any): ModelWindowCatalog {
  const byProvider = new Map<string, ModelWindowCatalogRow[]>()
  try {
    const rows = db.all(sql`SELECT provider_id, model_id, context_window, supports_tools FROM model_config`) as Array<{
      provider_id: string
      model_id: string
      context_window: number | null
      supports_tools: number | null
    }>
    for (const row of rows) {
      const list = byProvider.get(row.provider_id) ?? []
      list.push({ modelId: row.model_id, contextWindow: row.context_window, supportsTools: row.supports_tools !== 0 })
      byProvider.set(row.provider_id, list)
    }
  } catch {
    /* model_config may be absent in isolated tests */
  }
  return { listModels: (providerId) => byProvider.get(providerId) ?? [] }
}
