// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { registerBundle, t, tOr } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })

export { t, tOr }

/** A PII type's localized label; a custom pattern's type is shown with its slug. */
export function typeLabel(type: string): string {
  return tOr(`privacy.type.${type}`, t('privacy.type.custom', { type }), { type })
}

/** What a built-in type covers, in one line (empty for a custom type). */
export function typeHint(type: string): string {
  return tOr(`privacy.type.${type}.hint`, '')
}
