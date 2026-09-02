// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Model-in-the-loop composer for the heartbeat (Cap 5, Phase 3A.1). heartbeat.ts's
// shouldNotify() is the 0-token gate that decides WHETHER anything is worth
// surfacing; this module only runs after that gate already passed, and turns
// the raw signals/reasons into a short, human-voiced briefing. OFF by default
// (`proactive.heartbeat` feature flag) and fail-open — a missing/erroring
// model, or the flag being off, falls back to the current canned title+body.

import { runCheapModelPass, type CheapModelPassContext } from '@modules/model/cheap-pass.js'
import type { HeartbeatSignals } from './heartbeat.js'

export interface ComposedHeartbeat {
  title: string
  body: string
}

export const CANNED_HEARTBEAT_TITLE = 'Heartbeat: items may need your attention'

/** The canned body — also the `runCheapModelPass` fallback (fail-open result). */
function cannedBody(reasons: string[]): string {
  return reasons.join('\n')
}

/**
 * Compose a human-voiced heartbeat alert from the signals/reasons the
 * deterministic gate already flagged as newsworthy. `enabled` gates the model
 * call itself (the `proactive.heartbeat` feature flag, checked at fire time
 * by the caller) — when false, no model call is made and the canned
 * title+body is returned unchanged, matching a missing/erroring model.
 */
export async function composeHeartbeat(
  ctx: CheapModelPassContext,
  signals: HeartbeatSignals,
  reasons: string[],
  enabled: boolean,
): Promise<ComposedHeartbeat> {
  const fallback = cannedBody(reasons)
  if (!enabled) return { title: CANNED_HEARTBEAT_TITLE, body: fallback }

  const body = await runCheapModelPass(ctx, {
    system:
      'You are EYAS, briefing your owner on a few things that may need attention. ' +
      'Write a short (1-3 sentence), warm but terse, human-voiced briefing of what needs attention. ' +
      'No greeting, no sign-off — just the briefing itself.',
    user: `Signals: ${JSON.stringify(signals)}\nItems:\n${reasons.map((r) => `- ${r}`).join('\n')}`,
    maxTokens: 200,
    temperature: 0.4,
    fallback,
  })

  // Fail-open: runCheapModelPass returns the fallback verbatim on a missing
  // model, a thrown error, or empty output — keep the canned title too, so a
  // failed compose never mixes a "composed" title with the canned body.
  if (body === fallback) return { title: CANNED_HEARTBEAT_TITLE, body }
  return { title: 'Heartbeat', body }
}
