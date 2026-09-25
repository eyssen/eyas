// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Language tag for L0 rows. Detection is deliberately dependency-free and cheap: marker
// words plus a few orthographic signals. It only has to separate the six UI
// languages from each other; anything else (code, emoji, one-word turns)
// is 'und'. Spec §6: "Language detection (hu/en/de/es/fr/tlh) is a
// dependency-free heuristic."
//
// Read time (J6) asks a second question: which language is a recall QUERY
// in? A short follow-up ('igen, csináld') carries no marker words, so the
// answer falls back to the language the conversation has been held in, then
// to 'multi' — never to a hard-coded 'en', which would leave Hungarian
// function words in the lexical query and keep the Klingon rule unreachable.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'

export type Language = 'en' | 'hu' | 'de' | 'es' | 'fr' | 'tlh' | 'und'

type Scored = Exclude<Language, 'und'>

const MARKERS: Record<Scored, ReadonlySet<string>> = {
  en: new Set(['the', 'and', 'is', 'are', 'was', 'were', 'you', 'that', 'this', 'with', 'for', 'not', 'have', 'has', 'will', 'from', 'your', 'please', 'always', 'answer', 'then', 'over']),
  hu: new Set(['és', 'a', 'az', 'hogy', 'nem', 'van', 'egy', 'ez', 'meg', 'csak', 'mert', 'kérlek', 'mindig', 'magyarul', 'ne', 'el', 'majd', 'vagy', 'lesz', 'volt', 'már', 'még', 'nekem']),
  de: new Set(['und', 'der', 'die', 'das', 'ist', 'nicht', 'ich', 'mit', 'ein', 'eine', 'auf', 'bitte', 'immer', 'sie', 'wir', 'auch', 'für', 'von', 'dem', 'den', 'zu', 'dass', 'mir']),
  es: new Set(['el', 'la', 'los', 'las', 'que', 'de', 'y', 'es', 'en', 'por', 'favor', 'siempre', 'no', 'una', 'un', 'con', 'para', 'como', 'pero', 'más', 'también']),
  fr: new Set(['le', 'la', 'les', 'est', 'et', 'des', 'une', 'un', 'pas', 'vous', 'nous', 'pour', 'dans', 'que', 'qui', 'sur', 'avec', 'toujours', 'plaît', 'merci', 'ne', 'ce', 'cette', 'je']),
  tlh: new Set(["'ej", "'ach", 'jih', 'soh', 'ghah', "qapla'", 'tlhingan', 'hol', 'nuq', 'vaj', 'hoch', "'oh", 'mah', 'yaj', 'jang', "qar'a'", "chay'", 'nuqneh', "majqa'", "ghu'", 'batlh', 'suv', 'pagh']),
}

const LANGS: Scored[] = ['en', 'hu', 'de', 'es', 'fr', 'tlh']

/** Letters that occur in exactly one of the six orthographies. */
function orthographyBonus(text: string, score: Record<Scored, number>): void {
  if (/[őűŐŰ]/u.test(text)) score.hu += 3
  if (/ß/u.test(text)) score.de += 3
  if (/[ñ¿¡]/u.test(text)) score.es += 3
  if (/[œŒ]/u.test(text) || /[çÇ]/u.test(text)) score.fr += 2
}

/**
 * Klingon romanisation: a capital inside a word (tlhIngan, jIyaj, maSuv) or the
 * "tlh" cluster. The word-internal capital is NOT Klingon evidence on its own —
 * in this product's transcripts `getUserById` and `parseConfig` are ordinary
 * English — so it only scores once something Klingon-specific is already
 * present: a marker word (counted before this runs) or the "tlh" cluster.
 */
function klingonBonus(rawTokens: string[], score: Record<Scored, number>): void {
  let innerCapital = 0
  let cluster = 0
  for (const tok of rawTokens) {
    if (/^[a-z']+[A-Z][A-Za-z']*$/.test(tok)) innerCapital += 2
    if (/tlh/i.test(tok)) cluster += 2
  }
  const corroborated = cluster > 0 || score.tlh > 0
  score.tlh += cluster
  if (corroborated) score.tlh += innerCapital
}

export function detectLanguage(text: string): Language {
  if (!text) return 'und'
  const rawTokens = text.split(/[^\p{L}\p{N}']+/u).filter((t) => t.length > 0)
  if (rawTokens.length < 2) return 'und'
  const score: Record<Scored, number> = { en: 0, hu: 0, de: 0, es: 0, fr: 0, tlh: 0 }
  for (const raw of rawTokens) {
    const tok = raw.toLowerCase()
    for (const lang of LANGS) if (MARKERS[lang].has(tok)) score[lang] += 1
  }
  orthographyBonus(text, score)
  klingonBonus(rawTokens, score)
  let best: Scored = 'en'
  let bestScore = -1
  let second = -1
  for (const lang of LANGS) {
    const s = score[lang]
    if (s > bestScore) { second = bestScore; bestScore = s; best = lang }
    else if (s > second) second = s
  }
  if (bestScore < 2 || bestScore === second) return 'und'
  return best
}

/**
 * The read-time language of a recall query: one of the six, or 'multi' when
 * nothing says which — every stop list then applies (tokenize.isStopWord).
 */
export type QueryLanguage = Scored | 'multi'

export const MULTI_LANGUAGE = 'multi'

/** How many of a conversation's latest conversational L0 rows vote on its language. */
const DOMINANT_WINDOW = 200

const SCORED = new Set<string>(LANGS)

/**
 * The language a conversation has been held in: the most frequent L0
 * `language` tag among its latest user and assistant rows (tool payloads are
 * left out for the same reason extractDeterministic leaves them out — JSON
 * swamps the markers). 'und' never votes; a tie goes to the language used
 * most recently. Null when nothing is known or the tables are absent.
 */
export function conversationLanguage(db: EyasDb, conversationId: string): Exclude<Language, 'und'> | null {
  if (!conversationId) return null
  try {
    const rows = db.all<{ lang: string }>(sql`
      SELECT t.tag_value AS lang
      FROM (
        SELECT rid, occurred_at FROM memory_raw
        WHERE conversation_id = ${conversationId} AND tombstoned = 0
          AND source_type IN ('user_message', 'assistant_message')
        ORDER BY occurred_at DESC
        LIMIT ${DOMINANT_WINDOW}
      ) r
      JOIN memory_tag t ON t.memory_rid = r.rid AND t.tag_type = 'language'
      WHERE t.tag_value != 'und'
      GROUP BY t.tag_value
      ORDER BY COUNT(*) DESC, MAX(r.occurred_at) DESC
      LIMIT 1`)
    const lang = rows[0]?.lang
    return lang && SCORED.has(lang) ? (lang as Scored) : null
  } catch {
    return null
  }
}

/**
 * Spec §7 read path: detectLanguage on the query itself, else the
 * conversation's dominant L0 language, else 'multi'.
 */
export function resolveQueryLanguage(
  db: EyasDb | null | undefined,
  text: string,
  conversationId?: string | null,
): QueryLanguage {
  const detected = detectLanguage(text)
  if (detected !== 'und') return detected
  if (db && conversationId) {
    const dominant = conversationLanguage(db, conversationId)
    if (dominant) return dominant
  }
  return MULTI_LANGUAGE
}
