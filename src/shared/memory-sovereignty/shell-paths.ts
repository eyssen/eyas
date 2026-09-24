// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Paths a shell command line names, for the memory-sovereignty policy.
//
// Best effort by design: a shell can build a path at run time in ways no
// static reading can follow (variables, `cd` chains, eval). What is visible —
// arguments, redirections, `--flag=value`, `~`/`$HOME`, `file://` URLs,
// command substitutions, brace alternatives — is extracted here; the kernel
// sandbox layer covers what extraction cannot see.
//
// Only tokens that LOOK like paths count: an absolute path, a home-relative
// one, `./` or `../`, or a word with a slash in it. A bare word such as the
// search pattern in `grep -r ai-memory src` is not a path, and neither is
// quoted prose that merely mentions one.
//
// The reading follows the shell's own grammar where it matters for what a
// command reaches:
//   - a redirection (`>`, `>>`, `2>`, `&>`, `<`, `<>`, `>&`, `<<<`) takes
//     exactly one word, its target; a file-descriptor number before it is not
//     a word, and the simple command goes on after the target;
//   - a here-document (`<<`, `<<-`) is the lines after its command line up to
//     the delimiter line. The shell never glob-expands them and never runs
//     them as commands (only a shell reading its script from stdin does; see
//     search-scope.ts); with an unquoted delimiter only their `$(…)` and
//     backticks run. A here-document whose delimiter line never comes is read
//     as ordinary lines again (the conservative reading);
//   - arithmetic (`$((…))`, `((…))`, `$[…]`) is one word: a `<<` in it is a
//     shift, not a here-document.

import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ShellPathOptions {
  /** Expansion target of `~`, `$HOME` and `${HOME}`. */
  homeDir: string
  /** Base for relative tokens. Without it relative candidates stay relative. */
  cwd?: string
}

/** A here-document: the lines after its command line, up to the delimiter line. */
interface HereDoc {
  delimiter: string
  /** `<<-`: leading tabs are stripped from the body and the delimiter line. */
  stripTabs: boolean
  /** Unquoted delimiter: the body's `$(…)` and backticks run. */
  expand: boolean
  body: string
}

interface Token {
  text: string
  /** Some part of the token was quoted. */
  quoted: boolean
  /** Command substitutions found inside double quotes, arithmetic or an expanding here-document. */
  inner: string[]
  /** An operator (`|`, `;`, `&&`, `(`, `$(`, a newline): the end of a simple command. */
  boundary?: true
  /** The target word of a redirection: read or written by the shell, not an argument. */
  redirect?: true
  /** The word of a here-string (`<<< word`): the command's stdin. */
  hereString?: true
  /** A here-document of the command (no word of its own). */
  hereDoc?: HereDoc
}

/** Characters that end a word outside quotes and are not part of any path. */
const OPERATOR_CHARS = new Set(['|', ';', '&', '(', ')', '<', '>', '`', '\n'])
/** A word right before `<` / `>` that is the redirection's file descriptor: `2>`, `{fd}>`. */
const FD_WORD_RE = /^(?:\d+|\{[A-Za-z_][A-Za-z0-9_]*\})$/

const GLOB_CHARS_RE = /[*?[]/
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const ASSIGNMENT_RE = /^-{0,2}[A-Za-z0-9_.-]+=(.+)$/s
const MAX_COMMAND_CHARS = 64 * 1024
const MAX_DEPTH = 4
const MAX_BRACE_VARIANTS = 64

// ── Brace alternatives ────────────────────────────────────────────────────

function topBraceAlternation(s: string): { start: number; end: number; parts: string[] } | null {
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0
    const cuts: number[] = []
    for (let k = start; k < s.length; k++) {
      const c = s[k]
      if (c === '\\') {
        k++
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          if (cuts.length === 0) break
          const bounds = [start, ...cuts, k]
          const parts: string[] = []
          for (let p = 0; p + 1 < bounds.length; p++) parts.push(s.slice(bounds[p] + 1, bounds[p + 1]))
          return { start, end: k, parts }
        }
      } else if (c === ',' && depth === 1) cuts.push(k)
    }
  }
  return null
}

/** `{a,b}` alternatives expanded; null when there are too many to judge. */
export function expandBraces(pattern: string): string[] | null {
  const out: string[] = []
  const stack = [pattern]
  while (stack.length > 0) {
    const s = stack.pop() as string
    const alt = topBraceAlternation(s)
    if (!alt) {
      out.push(s)
    } else {
      for (const part of alt.parts) stack.push(s.slice(0, alt.start) + part + s.slice(alt.end + 1))
    }
    if (out.length + stack.length > MAX_BRACE_VARIANTS) return null
  }
  return out
}

