// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Diagnosis, Incident, Runbook } from '../types.js'

/**
 * Deterministic incident-to-runbook matching.
 *
 * Matching rules (all must pass):
 *  1. `matcher.type` must equal `incident.source`.
 *  2. Every key/value in `matcher.fields` must equal the corresponding entry
 *     in `incident.details` (stringified).
 *  3. If `matcher.regex` is set, it is compiled and tested against
 *     `incident.details[matcher.regexTarget ?? 'summary']` OR against
 *     `incident.summary` when `regexTarget` is 'summary' / missing.
 *
 * The first matching runbook wins. Order of `runbooks` is the caller's
 * responsibility — pass them sorted by specificity (most specific first).
 */
export function matchRunbook(incident: Incident, runbooks: Runbook[]): Runbook | null {
  for (const rb of runbooks) {
    if (rb.matcher.type !== incident.source) continue
    if (!fieldsMatch(incident, rb)) continue
    if (!regexMatches(incident, rb)) continue
    return rb
  }
  return null
}

function fieldsMatch(incident: Incident, rb: Runbook): boolean {
  const fields = rb.matcher.fields ?? {}
  for (const [key, expected] of Object.entries(fields)) {
    const actual = incident.details[key]
    if (actual === undefined) return false
    if (String(actual) !== expected) return false
  }
  return true
}

/**
 * Maximum haystack length for pattern matching — bounded to mitigate
 * pathological matching on very long telemetry strings.
 */
const MAX_PATTERN_HAYSTACK = 4096

/**
 * Simple glob-style matcher for runbook patterns. We intentionally do NOT
 * use `new RegExp()` with runbook-authored strings — full regex grammar is
 * not needed for incident matching, and forbidding it removes an entire
 * class of ReDoS concerns.
 *
 * Supported wildcards:
 *   `*`  — matches any run of characters (including empty)
 *   `?`  — matches exactly one character
 *
 * Any other character is matched literally (case-sensitive). Anchoring is
 * implicit on both ends: the whole haystack must match. Wrap with leading
 * and trailing `*` for substring semantics.
 *
 * Implementation uses a two-pointer algorithm with O(n*m) worst case and
 * constant memory — safe for bounded inputs.
 */
export function globMatch(pattern: string, haystack: string): boolean {
  let pi = 0
  let hi = 0
  let starIdx = -1
  let matchIdx = 0

  while (hi < haystack.length) {
    if (pi < pattern.length && pattern[pi] === '?') {
      pi++
      hi++
    } else if (pi < pattern.length && pattern[pi] === '*') {
      starIdx = pi
      matchIdx = hi
      pi++
    } else if (pi < pattern.length && pattern[pi] === haystack[hi]) {
      pi++
      hi++
    } else if (starIdx !== -1) {
      pi = starIdx + 1
      matchIdx++
      hi = matchIdx
    } else {
      return false
    }
  }

  while (pi < pattern.length && pattern[pi] === '*') pi++
  return pi === pattern.length
}

function regexMatches(incident: Incident, rb: Runbook): boolean {
  if (!rb.matcher.regex) return true
  const pattern = rb.matcher.regex
  if (pattern.length > 512) return false

  const target = rb.matcher.regexTarget ?? 'summary'
  const rawHaystack =
    target === 'summary'
      ? incident.summary
      : typeof incident.details[target] === 'string'
        ? (incident.details[target] as string)
        : String(incident.details[target] ?? '')
  const haystack =
    rawHaystack.length > MAX_PATTERN_HAYSTACK
      ? rawHaystack.slice(0, MAX_PATTERN_HAYSTACK)
      : rawHaystack

  return globMatch(pattern, haystack)
}

/**
 * Render a runbook's diagnosis template using `{{variable}}` placeholders.
 * Variables are resolved against `incident.details` first, then a small set
 * of derived fields (namespace, resource, summary, pod).
 */
export function renderDiagnosis(runbook: Runbook, incident: Incident): string {
  const ctx: Record<string, string> = {
    namespace: incident.namespace,
    resource: incident.resource,
    summary: incident.summary,
    ...flattenForTemplate(incident.details),
  }
  return runbook.diagnosisTemplate.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    const v = ctx[key]
    return v === undefined ? `{{${key}}}` : v
  })
}

function flattenForTemplate(details: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out[`${k}.${k2}`] = String(v2 ?? '')
      }
    } else {
      out[k] = String(v)
    }
  }
  return out
}

export function buildRunbookDiagnosis(runbook: Runbook, incident: Incident): Diagnosis {
  return {
    incidentId: incident.id,
    source: 'runbook',
    rootCause: `Matched runbook '${runbook.id}' for kind=${incident.kind}`,
    runbookId: runbook.id,
    confidence: 0.9,
    explanation: renderDiagnosis(runbook, incident),
  }
}
