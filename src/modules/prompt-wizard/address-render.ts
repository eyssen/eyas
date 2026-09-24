import type { AddressForm } from './types.js'

export type SupportedLang = 'hu' | 'en' | 'de' | 'fr' | 'tlh'

const ADDRESS_RENDER_BY_LANG: Record<SupportedLang, Record<AddressForm, string>> = {
  hu: {
    tegező: 'Use "te" / second-person singular',
    magázó: 'Use "Ön" / formal "you"',
    önöző: 'Use "ön" / softer formal',
    'kontextus-érzékeny': 'Mirror the addresser; default to "Ön" if first contact',
  },
  en: {
    tegező: 'Use casual "you" — no titles',
    magázó: 'Use formal address — Mr./Ms., professional distance',
    önöző: 'Same as magázó (English has no equivalent)',
    'kontextus-érzékeny': 'Mirror addresser register; default formal',
  },
  de: {
    tegező: 'Use "du"',
    magázó: 'Use "Sie"',
    önöző: 'Use "Sie" with extra politeness',
    'kontextus-érzékeny': 'Mirror; default "Sie"',
  },
  fr: {
    tegező: 'Use "tu"',
    magázó: 'Use "vous"',
    önöző: 'Use "vous" with extra politeness',
    'kontextus-érzékeny': 'Mirror; default "vous"',
  },
  tlh: {
    tegező: 'Use blunt second person — no honorifics',
    magázó: 'Use formal address — titles and distance',
    önöző: 'Same as magázó (Klingon has no softer formal)',
    'kontextus-érzékeny': 'Mirror addresser register; default formal',
  },
}

export function renderAddress(form: AddressForm, lang: SupportedLang): string {
  return ADDRESS_RENDER_BY_LANG[lang][form]
}

export function renderAddressForAllLanguages(form: AddressForm): string {
  return Object.entries(ADDRESS_RENDER_BY_LANG)
    .map(([lang, table]) => `[${lang}] ${table[form]}`)
    .join('\n')
}
