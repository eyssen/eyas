// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The trust tier of a vault note, derived once by the indexer and stored in
// vault_index.trust_tier. L0 migration, the standing index and (J4) vault
// recall read the stored value; nothing re-labels a note at read time.
//
// A note is the owner's own words unless something says otherwise:
//   - an explicit frontmatter `trust` can only LOWER the tier
//     (`trust: quarantined` keeps the note out of every recall);
//   - a model wrote it → 'derived': frontmatter `origin` (the EYAS writer),
//     the 'auto-consolidated' tag (nightly consolidation, team summaries), or
//     a capture link (memory_note_links source 'capture', the per-turn note
//     writer).
// Why it matters: facts take trust = min(sources), so a model-written note
// laundered to 'owner' would mint owner-trust facts.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { VaultFrontmatter } from '../types.js'
import type { TrustTier } from '../v2/ingest-bridge.js'
import { minTrust } from '../v2/arbitrate.js'

/** Tag the consolidation and team-summary writers put on the notes they author. */
export const AUTO_CONSOLIDATED_TAG = 'auto-consolidated'

export interface VaultTrustInput {
  frontmatter: Pick<VaultFrontmatter, 'tags' | 'origin' | 'trust'>
  /** The note was written by the per-turn capture (a memory_note_links 'capture' row). */
  captureLinked: boolean
}

export function deriveVaultTrust(input: VaultTrustInput): TrustTier {
  const fm = input.frontmatter
  const modelAuthored = fm.origin !== undefined
    || (Array.isArray(fm.tags) && fm.tags.includes(AUTO_CONSOLIDATED_TAG))
    || input.captureLinked
  const base: TrustTier = modelAuthored ? 'derived' : 'owner'
  return fm.trust ? minTrust([base, fm.trust]) : base
}

/** Whether the per-turn capture wrote (or reinforced) this note. False when the table is absent. */
export function noteHasCaptureLink(db: EyasDb, path: string): boolean {
  try {
    const rows = db.all<{ ok: number }>(sql`SELECT 1 AS ok FROM memory_note_links
      WHERE note_path = ${path.replace(/\\/g, '/')} AND source = 'capture' LIMIT 1`)
    return rows.length > 0
  } catch {
    return false
  }
}
