// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/skills/dead-skill-detector.ts
// Reads the inventory, applies the owner-reviewable policy, and returns
// candidates. It never mutates a skill — see runDeadSkillScan below for the
// propose-only apply path.
//
// PROPOSE, NEVER APPLY (decision A2, docs/superpowers/specs/2026-07-11-eyas-
// prompt-phase3-autonomy-design.md): runDeadSkillScan only enqueues autonomy
// approvals. applyDeadSkillApproval is the ONLY code path that disables a
// skill, and it runs solely off an already-approved decision delivered via
// the autonomy:approval-resolved bus event — never off the scan itself.
import { sql } from 'drizzle-orm'
import { buildInventory, type InventoryRow } from './skill-inventory.js'
import { classifySkill, type ClassifyConfig, type ClassifyResult } from './classify-skill.js'

export function findDeadCandidates(
  db: any,
  cfg: ClassifyConfig,
  now: Date,
  orphanIds: string[] = [],
): (InventoryRow & ClassifyResult)[] {
  return buildInventory(db, orphanIds)
    .filter((row) => row.enabled)
    .map((row) => ({
      ...row,
      ...classifySkill(
        {
          source: row.source,
          createdAt: row.createdAt,
          useCount: row.useCount,
          lastUsedAt: row.lastUsedAt ?? null,
          isShadowed: row.shadowedSources.length > 0,
          isOrphan: row.isOrphan,
          situational: row.situational,
        },
        cfg,
        now,
      ),
    }))
    .filter((row) => row.proposeDisable)
}

export const SKILL_DISABLE_KIND = 'skill_disable'

export interface DeadScanDeps {
  db: any
  loader: { setEnabled(id: string, enabled: boolean, reason?: string, by?: string): void }
  classifyConfig: ClassifyConfig
  /**
   * security-gate autonomyPolicy — absent means the detector is inert and
   * proposes nothing. createApproval is SYNCHRONOUS and returns the new row id.
   */
  autonomyPolicy?: {
    createApproval(input: {
      category: string
      inputJson?: string
      preview?: string
      reason?: string
      kind?: string
    }): number
  }
  logger: { info(o: unknown, m?: string): void; debug(o: unknown, m?: string): void }
  now?: () => Date
  /**
   * Ids `findOrphans` (skill-inventory.ts) most recently reported. Orphan
   * detection requires an actual directory scan (skill-loader.ts), which this
   * scheduled scan does not perform itself — a caller that runs a periodic
   * scan can feed its `orphans` result in here. Defaults to none, so a scan
   * with no directory context still evaluates shadowed/never-used/dormant
   * candidates correctly, just without evidence-based orphan detection.
   */
  orphanIds?: string[]
}

/** Skill ids that already have an un-actioned skill_disable proposal waiting. */
function pendingSkillIds(db: any): Set<string> {
  const rows = db.all(sql`SELECT input_json FROM autonomy_approvals
    WHERE kind = ${SKILL_DISABLE_KIND} AND status = 'pending'`) as { input_json: string | null }[]
  const ids = new Set<string>()
  for (const r of rows) {
    try { const parsed = JSON.parse(r.input_json ?? '{}'); if (parsed.skillId) ids.add(parsed.skillId) } catch { /* ignore */ }
  }
  return ids
}

export function runDeadSkillScan(deps: DeadScanDeps): { proposed: number; skipped: number } {
  const now = deps.now?.() ?? new Date()
  const candidates = findDeadCandidates(deps.db, deps.classifyConfig, now, deps.orphanIds ?? [])
  if (!deps.autonomyPolicy) {
    deps.logger.debug({ candidates: candidates.length }, 'dead-skill scan: no autonomy policy, nothing proposed')
    return { proposed: 0, skipped: candidates.length }
  }

  // The built-in enqueue dedup only covers tool_call rows carrying argHash +
  // conversationId + toolName, which a scheduled scan has none of — so without
  // this check the scan would add a duplicate row every week.
  const pending = pendingSkillIds(deps.db)

  let proposed = 0
  let skipped = 0
  for (const c of candidates) {
    if (pending.has(c.id)) { skipped++; continue }
    deps.autonomyPolicy.createApproval({
      category: 'skill.adopt',
      kind: SKILL_DISABLE_KIND,
      inputJson: JSON.stringify({ skillId: c.id, classification: c.category }),
      preview: `Disable skill "${c.name}" — ${c.category}`,
      reason: c.reason,
    })
    proposed++
  }
  deps.logger.info({ proposed, skipped }, 'dead-skill scan complete — proposals only, nothing applied')
  return { proposed, skipped }
}

/**
 * The ONLY apply path. Driven by the `autonomy:approval-resolved` bus event, never by the scan.
 * Returns the skill id it disabled, or null when the event is not ours / not an approval.
 *
 * BLOCKING 2 fix (final review): idempotent with respect to INTENT, not just
 * state. `setEnabled` alone is idempotent, but that only protects the row's
 * final state within a single delivery — it does nothing against the real
 * sequence: owner approves a disable, this handler applies it, the owner
 * later manually RE-ENABLES the skill, and then a bus redelivery of the same
 * already-actioned 'approved' event arrives. Without a claim on the approval
 * itself, that redelivery would call setEnabled(false) again and silently
 * override the owner's explicit re-enable. The CAS UPDATE below claims
 * `consumed_at` on this exact approval row — atomically, and only once, no
 * matter how many times the event redelivers — so only the FIRST delivery
 * of a still-unconsumed 'approved' row ever disables anything.
 */
export function applyDeadSkillApproval(
  deps: Pick<DeadScanDeps, 'db' | 'loader'>,
  event: { approvalId: number; status: string },
): string | null {
  if (event.status !== 'approved') return null
  // Claim on (id, kind, consumed_at) only — not also `status = 'approved'` in
  // the row: this function has never re-checked the row's persisted status
  // against the event's (that's unchanged; routes.ts only ever emits the
  // event after decide() persists a matching status). consumed_at alone is
  // enough for the CAS: it starts NULL, this is the only writer that ever
  // sets it, and it is never cleared — so a second delivery, however it
  // arrives, always finds it already set and no-ops.
  const rows = deps.db.all(sql`UPDATE autonomy_approvals
    SET consumed_at = ${new Date().toISOString()}
    WHERE id = ${event.approvalId} AND kind = ${SKILL_DISABLE_KIND} AND consumed_at IS NULL
    RETURNING input_json`) as { input_json: string | null }[]
  const row = rows[0]
  if (!row) return null
  let parsed: { skillId?: string; classification?: string }
  try { parsed = JSON.parse(row.input_json ?? '{}') } catch { return null }
  if (!parsed.skillId) return null
  deps.loader.setEnabled(parsed.skillId, false, parsed.classification ?? 'dormant', 'detector')
  return parsed.skillId
}
