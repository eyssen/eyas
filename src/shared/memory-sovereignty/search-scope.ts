// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The "effective search set" of a tool call: the folder a search starts from
// and the include globs that narrow it. The path policy (path-policy.ts)
// judges this set against the protected places BELOW the folder, because a
// search rooted at an ancestor of a store reaches the store although the
// folder itself is not protected (Grep of ~ with glob **/memory/*.md, Glob of
// ~ for **/MEMORY.md, `grep -r token ~`).
//
// Which calls are searches here:
//   - the CLIs' own search tools: Claude Code Grep, Glob and LS; Grok's grep
//     and list_dir (ACP rawInput variant Grep / ListDir; list_dir walks the
//     whole subtree); OpenCode's grep/glob/list as its permission gate maps
//     them (Grep/Glob);
//   - shell command lines (any tool input with a `command`, e.g. Bash, Grok's
//     run_terminal_command, EYAS run_command with `args`): recursive programs
//     (grep -r, rg, ag, find, fd, tree, du, ls -R, recursive copies and
//     archives, locate/mdfind over the whole index) and glob words such as
//     `~/.*/memory/*.md`. Reserved words (`if`, `then`, `do`, `!`, `{`, …),
//     wrappers (nice, timeout, env, sudo, …), `eval`, `sh -c` and a shell
//     reading its script from a here-document or here-string are looked
//     through; a search run by xargs or parallel gets its folders from input
//     the line does not show, so it counts as a search of `/`. Here-document
//     lines are data to every other program: never glob words, never commands.
// EYAS's own grep and glob tools are NOT listed: their folder walk leaves out
// every protected folder and file itself (tools/builtin/file-tools.ts), so
// an enclosing folder never makes them read one.
//
// Globs are read conservatively — a glob "may reach" a protected folder
// unless its segments prove it cannot. Ripgrep-style include globs (Grep
// `glob`, Glob `pattern`) match at any depth when they have no slash, like a
// .gitignore line; shell glob words are anchored at their literal prefix.
// Exclusion globs (`!…`) never narrow the set.

import { dirname, isAbsolute, resolve } from 'node:path'
import {
  braceVariants,
  expandBraces,
  expandHome,
  literalGlobPrefix,
  shellSimpleCommands,
  type ShellWord,
} from './shell-paths.js'

export interface SearchScope {
  /** Input field the folder came from (`path`, `command`, `args`, …). */
  field: string
  /** Absolute folder the search starts from. */
  root: string
  /** Include globs relative to `root`; empty = everything below it. */
  globs: string[]
  /** true: a glob without a slash matches at any depth (ripgrep). false: anchored at `root` (shell). */
  anywhere: boolean
}

export interface SearchScopeOptions {
  /** Base of relative paths (the call's working directory); without it relative roots are not judged. */
  base?: string
  /** Expansion target of `~` and `$HOME`. */
  homeDir: string
}

