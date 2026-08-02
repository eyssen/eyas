import i18next from 'i18next'
import hu from './locales/hu/common.json'
import en from './locales/en/common.json'

export async function initI18n(language: string = 'en') {
  await i18next.init({
    lng: language,
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      hu: { common: hu },
      en: { common: en },
    },
    interpolation: { escapeValue: false },
  })
}

export function getT() {
  return i18next.t.bind(i18next)
}

export { i18next }
