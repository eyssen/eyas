// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The deterministic extraction pass (spec §6) — always runs, needs no model.
// Its output is a CANDIDATE: arbitrate.ts decides what is written. Phase 3's
// model pass produces the same shape (gistSource='model', heuristicGist
// carried alongside) and enters arbitration through the same door.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { RawSourceType, TrustTier } from '../ingest-bridge.js'
import { detectLanguage } from '../language.js'
import { resolveConversationScope } from '../scope.js'
import { topTfIdfTerms } from './idf.js'
import { extractEntities, extractKeyValues } from './entities.js'
import { countDecisionMarkers, scoreImportance } from './importance.js'
import { heuristicLeafGist } from './gist.js'
import { isStopWord } from './tokenize.js'

export interface ExtractionUnit {
  id: string
  content: string
  sourceType: RawSourceType
  occurredAtMs: number
  /**
   * Carried so Task 11 derives BOTH arbitration arrays from ONE array.
   * `ArbitrationScope.sourceRawIds` and `.sourceTrustTiers` are zipped by index
   * in `loadSources`; building them from two different arrays is safe only
   * while they are 1:1, and Task 11 now filters the unit list.
   */
  trustTier: TrustTier
}

export interface ExtractionContext {
  db: EyasDb
  projectId: string | null
  taskClosed: boolean
  /** Enables board facts and the pin flag; absent in unit tests of the pure pass. */
  conversationId?: string | null
}

export interface ExtractionCandidate {
  gist: string
  importance: number
  entities: Array<{ name: string; type: string }>
  topics: string[]
  facts: Array<{ subject: string; predicate: string; object: string; confidenceHint?: number; sourceRawIds: string[] }>
  language: string
  gistSource: 'heuristic' | 'model'
  /** The heuristic gist, always present, so a rejected model gist has something to fall back to. */
  heuristicGist?: string
}

export type CandidateFact = ExtractionCandidate['facts'][number]

/** Caps the `key: value` facts only. Up to four board facts are added on top, so `candidate.facts` can hold 24. */
export const MAX_STRUCTURAL_FACTS = 20
/** Caps the TF-IDF stem half of `topics` only. Entity names are unioned on top, bounded by entities.ts's MAX_ENTITIES (50), so `candidate.topics` can hold 58. */
export const MAX_TOPICS = 8
const KV_CONFIDENCE = 0.5
const BOARD_CONFIDENCE = 0.9

function boardFacts(db: EyasDb, conversationId: string, sourceRawIds: string[]): CandidateFact[] {
  const scope = resolveConversationScope(db, conversationId)
  const facts: CandidateFact[] = []
  const push = (predicate: string, object: string | null): void => {
    if (object) facts.push({ subject: conversationId, predicate, object, confidenceHint: BOARD_CONFIDENCE, sourceRawIds })
  }
  try {
    const row = db.all<{ title: string | null }>(sql`SELECT title FROM conversations WHERE id = ${conversationId}`)[0]
    push('title', row?.title?.trim() || null)
  } catch {
    /* partial schema in a test fixture: no title */
  }
  push('project', scope.projectId)
  push('project_type', scope.projectTypeId)
  push('agent', scope.agentId)
  return facts
}

function isPinned(db: EyasDb, conversationId: string): boolean {
  try {
    const row = db.all<{ pinned: number | null }>(sql`SELECT pinned FROM conversations WHERE id = ${conversationId}`)[0]
    return Number(row?.pinned ?? 0) === 1
  } catch {
    return false
  }
}

function structuralFacts(userUnits: ExtractionUnit[], language: string): CandidateFact[] {
  const facts: CandidateFact[] = []
  const seen = new Set<string>()
  for (const unit of userUnits) {
    for (const kv of extractKeyValues(unit.content)) {
      const subject = kv.key.trim().toLowerCase()
      const object = kv.value.trim()
      if (subject.length < 2 || isStopWord(subject, language)) continue
      const key = `${subject}|is|${object.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      facts.push({ subject, predicate: 'is', object, confidenceHint: KV_CONFIDENCE, sourceRawIds: [unit.id] })
      if (facts.length >= MAX_STRUCTURAL_FACTS) return facts
    }
  }
  return facts
}

export function extractDeterministic(units: ExtractionUnit[], ctx: ExtractionContext): ExtractionCandidate {
  const conversational = units.filter((u) => u.sourceType === 'user_message' || u.sourceType === 'assistant_message')
  const userUnits = units.filter((u) => u.sourceType === 'user_message')
  const allText = units.map((u) => u.content).join('\n')
  // Language comes from CONVERSATIONAL text only. detectLanguage scores marker
  // words across the whole string, so a dozen JSON tool_result payloads swamp two
  // short Hungarian turns and the result falls to 'und'. That is not merely a
  // wrong label: STOP_WORDS has no 'und' entry, so isStopWord returns false for
  // every token, and stop-word filtering silently switches off everywhere this
  // value is threaded — the structural-fact subject gate, every TF-IDF call, and
  // the gist. A tool-heavy turn is the normal shape of this product's traffic.
  // Falls back to the whole batch when there is no conversational text at all.
  const conversationalText = conversational.map((u) => u.content).join('\n')
  const language = detectLanguage(conversationalText || allText)

  const entities = extractEntities(allText)
  const facts = structuralFacts(userUnits, language)
  if (ctx.conversationId) facts.push(...boardFacts(ctx.db, ctx.conversationId, units.map((u) => u.id)))

  const stems = topTfIdfTerms(allText, language, ctx.db, MAX_TOPICS).map((t) => t.stem)
  const topics = [...new Set([...stems, ...entities.map((e) => e.name.toLowerCase())])]

  const importance = scoreImportance({
    messageCount: conversational.length,
    userChars: userUnits.reduce((n, u) => n + u.content.length, 0),
    decisionMarkers: countDecisionMarkers(conversational.map((u) => u.content).join('\n')),
    taskClosed: ctx.taskClosed,
    userPinned: ctx.conversationId ? isPinned(ctx.db, ctx.conversationId) : false,
  })

  const gist = heuristicLeafGist(units, language, ctx.db)
  return { gist, importance, entities, topics, facts, language, gistSource: 'heuristic', heuristicGist: gist }
}
