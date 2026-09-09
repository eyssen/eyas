// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every user-facing string in the wizard ships in all six languages. A key that
// exists only in English is a half-translated screen; a placeholder set that
// drifts between languages is a "{{count}}" printed at the owner.
import { readFileSync } from 'node:fs'
import { stripComments } from '../helpers/strip-comments'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import {
  CANDIDATE_KINDS,
  CANDIDATE_TAG_LABELS,
  CANDIDATE_TARGETS,
  CANDIDATE_WARNINGS,
  DIRECTORY_CLASSES,
  JOB_PHASES,
  KIND_ORDER,
  SCAN_WARNING_CODES,
} from '@/pages/settings/data-port-types'

const LOCALES = ['en', 'hu', 'de', 'es', 'fr', 'tlh']
const DIR = resolve(process.cwd(), 'src/web/src/pages/settings/locales')
const load = (lang: string) => JSON.parse(readFileSync(resolve(DIR, `${lang}.json`), 'utf-8')) as Record<string, string>
const placeholders = (s: string) =>
  [...s.matchAll(/\{\{(\w+)\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join()

it('keeps every settings.dataPort.* key and placeholder set in all six languages', () => {
  const en = load('en')
  const keys = Object.keys(en).filter((k) => k.startsWith('settings.dataPort.'))
  expect(keys.length).toBeGreaterThan(0)
  for (const lang of LOCALES.slice(1)) {
    const bundle = load(lang)
    const missing = keys.filter((k) => typeof bundle[k] !== 'string' || !bundle[k])
    const drift = keys.filter((k) => bundle[k] && placeholders(bundle[k]!) !== placeholders(en[k]!))
    const extra = Object.keys(bundle).filter((k) => k.startsWith('settings.dataPort.') && !(k in en))
    expect({ lang, missing, drift, extra }).toEqual({ lang, missing: [], drift: [], extra: [] })
  }
  for (const k of KIND_ORDER) expect(typeof en[`settings.dataPort.wizard.kind.${k}`]).toBe('string')
})

it('has a label for every vocabulary the wizard renders from a machine code', () => {
  const en = load('en')
  const want = [
    ...CANDIDATE_TAG_LABELS.map((t) => `settings.dataPort.wizard.tag.${t}`),
    ...CANDIDATE_WARNINGS.map((w) => `settings.dataPort.wizard.warning.${w}`),
    ...DIRECTORY_CLASSES.map((d) => `settings.dataPort.wizard.dirClass.${d}`),
    ...SCAN_WARNING_CODES.map((c) => `settings.dataPort.scanWarning.${c}`),
    ...JOB_PHASES.map((p) => `settings.dataPort.wizard.phase.${p}`),
  ]
  expect(want.filter((k) => typeof en[k] !== 'string')).toEqual([])
})

/**
 * `data-port-types.ts` hand-copies the server's vocabularies because the web
 * app is a separate package. Nothing but this keeps them in step: a kind or a
 * directory class added on the server would otherwise never reach the wizard's
 * kind strip or its filters, silently.
 */
it('carries the same vocabularies as the server module', () => {
  // Comments blanked FIRST. The extractor below reads quoted strings, and a doc
  // comment is prose: "A cloud provider's sync root" opened a quote and six
  // lines of English were read as array members. Stripping the comments fixes
  // the class — rewording that one sentence would break again the next time
  // anyone writes "doesn't" beside an array.
  const source = stripComments(
    readFileSync(resolve(process.cwd(), 'src/modules/data-port/types.ts'), 'utf-8'),
  )
  const serverArray = (name: string): string[] => {
    const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(source)
    expect(m, `${name} not found in the server types`).toBeTruthy()
    return [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!)
  }
  const pairs: Array<[string, readonly string[]]> = [
    ['CANDIDATE_KINDS', CANDIDATE_KINDS],
    ['CANDIDATE_TARGETS', CANDIDATE_TARGETS],
    ['DIRECTORY_CLASSES', DIRECTORY_CLASSES],
    ['CANDIDATE_TAG_LABELS', CANDIDATE_TAG_LABELS],
    ['CANDIDATE_WARNINGS', CANDIDATE_WARNINGS],
    ['SCAN_WARNING_CODES', SCAN_WARNING_CODES],
    ['JOB_PHASES', JOB_PHASES],
  ]
  for (const [name, web] of pairs) expect({ name, web: [...web] }).toEqual({ name, web: serverArray(name) })
  // KIND_ORDER is a display order, so it may differ in sequence — never in membership.
  expect([...KIND_ORDER].sort()).toEqual([...CANDIDATE_KINDS].sort())
})
