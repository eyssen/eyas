import { create } from 'zustand'

export type Lang = 'en' | 'hu' | 'de' | 'es' | 'fr' | 'tlh'

// The languages the app offers. English is the source; the rest are translation
// layers. Per project policy every new field/label ships in all six — but a
// module whose bundle is missing a language simply falls back to English at
// runtime, so adding a language here never crashes an un-translated module.
export const SUPPORTED_LANGS: Lang[] = ['en', 'hu', 'de', 'es', 'fr', 'tlh']
export const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  hu: 'Magyar',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  tlh: 'tlhIngan Hol',
}
export const LANG_SHORT: Record<Lang, string> = {
  en: 'EN',
  hu: 'HU',
  de: 'DE',
  es: 'ES',
  fr: 'FR',
  tlh: 'TLH',
}

function isLang(v: string | null | undefined): v is Lang {
  return v === 'en' || v === 'hu' || v === 'de' || v === 'es' || v === 'fr' || v === 'tlh'
}

/**
 * First-run language: honor a previously stored explicit choice; otherwise
 * detect the browser language and use it only if we support it; otherwise fall
 * back to English. This is the single decision — applied consistently to BOTH
 * the setup wizard and the running app — so the two can never disagree.
 */
export function resolveInitialLang(): Lang {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('eyas-lang') : null
  if (isLang(stored)) return stored
  const nav = typeof navigator !== 'undefined' ? navigator.language?.toLowerCase() : ''
  const detected = SUPPORTED_LANGS.find((l) => l !== 'en' && nav?.startsWith(l))
  return detected ?? 'en'
}

/**
 * Write the chosen language to the one place every module's i18n `t()` reads
 * first — `document.documentElement.lang` — and persist it. Setting this is
 * what makes all the per-module bundles resolve to the same language.
 */
export function applyLang(lang: Lang) {
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  if (typeof localStorage !== 'undefined') localStorage.setItem('eyas-lang', lang)
}

const initialLang = resolveInitialLang()
// Apply eagerly at module load so the very first render of any `t()` is already
// on the right language (before React mounts).
applyLang(initialLang)

interface LanguageState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export const useLanguageStore = create<LanguageState>((set) => ({
  lang: initialLang,
  setLang: (lang: Lang) => {
    applyLang(lang)
    set({ lang })
  },
}))
