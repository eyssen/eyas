// Shared i18n core. Modules register their namespaced locale bundles here at
// import time and call `t('namespace.key')` in components. English is the
// source; hu/de/es are translation layers with per-key English fallback.
//
// Reactivity: the active language lives in `stores/language-store` and is
// applied to `document.documentElement.lang`; `App` re-keys the router on the
// language so the whole tree re-renders and every `t()` re-reads. `t()` is a
// plain function (not a hook) so it can be used anywhere, including outside
// React render.
import { useLanguageStore, type Lang } from '@/stores/language-store'
// Side-effect import: registers the shared `common.*` bundle so it's always
// available, without every module having to import it explicitly. `./common`
// imports `registerBundle` back from this module, so `registry` below is a
// `var` (not `let`/`const`): a circular import can call `registerBundle`
// before this module's own top-level statements have run, and `let`/`const`
// stay in their temporal dead zone until their declaration line executes —
// `var` is hoisted with an initial `undefined` value instead, so it's safe to
// read regardless of import evaluation order. (This only surfaces under real
// ESM evaluation order, e.g. the Vite dev server; production bundlers can
// happen to reorder things and mask it.)
import './common'

type Dict = Record<string, string>
var registry: Record<Lang, Dict> | undefined

function getRegistry(): Record<Lang, Dict> {
  if (!registry) registry = { en: {}, hu: {}, de: {}, es: {} }
  return registry
}

/**
 * Merge a module's locale bundles into the global registry. Call once at module
 * load, before render. Keys must be namespaced (e.g. `"nav.dashboard"`) to avoid
 * collisions across modules.
 */
export function registerBundle(bundles: Partial<Record<Lang, Dict>>): void {
  const reg = getRegistry()
  ;(Object.keys(bundles) as Lang[]).forEach((lang) => {
    const b = bundles[lang]
    if (b) Object.assign(reg[lang], b)
  })
}

function interpolate(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`))
}

/**
 * Translate a namespaced key in the active language, falling back to English,
 * then to the raw key. `vars` fill `{{placeholders}}`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useLanguageStore.getState().lang
  const reg = getRegistry()
  const raw = reg[lang]?.[key] ?? reg.en[key] ?? key
  return interpolate(raw, vars)
}

/**
 * Like `t()`, but fall back to a caller-supplied string when the key is unknown
 * in both the active and English bundles. Use for server-provided text that may
 * not have a translation key yet.
 */
export function tOr(key: string, fallback: string, vars?: Record<string, string | number>): string {
  const lang = useLanguageStore.getState().lang
  const reg = getRegistry()
  const raw = reg[lang]?.[key] ?? reg.en[key]
  return interpolate(raw ?? fallback, vars)
}