const GLOB_CHARS_RE = /[*?[]/
const MAX_GLOB_SEGMENTS = 64
/** How deep `sh -c`, `eval` and stdin scripts are followed. */
const MAX_SCRIPT_DEPTH = 3
/** Longer include globs are not read: the search counts as reaching everything below its folder. */
const MAX_GLOB_CHARS = 1024

// ── Which tool calls are searches ─────────────────────────────────────────

/** The CLIs' own search tools (tool name or Grok's rawInput variant). EYAS's lowercase grep/glob are not here. */
const NATIVE_SEARCH: Readonly<Record<string, 'grep' | 'glob' | 'list'>> = {
  Grep: 'grep',
  Glob: 'glob',
  LS: 'list',
  ListDir: 'list',
}

/** Fields that hold the folder of a native search, in order of preference. */
const ROOT_FIELDS: Readonly<Record<'grep' | 'glob' | 'list', readonly string[]>> = {
  grep: ['path'],
  glob: ['path', 'directory'],
  list: ['path', 'target_directory', 'directory', 'dir_path'],
}

/**
 * A native search tool's kind, or null for any other tool. Grok's rawInput
 * carries its variant; EYAS's own tools never do.
 */
export function nativeSearchKind(toolName: string, input: Record<string, unknown>): 'grep' | 'glob' | 'list' | null {
  const variant = typeof input.variant === 'string' ? input.variant : ''
  return NATIVE_SEARCH[variant] ?? NATIVE_SEARCH[toolName] ?? null
}

/**
 * Claude Code's Grep splits its `glob` at whitespace, then at commas unless
 * the part holds braces. Other CLIs pass the value as one glob: both readings
 * are kept (either may be what the search uses).
 */
export function splitIncludeGlobs(value: string): string[] {
  const out = new Set<string>()
  const whole = value.trim()
  if (whole) out.add(whole)
  for (const part of whole.split(/\s+/)) {
    if (!part) continue
    if (part.includes('{') && part.includes('}')) out.add(part)
    else for (const piece of part.split(',')) if (piece) out.add(piece)
  }
  return [...out]
}

/**
 * The search scopes a tool call opens: a native search tool's folder and
 * globs, and every search in its `command` line. A relative folder without a
 * base opens none.
 */
export function searchScopesOf(
  toolName: string,
  input: Record<string, unknown>,
  opts: SearchScopeOptions,
): SearchScope[] {
  const scopes: SearchScope[] = []
  const kind = nativeSearchKind(toolName, input)
  if (kind) {
    const native = nativeScope(kind, input, opts)
    if (native) scopes.push(native)
  }
  const command = input.command
  if (typeof command === 'string' && command.trim()) {
    const argv = Array.isArray(input.args) ? input.args.filter((a): a is string => typeof a === 'string') : null
    scopes.push(...(argv ? argvSearchScopes(command, argv, opts) : shellSearchScopes(command, opts)))
  }
  return scopes
}

function absoluteFrom(value: string, opts: SearchScopeOptions, base = opts.base): string | null {
  const v = expandHome(value.trim(), opts.homeDir)
  if (!v || v.includes('\0')) return null
  if (isAbsolute(v)) return resolve(v)
  return base && isAbsolute(base) ? resolve(base, v) : null
}

function nativeScope(kind: 'grep' | 'glob' | 'list', input: Record<string, unknown>, opts: SearchScopeOptions): SearchScope | null {
  let field = 'cwd'
  let root: string | null = opts.base && isAbsolute(opts.base) ? resolve(opts.base) : null
  for (const key of ROOT_FIELDS[kind]) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      field = key
      root = absoluteFrom(value, opts)
      break
    }
  }
  const globs: string[] = []
  if (kind === 'grep') {
    for (const key of ['glob', 'include']) {
      const value = input[key]
      if (typeof value === 'string' && value.trim()) globs.push(...splitIncludeGlobs(value))
    }
  }
  if (kind === 'glob') {
    const pattern = typeof input.pattern === 'string' ? expandHome(input.pattern.trim(), opts.homeDir) : ''
    if (pattern && isAbsolute(pattern)) {
      // An absolute pattern searches from its literal part (Claude Code's
      // Glob: the folder before the first wildcard segment, else the
      // pattern's own folder with its last segment as the glob).
      const split = splitAbsolutePattern(pattern)
      field = 'pattern'
      root = resolve(split.base)
      globs.push(split.rest)
    } else if (pattern) {
      globs.push(pattern)
    }
  }
  return root ? { field, root, globs, anywhere: true } : null
}

