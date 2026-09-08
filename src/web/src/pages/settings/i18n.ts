// Registers the settings module locale bundle into the shared i18n core and
// re-exports `t`/`tOr` for the settings pages. Importing this module has the
// side effect of registering the bundle, so it must be imported before any
// settings page renders.
import { registerBundle, t, tOr } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })

export { t, tOr }
