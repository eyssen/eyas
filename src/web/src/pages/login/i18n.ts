import { registerBundle, t } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'

registerBundle({ en, hu, de, es })

export { t }
