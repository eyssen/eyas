// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Incrementally maintained IDF over prefix-5 stems (spec §6): one "document"
// per extraction run. memory_idf holds df per stem; memory_meta('idf_docs')
// holds N. Weights are smoothed log((N+1)/(df+1)) + 1 so an empty table is
// harmless (every stem weighs 1) and an unseen stem is always the rarest.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { getMemoryMeta, setMemoryMeta } from '../schema.js'
import { tokenize, stem5, isStopWord, MIN_STEM_CHARS } from './tokenize.js'

export const IDF_DOCS_META_KEY = 'idf_docs'
/** Bound parameters per IN-list; well under SQLite's default limit on both runtimes. */
const IN_CHUNK = 500

export interface TfIdfTerm {
  stem: string
  /** Most frequent lowercase surface form of the stem in this text. */
  term: string
  score: number
}

export function idfDocumentCount(db: EyasDb): number {
  return Number(getMemoryMeta(db, IDF_DOCS_META_KEY) ?? 0)
}

/** One document seen: df+1 for each of its distinct stems, N+1. Call inside the caller's transaction. */
export function updateIdf(db: EyasDb, stems: Set<string>): void {
  for (const stem of stems) {
    db.run(sql`INSERT INTO memory_idf (stem, df) VALUES (${stem}, 1)
      ON CONFLICT(stem) DO UPDATE SET df = df + 1`)
  }
  setMemoryMeta(db, IDF_DOCS_META_KEY, String(idfDocumentCount(db) + 1))
}

export function idfWeights(db: EyasDb, stems: string[]): Map<string, number> {
  const out = new Map<string, number>()
  const distinct = [...new Set(stems)]
  if (distinct.length === 0) return out
  const n = idfDocumentCount(db)
  const df = new Map<string, number>()
  for (let i = 0; i < distinct.length; i += IN_CHUNK) {
    const chunk = distinct.slice(i, i + IN_CHUNK)
    const rows = db.all<{ stem: string; df: number }>(sql`SELECT stem, df FROM memory_idf
      WHERE stem IN (${sql.join(chunk.map((s) => sql`${s}`), sql`, `)})`)
    for (const r of rows) df.set(r.stem, r.df)
  }
  for (const s of distinct) out.set(s, Math.log((n + 1) / ((df.get(s) ?? 0) + 1)) + 1)
  return out
}

/** Distinct content stems of a text (stop-words and short stems dropped), with tf and surface forms. */
function stemProfile(text: string, lang: string): Map<string, { tf: number; forms: Map<string, number> }> {
  const profile = new Map<string, { tf: number; forms: Map<string, number> }>()
  for (const token of tokenize(text)) {
    if (isStopWord(token, lang)) continue
    const stem = stem5(token)
    if (stem.length < MIN_STEM_CHARS) continue
    const entry = profile.get(stem) ?? { tf: 0, forms: new Map<string, number>() }
    entry.tf += 1
    const lower = token.toLowerCase()
    entry.forms.set(lower, (entry.forms.get(lower) ?? 0) + 1)
    profile.set(stem, entry)
  }
  return profile
}

export function topTfIdfTerms(text: string, lang: string, db: EyasDb, k: number): TfIdfTerm[] {
  if (k <= 0) return []
  const profile = stemProfile(text, lang)
  if (profile.size === 0) return []
  const idf = idfWeights(db, [...profile.keys()])
  const scored: TfIdfTerm[] = []
  for (const [stem, { tf, forms }] of profile) {
    const term = [...forms.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    scored.push({ stem, term, score: (1 + Math.log(tf)) * (idf.get(stem) ?? 1) })
  }
  return scored.sort((a, b) => b.score - a.score || a.stem.localeCompare(b.stem)).slice(0, k)
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12)
}

/** The k highest-scoring sentences (sum of stem TF-IDF, damped by √distinct-stems), returned in document order. */
export function topTfIdfSentences(text: string, lang: string, db: EyasDb, k: number): string[] {
  if (k <= 0) return []
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []
  const weight = new Map(topTfIdfTerms(text, lang, db, Number.MAX_SAFE_INTEGER).map((t) => [t.stem, t.score]))
  const scored = sentences.map((sentence, index) => {
    const stems = new Set<string>()
    for (const token of tokenize(sentence)) {
      if (isStopWord(token, lang)) continue
      const stem = stem5(token)
      if (stem.length >= MIN_STEM_CHARS) stems.add(stem)
    }
    let sum = 0
    for (const s of stems) sum += weight.get(s) ?? 0
    return { sentence, index, score: stems.size === 0 ? 0 : sum / Math.sqrt(stems.size) }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.sentence)
}
