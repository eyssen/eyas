// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Deterministic promotion rules between memory tiers.
 *
 * These are pure functions over row-like inputs so they can be unit-tested
 * without a real database. The consolidator index wires them to the live
 * memory services.
 *
 * LLM-assisted semantic promotion (e.g. summarising a cluster of episodic
 * rows into a single vault note) is OUT OF SCOPE for Phase 3C and left as a
 * TODO for a later phase.
 */

import type { WorkingMemoryBlock, EpisodicMemory } from '../types.js'
import type { PromotionRuleConfig } from './types.js'

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

// --- working → episodic ------------------------------------------------------

/**
 * Parse an "importance" score from a working-memory block.
 *
 * Working memory is stored as { key, content } — callers typically encode
 * structured content as JSON ({ text, importance }). If the content isn't
 * JSON, or importance is missing, we default to 0 (so the rule falls back to
 * pure access-count).
 *
 * Callers that want to flag a block as "promote even with low access count"
 * should write JSON content like:
 *
 *     memory.working.set('key', JSON.stringify({
 *       text: 'The actual payload',
 *       importance: 8,   // 0..10; >= workingMinImportance (default 7) triggers promotion
 *     }))
 *
 * Plain-string content always parses to importance=0, meaning promotion is
 * driven solely by access count. This is the default path for most writers.
 */
export function parseImportance(content: string): number {
  try {
    const parsed = JSON.parse(content)
    const imp = parsed?.importance
    if (typeof imp === 'number' && Number.isFinite(imp)) return imp
  } catch {
    /* not JSON, that's fine */
  }
  return 0
}

/**
 * working → episodic eligibility.
 *
 * Rule: age(block) > workingMinAgeHours AND
 *       (accessCount >= workingMinAccess OR importance >= workingMinImportance)
 */
export function isWorkingEligibleForEpisodic(
  block: WorkingMemoryBlock,
  config: PromotionRuleConfig,
  now: number = Date.now()
): boolean {
  const createdMs = new Date(block.createdAt).getTime()
  const ageHours = (now - createdMs) / MS_PER_HOUR
  if (ageHours < config.workingMinAgeHours) return false

  const accessOk = block.accessCount >= config.workingMinAccess
  const importance = parseImportance(block.content)
  const importanceOk = importance >= config.workingMinImportance
  return accessOk || importanceOk
}

// --- episodic → semantic -----------------------------------------------------

/**
 * Group episodic memories by a normalised content fingerprint.
 *
 * The Phase 3C rule says a memory is "recurrent" when it appears in N
 * episodic rows. Without embeddings we use a cheap fingerprint: lowercase +
 * collapse whitespace + trim. Phase 3E will swap this for a vector-based
 * clustering step.
 */
export function fingerprintEpisodic(content: string, agentId?: string | null): string {
  const base = content.trim().toLowerCase().replace(/\s+/g, ' ')
  // Agent-scoped fingerprint: agent A's memories never cluster with agent B's.
  // Shared (agent_id IS NULL) memories cluster among themselves.
  const scope = agentId ?? '__shared__'
  return `${scope}::${base}`
}

export interface EpisodicCluster {
  fingerprint: string
  members: EpisodicMemory[]
  mostRecentAccessMs: number
}

export function clusterEpisodicByFingerprint(memories: EpisodicMemory[]): EpisodicCluster[] {
  const buckets = new Map<string, EpisodicMemory[]>()
  for (const m of memories) {
    const fp = fingerprintEpisodic(m.content, m.agentId)
    const existing = buckets.get(fp)
    if (existing) existing.push(m)
    else buckets.set(fp, [m])
  }

  const out: EpisodicCluster[] = []
  for (const [fingerprint, members] of buckets) {
    const mostRecentAccessMs = members.reduce((acc, m) => {
      const t = m.lastAccessedAt ? new Date(m.lastAccessedAt).getTime() : new Date(m.createdAt).getTime()
      return t > acc ? t : acc
    }, 0)
    out.push({ fingerprint, members, mostRecentAccessMs })
  }
  return out
}

/**
 * episodic → semantic eligibility.
 *
 * Rule: >= episodicRecurrenceCount members in the same fingerprint cluster,
 * AND the most-recently-accessed member was touched within
 * episodicMaxLastAccessedDays days.
 */
export function isClusterEligibleForSemantic(
  cluster: EpisodicCluster,
  config: PromotionRuleConfig,
  now: number = Date.now()
): boolean {
  if (cluster.members.length < config.episodicRecurrenceCount) return false
  const daysSinceAccess = (now - cluster.mostRecentAccessMs) / MS_PER_DAY
  return daysSinceAccess <= config.episodicMaxLastAccessedDays
}

// --- semantic tombstone ------------------------------------------------------

/**
 * Semantic vault entries that haven't been touched in a long time should be
 * marked "archived" (tombstone), NOT deleted. The vault files stay on disk so
 * they can be revived if a future query surfaces them.
 *
 * TODO(phase-3D): Actual vault read/write is owned by VaultService. For
 * Phase 3C we only return the list of paths that SHOULD be tombstoned; the
 * index.ts caller decides whether/how to apply.
 */
export interface VaultIndexRow {
  path: string
  indexedAt: string
  lastAccessedAt?: string | null
}

export function findSemanticTombstoneCandidates(
  rows: VaultIndexRow[],
  config: PromotionRuleConfig,
  now: number = Date.now()
): VaultIndexRow[] {
  const cutoff = now - config.semanticTombstoneDays * MS_PER_DAY
  return rows.filter((r) => {
    const lastRef = r.lastAccessedAt ?? r.indexedAt
    return new Date(lastRef).getTime() < cutoff
  })
}
