// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// How EYAS launches the ACP CLIs (Grok, Kimi): one profile per provider, the
// single place its executable, argv, environment, EYAS-owned home and
// session store are defined. Every spawn — a chat turn, a background call,
// sign-in, discovery — goes through a profile, so the isolation cannot differ
// between callers.
//
// The isolation contract (D1), verified on grok 1.0.40 by the A1 spike
// (tests/fixtures/cli/grok/1.0.40) and derived from the kimi-cli 1.52.0
// source for Kimi (tests/fixtures/cli/kimi/1.52.0, unverified on a host):
//
//   - HOME and the CLI's own config dir (GROK_HOME, KIMI_SHARE_DIR) point at
//     <dataDir>/cli-homes/<provider>. The operator's ~/.grok, ~/.kimi,
//     ~/.claude, ~/.cursor and ~/.agents are never seen, and nothing EYAS
//     sends is written there.
//   - The environment is an allowlist (cli-runtime/env.ts) plus the switches
//     below; the server's own environment is never spread in.
//   - Grok: config.toml and requirements.toml are owned by EYAS and rewritten
//     before every run. Ask mode with [permission] ask rules for every native
//     tool class, so each native tool call is a request_permission EYAS
//     answers; always-approve is locked out by requirements.toml; memory,
//     memory v2, session search, telemetry, trace upload, leader and
//     auto-update are off; every Claude/Cursor/Codex compat import is off;
//     the only MCP server a session may start is EYAS's own bridge ('eyas').
//     trusted_folders.toml stays empty and --trust is never passed, so a
//     project folder's AGENTS.md, .grok config, hooks and MCP servers are
//     never loaded (grok trusts no folder by default).
//   - Kimi: argv is exactly ['acp'] (`kimi acp` returns before reading any
//     option, so --model/--thinking would be ignored and misreport the model;
//     the model is chosen in-session). Only EYAS's keys in .kimi/config.toml
//     are upserted (default_yolo, telemetry, merge_all_available_skills), so
//     the credentials section written by sign-in and the default_model /
//     default_thinking written by set_model survive. .kimi/mcp.json is empty.
//   - The session store inside the home is purged after every run (EYAS
//     never resumes a CLI session) and swept at boot as a backstop.
//
// Not in the grok config on purpose: [folder_trust] and [session] save_on_end
// (grok 1.0.40 reports both as unknown keys), GROK_STORAGE_MODE (undocumented,
// effect unverified), GIT_CEILING_DIRECTORIES as a protection (grok ignores
// it; the workspaces root outside any git tree is what protects).

import { join } from 'node:path'
import { resolveInstance } from '@core/instance.js'
import { buildCliEnv } from '../../cli-runtime/env.js'
import { resolveCliExecutable } from '../../cli-runtime/executables.js'
import {
  cliHome,
  purgeSessionStore,
  readManagedFile,
  sweepSessionStore,
  writeManagedFiles,
  type ManagedFile,
} from '../../cli-runtime/homes.js'

/** The providers that run over ACP through a profile. */
export type AcpProviderId = 'grok-cli' | 'kimi-cli'

export interface AcpCliProfile {
  readonly providerId: AcpProviderId
  /** The EYAS-owned HOME of the child: <cliHomesDir>/<providerId>. Created by ensureHome(). */
  readonly home: string
  /** Parent of every CLI home (the session-store purge is confined to it). */
  readonly homesDir: string
  /** The CLI's own config/share dir inside the home (GROK_HOME, KIMI_SHARE_DIR). */
  readonly configDir: string
  /** The CLI's session store inside the home; purged after every run. */
  readonly sessionStorePath: string
  /** Files EYAS owns whole inside the home (paths relative to the home). */
  readonly managedFiles: readonly ManagedFile[]
  /**
   * Absolute path of the executable (cli-runtime resolveCliExecutable).
   * Throws with the operator remedy when nothing resolves.
   */
  resolveExecutable(): Promise<string>
  /** argv after the executable: the single place it is built. */
  buildArgs(opts?: { model?: string }): string[]
  /**
   * The child's environment: the allowlist, HOME, the isolation switches,
   * then `extraEnv` and `extra` (applied last; an undefined value removes a
   * key). Never a spread of the server environment.
   */
  env(extra?: Record<string, string | undefined>): Record<string, string>
  /** Create the home (0700) and bring the managed files up to date. Idempotent; never reads a host file. */
  ensureHome(): void
}

export interface AcpProfileOptions {
  /** Parent of the CLI homes (default InstancePaths.cliHomesDir). */
  homesDir?: string
  /** Executable resolution (default: the cli-runtime policy for this provider). */
  resolveExecutable?: () => Promise<string>
  /**
   * Variables added at every spawn, read lazily — the EYAS-stored API key
   * of the sign-in lives here, never in the host environment.
   */
  extraEnv?: () => Record<string, string | undefined>
  /** Environment the allowlist reads from (default process.env). */
  sourceEnv?: NodeJS.ProcessEnv
}