function splitAbsolutePattern(pattern: string): { base: string; rest: string } {
  const at = pattern.search(/[*?[{]/)
  if (at < 0) return { base: dirname(pattern), rest: pattern.slice(dirname(pattern).length).replace(/^\/+/, '') }
  const head = pattern.slice(0, at)
  const cut = head.lastIndexOf('/')
  if (cut <= 0) return { base: '/', rest: pattern.replace(/^\/+/, '') }
  return { base: pattern.slice(0, cut), rest: pattern.slice(cut + 1) }
}

// ── Shell command lines ───────────────────────────────────────────────────

interface ProgramSpec {
  /** Short options that take a value (the rest of the cluster, else the next word). */
  shortValue: string
  /** Long options (no `=`) that take the next word as their value. */
  longValue: ReadonlySet<string>
  /** Recursive always, or only with one of these short / long flags. */
  recursive: 'always' | { short: string; long: readonly string[] }
  /** The first positional is a pattern, unless one of these options supplied it. */
  patternFirst?: { short: string; long: readonly string[] }
  /** Positionals up to the first expression word (find). */
  findStyle?: boolean
  /** The last positional is a destination, not a source (cp, rsync, scp). */
  dropLast?: boolean
  /** Options whose value is a search folder (fd --search-path, mdfind -onlyin, tar -C). */
  rootOptions?: { short: string; long: readonly string[] }
  /** Without a folder it searches the whole machine's index (locate, mdfind). */
  indexWide?: boolean
  /** Without a folder it searches the working directory. */
  defaultCwd: boolean
}

const GREP_SPEC: ProgramSpec = {
  shortValue: 'efmABCdD',
  longValue: new Set(['--regexp', '--file', '--max-count', '--after-context', '--before-context', '--context', '--directories', '--devices', '--include', '--exclude', '--exclude-dir', '--exclude-from', '--label', '--binary-files', '--group-separator']),
  recursive: { short: 'rR', long: ['--recursive', '--dereference-recursive'] },
  patternFirst: { short: 'ef', long: ['--regexp', '--file'] },
  defaultCwd: true,
}

const SPECS: Readonly<Record<string, ProgramSpec>> = {
  grep: GREP_SPEC,
  egrep: GREP_SPEC,
  fgrep: GREP_SPEC,
  ggrep: GREP_SPEC,
  zgrep: GREP_SPEC,
  ugrep: GREP_SPEC,
  ug: GREP_SPEC,
  rgrep: { ...GREP_SPEC, recursive: 'always' },
  rg: {
    shortValue: 'efgtTmABCMjErd',
    longValue: new Set(['--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--type-add', '--type-clear', '--max-count', '--after-context', '--before-context', '--context', '--max-columns', '--threads', '--encoding', '--replace', '--max-depth', '--max-filesize', '--pre', '--pre-glob', '--sort', '--sortr', '--path-separator', '--colors', '--color', '--context-separator', '--field-match-separator', '--field-context-separator', '--ignore-file', '--dfa-size-limit', '--regex-size-limit', '--engine']),
    recursive: 'always',
    patternFirst: { short: 'ef', long: ['--regexp', '--file', '--files', '--type-list'] },
    defaultCwd: true,
  },
  ag: { shortValue: 'ABCGgmp', longValue: new Set(['--after', '--before', '--context', '--file-search-regex', '--max-count', '--path-to-ignore', '--depth', '--ignore', '--ignore-dir']), recursive: 'always', patternFirst: { short: 'g', long: [] }, defaultCwd: true },
  ack: { shortValue: 'ABCgm', longValue: new Set(['--after-context', '--before-context', '--context', '--max-count', '--type', '--ignore-dir', '--ignore-file']), recursive: 'always', patternFirst: { short: 'gf', long: [] }, defaultCwd: true },
  pt: { shortValue: 'ABCG', longValue: new Set(['--after', '--before', '--context', '--file-search-regexp', '--depth']), recursive: 'always', patternFirst: { short: '', long: [] }, defaultCwd: true },
  sift: { shortValue: 'ABCx', longValue: new Set(['--after-context', '--before-context', '--context', '--ext']), recursive: 'always', patternFirst: { short: 'e', long: ['--regexp'] }, defaultCwd: true },
  fd: {
    shortValue: 'etEdxXcjSoCg',
    longValue: new Set(['--extension', '--type', '--exclude', '--max-depth', '--min-depth', '--exact-depth', '--exec', '--exec-batch', '--size', '--changed-within', '--changed-before', '--owner', '--base-directory', '--search-path', '--color', '--threads', '--max-results', '--ignore-file', '--path-separator', '--batch-size', '--format']),
    recursive: 'always',
    patternFirst: { short: '', long: [] },
    rootOptions: { short: '', long: ['--search-path', '--base-directory'] },
    defaultCwd: true,
  },
  find: { shortValue: 'D', longValue: new Set(), recursive: 'always', findStyle: true, defaultCwd: true },
  tree: { shortValue: 'LPIo', longValue: new Set(['--charset', '--filelimit', '--timefmt', '--sort']), recursive: 'always', defaultCwd: true },
  du: { shortValue: 'dBt', longValue: new Set(['--max-depth', '--block-size', '--threshold', '--exclude', '--time-style', '--files0-from']), recursive: 'always', defaultCwd: true },
  ls: { shortValue: 'IwT', longValue: new Set(['--ignore', '--hide', '--width', '--tabsize', '--block-size', '--format', '--sort', '--time', '--time-style', '--quoting-style', '--indicator-style', '--color']), recursive: { short: 'R', long: ['--recursive'] }, defaultCwd: true },
  cp: { shortValue: 'tS', longValue: new Set(['--target-directory', '--suffix']), recursive: { short: 'rRa', long: ['--recursive', '--archive'] }, dropLast: true, defaultCwd: false },
  rsync: { shortValue: 'efTB', longValue: new Set(['--rsh', '--exclude', '--include', '--filter', '--files-from', '--temp-dir', '--log-file', '--chmod', '--rsync-path', '--compare-dest', '--copy-dest', '--link-dest', '--partial-dir']), recursive: { short: 'ra', long: ['--recursive', '--archive'] }, dropLast: true, defaultCwd: false },
  scp: { shortValue: 'PioFlcSJ', longValue: new Set(), recursive: { short: 'r', long: [] }, dropLast: true, defaultCwd: false },
  ditto: { shortValue: '', longValue: new Set(['--arch']), recursive: 'always', dropLast: true, defaultCwd: false },
  zip: { shortValue: 'nbtix', longValue: new Set(['--suffixes', '--temp-path', '--exclude', '--include']), recursive: { short: 'rR', long: ['--recurse-paths', '--recurse-patterns'] }, defaultCwd: false },
  tar: { shortValue: 'fCbTXIK', longValue: new Set(['--file', '--directory', '--exclude', '--files-from', '--exclude-from', '--use-compress-program', '--transform', '--blocking-factor']), recursive: { short: 'cru', long: ['--create', '--append', '--update'] }, rootOptions: { short: 'C', long: ['--directory'] }, defaultCwd: false },
  locate: { shortValue: 'dlnr', longValue: new Set(['--database', '--limit', '--regexp']), recursive: 'always', patternFirst: { short: '', long: [] }, indexWide: true, defaultCwd: false },
  mdfind: { shortValue: '', longValue: new Set(['-onlyin', '-attr', '-s']), recursive: 'always', patternFirst: { short: '', long: [] }, rootOptions: { short: '', long: ['-onlyin'] }, indexWide: true, defaultCwd: false },
}
for (const alias of ['ack-grep']) (SPECS as Record<string, ProgramSpec>)[alias] = SPECS.ack
for (const alias of ['fdfind']) (SPECS as Record<string, ProgramSpec>)[alias] = SPECS.fd
for (const alias of ['gfind']) (SPECS as Record<string, ProgramSpec>)[alias] = SPECS.find
for (const alias of ['plocate', 'mlocate', 'slocate']) (SPECS as Record<string, ProgramSpec>)[alias] = SPECS.locate
for (const alias of ['gcp']) (SPECS as Record<string, ProgramSpec>)[alias] = SPECS.cp
for (const alias of ['gtar', 'bsdtar']) (SPECS as Record<string, ProgramSpec>)[alias] = SPECS.tar

/** Programs that run the rest of their words as a command. Value = short options with a value. */
const WRAPPERS: Readonly<Record<string, string>> = {
  command: '', builtin: '', exec: '', nohup: '', time: '', nice: 'n', env: 'uCS', xargs: 'ILnPsdEa',
  timeout: 'sk', stdbuf: 'ioe', ionice: 'cnp', caffeinate: 't', doas: 'u', sudo: 'ugpCDrtUT',
  parallel: 'jSIEdnNLlmMsX', setsid: '',
}
/** Wrappers that append words from their input: the command's folders are not on the line. */
const INPUT_FED: ReadonlySet<string> = new Set(['xargs', 'parallel'])
/** Shell reserved words and grouping that may stand before a command. */
const RESERVED: ReadonlySet<string> = new Set(['!', '{', '}', 'if', 'then', 'elif', 'else', 'fi', 'do', 'done', 'while', 'until', 'esac'])
const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])
/** A shell given one of these as its script reads the script from stdin. */
const STDIN_SCRIPTS: ReadonlySet<string> = new Set(['-', '/dev/stdin', '/dev/fd/0', '/proc/self/fd/0'])
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

