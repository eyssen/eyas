// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { SearchResult, EvaluatedSource, ResearchAux } from './types.js'
import { safeFetch, type SsrfCheckOptions } from './ssrf-guard.js'
import { createSourceFence, parseJsonArray } from './model-io.js'

/** Strip HTML tags and collapse whitespace. Exported for testing. */
export function stripHtml(html: string): string {
  return html
    // Comments first: a tag hidden inside one would otherwise survive the
    // element passes and reappear as text.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Parsers accept anything up to the bracket in an end tag - "</script >"
    // and even "</script foo>" both close the element - so a stripper that
    // insists on "</script>" leaves the body behind as visible text.
    .replace(/<script\b[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style[^>]*>/gi, ' ')
    // An unterminated tag at the end of a truncated page would otherwise keep
    // its contents; treat "< up to the end" as a tag too.
    .replace(/<[^>]*>|<[^>]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetch and extract main content from a URL.
 *
 * Goes through the SSRF guard first — search results come from untrusted
 * sources, so a prompt-injected result URL pointing at `169.254.169.254`
 * (cloud metadata) or `127.0.0.1` (internal service) must be rejected
 * before the fetch ever happens. `ssrfOptions` is a test seam; production
 * callers pass no options and get the secure default (HTTPS only, no
 * private IPs, 5s DNS timeout).
 *
 * Returns an empty string on any failure so a single bad URL can't abort
 * a research pass — the caller scores the source by content length and
 * will simply ignore empty ones.
 */
export async function extractContent(
  url: string,
  ssrfOptions?: SsrfCheckOptions,
): Promise<string> {
  try {
    // safeFetch runs the SSRF guard up-front AND re-validates every redirect
    // hop (redirect:'manual'), so a public URL cannot 302 to an internal
    // target. It throws SsrfError on any blocked hop. Silent drop on any
    // failure — research is best-effort per source.
    const res = await safeFetch(
      url,
      {
        headers: { 'User-Agent': 'EYAS-Research/1.0' },
        signal: AbortSignal.timeout(10_000),
      },
      ssrfOptions,
    )
    if (!res.ok) return ''
    const html = await res.text()
    const text = stripHtml(html)
    return text.slice(0, 5000)
  } catch {
    return ''
  }
}

const ScoresSchema = z.array(z.object({
  index: z.number().int().nonnegative(),
  relevance: z.number().finite(),
}))

/**
 * Deterministic relevance when no model scores the sources: the search order,
 * 1 - i/n, with the first `topN` lifted to at least 0.5 so they pass the
 * engine's relevance cut.
 */
export function orderBasedRelevance(index: number, total: number, topN: number): number {
  const byOrder = total > 0 ? 1 - index / total : 0
  return index < topN ? Math.max(0.5, byOrder) : byOrder
}

/**
 * Score source relevance to the research query with the background model.
 * Titles and snippets are untrusted web text and travel inside a per-call
 * fence. Without a model answer (none, error, or an unusable reply) the
 * scores fall back to the search order.
 */
export async function evaluateSources(
  aux: ResearchAux,
  query: string,
  results: SearchResult[],
  topN: number,
): Promise<EvaluatedSource[]> {
  if (results.length === 0) return []

  const byOrder = () => results.map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    relevance: orderBasedRelevance(i, results.length, topN),
  }))

  const fence = createSourceFence()
  const sourceSummary = results
    .map((r, i) => `[${i}] "${r.title}" — ${r.snippet}`)
    .join('\n')

  const result = await aux.complete({
    purpose: 'research',
    system: `You are evaluating web search results for relevance to a research query.

${fence.rule}

For each source index, respond with a JSON array of objects with "index" (number) and "relevance" (number 0-1).
Score based on how useful each source would be for answering the query.
Respond ONLY with the JSON array, no other text.`,
    user: `Research query: ${query}

Sources:
${fence.wrap(sourceSummary)}

Respond ONLY with the JSON array of {"index","relevance"} objects.`,
    maxTokens: 1024,
    temperature: 0,
  })
  if (!result.ok) return byOrder()
  const scores = parseJsonArray(result.text, ScoresSchema)
  if (!scores) return byOrder()

  return results.map((r, i) => {
    const score = scores.find((s) => s.index === i)
    return {
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      relevance: score ? Math.min(1, Math.max(0, score.relevance)) : 0,
    }
  })
}
