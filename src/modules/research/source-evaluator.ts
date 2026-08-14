// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModelGateway } from '@modules/model/types.js'
import type { SearchResult, EvaluatedSource } from './types.js'
import { safeFetch, type SsrfCheckOptions } from './ssrf-guard.js'

/** Strip HTML tags and collapse whitespace */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
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

/** Use AI to score source relevance to the research query */
export async function evaluateSources(
  model: ModelGateway,
  query: string,
  results: SearchResult[],
): Promise<EvaluatedSource[]> {
  if (results.length === 0) return []

  const sourceSummary = results
    .map((r, i) => `[${i}] "${r.title}" — ${r.snippet}`)
    .join('\n')

  const response = await model.complete({
    messages: [
      {
        role: 'user',
        content: `You are evaluating web search results for relevance to a research query.

Query: "${query}"

Sources:
${sourceSummary}

For each source index, respond with a JSON array of objects with "index" (number) and "relevance" (number 0-1).
Score based on how useful each source would be for answering the query.
Respond ONLY with the JSON array, no other text.`,
      },
    ],
    maxTokens: 1024,
    temperature: 0,
  })

  const text = typeof response.content[0] === 'object' && response.content[0].type === 'text'
    ? response.content[0].text
    : ''

  try {
    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) throw new Error('No JSON array in response')
    const scores = JSON.parse(jsonMatch[0]) as Array<{ index: number; relevance: number }>

    return results.map((r, i) => {
      const score = scores.find((s) => s.index === i)
      return {
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        relevance: score?.relevance ?? 0,
      }
    })
  } catch {
    // Fallback: assign uniform mid-range scores
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      relevance: 0.5,
    }))
  }
}