// ── Tokens ────────────────────────────────────────────────────────────────

/** A here-document delimiter word at `from` (blanks skipped): its text without quotes, whether any part was quoted, where it ends. */
function readDelimiter(text: string, from: number): { delimiter: string; quoted: boolean; end: number } | null {
  let i = from
  while (text[i] === ' ' || text[i] === '\t') i++
  let delimiter = ''
  let quoted = false
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || OPERATOR_CHARS.has(ch)) break
    if (ch === '\\' && i + 1 < text.length) {
      delimiter += text[i + 1]
      quoted = true
      i += 2
      continue
    }
    if (ch === "'" || ch === '"') {
      const close = text.indexOf(ch, i + 1)
      if (close < 0) return null
      delimiter += text.slice(i + 1, close)
      quoted = true
      i = close + 1
      continue
    }
    delimiter += ch
    i++
  }
  return delimiter ? { delimiter, quoted, end: i } : null
}

/**
 * The bodies of `docs`, read from `from` (the start of the line after their
 * command line), in order. Returns where the text goes on, or -1 when a
 * delimiter line never comes. `closeParen`: inside a command substitution a
 * delimiter followed by the `)` that closes it also ends the body; the
 * returned index is then that `)`.
 */
function readHereDocBodies(text: string, from: number, docs: readonly HereDoc[], closeParen: boolean): number {
  let i = from
  for (const doc of docs) {
    let body = ''
    let found: 'line' | 'paren' | null = null
    while (i < text.length) {
      const nl = text.indexOf('\n', i)
      const lineEnd = nl < 0 ? text.length : nl
      const raw = text.slice(i, lineEnd).replace(/\r$/, '')
      const line = doc.stripTabs ? raw.replace(/^\t+/, '') : raw
      if (line === doc.delimiter) {
        i = nl < 0 ? text.length : nl + 1
        found = 'line'
        break
      }
      if (closeParen && line.startsWith(doc.delimiter) && /^[ \t]*\)/.test(line.slice(doc.delimiter.length))) {
        i = text.indexOf(')', i + (raw.length - line.length) + doc.delimiter.length)
        found = 'paren'
        break
      }
      body += `${line}\n`
      i = nl < 0 ? text.length : nl + 1
    }
    if (!found) return -1
    doc.body = body
    // The substitution closed on the delimiter line: a later document has no body here.
    if (found === 'paren') return i
  }
  return i
}

/** The `$(…)` and backtick substitutions in text the shell only expands (an unquoted here-document, arithmetic). */
function substitutionsIn(text: string): string[] {
  const out: string[] = []
  for (let k = 0; k < text.length; k++) {
    const c = text[k]
    if (c === '\\') {
      k++
      continue
    }
    if (c === '$' && text[k + 1] === '(') {
      const close = closingParen(text, k + 2)
      const end = close < 0 ? text.length : close
      out.push(text.slice(k + 2, end))
      k = end
      continue
    }
    if (c === '`') {
      const close = text.indexOf('`', k + 1)
      const end = close < 0 ? text.length : close
      out.push(text.slice(k + 1, end))
      k = end
    }
  }
  return out
}

/** Index of the `)` that closes the paren opened just before `from` (arithmetic: parens only), or -1. */
function closingArithmetic(text: string, from: number, depth: number): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * Index of the `)` that closes the `$(` opened just before `from`, or -1.
 * Quoted text, escapes and here-document bodies inside do not count.
 */
function closingParen(text: string, from: number): number {
  let depth = 1
  const pending: HereDoc[] = []
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === "'") {
      const close = text.indexOf("'", i + 1)
      if (close < 0) return -1
      i = close
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      if (j >= text.length) return -1
      i = j
      continue
    }
    if (ch === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      const strip = text[i + 2] === '-'
      const d = readDelimiter(text, i + (strip ? 3 : 2))
      if (d) {
        pending.push({ delimiter: d.delimiter, stripTabs: strip, expand: !d.quoted, body: '' })
        i = d.end - 1
      } else {
        i += 1
      }
      continue
    }
    if (ch === '\n' && pending.length > 0) {
      const next = readHereDocBodies(text, i + 1, pending, true)
      pending.length = 0
      if (next < 0) return -1
      i = next - 1
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return -1
}

