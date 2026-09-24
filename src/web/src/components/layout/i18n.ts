// Registers the app-shell (navigation) locale bundle into the shared i18n core
// and re-exports `t` for the layout components. Importing this module has the
// side effect of registering the bundle, so it must be imported before the
// sidebar renders (it is, via sidebar.tsx's import).
import { registerBundle, t } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })

export { t }
