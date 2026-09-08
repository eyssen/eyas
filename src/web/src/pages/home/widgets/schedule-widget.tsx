// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one place in the product that surfaces "this job's last run failed" on
// a landing page — neither the current dashboard's "Next up" list nor the
// scheduler page itself does this today (both only show what's scheduled
// next, never what happened last). Joins GET /scheduler/jobs?status=active
// with GET /scheduler/executions?limit=50 by jobId.
//
// refresh is `{ pollMs: 60_000 }` with NO topics: the scheduler module never
// emits a WS_TOPICS entry (ws-topics.ts has no scheduler topic — confirmed
// against src/shared/ws-topics.ts while planning this tile), so polling is
// the only way this tile ever learns a job's status changed.
//
// No outer WidgetFrame here — see attention-widget.tsx for why (home-page.tsx
// already wraps every tile's Component in one).
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Clock, Play } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { pickNextJobs } from '../dashboard-utils'
import { useWidgetData } from '../use-widget-data'
import { DashboardRow } from '../widget-frame'
import { t } from '../i18n'

interface JobsResponse {
  jobs: {
    id: string
    name: string
    status: string
    nextRunAt?: string
    nextRun?: string
  }[]
}

interface JobExecution {
  jobId: string
  status: string
  startedAt?: string
  completedAt?: string
}

interface ExecutionsResponse {
  executions: JobExecution[]
}

// Reused verbatim from dashboard-page.tsx's formatNextAt (not exported from
// dashboard-utils.ts, so re-implemented here the same way conversations- and
// running-agents-widget re-implement formatRelative) — same
// 'home.widget.time.*' keys, already translated in all six locales.
function formatNextAt(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const diff = ts - Date.now()
  if (diff < 0) return t('home.widget.time.justNow')
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return t('home.widget.time.inMinutes', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('home.widget.time.inHours', { count: hrs })
  return t('home.widget.time.inDays', { count: Math.floor(hrs / 24) })
}

/**
 * Each job's most recent execution status, keyed by jobId. "Most recent" is
 * decided by `completedAt` (falling back to `startedAt`) compared as ISO
 * strings, never by the order executions arrive in the response — the API
 * makes no promise about that beyond its own limit/filter slicing, and
 * trusting array order would make a job whose latest run succeeded AFTER an
 * earlier failure look failed forever if that assumption ever broke.
 */
function latestStatusByJob(executions: JobExecution[]): Map<string, string> {
  const latest = new Map<string, { at: string; status: string }>()
  for (const e of executions) {
    const at = e.completedAt ?? e.startedAt ?? ''
    const cur = latest.get(e.jobId)
    if (!cur || at >= cur.at) latest.set(e.jobId, { at, status: e.status })
  }
  return new Map([...latest].map(([jobId, v]) => [jobId, v.status]))
}

const REFRESH = { pollMs: 60_000 }

export function ScheduleWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const navigate = useNavigate()
  const jobsQ = useWidgetData<JobsResponse>('/scheduler/jobs?status=active', REFRESH)
  const execQ = useWidgetData<ExecutionsResponse>('/scheduler/executions?limit=50', REFRESH)

  // Both fetches poll on their own 60s timer, gated by tab-visibility and,
  // once attached, on-screen (IntersectionObserver) — attaching only one of
  // the two tileRefs would leave the other polling in the background forever
  // while the tile is scrolled out of view, so both are wired to the same
  // root element.
  const setTileRef = useCallback(
    (node: Element | null) => {
      jobsQ.tileRef(node)
      execQ.tileRef(node)
    },
    [jobsQ.tileRef, execQ.tileRef],
  )

  const [runningId, setRunningId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const nextJobs = useMemo(() => pickNextJobs(jobsQ.data?.jobs ?? []), [jobsQ.data])
  const failedStatusByJob = useMemo(() => latestStatusByJob(execQ.data?.executions ?? []), [execQ.data])

  const runNow = useCallback(
    async (id: string) => {
      setRunningId(id)
      setActionError(null)
      try {
        await api.post(`/scheduler/jobs/${id}/run`)
        jobsQ.refetch()
        execQ.refetch()
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : String(e))
      } finally {
        setRunningId(null)
      }
    },
    [jobsQ, execQ],
  )

  const isLoading = jobsQ.isLoading
  // Its own branch rather than a ternary inside the empty one — see the idiom
  // note in pulse-widget.tsx. execQ is not part of it: it only decorates the
  // list with failed-run markers, and losing those is not losing the list.
  const hasError = !!jobsQ.error && !jobsQ.data
  const isEmpty = !isLoading && nextJobs.length === 0

  return (
    <div ref={setTileRef}>
      {actionError && (
        <div
          data-testid="action-error"
          className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive break-words"
        >
          {actionError}
        </div>
      )}
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.schedule.unavailable')}</p>
      ) : isEmpty ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.schedule.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 -mx-1">
          {nextJobs.map((j) => {
            const failed = failedStatusByJob.get(j.id) === 'failed'
            return (
              <li key={j.id}>
                <DashboardRow onClick={() => navigate({ to: '/scheduler' })}>
                  <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{j.name}</div>
                    <div className="text-[11px] text-muted-foreground">{formatNextAt(j.nextAt)}</div>
                    {failed && (
                      <div
                        data-testid={`job-failed-${j.id}`}
                        className="text-[11px] font-medium text-red-600 dark:text-red-300"
                      >
                        {t('home.widget.schedule.failed')}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0" onClick={(e: MouseEvent) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      disabled={runningId === j.id}
                      onClick={() => runNow(j.id)}
                      data-testid={`run-now-${j.id}`}
                      aria-label={t('home.widget.schedule.runNow')}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </DashboardRow>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
