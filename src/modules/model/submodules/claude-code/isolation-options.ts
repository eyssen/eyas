// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Claude Code isolation contract, in one place: the options every query()
// starts from (chat, background, isolated one-shots and the discovery probe
// alike), and what the CLI's system/init message has to report back before a
// single token of its answer reaches EYAS.
//
// What the options guarantee, on the operator's own Claude Code binary:
//   - no transcript under ~/.claude/projects (persistSession false — EYAS
//     replays every turn from its own store and never resumes);
//   - no user/project/local settings: no settings.json hooks or permission
//     rules, no CLAUDE.md at any tier, no host skills (settingSources [],
//     always stated explicitly — the CLI reads an ABSENT --setting-sources as
//     "load everything" while the SDK docs promise the opposite);
//   - no filesystem-configured or claude.ai MCP servers (strictMcpConfig);
//   - no file checkpoint copies;
//   - auto-memory and CLAUDE.md loading switched off by their own kill
//     switches (auto-memory is keyed on the working directory, not on setting
//     sources, so settingSources [] alone does not stop it);
//   - the CLI's temp root (CLAUDE_CODE_TMPDIR) is the query's own EYAS folder
//     (cli-runtime cliQueryTmp), not /tmp/claude-<uid>: the per-session
//     `tasks/` folder there holds background command output, is named after
//     the working folder, and nothing on the host would ever remove it;
//   - an allowlisted environment, never a `{ ...process.env }` spread.
// The login stays the host's: a Claude-Code-only install stays signed in.

import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { buildCliEnv } from '../../cli-runtime/env.js'
import type { CliIsolationSnapshot, CliIsolationViolation } from '../../cli-runtime/isolation.js'

/**
 * Switches every Claude Code child gets on top of the claude-code env
 * allowlist. DISABLE_AUTOUPDATER keeps the binary EYAS verified from replacing
 * itself mid-run (the host-write baseline was recorded with it set);
 * CLAUDE_AGENT_SDK_CLIENT_APP names EYAS in the User-Agent.
 */
export const CLAUDE_ISOLATION_ENV: Readonly<Record<string, string>> = Object.freeze({
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_AGENT_SDK_CLIENT_APP: 'eyas',
})

/**
 * The child environment of every Claude Code process EYAS starts (queries and
 * `auth status` alike): the claude-code allowlist plus the isolation switches,
 * and for a query its own temp root (CLAUDE_CODE_TMPDIR).
 */
export function buildClaudeIsolationEnv(source: NodeJS.ProcessEnv = process.env, opts: { tmpDir?: string } = {}): Record<string, string> {
  return buildCliEnv('claude-code', {
    source,
    extra: { ...CLAUDE_ISOLATION_ENV, ...(opts.tmpDir ? { CLAUDE_CODE_TMPDIR: opts.tmpDir } : {}) },
  })
}

export interface ClaudeIsolationInput {
  /** Absolute working directory, from cli-runtime resolveCliCwd — never process.cwd(). */
  cwd: string
  /** The resolved Claude Code runtime path (resolveClaudeRuntime). */
  executable: string
  /**
   * The query's own temp folder (cli-runtime cliQueryTmp), absolute: the
   * CLI's CLAUDE_CODE_TMPDIR. The caller creates it before the CLI starts and
   * releases it when the query ends.
   */
  tmpDir: string
  /** Environment the allowlist reads from (default process.env). */
  envSource?: NodeJS.ProcessEnv
}

/** The isolated base of every query() options object. */
export interface ClaudeIsolationOptions {
  cwd: string
  pathToClaudeCodeExecutable: string
  persistSession: false
  settingSources: []
  strictMcpConfig: true
  enableFileCheckpointing: false
  env: Record<string, string>
}

/**
 * The one options builder. Callers add what is theirs (prompt, tools, MCP
 * bridge, permission callback, hooks through mergeHooks) on top and never
 * override these keys; the discovery probe adds only `tools: []`.
 */
export function buildClaudeIsolationOptions(input: ClaudeIsolationInput): ClaudeIsolationOptions {
  if (!input.executable) {
    throw new Error('claude-code: no resolved Claude Code runtime — isolation options need the executable path')
  }
  if (!input.cwd || !isAbsolute(input.cwd)) {
    throw new Error(`claude-code: the working directory must be an absolute path from resolveCliCwd, got ${JSON.stringify(input.cwd)}`)
  }
  if (!input.tmpDir || !isAbsolute(input.tmpDir)) {
    throw new Error(`claude-code: the temp folder must be an absolute path from cliQueryTmp, got ${JSON.stringify(input.tmpDir)}`)
  }
  return {
    cwd: input.cwd,
    pathToClaudeCodeExecutable: input.executable,
    persistSession: false,
    settingSources: [],
    strictMcpConfig: true,
    enableFileCheckpointing: false,
    env: buildClaudeIsolationEnv(input.envSource, { tmpDir: input.tmpDir }),
  }
}

// ─── system/init tripwire ──────────────────────────────────────────────

/**
 * The fields of the CLI's system/init message the tripwire reads. Parsed
 * tolerantly: a newer CLI may add fields (dropped) or reshape one (read as
 * missing, which then fails its check — never silently passes it).
 */
