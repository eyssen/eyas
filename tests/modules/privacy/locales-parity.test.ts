// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The privacy module's backend locales (the channel refusal notice): the six
// product languages, identical key sets and identical {{placeholder}} sets,
// and a label for every built-in PII type.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_PII_TYPES } from '@modules/privacy/types'

const DIR = join(process.cwd(), 'src/modules/privacy/locales')
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const

function load(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf-8'))
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort()
}

describe('privacy backend locales', () => {
  const en = load('en')

  it('has a label for every built-in type, the custom type and the channel notice', () => {
    for (const type of BUILTIN_PII_TYPES) expect(en[`privacy.type.${type}`]).toBeTruthy()
    expect(placeholders(en['privacy.type.custom']!)).toEqual(['type'])
    expect(placeholders(en['privacy.channel.refused']!)).toEqual(['types'])
  })

  for (const lang of LANGS) {
    it(`${lang}: same keys and placeholders as en, no empty value`, () => {
      const bundle = load(lang)
      expect(Object.keys(bundle).sort()).toEqual(Object.keys(en).sort())
      for (const [key, value] of Object.entries(bundle)) {
        expect(typeof value).toBe('string')
        expect(value.trim().length, `${lang} ${key}`).toBeGreaterThan(0)
        expect(placeholders(value), `${lang} ${key}`).toEqual(placeholders(en[key]!))
      }
    })
  }

  it('no key is repeated in a file (JSON.parse would hide it)', () => {
    for (const lang of LANGS) {
      const raw = readFileSync(join(DIR, `${lang}.json`), 'utf-8')
      const keys = [...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1])
      expect(new Set(keys).size, lang).toBe(keys.length)
    }
  })
})
