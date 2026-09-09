// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Classify a Bash / run_command invocation as a dedicated read-only tool
 * equivalent (`git_status` / `git_diff`), or null when it is not.
 *
 * The dedicated tools already sit on the green list; CLI providers still send
 * the same work through arbitrary-shell tools (red). This matcher is the
 * fail-closed allowlist that lets those invocations skip a click.
 *
 * Never matches: write-git, git global options (`-C`, `--git-dir`),
 * `--no-index`, absolute / parent pathspecs, quotes, `$` expansion, or any
 * shell metacharacter.
 */

const SHELL_METACHAR = [';', '&&', '||', '|', '`', '$(', '$((', '>', '<', '\n', '\r', '$'] as const

const STATUS_LONG = new Set([
  '--short', '--branch', '--porcelain', '--untracked-files', '--ignored',
  '--no-ahead-behind', '--ahead-behind', '--verbose', '--long', '--column',
  '--show-stash', '--no-renames', '--find-renames', '--color', '--no-color',
])
const STATUS_VALUE_LONG = new Set(['--porcelain', '--untracked-files', '--column'])
const STATUS_SHORT = new Set(['s', 'b', 'u', 'v', 'z'])

const DIFF_LONG = new Set([
  '--stat', '--cached', '--staged', '--no-color', '--color', '--find-renames',
  '--name-only', '--name-status', '--compact-summary', '--ignore-all-space',
  '--unified',
])
const DIFF_VALUE_LONG = new Set(['--unified', '--color'])
const DIFF_SHORT = new Set(['w', 'u'])

export type DedicatedReadOnlyTool = 'git_status' | 'git_diff'

export function dedicatedReadOnlyCommand(input: Record<string, unknown>): DedicatedReadOnlyTool | null {
  const argv = argvFromInput(input)
  if (!argv) return null
  if (argv.some((t) => containsMetachar(t))) return null
  if (argv[0] !== 'git' || argv.length < 2) return null

  const sub = argv[1]
  const rest = argv.slice(2)
  if (sub === 'status') return flagsOk(rest, STATUS_LONG, STATUS_VALUE_LONG, STATUS_SHORT) ? 'git_status' : null
  if (sub === 'diff') return flagsOk(rest, DIFF_LONG, DIFF_VALUE_LONG, DIFF_SHORT) ? 'git_diff' : null
  return null
}

function argvFromInput(input: Record<string, unknown>): string[] | null {
  const command = input.command
  if (typeof command !== 'string') return null
  const trimmed = command.trim()
  if (!trimmed) return null
  if (containsMetachar(trimmed)) return null

  const args = input.args
  if (Array.isArray(args) && args.length > 0) {
    if (!args.every((a) => typeof a === 'string')) return null
    if (args.some((a) => containsMetachar(a))) return null
    return [trimmed, ...args]
  }

  if (/['"]/.test(trimmed)) return null
  return trimmed.split(/\s+/).filter(Boolean)
}

function containsMetachar(s: string): boolean {
  return SHELL_METACHAR.some((token) => s.includes(token))
}

function flagsOk(
  tokens: string[],
  long: ReadonlySet<string>,
  valueLong: ReadonlySet<string>,
  short: ReadonlySet<string>,
): boolean {
  for (const token of tokens) {
    if (token === '--') continue
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const flag = eq === -1 ? token : token.slice(0, eq)
      if (eq === -1 && long.has(flag)) continue
      if (eq !== -1 && valueLong.has(flag)) continue
      return false
    }
    if (token.startsWith('-') && token.length > 1 && !token.startsWith('--')) {
      const letters = token.slice(1)
      if (![...letters].every((c) => short.has(c))) return false
      continue
    }
    if (!isSafePathspec(token)) return false
  }
  return true
}

function isSafePathspec(token: string): boolean {
  if (token.startsWith('/') || /^[A-Za-z]:[\\/]/.test(token)) return false
  if (token.includes('..')) return false
  return true
}
