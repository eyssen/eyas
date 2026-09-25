// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The environment a CLI child process gets. Built from an allowlist, never
// from a `{ ...process.env }` spread: the server environment carries provider
// keys, EYAS secrets and — when EYAS was started from inside another CLI
// session — that session's own CLAUDE_CODE_* / GROK_* switches, which steer
// the child's memory, config dir and permission behaviour. Anything not named
// here is dropped, so a variable a future CLI version starts reading cannot
// reach it silently.

import { resolveInstance } from '@core/instance.js'

/** The CLI providers that spawn through this seam. */
export type CliEnvProfile = 'claude-code' | 'grok-cli' | 'kimi-cli' | 'opencode'

/**
 * Passed to every CLI: process basics, locale, time zone, proxies and CA
 * bundles. The Windows entries are the minimum a child process needs there;
 * they are simply absent elsewhere.
 */
const BASE_EXACT = [
  'PATH', 'LANG', 'LANGUAGE', 'TZ', 'TMPDIR', 'TERM', 'USER', 'LOGNAME', 'SHELL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'WINDIR', 'TEMP', 'TMP',
] as const

const BASE_PREFIXES = ['LC_'] as const

/**
 * Claude Code keeps the host login (design decision: a Claude-Code-only
 * install stays signed in), so it gets the host HOME and the variables its
 * documented auth paths read: API key / gateway, OAuth token, Bedrock (AWS_*)
 * and Vertex (Google ADC). Every other CLAUDE_CODE_* and CLAUDE_CONFIG_DIR is
 * dropped.
 */
const CLAUDE_EXACT = [
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH', 'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION', 'GOOGLE_APPLICATION_CREDENTIALS',
] as const

const CLAUDE_PREFIXES = ['AWS_', 'VERTEX_REGION_'] as const

interface ProfileRules {
  exact: readonly string[]
  prefixes: readonly string[]
}

/**
 * Per-profile additions on top of the base. Grok, Kimi and OpenCode add
 * nothing from the host: their HOME is an EYAS-owned folder (`home`), and
 * whatever else they need (isolation switches, an EYAS-stored API key) comes
 * in through `extra`.
 */
const PROFILE_RULES: Record<CliEnvProfile, ProfileRules> = {
  'claude-code': { exact: CLAUDE_EXACT, prefixes: CLAUDE_PREFIXES },
  'grok-cli': { exact: [], prefixes: [] },
  'kimi-cli': { exact: [], prefixes: [] },
  'opencode': { exact: [], prefixes: [] },
}

export interface BuildCliEnvOptions {
  /** EYAS-owned home for the child: sets HOME (and USERPROFILE on Windows). */
  home?: string
  /**
   * The only way a profile adds variables (isolation switches, GROK_SANDBOX,
   * an EYAS-stored key). Applied last; an `undefined` value removes the key.
   */
  extra?: Record<string, string | undefined>
  /** GIT_CEILING_DIRECTORIES (default: InstancePaths.workspacesDir). */
  workspacesRoot?: string
  /** Source environment (default process.env). */
  source?: NodeJS.ProcessEnv
  /** Platform whose key-case rules apply (default process.platform). */
  platform?: NodeJS.Platform
}

function allowed(key: string, rules: ProfileRules[]): boolean {
  for (const r of rules) {
    if (r.exact.includes(key)) return true
    if (r.prefixes.some((p) => key.startsWith(p))) return true
  }
  return false
}

/**
 * Build the child environment for one CLI profile. Always sets
 * GIT_CEILING_DIRECTORIES to the workspaces root, so git discovery started
 * in an EYAS workspace never climbs into an enclosing repository.
 */
export function buildCliEnv(profile: CliEnvProfile, opts: BuildCliEnvOptions = {}): Record<string, string> {
  const source = opts.source ?? process.env
  // Windows environment names are case-insensitive (`Path`, `SystemRoot`).
  const caseFold = (opts.platform ?? process.platform) === 'win32'
  const rules = [{ exact: BASE_EXACT, prefixes: BASE_PREFIXES }, PROFILE_RULES[profile]]

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (allowed(caseFold ? key.toUpperCase() : key, rules)) env[key] = value
  }

  if (opts.home) {
    env.HOME = opts.home
    if (caseFold) env.USERPROFILE = opts.home
  }

  env.GIT_CEILING_DIRECTORIES = opts.workspacesRoot ?? resolveInstance({ ensureDirs: false }).workspacesDir

  for (const [key, value] of Object.entries(opts.extra ?? {})) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}
