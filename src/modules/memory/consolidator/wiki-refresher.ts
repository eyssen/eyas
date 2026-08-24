// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * DeepWiki refresher — STUBBED in Phase 3C.
 *
 * The final implementation will:
 *   1. For each active client, scan last-24h conversations + PRs + events.
 *   2. Produce a WikiEditProposal per page that should update.
 *   3. Store proposals in a `wiki_edit_proposals` table — NO auto-apply.
 *
 * Phase 3C only wires the orchestration skeleton. The actual diff-production
 * step is delegated to the injected ConsolidatorWikiPort.proposeEditsForClient
 * adapter, whose default implementation should simply return [] until
 * Phase 3F lands.
 */

import type { ConsolidatorWikiPort, WikiEditProposal } from './types.js'

export interface WikiRefresherConfig {
  /** Look-back window. */
  windowHours: number
}

export const DEFAULT_WIKI_REFRESHER_CONFIG: WikiRefresherConfig = {
  windowHours: 24,
}

export function createWikiRefresher(
  wiki: ConsolidatorWikiPort,
  config: WikiRefresherConfig = DEFAULT_WIKI_REFRESHER_CONFIG
) {
  return {
    /**
     * Iterate active clients, collect proposals. Pure accumulator —
     * persistence / human-review queueing happens at the consolidator layer.
     */
    proposeAll(): WikiEditProposal[] {
      const clients = wiki.listActiveClients()
      const out: WikiEditProposal[] = []
      for (const c of clients) {
        // TODO(phase-3F): wrap this call with per-client error isolation so a
        // single misbehaving adapter can't fail the whole consolidation run.
        const proposals = wiki.proposeEditsForClient(c.clientId, config.windowHours)
        out.push(...proposals)
      }
      return out
    },
  }
}

export type WikiRefresher = ReturnType<typeof createWikiRefresher>
