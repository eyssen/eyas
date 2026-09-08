// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { formatToolOutput } from '@modules/tools/aci-layer'

/**
 * Phase 3M — ACI output layer tests.
 *
 * Each strategy is pinned down separately: verbatim (short), line-head-tail
 * (long multi-line text), json-head (structured), binary-summary (noisy
 * bytes), and the byte-trim fallback for single-huge-line output.
 */

describe('formatToolOutput', () => {
  it('returns verbatim when output is within the char budget', () => {
    const res = formatToolOutput('short output', { maxChars: 1000 })
    expect(res.strategy).toBe('verbatim')
    expect(res.truncated).toBe(false)
    expect(res.text).toBe('short output')
  })

  it('line-head-tail: keeps head and tail with a line-count marker', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i + 1}`)
    const raw = lines.join('\n')
    const res = formatToolOutput(raw, { maxChars: 1000, headLines: 5, tailLines: 3 })

    expect(res.strategy).toBe('line-head-tail')
    expect(res.truncated).toBe(true)
    expect(res.originalLines).toBe(300)
    // First kept line + last kept line present
    expect(res.text).toContain('line-1\n')
    expect(res.text).toContain('line-300')
    // Marker says exactly how many lines were cut: 300 - 5 - 3 = 292
    expect(res.text).toContain('292 lines truncated')
    // Cut content is absent
    expect(res.text).not.toContain('line-100')
  })

  it('line-head-tail: embeds the follow-up hint when provided', () => {
    const raw = Array.from({ length: 200 }, (_, i) => `row ${i}`).join('\n')
    const res = formatToolOutput(raw, { maxChars: 500, followUpHint: 'search_logs --pattern=<needle>' })
    expect(res.text).toContain('search_logs --pattern=<needle>')
  })

  it('json-head: cuts on a logical boundary and reports omitted char count', () => {
    const items = Array.from({ length: 500 }, (_, i) => `{"id":${i},"v":"x"}`)
    const raw = '[' + items.join(',') + ']'
    const res = formatToolOutput(raw, { maxChars: 400 })

    expect(res.strategy).toBe('json-head')
    expect(res.truncated).toBe(true)
    expect(res.text).toContain('chars of JSON truncated')
    // Cut point lands on a comma or newline boundary
    const lastCharBeforeMarker = res.text.split('[...')[0].trimEnd().slice(-1)
    expect([',', '}', ']']).toContain(lastCharBeforeMarker)
  })

  it('structured: respects the explicit structured flag even without leading brace', () => {
    // Inputs that look free-form but caller declared structured.
    const raw = 'id,name,v\n' + Array.from({ length: 1000 }, (_, i) => `${i},foo,${i}`).join('\n')
    const res = formatToolOutput(raw, { maxChars: 500, structured: true })
    expect(res.strategy).toBe('json-head')
  })

  it('binary-summary: flagged when non-printable ratio is high', () => {
    // Fill the sample window (first 4KB) densely with non-printable bytes so
    // the heuristic reliably classifies this as binary regardless of what
    // follows. Using code 0x01 keeps it simple — control chars outside the
    // allowed whitespace set.
    const bin = String.fromCharCode(1).repeat(5000)
    const raw = bin + 'x'.repeat(5000)
    const res = formatToolOutput(raw, { maxChars: 500 })
    expect(res.strategy).toBe('binary-summary')
    expect(res.text).toContain('Binary-ish output')
    expect(res.text).toContain('bytes')
  })

  it('single-huge-line (no newlines) falls back to byte-trim with char marker', () => {
    // One giant unformatted string with no newlines. line-head-tail sees
    // too few lines and the fallback byteTrim kicks in instead.
    const raw = 'x'.repeat(20_000)
    const res = formatToolOutput(raw, { maxChars: 500, headLines: 100, tailLines: 50 })
    expect(res.strategy).toBe('line-head-tail')
    expect(res.truncated).toBe(true)
    expect(res.text).toContain('chars truncated')
  })

  it('reports originalChars and originalLines for audit logs', () => {
    const raw = 'a\nb\nc\n' // 3 lines, 6 chars
    const res = formatToolOutput(raw)
    expect(res.originalChars).toBe(6)
    expect(res.originalLines).toBe(3)
  })

  it('empty input is verbatim with zero counts', () => {
    const res = formatToolOutput('')
    expect(res.strategy).toBe('verbatim')
    expect(res.originalChars).toBe(0)
    expect(res.originalLines).toBe(0)
    expect(res.text).toBe('')
  })

  it('default maxChars (8000) preserves moderate outputs unchanged', () => {
    const raw = 'ok\n'.repeat(1000) // 3000 chars
    const res = formatToolOutput(raw)
    expect(res.strategy).toBe('verbatim')
    expect(res.truncated).toBe(false)
  })
})
