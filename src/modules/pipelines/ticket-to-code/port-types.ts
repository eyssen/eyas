// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { TicketContext } from './types.js'

/**
 * Dependency ports for the ticket-to-code pipeline.
 *
 * We intentionally define narrow interfaces instead of importing concrete
 * services. This keeps the pipeline decoupled from:
 *   - the concrete ticket backend (the internal board is the only built-in
 *     source; a custom TicketSourcePort adapter can wire an external tracker)
 *   - agent-runner internals
 *   - real git hosting clients
 *   - the Artifacts module internals (only the subset we need)
 *   - the checkpoint module (Phase 3B — just save/load)
 */

// ─── TicketSource ─────────────────────────────────────────────

export interface TicketSourcePort {
  /** Fetch a ticket by `source` + id. Throws if not found. */
  fetchTicket(source: string, ticketId: string): Promise<TicketContext>
}

// ─── AgentRunner ──────────────────────────────────────────────

export interface AgentRunInput {
  agentId: string
  sessionId: string | null
  /**
   * Free-form instructions for the agent. The stage is responsible for
   * composing the right instruction string given the inputs. The runner
   * is expected to honor existing EYAS agent config (tools, routing).
   */
  instructions: string
  /**
   * Strongly-typed context the agent receives alongside instructions.
   * Stages pass JSON-serializable payloads here (previous artifact
   * payload, ticket context, etc.).
   */
  context?: Record<string, unknown>
  /** Optional per-call override of the model id. */
  modelOverride?: string
}

export interface AgentRunOutput {
  /** The raw text completion from the agent. */
  text: string
  /**
   * Parsed JSON if the agent returned JSON — stages typically parse this
   * back into an artifact payload. If the runner cannot parse, this is
   * `undefined` and the stage falls back to regex/heuristics over `text`.
   */
  json?: unknown
  tokensIn?: number
  tokensOut?: number
}

export interface AgentRunnerPort {
  run(input: AgentRunInput): Promise<AgentRunOutput>
}

// ─── Artifact service (subset) ────────────────────────────────

/**
 * The pipeline only needs a narrow slice of the ArtifactService.
 * We re-declare it here so the pipeline module doesn't import the full
 * artifacts/artifact-service.ts file.
 */
export interface ArtifactServicePort {
  create(input: {
    sessionId: string | null
    kind: string
    title: string
    payload: unknown
    producedBy?: string | null
    changeNote?: string
  }): { id: string; kind: string; title: string; payload?: unknown }

  getWithPayload(id: string): { id: string; kind: string; payload?: unknown } | null

  link(fromId: string, toId: string, type: 'derives_from' | 'implements' | 'tests'): void
}

// ─── Checkpoint (Phase 3B) ────────────────────────────────────

export interface CheckpointPort {
  /**
   * Called before each stage. A no-op stub is acceptable; real impls
   * persist pipeline run state so it can be resumed after a crash.
   */
  save(key: string, value: unknown): Promise<void>
  load?(key: string): Promise<unknown | undefined>
}

// ─── PRClient ─────────────────────────────────────────────────

export interface PullRequestInput {
  title: string
  body: string
  branch: string
  baseBranch?: string
  files: Array<{
    path: string
    action: 'add' | 'modify' | 'delete' | 'rename'
    patch?: string
    newContent?: string
    renamedFrom?: string
  }>
}

export interface PullRequestResult {
  provider: 'stub' | 'github' | 'gitea' | 'gitlab'
  url: string
  /** Provider-native id (e.g. GitHub PR number) when available. */
  number?: number
  branch: string
  status: 'open' | 'draft'
}

export interface PRClientPort {
  openPullRequest(input: PullRequestInput): Promise<PullRequestResult>
}

// ─── Assembled deps ───────────────────────────────────────────

export interface PipelineDeps {
  ticketSource: TicketSourcePort
  agentRunner: AgentRunnerPort
  artifacts: ArtifactServicePort
  checkpoint?: CheckpointPort
  prClient: PRClientPort
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
  /** Pluggable ID generator — defaults to crypto.randomUUID in index.ts. */
  newId?: () => string
  /** Pluggable clock — defaults to Date.now. */
  now?: () => number
}
