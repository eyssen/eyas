// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// EYAS is a general product: the memory module and its tests must not carry
// one operator's customers, people or private references. Fixtures use
// fictional companies (Contoso, Globex, Northwind, …).
//
// The deny list is stored as SHA-256 digests of lower-cased names, so this
// guard does not itself publish the names it keeps out. A token matches when
// the token, or any prefix of it at least MIN_NAME_CHARS long, hashes to a
// listed digest — that also catches inflected forms ("<name>nál") and
// compounds ("<name>-projekt"). To add a name: printf '%s' name | shasum -a 256.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const MIN_NAME_CHARS = 4

const DENIED_DIGESTS = new Set([
  'b69879b0906a103fd22edd409e6d04c276bdd94c56699e7a9d35fdb57a8bead7',
  'a0badffd013cf4963942e2983432b696cd0e8a7fff80a9287d2a12df1093d0a7',
  '4660163d292b468565ab0475db455f430afd6de9a09aa77dbdd3986b12797952',
  'a2ae995a2561a5eb644a07adc4068d8b53d9d4ffb1eda2e7cb626006bcf31ff3',
  '0e29b36b2989bc406bfc7d0b90fcc4872e8b3278f0dec61ae8e0c9bb15558ad4',
  '8f9dd06064ea518bb0779d816a01078ecf12593cd58115137db2cd63d102d1a0',
  'c58f5fe3c642602af5f263bb978c207395e943c4d60b4ffa285ead78393c767a',
  'ee724e60b9a82060d872b2438160ac968abc13dc1b4afcb87868c78f3664b313',
  '003a02344f0caeed7447abd3c76de30c78cb2b25dca9c8d9dc746a6350f6d4d8',
  '7e8d0abb5ad2f3302d2b60a46716b3b5eeca957ce32fe97f89aa3b104ef2ba24',
  '95c8f99389063132afb2bdf082c4d83df5a71317597e697a043afcd8d97ed81a',
  '677ac503be04e888936277092362878018d0fa27c57c5fe42db987505263f51e',
  '0cf3a03ba4053d133e221bf9297654bb1fae6269baedca8cfbd3d1ba153e67e8',
  'a37ec587d4141c3235b71ceea43924d1866241d2282b0e71cfd4ec60571928a8',
  '7026a2615145fe1869cba7d48263cff9891a6993b324c19ab2b564e4b1410395',
  '638af7c6ca6de5360bae235c7c6c14bb6b2664433c74d30eabd69770fcd6530a',
  '019ade36b285963b8ca1cf71997b44736a1e8061be60c2c1ffe8bb5626bb43ca',
  '87ef5534d6b80e62a5ff0387a513e5690f341783ae358443b0eeeacead61ec71',
  '6e0dfd2e14dd1bb6970bd72641e322d5f05275189837acc9a86ca8603afeb3ab',
  // The vendor's own name: allowed only in the mandated licence header.
  '90cb02c0b05fc2da5913d17cb597ecb9a6acdd7395fdb124f738fbbcdb9f988e',
])

/** The one line every source file is required to start with. */
const LICENCE_HEADER = /^\s*(\/\/|#|\*|<!--)?\s*Part of eYssen\. See LICENSE file for full copyright and licensing details\.\s*(-->)?\s*$/

const SCANNED_ROOTS = ['src/modules/memory', 'tests/modules/memory']
/** This file: it holds digests and the vendor's header text, never a readable listed name. */
const SELF = resolve('tests/modules/memory/vendor-neutral.test.ts')
const SCANNED_EXT = /\.(ts|tsx|js|mjs|json|md|yaml|yml)$/

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** Word tokens, whole and camelCase-split, so `insertAcmeRow` also yields `acme`. */
function tokens(line: string): string[] {
  const out = new Set<string>()
  for (const word of line.split(/[^\p{L}\p{N}]+/u)) {
    out.add(word.toLowerCase())
    for (const part of word.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').split(' ')) out.add(part.toLowerCase())
  }
  return [...out].filter((t) => t.length >= MIN_NAME_CHARS)
}

export interface NameHit { line: number; token: string }

/** Every token of `text` (or prefix of one) whose digest is in `digests`. */
export function findDeniedNames(text: string, digests: ReadonlySet<string>): NameHit[] {
  const hits: NameHit[] = []
  const cache = new Map<string, boolean>()
  const denied = (s: string): boolean => {
    let v = cache.get(s)
    if (v === undefined) {
      v = digests.has(sha256(s))
      cache.set(s, v)
    }
    return v
  }
  text.split('\n').forEach((line, i) => {
    if (LICENCE_HEADER.test(line)) return
    for (const token of tokens(line)) {
      for (let n = MIN_NAME_CHARS; n <= token.length; n++) {
        if (denied(token.slice(0, n))) {
          hits.push({ line: i + 1, token })
          break
        }
      }
    }
  })
  return hits
}

function listFiles(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listFiles(full))
    else if (SCANNED_EXT.test(entry)) out.push(full)
  }
  return out
}

describe('findDeniedNames (the detector)', () => {
  const sample = new Set([sha256('globex')])

  it('flags a listed name, its inflected, compound, path and camelCase forms', () => {
    const text = [
      'Customer: Globex Kft',
      'A Globexnál a számla kész.',
      "note('semantic/project_globex_ticket.md')",
      'function insertGlobexRow() {}',
      'im Globex-Projekt.',
    ].join('\n')
    expect(findDeniedNames(text, sample).map((h) => h.line)).toEqual([1, 2, 3, 4, 5])
  })

  it('does not flag words that merely share letters, and skips the licence header only', () => {
    const vendor = new Set([sha256('eyssen')])
    expect(findDeniedNames('a global glob of globe data', sample)).toEqual([])
    expect(findDeniedNames('// Part of eYssen. See LICENSE file for full copyright and licensing details.', vendor)).toEqual([])
    expect(findDeniedNames('# Part of eYssen. See LICENSE file for full copyright and licensing details.', vendor)).toEqual([])
    expect(findDeniedNames("const repo = 'eyssen-app'", vendor)).toEqual([{ line: 1, token: 'eyssen' }])
    // Mixed case is still the same name outside the header.
    expect(findDeniedNames('Built by eYssen for the owner', vendor)).toEqual([{ line: 1, token: 'eyssen' }])
  })
})

describe('memory module vendor neutrality', () => {
  it('names no customer, person or private reference in src/modules/memory or tests/modules/memory', () => {
    const offenders: string[] = []
    for (const root of SCANNED_ROOTS) {
      for (const file of listFiles(resolve(root))) {
        if (file === SELF) continue
        for (const hit of findDeniedNames(readFileSync(file, 'utf8'), DENIED_DIGESTS)) {
          offenders.push(`${relative(process.cwd(), file)}:${hit.line} (${hit.token})`)
        }
      }
    }
    expect(offenders, `replace with a fictional name:\n${offenders.join('\n')}`).toEqual([])
  })
})
