// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { ModelRequestMetadata, RequestOrigin } from './types.js'
import { argHash } from '@shared/arg-hash.js'

/** Security-gate decision shape (subset of what security-gate.validateToolCall returns). */
export interface GateDecision {
  decision: 'allow' | 'deny' | 'escalate' | 'judge_error'
  reason: string
  riskTier: string
}

export interface PermissionBridgeDeps {
  /** EYAS security gate — the same authority the agent-runner uses. */
  validateToolCall(
    toolName: string,
    input: Record<string, unknown>,
    ctx?: { conversationId?: string; agentId?: string },
  ): GateDecision | Promise<GateDecision>
  /** Cap 7 autonomy ladder — only consulted for autonomous runs. */
  autonomy?: {
    categoryForTool(name: string, riskTier?: 'green' | 'yellow' | 'red'): string | null
    resolve(category: string): { level: number; locked: boolean; maxLevel: number }
    /**
     * Returns the (possibly deduped) approval row id. Typed `number | void` so
     * the older gate stubs that ignore the return value stay assignable — the
     * approval sink below only fires on a real number.
     */
    createApproval(rec: {
      category: string
      toolName: string
      agentId?: string
      conversationId?: string
      reason: string
      inputJson?: string
      argHash?: string
      expiresAt?: string
      /** The supervised run this escalation happened on — without it the parked run cannot be woken. */
      runId?: string
    }): number | void
    /** D4 grant ledger — see autonomy-policy.ts consumeGrant(). Optional so older gate stubs stay valid. */
    consumeGrant?(input: { conversationId: string; toolName: string; argHash: string; now?: string }): { granted: boolean; approvalId?: number }
    /** D5 — the TTL-stamped expiry a fresh escalation should carry. Optional so older gate stubs stay valid. */
    defaultExpiresAt?(now?: string): string
  }
  /** True for background/scheduled runs (autonomy ladder governs). False = interactive (gate governs, user is approver). */
  autonomous?: boolean
  /**
   * `runId` is the supervised run this call belongs to. It is stamped onto every
   * approval enqueued here — a row without it can never wake its run (unpark
   * takes a run id) and is invisible to the re-park cap, which counts approvals
   * by run lineage.
   */
  ctx: { conversationId?: string; agentId?: string; runId?: string }
  /**
   * F2 T5 — per-request approval sink. For CLI providers the agentic loop runs
   * INSIDE the provider, so an escalation can only be denied in-session; this
   * tells the runner WHICH approval row was enqueued (and for which tool) so an
   * autonomous supervised run can park on it once the provider turn ends.
   * Called only when a row was actually created (or deduped onto an existing
   * one) — never for a deterministic deny or a consumed grant.
   *
   * Its PRESENCE is also what licenses an interrupting deny: interrupting a run
   * nobody is collecting approvals for would kill a turn that used to survive
   * on deny-and-continue.
   */
  onEscalatedApproval?: (approvalId: number, toolName?: string) => void
  /** Optional — logs every non-allow verdict (deny/escalate/judge_error/unknown/thrown). */
  logger?: Logger
}

/**
 * Structural permission result — assignable to the Claude Agent SDK's
 * PermissionResult. `interrupt` (deny only) stops the SDK's agentic loop
 * instead of feeding the denial back as a tool result; used for autonomous
 * approval denials, where the run is about to park and every further turn
 * would just burn tokens against a wall.
 */
export type BridgePermissionResult =
  | { behavior: 'allow' }
  | { behavior: 'deny'; message: string; interrupt?: boolean }

/** Callback signature compatible with the Claude Agent SDK's `options.canUseTool`. */
export type CanUseToolFn = (
  toolName: string,
  input: Record<string, unknown>,
  opts: { toolUseID: string; agentID?: string; signal: AbortSignal },
) => Promise<BridgePermissionResult>

const allow = (): BridgePermissionResult => ({ behavior: 'allow' })
const deny = (message: string): BridgePermissionResult => ({ behavior: 'deny', message })

