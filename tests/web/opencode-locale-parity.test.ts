// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src/web/src/pages/opencode/locales')
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const

function keys(lang: string): string[] {
  return Object.keys(JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf8')) as Record<string, string>).sort()
}

describe('opencode locale parity', () => {
  it('keeps the same keys in all six languages', () => {
    const ref = keys('en')
    expect(ref.length).toBeGreaterThan(5)
    for (const lang of LANGS) {
      expect(keys(lang), lang).toEqual(ref)
    }
  })
})