interface ParsedArgs {
  positionals: string[]
  short: Set<string>
  long: Set<string>
  values: Map<string, string[]>
}

function parseArgs(words: readonly string[], spec: ProgramSpec): ParsedArgs {
  const out: ParsedArgs = { positionals: [], short: new Set(), long: new Set(), values: new Map() }
  const record = (key: string, value: string): void => {
    const list = out.values.get(key) ?? []
    list.push(value)
    out.values.set(key, list)
  }
  let endOfOptions = false
  let expression = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (expression) continue
    if (endOfOptions) {
      out.positionals.push(w)
      continue
    }
    if (w === '--') {
      endOfOptions = true
      continue
    }
    if (spec.findStyle) {
      // find [-H|-L|-P] [-D x] [-O n] path... expression
      if (out.positionals.length === 0 && /^-(?:[HLP]|O\d*)$/.test(w)) continue
      if (out.positionals.length === 0 && w === '-D') {
        i++
        continue
      }
      if (/^[-(!)]/.test(w)) {
        expression = true
        continue
      }
      out.positionals.push(w)
      continue
    }
    if (w.startsWith('--') || (w.startsWith('-') && spec.longValue.has(w))) {
      const eq = w.indexOf('=')
      const name = eq >= 0 ? w.slice(0, eq) : w
      out.long.add(name)
      if (eq >= 0) record(name, w.slice(eq + 1))
      else if (spec.longValue.has(name) && i + 1 < words.length) record(name, words[++i])
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      const cluster = w.slice(1)
      for (let k = 0; k < cluster.length; k++) {
        const c = cluster[k]
        out.short.add(c)
        if (spec.shortValue.includes(c)) {
          const rest = cluster.slice(k + 1)
          if (rest) record(`-${c}`, rest)
          else if (i + 1 < words.length) record(`-${c}`, words[++i])
          break
        }
      }
      continue
    }
    out.positionals.push(w)
  }
  return out
}

