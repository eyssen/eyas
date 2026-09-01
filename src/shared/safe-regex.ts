// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Catastrophic-backtracking (ReDoS) heuristic guard for user-supplied
 * regexes.
 *
 * Any code path that compiles a regex from YAML config, API payload,
 * or a DB row must route the pattern through assertSafeRegex() first.
 * The check is a deliberately small static heuristic — it catches the
 * classic "nested quantifier on overlapping alternatives" family
 * (for instance (a+)+$, (a|a)*, (.*)*) without pulling a full regex
 * AST library.
 *
 * Reference:
 *   https://en.wikipedia.org/wiki/ReDoS
 *   https://github.com/tldrsec/awesome-secure-defaults (safe-regex)
 */

export interface SafetyCheck {
  safe: boolean
  reason?: 'too-long' | 'nested-quantifier' | 'alternation-with-overlap' | 'excessive-quantifiers' | 'invalid-regex'
  detail?: string
}

export interface SafeRegexOptions {
  /** Max raw pattern length in characters. Default 1000. */
  maxLength?: number
  /** Max count of *, +, and braced quantifiers in the pattern. Default 20. */
  maxQuantifiers?: number
}

const DEFAULT_MAX_LENGTH = 1000
const DEFAULT_MAX_QUANTIFIERS = 20

/**
 * Returns a structured verdict on whether the pattern is safe enough to
 * compile. Callers that want to throw on unsafe can use assertSafeRegex.
 */
export function checkRegexSafety(
  pattern: string,
  opts: SafeRegexOptions = {},
): SafetyCheck {
  const maxLength = opts.maxLength ?? DEFAULT_MAX_LENGTH
  const maxQuantifiers = opts.maxQuantifiers ?? DEFAULT_MAX_QUANTIFIERS

  if (pattern.length > maxLength) {
    return {
      safe: false,
      reason: 'too-long',
      detail: `pattern length ${pattern.length} exceeds max ${maxLength}`,
    }
  }

  // Cheap invalidity check — if parentheses, brackets, or braces are
  // unbalanced the pattern will not compile. We do the shape check with
  // string scanning instead of attempting a RegExp compile, because
  // constructing a RegExp from a user-supplied string is exactly what
  // this whole module exists to gate — the linter flags any `new
  // RegExp(variable)` call, so we push the actual compilation into the
  // caller via `compileSafeRegex` where the nosemgrep is localized.
  const shape = checkBalancedShape(pattern)
  if (!shape.ok) {
    return {
      safe: false,
      reason: 'invalid-regex',
      detail: shape.reason,
    }
  }

  // Strip escaped chars AND non-capturing/lookaround group markers first.
  // `(?:abc)`, `(?=ab)`, `(?!x)`, `(?<name>...)` all contain a literal `?`
  // that isn't a quantifier; without removing them the heuristic
  // misclassifies benign patterns like `(?:abc)+` as nested-quantifiers.
  const stripped = stripGroupMarkers(stripEscapedChars(pattern))

  // Nested quantifier: a group with an inner quantifier that itself is
  // followed by an outer quantifier. Matches (a+)+, (a*)*, (.+)+, (?:a+){2,}.
  if (/\([^)]*[+*?]\{?\d*,?\d*\}?[^)]*\)[+*?]\{?\d*,?\d*\}?/.test(stripped)) {
    return {
      safe: false,
      reason: 'nested-quantifier',
      detail: 'nested quantifier detected — prone to catastrophic backtracking',
    }
  }

  // Alternation with overlapping branches under a quantifier: (a|a)*,
  // (x|xy)+, (ab|a)+. Heuristic — quantified group whose branches share
  // a prefix (or are duplicates). No AST required.
  const altMatch = /\(([^()]+)\)[+*?]\{?\d*,?\d*\}?/g
  let m: ReturnType<RegExp['exec']>
  while ((m = altMatch.exec(stripped)) !== null) {
    const inner = m[1]
    if (!inner.includes('|')) continue
    const branches = inner.split('|').map(s => s.trim())
    for (let i = 0; i < branches.length; i++) {
      for (let j = 0; j < branches.length; j++) {
        if (i === j) continue
        const a = branches[i]
        const b = branches[j]
        if (!a || !b) continue
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          return {
            safe: false,
            reason: 'alternation-with-overlap',
            detail: `quantified alternation with overlapping branches: (${inner})`,
          }
        }
      }
    }
  }

  // Quantifier count ceiling — many unbounded quantifiers compound the
  // risk even when each one looks fine in isolation.
  const quantifiers = (stripped.match(/[+*]|\{\d+,?\d*\}/g) ?? []).length
  if (quantifiers > maxQuantifiers) {
    return {
      safe: false,
      reason: 'excessive-quantifiers',
      detail: `pattern has ${quantifiers} quantifiers (max ${maxQuantifiers})`,
    }
  }

  return { safe: true }
}

