// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Cron } from 'croner'

/** The floor scheduleJob() will actually arm an interval trigger at — anything
 *  below this is silently refused, never scheduled. */
export const MIN_INTERVAL_MS = 1000

/** Shorthand schedules mapped to cron expressions. */
export const SCHEDULE_SHORTHANDS: Record<string, string> = {
  daily: '0 9 * * *',
  weekly: '0 9 * * 1',
  monthly: '0 9 1 * *',
  hourly: '0 * * * *',
  weekdays: '0 9 * * 1-5',
}

export function normalizeCron(schedule: string): string {
  return SCHEDULE_SHORTHANDS[schedule.toLowerCase()] ?? schedule
}

export function parseCronFromTriggerConfig(triggerConfig: string, triggerType: string): string | null {
  if (triggerType === 'interval') {
    try {
      const parsed = JSON.parse(triggerConfig)
      if (typeof parsed.intervalMs === 'number' && parsed.intervalMs > 0) return null
    } catch { /* fall through */ }
    return null
  }
  if (triggerType !== 'cron') return null
  try {
    const parsed = JSON.parse(triggerConfig)
    if (typeof parsed.cron === 'string') return normalizeCron(parsed.cron)
    if (typeof parsed.expression === 'string') return normalizeCron(parsed.expression)
  } catch {
    // plain cron string
  }
  return normalizeCron(triggerConfig)
}

export function parseIntervalMs(triggerConfig: string): number | null {
  try {
    const parsed = JSON.parse(triggerConfig)
    if (typeof parsed.intervalMs === 'number' && parsed.intervalMs > 0) return parsed.intervalMs
  } catch {
    const n = Number(triggerConfig)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Compute next run ISO timestamp from now (or fromDate). */
export function computeNextRunAt(
  triggerType: string,
  triggerConfig: string,
  fromDate: Date = new Date(),
  timezone = 'UTC',
): string | null {
  if (triggerType === 'interval') {
    const ms = parseIntervalMs(triggerConfig)
    if (!ms) return null
    return new Date(fromDate.getTime() + ms).toISOString()
  }
  if (triggerType === 'cron') {
    const expr = parseCronFromTriggerConfig(triggerConfig, 'cron')
    if (!expr) return null
    try {
      const cron = new Cron(expr, { timezone, paused: true })
      const next = cron.nextRun(fromDate)
      return next ? next.toISOString() : null
    } catch {
      return null
    }
  }
  return null
}

/** A cron or interval trigger that yields no next run can never fire. Rejecting
 *  it at the API boundary is the only moment the user can still fix the typo —
 *  after creation the job just sits there looking healthy. Non-time triggers
 *  pass through: they legitimately have no next run.
 *
 *  The MIN_INTERVAL_MS floor mirrors scheduler-service.ts's scheduleJob(), which
 *  silently refuses to arm a sub-second interval — computeNextRunAt() alone does
 *  simple date math and does not know about that floor, so it would report a
 *  sub-second interval as schedulable when it never actually arms.
 *
 *  Lives here rather than in routes.ts because /scheduler/jobs is not the only
 *  door into the job table: /scheduler/recurring mirrors a cron job in too, and
 *  a second copy of this rule is exactly how the two would drift apart. */
export function triggerIsSchedulable(triggerType: string, triggerConfig: string): boolean {
  if (triggerType !== 'cron' && triggerType !== 'interval') return true
  if (triggerType === 'interval') {
    const ms = parseIntervalMs(triggerConfig)
    if (!ms || ms < MIN_INTERVAL_MS) return false
  }
  return computeNextRunAt(triggerType, triggerConfig) !== null
}

/** Project future run timestamps for timeline (max N). */
export function projectFutureRuns(
  triggerType: string,
  triggerConfig: string,
  fromMs: number,
  untilMs: number,
  max = 50,
  timezone = 'UTC',
): number[] {
  const out: number[] = []
  if (triggerType === 'interval') {
    const ms = parseIntervalMs(triggerConfig)
    if (!ms) return out
    let t = fromMs
    // Align: if fromMs is "next", start from there
    while (t < untilMs && out.length < max) {
      if (t >= fromMs) out.push(t)
      t += ms
    }
    return out
  }
  if (triggerType === 'cron') {
    const expr = parseCronFromTriggerConfig(triggerConfig, 'cron')
    if (!expr) return out
    try {
      const cron = new Cron(expr, { timezone, paused: true })
      let cursor = new Date(fromMs)
      for (let i = 0; i < max; i++) {
        const next = cron.nextRun(cursor)
        if (!next) break
        const ms = next.getTime()
        if (ms > untilMs) break
        if (ms >= fromMs) out.push(ms)
        cursor = new Date(ms + 1000)
      }
    } catch {
      return out
    }
  }
  return out
}

/** Human-readable schedule label. */
export function formatScheduleLabel(triggerType: string, triggerConfig: string): string {
  if (triggerType === 'manual') return 'Manual'
  if (triggerType === 'event') {
    try {
      const p = JSON.parse(triggerConfig)
      return `Event: ${p.event ?? p.pattern ?? triggerConfig}`
    } catch {
      return `Event: ${triggerConfig}`
    }
  }
  if (triggerType === 'webhook') return 'Webhook'
  if (triggerType === 'interval') {
    const ms = parseIntervalMs(triggerConfig)
    if (!ms) return 'Interval'
    if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`
    if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)}m`
    if (ms < 86_400_000) return `Every ${Math.round(ms / 3_600_000)}h`
    return `Every ${Math.round(ms / 86_400_000)}d`
  }
  const cron = parseCronFromTriggerConfig(triggerConfig, 'cron')
  return cron ?? triggerConfig
}

export function summarizeResult(result: unknown, maxLen = 200): string | null {
  if (result == null) return null
  try {
    const s = typeof result === 'string' ? result : JSON.stringify(result)
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
  } catch {
    return String(result).slice(0, maxLen)
  }
}