function isRecursive(spec: ProgramSpec, args: ParsedArgs, program: string): boolean {
  if (spec.recursive === 'always') return true
  const { short, long } = spec.recursive
  if ([...short].some((c) => args.short.has(c))) return true
  if (long.some((l) => args.long.has(l))) return true
  if (program.endsWith('grep') || program === 'ug') {
    const dirs = [...(args.values.get('-d') ?? []), ...(args.values.get('--directories') ?? [])]
    if (dirs.includes('recurse')) return true
  }
  return false
}

/**
 * A path word's search roots (a glob word searches below its literal prefix)
 * and the anchored rest — one per brace alternative (`~/{.,}` is the home).
 */
function wordRoot(word: string, bases: readonly string[], opts: SearchScopeOptions): Array<{ root: string; glob?: string }> {
  const out: Array<{ root: string; glob?: string }> = []
  for (const variant of braceVariants(word)) {
    const expanded = expandHome(variant, opts.homeDir)
    if (!expanded || expanded.includes('\0')) continue
    const hasGlob = GLOB_CHARS_RE.test(expanded)
    const prefix = hasGlob ? literalGlobPrefix(expanded) : expanded
    const rest = hasGlob ? expanded.slice(prefix.length).replace(/^\/+/, '') : ''
    const targets = isAbsolute(prefix) ? [resolve(prefix)] : bases.map((b) => resolve(b, prefix || '.'))
    for (const root of targets) out.push(rest ? { root, glob: rest } : { root })
  }
  return out
}

interface Unwrapped {
  program: string
  args: string[]
  /** `sh -c <script>` or `eval <words>`: the script to read as a command line of its own. */
  script?: string
  /** A shell reading its script from stdin (`bash`, `sh -s`, `bash -`): a here-document or here-string it gets is that script. */
  stdinScript?: true
  /** Run by xargs or parallel: more arguments come from input the command line does not show. */
  fed?: true
}

/** A shell's own options, then what it runs: a `-c` script, a script file, or its stdin. */
function unwrapShell(program: string, words: readonly string[], fed: boolean): Unwrapped {
  let command = false
  let stdin = false
  let k = 0
  for (; k < words.length; k++) {
    const w = words[k]
    if (w === '--') {
      k++
      break
    }
    if (!/^[-+]./.test(w)) break
    if (w.startsWith('--')) continue
    if (w === '-o' || w === '+o' || w === '-O' || w === '+O') {
      k++
      continue
    }
    if (w.startsWith('-') && w.includes('c')) command = true
    if (w.startsWith('-') && w.includes('s')) stdin = true
  }
  const rest = words.slice(k)
  const extra = fed ? { fed: true as const } : {}
  if (command) return { program, args: [], script: rest[0] ?? '', ...extra }
  if (stdin || rest.length === 0 || STDIN_SCRIPTS.has(rest[0])) return { program, args: rest, stdinScript: true, ...extra }
  return { program, args: rest, ...extra }
}

function unwrap(words: readonly string[]): Unwrapped | null {
  let i = 0
  let fed = false
  for (let guard = 0; guard < 8 && i < words.length; guard++) {
    while (i < words.length && (RESERVED.has(words[i]) || ASSIGNMENT_RE.test(words[i]))) i++
    if (i >= words.length) return null
    const program = words[i].split('/').pop() ?? ''
    // `coproc [NAME] command`: NAME only before a `{ … }` group.
    if (program === 'coproc') {
      i += words[i + 2] === '{' ? 3 : 1
      continue
    }
    if (program === 'eval') return { program, args: [], script: words.slice(i + 1).join(' '), ...(fed ? { fed: true as const } : {}) }
    if ((program === 'source' || program === '.') && STDIN_SCRIPTS.has(words[i + 1] ?? '')) {
      return { program, args: words.slice(i + 1) as string[], stdinScript: true, ...(fed ? { fed: true as const } : {}) }
    }
    const valued = WRAPPERS[program]
    if (valued === undefined) {
      if (SHELLS.has(program)) return unwrapShell(program, words.slice(i + 1), fed)
      return { program, args: words.slice(i + 1) as string[], ...(fed ? { fed: true as const } : {}) }
    }
    if (INPUT_FED.has(program)) fed = true
    i++
    // The wrapper's own options (and a leading duration for timeout).
    while (i < words.length && words[i].startsWith('-') && words[i] !== '-') {
      const w = words[i]
      i++
      if (w.length === 2 && valued.includes(w[1])) i++
    }
    if (program === 'timeout' && i < words.length && /^\d/.test(words[i])) i++
  }
  return null
}

