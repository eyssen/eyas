// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// What a host CLI (Claude Code, Grok, Kimi) may do with its own built-in
// tools, and which EYAS tools it is offered through its EYAS MCP bridge. One
// table, CLI_NATIVE_CAPABILITIES, answers both for every CLI and for the tool
// scope (agent/tool-scope.ts nativeCapabilitiesFor):
//
// - A CLI brings its own read, write, shell and web tools. An agent's tool
//   list grants each of these native capabilities only when it names one of
//   the EYAS tools that grant it (grantedBy) — the same tools the agent would
//   need for that work on an API provider. An agent without write_file /
//   edit_file gets no native Write/Edit, without run_command no shell,
//   without a web tool no WebFetch/WebSearch. Reading (Read, Glob, Grep; the
//   ACP read and search kinds) is always granted: it is what normal work
//   needs, and it stays inside the turn's folders under the memory-path
//   policy and the kernel file sandbox. No tool list (every tool) grants
//   everything.
// - Claude Code: the built-ins of a capability that is not granted are left
//   out of the query's built-in list and passed as disallowedTools
//   (claudeCodeBuiltins).
// - Grok / Kimi: a permission request for a tool of a capability that is not
//   granted is refused by EYAS before the security gate is asked, and so is a
//   client-fs write (grok-cli/acp-governance.ts).
// - The bridge: a CLI runs its own shell, file and git tools in the turn's
//   folders, under the kernel sandbox and the memory-path policy, so EYAS's
//   equivalents (covers) are left out while the capability that covers them
//   is granted — offering both would give the model two of each. When it is
//   not granted (git_status on a list without run_command), the EYAS tool is
//   offered over the bridge instead. Every other EYAS tool is offered,
//   including the ones a CLI has no equivalent for (the EYAS browser_* tools
//   with their saved sessions and TOTP, agent_browser_*, browser_use_*,
//   opencode_*). They run in the EYAS executor under the same security gate,
//   approvals and tool scope as on an API provider.
//
// Everything is matched by tool name, never by category: a category mixes
// host-native tools with tools only EYAS has (opencode_run is a 'shell' tool,
// the whole browser family is 'browser').

/** What a CLI's own built-in tools can do. */
export type NativeCapability = 'read' | 'write' | 'shell' | 'web'

export interface NativeCapabilityRow {
  /**
   * The EYAS tools whose presence in a turn's tool scope grants the
   * capability; 'always' for one every turn with tools has.
   */
  readonly grantedBy: readonly string[] | 'always'
  /** EYAS tools the CLI's built-ins of this capability stand in for. */
  readonly covers: readonly string[]
  /** Claude Code (Agent SDK) built-in tools of this capability. */
  readonly claudeCode: readonly string[]
  /** ACP tool-call kinds of this capability (Grok, Kimi). */
  readonly acpKinds: readonly string[]
  /**
   * The CLI's own names of its tools of this capability (grok 1.0.40: the
   * first tool_call's title and the permission request's _meta x.ai/tool
   * name) — they separate a web search from a file search of the same kind.
   */
  readonly acpToolNames: readonly string[]
}

export const CLI_NATIVE_CAPABILITIES: Readonly<Record<NativeCapability, NativeCapabilityRow>> = Object.freeze({
  read: {
    grantedBy: 'always',
    covers: ['read_file', 'grep', 'glob'],
    claudeCode: ['Read', 'Glob', 'Grep'],
    acpKinds: ['read', 'search'],
    acpToolNames: ['read_file', 'list_dir', 'grep'],
  },
  write: {
    grantedBy: ['write_file', 'edit_file'],
    covers: ['write_file', 'edit_file'],
    claudeCode: ['Write', 'Edit', 'NotebookEdit'],
    acpKinds: ['edit', 'move'],
    acpToolNames: ['write', 'write_file', 'search_replace', 'str_replace', 'apply_patch'],
  },
  shell: {
    grantedBy: ['run_command'],
    // The git review tools run through the CLI's shell; they never grant it.
    covers: ['run_command', 'git_status', 'git_diff'],
    claudeCode: ['Bash'],
    // A delete is a shell command on an API provider (EYAS has no delete
    // tool), and the security gate classifies it as Bash.
    acpKinds: ['execute', 'delete'],
    acpToolNames: ['run_terminal_command'],
  },
  web: {
    // The EYAS tools that reach an arbitrary web page or search on an API provider.
    grantedBy: ['research', 'browser_navigate', 'agent_browser_run', 'browser_use_exec'],
    covers: [],
    claudeCode: ['WebFetch', 'WebSearch'],
    acpKinds: ['fetch'],
    acpToolNames: ['web_fetch', 'web_search'],
  },
})

const CAPABILITIES = Object.keys(CLI_NATIVE_CAPABILITIES) as NativeCapability[]

