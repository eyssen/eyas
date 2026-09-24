// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The notice a channel sender gets when their message is refused by the
// privacy ingress check (errors.ts). There is no global backend language
// setting and a channel sender has no UI language, so the notice follows the
// language the message itself was written in (memory/v2 detectLanguage over
// the six product languages), falling back to English. It names the refused
// TYPES only — a detected value is never echoed back.

import { detectLanguage } from '@modules/memory/v2/language.js'
import { BUILTIN_PII_TYPES } from './types.js'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

export const NOTICE_LANGUAGES = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const
export type NoticeLanguage = (typeof NOTICE_LANGUAGES)[number]

const BUNDLES: Record<NoticeLanguage, Record<string, string>> = { en, hu, de, es, fr, tlh }

const BUILTIN = new Set<string>(BUILTIN_PII_TYPES)

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => vars[name] ?? whole)
}

function lookup(lang: NoticeLanguage, key: string): string | undefined {
  return BUNDLES[lang][key] ?? BUNDLES.en[key]
}

/** The language a notice for `text` is written in: the message's own language, else English. */
export function noticeLanguageOf(text: string): NoticeLanguage {
  let detected: string
  try {
    detected = detectLanguage(text)
  } catch {
    detected = 'und'
  }
  return (NOTICE_LANGUAGES as readonly string[]).includes(detected) ? detected as NoticeLanguage : 'en'
}

/** A PII type's label: a built-in type's localized name, or a custom pattern's type slug. */
export function privacyTypeLabel(type: string, lang: NoticeLanguage): string {
  if (BUILTIN.has(type)) return lookup(lang, `privacy.type.${type}`) ?? type
  return interpolate(lookup(lang, 'privacy.type.custom') ?? '{{type}}', { type })
}

/** The refusal notice for a channel message carrying `types`, in the language of `text`. */
export function privacyNotice(types: readonly string[], text: string): string {
  const lang = noticeLanguageOf(text)
  const labels = [...new Set(types)].map((type) => privacyTypeLabel(type, lang)).join(', ')
  return interpolate(lookup(lang, 'privacy.channel.refused') ?? '', { types: labels })
}