function tokenize(command: string): Token[] {
  const tokens: Token[] = []
  let text = ''
  let quoted = false
  let inner: string[] = []
  let started = false
  /** The next word is a redirection target (a here-string's word too). */
  let redirectNext: 'target' | 'here-string' | null = null
  /** Here-documents whose bodies start after the current line. */
  const pending: HereDoc[] = []
  /** Open bare parens, `$(` as 's' and a subshell as 'g': inside a `$(` a delimiter line may end with its `)`. */
  const parens: Array<'s' | 'g'> = []
  const flush = (): void => {
    if (started) {
      const token: Token = { text, quoted, inner }
      if (redirectNext) {
        token.redirect = true
        if (redirectNext === 'here-string') token.hereString = true
        redirectNext = null
      }
      tokens.push(token)
    }
    text = ''
    quoted = false
    inner = []
    started = false
  }
  const boundary = (): void => {
    flush()
    redirectNext = null
    if (tokens.length > 0 && !tokens[tokens.length - 1].boundary) tokens.push({ text: '', quoted: false, inner: [], boundary: true })
  }
  /** Before a redirection operator: a descriptor number is dropped, any other word ends. */
  const beforeRedirect = (): void => {
    if (started && !quoted && FD_WORD_RE.test(text)) {
      text = ''
      inner = []
      started = false
      return
    }
    flush()
  }
  let i = 0
  while (i < command.length) {
    const ch = command[i]
    if (ch === '\\' && i + 1 < command.length) {
      if (command[i + 1] !== '\n') {
        text += command[i + 1]
        started = true
      }
      i += 2
      continue
    }
    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      const stop = end < 0 ? command.length : end
      text += command.slice(i + 1, stop)
      quoted = true
      started = true
      i = stop + 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      while (j < command.length && command[j] !== '"') {
        const c = command[j]
        if (c === '\\' && j + 1 < command.length && '"\\$`'.includes(command[j + 1])) {
          text += command[j + 1]
          j += 2
          continue
        }
        if (c === '$' && command[j + 1] === '(') {
          const close = closingParen(command, j + 2)
          const end = close < 0 ? command.length : close
          inner.push(command.slice(j + 2, end))
          text += command.slice(j, Math.min(end + 1, command.length))
          j = end + 1
          continue
        }
        if (c === '`') {
          const close = command.indexOf('`', j + 1)
          const end = close < 0 ? command.length : close
          inner.push(command.slice(j + 1, end))
          text += command.slice(j, Math.min(end + 1, command.length))
          j = end + 1
          continue
        }
        text += c
        j++
      }
      quoted = true
      started = true
      i = j + 1
      continue
    }
    if (ch === '#' && !started) {
      const nl = command.indexOf('\n', i)
      i = nl < 0 ? command.length : nl
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flush()
      i++
      continue
    }
    // Arithmetic is one word: `$((…))`, `$[…]`, or the command `((…))`. One
    // that never closes is read on as ordinary text (it hides nothing).
    const arithmetic = ch === '$' && command[i + 1] === '(' && command[i + 2] === '('
      ? { open: 3, close: closingArithmetic(command, i + 3, 2) }
      : ch === '$' && command[i + 1] === '['
        ? { open: 2, close: command.indexOf(']', i + 2) }
        : ch === '(' && command[i + 1] === '(' && !started
          ? { open: 2, close: closingArithmetic(command, i + 2, 2) }
          : null
    if (arithmetic && arithmetic.close >= 0) {
      inner.push(...substitutionsIn(command.slice(i + arithmetic.open, arithmetic.close)))
      text += command.slice(i, arithmetic.close + 1)
      started = true
      i = arithmetic.close + 1
      continue
    }
    if (ch === '$' && command[i + 1] === '(') {
      boundary()
      parens.push('s')
      i += 2
      continue
    }
    if (ch === '(') parens.push('g')
    else if (ch === ')') parens.pop()
    if (ch === '<' || ch === '>' || (ch === '&' && command[i + 1] === '>')) {
      beforeRedirect()
      if (command.startsWith('<<<', i)) {
        redirectNext = 'here-string'
        i += 3
        continue
      }
      if (command.startsWith('<<', i)) {
        const strip = command[i + 2] === '-'
        const d = readDelimiter(command, i + (strip ? 3 : 2))
        if (!d) {
          i += strip ? 3 : 2
          continue
        }
        const doc: HereDoc = { delimiter: d.delimiter, stripTabs: strip, expand: !d.quoted, body: '' }
        tokens.push({ text: '', quoted: false, inner: [], hereDoc: doc })
        pending.push(doc)
        i = d.end
        continue
      }
      // `&>` `&>>` `<` `<>` `<&` `>` `>>` `>|` `>&`
      i += ch === '&' ? 2 : 1
      if ((ch === '&' || ch === '>') && command[i] === '>') i++
      else if (ch === '<' && (command[i] === '>' || command[i] === '&')) i++
      else if (ch === '>' && (command[i] === '|' || command[i] === '&')) i++
      redirectNext = 'target'
      continue
    }
    if (ch === '\n' && pending.length > 0) {
      boundary()
      const docs = [...pending]
      pending.length = 0
      const next = readHereDocBodies(command, i + 1, docs, parens.includes('s'))
      if (next < 0) {
        // No delimiter line: not a here-document for this reading — its lines are read as commands.
        for (const doc of docs) doc.body = ''
        i++
        continue
      }
      for (const doc of docs) {
        const token = tokens.find((t) => t.hereDoc === doc)
        if (token && doc.expand) token.inner.push(...substitutionsIn(doc.body))
      }
      i = next
      continue
    }
    if (OPERATOR_CHARS.has(ch)) {
      boundary()
      i++
      continue
    }
    text += ch
    started = true
    i++
  }
  flush()
  return tokens
}