// ─── Grok ──────────────────────────────────────

/** Grok's config dir inside its EYAS home (GROK_HOME). */
const GROK_DIR = '.grok'

const MANAGED_HEADER = '# Managed by EYAS. Rewritten before every run; local edits are replaced.\n'

/**
 * $GROK_HOME/config.toml. Ask mode plus [permission] ask rules route every
 * native tool (read_file, list_dir, grep, shell, write, subagents, search)
 * through session/request_permission (A1 spike). EYAS's own tools are
 * allowed here because the bridge gates each call itself.
 */
export const GROK_CONFIG_TOML = `${MANAGED_HEADER}[ui]
permission_mode = "ask"
remember_tool_approvals = false

[memory]
enabled = false

[memory_v2]
enabled = false
capture_enabled = false
file_writes_enabled = false
automatic_dream_enabled = false

[storage]
cleanup_ttl_days = 1

[cli]
auto_update = false
use_leader = false
session_registry = false

[features]
session_search = false
telemetry = false

[telemetry]
trace_upload = false

[compat.claude]
skills = false
rules = false
agents = false
mcps = false
hooks = false
sessions = false

[compat.cursor]
skills = false
rules = false
agents = false
mcps = false
hooks = false
sessions = false

[compat.codex]
hooks = false
skills = false
sessions = false

[permission]
ask = ["Read", "Edit", "Grep", "Bash", "WebFetch", "WebSearch"]
allow = ["MCPTool(eyas__*)"]
`

/**
 * $GROK_HOME/requirements.toml: pins a session cannot override. The bypass
 * lock keeps always-approve out (--always-approve, _meta.yoloMode); the MCP
 * allowlist lets only the ACP-supplied 'eyas' bridge start, whatever a
 * project folder or a session/new request declares.
 */
export const GROK_REQUIREMENTS_TOML = `${MANAGED_HEADER}enable_all_project_mcp_servers = false

[ui]
disable_bypass_permissions_mode = true

[memory]
enabled = false

[memory_v2]
enabled = false

[telemetry]
trace_upload = false

[cli]
use_leader = false

[features]
session_search = false

[[allowed_mcp_servers]]
server_name = "eyas"
`

const GROK_MANAGED_FILES: readonly ManagedFile[] = [
  { path: join(GROK_DIR, 'config.toml'), content: GROK_CONFIG_TOML },
  { path: join(GROK_DIR, 'requirements.toml'), content: GROK_REQUIREMENTS_TOML },
  // Folder trust is never granted: reset to empty before every run.
  { path: join(GROK_DIR, 'trusted_folders.toml'), content: '' },
]

/** Environment switches; they outrank config.toml (grok 1.0.40 docs). */
function grokSwitches(home: string): Record<string, string> {
  return {
    GROK_HOME: join(home, GROK_DIR),
    GROK_MEMORY: '0',
    GROK_CLAUDE_SKILLS_ENABLED: 'false',
    GROK_CLAUDE_RULES_ENABLED: 'false',
    GROK_CLAUDE_AGENTS_ENABLED: 'false',
    GROK_CLAUDE_MCPS_ENABLED: 'false',
    GROK_CLAUDE_HOOKS_ENABLED: 'false',
    GROK_CLAUDE_SESSIONS_ENABLED: 'false',
    GROK_CURSOR_SKILLS_ENABLED: 'false',
    GROK_CURSOR_RULES_ENABLED: 'false',
    GROK_CURSOR_AGENTS_ENABLED: 'false',
    GROK_CURSOR_MCPS_ENABLED: 'false',
    GROK_CURSOR_HOOKS_ENABLED: 'false',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_TELEMETRY_TRACE_UPLOAD: '0',
    GROK_SESSION_SEARCH: '0',
    GROK_REMEMBER_TOOL_APPROVALS: 'false',
    GROK_DISABLE_AUTOUPDATER: '1',
  }
}

/**
 * `grok agent --no-leader [--model X] stdio`. Never --always-approve and
 * never --trust; --no-leader keeps an EYAS run out of a shared leader
 * process that has its own config and state.
 */
export function buildGrokArgs(opts: { model?: string } = {}): string[] {
  const args = ['agent', '--no-leader']
  if (opts.model) args.push('--model', opts.model)
  args.push('stdio')
  return args
}

// ─── Kimi ──────────────────────────────────────

/** Kimi's share dir inside its EYAS home (KIMI_SHARE_DIR). */
const KIMI_DIR = '.kimi'

const KIMI_CONFIG_PATH = join(KIMI_DIR, 'config.toml')

