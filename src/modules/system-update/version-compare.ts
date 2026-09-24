// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Lightweight semver-ish compare for EYAS tags (e.g. 0.8.4-beta, v0.8.5-beta).
 * Pre-release is considered lower than the same core without pre-release.
 */

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '')
}

export interface ParsedVersion {
  core: number[]
  pre: string | null
}

export function parseVersion(raw: string): ParsedVersion {
  const n = normalizeVersion(raw)
  const [corePart, ...preParts] = n.split('-')
  const core = corePart.split('.').map((p) => {
    const num = parseInt(p.replace(/[^0-9].*$/, ''), 10)
    return Number.isFinite(num) ? num : 0
  })
  while (core.length < 3) core.push(0)
  const pre = preParts.length > 0 ? preParts.join('-') : null
  return { core, pre }
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  const len = Math.max(pa.core.length, pb.core.length)
  for (let i = 0; i < len; i++) {
    const da = pa.core[i] ?? 0
    const db = pb.core[i] ?? 0
    if (da !== db) return da - db
  }
  // No pre > has pre (1.0.0 > 1.0.0-beta)
  if (pa.pre === null && pb.pre !== null) return 1
  if (pa.pre !== null && pb.pre === null) return -1
  if (pa.pre === null && pb.pre === null) return 0
  return pa.pre!.localeCompare(pb.pre!)
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
