// Part of eYssen. See LICENSE file for full copyright and licensing details.
// R11.1 / R11.2 regression guard: none of the old cap or keep-list machinery may come back.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stripComments } from '../../helpers/strip-comments'

const ROOT = resolve(process.cwd(), 'src/modules/data-port')

/**
 * Cap *mechanics*, never English prose (A-12). The bare word `truncated` is
 * deliberately absent: it is legitimate prose in `constants.ts` and it is the
 * P-15 inline-clip marker `TRUNCATION_MARKER` in `skill-package.ts`, which names
 * the complete on-disk copy — a guard that forbade it could only go green by
 * violating the plan.
 */
const FORBIDDEN =
  /\b(MAX_SCAN_FILES|MAX_DIRS_TO_VISIT|WIDE_ROOT_KEEP|isWideScanRoot|SKIP_UNDER_AI_DOT|SESSION_DIR_KEEP|CLAUDE_PROJECT_DIR|AI_ITEM_LIMIT|maxFiles|MAX_FILE_BYTES|MAX_UPLOAD_BYTES|SECRETS_HINT|JUNK_SKIP|isImportJunk)\b/g

/**
 * Both emission forms this codebase uses: the named property
 * (`reasonCode: 'secrets'`) and the positional argument the scanner's `skip()` /
 * `noiseRow()` helpers take (`…, 'too-large', …`). The leading `[-\w]` guard
 * keeps the legitimate `'contains-secrets'` TAG out of the match — the point of
 * D-7 is that secrets are flagged, never refused.
 */
const EMITTED = /reasonCode:\s*'(secrets|too-large)'|(?<![-\w])'(secrets|too-large)'\s*[,)]/g

/**
 * A vocabulary is not an emission (A-26). The positional clause above matched
 * `'secrets',` inside Task 5's `CREDENTIAL_WORDS = new Set([… 'secret',
 * 'secrets', 'password' …])` — a list of the bare nouns the secrets heuristic
 * keys on, which is the opposite of a refusal: it is how a row gets FLAGGED.
 *
 * The exclusion is the shape, not the identifier: an array literal whose every
 * element is a string literal is a word list by construction, and no call's
 * positional argument list looks like that (a `skip(entry, 'too-large', reason)`
 * carries at least one non-literal). Blanked out with spaces before the scan,
 * newlines kept, so the reported line numbers are still the file's own.
 */
const WORD_LIST_ARRAY = /\[\s*(?:'[^'\n]*'\s*,\s*)+'[^'\n]*'\s*,?\s*\]/g
const blankWordLists = (text: string): string =>
  text.replace(WORD_LIST_ARRAY, (m) => m.replace(/[^\n]/g, ' '))

/**
 * A body clipped to a hard-coded number is a size cap wearing a different hat
 * (A-12, R11.5): imported bodies are verbatim.
 *
 * Two things keep this narrow enough to be true. Only a clip that BECOMES a body
 * counts — assigned to a `body`/`content` field, or taken off `.body` — so the
 * head cuts the plan does sanction stay legal: a `preview:`, the frontmatter
 * probe a regex reads, the NUL-byte sniff. And only a numeric literal counts,
 * because a clip to a NAMED constant is the documented kind: `HEAD_CHARS` for
 * classification, `MAX_CHUNK_CHARS` for the optional model pass,
 * `MAX_INLINE_ASSET_CHARS` for the P-15 inline copy.
 */
/*
 * A-18: written as one regex, the clause stopped at the first newline, so a clip
 * whose call wraps — `body: readFileSync(p, 'utf-8')` ⏎ `  .slice(0, 4096)`,
 * which prettier writes as soon as the line is long — was invisible. Widening
 * the character class is not enough either: the call's OWN comma
 * (`readFileSync(p, 'utf-8')`) ends any class that has to exclude commas to stay
 * bounded. So the clip is found first and its left context read backwards,
 * counting brackets, which is the only way to tell a comma inside an argument
 * list from the comma that ends the initialiser.
 */
const CLIP = /\.(?:slice|substring|subarray)\(\s*0\s*,\s*[\d_]+\s*\)/g

/**
 * Where the expression being clipped begins: scan left to the nearest `,`, `;`,
 * `{` or `}` that is not inside a bracket, or to the open bracket that encloses
 * the whole expression. Everything from there to the clip is the initialiser.
 *
 * A newline ends it too — this codebase writes no semicolons, so without that a
 * head would run back through whole paragraphs of unrelated code and comments —
 * unless the next line opens with `.`, which is exactly the wrapped-call shape
 * A-18 is about.
 */
function initialiserStart(text: string, from: number): number {
  let depth = 0
  for (let i = from - 1; i >= 0; i--) {
    const ch = text[i]!
    if (ch === ')' || ch === ']') depth++
    else if (ch === '(' || ch === '[') {
      if (depth === 0) return i + 1
      depth--
    } else if (depth === 0 && (ch === ',' || ch === ';' || ch === '{' || ch === '}')) return i + 1
    else if (depth === 0 && ch === '\n' && !/^\s*\./.test(text.slice(i + 1, from + 1))) return i + 1
  }
  return 0
}

/**
 * Clips that become a body: the clipped expression is what a `body`/`content`
 * field or variable is being set to, or it is taken off `.body`.
 *
 * The assignment is anchored at the START of the initialiser. Read loosely, the
 * clause matched a TYPE ANNOTATION — `const firstLine = (content: string) =>
 * content.split('\n').find(Boolean)?.slice(0, 80)` names a row, it does not
 * build a body — and matched the word `body:` written in a comment above a
 * legitimate head probe.
 */
function bodyClips(text: string): Array<{ index: number; text: string }> {
  const hits: Array<{ index: number; text: string }> = []
  for (const m of text.matchAll(CLIP)) {
    const head = text.slice(initialiserStart(text, m.index), m.index)
    if (/^\s*(?:body|content)\s*[:=][^=]/.test(head) || /\.body\s*$/.test(head)) {
      hits.push({ index: m.index, text: `${head.trim()}${m[0]}` })
    }
  }
  return hits
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (full.endsWith('.ts')) yield full
  }
}

