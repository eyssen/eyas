// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MetricFamily, ScrapeOptions, ScrapeResult } from './types.js'
import type { Registry } from './registry.js'

/** Default max response size for /metrics (10 MB). */
export const DEFAULT_MAX_SCRAPE_BYTES = 10 * 1024 * 1024

/**
 * Escape a label value per the Prometheus exposition format v0.0.4:
 *  - backslash → \\
 *  - double-quote → \"
 *  - newline → \n
 */
export function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * Escape HELP text per the exposition format:
 *  - backslash → \\
 *  - newline → \n
 * (quotes are NOT escaped in HELP)
 */
export function escapeHelp(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

/**
 * Format a single numeric value in the way Prometheus expects.
 * Handles +Inf/-Inf/NaN as required by the text format.
 */
export function formatValue(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Infinity) return '+Inf'
  if (v === -Infinity) return '-Inf'
  // Integers are emitted without a decimal point; floats keep precision.
  if (Number.isInteger(v)) return String(v)
  return String(v)
}

function formatLabels(labels: Record<string, string>, extra?: Record<string, string>): string {
  const keys = Object.keys(labels).sort()
  const parts: string[] = []
  for (const k of keys) {
    parts.push(`${k}="${escapeLabelValue(labels[k])}"`)
  }
  if (extra) {
    for (const k of Object.keys(extra).sort()) {
      parts.push(`${k}="${escapeLabelValue(extra[k])}"`)
    }
  }
  if (parts.length === 0) return ''
  return `{${parts.join(',')}}`
}

/**
 * Format a single metric family into Prometheus text.
 */
export function formatFamily(family: MetricFamily): string {
  const lines: string[] = []
  lines.push(`# HELP ${family.name} ${escapeHelp(family.help)}`)
  lines.push(`# TYPE ${family.name} ${family.type}`)

  if (family.type === 'histogram' && family.histogramSamples) {
    for (const h of family.histogramSamples) {
      // Emit bucket lines, sorted by bound (+Inf last).
      const bucketKeys = Object.keys(h.buckets)
      bucketKeys.sort((a, b) => {
        if (a === '+Inf') return 1
        if (b === '+Inf') return -1
        return Number(a) - Number(b)
      })
      for (const b of bucketKeys) {
        const lv = formatLabels(h.labels, { le: b })
        lines.push(`${family.name}_bucket${lv} ${formatValue(h.buckets[b])}`)
      }
      lines.push(`${family.name}_sum${formatLabels(h.labels)} ${formatValue(h.sum)}`)
      lines.push(`${family.name}_count${formatLabels(h.labels)} ${formatValue(h.count)}`)
    }
  } else {
    for (const s of family.samples) {
      const ts = s.timestamp !== undefined ? ` ${s.timestamp}` : ''
      lines.push(`${family.name}${formatLabels(s.labels)} ${formatValue(s.value)}${ts}`)
    }
  }

  return lines.join('\n')
}

/**
 * Scrape a registry and produce a Prometheus-text exposition, respecting
 * the `maxBytes` cap. If the cap is hit, the output is truncated at a
 * family boundary and `truncated` is set to true.
 */
export function scrape(registry: Registry, opts: ScrapeOptions = {}): ScrapeResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_SCRAPE_BYTES
  const families = registry.collect()
  // Keep the order deterministic (by name) for stable scrape output.
  families.sort((a, b) => a.name.localeCompare(b.name))

  let out = ''
  let familyCount = 0
  let truncated = false

  for (const fam of families) {
    const block = formatFamily(fam) + '\n'
    const candidate = out.length === 0 ? block : out + block
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      truncated = true
      break
    }
    out = candidate
    familyCount += 1
  }

  return {
    text: out,
    familyCount,
    byteSize: Buffer.byteLength(out, 'utf8'),
    truncated,
  }
}
