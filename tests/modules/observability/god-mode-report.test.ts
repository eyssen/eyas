// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createGodModeStore } from '@modules/agent/god-mode/store'
import { listGodModeRuns, summarizeGodMode } from '@modules/observability/god-mode-report'
import type { GodModeParticipantSpec } from '@modules/agent/god-mode/types'
import type { GodModeStore } from '@modules/agent/god-mode/store'

const roster: GodModeParticipantSpec[] = [
  { id: 'a', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
  { id: 'b', providerId: 'openai', modelId: 'gpt-4o' },
  { id: 'c', providerId: 'xai', modelId: 'grok-4' },
]

let db: ReturnType<typeof createMemoryDb>
let store: GodModeStore

beforeEach(() => {
  db = createMemoryDb()
  store = createGodModeStore(db)
})

function seedCompletedRun(
  conversationId: string,
  winnerSlot: string,
  costs: [number, number, number],
  totalCostUsd: number,
  durationMs: number,
) {
  const run = store.insertRun({
    conversationId,
    userMessageId: 1,
    chairParticipantId: 'a',
    participantsSnapshot: roster,
    isolation: 'none',
    sourceWorkingDirectory: null,
  })
  const parts = roster.map((spec, i) => {
    const p = store.insertParticipant({
      runId: run.id,
      slotId: spec.id,
      providerId: spec.providerId,
      modelId: spec.modelId,
    })
    store.updateParticipant(p.id, { status: 'completed', costUsd: costs[i] })
    return p
  })
  const winner = parts.find((p) => p.slotId === winnerSlot)!
  store.updateRun(run.id, {
    status: 'completed',
    winnerParticipantId: winner.id,
    totalCostUsd,
    durationMs,
    completedAt: new Date().toISOString(),
  })
  return run
}

describe('god-mode-report', () => {
  it('two completed runs produce winRate rows and a cost-multiple > 1', () => {
    seedCompletedRun('conv-1', 'a', [1, 2, 3], 6, 1000)
    seedCompletedRun('conv-2', 'b', [1, 2, 3], 6, 2000)

    const summary = summarizeGodMode(db)

    expect(summary.runs).toBe(2)
    expect(summary.totalCostUsd).toBe(12)
    expect(summary.avgDurationMs).toBe(1500)
    // 6/1 + 6/2 = 6 + 3 → mean 4.5
    expect(summary.avgCostMultiple).toBeGreaterThan(1)
    expect(summary.avgCostMultiple).toBeCloseTo(4.5)

    const anthropic = summary.winRate.find((r) => r.providerId === 'anthropic' && r.modelId === 'claude-sonnet-4-6')
    const openai = summary.winRate.find((r) => r.providerId === 'openai' && r.modelId === 'gpt-4o')
    const xai = summary.winRate.find((r) => r.providerId === 'xai' && r.modelId === 'grok-4')
    expect(anthropic).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4-6', wins: 1, runs: 2 })
    expect(openai).toEqual({ providerId: 'openai', modelId: 'gpt-4o', wins: 1, runs: 2 })
    expect(xai).toEqual({ providerId: 'xai', modelId: 'grok-4', wins: 0, runs: 2 })

    const listed = listGodModeRuns(db, { limit: 10, offset: 0 })
    expect(listed.total).toBe(2)
    expect(listed.runs).toHaveLength(2)
  })
})
