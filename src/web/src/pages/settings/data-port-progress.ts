// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// An import of a whole home directory runs for minutes. What the owner is owed
// while it does — how far it has got, how long it has taken, how long is left —
// is derived here from the job row alone. No clock of its own: the caller
// passes `nowMs`, so the same row always yields the same summary in a test.

import { t, tOr } from './i18n'
import type { ImportJobStats } from './data-port-types'

/**
 * The part of an `ImportJob` a progress summary reads. A real job satisfies it;
 * so does a job row from a server that predates some of these fields.
 */
export interface ProgressJobLike {
  status?: string
  phase?: string
  progress?: number
  createdAt: string
  startedAt?: string | null
  finishedAt?: string | null
  /** Wall time of the run itself, written by the runner when the job finishes. */
  importMs?: number | null
  stats?: Partial<ImportJobStats> | null
}

export interface ProgressSummary {
  processed: number
  total: number
  /** 0…100. */
  pct: number
  elapsedMs: number
  /** `null` until the measured rate means anything (P: 20 items) or the total is unknown. */
  etaMs: number | null
  ratePerMin: number
}

/** Items processed before the measured rate is worth showing as an estimate. */
const ETA_MIN_PROCESSED = 20

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * How long the job has been running — the time it SPENT, never the wall-clock
 * gap around it.
 *
 * A finished job is measured to its own finish, not to now, so the done screen
 * stops counting up. It reports the runner's own `importMs` first and
 * `finishedAt − startedAt` next, because under P-8 a job can sit queued and can
 * be resumed after a restart: `finishedAt − createdAt` would bill it for the
 * queue and for the downtime, and is only the last resort. A running job
 * prefers `stats.elapsedMs` for the same reason. Never negative, and a
 * timestamp the server did not write as a date yields 0 rather than `NaN`.
 */
function elapsedFor(job: ProgressJobLike, nowMs: number): number {
  const created = Date.parse(job.createdAt)
  if (job.finishedAt) {
    if (typeof job.importMs === 'number' && Number.isFinite(job.importMs) && job.importMs >= 0) return job.importMs
    const finished = Date.parse(job.finishedAt)
    const started = job.startedAt ? Date.parse(job.startedAt) : Number.NaN
    if (Number.isFinite(finished) && Number.isFinite(started)) return Math.max(0, finished - started)
    if (Number.isFinite(finished) && Number.isFinite(created)) return Math.max(0, finished - created)
  }
  const reported = num(job.stats?.elapsedMs)
  if (reported > 0) return reported
  if (!Number.isFinite(created)) return 0
  return Math.max(0, nowMs - created)
}

export function progressSummary(job: ProgressJobLike, nowMs: number): ProgressSummary {
  const processed = num(job.stats?.processed)
  const total = num(job.stats?.total)
  const elapsedMs = elapsedFor(job, nowMs)
  // With a known total the percentage is the truth; without one, the server's
  // own `progress` is the only thing that knows anything.
  const pct = total > 0 ? clamp(Math.round((processed / total) * 100), 0, 100) : clamp(Math.round(num(job.progress)), 0, 100)
  const remaining = total > 0 ? Math.max(0, total - processed) : 0
  const etaMs =
    processed >= ETA_MIN_PROCESSED && total > 0 && elapsedMs > 0 ? Math.round((elapsedMs / processed) * remaining) : null
  const ratePerMin = elapsedMs > 0 ? Math.round((processed / (elapsedMs / 60_000)) * 10) / 10 : 0
  return { processed, total, pct, elapsedMs, etaMs, ratePerMin }
}

/**
 * A duration in the coarsest unit that still says something. Seconds below a
 * minute; minutes above it, carrying the seconds when they are not zero; hours
 * and minutes from an hour up (A-45). Whole seconds throughout — flooring, not
 * rounding, so the unit never jumps a boundary the value has not reached.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0)
  if (totalSeconds < 60) return t('settings.dataPort.wizard.duration.seconds', { count: totalSeconds })
  if (totalSeconds < 3_600) {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    if (s === 0) return t('settings.dataPort.wizard.duration.minutes', { count: m })
    // Task 16 adds `duration.minutesSeconds` in all six languages; until it
    // lands `tOr` keeps the running screen readable instead of printing a key.
    return tOr('settings.dataPort.wizard.duration.minutesSeconds', '{{m}} min {{s}} s', { m, s })
  }
  return t('settings.dataPort.wizard.duration.hours', {
    h: Math.floor(totalSeconds / 3_600),
    m: Math.floor((totalSeconds % 3_600) / 60),
  })
}

/**
 * Dates and numbers follow the language the owner chose in EYAS, not the
 * browser's. `tlh` is a well-formed tag with no locale data behind it, so it
 * borrows English formatting rather than silently falling back to whatever the
 * host is set to.
 */
export function dateLocale(lang: string): string {
  return lang === 'tlh' ? 'en' : lang
}

/**
 * The three size units and the transitional English behind them. `sizeMiB` and
 * `sizeGiB` are added by Task 16 in its six-language pass; the fallbacks are
 * what keeps the list readable until it lands, not the source of truth.
 */
const SIZE_KEYS = ['sizeKiB', 'sizeMiB', 'sizeGiB'] as const
const SIZE_FALLBACKS = ['{{count}} KiB', '{{count}} MiB', '{{count}} GiB'] as const

/**
 * A file size in the largest binary unit that keeps it under 1 024, with at
 * most one decimal (A-46). A whole-home scan reports "81.1 MiB", not a
 * six-digit run of KiB, and the number is grouped in the owner's language.
 *
 * The unit is chosen from the value as it will be DISPLAYED, so 1 048 575 bytes
 * reads "1 MiB" rather than the "1,024 KiB" a raw byte threshold would produce.
 * A file that exists never reads as "0 KiB": below the smallest value one
 * decimal can show it is reported as 0.1 KiB, and only an empty file is zero.
 */
export function formatBytes(bytes: number, lang: string): string {
  const format = (v: number) => new Intl.NumberFormat(dateLocale(lang), { maximumFractionDigits: 1 }).format(v)
  const shown = (v: number) => Math.round(v * 10) / 10
  let unit = 0
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes / 1024 : 0
  while (unit < SIZE_KEYS.length - 1 && shown(value) >= 1024) {
    value /= 1024
    unit += 1
  }
  if (bytes > 0 && shown(value) === 0) value = 0.1
  return tOr(`settings.dataPort.wizard.${SIZE_KEYS[unit]}`, SIZE_FALLBACKS[unit]!, { count: format(value) })
}
