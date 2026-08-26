// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ReviewVerdict } from './types.js'

const reviewSchema = z
  .object({
    voteFor: z.string().min(1),
    scores: z.object({
      quality: z.number().int().min(1).max(5),
      completeness: z.number().int().min(1).max(5),
      risk: z.number().int().min(1).max(5),
    }),
    uniqueInsights: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    summary: z.string().default(''),
  })
  .passthrough()

/**
 * Parse a peer-review model response into a ReviewVerdict.
 * Extracts the first `{...}` if wrapped in prose. Failure → null (fail-open).
 */
export function parseReviewJson(raw: string): ReviewVerdict | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let candidate = trimmed
  if (trimmed[0] !== '{') {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) return null
    candidate = trimmed.slice(firstBrace, lastBrace + 1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    return null
  }

  const result = reviewSchema.safeParse(parsed)
  if (!result.success) return null

  const { voteFor, scores, uniqueInsights, risks, summary } = result.data
  return { voteFor, scores, uniqueInsights, risks, summary }
}
