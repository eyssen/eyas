// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Registers the memory locale bundle into the shared i18n core and re-exports
// `t`/`tOr` for the module's components. Importing this module has the side
// effect of registering the bundle, so it must be imported before the
// components render (it is, via each component's import).
import { registerBundle, t, tOr } from '@/i18n'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'

registerBundle({ en, hu, de, es })

export { t, tOr }
