import { registerBundle, t, tOr } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })

export { t, tOr }

/** Display name for a seed project type; falls back to the stored name. */
export function seedTypeName(id: string, fallback: string): string {
  return tOr(`projects.types.seed.${id}.name`, fallback)
}

/** Short seed-type blurb for the types list. Empty when the type is not a known seed. */
export function seedTypeDescription(id: string): string {
  return tOr(`projects.types.seed.${id}.description`, '')
}
