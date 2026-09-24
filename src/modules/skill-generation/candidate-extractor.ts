// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { generateId } from '@shared/crypto'
import type {
  AgentTrace,
  SkillCandidate,
  ToolBinding,
  TraceToolCall,
} from './types.js'

/**
 * Candidate extractor — Phase 3J.
 *
 * Takes a set of agent traces and derives skill candidates. A candidate is
 * emitted when N ≥ config.minObservations successful traces share the same
 * tool chain (ordered sequence of tool names). The slug is derived from
 * the chain; triggers are mined from user-goal prompts.
 *
 * This is richer than the consolidator's stub (phase 3C) which only detected
 * "long enough" successful traces without grouping.
 */
export interface ExtractorConfig {
  /** Minimum number of matching traces before a candidate is emitted. */
  minObservations: number
  /** Minimum tool-call count per trace — short traces rarely contain skills. */
  minToolCalls: number
  /** Minimum aggregated success rate (0..1). */
  minSuccessRate: number
}

export const DEFAULT_EXTRACTOR_CONFIG: ExtractorConfig = {
  minObservations: 3,
  minToolCalls: 3,
  minSuccessRate: 0.8,
}

/** Normalise a tool chain to a stable canonical key. */
export function canonicalChainKey(calls: TraceToolCall[]): string {
  return calls
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((c) => c.toolName)
    .join(' > ')
}

/** Slugify a chain key into a filesystem-safe name. */
export function slugifyChain(chainKey: string): string {
  return (
    chainKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unnamed-skill'
  )
}

/** Mine short trigger phrases from user-goal strings (very simple heuristic). */
export function mineTriggers(goals: string[]): string[] {
  const uniq = new Set<string>()
  for (const g of goals) {
    if (!g) continue
    const trimmed = g.trim().slice(0, 120)
    if (trimmed.length > 3) uniq.add(trimmed)
  }
  return Array.from(uniq).slice(0, 8)
}

/**
 * Build a tool-binding list from the first successful trace in a group.
 * Tool input shapes are recorded as-is; a downstream step can refine them.
 */
export function bindingsFromTrace(trace: AgentTrace): ToolBinding[] {
  const seen = new Set<string>()
  const bindings: ToolBinding[] = []
  for (const call of [...trace.toolCalls].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(call.toolName)) continue
    seen.add(call.toolName)
    const schema: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(call.input)) {
      schema[k] = typeof v
    }
    bindings.push({ toolName: call.toolName, schema })
  }
  return bindings
}

export function createCandidateExtractor(config: ExtractorConfig = DEFAULT_EXTRACTOR_CONFIG) {
  return {
    extract(
      traces: AgentTrace[],
      proposedBy: SkillCandidate['proposedBy'] = 'sleep-time-consolidator',
      now: number = Date.now(),
    ): SkillCandidate[] {
      // Group eligible traces by canonical chain key.
      const groups = new Map<string, AgentTrace[]>()
      for (const t of traces) {
        if (t.outcome !== 'success') continue
        if (t.toolCalls.length < config.minToolCalls) continue
        const key = canonicalChainKey(t.toolCalls)
        if (!key) continue
        const arr = groups.get(key)
        if (arr) arr.push(t)
        else groups.set(key, [t])
      }

      const out: SkillCandidate[] = []
      for (const [key, group] of groups) {
        if (group.length < config.minObservations) continue

        const successes = group.filter((t) => t.outcome === 'success').length
        const successRate = successes / group.length
        if (successRate < config.minSuccessRate) continue

        const avgTurns =
          group.reduce((acc, t) => acc + t.turns, 0) / group.length
        const avgCost =
          group.reduce((acc, t) => acc + (t.costUsd ?? 0), 0) / group.length

        const slug = slugifyChain(key)
        const triggers = mineTriggers(group.map((t) => t.userGoal ?? ''))
        const firstTrace = group[0]!
        const toolChain = bindingsFromTrace(firstTrace)

        out.push({
          id: generateId(),
          fromSessionIds: group.map((t) => t.sessionId),
          pattern: {
            name: slug,
            description: `Auto-extracted pattern covering ${toolChain.length} tools: ${toolChain
              .map((b) => b.toolName)
              .join(', ')}`,
            triggers,
            toolChain,
          },
          observations: {
            timesObserved: group.length,
            averageTurns: Number(avgTurns.toFixed(2)),
            averageCost: Number(avgCost.toFixed(4)),
            successRate: Number(successRate.toFixed(3)),
          },
          proposedBy,
          createdAt: now,
        })
      }
      return out
    },
  }
}

export type CandidateExtractor = ReturnType<typeof createCandidateExtractor>
