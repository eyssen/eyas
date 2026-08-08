// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Wave 3 — skill curator may only auto-propose adoption when the private
 * eval harness recently passed a minimum bar. Prevents forge/skill-gen from
 * self-poisoning without measurement.
 */

export interface EvalSnapshot {
  /** ISO timestamp of last benchmark run */
  ranAt: string
  passed: number
  failed: number
  errored: number
  avgScore: number
}

export interface CuratorGateConfig {
  /** Minimum avg composite score (0–100). Default 70. */
  minAvgScore?: number
  /** Minimum pass ratio among completed tasks. Default 0.6. */
  minPassRatio?: number
  /** Max age of the snapshot in hours. Default 168 (1 week). */
  maxAgeHours?: number
}

export type CuratorGateResult =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string }

export function evaluateCuratorGate(
  snapshot: EvalSnapshot | null | undefined,
  cfg: CuratorGateConfig = {},
  now: Date = new Date(),
): CuratorGateResult {
  const minAvg = cfg.minAvgScore ?? 70
  const minPass = cfg.minPassRatio ?? 0.6
  const maxAgeH = cfg.maxAgeHours ?? 168

  if (!snapshot) {
    return { allowed: false, reason: 'No eval snapshot — run benchmarks before skill auto-adoption' }
  }

  const ageH = (now.getTime() - Date.parse(snapshot.ranAt)) / 3600_000
  if (!Number.isFinite(ageH) || ageH > maxAgeH) {
    return { allowed: false, reason: `Eval snapshot too old (${ageH.toFixed(1)}h > ${maxAgeH}h)` }
  }

  const total = snapshot.passed + snapshot.failed + snapshot.errored
  if (total === 0) {
    return { allowed: false, reason: 'Eval snapshot has zero tasks' }
  }

  const passRatio = snapshot.passed / total
  if (passRatio < minPass) {
    return {
      allowed: false,
      reason: `Pass ratio ${passRatio.toFixed(2)} < ${minPass} (${snapshot.passed}/${total})`,
    }
  }

  if (snapshot.avgScore < minAvg) {
    return {
      allowed: false,
      reason: `Avg score ${snapshot.avgScore.toFixed(1)} < ${minAvg}`,
    }
  }

  return {
    allowed: true,
    reason: `Eval OK: avg=${snapshot.avgScore.toFixed(1)} pass=${snapshot.passed}/${total}`,
  }
}
