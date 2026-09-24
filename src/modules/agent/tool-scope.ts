// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one tool-scope rule every EYAS run path applies: which of the registered
// tools a run is offered. Before this file each path (background runner,
// executeAgent, team members, channels) carried its own copy of "empty list =
// all tools, otherwise exactly the list", and none of them guaranteed memory:
// an agent whose list happened to omit memory_search had no way to drill into
// EYAS memory at all on an API provider.
//
// The rule:
// - An agent's tool list is an allowlist. Empty or absent means every tool.
// - PLATFORM_MANDATORY_TOOLS (EYAS memory drill-down) are always in scope,
//   whatever the list says. Memory is the platform's, not the agent's.
// - Solo orchestration strips the delegation family (specialists, hand-offs,
//   team proposals). assign_task stays: it files board work and does not fan
//   out inside the turn.
//
// The scope is a pair {include?, exclude} rather than a resolved name list, so
// "all tools except delegation" needs no registry to express.
//
// Every EYAS run path applies it, the interactive chat route included (a
// conversation's colleague — else its project's default agent — decides the
// list). A provider that runs tools inside its own loop (Claude Code, Grok,
// Kimi) reads the same scope back from the request (requestToolScope) and its
// EYAS bridge offers exactly that, minus the tools the CLI has natively
// (tools/cli-exposure.ts selectBridgeTools). The same scope bounds the CLI's
// own built-ins (nativeCapabilitiesFor): no write_file/edit_file, no native
// Write/Edit; no run_command, no shell; no web tool, no web fetch or search.
//
// Offering is not the whole rule: the executor refuses a tool outside the
// run's toolset (ToolContext.allowedTools — the agent runner's request tools,
// a bridge's scope), so a model that names a tool it was not offered gets a
// denial, not an execution.

import type { ToolDefinition } from '@modules/model/types.js'
import { MEMORY_ALWAYS_ON_TOOLS } from '@modules/tools/builtin/memory-tools.js'
import { grantedNativeCapabilities, type NativeCapability } from '@modules/tools/cli-exposure.js'

/**
 * Tools every run is offered, regardless of the agent's allowlist or the
 * orchestration mode: EYAS memory drill-down. The memory tools own the list
 * (tools/builtin/memory-tools.ts), so a rename there cannot leave a stale name
 * here.
 */
export const PLATFORM_MANDATORY_TOOLS: readonly string[] = MEMORY_ALWAYS_ON_TOOLS

/**
 * The delegation family Solo mode removes: running a specialist (and its
 * alias), handing the conversation to a colleague, proposing a team.
 */
export const DELEGATION_TOOLS: readonly string[] = Object.freeze([
  'run_specialist',
  'delegate_to_agent',
  'handoff_to_colleague',
  'propose_team',
])

export interface ToolScope {
  /** undefined = every registered tool; otherwise the allowlist ∪ mandatory tools. */
  include?: string[]
  /** Removed even when include is undefined (Solo's delegation family). */
  exclude: string[]
}

export interface ResolveToolScopeInput {
  /** The agent's tool allowlist. Empty, absent or blank-only means all tools. */
  agentTools?: readonly string[] | null
  /** The run's conversation orchestration mode ('solo' | 'auto' | 'deep'; null = auto). */
  orchestration?: string | null
}

export function resolveToolScope(input: ResolveToolScopeInput = {}): ToolScope {
  const listed = (input.agentTools ?? [])
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  const include = listed.length > 0 ? [...new Set([...listed, ...PLATFORM_MANDATORY_TOOLS])] : undefined
  const exclude = input.orchestration === 'solo'
    ? DELEGATION_TOOLS.filter((name) => !PLATFORM_MANDATORY_TOOLS.includes(name))
    : []
  return include ? { include, exclude } : { exclude }
}

export function scopeAllows(scope: ToolScope, name: string): boolean {
  if (scope.exclude.includes(name)) return false
  return scope.include === undefined || scope.include.includes(name)
}

