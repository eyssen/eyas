// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Web i18n parity guard — the frontend counterpart to
 * tests/core/i18n-parity.test.ts. CLAUDE.md mandates
 * en+hu+de+es+fr+tlh for every user-facing string; this test enforces the
 * structural contract for every module-local `locales/` bundle under
 * src/web/src: exactly the six required languages, identical flat keys,
 * identical {{placeholder}} sets, all measured against the English reference,
 * and no key repeated in a file's raw text (JSON.parse would hide it).
 *
 * Extends automatically: any new `locales/` directory dropped anywhere
 * under src/web/src is picked up and checked without config changes.
 */

const WEB_SRC_DIR = join(process.cwd(), 'src/web/src')
const REQUIRED_LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const
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

interface DuplicateKey {
  path: string
  line: number
  firstLine: number
}

type ScanFrame =
  | { kind: 'object'; path: string; keys: Map<string, number>; expectKey: boolean; lastKey: string | null }
  | { kind: 'array'; path: string }

/**
 * Raw-text duplicate-key scan. JSON.parse silently keeps the last value of a
 * repeated key, so the parity checks (which parse) cannot see duplicates.
 * This walks the source text and reports every key that repeats inside the
 * same object, at any nesting depth. Keys are compared after JSON unescaping.
 * Expects well-formed JSON.
 */
function findDuplicateKeys(raw: string): DuplicateKey[] {
  const stack: ScanFrame[] = []
  const out: DuplicateKey[] = []
  let line = 1
  let i = 0

  const childPath = (): string => {
    const top = stack[stack.length - 1]
    if (!top) return ''
    if (top.kind === 'array') return `${top.path}[]`
    const segment = top.lastKey ?? ''
    return top.path ? `${top.path}.${segment}` : segment
  }

  while (i < raw.length) {
    const ch = raw[i]
    if (ch === '\n') {
      line++
      i++
      continue
    }
    if (ch === '"') {
      // Valid JSON strings hold no raw newlines, so the line counter is safe.
      const start = i++
      while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1
      i++
      const top = stack[stack.length - 1]
      if (top?.kind === 'object' && top.expectKey) {
        const key = JSON.parse(raw.slice(start, i)) as string
        const firstLine = top.keys.get(key)
        if (firstLine !== undefined) {
          out.push({ path: top.path ? `${top.path}.${key}` : key, line, firstLine })
        } else {
          top.keys.set(key, line)
        }
        top.expectKey = false
        top.lastKey = key
      }
      continue
    }
    if (ch === '{') {
      stack.push({ kind: 'object', path: childPath(), keys: new Map(), expectKey: true, lastKey: null })
    } else if (ch === '[') {
      stack.push({ kind: 'array', path: childPath() })
    } else if (ch === '}' || ch === ']') {
      stack.pop()
    } else if (ch === ',') {
      const top = stack[stack.length - 1]
      if (top?.kind === 'object') top.expectKey = true
    }
    i++
  }
  return out
}

function formatDuplicate(d: DuplicateKey): string {
  return `${d.path} (line ${d.line}, first at line ${d.firstLine})`
}

describe('raw duplicate-key scan', () => {
  it('flags a repeated top-level key with both line numbers', () => {
    const raw = '{\n  "a": "x",\n  "b": "y",\n  "a": "z"\n}\n'
    expect(findDuplicateKeys(raw)).toEqual([{ path: 'a', line: 4, firstLine: 2 }])
  })

  it('flags a repeated key inside a nested object with its full path', () => {
    const raw = '{"outer": {"inner": {"k": 1, "k": 2}}}'
    expect(findDuplicateKeys(raw).map(d => d.path)).toEqual(['outer.inner.k'])
  })

  it('compares keys after unescaping', () => {
    expect(findDuplicateKeys('{"a": 1, "\\u0061": 2}').map(d => d.path)).toEqual(['a'])
  })

  it('flags every repetition, not only the first', () => {
    expect(findDuplicateKeys('{"a": 1, "a": 2, "a": 3}')).toHaveLength(2)
  })

  it('does not flag equal keys in sibling objects or array elements', () => {
    const raw = '{"x": {"k": 1}, "y": {"k": 2}, "list": [{"k": 1}, {"k": 2}]}'
    expect(findDuplicateKeys(raw)).toEqual([])
  })

  it('does not treat string values as keys, even with quotes, colons or braces inside', () => {
    const raw = '{"a": "a", "b": "\\"a\\": {", "c": ["a", "a"], "d": "}, \\"a\\": 1"}'
    expect(findDuplicateKeys(raw)).toEqual([])
  })

  it('ends a string at a quote preceded by an escaped backslash', () => {
    // Value is `x\`; the key after it must still be read as a key.
    expect(findDuplicateKeys('{"a": "x\\\\", "a": 1}').map(d => d.path)).toEqual(['a'])
  })
})

describe('web i18n locale parity', () => {
  const localesDirs = findLocalesDirs(WEB_SRC_DIR).sort()

  it('finds at least one locales bundle under src/web/src', () => {
    expect(localesDirs.length).toBeGreaterThan(0)
  })

  for (const localesDir of localesDirs) {
    const bundleLabel = relative(WEB_SRC_DIR, localesDir)

    describe(`bundle '${bundleLabel}'`, () => {
      it('contains exactly en, hu, de, es, fr, tlh .json files', () => {
        expect(listBundleLangs(localesDir)).toEqual([...REQUIRED_LANGS].sort())
      })

      for (const lang of listBundleLangs(localesDir)) {
        it(`${lang}.json has no duplicate keys in its raw text`, () => {
          const raw = readFileSync(join(localesDir, `${lang}.json`), 'utf-8')
          expect(findDuplicateKeys(raw).map(formatDuplicate)).toEqual([])
        })
      }

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
