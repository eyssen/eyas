// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src/web/src/pages/opencode/locales')
const LANGS = ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const

function bundle(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf8')) as Record<string, string>
}

function keys(lang: string): string[] {
  return Object.keys(bundle(lang)).sort()
}

/** Isolation / server check texts and the sign-in hint (A10). */
const ISOLATION_KEYS = [
  'opencode.check.cli.label',
  'opencode.check.version.label',
  'opencode.check.pty.label',
  'opencode.check.attach.label',
  'opencode.check.attach.detailSpawn',
  'opencode.check.attach.detailExternal',
  'opencode.check.isolation.label',
  'opencode.check.isolation.detail',
  'opencode.check.isolation.detailExternal',
  'opencode.signIn.hint',
] as const

/** Model and reasoning card (F12). */
const MODEL_SETTINGS_KEYS = [
  'opencode.settings.title',
  'opencode.settings.hint',
  'opencode.settings.model',
  'opencode.settings.modelDefault',
  'opencode.settings.modelMissing',
  'opencode.settings.variant',
  'opencode.settings.variantDefault',
  'opencode.settings.save',
  'opencode.settings.saved',
  'opencode.settings.serverNotRunning',
  'opencode.settings.modelsUnavailable',
] as const

describe('opencode locale parity', () => {
  it('keeps the same keys in all six languages', () => {
    const ref = keys('en')
    expect(ref.length).toBeGreaterThan(5)
    for (const lang of LANGS) {
      expect(keys(lang), lang).toEqual(ref)
    }
  })

  it('has a non-empty text for every isolation key in all six languages', () => {
    for (const lang of LANGS) {
      const b = bundle(lang)
      for (const key of ISOLATION_KEYS) {
        expect(typeof b[key] === 'string' && b[key]!.trim().length > 0, `${lang}:${key}`).toBe(true)
      }
      // The external-server text names the URL it is attached to.
      expect(b['opencode.check.attach.detailExternal'], lang).toContain('{{url}}')
    }
  })

  it('translates the long isolation texts instead of copying English', () => {
    const en = bundle('en')
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      const b = bundle(lang)
      for (const key of ['opencode.check.isolation.detail', 'opencode.check.attach.detailExternal', 'opencode.signIn.hint']) {
        expect(b[key], `${lang}:${key}`).not.toBe(en[key])
      }
    }
  })

  it('has every model-and-reasoning key, translated, with the same placeholders in all six languages', () => {
    const en = bundle('en')
    const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort()
    for (const lang of LANGS) {
      const b = bundle(lang)
      for (const key of MODEL_SETTINGS_KEYS) {
        expect(typeof b[key] === 'string' && b[key]!.trim().length > 0, `${lang}:${key}`).toBe(true)
        expect(placeholders(b[key]!), `${lang}:${key}`).toEqual(placeholders(en[key]!))
      }
      expect(b['opencode.settings.modelMissing'], lang).toContain('{{model}}')
      if (lang === 'en') continue
      for (const key of ['opencode.settings.hint', 'opencode.settings.serverNotRunning', 'opencode.settings.modelsUnavailable']) {
        expect(b[key], `${lang}:${key}`).not.toBe(en[key])
      }
    }
  })
})

