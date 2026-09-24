// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every vocabulary the wizard translates by code — kinds, directory classes,
// candidate tags, candidate warnings, scan warnings, job phases — has one flat
// key per value in all six locale files, and no key for a value that is gone.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CANDIDATE_KINDS,
  DIRECTORY_CLASSES,
  CANDIDATE_TAG_LABELS,
  CANDIDATE_WARNINGS,
  SCAN_WARNING_CODES,
  JOB_PHASES,
} from '@modules/data-port/types'

const LOCALE_DIR = resolve(process.cwd(), 'src/web/src/pages/settings/locales')
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh']
const load = (lang: string) =>
  JSON.parse(readFileSync(resolve(LOCALE_DIR, `${lang}.json`), 'utf-8')) as Record<string, string>

const VOCABULARIES: Array<{ prefix: string; values: readonly string[]; extra?: string[] }> = [
  { prefix: 'settings.dataPort.wizard.kind.', values: CANDIDATE_KINDS, extra: ['all'] },
  { prefix: 'settings.dataPort.wizard.dirClass.', values: DIRECTORY_CLASSES },
  { prefix: 'settings.dataPort.wizard.tag.', values: CANDIDATE_TAG_LABELS },
  { prefix: 'settings.dataPort.wizard.warning.', values: CANDIDATE_WARNINGS },
  { prefix: 'settings.dataPort.scanWarning.', values: SCAN_WARNING_CODES, extra: ['legacy'] },
  { prefix: 'settings.dataPort.wizard.phase.', values: JOB_PHASES },
]

describe('wizard vocabularies ↔ locale keys', () => {
  for (const v of VOCABULARIES) {
    it(`${v.prefix} has one key per value in six languages and no orphan`, () => {
      const allowed = new Set([...v.values, ...(v.extra ?? [])])
      for (const lang of LANGS) {
        const bundle = load(lang)
        const present = Object.keys(bundle)
          .filter((k) => k.startsWith(v.prefix))
          .map((k) => k.slice(v.prefix.length))
        const missing = [...allowed].filter(
          (k) => typeof bundle[v.prefix + k] !== 'string' || !bundle[v.prefix + k],
        )
        const orphan = present.filter((k) => !allowed.has(k))
        expect({ lang, prefix: v.prefix, missing, orphan }).toEqual({
          lang,
          prefix: v.prefix,
          missing: [],
          orphan: [],
        })
      }
    })
  }

  it('has the episodic length label in the memory bundle, six languages', () => {
    const MEMORY_DIR = resolve(process.cwd(), 'src/web/src/pages/memory/locales')
    for (const lang of LANGS) {
      const bundle = JSON.parse(readFileSync(resolve(MEMORY_DIR, `${lang}.json`), 'utf-8')) as Record<
        string,
        string
      >
      expect({ lang, value: bundle['memory.episodic.chars'] }).toEqual({
        lang,
        value: expect.stringContaining('{{count}}'),
      })
      expect(load(lang)['memory.episodic.chars']).toBeUndefined()
    }
  })

  it('keeps every settings.dataPort.* key and its placeholders in all six languages', () => {
    const en = load('en')
    const keys = Object.keys(en).filter((k) => k.startsWith('settings.dataPort.'))
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
    for (const lang of LANGS.slice(1)) {
      const bundle = load(lang)
      const missing = keys.filter((k) => typeof bundle[k] !== 'string' || !bundle[k])
      const drift = keys.filter(
        (k) => bundle[k] && placeholders(bundle[k]).join() !== placeholders(en[k]!).join(),
      )
      const extra = Object.keys(bundle).filter(
        (k) => k.startsWith('settings.dataPort.') && !(k in en),
      )
      expect({ lang, missing, drift, extra }).toEqual({ lang, missing: [], drift: [], extra: [] })
    }
  })
})
