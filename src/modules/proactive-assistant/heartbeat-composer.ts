// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Model-in-the-loop composer for the heartbeat (Cap 5, Phase 3A.1). heartbeat.ts's
// shouldNotify() is the 0-token gate that decides WHETHER anything is worth
// surfacing; this module only runs after that gate already passed, and turns
// the raw signals/reasons into a short, human-voiced briefing. OFF by default
// (`proactive.heartbeat` feature flag) and fail-open — no eligible background
// model, a failed call, or the flag being off keeps the canned title+body.

import type { AuxiliaryModelService } from '@modules/model/auxiliary.js'
import type { HeartbeatSignals } from './heartbeat.js'

export interface ComposedHeartbeat {
  title: string
  body: string
}

/** What the composer reads; a ModuleContext satisfies it, read at call time. */
export interface HeartbeatComposerContext {
  auxiliaryModel?: Pick<AuxiliaryModelService, 'completeText'>
}

export const CANNED_HEARTBEAT_TITLE = 'Heartbeat: items may need your attention'

/** The canned body — also the background call's fallback (fail-open result). */
function cannedBody(reasons: string[]): string {
  return reasons.join('\n')
}

/**
 * Compose a human-voiced heartbeat alert from the signals/reasons the
 * deterministic gate already flagged as newsworthy. `enabled` gates the model
 * call itself (the `proactive.heartbeat` feature flag, checked at fire time
 * by the caller) — when false, no model call is made and the canned
 * title+body is returned unchanged, matching an install with no eligible
 * background model.
 */
export async function composeHeartbeat(
  ctx: HeartbeatComposerContext,
  signals: HeartbeatSignals,
  reasons: string[],
  enabled: boolean,
): Promise<ComposedHeartbeat> {
  const fallback = cannedBody(reasons)
  const aux = ctx.auxiliaryModel
  if (!enabled || !aux) return { title: CANNED_HEARTBEAT_TITLE, body: fallback }

  const body = await aux.completeText({
    purpose: 'heartbeat',
    system:
      'You are EYAS, briefing your owner on a few things that may need attention. ' +
      'Write a short (1-3 sentence), warm but terse, human-voiced briefing of what needs attention. ' +
      'No greeting, no sign-off — just the briefing itself.',
    user: `Signals: ${JSON.stringify(signals)}\nItems:\n${reasons.map((r) => `- ${r}`).join('\n')}`,
    maxTokens: 200,
    temperature: 0.4,
    fallback,
  })

  // Fail-open: completeText returns the fallback verbatim on none, a failed
  // call or empty output — keep the canned title too, so a failed compose
  // never mixes a "composed" title with the canned body.
  if (body === fallback) return { title: CANNED_HEARTBEAT_TITLE, body }
  return { title: 'Heartbeat', body }
}
