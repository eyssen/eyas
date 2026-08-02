// Part of eYssen. See LICENSE file for full copyright and licensing details.
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'

type Lang = 'en' | 'hu' | 'de' | 'es'
const bundles: Record<Lang, Record<string, string>> = { en, hu, de, es }
const SUPPORTED: Lang[] = ['en', 'hu', 'de', 'es']

function detectLang(): Lang {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement.lang?.toLowerCase()
    if (lang && (SUPPORTED as string[]).includes(lang)) return lang as Lang
  }
  if (typeof navigator !== 'undefined') {
    const nav = navigator.language?.toLowerCase()
    const hit = SUPPORTED.find((l) => l !== 'en' && nav?.startsWith(l))
    if (hit) return hit
  }
  return 'en'
}

function interpolate(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`))
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = detectLang()
  // Fall back to English for any key missing in the active language's bundle.
  const raw = bundles[lang]?.[key] ?? bundles.en[key] ?? key
  return interpolate(raw, vars)
}

/**
 * Translate `key`, but fall back to a caller-supplied string (typically the
 * backend-provided English text) when the key is absent from BOTH the active
 * language bundle and the English bundle. Used for setup-step titles, field
 * labels, etc. that originate in the server-side step registry.
 */
export function tOr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  const lang = detectLang()
  const raw = bundles[lang]?.[key] ?? bundles.en[key]
  return interpolate(raw ?? fallback, vars)
}
