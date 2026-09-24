// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// C9 — the traces table labels each background call with its purpose group
// and filters by it. The web's group list must be exactly the backend's (a
// group the web does not know would print a raw key or be unfilterable), and
// every label ships in all six languages.

import { describe, it, expect } from 'vitest'
import { PURPOSE_ALL, PURPOSE_GROUPS } from '@/pages/observability/purpose-groups'
import { TRACE_PURPOSE_GROUPS } from '@modules/observability/trace-collector'
import en from '@/pages/observability/locales/en.json'
import hu from '@/pages/observability/locales/hu.json'
import de from '@/pages/observability/locales/de.json'
import es from '@/pages/observability/locales/es.json'
import fr from '@/pages/observability/locales/fr.json'
import tlh from '@/pages/observability/locales/tlh.json'

const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }

const KEYS = [
  'observability.col.purpose',
  'observability.filter.purposeAll',
  ...PURPOSE_GROUPS.map((g) => `observability.purpose.${g}`),
]

describe('observability purpose groups', () => {
  it('the web list is exactly the backend filter enum, in the same order', () => {
    expect([...PURPOSE_GROUPS]).toEqual([...TRACE_PURPOSE_GROUPS])
    expect(PURPOSE_GROUPS).not.toContain(PURPOSE_ALL)
  })

  for (const [lang, bundle] of Object.entries(bundles)) {
    it(`${lang} labels the column, the "all" option and every group`, () => {
      const missing = KEYS.filter((k) => typeof bundle[k] !== 'string' || !bundle[k].trim())
      expect(missing).toEqual([])
    })
  }

  it('a group label that is not defined is really absent (negative control)', () => {
    expect(en).not.toHaveProperty(['observability.purpose.conversation'])
    expect(en).not.toHaveProperty(['observability.purpose.all'])
  })
})
