// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Cap 6 dream-engine — routes reflection's ImprovementCandidate[] (Task 3) into
// forge's feedback store, so "reflect → propose improvement" is a live loop
// instead of the debug-log-only dead end it was (see memory/index.ts). Only
// 'tool'/'skill' candidates are routed: forge's target dimension has no
// 'prompt' value (forge_proposals' CHECK constraint only allows
// 'skill'|'tool'|'soul'|'project_rule' — see forge/schema.ts), so a 'prompt'
// candidate would eventually crash a forge scan rather than propose anything.
// Self-learning has no clean external-insight intake (execution-learner.ts
// only computes insights from its own DB stats), so forge alone satisfies
// this bridge — best-effort and fail-safe: forge absence or any per-record
// failure is swallowed so the nightly reflection job is never affected.

import type { ImprovementCandidate } from './reflection-engine.js'

type BridgeableTarget = 'tool' | 'skill'
const BRIDGEABLE_TARGETS = new Set<BridgeableTarget>(['tool', 'skill'])

export interface ForgeFeedbackSink {
  record(input: {
    target: BridgeableTarget
    targetId: string
    conversationId: string
    useful: boolean
    friction?: string
    betterApproach?: string
  }): unknown
}

/**
 * Routes each `target:'tool'`/`'skill'` improvement candidate into forge's
 * feedback store. `marker` becomes the record's `conversationId` — forge's
 * own `tools:executed` auto-collector drops records with a falsy
 * `conversationId` (see forge/index.ts), so callers MUST pass a stable
 * non-empty marker (e.g. `reflection:${date}`) rather than leave it out.
 * Never throws — returns the count actually bridged.
 */
export function bridgeImprovementsToForge(
  forge: { collector?: ForgeFeedbackSink } | undefined,
  improvements: ImprovementCandidate[],
  marker: string,
  logger?: { warn?: (...args: any[]) => void },
): number {
  const collector = forge?.collector
  if (!collector || improvements.length === 0) return 0

  let bridged = 0
  for (const candidate of improvements) {
    if (!BRIDGEABLE_TARGETS.has(candidate.target as BridgeableTarget)) continue
    try {
      collector.record({
        target: candidate.target as BridgeableTarget,
        targetId: candidate.targetId,
        conversationId: marker,
        useful: false,
        friction: candidate.friction,
        betterApproach: candidate.suggestion,
      })
      bridged++
    } catch (err) {
      logger?.warn?.(`reflection→forge bridge failed for ${candidate.target}:${candidate.targetId} (fail-open): ${String(err)}`)
    }
  }
  return bridged
}
