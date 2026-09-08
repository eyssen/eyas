import i18next from 'i18next'
import hu from './locales/hu/common.json'
import en from './locales/en/common.json'
import fr from './locales/fr/common.json'
import tlh from './locales/tlh/common.json'

export async function initI18n(language: string = 'en') {
  await i18next.init({
    lng: language,
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      hu: { common: hu },
      en: { common: en },
      fr: { common: fr },
      tlh: { common: tlh },
    },
    interpolation: { escapeValue: false },
  })
}

export function getT() {
  return i18next.t.bind(i18next)
}

export { i18next }
