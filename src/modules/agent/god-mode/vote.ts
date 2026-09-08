// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Majority vote over peer reviews. Self-votes and null votes are discarded.
 * Tie → chair if among the tied; else earliest completedAt among the tied.
 */
export type TallyMethod = 'majority' | 'chair' | 'earliest-completed' | 'none'

export interface TallyResult {
  winnerSlotId: string | null
  tieBroken: boolean
  method: TallyMethod
  counts: Record<string, number>
}

function toCounts(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of map) out[k] = v
  return out
}

export function tallyVotes(
  votes: Array<{ slotId: string; voteFor: string | null }>,
  chairSlotId: string | null,
  completedAtBySlot: Record<string, string>,
): TallyResult {
  const counts = new Map<string, number>()

  for (const { slotId, voteFor } of votes) {
    if (voteFor == null || voteFor === slotId) continue
    counts.set(voteFor, (counts.get(voteFor) ?? 0) + 1)
  }

  const countObj = toCounts(counts)
  if (counts.size === 0) {
    return { winnerSlotId: null, tieBroken: false, method: 'none', counts: countObj }
  }

  let max = 0
  for (const n of counts.values()) {
    if (n > max) max = n
  }

  const tied: string[] = []
  for (const [slot, n] of counts) {
    if (n === max) tied.push(slot)
  }

  if (tied.length === 1) {
    return { winnerSlotId: tied[0]!, tieBroken: false, method: 'majority', counts: countObj }
  }

  if (chairSlotId != null && tied.includes(chairSlotId)) {
    return { winnerSlotId: chairSlotId, tieBroken: true, method: 'chair', counts: countObj }
  }

  let earliest = tied[0]!
  let earliestAt = completedAtBySlot[earliest] ?? '\uffff'
  for (let i = 1; i < tied.length; i++) {
    const slot = tied[i]!
    const at = completedAtBySlot[slot] ?? '\uffff'
    if (at < earliestAt) {
      earliest = slot
      earliestAt = at
    }
  }

  return { winnerSlotId: earliest, tieBroken: true, method: 'earliest-completed', counts: countObj }
}

/**
 * Union of non-winner uniqueInsights, case-insensitive trim de-dupe,
 * excluding anything that appears (case-insensitive) in the winner's list.
 */
export function harvestInsights(
  reviews: Array<{ slotId: string; uniqueInsights: string[] }>,
  winnerSlotId: string,
): string[] {
  const winnerReview = reviews.find((r) => r.slotId === winnerSlotId)
  const winnerKeys = new Set(
    (winnerReview?.uniqueInsights ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
  )

  const seen = new Set<string>()
  const out: string[] = []

  for (const review of reviews) {
    if (review.slotId === winnerSlotId) continue
    for (const raw of review.uniqueInsights) {
      const trimmed = raw.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (winnerKeys.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push(trimmed)
    }
  }

  return out
}