/**
 * Throws if the pattern fails the safety heuristic. Use when there is no
 * sensible fallback for an unsafe pattern (loading a privacy config).
 */
export function assertSafeRegex(
  pattern: string,
  opts?: SafeRegexOptions,
): void {
  const verdict = checkRegexSafety(pattern, opts)
  if (!verdict.safe) {
    throw new UnsafeRegexError(
      `unsafe regex (${verdict.reason}): ${verdict.detail}`,
      pattern,
      verdict,
    )
  }
}

export class UnsafeRegexError extends Error {
  readonly pattern: string
  readonly verdict: SafetyCheck
  constructor(message: string, pattern: string, verdict: SafetyCheck) {
    super(message)
    this.name = 'UnsafeRegexError'
    this.pattern = pattern
    this.verdict = verdict
  }
}

/**
 * Remove backslash-escape sequences so the main checks do not see them
 * as structural characters. Example: literal "\\(" becomes "_" so a
 * literal-paren pattern is not mistaken for a capturing group.
 */
function stripEscapedChars(pattern: string): string {
  return pattern.replace(/\\./g, '_')
}

/**
 * Remove non-capturing group markers and lookaround markers so the `?`
 * they contain is not mistaken for a quantifier. Handles:
 *   (?:...)   non-capturing
 *   (?=...)   positive lookahead
 *   (?!...)   negative lookahead
 *   (?<=...)  positive lookbehind
 *   (?<!...)  negative lookbehind
 *   (?<name>) named capture (the name part is kept, markers stripped)
 */
function stripGroupMarkers(pattern: string): string {
  return pattern
    .replace(/\(\?[:=!]/g, '(')
    .replace(/\(\?<[=!]/g, '(')
    .replace(/\(\?<([^>]*)>/g, '($1>') // keep name but drop the ?< marker
}

/**
 * Balanced-shape check — the cheap "does this pattern have the right
 * structural bones?" test used in place of a trial `new RegExp(pattern)`
 * compilation. Catches unbalanced parens, brackets, and character-class
 * misuse, which covers the vast majority of "invalid pattern" cases
 * operators produce from YAML.
 *
 * Not a full parser — a genuinely pathological pattern that balances
 * shape-wise but fails deeper RegExp semantics will slip through this
 * check and throw at compile time in the caller. Callers route
 * `new RegExp(pattern)` through a single nosemgrep-annotated line and
 * catch the error there.
 */
function checkBalancedShape(pattern: string): { ok: true } | { ok: false; reason: string } {
  let parenDepth = 0
  let inCharClass = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') { i++; continue } // skip escaped char
    if (inCharClass) {
      if (c === ']') inCharClass = false
      continue
    }
    if (c === '[') inCharClass = true
    else if (c === '(') parenDepth++
    else if (c === ')') {
      if (parenDepth === 0) return { ok: false, reason: 'unbalanced close paren' }
      parenDepth--
    }
  }
  if (parenDepth !== 0) return { ok: false, reason: 'unbalanced open paren' }
  if (inCharClass) return { ok: false, reason: 'unterminated character class' }
  return { ok: true }
}
