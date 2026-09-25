// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Every machine code the scan puts on a row reaches the owner as a translated
// label. Nothing here may fall through to a raw key: an untranslated
// `settings.dataPort.reason.x` in the wizard is a defect, not a cosmetic one.
import { describe, expect, it } from 'vitest'
import {
  dirClassLabel,
  kindLabel,
  reasonLabel,
  scanWarningText,
  splitReasonCode,
  tagLabel,
  warningLabel,
} from '@/pages/settings/data-port-reason-label'
import { readFileSync } from 'node:fs'
import { stripComments } from '../helpers/strip-comments'
import { resolve } from 'node:path'
import {
  CANDIDATE_TAG_LABELS,
  CANDIDATE_WARNINGS,
  DIRECTORY_CLASSES,
  KIND_ORDER,
  SCAN_WARNING_CODES,
} from '@/pages/settings/data-port-types'

/**
 * Every reason code the server can emit, read from its own frozen list rather
 * than a copy, plus the bare prefix of each classed one — the shape the tree
 * and the filter actually hand to `reasonLabel`.
 */
const REASON_PREFIXES = (() => {
  const source = readFileSync(resolve(process.cwd(), 'src/modules/data-port/types.ts'), 'utf-8')
  // Same extractor, same flaw: comments out before the quotes are read.
  const block = /export const REASON_CODES = \[([\s\S]*?)\] as const/.exec(stripComments(source))![1]!
  const codes = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
  return [...new Set(codes.map((c) => c.split(':')[0]!))]
})()

describe('splitReasonCode', () => {
  it('splits a classed code at the first colon', () => {
    expect(splitReasonCode('directory-skipped:node_modules')).toEqual({ code: 'directory-skipped', detail: 'node_modules' })
    expect(splitReasonCode('memory-note')).toEqual({ code: 'memory-note' })
    expect(splitReasonCode('a:b:c')).toEqual({ code: 'a', detail: 'b:c' })
    expect(splitReasonCode('')).toEqual({ code: '' })
  })
})

describe('reasonLabel', () => {
  it('interpolates the detail through its own label', () => {
    expect(reasonLabel('directory-skipped:node_modules', 'raw')).toBe('Folder not searched: Dependency folder')
    expect(reasonLabel('directory-skipped:browser-profile', 'raw')).toBe('Folder not searched: Browser profile')
  })

  it('translates a plain code and leaves the fallback for an unknown one', () => {
    expect(reasonLabel('memory-note', 'raw')).toBe('Memory note')
    expect(reasonLabel(undefined, 'the raw reason')).toBe('the raw reason')
    expect(reasonLabel('', 'the raw reason')).toBe('the raw reason')
    expect(reasonLabel('not-a-code', 'the raw reason')).toBe('the raw reason')
    expect(reasonLabel('not-a-code:some-detail', 'the raw reason')).toBe('the raw reason (some-detail)')
  })

  it('never hands back a bare locale key or an unfilled placeholder', () => {
    for (const code of ['memory-note', 'directory-skipped:trash', 'exceeds-string-limit', 'source-code']) {
      const label = reasonLabel(code, 'fallback')
      expect(label).not.toContain('settings.dataPort.')
      expect(label).not.toContain('{{')
    }
  })

  // `DirNode.byReason` is keyed on the bare PREFIX, and the reason filter takes
  // one too, so the tree's why-not popover and the filter chip both label a
  // classed code with no detail. Its template needs a detail it cannot have.
  it('does not print a template at the owner when a classed code arrives bare', () => {
    expect(reasonLabel('directory-skipped', 'Folder not searched')).toBe('Folder not searched')
    expect(reasonLabel('directory-skipped', 'directory-skipped')).toBe('directory-skipped')
    expect(reasonLabel('directory-skipped:', 'raw')).toBe('raw')
    for (const code of REASON_PREFIXES) {
      const label = reasonLabel(code, `fallback-${code}`)
      expect({ code, holds: label.includes('{{') }).toEqual({ code, holds: false })
    }
  })
})

describe('vocabulary labels', () => {
  it('resolves every kind in KIND_ORDER', () => {
    expect(kindLabel('code')).toBe('Source code')
    for (const kind of KIND_ORDER) {
      const label = kindLabel(kind)
      expect(label).not.toBe(`settings.dataPort.wizard.kind.${kind}`)
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('resolves every tag, warning, directory class and scan warning code', () => {
    for (const tag of CANDIDATE_TAG_LABELS) expect(tagLabel(tag)).not.toContain('settings.dataPort.')
    for (const w of CANDIDATE_WARNINGS) expect(warningLabel(w)).not.toContain('settings.dataPort.')
    for (const cls of DIRECTORY_CLASSES) expect(dirClassLabel(cls)).not.toContain('settings.dataPort.')
    for (const code of SCAN_WARNING_CODES) {
      expect(scanWarningText({ code, params: { count: 1, detail: 'x', skipped: 2 }, message: 'english' })).not.toContain('settings.dataPort.')
    }
  })

  it('falls back to the raw value for a vocabulary entry the locale does not know', () => {
    expect(tagLabel('claude-project:alpha')).toBe('claude-project:alpha')
    expect(warningLabel('brand-new')).toBe('brand-new')
    expect(dirClassLabel('brand-new')).toBe('brand-new')
    expect(kindLabel('brand-new')).toBe('brand-new')
  })
})

describe('scanWarningText', () => {
  it('prints a pre-R11 string warning verbatim', () => {
    expect(scanWarningText('old text')).toBe('old text')
    expect(scanWarningText({ code: 'legacy', params: { message: 'old text' }, message: 'old text' })).toBe('old text')
  })

  it('interpolates a coded warning and falls back to the English message', () => {
    expect(scanWarningText({ code: 'directories-skipped', params: { count: 3, detail: '3 node_modules' }, message: 'x' })).toBe(
      '3 folders were listed as one row each and not entered: 3 node_modules',
    )
    expect(scanWarningText({ code: 'brand-new', message: 'server said this' })).toBe('server said this')
  })
})
