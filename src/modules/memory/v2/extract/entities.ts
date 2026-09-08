// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Regex/heuristic entities (spec §6): dates (ISO, Hungarian dotted,
// day-first), @mentions, #tickets, `key: value` / `X = Y` lines, code
// identifiers and capitalised multi-word phrases. Deterministic,
// dependency-free, capped. Word boundaries are written as Unicode
// lookarounds because `\b` is ASCII-only in JavaScript.

import { isStopWord } from './tokenize.js'

export type EntityType = 'date' | 'mention' | 'proper' | 'kv' | 'code' | 'ticket'
export interface ExtractedEntity { name: string; type: EntityType }
export interface KeyValue { key: string; value: string }
export const MAX_ENTITIES = 50

const DATE_PATTERNS: RegExp[] = [
  /(?<!\p{N})\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?(?!\p{N})/gu,
  /(?<!\p{N})\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?(?!\p{N})/gu,
  /(?<!\p{N})\d{1,2}[./]\d{1,2}[./]\d{4}(?!\p{N})/gu,
]
// The lookbehind must cover every character an RFC 5321 local part may end
// with, not only letters and digits: `user-@d.com`, `user.@d.com` and
// `user_@d.com` would otherwise mint `d.com` as a mention.
const MENTION = /(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_.-]{2,64})/gu
const TICKET = /(?<![\p{L}\p{N}&])#(\d{2,7})(?!\p{N})/gu
const KV_LINE = /^[ \t]*([\p{L}\p{N}_][\p{L}\p{N}_ .\/-]{0,39}?)[ \t]*[:=][ \t]*(?!\/\/)(\S[^\n]{0,119}?)[ \t]*$/gmu
const BACKTICKED = /`([^`\n]{2,80})`/g
const CODE_PATTERNS: RegExp[] = [
  /(?<![\p{L}\p{N}_])[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+(?![\p{L}\p{N}_])/gu,
  /(?<![\p{L}\p{N}_])[a-z0-9]+(?:_[a-z0-9]+)+(?![\p{L}\p{N}_])/gu,
  /(?<![\p{L}\p{N}_])[\p{L}\p{N}_.-]+\.(?:tsx?|m?js|py|md|json|ya?ml|sql|sh|html|css|xml|po|toml)(?![\p{L}\p{N}_])/gu,
]
const CAPITALISED_WORD = /^\p{Lu}[\p{Ll}\p{M}]{2,}$/u
const URL_SCHEME = /^(?:https?|ftp|mailto|file)$/i
const LANGS = ['en', 'hu', 'de', 'es', 'fr']

function isAnyStopWord(word: string): boolean {
  return LANGS.some((lang) => isStopWord(word, lang))
}

export function extractKeyValues(text: string): KeyValue[] {
  const out: KeyValue[] = []
  for (const m of text.matchAll(KV_LINE)) {
    const key = m[1].trim()
    const value = m[2].trim()
    if (!key || !value) continue
    if (/^\d+$/.test(key) || URL_SCHEME.test(key)) continue
    const words = key.split(/\s+/)
    if (words.length > 4) continue
    // A label, not a clause. Task 8 turns every one of these into a memory_fact
    // row, so `The rule is: do not enter.` must not mint a structural fact —
    // and a one-character key is a Windows drive letter, not a label.
    if ([...key].length < 2) continue
    if (words.length > 1 && LANGS.some((lang) => isStopWord(words[words.length - 1], lang))) continue
    out.push({ key, value })
  }
  return out
}

/** Runs of 2–4 capitalised words inside a sentence; leading stop-words ("The Kubernetes Ingress") are dropped. */
function properPhrases(text: string): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/u)) {
    // The opening class carries U+201C as well as U+00AB/U+201E: U+201C opens
    // an English quotation and closes a German/Hungarian one, so it belongs at
    // both ends. Written as \u escapes on purpose — the literal characters were
    // silently mangled into straight quotes twice while transcribing this file,
    // and the damage (Hungarian and German quotations stopped matching) is
    // invisible to every test in this task.
    const words = sentence.split(/\s+/).map((w) => w.replace(/^[("'\u00AB\u201E\u201C]+|[)"'\u00BB\u201C\u201D,;:!?.]+$/gu, '')).filter(Boolean)
    let run: string[] = []
    const flush = (): void => {
      // Strip a leading cross-language stop-word only while a 2+ word phrase
      // survives it. isAnyStopWord ORs over all five languages regardless of
      // what the text is written in, so an unguarded shift deletes `Los
      // Angeles` and `Die Hard` ENTIRELY (`los` is Spanish, `die` is German):
      // the phrase drops to one word and then fails the length gate.
      while (run.length > 2 && isAnyStopWord(run[0])) run.shift()
      if (run.length >= 2 && run.length <= 4) out.push(run.join(' '))
      run = []
    }
    for (const w of words) {
      if (CAPITALISED_WORD.test(w)) run.push(w)
      else flush()
    }
    flush()
  }
  return out
}

export function extractEntities(text: string): ExtractedEntity[] {
  const out: ExtractedEntity[] = []
  if (!text) return out
  const seen = new Set<string>()
  /** Returns false once the cap is reached. */
  const push = (name: string, type: EntityType): boolean => {
    const clean = name.trim()
    if (clean) {
      const key = `${type}:${clean.toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ name: clean, type })
      }
    }
    return out.length < MAX_ENTITIES
  }
  for (const re of DATE_PATTERNS) for (const m of text.matchAll(re)) if (!push(m[0], 'date')) return out
  for (const m of text.matchAll(MENTION)) if (!push(m[1].replace(/[.-]+$/u, ''), 'mention')) return out
  for (const m of text.matchAll(TICKET)) if (!push(m[1], 'ticket')) return out
  for (const kv of extractKeyValues(text)) if (!push(kv.key, 'kv')) return out
  for (const m of text.matchAll(BACKTICKED)) if (!push(m[1], 'code')) return out
  for (const re of CODE_PATTERNS) for (const m of text.matchAll(re)) if (!push(m[0], 'code')) return out
  for (const phrase of properPhrases(text)) if (!push(phrase, 'proper')) return out
  return out
}
