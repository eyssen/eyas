// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One tokenisation for write time (TF-IDF topics, the IDF table) and read
// time (Phase 2's lexical channel): the two must agree or prefix stems never
// meet (spike §2 #19 — prefix-5 stems lift Hungarian FTS recall 17.5 → 60 %).
// Ports related-work.ts's keep rules (4+ chars, or an ALL-CAPS code of 2+)
// onto a Unicode-aware split — the Latin-only split there turns
// "Szállítási" into "Sz", "ll", "t", "si".

import { escapeFtsQuery } from '../../schema.js'

export const STEM_PREFIX_LENGTH = 5
export const MIN_STEM_CHARS = 3
export const MAX_FTS_QUERY_TOKENS = 12

function isAllCapsLetters(token: string): boolean {
  const chars = [...token]
  if (chars.length < 2) return false
  for (const ch of chars) {
    const upper = ch.toUpperCase()
    if (upper === ch.toLowerCase()) return false
    if (ch !== upper) return false
  }
  return true
}

function keepToken(token: string): boolean {
  if ([...token].length >= 4) return true
  return isAllCapsLetters(token)
}

/** Every kept token in order (repeats kept). `"()` and control characters are separators. */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const cleaned = text.replace(/[\p{Cc}"()]/gu, ' ')
  for (const raw of cleaned.split(/[^\p{L}\p{N}_]+/u)) {
    if (raw && keepToken(raw)) out.push(raw)
  }
  return out
}

/** Lowercase, diacritics removed (NFD strip), first five characters. */
export function stem5(token: string): string {
  return fold(token).slice(0, STEM_PREFIX_LENGTH)
}

function fold(token: string): string {
  return token.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

// Small, diacritic-free lists: tokens are folded before the lookup. Short
// glue (< 4 chars) never reaches here because tokenize() drops it; the
// lists still carry it so isStopWord() is usable on raw tokens too.
const STOP_WORDS: Record<string, ReadonlySet<string>> = {
  en: new Set('the and that this with from have has had for are was were will would should could not but you your they them their there then than what when where which who how also into about just like some more very been being does did our its over only can all'.split(' ')),
  hu: new Set('hogy nem egy ezt ez az es is meg mar csak mint vagy akkor most mert minden lehet kell van volt lesz majd ilyen olyan ezek azok itt ott nagyon aztan ugye tehat hanem pedig ami amit aki akik amely ahol hiszen szerint vele neki rola ebben abban ennek annak mindig valami'.split(' ')),
  de: new Set('und der die das nicht ein eine einer eines einem einen ist sind war waren wird werden wurde mit von auf fur aus bei nach uber auch aber oder wenn dann dass sich noch schon sehr nur kann muss haben hat hatte wie was wir ihr sie ihn ihm ihre dem den des hier dort mehr alle diese dieser dieses immer'.split(' ')),
  es: new Set('que los las una uno unos unas del con por para como pero mas muy sin sobre entre este esta esto estos estas ese esa eso esos esas son era eran fue fueron sera seran hay han sido estan todo toda todos todas tambien cuando donde porque aqui alli nos les sus algo cada otro otra otros otras tiene tienen puede pueden'.split(' ')),
  fr: new Set('les des une dans pour avec sur pas que qui quoi dont mais aussi plus tres sans sous entre cette ces cet son ses leur leurs nous vous ils elles elle est sont etait etaient sera seront ete etre avoir ont avait avaient tout tous toute toutes comme alors donc ainsi encore deja ici chez peut peuvent faire fait bien meme autre autres'.split(' ')),
}

export function isStopWord(token: string, lang: string): boolean {
  const list = STOP_WORDS[lang]
  return list ? list.has(fold(token)) : false
}

/**
 * FTS5 MATCH for the lexical channel: prefix-5 stems + `*`, OR-joined and
 * quoted through escapeFtsQuery, ≤ MAX_FTS_QUERY_TOKENS. Stop-words and
 * stems shorter than MIN_STEM_CHARS are dropped. When more than the cap
 * survive, the stems of the longest surface forms win (long words are the
 * distinctive ones) — ties keep first-seen order.
 */
export function buildFtsQuery(text: string, lang: string): string | null {
  const longest = new Map<string, { len: number; order: number }>()
  for (const token of tokenize(text)) {
    if (isStopWord(token, lang)) continue
    const stem = stem5(token)
    if (stem.length < MIN_STEM_CHARS) continue
    const len = [...token].length
    const seen = longest.get(stem)
    if (!seen) longest.set(stem, { len, order: longest.size })
    else if (len > seen.len) seen.len = len
  }
  if (longest.size === 0) return null
  const stems = [...longest.entries()]
    .sort((a, b) => b[1].len - a[1].len || a[1].order - b[1].order)
    .slice(0, MAX_FTS_QUERY_TOKENS)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([stem]) => stem)
  return stems.map((s) => `${escapeFtsQuery(s)}*`).join(' OR ')
}
