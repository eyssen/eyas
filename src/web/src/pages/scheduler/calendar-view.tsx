// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useMemo } from 'react'
import type { ScheduledJob, TimelineRun } from './types'
import { t } from './i18n'

interface Props {
  monthOffset: number
  jobs: ScheduledJob[]
  runs: TimelineRun[]
  onSelectDay: (day: Date) => void
}

export function CalendarView({ monthOffset, jobs, runs, onSelectDay }: Props) {
  const { weeks, label, todayKey } = useMemo(() => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const startPad = (first.getDay() + 6) % 7 // Monday-first
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const cells: Array<{ date: Date | null; key: string }> = []
    for (let i = 0; i < startPad; i++) cells.push({ date: null, key: `p-${i}` })
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), d)
      cells.push({ date, key: date.toISOString().slice(0, 10) })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, key: `t-${cells.length}` })
    const weeks: typeof cells[] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return {
      weeks,
      label: first.toLocaleDateString(undefined, { year: 'numeric', month: 'long' }),
      todayKey: new Date().toISOString().slice(0, 10),
    }
  }, [monthOffset])

  const byDay = useMemo(() => {
    const map = new Map<string, { success: number; fail: number; upcoming: number }>()
    for (const run of runs) {
      const key = run.startedAt.slice(0, 10)
      const cur = map.get(key) ?? { success: 0, fail: 0, upcoming: 0 }
      if (run.status === 'failed') cur.fail++
      else cur.success++
      map.set(key, cur)
    }
    for (const job of jobs) {
      if (job.status !== 'active' || !job.nextRunAt) continue
      const key = job.nextRunAt.slice(0, 10)
      const cur = map.get(key) ?? { success: 0, fail: 0, upcoming: 0 }
      cur.upcoming++
      map.set(key, cur)
    }
    return map
  }, [runs, jobs])

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2 font-medium">{label}</div>
      <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="text-center py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((cell) => {
          if (!cell.date) {
            return <div key={cell.key} className="h-16 rounded-md bg-transparent" />
          }
          const stats = byDay.get(cell.key)
          const isToday = cell.key === todayKey
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onSelectDay(cell.date!)}
              className={`h-16 rounded-md border p-1.5 text-left transition-colors hover:bg-accent/30 ${
                isToday ? 'border-primary/50 bg-accent/20' : 'border-border/30 bg-card/40'
              }`}
            >
              <div className="text-[11px] font-medium">{cell.date.getDate()}</div>
              {stats && (
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {stats.success > 0 && (
                    <span className="rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-400">
                      {stats.success}
                    </span>
                  )}
                  {stats.fail > 0 && (
                    <span className="rounded bg-red-500/20 px-1 text-[9px] text-red-400">{stats.fail}</span>
                  )}
                  {stats.upcoming > 0 && (
                    <span className="rounded bg-sky-500/20 px-1 text-[9px] text-sky-400">
                      {stats.upcoming} {t('scheduler.cal.due')}
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