const NamedList = z.array(z.object({ name: z.string() })).optional().catch(undefined)
const PluginList = z.array(z.object({ name: z.string(), source: z.string().optional().catch(undefined) })).optional().catch(undefined)

const ClaudeInitSchema = z.object({
  cwd: z.string().optional().catch(undefined),
  claude_code_version: z.string().optional().catch(undefined),
  permissionMode: z.string().optional().catch(undefined),
  mcp_servers: NamedList,
  plugins: PluginList,
})

/**
 * Plugins compiled into the Claude Code binary that its init message lists
 * under the isolation options, and that the live lane proved inert there
 * (tests/live/cli-isolation.live.test.ts, 2.1.281):
 *   - agents-md: loads AGENTS.md as project instructions — but only through
 *     the instruction-file channel CLAUDE_CODE_DISABLE_CLAUDE_MDS switches
 *     off; no AGENTS.md (root or nested) reaches the model;
 *   - telemetry: the CLI's own product telemetry; it adds nothing to the
 *     model's context.
 * Accepted only as `<name>@builtin`. Any other plugin — a host-installed one,
 * or a builtin a newer binary adds — stays a violation until the lane has
 * proven it and it is listed here.
 */
export const CLAUDE_INERT_BUILTIN_PLUGINS: readonly string[] = ['agents-md', 'telemetry']

function isInertBuiltin(plugin: { name: string; source?: string }): boolean {
  return CLAUDE_INERT_BUILTIN_PLUGINS.includes(plugin.name) && plugin.source === `${plugin.name}@builtin`
}

/** What EYAS configured for this query, and so what init must report. */
export interface ClaudeInitExpectation {
  /** The resolved working directory the query was started in. */
  cwd: string
  /** MCP servers EYAS passed itself (the `eyas` bridge, or none). */
  mcpServers: readonly string[]
}

export type ClaudeInitVerdict =
  | { ok: true; snapshot: CliIsolationSnapshot }
  | { ok: false; snapshot: CliIsolationSnapshot; violations: CliIsolationViolation[] }

/** Realpath when the path exists, else resolved as given. */
function canonicalPath(path: string): string {
  let out: string
  try {
    out = realpathSync(path)
  } catch {
    out = resolve(path)
  }
  return process.platform === 'win32' ? out.toLowerCase() : out
}

/**
 * Check the CLI's system/init message against the isolation contract:
 *   - MCP servers: only the ones EYAS passed (so none on an isolated call);
 *   - plugins: none but the proven-inert builtins (CLAUDE_INERT_BUILTIN_PLUGINS);
 *   - permission mode: 'default' (EYAS's canUseTool or fail-closed deny);
 *   - cwd: the resolved working directory (compared realpathed).
 * A field the CLI did not report fails its check.
 */
export function checkClaudeInit(message: unknown, expected: ClaudeInitExpectation): ClaudeInitVerdict {
  const parsed = ClaudeInitSchema.safeParse(message)
  const init = parsed.success ? parsed.data : {}
  const mcpServers = init.mcp_servers?.map((s) => s.name)
  const plugins = init.plugins?.map((p) => p.name)
  const loadedPlugins = init.plugins?.filter((p) => !isInertBuiltin(p)).map((p) => p.source ?? p.name)

  const snapshot: CliIsolationSnapshot = {
    providerId: 'claude-code',
    ...(init.claude_code_version ? { version: init.claude_code_version } : {}),
    ...(init.cwd ? { cwd: init.cwd } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(plugins ? { plugins } : {}),
    ...(init.permissionMode ? { permissionMode: init.permissionMode } : {}),
  }

  const violations: CliIsolationViolation[] = []
  if (!mcpServers) {
    violations.push({ check: 'mcpServers', detail: 'the init message reports no readable MCP server list' })
  } else {
    const unexpected = mcpServers.filter((name) => !expected.mcpServers.includes(name))
    if (unexpected.length > 0) {
      violations.push({ check: 'mcpServers', detail: `MCP server(s) EYAS did not configure: ${unexpected.join(', ')}` })
    }
  }
  if (!loadedPlugins) {
    violations.push({ check: 'plugins', detail: 'the init message reports no readable plugin list' })
  } else if (loadedPlugins.length > 0) {
    violations.push({ check: 'plugins', detail: `plugin(s) loaded: ${loadedPlugins.join(', ')}` })
  }
  if (init.permissionMode !== 'default') {
    violations.push({ check: 'permissionMode', detail: `permission mode ${init.permissionMode ?? '(not reported)'}; expected default` })
  }
  if (!init.cwd || canonicalPath(init.cwd) !== canonicalPath(expected.cwd)) {
    violations.push({ check: 'cwd', detail: `working directory ${init.cwd ?? '(not reported)'}; expected ${expected.cwd}` })
  }

  return violations.length > 0 ? { ok: false, snapshot, violations } : { ok: true, snapshot }
}

/** The violation raised when the CLI answers before reporting its init. */
export function initMissingViolation(messageType: string): CliIsolationViolation {
  return { check: 'initMissing', detail: `the CLI sent a '${messageType}' message before its system/init message` }
}