function programScopes(
  words: readonly string[],
  bases: readonly string[],
  field: string,
  opts: SearchScopeOptions,
  depth: number,
  fedBy: boolean,
): { scopes: SearchScope[]; cd?: string; stdinScript?: boolean } {
  const scopes: SearchScope[] = []
  const unwrapped = unwrap(words)
  if (!unwrapped) return { scopes }
  const fed = fedBy || unwrapped.fed === true
  if (unwrapped.script !== undefined) {
    if (depth < MAX_SCRIPT_DEPTH) scopes.push(...shellScopes(unwrapped.script, bases, field, opts, depth + 1, fed))
    return { scopes }
  }
  if (unwrapped.stdinScript) return { scopes, stdinScript: true }
  let { program, args } = unwrapped
  if (program === 'cd' || program === 'pushd') {
    const target = args.find((a) => !a.startsWith('-'))
    return { scopes, cd: target ?? '~' }
  }
  if (program === 'git') {
    // `git grep --no-index` / `--untracked` searches files git does not track.
    const at = args.indexOf('grep')
    if (at < 0 || !args.slice(at + 1).some((a) => a === '--no-index' || a === '--untracked')) return { scopes }
    program = 'grep'
    args = ['-r', ...args.slice(at + 1).filter((a) => a !== '--no-index' && a !== '--untracked')]
  }
  const spec = SPECS[program]
  if (!spec) return { scopes }
  // tar's first word may be a bare option cluster (`tar czf out.tgz dir`).
  if ((program === 'tar' || program === 'gtar' || program === 'bsdtar') && args[0] && /^[A-Za-z]+$/.test(args[0])) {
    args = [`-${args[0]}`, ...args.slice(1)]
  }
  const parsed = parseArgs(args, spec)
  if (!isRecursive(spec, parsed, program)) return { scopes }
  // xargs / parallel append folders the line does not show: any folder at all.
  if (fed) {
    scopes.push({ field, root: '/', globs: [], anywhere: false })
    return { scopes }
  }

  let paths = [...parsed.positionals]
  if (spec.patternFirst) {
    const supplied = [...spec.patternFirst.short].some((c) => parsed.short.has(c)) || spec.patternFirst.long.some((l) => parsed.long.has(l))
    if (!supplied && !spec.indexWide) paths = paths.slice(1)
  }
  if (spec.indexWide) paths = []
  if (spec.dropLast && paths.length > 0) paths = paths.slice(0, -1)
  const rootOptions = spec.rootOptions
  if (rootOptions) {
    for (const c of rootOptions.short) paths.push(...(parsed.values.get(`-${c}`) ?? []))
    for (const l of rootOptions.long) paths.push(...(parsed.values.get(l) ?? []))
  }
  if (paths.length === 0) {
    if (spec.indexWide) {
      scopes.push({ field, root: '/', globs: [], anywhere: false })
      return { scopes }
    }
    if (!spec.defaultCwd) return { scopes }
    paths = ['.']
  }
  for (const word of paths) {
    for (const { root, glob } of wordRoot(word, bases, opts)) {
      scopes.push({ field, root, globs: glob ? [glob] : [], anywhere: false })
    }
  }
  return { scopes }
}

/** Glob words the shell expands (unquoted, not an option): each lists what it matches below its literal prefix. */
function globWordScopes(words: readonly ShellWord[], bases: readonly string[], field: string, opts: SearchScopeOptions): SearchScope[] {
  const scopes: SearchScope[] = []
  for (const word of words) {
    if (word.quoted || word.text.startsWith('-') || ASSIGNMENT_RE.test(word.text)) continue
    if (!GLOB_CHARS_RE.test(word.text)) continue
    for (const { root, glob } of wordRoot(word.text, bases, opts)) {
      if (glob) scopes.push({ field, root, globs: [glob], anywhere: false })
    }
  }
  return scopes
}

