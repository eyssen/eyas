// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Web i18n parity guard — the frontend counterpart to
 * tests/core/i18n-parity.test.ts. CLAUDE.md mandates en+hu+de+es for every
 * user-facing string; this test enforces the structural contract for every
 * module-local `locales/` bundle under src/web/src: exactly the four
 * required languages, identical flat keys, identical {{placeholder}} sets,
 * all measured against the English reference.
 *
 * Extends automatically: any new `locales/` directory dropped anywhere
 * under src/web/src is picked up and checked without config changes.
 */

const WEB_SRC_DIR = join(process.cwd(), 'src/web/src')
const REQUIRED_LANGS = ['en', 'hu', 'de', 'es'] as const
const REFERENCE_LANG = 'en'
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist'])

interface FlatEntry {
  path: string
  placeholders: string[]
}

function extractPlaceholders(s: string): string[] {
  // i18next double-brace interpolation: {{name}}, {{count}}, etc.
  const set = new Set<string>()
  const re = /\{\{(\w+)\}\}/g
  let m: ReturnType<RegExp['exec']>
  while ((m = re.exec(s)) !== null) set.add(m[1])
  return [...set].sort()
}

function flatten(obj: unknown, prefix = ''): FlatEntry[] {
  if (obj === null || typeof obj !== 'object') return []
  const out: FlatEntry[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      out.push({ path, placeholders: extractPlaceholders(v) })
    } else if (typeof v === 'object' && v !== null) {
      out.push(...flatten(v, path))
    }
  }
  return out
}

/** Recursively find every directory named `locales` under `dir`. */
function findLocalesDirs(dir: string): string[] {
  const out: string[] = []
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIR_NAMES.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.name === 'locales') {
      out.push(full)
    } else {
      out.push(...findLocalesDirs(full))
    }
  }
  return out
}

function listBundleLangs(localesDir: string): string[] {
  return readdirSync(localesDir)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
}

function loadBundle(localesDir: string, lang: string): FlatEntry[] {
  const raw = readFileSync(join(localesDir, `${lang}.json`), 'utf-8')
  return flatten(JSON.parse(raw))
}

describe('web i18n locale parity', () => {
  const localesDirs = findLocalesDirs(WEB_SRC_DIR).sort()

  it('finds at least one locales bundle under src/web/src', () => {
    expect(localesDirs.length).toBeGreaterThan(0)
  })

  for (const localesDir of localesDirs) {
    const bundleLabel = relative(WEB_SRC_DIR, localesDir)

    describe(`bundle '${bundleLabel}'`, () => {
      it('contains exactly en, hu, de, es .json files', () => {
        expect(listBundleLangs(localesDir)).toEqual([...REQUIRED_LANGS].sort())
      })

      // Guard: only attempt key/placeholder parity when the bundle actually
      // has the reference file — the "contains exactly" check above already
      // fails loudly for a malformed bundle, so this just avoids a crash
      // during test collection for a bundle missing en.json.
      if (listBundleLangs(localesDir).includes(REFERENCE_LANG)) {
        const refEntries = loadBundle(localesDir, REFERENCE_LANG)
        const refByPath = new Map(refEntries.map(e => [e.path, e]))

        for (const lang of REQUIRED_LANGS) {
          if (lang === REFERENCE_LANG) continue

          it(`${lang} has the same keys as ${REFERENCE_LANG}`, () => {
            const langEntries = loadBundle(localesDir, lang)
            const langByPath = new Map(langEntries.map(e => [e.path, e]))

            const missing = [...refByPath.keys()].filter(k => !langByPath.has(k))
            const extra = [...langByPath.keys()].filter(k => !refByPath.has(k))

            expect(missing, `keys missing from ${lang}`).toEqual([])
            expect(extra, `keys in ${lang} not present in ${REFERENCE_LANG}`).toEqual([])
          })

          it(`${lang} placeholders match ${REFERENCE_LANG} for every key`, () => {
            const langEntries = loadBundle(localesDir, lang)
            const mismatches: string[] = []
            for (const entry of langEntries) {
              const refEntry = refByPath.get(entry.path)
              if (!refEntry) continue // presence is checked by the other test
              const refSet = refEntry.placeholders.join(',')
              const langSet = entry.placeholders.join(',')
              if (refSet !== langSet) {
                mismatches.push(`${entry.path}: ${REFERENCE_LANG}=[${refSet}] vs ${lang}=[${langSet}]`)
              }
            }
            expect(mismatches).toEqual([])
          })
        }
      }
    })
  }
})
