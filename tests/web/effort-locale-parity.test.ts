// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E5 — the shared effort strings exist in all six languages with the same
// {{placeholders}}, every ladder rung and source has a label, and the old
// per-page static effort labels are gone everywhere.

import { describe, it, expect } from 'vitest'
import { EFFORT_LADDER, EFFORT_SOURCES } from '@modules/model/reasoning/ladder'

import commonEn from '@/i18n/common/locales/en.json'
import commonHu from '@/i18n/common/locales/hu.json'
import commonDe from '@/i18n/common/locales/de.json'
import commonEs from '@/i18n/common/locales/es.json'
import commonFr from '@/i18n/common/locales/fr.json'
import commonTlh from '@/i18n/common/locales/tlh.json'
import provEn from '@/pages/providers/locales/en.json'
import provHu from '@/pages/providers/locales/hu.json'
import provDe from '@/pages/providers/locales/de.json'
import provEs from '@/pages/providers/locales/es.json'
import provFr from '@/pages/providers/locales/fr.json'
import provTlh from '@/pages/providers/locales/tlh.json'
import convEn from '@/pages/conversations/locales/en.json'
import convHu from '@/pages/conversations/locales/hu.json'
import convDe from '@/pages/conversations/locales/de.json'
import convEs from '@/pages/conversations/locales/es.json'
import convFr from '@/pages/conversations/locales/fr.json'
import convTlh from '@/pages/conversations/locales/tlh.json'
import agEn from '@/pages/agents/locales/en.json'
import agHu from '@/pages/agents/locales/hu.json'
import agDe from '@/pages/agents/locales/de.json'
import agEs from '@/pages/agents/locales/es.json'
import agFr from '@/pages/agents/locales/fr.json'
import agTlh from '@/pages/agents/locales/tlh.json'

type Bundle = Record<string, string>
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const

const common: Record<string, Bundle> = { en: commonEn, hu: commonHu, de: commonDe, es: commonEs, fr: commonFr, tlh: commonTlh }
const providers: Record<string, Bundle> = { en: provEn, hu: provHu, de: provDe, es: provEs, fr: provFr, tlh: provTlh }
const conversations: Record<string, Bundle> = { en: convEn, hu: convHu, de: convDe, es: convEs, fr: convFr, tlh: convTlh }
const agents: Record<string, Bundle> = { en: agEn, hu: agHu, de: agDe, es: agEs, fr: agFr, tlh: agTlh }

function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort()
}

function keysOf(bundle: Bundle, prefix: string): string[] {
  return Object.keys(bundle).filter((k) => k.startsWith(prefix)).sort()
}

describe('effort strings in six languages', () => {
  const families: Array<[string, Record<string, Bundle>, string]> = [
    ['common.effort.*', common, 'common.effort.'],
    ['providers.models.reasoning*', providers, 'providers.models.reasoning'],
  ]
  for (const [name, bundles, prefix] of families) {
    it(`${name}: identical keys and placeholders in every language, none empty`, () => {
      const reference = keysOf(bundles.en, prefix)
      expect(reference.length).toBeGreaterThan(0)
      for (const lang of LANGS) {
        expect(keysOf(bundles[lang], prefix), lang).toEqual(reference)
        for (const key of reference) {
          const value = bundles[lang][key]
          expect(value.trim().length, `${lang} ${key}`).toBeGreaterThan(0)
          expect(placeholders(value), `${lang} ${key}`).toEqual(placeholders(bundles.en[key]))
        }
      }
    })
  }

  it('every ladder rung, toggle state and effort source has a label', () => {
    for (const lang of LANGS) {
      for (const level of EFFORT_LADDER) expect(common[lang][`common.effort.level.${level}`], `${lang} ${level}`).toBeTruthy()
      for (const source of EFFORT_SOURCES) expect(common[lang][`common.effort.source.${source}`], `${lang} ${source}`).toBeTruthy()
      expect(common[lang]['common.effort.toggle.on']).toBeTruthy()
      expect(common[lang]['common.effort.toggle.off']).toBeTruthy()
    }
  })

  it('translations are real: the non-English labels differ from English', () => {
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      expect(common[lang]['common.effort.hint']).not.toBe(common.en['common.effort.hint'])
      expect(common[lang]['common.effort.level.xhigh']).not.toBe(common.en['common.effort.level.xhigh'])
      expect(providers[lang]['providers.models.reasoningNone']).not.toBe(providers.en['providers.models.reasoningNone'])
    }
  })

  it('the old static per-page effort labels are gone everywhere (negative)', () => {
    const removedConversations = ['Off', 'Auto', 'Low', 'Medium', 'High', 'Max'].map((l) => `conversations.fields.effort${l}`)
    const removedAgents = ['Auto', 'Low', 'Medium', 'High', 'Max'].map((l) => `agents.detail.effort${l}`)
    for (const lang of LANGS) {
      for (const key of removedConversations) expect(conversations[lang], `${lang} ${key}`).not.toHaveProperty([key])
      for (const key of removedAgents) expect(agents[lang], `${lang} ${key}`).not.toHaveProperty([key])
      // The hints stay, rewritten for the model-aware select.
      expect(conversations[lang]['conversations.fields.effortHint']).toBeTruthy()
      expect(agents[lang]['agents.detail.effortHint']).toBeTruthy()
    }
    expect(conversations.en['conversations.fields.effortHint']).toContain('only the levels its model offers')
  })
})
