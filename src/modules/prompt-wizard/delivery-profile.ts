// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/delivery-profile.ts
//
// What the model that answers this turn can take: its context window, whether
// it calls tools, how it names EYAS tools, and whether it can drill into
// memory. The assembler sizes the prompt from it and the agent runner decides
// from it whether tools go out at all — so a small local model gets a prompt
// that fits and a tool-less one is never sent tool schemas it would reject.
//
// Every input comes through one existing mechanism: the window from the one
// window resolver (model/model-window.ts via ctx.modelWindow), the addressing
// from the provider's own declaration (model/tool-addressing.ts), a bare model
// id's provider from the catalog (model/binding.ts findModelOwner), and a
// target that names nothing from the install default (model/binding.ts
// resolveDefault). Nothing here keeps a table of its own.

import type { ToolAddressing } from '@modules/model/types.js'
import type { CliMcpBridgeHealth } from '@modules/model/cli-mcp/bridge-routes.js'
import {
  DEFAULT_WINDOW,
  resolveModelContextWindow,
  type ModelWindow,
  type ModelWindowSource,
  type ModelWindowTarget,
} from '@modules/model/model-window.js'
import { NATIVE_TOOL_ADDRESSING, toolAddressingOf } from '@modules/model/tool-addressing.js'
import { BASELINE_WINDOW } from './token-budget.js'

export interface DeliveryTarget {
  providerId?: string | null
  modelId?: string | null
}

export interface DeliveryProfile {
  /** The provider the profile describes; null when nothing could be bound. */
  providerId: string | null
  modelId: string | null
  contextWindow: number
  supportsTools: boolean
  toolAddressing: ToolAddressing
  /**
   * The model can open memory itself (memory_search / memory_expand): it calls
   * tools, and the path those tools take to it works.
   */
  drillDown: boolean
  /**
   * false: no model could be bound or its window is unknown (the resolver fell
   * back to its default). Budgets then use the 100k baseline, and the runner
   * sends no contextWindow.
   */
  resolved: boolean
  windowSource: ModelWindowSource
}

export interface DeliveryProfileDeps {
  /** ctx.modelWindow; absent → the resolver with no sources (default window). */
  modelWindow?: (target: ModelWindowTarget) => ModelWindow
  /** gateway.getProvider — only its toolAddressing is read. */
  getProvider?: (providerId: string) => { toolAddressing?: ToolAddressing } | undefined
  /** The install default (model/binding.ts resolveDefault) for a target that names neither provider nor model. */
  resolveDefault?: () => { providerId: string; modelId: string } | null
  /** Owner of a bare model id (model/binding.ts findModelOwner over the catalog). */
  lookupModelOwner?: (modelId: string) => string | null | undefined
  /** ctx.cliMcpBridge — the boot self-test of the CLI-MCP tool bridge. */
  bridgeHealth?: () => CliMcpBridgeHealth | undefined
}

/**
 * Addressings that reach EYAS tools over the stdio CLI-MCP bridge (Grok's
 * use_tool meta-tool, Kimi's MCP server). Native tools are EYAS's own, and the
 * mcp-prefix kind is Claude Code's in-process SDK MCP server — neither passes
 * through the bridge, so neither depends on its health.
 */
const BRIDGED_ADDRESSING = new Set<ToolAddressing['kind']>(['meta-tool', 'mcp-server'])

/** The profile of a turn nothing is known about: baseline budget, native tools. */
export function unresolvedDeliveryProfile(target: DeliveryTarget = {}): DeliveryProfile {
  return {
    providerId: target.providerId || null,
    modelId: target.modelId || null,
    contextWindow: DEFAULT_WINDOW,
    supportsTools: true,
    toolAddressing: NATIVE_TOOL_ADDRESSING,
    drillDown: true,
    resolved: false,
    windowSource: 'default',
  }
}

/**
 * The delivery profile for a target. A target that names only a model is
 * bound to that model's owner; when no owner resolves, the profile stays
 * unresolved (native names, baseline budget) — the install default answers a
 * request only when it names neither provider nor model, so its profile would
 * describe another model. Never throws — a failing dependency degrades to
 * what is known without it.
 */
export function resolveDeliveryProfile(deps: DeliveryProfileDeps, target: DeliveryTarget = {}): DeliveryProfile {
  let providerId = target.providerId || null
  let modelId = target.modelId || null

  if (!providerId && modelId) {
    const owner = attempt(() => deps.lookupModelOwner?.(modelId!)) || null
    if (!owner) return unresolvedDeliveryProfile({ modelId })
    providerId = owner
  }
  if (!providerId) {
    const binding = attempt(() => deps.resolveDefault?.()) ?? null
    if (binding) {
      providerId = binding.providerId
      modelId = binding.modelId
    }
  }
  if (!providerId) return unresolvedDeliveryProfile({ modelId })

  const window = attempt(() => deps.modelWindow?.({ providerId, modelId }))
    ?? resolveModelContextWindow({ providerId, modelId })
  const toolAddressing = toolAddressingOf(attempt(() => deps.getProvider?.(providerId!)))
  const bridged = BRIDGED_ADDRESSING.has(toolAddressing.kind)
  const drillDown = window.supportsTools && (!bridged || bridgeUsable(attempt(() => deps.bridgeHealth?.())))

  return {
    providerId,
    modelId,
    contextWindow: window.contextWindow,
    supportsTools: window.supportsTools,
    toolAddressing,
    drillDown,
    resolved: window.source !== 'default',
    windowSource: window.source,
  }
}

/** The window the prompt budget is sized for: the model's own, or the baseline when unknown. */
export function budgetWindowOf(profile: DeliveryProfile): number {
  return profile.resolved ? profile.contextWindow : BASELINE_WINDOW
}

/**
 * True when the delivery profile describes the model a run actually calls, so
 * the runner may act on it. A profile for another provider (or another model
 * of it) is not evidence about this run.
 */
export function profileMatchesRun(
  profile: DeliveryProfile,
  run: { provider?: string | null; model?: string | null },
): boolean {
  if (!profile.providerId) return false
  if (run.provider && run.provider !== profile.providerId) return false
  if (run.model && profile.modelId && run.model !== profile.modelId) return false
  if (!run.provider && run.model && !profile.modelId) return false
  return true
}

/**
 * Only a self-test that ran and failed withdraws drill-down. A deferred check
 * (setup was incomplete at boot) or none yet is not evidence of a fault.
 */
function bridgeUsable(health: CliMcpBridgeHealth | undefined): boolean {
  if (!health) return true
  return health.healthy || health.deferred === true
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
