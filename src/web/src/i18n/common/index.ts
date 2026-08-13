// Shared `common.*` keys (Save, Cancel, Delete, …) reused across every module
// instead of being redefined per module. Imported for its side effect by the
// core i18n module, so it is always registered.
import { registerBundle } from '../index'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'

registerBundle({ en, hu, de, es })