/** `~`, `~user`, `$HOME` and `${HOME}` at the start of a word. */
export function expandHome(value: string, homeDir: string): string {
  if (value === '~' || value === '$HOME' || value === '${HOME}') return homeDir
  if (value.startsWith('~/')) return join(homeDir, value.slice(2))
  if (value.startsWith('$HOME/')) return join(homeDir, value.slice(6))
  if (value.startsWith('${HOME}/')) return join(homeDir, value.slice(8))
  const other = /^~([A-Za-z0-9._-]+)(?:\/(.*))?$/s.exec(value)
  if (other) return join(dirname(homeDir), other[1], other[2] ?? '')
  return value
}

/**
 * The part of a glob pattern before its first wildcard segment:
 * `/a/b/**\/*.md` → `/a/b`, `src/*.ts` → `src`, `*.md` → ``.
 */
export function literalGlobPrefix(pattern: string): string {
  const absolute = pattern.startsWith('/')
  const kept: string[] = []
  for (const segment of pattern.split('/')) {
    if (GLOB_CHARS_RE.test(segment)) break
    kept.push(segment)
  }
  const joined = kept.join('/')
  if (absolute && joined === '') return '/'
  return joined
}

/** A path when `value` looks like one, else null. */
function asPathCandidate(value: string, quoted: boolean, opts: ShellPathOptions): string | null {
  let v = value
  if (!v || v.length > 4096 || v.includes('\0')) return null
  if (/^file:\/\//i.test(v)) {
    try {
      v = fileURLToPath(v)
    } catch {
      return null
    }
  } else if (URL_SCHEME_RE.test(v)) {
    return null
  }
  const expanded = expandHome(v, opts.homeDir)
  const homeRelative = expanded !== v
  v = expanded
  const hasSpace = /\s/.test(v)
  const pathLike =
    isAbsolute(v) ||
    homeRelative ||
    v === '.' || v === '..' ||
    v.startsWith('./') || v.startsWith('../') ||
    (v.includes('/') && !hasSpace)
  if (!pathLike) return null
  // Quoted prose that happens to contain a slash is not a path; a quoted
  // absolute or home path with spaces in it is.
  if (quoted && hasSpace && !isAbsolute(v)) return null
  if (GLOB_CHARS_RE.test(v)) v = literalGlobPrefix(v) || '.'
  if (isAbsolute(v)) return resolve(v)
  if (opts.cwd) return resolve(opts.cwd, v)
  const rel = normalize(v)
  return rel.length > 1 ? rel.replace(/[\\/]+$/, '') : rel
}

/**
 * The words a shell word stands for after brace expansion (`~/{a,b}` is
 * `~/a` and `~/b`). Too many to list: the word as written and its part before
 * the first brace, which every variant lies below.
 */
export function braceVariants(word: string): string[] {
  if (!word.includes('{')) return [word]
  const variants = expandBraces(word)
  if (variants) return variants
  return [word, literalGlobPrefix(word.replace('{', '*'))]
}

