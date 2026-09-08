// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The reason-code vocabulary is the one thing the importer and the settings UI
// have to agree on letter for letter: the runner counts an outcome under a code
// and the card renders `settings.dataPort.reason.<code>`. A code added at a call
// site without its key reaches the operator as raw English prose in all six
// languages, which is exactly what the six locale files exist to prevent.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REASON_CODES, reasonPrefix } from '@modules/data-port/types'

const LOCALE_DIR = resolve(process.cwd(), 'src/web/src/pages/settings/locales')

/** The locale files are flat maps of dotted keys, not a nested tree. */
const PREFIX = 'settings.dataPort.reason.'

function reasonKeys(language: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(resolve(LOCALE_DIR, `${language}.json`), 'utf-8')) as Record<
    string,
    unknown
  >
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith(PREFIX)) out[key.slice(PREFIX.length)] = value
  }
  return out
}

describe('reason codes ↔ locale keys', () => {
  it('gives every code in the vocabulary an English label', () => {
    const en = reasonKeys('en')
    const missing = REASON_CODES.filter((code) => typeof en[code] !== 'string' || !en[code])
    expect(missing).toEqual([])
  })

  it('carries no label for a code the importer can never emit', () => {
    // The other direction: a key left behind by a renamed code is dead weight
    // the translators keep carrying into five more files.
    const known = new Set<string>(REASON_CODES)
    expect(Object.keys(reasonKeys('en')).filter((k) => !known.has(k))).toEqual([])
  })

  it('translates the whole vocabulary in all six languages', () => {
    for (const language of ['en', 'hu', 'de', 'es', 'fr', 'tlh']) {
      const keys = reasonKeys(language)
      const missing = REASON_CODES.filter((code) => typeof keys[code] !== 'string' || !keys[code])
      expect({ language, missing }).toEqual({ language, missing: [] })
    }
  })

  it('holds the codes the runner and the scanner actually emit', () => {
    // A spot check, so a wholesale rewrite of the list cannot make the parity
    // tests above pass by emptying it.
    for (const code of [
      'unchanged',
      'missing-unit',
      'orphan-asset',
      'not-durable',
      'service-unavailable',
      'unsupported-target',
      'error',
      'directory-skipped',
      'source-code',
      'data-file',
      'session-artifact',
      'exceeds-string-limit',
    ]) {
      expect(REASON_CODES).toContain(code)
    }
  })

  it('carries no code nothing emits any more', () => {
    // The amendment turned both into flags: an oversized file is imported whole
    // and marked, a secret-looking file is imported and tagged. Neither is a
    // refusal any more, so neither may survive as a reason.
    expect(REASON_CODES).not.toContain('too-large')
    expect(REASON_CODES).not.toContain('secrets')
  })

  it('splits a classed code at its first colon', () => {
    expect(reasonPrefix('directory-skipped:node_modules')).toBe('directory-skipped')
    expect(reasonPrefix('memory-note')).toBe('memory-note')
  })
})
