// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Degraded-mode gists (spec §6 leaf, §8 rollup): built from text alone, no
// model, gist_source='heuristic'. A model may replace them later; the
// arbitration gate falls back to these when a model gist is rejected.

import type { EyasDb } from '@core/types'
import { detectLanguage } from '../language.js'
import { topTfIdfSentences, topTfIdfTerms } from './idf.js'

export const LEAF_GIST_MAX_CHARS = 280
export const ROLLUP_GIST_MAX_CHARS = 1_200
const EDGE_BUDGET = 90
const LEAF_TOP_SENTENCES = 3
const MIN_SENTENCE_ROOM = 24
const SEPARATOR = ' … '
const ROLLUP_TOP_CHILDREN = 5
const ROLLUP_LINE_CHARS = 140
const ROLLUP_THEMES = 6
const DAY_MS = 86_400_000
const GIST_RECENCY_DAYS = 365

export interface GistUnit { content: string; sourceType: string }
export interface RollupChild { text: string; importance: number; occurredAtMs: number }
export interface RollupScope { label: string; taskCount: number; from: number; to: number }

function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Clip to `max` characters, preferring a sentence end past 40 % of the budget, then a word end. */
export function clipAtSentence(text: string, max: number): string {
  const flat = flatten(text)
  if (flat.length <= max) return flat
  if (max <= 1) return '…'
  const head = flat.slice(0, max)
  const floor = Math.floor(max * 0.4)
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), /[.!?]$/.test(head) ? head.length - 1 : -1)
  if (lastStop >= floor) return head.slice(0, lastStop + 1)
  const lastSpace = head.lastIndexOf(' ')
  if (lastSpace >= floor) return `${head.slice(0, lastSpace)}…`
  return `${head.slice(0, max - 1)}…`
}

/** First + last message + up to three TF-IDF sentences from the middle, ≤ LEAF_GIST_MAX_CHARS. */
export function heuristicLeafGist(units: GistUnit[], lang: string, db: EyasDb): string {
  const texts = units.map((u) => flatten(u.content)).filter((t) => t.length > 0)
  if (texts.length === 0) return ''
  if (texts.length === 1) return clipAtSentence(texts[0], LEAF_GIST_MAX_CHARS)
  const first = clipAtSentence(texts[0], EDGE_BUDGET)
  const last = clipAtSentence(texts[texts.length - 1], EDGE_BUDGET)
  const parts = [first]
  let used = first.length + SEPARATOR.length + last.length
  const middle = texts.slice(1, -1).join('\n')
  for (const sentence of topTfIdfSentences(middle, lang, db, LEAF_TOP_SENTENCES)) {
    if (first.includes(sentence) || last.includes(sentence)) continue
    const room = LEAF_GIST_MAX_CHARS - used - SEPARATOR.length
    if (room < MIN_SENTENCE_ROOM) break
    const clipped = clipAtSentence(sentence, room)
    parts.push(clipped)
    used += clipped.length + SEPARATOR.length
  }
  parts.push(last)
  return parts.join(SEPARATOR)
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Spec §8 degraded rollup: templated header with the date range, TF-IDF
 * themes, top-N children by importance × recency, the most recent line.
 */
export function heuristicRollupGist(children: RollupChild[], scope: RollupScope, db: EyasDb): string {
  const header = `${scope.label} — ${scope.taskCount} ${scope.taskCount === 1 ? 'task' : 'tasks'}, ${isoDay(scope.from)} → ${isoDay(scope.to)}.`
  if (children.length === 0) return header
  const corpus = children.map((c) => c.text).join('\n')
  const themes = topTfIdfTerms(corpus, detectLanguage(corpus), db, ROLLUP_THEMES).map((t) => t.term)
  const ranked = children
    .map((c) => ({ c, rank: c.importance * Math.exp(-Math.max(0, scope.to - c.occurredAtMs) / DAY_MS / GIST_RECENCY_DAYS) }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, ROLLUP_TOP_CHILDREN)
    .map((r) => r.c)
  const latest = children.reduce((a, b) => (b.occurredAtMs > a.occurredAtMs ? b : a))
  const head = [header]
  if (themes.length > 0) head.push(`Themes: ${themes.join(', ')}.`)
  head.push('Key points:')
  const points = ranked.map((c) => `- ${clipAtSentence(c.text, ROLLUP_LINE_CHARS)}`)
  const tail = `Latest (${isoDay(latest.occurredAtMs)}): ${clipAtSentence(latest.text, ROLLUP_LINE_CHARS)}`
  let text = [...head, ...points, tail].join('\n')
  while (text.length > ROLLUP_GIST_MAX_CHARS && points.length > 1) {
    points.pop()
    text = [...head, ...points, tail].join('\n')
  }
  return text.length > ROLLUP_GIST_MAX_CHARS ? clipAtSentence(text, ROLLUP_GIST_MAX_CHARS) : text
}