/** The only keys EYAS owns in Kimi's config.toml (top level). */
export const KIMI_MANAGED_KEYS: Readonly<Record<string, boolean>> = {
  default_yolo: false,
  telemetry: false,
  merge_all_available_skills: false,
}

const KIMI_MANAGED_FILES: readonly ManagedFile[] = [
  // No MCP server of Kimi's own: EYAS's bridge arrives per session.
  { path: join(KIMI_DIR, 'mcp.json'), content: '{\n  "mcpServers": {}\n}\n' },
]

/** `kimi acp`, exactly: options before the subcommand are ignored by kimi-cli. */
export function buildKimiArgs(): string[] {
  return ['acp']
}

/**
 * The share dir a kimi started with `env` uses (kimi-cli 1.52.0 share.py
 * get_share_dir: KIMI_SHARE_DIR, else ~/.kimi); null when neither is set.
 * Kimi reads its config, credentials and skills there, and session/set_model
 * rewrites <share>/config.toml — so the Kimi preflight (acp-verify.ts) holds
 * it to the profile's configDir.
 */
export function kimiShareDirOf(env: Readonly<Record<string, string | undefined>>): string | null {
  const explicit = env.KIMI_SHARE_DIR
  if (explicit) return explicit
  return env.HOME ? join(env.HOME, KIMI_DIR) : null
}

