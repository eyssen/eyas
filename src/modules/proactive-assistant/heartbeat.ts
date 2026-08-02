// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Heartbeat autonomy (Cap 5). A leader-gated tick collects cheap signals and a
// DETERMINISTIC gate decides whether anything is worth telling the user, so a
// quiet system spends 0 LLM tokens. Off by default (privacy); respects quiet
// hours. The notify() step is where an (operator-configured, cheap-tier) agent
// composes the actual message — this module never calls a model directly.

export interface HeartbeatSignals {
  boardStuck?: number
  boardDueSoon?: number
  schedulerFailures?: number
  memoryPending?: number
  systemAlerts?: number
}

const SIGNAL_LABELS: Record<keyof HeartbeatSignals, string> = {
  boardStuck: 'board: stuck/overdue tasks',
  boardDueSoon: 'board: tasks due soon',
  schedulerFailures: 'scheduler: failed jobs',
  memoryPending: 'memory: pending consolidation',
  systemAlerts: 'system: health alerts',
}

/** The pre-LLM gate: deterministic, allocation-free of any model call. */
export function shouldNotify(signals: HeartbeatSignals): { notify: boolean; reasons: string[] } {
  const reasons: string[] = []
  for (const key of Object.keys(SIGNAL_LABELS) as (keyof HeartbeatSignals)[]) {
    const v = signals[key] ?? 0
    if (v > 0) reasons.push(`${SIGNAL_LABELS[key]} (${v})`)
  }
  return { notify: reasons.length > 0, reasons }
}

export interface QuietHours {
  startHour: number
  endHour: number
}

/** UTC-hour quiet-hours check; handles wraparound windows (e.g. 22:00 → 07:00). */
export function isQuietHours(now: Date, quiet: QuietHours): boolean {
  const h = now.getUTCHours()
  const { startHour, endHour } = quiet
  if (startHour === endHour) return false
  if (startHour < endHour) return h >= startHour && h < endHour // same-day window
  return h >= startHour || h < endHour // wraparound
}

export interface HeartbeatDeps {
  enabled: boolean
  /**
   * Optional fresh-read override for `enabled`, checked at tick time instead
   * of the static `enabled` above. Lets a caller wire in a live source (e.g.
   * the `proactive.heartbeat` autonomy feature flag) so toggling it at
   * runtime takes effect on the very next tick with no restart — a plain
   * `enabled: boolean` is captured once at construction and can never do
   * that. Falls back to `enabled` when omitted.
   */
  isEnabled?: () => boolean
  collect: () => Promise<HeartbeatSignals> | HeartbeatSignals
  notify: (signals: HeartbeatSignals, reasons: string[]) => Promise<void> | void
  now?: () => Date
  quietHours?: QuietHours
}

export interface Heartbeat {
  tick(): Promise<{ notified: boolean; reasons: string[] }>
}

export function createHeartbeat(deps: HeartbeatDeps): Heartbeat {
  const now = deps.now ?? (() => new Date())
  return {
    async tick() {
      const on = deps.isEnabled ? deps.isEnabled() : deps.enabled
      if (!on) return { notified: false, reasons: [] }
      if (deps.quietHours && isQuietHours(now(), deps.quietHours)) return { notified: false, reasons: [] }

      const signals = await deps.collect()
      const decision = shouldNotify(signals)
      if (!decision.notify) return { notified: false, reasons: [] }

      await deps.notify(signals, decision.reasons)
      return { notified: true, reasons: decision.reasons }
    },
  }
}
