// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A-61: no source file may contain a RAW NUL byte.
//
// This is not a style rule. `grep` classifies a file holding a 0x00 byte as
// BINARY and answers "Binary file … matches" — or, with the patterns a sweep
// uses, nothing at all. Two files in this repo each held one real NUL inside a
// string literal (a cache-key separator, and a SQLite-header fixture). Both
// were legal TypeScript and both compiled and passed their tests. The cost
// landed somewhere else entirely: a documentation pass grepped the wizard for
// its whole-scan selection buttons, got no hits from a file that in fact
// contained them, concluded the feature did not exist, and removed a true
// sentence from six languages.
//
// A file that lies to `grep` cannot be reviewed, so the byte is written as the
// escape `\x00` instead — identical at runtime, greppable on disk.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOTS = ['src', 'tests'].map((d) => resolve(process.cwd(), d))
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html|yaml|yml)$/
/** Build output, dependencies and the fixture trees a test writes for itself. */
const SKIP_DIR = /^(node_modules|dist|build|coverage|\.git|\.astro)$/

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.test(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (SOURCE.test(name)) yield full
  }
}

describe('source hygiene', () => {
  it('has no raw NUL byte in any source file under src/ or tests/ (A-61)', () => {
    const offenders: string[] = []
    let checked = 0
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        checked++
        const buf = readFileSync(file)
        const at = buf.indexOf(0)
        if (at >= 0) offenders.push(`${file.slice(process.cwd().length + 1)} at byte ${at}`)
      }
    }
    // A guard that walked nothing would be green for the wrong reason.
    expect(checked).toBeGreaterThan(500)
    expect(offenders).toEqual([])
  })

  it('still lets a file express one — as the escape a reviewer can grep for', () => {
    const buf = Buffer.from(String.raw`const SEP = '\x00'` + '\n', 'utf-8')
    expect(buf.indexOf(0)).toBe(-1)
    expect('\x00'.charCodeAt(0)).toBe(0)
  })
})