/** Every native capability: the grant of a turn with no tool list. */
export const ALL_NATIVE_CAPABILITIES: ReadonlySet<NativeCapability> = new Set(CAPABILITIES)

/**
 * The native capabilities a tool scope grants, asked name by name
 * (`isAllowed`: is this EYAS tool in the turn's scope?). Reading always;
 * every other capability when one of its grantedBy tools is allowed.
 */
export function grantedNativeCapabilities(isAllowed: (eyasTool: string) => boolean): ReadonlySet<NativeCapability> {
  const granted = new Set<NativeCapability>()
  for (const cap of CAPABILITIES) {
    const { grantedBy } = CLI_NATIVE_CAPABILITIES[cap]
    if (grantedBy === 'always' || grantedBy.some((name) => isAllowed(name))) granted.add(cap)
  }
  return granted
}

/** EYAS tool name → the capability whose built-ins stand in for it on a CLI. */
const COVERED_BY: ReadonlyMap<string, NativeCapability> = new Map(
  CAPABILITIES.flatMap((cap) => CLI_NATIVE_CAPABILITIES[cap].covers.map((name) => [name, cap] as const)),
)

/** Every EYAS tool a host CLI has a built-in equivalent for. */
export const HOST_NATIVE_TOOL_NAMES: ReadonlySet<string> = new Set(COVERED_BY.keys())

/** The capability whose CLI built-ins stand in for this EYAS tool, or null (a tool only EYAS has). */
export function nativeCapabilityCovering(name: string): NativeCapability | null {
  return COVERED_BY.get(name) ?? null
}

/**
 * The tools a CLI bridge offers: `tools` minus the ones the CLI's granted
 * built-ins stand in for (`native`, default every capability), intersected
 * with `allowed` (the turn's tool scope). No `allowed` means no scope limit;
 * an empty set offers nothing. Order follows `tools`.
 */
export function selectBridgeTools<T extends { name: string }>(
  tools: readonly T[],
  allowed?: ReadonlySet<string> | null,
  native: ReadonlySet<NativeCapability> = ALL_NATIVE_CAPABILITIES,
): T[] {
  return tools.filter((t) => {
    const covering = COVERED_BY.get(t.name)
    if (covering && native.has(covering)) return false
    return !allowed || allowed.has(t.name)
  })
}

/**
 * Every Claude Code built-in a query may get, alongside the bridged EYAS
 * tools. Always passed as an explicit list: left unset, the runtime offers its
 * full default set, which includes its own subagent spawner ('Agent', alias
 * 'Task'). Specialists are EYAS sub-conversations on every provider
 * (run_specialist over the bridge), never CLI-native subagents that bypass
 * the EYAS prompt, memory and tool scope.
 */
export const CLAUDE_CODE_BUILTIN_TOOLS: readonly string[] = Object.freeze(
  CAPABILITIES.flatMap((cap) => CLI_NATIVE_CAPABILITIES[cap].claudeCode),
)

/**
 * The Claude Code built-ins of a turn: `tools` (the query's built-in list)
 * holds those of the granted capabilities; `disallowed` names the rest, so
 * the runtime also refuses them outright.
 */
export function claudeCodeBuiltins(native: ReadonlySet<NativeCapability>): { tools: string[]; disallowed: string[] } {
  const tools: string[] = []
  const disallowed: string[] = []
  for (const cap of CAPABILITIES) {
    for (const name of CLI_NATIVE_CAPABILITIES[cap].claudeCode) (native.has(cap) ? tools : disallowed).push(name)
  }
  return { tools, disallowed }
}

/**
 * The native capabilities an ACP tool call needs, from its kind and the
 * CLI's own names for it. Both count: a call whose kind and name disagree
 * needs both capabilities. Empty for a call no row describes (kind 'other'
 * with an unknown name, 'think', …) — the security gate decides those alone.
 */
export function acpToolCapabilities(call: { kind?: string | null; names?: ReadonlyArray<string | null | undefined> }): NativeCapability[] {
  const names = (call.names ?? []).filter((n): n is string => typeof n === 'string' && n.length > 0)
  return CAPABILITIES.filter((cap) => {
    const row = CLI_NATIVE_CAPABILITIES[cap]
    return (typeof call.kind === 'string' && row.acpKinds.includes(call.kind)) || names.some((n) => row.acpToolNames.includes(n))
  })
}

/**
 * Why a native tool call of `capability` is refused under the turn's tool
 * scope — the toolset refusal's wording (tool-executor toolsetDenial), with
 * the EYAS tools that would grant it.
 */
export function nativeCapabilityDenial(capability: NativeCapability, toolName: string): string {
  const { grantedBy } = CLI_NATIVE_CAPABILITIES[capability]
  const grantors = grantedBy === 'always' ? '' : `: its tool list has none of ${grantedBy.join(', ')}`
  return `'${toolName}' is not in this agent's toolset${grantors}`
}