function shellScopes(
  command: string,
  startBases: readonly string[],
  field: string,
  opts: SearchScopeOptions,
  depth: number,
  fed = false,
): SearchScope[] {
  const scopes: SearchScope[] = []
  // Every folder a `cd` may have moved to: relative words are judged against
  // each (subshells and conditionals are not followed, so all are kept).
  const bases = [...startBases]
  const stdinScripts: Array<{ script: string; bases: string[] }> = []
  let stdinShell = false
  for (const cmd of shellSimpleCommands(command)) {
    const found = programScopes(cmd.words.map((w) => w.text), bases, field, opts, depth, fed)
    scopes.push(...found.scopes, ...globWordScopes([...cmd.words, ...cmd.redirects], bases, field, opts))
    if (found.stdinScript) stdinShell = true
    for (const script of cmd.stdin) stdinScripts.push({ script, bases: [...bases] })
    if (found.cd !== undefined) {
      for (const { root } of wordRoot(found.cd, bases, opts)) if (!bases.includes(root)) bases.push(root)
    }
  }
  // A shell reading its script from stdin anywhere on the line (`bash <<EOF`,
  // `cat <<EOF | sh`): every here-document and here-string is read as a script.
  if (stdinShell && depth < MAX_SCRIPT_DEPTH) {
    for (const { script, bases: at } of stdinScripts) scopes.push(...shellScopes(script, at, field, opts, depth + 1, fed))
  }
  return scopes
}

/** The search scopes of a shell command line (Bash, run_terminal_command). */
export function shellSearchScopes(command: string, opts: SearchScopeOptions): SearchScope[] {
  const bases = opts.base && isAbsolute(opts.base) ? [resolve(opts.base)] : []
  return shellScopes(command, bases, 'command', opts, 0)
}

/** The search scopes of a program run without a shell (run_command: program + argv; nothing is expanded). */
export function argvSearchScopes(command: string, argv: readonly string[], opts: SearchScopeOptions): SearchScope[] {
  const bases = opts.base && isAbsolute(opts.base) ? [resolve(opts.base)] : []
  const head = command.trim().split(/\s+/).filter(Boolean)
  return programScopes([...head, ...argv], bases, 'args', opts, 0, false).scopes
}

/**
 * The scripts a command line runs that are not its own words: `sh -c` and
 * `eval` scripts, and here-documents / here-strings a shell reads as its
 * script — nested ones too. The path policy reads the paths they name like
 * the line's (a quoted `-c` script is one word, not prose).
 */
export function embeddedShellScripts(command: string): string[] {
  const out: string[] = []
  const visit = (text: string, depth: number): void => {
    if (depth >= MAX_SCRIPT_DEPTH) return
    const commands = shellSimpleCommands(text)
    const unwrapped = commands.map((cmd) => unwrap(cmd.words.map((w) => w.text)))
    const stdinShell = unwrapped.some((u) => u?.stdinScript === true)
    commands.forEach((cmd, k) => {
      const script = unwrapped[k]?.script
      if (script) {
        out.push(script)
        visit(script, depth + 1)
      }
      if (stdinShell) {
        for (const body of cmd.stdin) {
          out.push(body)
          visit(body, depth + 1)
        }
      }
    })
  }
  if (typeof command === 'string' && command.trim()) visit(command, 0)
  return out
}

// ── Glob matching ─────────────────────────────────────────────────────────

export interface SearchGlobMatcher {
  /**
   * May the search enter (list or read something in) the folder `rel`
   * segments below its root? True unless every include glob proves it cannot.
   */
  mayReach(rel: readonly string[]): boolean
}

const MATCH_ALL: SearchGlobMatcher = { mayReach: () => true }

/**
 * One glob segment, matched in linear time (no regular expression built from
 * model input, so no catastrophic backtracking): `*`, `?`, `[...]` classes
 * with ranges and `!`/`^` negation, `\x` escapes; everything else literal.
 */
interface SegmentMatcher {
  test(name: string): boolean
}

type SegmentToken =
  | { t: 'star' }
  | { t: 'any' }
  | { t: 'lit'; ch: string }
  | { t: 'class'; negate: boolean; items: Array<[string, string]>; invalid: boolean }

type Segment = '**' | SegmentMatcher

function segmentTokens(seg: string, fold: (s: string) => string): SegmentToken[] {
  const tokens: SegmentToken[] = []
  for (let k = 0; k < seg.length; k++) {
    const c = seg[k]
    if (c === '*') {
      while (seg[k + 1] === '*') k++
      tokens.push({ t: 'star' })
    } else if (c === '?') {
      tokens.push({ t: 'any' })
    } else if (c === '[') {
      const end = seg.indexOf(']', k + 2)
      if (end < 0) {
        tokens.push({ t: 'lit', ch: '[' })
        continue
      }
      let body = seg.slice(k + 1, end)
      const negate = body.startsWith('!') || body.startsWith('^')
      if (negate) body = body.slice(1)
      const items: Array<[string, string]> = []
      let invalid = false
      for (let b = 0; b < body.length; b++) {
        let lo = body[b]
        if (lo === '\\' && b + 1 < body.length) lo = body[++b]
        if (body[b + 1] === '-' && b + 2 < body.length) {
          let hi = body[b + 2]
          b += 2
          if (hi === '\\' && b + 1 < body.length) hi = body[++b]
          if (fold(lo) > fold(hi)) invalid = true
          items.push([fold(lo), fold(hi)])
        } else {
          items.push([fold(lo), fold(lo)])
        }
      }
      tokens.push({ t: 'class', negate, items, invalid })
      k = end
    } else if (c === '\\' && k + 1 < seg.length) {
      tokens.push({ t: 'lit', ch: fold(seg[++k]) })
    } else {
      tokens.push({ t: 'lit', ch: fold(c) })
    }
  }
  return tokens
}

