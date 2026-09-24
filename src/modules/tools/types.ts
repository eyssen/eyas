// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ZodTypeAny } from 'zod'
import type { ToolDefinition } from '@modules/model/types.js'

/** Risk tier for security gate classification */
export type RiskTier = 'green' | 'yellow' | 'red'

/** Tool categories for filtering and organization */
export type ToolCategory = 'memory' | 'knowledge' | 'search' | 'documents' | 'board' | 'shell' | 'browser' | 'conversation' | 'communication' | 'research' | 'agent' | 'custom'

/**
 * Sandbox mode hint for the executor.
 * - 'none'    — run inline in this process (green-tier pure fns, etc.)
 * - 'process' — spawn a hardened child process (non-shell, tree-kill on timeout)
 * - 'docker'  — run inside a Docker container (Phase 3L, not yet implemented)
 */
export type SandboxMode = 'none' | 'process' | 'docker'

/**
 * Minimal CASL surface the executor needs. Structurally satisfied by
 * `AppAbility` from `@modules/permissions/roles.js` — declared here so the
 * tools module does not depend on the permissions module.
 */
export interface ToolAbility {
  can(action: string, subject: string): boolean
}

/**
 * Who is asking for a tool call. The executor authorizes every call against
 * this identity, so a context WITHOUT an actor is denied (fail-closed).
 *
 * - 'user'     — a signed-in human driving an HTTP route
 * - 'agent'    — an in-process agent loop (agent-runner, claude-code bridge)
 * - 'external' — an outside client (MCP server), authenticated at the edge
 * - 'system'   — an internal scheduled/background caller
 */
export interface ToolActor {
  kind: 'user' | 'agent' | 'external' | 'system'
  /** Role id used to derive an ability when `ability` is absent. */
  role: string
  /** Resolved ability. When omitted the executor derives one from `role`. */
  ability?: ToolAbility
}

/** Context passed to tool executors */
export interface ToolContext {
  conversationId: string
  userId: string
  agentId?: string
  sessionId?: string          // Agent session ID for inter-agent messaging
  teamSessionId?: string      // Present when running inside a team session
  agentRole?: string          // Agent's role within the team (for visibility filtering)
  /**
   * The project the conversation belongs to, when it has one. Present so a
   * tool can resolve project-scoped configuration without a
   * conversation lookup on every call. Null for channel, scheduler and
   * orphaned conversations.
   */
  projectId?: string | null
  /** The answer turn this call belongs to (I2). Set from the CLI-MCP bridge binding or the agent runner. */
  turnId?: string
  /** The supervised run (agent_sessions.id) this call belongs to (I2). */
  runId?: string
  /**
   * The effective provider+model of the turn making this call (the agent
   * runner's, or the CLI bridge's from the request metadata). A
   * sub-conversation the call creates (run_specialist, assign_task,
   * create_sub_conversation) stores it as its pair, so a specialist without a
   * model of its own runs on the delegating turn's model.
   */
  modelBinding?: { providerId: string; modelId: string }
  parentGoal?: string
  logger: import('pino').Logger
  workingDirectory?: string // Primary coding cwd (first working directory / worktree)
  /** All allowed write/read roots. Relative paths resolve against workingDirectory. */
  workingDirectories?: string[]
  /** Caller identity for the executor's authorization step. */
  actor?: ToolActor
  /**
   * Trust marker: an in-process pipeline (agent-runner, claude-code
   * canUseTool bridge) already ran the security gate + approval flow for THIS
   * call, so the executor skips its own gate step. Set ONLY by those
   * pipelines — never from external input. CASL is enforced regardless.
   */
  securityPipelineHandled?: boolean
  /**
   * The tools this call's run was offered (its tool scope, agent/tool-scope.ts):
   * the agent runner's request tools, a CLI bridge's scope. When set, the
   * executor refuses every other name, even for a trusted pipeline — a model
   * runs only what it was offered, on every provider. Unset = no toolset
   * limit (HTTP routes, external MCP clients). Set only by those in-process
   * paths, never from external input.
   */
  allowedTools?: ReadonlySet<string>
  /**
   * Set by the agent-runner when the current turn fans out two or more
   * specialist spawns. createDelegateTool uses it to isolate writer children
   * in git worktrees.
   */
  isolateSpecialists?: boolean
  pendingSpecialistIds?: string[]
}

/** Result of a tool execution */
export interface ToolResult {
  [key: string]: unknown
}

/** A fully implemented tool with execution logic */
export interface ToolImplementation {
  name: string
  description: string
  category: ToolCategory
  riskTier: RiskTier
  /**
   * JSON-Schema-shaped description that is forwarded to the LLM provider so it
   * can generate well-formed tool calls. This is NOT used for runtime
   * validation — use `validator` (Zod schema) for that.
   */
  inputSchema: Record<string, unknown>
  /**
   * Optional Zod schema used by the executor to validate `input` at runtime
   * before calling `execute`. Recommended for every tool; required for any
   * tool that runs shell commands, touches the filesystem, or makes external
   * calls. When omitted, the executor only performs a shallow "is-object"
   * check and logs a warning.
   */
  validator?: ZodTypeAny
  execute: (input: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>
  timeoutMs?: number
  requiresApproval?: boolean
  /** Sandbox mode hint for the executor (default: 'none'). */
  sandboxMode?: SandboxMode
  /**
   * The output is EYAS memory (notes, gists, facts, knowledge pages, team
   * memory). It is masked by the privacy policy on its way to a remote model,
   * on every transport, exactly like the same memory injected into the system
   * prompt. Workspace tools (files, shell, browser, documents, code search)
   * leave this unset: their output stays raw.
   */
  memoryBearing?: boolean
  /**
   * ACI (Phase-3M) output-formatter configuration. When present, the
   * executor passes the raw output through `formatToolOutput` AFTER the
   * byte-cap step. The formatted string replaces the output under the key
   * specified by `aci.field` (default 'text'). Raw output stays accessible
   * under `_raw` for instrumentation / audit.
   *
   * Omit for tools whose output is already small and structured; opt in
   * for shell, log, search, or read-file tools where long raw outputs
   * drown model context.
   */
  aci?: {
    enabled: true
    field?: string
    maxChars?: number
    headLines?: number
    tailLines?: number
    followUpHint?: string
    structured?: boolean
  }
}

/** Filter options for listing tools */
export interface ToolFilter {
  category?: ToolCategory
  riskTier?: RiskTier
  names?: string[]
}
