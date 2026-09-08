// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { tallyVotes } from './vote.js'
import type {
  GodModeDecision,
  GodModeParticipant,
  GodModeRun,
  GodModeTimelineEvent,
} from './types.js'

/**
 * Rebuild a decision from stored votes / winner when an older run predates
 * the `decision` column.
 */
export function synthesizeDecision(
  run: GodModeRun,
  participants: GodModeParticipant[],
): GodModeDecision | null {
  const completed = participants.filter((p) => p.status === 'completed')
  const winner = participants.find((p) => p.id === run.winnerParticipantId)
  if (!winner && completed.length === 0) return null

  if (completed.length === 1) {
    return {
      method: 'sole-survivor',
      winnerSlotId: completed[0]!.slotId,
      tieBroken: false,
      chairSlotId: run.chairParticipantId,
      votes: [],
      counts: {},
    }
  }

  const votes = completed.map((p) => ({ slotId: p.slotId, voteFor: p.voteFor }))
  const completedAtBySlot: Record<string, string> = {}
  for (const p of completed) {
    if (p.completedAt) completedAtBySlot[p.slotId] = p.completedAt
  }
  const tallied = tallyVotes(votes, run.chairParticipantId, completedAtBySlot)

  let method: GodModeDecision['method']
  let winnerSlotId = tallied.winnerSlotId
  let tieBroken = tallied.tieBroken

  if (!winnerSlotId) {
    if (!winner) return null
    winnerSlotId = winner.slotId
    tieBroken = run.tieBroken
    if (run.tieBroken && run.chairParticipantId === winner.slotId) method = 'chair'
    else if (run.tieBroken) method = 'earliest-completed'
    else method = completed.length === 1 ? 'sole-survivor' : 'majority'
  } else if (tallied.method === 'none') {
    method = 'earliest-completed'
  } else {
    method = tallied.method
  }

  return {
    method,
    winnerSlotId,
    tieBroken,
    chairSlotId: run.chairParticipantId,
    votes: completed.map((p) => ({ fromSlotId: p.slotId, voteFor: p.voteFor })),
    counts: tallied.counts,
  }
}

/**
 * Coarse step log from timestamps when an older run has no stored timeline.
 */
export function synthesizeTimeline(
  run: GodModeRun,
  participants: GodModeParticipant[],
): GodModeTimelineEvent[] {
  const events: GodModeTimelineEvent[] = [
    { at: run.createdAt, phase: 'preparing', key: 'started', slotId: null },
    { at: run.createdAt, phase: 'racing', key: 'racing', slotId: null },
  ]

  const finished = [...participants]
    .filter((p) => p.completedAt && (p.status === 'completed' || p.status === 'failed'))
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))

  for (const p of finished) {
    events.push({
      at: p.completedAt!,
      phase: 'racing',
      key: p.status === 'failed' ? 'worker-failed' : 'worker-done',
      slotId: p.slotId,
    })
  }

  const lastWorkerAt = finished.at(-1)?.completedAt ?? run.createdAt
  const hasReview = participants.some((p) => p.voteFor || p.reviewSummary || p.scores)
  if (hasReview) {
    events.push({ at: lastWorkerAt, phase: 'reviewing', key: 'reviewing', slotId: null })
  }

  const winner = participants.find((p) => p.id === run.winnerParticipantId)
  const decidedAt = run.completedAt ?? lastWorkerAt
  if (winner) {
    events.push({ at: decidedAt, phase: 'deciding', key: 'decided', slotId: winner.slotId })
    if (run.isolation !== 'none') {
      events.push({ at: decidedAt, phase: 'promoting', key: 'promoting', slotId: null })
    }
  }

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    events.push({
      at: run.completedAt ?? decidedAt,
      phase: run.status,
      key: run.status,
      slotId: null,
    })
  }

  return events
}

/** Fill decision + timeline so the God tab can render older runs. */
export function presentGodRun(
  run: GodModeRun,
  participants: GodModeParticipant[],
): GodModeRun {
  return {
    ...run,
    decision: run.decision ?? synthesizeDecision(run, participants),
    timeline: run.timeline.length > 0 ? run.timeline : synthesizeTimeline(run, participants),
  }
}