/** `shell`: the word went through the shell, so its brace alternatives count too. */
function candidatesOfWord(word: string, quoted: boolean, opts: ShellPathOptions, out: Set<string>, shell: boolean): void {
  for (const variant of shell ? braceVariants(word) : [word]) {
    const direct = asPathCandidate(variant, quoted, opts)
    if (direct) out.add(direct)
    const assignment = ASSIGNMENT_RE.exec(variant)
    if (assignment) {
      const value = asPathCandidate(assignment[1], quoted, opts)
      if (value) out.add(value)
    }
  }
}

function extract(command: string, opts: ShellPathOptions, depth: number, out: Set<string>): void {
  if (depth > MAX_DEPTH) return
  for (const token of tokenize(command.slice(0, MAX_COMMAND_CHARS))) {
    if (token.boundary) continue
    // A here-document's lines (and a here-string) may be a script some
    // program runs: the paths they name count, as on a command line.
    if (token.hereDoc) {
      extract(token.hereDoc.body, opts, depth + 1, out)
      continue
    }
    candidatesOfWord(token.text, token.quoted, opts, out, true)
    if (token.hereString) extract(token.text, opts, depth + 1, out)
    for (const sub of token.inner) extract(sub, opts, depth + 1, out)
  }
}

/**
 * Every path a shell command line visibly names: arguments, redirection
 * targets, `--flag=value` and `VAR=value` values, `file://` URLs, brace
 * alternatives, here-document and here-string text and the contents of
 * command substitutions. `~`, `$HOME` and `${HOME}` are expanded; relative
 * paths are resolved against `cwd` (no `cd` tracking). Deduplicated.
 */
export function extractShellPathCandidates(command: string, opts: ShellPathOptions): string[] {
  if (typeof command !== 'string' || command.length === 0) return []
  const out = new Set<string>()
  extract(command, opts, 0, out)
  return [...out]
}

/**
 * The same for an argv array (run_command `args`): each item is one word, so
 * nothing is split or brace-expanded, but spaces in it do not disqualify an
 * absolute path.
 */
export function pathCandidatesFromArgv(argv: readonly unknown[], opts: ShellPathOptions): string[] {
  const out = new Set<string>()
  for (const item of argv) {
    if (typeof item === 'string') candidatesOfWord(item, true, opts, out, false)
  }
  return [...out]
}

/** One word of a simple command. */
export interface ShellWord {
  text: string
  /** Some part of the word was quoted (a quoted glob is not expanded by the shell). */
  quoted: boolean
}

/** One simple command: its words, its redirection targets and what it gets on stdin from the line itself. */
export interface ShellSimpleCommand {
  /** Program and arguments, in order — never a redirection or its target. */
  words: ShellWord[]
  /** Redirection targets (`> out`, `2>/dev/null`, `< in`): the shell glob-expands them too. */
  redirects: ShellWord[]
  /** Here-document bodies and here-string words: the command's stdin, never glob-expanded. */
  stdin: string[]
}

/**
 * The simple commands of a command line, in order: split at pipes, lists,
 * subshells and newlines; command substitutions (bare, inside double quotes,
 * in arithmetic or in an expanding here-document) come out as simple commands
 * of their own. Redirections are not words: `2>/dev/null` and its target
 * leave the command going on. Quotes are removed, `~` is left as written.
 * Best effort like everything here: no aliases and no functions; `eval`,
 * `sh -c` and shells reading stdin are for the caller (search-scope.ts).
 */
export function shellSimpleCommands(command: string): ShellSimpleCommand[] {
  const out: ShellSimpleCommand[] = []
  const walk = (text: string, depth: number): void => {
    if (depth > MAX_DEPTH) return
    let current: ShellSimpleCommand = { words: [], redirects: [], stdin: [] }
    const end = (): void => {
      if (current.words.length > 0 || current.redirects.length > 0 || current.stdin.length > 0) out.push(current)
      current = { words: [], redirects: [], stdin: [] }
    }
    const inner: string[] = []
    for (const token of tokenize(text.slice(0, MAX_COMMAND_CHARS))) {
      if (token.boundary) {
        end()
        continue
      }
      inner.push(...token.inner)
      if (token.hereDoc) {
        if (token.hereDoc.body) current.stdin.push(token.hereDoc.body)
        continue
      }
      if (token.hereString) current.stdin.push(token.text)
      else if (token.redirect) current.redirects.push({ text: token.text, quoted: token.quoted })
      else current.words.push({ text: token.text, quoted: token.quoted })
    }
    end()
    for (const sub of inner) walk(sub, depth + 1)
  }
  if (typeof command === 'string' && command.length > 0) walk(command, 0)
  return out
}