/** The names among `registered` that `scope` allows. */
export function scopeAllowlist(scope: ToolScope, registered: Iterable<string>): Set<string> {
  const allowed = new Set<string>()
  for (const name of registered) if (scopeAllows(scope, name)) allowed.add(name)
  return allowed
}

/**
 * The scope a model request carries to a provider that runs its tools itself
 * (the CLI bridges). A request that names tools carries its caller's resolved
 * scope (resolveToolScope upstream: the agent's allowlist plus the mandatory
 * memory tools), so exactly those names are in scope — the set an API
 * provider would be offered. A request that names none sets no allowlist.
 * Solo strips the delegation family either way.
 */
export function requestToolScope(request: {
  tools?: readonly Pick<ToolDefinition, 'name'>[] | null
  orchestration?: string | null
}): ToolScope {
  const named = [...new Set(
    (request.tools ?? [])
      .map((t) => t?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0),
  )]
  const { exclude } = resolveToolScope({ orchestration: request.orchestration })
  return named.length > 0 ? { include: named, exclude } : { exclude }
}

/**
 * What a CLI's own built-in tools may do under `scope` — the one table in
 * tools/cli-exposure.ts (CLI_NATIVE_CAPABILITIES): reading always; writing,
 * the shell and the web only when the scope holds one of the EYAS tools that
 * grant them on an API provider. A scope without an allowlist grants all.
 */
export function nativeCapabilitiesFor(scope: ToolScope): ReadonlySet<NativeCapability> {
  return grantedNativeCapabilities((name) => scopeAllows(scope, name))
}

/** The part of ToolRegistry the scope needs (test fakes implement only this). */
export interface ToolDefinitionSource {
  toToolDefinitions(names?: string[]): ToolDefinition[]
}

/** Who a run speaks as, for the unknown-tool warning (scopedToolDefinitions). */
export interface ScopedToolsOptions {
  agentId?: string | null
  /** Any logger with a one-argument warn (pino's included). */
  logger?: { warn(msg: string): void } | null
}

/** `<agentId>\0<tool>` pairs already warned about (process lifetime). */
const warnedUnknownTools = new Set<string>()

/**
 * An agent's allowlist that names tools nobody registered loses them — say
 * so once per agent and name, not on every run. The mandatory memory tools
 * are the platform's, never the agent's mistake, and are not reported.
 */
function warnUnknownTools(scope: ToolScope, offered: readonly ToolDefinition[], opts: ScopedToolsOptions): void {
  if (!scope.include || !opts.agentId || !opts.logger) return
  const registered = new Set(offered.map((def) => def.name))
  const unknown = scope.include.filter((name) =>
    !registered.has(name)
    && !PLATFORM_MANDATORY_TOOLS.includes(name)
    && !warnedUnknownTools.has(`${opts.agentId}\u0000${name}`))
  if (unknown.length === 0) return
  for (const name of unknown) warnedUnknownTools.add(`${opts.agentId}\u0000${name}`)
  try {
    opts.logger.warn(
      `Agent ${opts.agentId}: its tool list names tools that are not registered, so they are not offered: ${unknown.join(', ')}`,
    )
  } catch {
    // A logger that throws must never cost the run its tools.
  }
}

/**
 * The tool definitions a run is offered under `scope`. Names in the allowlist
 * that are not registered are absent (with one warning per agent and name
 * when `opts` names the agent and a logger). A missing registry offers nothing.
 */
export function scopedToolDefinitions(
  registry: ToolDefinitionSource | null | undefined,
  scope: ToolScope,
  opts: ScopedToolsOptions = {},
): ToolDefinition[] {
  if (!registry?.toToolDefinitions) return []
  const defs = (scope.include ? registry.toToolDefinitions(scope.include) : registry.toToolDefinitions()) ?? []
  warnUnknownTools(scope, defs, opts)
  return defs.filter((def) => scopeAllows(scope, def.name))
}
