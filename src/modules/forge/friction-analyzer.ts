// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { FrictionPattern, ForgeConfig } from './types.js'
import type { createFeedbackCollector } from './feedback-collector.js'

type FeedbackCollector = ReturnType<typeof createFeedbackCollector>

function topStrings(items: (string | null)[], n: number): string[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item) continue
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([str]) => str)
}

export function createFrictionAnalyzer(collector: FeedbackCollector, config: ForgeConfig) {
  return {
    analyze(): FrictionPattern[] {
      const targets = collector.listAnalyzableTargets(config.minFeedbacksForAnalysis, config.analysisWindowDays)
      const patterns: FrictionPattern[] = []
      for (const { target, targetId } of targets) {
        const stats = collector.getStats(target, targetId)
        if (stats.frictionRate < config.frictionRateThreshold) continue
        const feedbacks = collector.listForTarget(target, targetId, 50)
        patterns.push({
          target, targetId, frictionCount: stats.frictionCount, totalUsages: stats.total,
          frictionRate: stats.frictionRate,
          topFrictions: topStrings(feedbacks.map(f => f.friction), 5),
          topSuggestions: topStrings(feedbacks.map(f => f.betterApproach), 5),
          sampleFeedbackIds: feedbacks.slice(0, 5).map(f => f.id),
        })
      }
      return patterns.slice(0, config.maxProposalsPerRun)
    },
  }
}
