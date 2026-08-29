// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Registers the notifications locale bundle into the shared i18n core and
// re-exports `t`/`tOr`. Importing this module has the side effect of
// registering the bundle, so it must be imported before consumers render
// (e.g. components/layout/notification-bell.tsx and the settings page).
import { registerBundle, t, tOr } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })

export { t, tOr }
