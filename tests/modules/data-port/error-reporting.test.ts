// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A-50 / A-54 regression guard: one helper decides what a data-port failure says.
//
// drizzle wraps every query error as `Failed to run the query '<the entire
// prepared statement>'` and puts the driver's own words on `.cause`. A site
// that reports `err.message` therefore reports tens of kilobytes of `?`
// placeholders with the reason nowhere in them — and four of those sites were
// in `pipeline/apply.ts`, where the string is STORED on the item and shown to
// the owner, not merely logged.
//
// So the rule is mechanical: outside the two helpers themselves, no file under
// `src/modules/data-port` reads `.message` off a caught error or stringifies
// one. Everything goes through `failureReason` (innermost link, capped) or
// `errorText` (the whole chain, for the one phrase test).

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stripComments } from '../../helpers/strip-comments'

const ROOT = resolve(process.cwd(), 'src/modules/data-port')

/**
 * A caught error, by the names this codebase gives one: `err`, `e`, `error`,
 * `ex`, and any camelCase name ending in `Err`/`Error` (`flushErr`, `markErr`,
 * `parseError`). Deliberately not every identifier — `entry.message` in the
 * chat-export adapter is a chat MESSAGE, and reading it is the whole point.
 */
const ERR = String.raw`(?:err|error|ex|e|[a-z][A-Za-z0-9]*(?:Err|Error))`
const RAW_MESSAGE = new RegExp(String.raw`\b${ERR}\s*\.\s*message\b`, 'g')
const RAW_STRING = new RegExp(String.raw`\bString\(\s*${ERR}\s*\)`, 'g')

/**
 * The two helpers are where the raw read has to happen. Allowed by their exact
 * source line rather than by file, so a NEW raw site added to either file is
 * still caught.
 */
const ALLOWED = new Set([
  "ledger.ts: return parts.length > 0 ? parts.join(' | ') : String(err)",
  'errors.ts: reason = String(err)',
  'errors.ts: const message = current.message',
])

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (full.endsWith('.ts')) yield full
  }
}

/**
 * Every raw error read in one file's text, as `line: source`. Exposed so the
 * positive control below can drive the DETECTOR itself rather than a copy of it:
 * a control that re-implemented the matching could stay green while the real
 * patterns rotted.
 */
function sitesIn(text: string, label = ''): string[] {
  const hits: string[] = []
  const code = stripComments(text)
  for (const pattern of [RAW_MESSAGE, RAW_STRING]) {
    for (const m of code.matchAll(pattern)) {
      const upto = text.slice(0, m.index)
      const line = upto.split('\n').length
      const source = text.split('\n')[line - 1]!.trim()
      if (ALLOWED.has(`${label}: ${source}`)) continue
      hits.push(`${line}: ${source}`)
    }
  }
  return hits
}

function rawErrorSites(): string[] {
  const hits: string[] = []
  for (const file of walk(ROOT)) {
    const name = file.slice(ROOT.length + 1)
    for (const hit of sitesIn(readFileSync(file, 'utf-8'), name.split('/').pop())) {
      hits.push(`${name}:${hit}`)
    }
  }
  return hits
}

describe('one error-reporting helper for the whole module', () => {
  /*
   * A-82. The sweep below asserts an EMPTY list, so its silence is
   * indistinguishable from success: if the patterns stop matching — a refactor,
   * a spelling they no longer cover — the detector returns nothing and the guard
   * passes, reading exactly like a clean module. `ALLOWED` is not a control
   * either; a detector that matches nothing simply leaves those entries unused.
   *
   * So the detector is made to prove it can still see, in the same run, on the
   * very shapes this guard exists to forbid.
   */
  it('still detects a raw error read, so an empty sweep means clean and not blind', () => {
    expect(sitesIn('return { error: err.message }\n')).toHaveLength(1)
    expect(sitesIn('logger.warn({ err: String(err) })\n')).toHaveLength(1)
    expect(sitesIn('const detail = flushErr.message\n')).toHaveLength(1)
    expect(sitesIn('return String(parseError)\n')).toHaveLength(1)
    // …and still tells those apart from what it must never flag.
    expect(sitesIn('const text = entry.message\n')).toEqual([])
    expect(sitesIn('return failureReason(err)\n')).toEqual([])
    expect(sitesIn('// err.message is what we must not do\n')).toEqual([])
  })

  it('reads no error message and stringifies no error outside the two helpers', () => {
    expect(rawErrorSites()).toEqual([])
  })

  it('reports the innermost link, not the wrapper drizzle put on top', async () => {
    const { failureReason } = await import('@modules/data-port/errors.js')
    const wrapped = new Error("Failed to run the query 'INSERT INTO data_port_scans (?, ?, ?)'", {
      cause: new Error('disk I/O error'),
    })
    expect(failureReason(wrapped)).toBe('disk I/O error')
    // The stored field is a sentence, never a payload.
    expect(failureReason(new Error('x'.repeat(10_000))).length).toBeLessThan(2_100)
    // A catch block may be handed anything at all, and this runs inside one.
    expect(failureReason('plain string')).toBe('plain string')
    expect(() => failureReason(null)).not.toThrow()
  })

  it('is what the apply pipeline stores on a failed item', async () => {
    const applyText = readFileSync(join(ROOT, 'pipeline', 'apply.ts'), 'utf-8')
    const errorReturns = [...applyText.matchAll(/status: 'error', error: ([^,]+),/g)].map((m) => m[1]!.trim())
    expect(errorReturns.length).toBeGreaterThan(0)
    // Either the helper reading a caught error, or a NAMED constant sentence
    // the code raises itself (`WALK_EXHAUSTED`) — never an ad-hoc read.
    for (const expr of errorReturns) {
      expect(expr === 'failureReason(err)' || /^[A-Z][A-Z0-9_]+$/.test(expr)).toBe(true)
    }
    expect(errorReturns.filter((e) => e === 'failureReason(err)').length).toBeGreaterThanOrEqual(4)
  })
})
