// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext } from '@core/types'
import type { TraceCollector } from './trace-collector.js'

/**
 * Auto-score a trace using a cheap model.
 * Sends a "Rate this response 0-1" prompt and stores the score.
 * Only runs if observability.autoScore is enabled in config.
 */
export async function autoScoreTrace(
  traceId: string,
  responseText: string,
  collector: TraceCollector,
  ctx: ModuleContext,
  evaluatorModel?: string,
): Promise<number | null> {
  try {
    const model = evaluatorModel ?? 'claude-3-5-haiku-20241022'

    const response = await ctx.model.complete({
      model,
      messages: [
        {
          role: 'user',
          content: `Rate the quality of this AI response on a scale from 0.0 to 1.0, where 0 is completely unhelpful/wrong and 1 is perfect. Reply with ONLY a number.\n\nResponse to evaluate:\n${responseText.slice(0, 2000)}`,
        },
      ],
      maxTokens: 10,
      temperature: 0,
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text)
      .join('')
      .trim()

    const score = parseFloat(text)
    if (isNaN(score) || score < 0 || score > 1) return null

    collector.updateAutoScore(traceId, score, model)
    return score
  } catch (err) {
    ctx.logger.warn({ err, traceId }, 'Auto-scoring failed')
    return null
  }
}

/**
 * Record user feedback on a trace.
 */
export function recordUserFeedback(
  traceId: string,
  score: 'good' | 'bad',
  collector: TraceCollector,
): void {
  collector.updateFeedback(traceId, score)
}