/**
 * Every match in every file, with its line number — not just the first per file.
 * A guard that reports one hit at a time hides the second violation in a file
 * until the first is fixed, and this list is the hand-off to the tasks that own
 * the remaining sites.
 */
function scan(
  pattern: RegExp,
  label: (m: RegExpExecArray) => string,
  prepare: (text: string) => string = (t) => t,
): string[] {
  const hits: string[] = []
  for (const file of walk(ROOT)) {
    // Comments blanked before either pattern runs. This guard is about what the
    // code DOES; a comment that names `MAX_SCAN_FILES` to explain why it is gone
    // is the documentation working, not a cap coming back. Blanking keeps
    // newlines, so a reported line number is still the file's own.
    const text = prepare(stripComments(readFileSync(file, 'utf-8')))
    for (const m of text.matchAll(pattern)) {
      const line = text.slice(0, m.index).split('\n').length
      hits.push(`${file.slice(ROOT.length + 1)}:${line}: ${label(m as RegExpExecArray)}`)
    }
  }
  return hits
}

describe('no caps, no keep-lists', () => {
  it('has no cap, keep-list or refusal symbol left under src/modules/data-port', () => {
    expect(scan(FORBIDDEN, (m) => m[1]!)).toEqual([])
  })

  it("emits neither 'secrets' nor 'too-large' as a reason code", () => {
    expect(scan(EMITTED, (m) => m[1] ?? m[2]!, blankWordLists)).toEqual([])
  })

  it('never clips a file body to a hard-coded length', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const text = stripComments(readFileSync(file, 'utf-8'))
      for (const hit of bodyClips(text)) {
        const line = text.slice(0, hit.index).split('\n').length
        hits.push(`${file.slice(ROOT.length + 1)}:${line}: ${hit.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  /*
   * The guard is the only thing standing between this feature and a cap coming
   * back, so its own two blind spots are tested rather than assumed. Both were
   * named by review (A-18, A-26) and both are silent failures: the first would
   * have let a clip through, the second reported a violation that was never one.
   */
  describe('the guard itself', () => {
    it('sees a body clip whose call wraps to the next line (A-18)', () => {
      // The wrapped form, with the call's own comma inside the expression.
      expect(bodyClips("const row = { body: readFileSync(p, 'utf-8')\n    .slice(0, 4096) }\n")).toHaveLength(1)
      expect(bodyClips('const head = unit.body\n  .slice(0, 2048)\n')).toHaveLength(1)
      // Still a clip when it is written on one line, and still not one when the
      // length is a named constant or the cut never becomes a body.
      expect(bodyClips('body: text.slice(0, 200)\n')).toHaveLength(1)
      expect(bodyClips('body: text.slice(0, HEAD_CHARS)\n')).toHaveLength(0)
      expect(bodyClips('preview: text.slice(0, 200)\n')).toHaveLength(0)
      expect(bodyClips('const bodyBytes = raw.slice(0, 200)\n')).toHaveLength(0)
      // The bound: an initialiser that ended, then an unrelated clip below it.
      expect(bodyClips('body: text,\nconst n = other.slice(0, 5)\n')).toHaveLength(0)
      expect(bodyClips('{ body: text }\nconst n = other.slice(0, 5)\n')).toHaveLength(0)
    })

    it('reads a word list as a vocabulary and a call argument as an emission (A-26)', () => {
      const vocabulary = "const CREDENTIAL_WORDS = new Set(['secret', 'secrets', 'password'])\n"
      expect([...blankWordLists(vocabulary).matchAll(EMITTED)]).toHaveLength(0)
      // Blanking keeps the file's line numbering, so a hit below a word list is
      // still reported at its own line.
      expect(blankWordLists(vocabulary).split('\n')).toHaveLength(vocabulary.split('\n').length)
      for (const emission of [
        "skip(entry, 'too-large', rel)\n",
        "return noiseRow(rel, 'secrets')\n",
        "row.reasonCode = { reasonCode: 'secrets' }\n",
      ]) {
        expect([...blankWordLists(emission).matchAll(EMITTED)]).not.toHaveLength(0)
      }
      // The tag is not a refusal and never was.
      expect([...blankWordLists("tags: ['contains-secrets']\n").matchAll(EMITTED)]).toHaveLength(0)
    })
  })
})
