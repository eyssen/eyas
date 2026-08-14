// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Resolve product-docs URLs for in-app contextual help (? icons).
 * Source of truth: packages/docs/help-map.json (bundled at build time).
 */
import helpMapJson from '@eyas-docs/help-map.json'
import type { Lang } from '@/stores/language-store'

export type HelpMapEntry = {
  path: string
  hash?: string | null
  description?: string
}

export type HelpMap = {
  version: number
  basePath: string
  defaultLocale: string
  locales: string[]
  entries: Record<string, HelpMapEntry>
}

const helpMap = helpMapJson as HelpMap

export function getHelpMap(): HelpMap {
  return helpMap
}

export function getHelpEntry(helpId: string): HelpMapEntry | null {
  return helpMap.entries[helpId] ?? null
}

/**
 * Build a same-origin docs URL for the given help id and UI language.
 * Example: resolveHelpUrl('agents.voice', 'hu') → '/docs/hu/agents/voice/'
 */
export function resolveHelpUrl(helpId: string, lang: Lang | string): string | null {
  const entry = getHelpEntry(helpId)
  if (!entry) return null

  const locales = helpMap.locales ?? ['en']
  const locale = locales.includes(lang) ? lang : (helpMap.defaultLocale || 'en')
  const base = (helpMap.basePath || '/docs').replace(/\/$/, '')
  const path = entry.path.replace(/^\/+|\/+$/g, '')
  let url = `${base}/${locale}/${path}/`
  if (entry.hash) {
    url += `#${entry.hash.replace(/^#/, '')}`
  }
  return url
}

/** All registered help ids (for tests / tooling). */
export function listHelpIds(): string[] {
  return Object.keys(helpMap.entries).sort()
}