function tokenMatches(token: SegmentToken, ch: string): boolean {
  switch (token.t) {
    case 'any':
      return true
    case 'lit':
      return token.ch === ch
    case 'class': {
      // A class the matcher cannot read matches anything (conservative).
      if (token.invalid) return true
      const hit = token.items.some(([lo, hi]) => ch >= lo && ch <= hi)
      return token.negate ? !hit : hit
    }
    default:
      return false
  }
}

function segmentMatcher(seg: string, caseInsensitive: boolean): SegmentMatcher {
  const fold = caseInsensitive ? (s: string) => s.toLowerCase() : (s: string) => s
  const tokens = segmentTokens(seg, fold)
  return {
    // The classic single-star backtracking wildcard match: O(name × tokens).
    test(raw: string): boolean {
      const name = fold(raw)
      let p = 0
      let s = 0
      let starP = -1
      let starS = 0
      while (s < name.length) {
        const token = tokens[p]
        if (token && token.t !== 'star' && tokenMatches(token, name[s])) {
          p++
          s++
        } else if (token && token.t === 'star') {
          starP = p++
          starS = s
        } else if (starP >= 0) {
          p = starP + 1
          s = ++starS
        } else {
          return false
        }
      }
      while (tokens[p]?.t === 'star') p++
      return p === tokens.length
    },
  }
}

function compilePattern(glob: string, anywhere: boolean, caseInsensitive: boolean): Segment[] | null {
  let g = glob.replace(/\/{2,}/g, '/')
  while (g.startsWith('./')) g = g.slice(2)
  g = g.replace(/\/+$/, '')
  if (!g) return null
  const anchored = g.startsWith('/')
  if (anchored) g = g.replace(/^\/+/, '')
  const parts = g.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length === 0 || parts.length > MAX_GLOB_SEGMENTS) return null
  const segments: Segment[] = parts.map((p) => (p === '**' ? '**' : segmentMatcher(p, caseInsensitive)))
  // A ripgrep glob without a slash matches at any depth.
  if (anywhere && !anchored && parts.length === 1 && parts[0] !== '**') segments.unshift('**')
  return segments
}

function patternMayReach(pattern: readonly Segment[], rel: readonly string[]): boolean {
  const failed = new Set<number>()
  const width = rel.length + 1
  const go = (i: number, j: number): boolean => {
    // The folder is consumed: whatever is left of the pattern may match inside it.
    if (j === rel.length) return true
    // The pattern matched an ancestor of the folder: a search may list or read inside it.
    if (i === pattern.length) return true
    const key = i * width + j
    if (failed.has(key)) return false
    const seg = pattern[i]
    const ok = seg === '**'
      ? go(i + 1, j) || go(i, j + 1)
      : seg.test(rel[j]) && go(i + 1, j + 1)
    if (!ok) failed.add(key)
    return ok
  }
  return go(0, 0)
}

/**
 * The include globs of a search as one matcher. No include glob (none given,
 * or only exclusions) means everything below the root is searched.
 */
export function compileSearchGlobs(globs: readonly string[], anywhere: boolean, caseInsensitive: boolean): SearchGlobMatcher {
  const includes = globs.map((g) => g.trim()).filter((g) => g && !g.startsWith('!'))
  if (includes.length === 0) return MATCH_ALL
  const patterns: Segment[][] = []
  for (const glob of includes) {
    if (glob.length > MAX_GLOB_CHARS) return MATCH_ALL
    const variants = expandBraces(glob)
    if (!variants) return MATCH_ALL
    for (const variant of variants) {
      const compiled = compilePattern(variant, anywhere, caseInsensitive)
      if (!compiled) return MATCH_ALL
      patterns.push(compiled)
    }
  }
  return { mayReach: (rel) => patterns.some((p) => patternMayReach(p, rel)) }
}

/** Literal (wildcard-free) segments of the include globs — the policy's segment rules read them. */
export function literalGlobSegments(glob: string): string[] {
  return glob.split(/[\\/]+/).filter((s) => s && !GLOB_CHARS_RE.test(s) && !s.includes('{'))
}
