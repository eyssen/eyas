// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { RiskTier } from './types.js'

/**
 * Approval Tier Mode (Phase 3F).
 *
 * Inspired by Cline / Roo Code's auto-approve controls. Sits on top of the
 * existing security gate: the gate tells us whether an action is *permitted*
 * (deny/allow/escalate based on pattern matching and LLM judge); this module
 * tells us whether the permitted action needs *human sign-off* before it runs.
 *
 * The two concerns are deliberately separate:
 *   - A tool call that the gate DENIES is never sent through approval.
 *   - A tool call that the gate ALLOWS may still be held for user approval
 *     if the current mode demands it.
 *
 * Three modes, inspired by the Cline UX:
 *   - `paranoid`  — every tool call requires approval (useful when starting a
 *                   new agent or debugging a workflow).
 *   - `balanced`  — destructive (yellow/red) tools require approval; green
 *                   tier passes through. This is the recommended default.
 *   - `autopilot` — nothing requires approval. Still logged. Meant for
 *                   closed-loop scenarios with strong external guardrails.
 *
 * Overrides follow a precedence chain (most specific first): per-tool →
 * per-user → per-risk-tier → global mode. This mirrors how access-control
 * policies usually compose: narrowest declaration wins.
 */

export type ApprovalMode = 'paranoid' | 'balanced' | 'autopilot'

export interface ApprovalTierConfig {
  /** Global default mode applied when no override matches. */
  mode: ApprovalMode
  /**
   * Per-user override keyed by userId. Useful when different humans on the
   * same instance have different risk tolerances.
   */
  perUser?: Record<string, ApprovalMode>
  /**
   * Per-tool override keyed by tool name. Highest precedence — lets you
   * single out a specific tool (e.g. `run_command`) regardless of what
   * blanket mode is active.
   */
  perTool?: Record<string, ApprovalMode>
  /**
   * Per-risk-tier override. Example: in balanced mode, force `red` tier
   * to behave as if in paranoid mode (approval + preview required).
   */
  perRiskTier?: Partial<Record<RiskTier, ApprovalMode>>
  /**
   * When true, destructive (red-tier) tools must deliver a preview artifact
   * (e.g. a diff or dry-run output) alongside the approval request. This
   * module only reports the requirement; generating the preview is the
   * calling tool's responsibility.
   */
  requirePreviewForRed?: boolean
}

export const DEFAULT_APPROVAL_CONFIG: ApprovalTierConfig = {
  mode: 'autopilot',
  requirePreviewForRed: true,
}

export type ApprovalDecision =
  | { action: 'auto'; reason: string }
  | { action: 'approve'; reason: string; requiresPreview: boolean }

export interface ApprovalContext {
  userId?: string
  /**
   * Optional per-call mode override. Lets short-lived callers (e.g. a team
   * session that temporarily tightens controls) bypass the stored config
   * without mutating it. Wins over everything else when present.
   */
  modeOverride?: ApprovalMode
}

export interface ApprovalTierPolicy {
  readonly config: ApprovalTierConfig
  decide(toolName: string, riskTier: RiskTier, ctx?: ApprovalContext): ApprovalDecision
  /**
   * Returns the effective mode that would apply to a given tool + tier + ctx,
   * without resolving it to an action. Useful for UI labels ("you're in
   * balanced mode for this tool").
   */
  resolveMode(toolName: string, riskTier: RiskTier, ctx?: ApprovalContext): ApprovalMode
}

export function createApprovalTierPolicy(
  config: ApprovalTierConfig = DEFAULT_APPROVAL_CONFIG,
): ApprovalTierPolicy {
  function resolveMode(
    toolName: string,
    riskTier: RiskTier,
    ctx?: ApprovalContext,
  ): ApprovalMode {
    // Call-site override wins outright — think "tighten for this team session".
    if (ctx?.modeOverride) return ctx.modeOverride

    const perTool = config.perTool?.[toolName]
    if (perTool) return perTool

    if (ctx?.userId) {
      const perUser = config.perUser?.[ctx.userId]
      if (perUser) return perUser
    }

    const perTier = config.perRiskTier?.[riskTier]
    if (perTier) return perTier

    return config.mode
  }

  return {
    config,
    resolveMode,
    decide(toolName, riskTier, ctx) {
      const mode = resolveMode(toolName, riskTier, ctx)
      const source = describeSource(mode, config, toolName, ctx)

      switch (mode) {
        case 'autopilot':
          return { action: 'auto', reason: `autopilot (${source})` }

        case 'paranoid':
          return {
            action: 'approve',
            reason: `paranoid (${source}) — all tool calls require approval`,
            requiresPreview: riskTier === 'red' && config.requirePreviewForRed === true,
          }

        case 'balanced':
          if (riskTier === 'green') {
            return { action: 'auto', reason: `balanced (${source}) — green tier auto-allowed` }
          }
          return {
            action: 'approve',
            reason: `balanced (${source}) — ${riskTier} tier requires approval`,
            requiresPreview: riskTier === 'red' && config.requirePreviewForRed === true,
          }

        default: {
          // Exhaustiveness check — if a new mode is added the type system
          // flags this arm. Failsafe to 'approve' so an unknown mode never
          // silently degrades to autopilot.
          const _exhaustive: never = mode
          void _exhaustive
          return {
            action: 'approve',
            reason: `unknown approval mode ${mode as string} — failing safe to require approval`,
            requiresPreview: false,
          }
        }
      }
    },
  }
}

/**
 * Helper: describe which rule in the config produced the mode, for audit logs.
 * Not exposed on the public API — kept internal so callers can't rely on the
 * exact wording.
 */
function describeSource(
  mode: ApprovalMode,
  config: ApprovalTierConfig,
  toolName: string,
  ctx?: ApprovalContext,
): string {
  if (ctx?.modeOverride === mode) return 'call-site override'
  if (config.perTool?.[toolName] === mode) return `per-tool:${toolName}`
  if (ctx?.userId && config.perUser?.[ctx.userId] === mode) return `per-user:${ctx.userId}`
  // perRiskTier check has to be last because the default mode may also equal it
  for (const tier of ['red', 'yellow', 'green'] as const) {
    if (config.perRiskTier?.[tier] === mode && mode !== config.mode) {
      return `per-risk-tier:${tier}`
    }
  }
  return 'global'
}
