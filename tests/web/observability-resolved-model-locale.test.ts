// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 — the traces table shows which concrete model answered under the model
// column; the label exists in every language and carries the model id.

import { describe, it, expect } from 'vitest'
import en from '@/pages/observability/locales/en.json'
import hu from '@/pages/observability/locales/hu.json'
import de from '@/pages/observability/locales/de.json'
import es from '@/pages/observability/locales/es.json'
import fr from '@/pages/observability/locales/fr.json'
import tlh from '@/pages/observability/locales/tlh.json'

const bundles: Record<string, Record<string, string>> = { en, hu, de, es, fr, tlh }

describe('observability.col.resolvedModel', () => {
  for (const [lang, bundle] of Object.entries(bundles)) {
    it(`${lang} defines it with the {{id}} placeholder`, () => {
      expect(bundle['observability.col.resolvedModel']).toContain('{{id}}')
      expect(bundle['observability.col.resolvedModel'].replace('{{id}}', '').trim()).not.toBe('')
    })
  }

  it('an unknown key is really absent (negative control)', () => {
    expect(en).not.toHaveProperty(['observability.col.resolvedModelTypo'])
  })
})
