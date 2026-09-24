// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Claude Code's reasoning wire: the gateway's EffortPlan → the options the
// RUNNING binary accepts, and the effective level read back from it.
//
// EYAS drives the operator's Claude Code binary through the pinned Agent SDK
// client (Gate 0 F1(b)). That client passes `effort` through verbatim as
// `--effort <level>`, so a level only goes on the wire when the binary itself
// reported it for this model (model_config.metadata.reasoning, written by
// discovery on the same binary): an older runtime rejects or silently drops a
// level it does not know, and the answer would claim an effort that never ran.
// Thinking is `--thinking adaptive|disabled`; the summarized-thinking display
// has no option on the pinned client and is passed as the runtime's own
// `--thinking-display` flag, only to a runtime verified to have it
// (THINKING_DISPLAY_MIN_VERSION).
//
// Readback: every hook input of a runtime that supports effort for the model
// carries `effort.level` — the level the turn really ran at, after the
// runtime's own silent downgrade (e.g. xhigh → high on a model without it;
// the base hook input of the 2.1.281 binary, read 2026-09-23). The pinned
// client does not type the field, so it is read untyped and Zod-parsed.
// A Stop and a PreToolUse matcher record it; the provider hands the last one
// to readbackOutcome(), so the answer states the confirmed effective level.
// No field, no claim: the gateway's own outcome stands, unconfirmed.

import type { HookCallbackMatcher, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ClaudeHookSet } from './hooks.js'
import { clampEffort } from '../../reasoning/clamp.js'
import type { EffortSetting } from '../../reasoning/ladder.js'
import type { EffortPlan } from '../../reasoning/resolve.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'

/**
 * The oldest Claude Code runtime `--thinking-display` is verified on: the
 * option table of the 2.1.280 binary (choices summarized|omitted|highlights;
 * also in 2.1.281), read 2026-09-24 — tests/fixtures/cli/claude-code/2.1.280/
 * thinking-display.json. That is the only way to ask such a runtime for the
 * display: its resolver sends none for a non-interactive (SDK) session
 * unless the flag is given, and consults the `showThinkingSummaries` setting
 * only in an interactive one. The SDK-bundled 2.1.89 has no such option, a
 * runtime given an option it does not know refuses to start the turn, and
 * the versions in between are unverified — so none of them is asked, and
 * discovery on them reports `thinkingDisplay: false` (the registry then shows
 * those models' reasoning as hidden). The live lane proves on the installed
 * binary that the flag becomes `thinking.display: 'summarized'` on the model
 * request (tests/live/cli-isolation.live.test.ts).
 */
export const THINKING_DISPLAY_MIN_VERSION = '2.1.280'

/** Numeric x.y.z comparison; null when either side is not a version. */
function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())?.slice(1).map(Number)
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  return 0
}

/** The running binary has `--thinking-display` (an unknown version never does). */
export function runtimeHasThinkingDisplay(runtimeVersion: string | null | undefined): boolean {
  if (!runtimeVersion) return false
  const cmp = compareVersions(runtimeVersion, THINKING_DISPLAY_MIN_VERSION)
  return cmp !== null && cmp >= 0
}

/** The Claude Code options one plan becomes. */
export interface ClaudeReasoningOptions {
  /** Options.effort (the pinned client passes it on as `--effort`). */
  effort?: string
  /** Options.thinking. */
  thinking?: { type: 'adaptive' } | { type: 'disabled' }
  /** Runtime flags the pinned client has no option for (`--<key> <value>`). */
  extraArgs?: Record<string, string>
  /** The level put on the wire: 'auto' when no effort and no thinking switch was sent. */
  sent: EffortSetting
}

export interface ClaudeReasoningInput {
  /** The gateway's plan for this attempt (absent: a direct call, nothing requested). */
  plan: EffortPlan | undefined
  /** What discovery on the running binary stored for the model (metadata.reasoning). */
  discovered: DiscoveredReasoning | null | undefined
  /** The running binary's version (the resolved runtime's). */
  runtimeVersion: string | null
}

/**
 * The effort levels the running binary itself reported for this model. None
 * when nothing was discovered, when the model has no effort control there,
 * or when the facts were stored by another binary version (a runtime switch
 * before its rediscovery finished): an unconfirmed level is never sent.
 */
export function runtimeEffortLevels(discovered: DiscoveredReasoning | null | undefined, runtimeVersion: string | null): DiscoveredReasoning['levels'] {
  if (!discovered || discovered.param !== 'effort') return []
  if (discovered.runtime && runtimeVersion && discovered.runtime !== runtimeVersion) return []
  return discovered.levels.filter((l) => l !== 'none' && l !== 'minimal')
}

/**
 * Translate the plan:
 *   - auto (or no plan) → no effort, no thinking switch;
 *   - none → thinking disabled, only on a model that can switch it off;
 *   - a rung → Options.effort, defensively clamped to the levels the running
 *     binary reported (none reported → nothing sent), plus adaptive thinking
 *     when the plan turns it on and the runtime runs it for this model;
 *   - summarized thinking display when the plan asks for it and the binary
 *     has the flag.
 */
export function toClaudeCodeReasoningOptions(input: ClaudeReasoningInput): ClaudeReasoningOptions {
  const { plan, discovered, runtimeVersion } = input
  const out: ClaudeReasoningOptions = { sent: 'auto' }
  if (!plan) return out

  if (plan.level === 'none') {
    if (plan.capability.canDisable) {
      out.thinking = { type: 'disabled' }
      out.sent = 'none'
    }
    return out
  }

  if (plan.level !== 'auto') {
    const levels = runtimeEffortLevels(discovered, runtimeVersion)
    const clamp = clampEffort(plan.level, levels.length > 0 ? { kind: 'effort', levels } : null)
    if (clamp.effective !== 'auto') {
      out.effort = clamp.effective
      out.sent = clamp.effective
      if (plan.thinking === 'on' && discovered?.adaptiveThinking === true) out.thinking = { type: 'adaptive' }
    }
  }

  if (plan.display === 'summarized' && runtimeHasThinkingDisplay(runtimeVersion)) {
    out.extraArgs = { 'thinking-display': 'summarized' }
  }
  return out
}

// ─── Readback ──────────────────────────────────────────────────────────

/** The one field of a hook input the readback reads; anything else is ignored. */
const HookEffortSchema = z.object({
  effort: z.object({ level: z.unknown() }).passthrough().optional().catch(undefined),
}).passthrough()

export interface EffortReadback {
  /** The mergeHooks `readback` slot: one Stop and one PreToolUse matcher. */
  hooks: ClaudeHookSet
  /** The last effective level the runtime reported this query (undefined: none reported). */
  effective(): string | undefined
}

/**
 * The readback matchers of one query. They never decide anything: every call
 * answers `continue`, a malformed input is ignored, and a throw inside is
 * swallowed.
 */
export function createEffortReadback(): EffortReadback {
  let last: string | undefined
  const hook = async (input: HookInput): Promise<HookJSONOutput> => {
    try {
      const parsed = HookEffortSchema.safeParse(input)
      const level = parsed.success ? parsed.data.effort?.level : undefined
      if (typeof level === 'string' && level.length > 0 && level.length <= 32) last = level
    } catch {
      // A readback never changes the turn.
    }
    return { continue: true }
  }
  const matcher = (): HookCallbackMatcher => ({ hooks: [hook] })
  return {
    hooks: { hooks: { Stop: [matcher()], PreToolUse: [matcher()] } },
    effective: () => last,
  }
}