/**
 * Routes every CLI-provider-driven tool call (SDK builtins, bridged
 * mcp__eyas__* tools, ACP permission requests) through EYAS governance,
 * mirroring the agent-runner's Cap 7 policy:
 *
 *   - Only an explicit gate 'allow' can allow. deny / escalate / judge_error /
 *     unknown verdicts / a thrown gate all deny (fail-closed) — escalate
 *     additionally enqueues an approval when the ladder is wired.
 *   - Interactive run   → the gate-allowed call is granted (audited).
 *   - Autonomous run    → the autonomy ladder is additionally authoritative:
 *       L3 (unlocked)   → allow.
 *       locked / L1-L2  → enqueue approval + deny (fail-closed).
 *
 * Fail-closed is the default whenever anything is ambiguous — an ungoverned
 * tool call is the failure mode we must never allow.
 *
 * Shared by the claude-code (Agent SDK canUseTool) and grok-cli (ACP
 * session/request_permission + fs servicing) providers.
 */
export function createPermissionBridge(deps: PermissionBridgeDeps): CanUseToolFn {
  const { validateToolCall, autonomy, autonomous, ctx, logger } = deps

  const logDeny = (name: string, message: string): BridgePermissionResult => {
    logger?.warn(
      { toolName: name, conversationId: ctx.conversationId, agentId: ctx.agentId },
      `permission bridge denied: ${message}`,
    )
    return deny(message)
  }

  /**
   * Deny a call that is waiting on a human. When the caller collects escalated
   * approvals (i.e. the run can park on one), the deny also interrupts the
   * provider's loop — there is nothing useful left for the model to do this
   * turn. Keying this on the SINK, not on autonomy, is deliberate: an
   * autonomous run with no park sink (unsupervised, or no event store) still
   * relies on deny-and-continue, and interrupting it would turn a turn that
   * used to survive into a failed run.
   */
  const denyForApproval = (name: string, message: string): BridgePermissionResult => {
    const result = logDeny(name, message)
    if (!deps.onEscalatedApproval || result.behavior !== 'deny') return result
    return { ...result, interrupt: true }
  }

  /** Enqueue an approval and report its id to the runner's park sink. */
  const enqueueApproval = (rec: {
    category: string
    toolName: string
    reason: string
    inputJson: string
    argHash: string
    conversationId: string
  }): void => {
    if (!autonomy) return
    try {
      const approvalId = autonomy.createApproval({
        category: rec.category,
        toolName: rec.toolName,
        agentId: ctx.agentId,
        conversationId: rec.conversationId,
        inputJson: rec.inputJson,
        argHash: rec.argHash,
        expiresAt: autonomy.defaultExpiresAt?.(),
        reason: rec.reason,
        // Without the run id the parked run is unreachable: the approve /
        // reject / TTL-expiry path has no session to unpark, and the re-park
        // cap (which counts approvals per run lineage) cannot see this row.
        runId: ctx.runId,
      })
      // Only a real row can be parked on / approved later. A policy stub that
      // returns nothing simply gets no park (deny-and-continue, as before).
      if (typeof approvalId === 'number') deps.onEscalatedApproval?.(approvalId, rec.toolName)
    } catch {
      // Queue insert is best-effort visibility — the caller's deny stands.
    }
  }

  return async (toolName, input, _opts) => {
    const name = toolName.replace(/^mcp__eyas__/, '')

    let det: GateDecision
    try {
      det = await validateToolCall(name, input, ctx)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return logDeny(name, `security gate threw while validating ${name} — denied (fail-closed): ${msg}`)
    }

    // A gate that resolves (doesn't throw) with something malformed — undefined,
    // null, or a decision that isn't even a string — must not reach the switch
    // below, where it would throw a TypeError past every deny path. Fail-closed.
    if (!det || typeof (det as { decision?: unknown }).decision !== 'string') {
      return logDeny(name, `security gate returned a malformed verdict for ${name} — denied (fail-closed)`)
    }

    // Exhaustive verdict handling — ONLY an explicit 'allow' proceeds. Every
    // other verdict (deny, escalate, judge_error, anything unknown) denies:
    // an ungoverned tool call is the failure mode we must never allow.
    switch (det.decision) {
      case 'allow':
        break
      case 'deny':
        return logDeny(name, `gate denied ${name}: ${det.reason}`)
      case 'escalate': {
        // The gate demanded a human decision. F2 T3 — grant check FIRST: a
        // prior human approval for this EXACT call (same conversation + tool
        // + args) authorizes it exactly once, letting the agent proceed
        // without waiting on a fresh approval. Never reachable from a
        // deterministic gate 'deny' (that verdict returns above).
        const callArgHash = argHash(input)
        if (autonomy?.consumeGrant && ctx.conversationId) {
          let grant: { granted: boolean; approvalId?: number } | null = null
          try {
            grant = autonomy.consumeGrant({ conversationId: ctx.conversationId, toolName: name, argHash: callArgHash })
          } catch {
            // Fail closed to the normal enqueue+deny flow below.
          }
          if (grant?.granted) {
            logger?.info?.({ toolName: name, approvalId: grant.approvalId }, 'gate:grant_consumed')
            return allow()
          }
        }

        // Queue an approval when the ladder is wired, deny now — the operator
        // approves from the Approvals queue and the agent retries. Enqueues
        // even for an uncategorized tool (F2 T3 enqueue-everywhere) — a
        // category-less escalation used to be denied with NO row at all.
        if (autonomy) {
          // I3 — a row with no conversation_id can never be granted
          // (consumeGrant requires one), so it's just a dead row that grows
          // on every retry. Skip the enqueue and say so explicitly.
          if (!ctx.conversationId) {
            return logDeny(name, `approval required for ${name} but this execution path cannot receive grants (no conversation scope): ${det.reason}`)
          }
          enqueueApproval({
            category: autonomy.categoryForTool(name, det.riskTier as 'green' | 'yellow' | 'red') ?? 'uncategorized',
            toolName: name,
            conversationId: ctx.conversationId,
            inputJson: JSON.stringify(input),
            argHash: callArgHash,
            reason: det.reason,
          })
        }
        return denyForApproval(name, `approval required for ${name} (gate escalated): ${det.reason}`)
      }
      case 'judge_error':
        return logDeny(name, `security judge unavailable for ${name} — denied (fail-closed): ${det.reason}`)
      default:
        return logDeny(name, `unknown gate verdict '${(det as { decision: string }).decision}' for ${name} — denied (fail-closed)`)
    }

    // Gate allowed. Interactive: the human owns the conversation and is the
    // approver (the call is still audited by validateToolCall).
    if (!autonomous) return allow()

    // Autonomous: the autonomy ladder governs (strictest-wins with the gate).
    if (!autonomy) return logDeny(name, `autonomous run without an autonomy policy — refusing ${name} (fail-closed)`)

    // D14/riskTier fix — threading riskTier here closes the CLI fail-safe gap:
    // an unmapped RED-tier tool now falls into categoryForTool's fail-safe
    // (data_delete) instead of silently passing through as "uncategorized".
    const category = autonomy.categoryForTool(name, det.riskTier as 'green' | 'yellow' | 'red')
    // Uncategorized + gate-allowed → allow (the gate is the only authority left).
    if (!category) return allow()

    const { level, locked } = autonomy.resolve(category)
    if (level >= 3 && !locked) return allow()

    // F2 T3 — grant check before the deny-for-approval branch below.
    const callArgHash = argHash(input)
    if (autonomy.consumeGrant && ctx.conversationId) {
      let grant: { granted: boolean; approvalId?: number } | null = null
      try {
        grant = autonomy.consumeGrant({ conversationId: ctx.conversationId, toolName: name, argHash: callArgHash })
      } catch {
        // Fail closed to the normal enqueue+deny flow below.
      }
      if (grant?.granted) {
        logger?.info?.({ toolName: name, approvalId: grant.approvalId }, 'gate:grant_consumed')
        return allow()
      }
    }

    // I3 — a row with no conversation_id can never be granted (consumeGrant
    // requires one), so it's just a dead row that grows on every retry. Skip
    // the enqueue and say so explicitly.
    if (!ctx.conversationId) {
      return logDeny(name, `approval required (${category}) but this execution path cannot receive grants (no conversation scope): ${det.reason}`)
    }

    enqueueApproval({
      category,
      toolName: name,
      conversationId: ctx.conversationId,
      inputJson: JSON.stringify(input),
      argHash: callArgHash,
      reason: det.reason,
    })
    return denyForApproval(name, `approval required (${category}): ${det.reason}`)
  }
}

/** Origins where a human owns the conversation and can act as approver. */
const HUMAN_ATTENDED_ORIGINS: ReadonlySet<RequestOrigin> = new Set(['interactive', 'channel'])

/**
 * F0 fail-closed autonomy classification. A run is INTERACTIVE only when its
 * construction site explicitly says a human is attending it; anything absent,
 * unknown, or unattended is AUTONOMOUS (graduated-autonomy ladder governs).
 */
export function isAutonomousRequest(metadata?: ModelRequestMetadata): boolean {
  if (!metadata) return true
  if (metadata.teamSessionId) return true
  if (metadata.autonomous === true) return true
  if (metadata.origin && HUMAN_ATTENDED_ORIGINS.has(metadata.origin)) return false
  return true
}
