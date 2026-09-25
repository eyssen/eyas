// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one clock EYAS tells a model. Date and time are computed in the same
// IANA time zone — the configured `i18n.timezone`, else the server's own — so
// near midnight they can never disagree, and the time names its zone and UTC
// offset so the model does not have to guess. Locale-neutral on purpose: a
// 24-hour clock and an ISO date read the same in every language.

export interface ClockReading {
  /** Local calendar date in the zone, YYYY-MM-DD. */
  date: string
  /** Local wall-clock time in the zone, e.g. `23:30 (America/New_York, UTC-04:00)`. */
  time: string
  /** The IANA zone both were computed in. */
  timeZone: string
  /** Offset from UTC in minutes at that instant (east positive). */
  offsetMinutes: number
}

/** True when the runtime's Intl accepts `value` as a time zone (IANA names, `UTC`, `Etc/*`). */
export function isValidTimeZone(value: string): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** The server's own zone as the runtime reports it (honours the TZ variable). */
export function hostTimeZone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidTimeZone(tz)) return tz
  } catch {
    /* an Intl without zone data — fall through */
  }
  return 'UTC'
}

/** The configured zone when it is valid, otherwise the server's zone. */
export function resolveTimeZone(configured?: string | null): string {
  if (configured && isValidTimeZone(configured)) {
    // Canonical spelling (Intl accepts `america/new_york`; the model sees the real name).
    return new Intl.DateTimeFormat('en-US', { timeZone: configured }).resolvedOptions().timeZone
  }
  return hostTimeZone()
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${hh}:${mm}`
}

/** Read the clock at `now` in `timeZone` (default: the server's zone). */
export function formatNow(timeZone?: string | null, now: Date = new Date()): ClockReading {
  const tz = resolveTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '00'
  const year = get('year')
  const month = get('month')
  const day = get('day')
  // Some engines still print midnight as 24 under h23; normalise.
  const hour = get('hour') === '24' ? '00' : get('hour')
  const minute = get('minute')

  // Offset = local wall clock read as UTC minus the real instant, to the minute.
  const wallAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  const instant = Math.floor(now.getTime() / 60_000) * 60_000
  const offsetMinutes = Math.round((wallAsUtc - instant) / 60_000)

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute} (${tz}, ${formatOffset(offsetMinutes)})`,
    timeZone: tz,
    offsetMinutes,
  }
}