/** A TOML table or array-of-tables header line. */
const TOML_HEADER_RE = /^\s*\[\[?\s*(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"\n]*"|'[^'\n]*'))*\s*\]\]?\s*(?:#.*)?$/

/** An assignment of `key` (bare or quoted). Keys are fixed identifiers, never input. */
function keyLineRe(key: string): RegExp {
  return new RegExp(`^\\s*(?:${key}|"${key}"|'${key}')\\s*=`)
}

/**
 * Set top-level boolean keys in a TOML document without touching anything
 * else: an existing top-level assignment is replaced in place, a missing one
 * is added at the end of the top-level section (before the first table), so
 * tables written by the CLI (credentials, models, providers) and other
 * top-level keys survive byte for byte.
 */
export function upsertTomlTopLevelBooleans(text: string, entries: Readonly<Record<string, boolean>>): string {
  const lines = text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n')
  // The final newline leaves one empty element; the output always ends in one.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  let firstHeader = lines.findIndex((line) => TOML_HEADER_RE.test(line))
  if (firstHeader < 0) firstHeader = lines.length

  const missing: string[] = []
  for (const [key, value] of Object.entries(entries)) {
    const re = keyLineRe(key)
    const at = lines.slice(0, firstHeader).findIndex((line) => re.test(line))
    if (at >= 0) lines[at] = `${key} = ${value}`
    else missing.push(`${key} = ${value}`)
  }
  if (missing.length > 0) {
    // After the last top-level line, above the blank lines before the first table.
    let at = firstHeader
    while (at > 0 && lines[at - 1].trim() === '') at--
    const needsGap = firstHeader < lines.length && at === firstHeader
    lines.splice(at, 0, ...missing, ...(needsGap ? [''] : []))
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * Upsert EYAS's keys into Kimi's config.toml inside its EYAS home. Written
 * only when the content changes (writeManagedFiles compares hashes).
 */
function ensureKimiConfig(home: string): void {
  const current = readManagedFile(home, KIMI_CONFIG_PATH) ?? ''
  const next = upsertTomlTopLevelBooleans(current, KIMI_MANAGED_KEYS)
  // Validate when a TOML parser is at hand (Bun): a document this function
  // cannot upsert safely is refused rather than handed to the CLI.
  const toml = (globalThis as { Bun?: { TOML?: { parse(s: string): unknown } } }).Bun?.TOML
  if (toml) {
    let parsed: Record<string, unknown>
    try {
      parsed = toml.parse(next) as Record<string, unknown>
    } catch (err) {
      throw new Error(`kimi-cli: EYAS could not update ${KIMI_CONFIG_PATH} in its Kimi home: ${err instanceof Error ? err.message : String(err)}`)
    }
    for (const [key, value] of Object.entries(KIMI_MANAGED_KEYS)) {
      if (parsed[key] !== value) throw new Error(`kimi-cli: ${KIMI_CONFIG_PATH} in the EYAS Kimi home did not take ${key} = ${value}`)
    }
  }
  writeManagedFiles(home, [{ path: KIMI_CONFIG_PATH, content: next }])
}

// ─── Profiles ──────────────────────────────────

function defaultResolveExecutable(providerId: AcpProviderId): () => Promise<string> {
  return async () => {
    const resolution = await resolveCliExecutable(providerId)
    if (!resolution.ok) {
      throw new Error(`${resolution.detail}${resolution.remedy ? ` — ${resolution.remedy}` : ''}`)
    }
    return resolution.path
  }
}

/**
 * The launch profile of one ACP provider. Pure: nothing is created or
 * resolved until resolveExecutable() / ensureHome() is called by the runner.
 */
export function createAcpProfile(providerId: AcpProviderId, opts: AcpProfileOptions = {}): AcpCliProfile {
  const homesDir = opts.homesDir ?? resolveInstance({ ensureDirs: false }).cliHomesDir
  const home = join(homesDir, providerId)
  const isGrok = providerId === 'grok-cli'
  const configDir = join(home, isGrok ? GROK_DIR : KIMI_DIR)
  const managedFiles = isGrok ? GROK_MANAGED_FILES : KIMI_MANAGED_FILES
  const switches = (): Record<string, string> => isGrok
    ? grokSwitches(home)
    : { KIMI_SHARE_DIR: configDir, KIMI_CLI_NO_AUTO_UPDATE: '1' }

  return {
    providerId,
    home,
    homesDir,
    configDir,
    sessionStorePath: join(configDir, 'sessions'),
    managedFiles,
    resolveExecutable: opts.resolveExecutable ?? defaultResolveExecutable(providerId),
    buildArgs: (args = {}) => (isGrok ? buildGrokArgs(args) : buildKimiArgs()),
    env: (extra) => buildCliEnv(providerId, {
      home,
      source: opts.sourceEnv,
      extra: { ...switches(), ...(opts.extraEnv?.() ?? {}), ...(extra ?? {}) },
    }),
    ensureHome: () => {
      cliHome(providerId, { homesDir })
      writeManagedFiles(home, managedFiles)
      if (!isGrok) ensureKimiConfig(home)
    },
  }
}

// ─── Session store lifecycle ───────────────────

interface StoreLogger {
  warn?: (obj: unknown, msg?: string) => void
  info?: (obj: unknown, msg?: string) => void
  debug?: (obj: unknown, msg?: string) => void
}

/** Runs currently using each session store (this process). */
const activeRuns = new Map<string, number>()

/** Number of runs currently using `profile`'s session store. */
export function activeSessionStoreRuns(profile: Pick<AcpCliProfile, 'sessionStorePath'>): number {
  return activeRuns.get(profile.sessionStorePath) ?? 0
}

/**
 * Mark a run as using the profile's session store. The returned function
 * ends it (idempotent); when it was the last active run on that store, the
 * store is emptied. A store another run is still writing to is left alone —
 * the last run to end purges everything, the boot sweeper catches a crash.
 */
export function openSessionStoreRun(
  profile: Pick<AcpCliProfile, 'providerId' | 'sessionStorePath' | 'homesDir'>,
  logger?: StoreLogger,
): () => void {
  const store = profile.sessionStorePath
  activeRuns.set(store, (activeRuns.get(store) ?? 0) + 1)
  let ended = false
  return () => {
    if (ended) return
    ended = true
    const left = (activeRuns.get(store) ?? 1) - 1
    if (left > 0) {
      activeRuns.set(store, left)
      return
    }
    activeRuns.delete(store)
    try {
      const removed = purgeSessionStore(store, { homesDir: profile.homesDir })
      if (removed > 0) logger?.debug?.({ provider: profile.providerId, removed }, 'acp: session store purged')
    } catch (err) {
      logger?.warn?.({ provider: profile.providerId, err: String(err) }, 'acp: session store purge failed')
    }
  }
}

/** How often the idle-store sweep runs after the boot sweep. */
export const SESSION_STORE_SWEEP_INTERVAL_MS = 60 * 60 * 1000

/**
 * Sweep the profile's session store now (boot) and then periodically,
 * removing entries older than the cli-runtime max age. Skipped while a run
 * of this process uses the store. The timer never keeps the process alive.
 * Returns the stop function.
 */
export function startSessionStoreSweeper(
  profile: Pick<AcpCliProfile, 'providerId' | 'sessionStorePath' | 'homesDir'>,
  opts: { logger?: StoreLogger; intervalMs?: number; maxAgeMs?: number } = {},
): () => void {
  const sweep = (): void => {
    if (activeSessionStoreRuns(profile) > 0) return
    try {
      const removed = sweepSessionStore(profile.sessionStorePath, { homesDir: profile.homesDir, maxAgeMs: opts.maxAgeMs })
      if (removed > 0) opts.logger?.info?.({ provider: profile.providerId, removed }, 'acp: stale session store entries removed')
    } catch (err) {
      opts.logger?.warn?.({ provider: profile.providerId, err: String(err) }, 'acp: session store sweep failed')
    }
  }
  sweep()
  const timer = setInterval(sweep, opts.intervalMs ?? SESSION_STORE_SWEEP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}
