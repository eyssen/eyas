// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Phase-5 i18n parity guard.
 *
 * CLAUDE.md mandates Hungarian translations for every user-facing string.
 * This test enforces the structural contract: every key present in one
 * locale MUST exist in the other with the same placeholder set (e.g. if
 * HU has \u007b\u007bname\u007d\u007d in a template, EN must too).
 * Without this guard, dropping a key in one language surfaces as a silent
 * fallback at runtime instead of a failed build.
 *
 * Extends automatically: new languages dropped into locales/ are picked
 * up and checked against HU (the reference / most-complete locale).
 */

const LOCALES_DIR = join(process.cwd(), 'src/core/i18n/locales')
const REFERENCE_LANG = 'en' // English is the neutral reference locale; other locales must reach parity with it.

interface FlatEntry {
  path: string
  value: string
  placeholders: string[]
}

/** Flatten a nested locale object into foo.bar.baz paths. */
function flatten(obj: unknown, prefix = ''): FlatEntry[] {
  if (obj === null || typeof obj !== 'object') return []
  const out: FlatEntry[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      out.push({
        path,
        value: v,
        placeholders: extractPlaceholders(v),
      })
    } else if (typeof v === 'object' && v !== null) {
      out.push(...flatten(v, path))
    }
  }
  return out
}

function extractPlaceholders(s: string): string[] {
  // i18next double-brace interpolation: {{name}}, {{count}}, etc.
  // Matched with a simple regex and returned sorted for stable diffs.
  const set = new Set<string>()
  const re = /\{\{(\w+)\}\}/g
  let m: ReturnType<RegExp['exec']>
  while ((m = re.exec(s)) !== null) set.add(m[1])
  return [...set].sort()
}

function loadLocale(lang: string, ns: string): FlatEntry[] {
  const file = join(LOCALES_DIR, lang, `${ns}.json`)
  const raw = readFileSync(file, 'utf-8')
  return flatten(JSON.parse(raw))
}

/** List all languages present under src/core/i18n/locales/. */
function listLanguages(): string[] {
  if (!existsSync(LOCALES_DIR)) return []
  return readdirSync(LOCALES_DIR)
    .filter(name => {
      try { return statSync(join(LOCALES_DIR, name)).isDirectory() }
      catch { return false }
    })
    .sort()
}

/** List all namespaces (json files) under a language directory. */
function listNamespaces(lang: string): string[] {
  return readdirSync(join(LOCALES_DIR, lang))
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
}

describe('i18n locale parity', () => {
  const languages = listLanguages()

  it('has at least the reference language and one additional translation', () => {
    expect(languages).toContain(REFERENCE_LANG)
    expect(languages.length).toBeGreaterThanOrEqual(2)
  })

  it('all languages ship the same namespaces as the reference', () => {
    const refNs = listNamespaces(REFERENCE_LANG).sort()
    for (const lang of languages) {
      if (lang === REFERENCE_LANG) continue
      const ns = listNamespaces(lang).sort()
      expect(ns, `${lang} namespaces should match ${REFERENCE_LANG}`).toEqual(refNs)
    }
  })

  // Per-namespace parity: every key in HU must exist in every other lang
  // with matching placeholder sets, and vice versa.
  const referenceNamespaces = listNamespaces(REFERENCE_LANG)
  for (const ns of referenceNamespaces) {
    describe(`namespace '${ns}'`, () => {
      const refEntries = loadLocale(REFERENCE_LANG, ns)
      const refByPath = new Map(refEntries.map(e => [e.path, e]))

      for (const lang of languages) {
        if (lang === REFERENCE_LANG) continue
        it(`${lang} has the same keys as ${REFERENCE_LANG}`, () => {
          const langEntries = loadLocale(lang, ns)
          const langByPath = new Map(langEntries.map(e => [e.path, e]))

          const missingInLang = [...refByPath.keys()].filter(k => !langByPath.has(k))
          const extraInLang = [...langByPath.keys()].filter(k => !refByPath.has(k))

          expect(missingInLang, `keys missing from ${lang}`).toEqual([])
          expect(extraInLang, `keys in ${lang} not present in ${REFERENCE_LANG}`).toEqual([])
        })

        it(`${lang} placeholders match ${REFERENCE_LANG} for every key`, () => {
          const langEntries = loadLocale(lang, ns)
          const mismatches: string[] = []
          for (const entry of langEntries) {
            const refEntry = refByPath.get(entry.path)
            if (!refEntry) continue // presence is checked by the other test
            const refSet = refEntry.placeholders.join(',')
            const langSet = entry.placeholders.join(',')
            if (refSet !== langSet) {
              mismatches.push(
                `${entry.path}: ${REFERENCE_LANG}=[${refSet}] vs ${lang}=[${langSet}]`,
              )
            }
          }
          expect(mismatches).toEqual([])
        })
      }
    })
  }
})
