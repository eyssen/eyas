// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Two poll-only sources, joined into one list: GET /observability/anomalies
// (7-day trace anomaly detection) and GET /scheduler/health (leader,
// active/running job counts, overdue/dead-letter/unrunnable, failed24h).
// Neither module has a WS_TOPICS entry (ws-topics.ts has neither an
// observability nor a scheduler topic — same situation schedule-widget.tsx
// and cost-widget.tsx document for the scheduler and costops modules
// respectively), so pollMs is the only refresh discipline available.
//
// Two useWidgetData calls -> two tileRefs to compose, same reasoning as
// schedule-widget.tsx: attaching only one would leave the other polling in
// the background forever while the tile is off-screen.
//
// No outer WidgetFrame here — see attention-widget.tsx for why (home-page.tsx
// already wraps every tile's Component in one).
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Activity, AlertOctagon, AlertTriangle, Clock, XCircle } from 'lucide-react'
import { useWidgetData } from '../use-widget-data'
import { DashboardRow } from '../widget-frame'
import { t } from '../i18n'

interface Anomaly {
  model: string
  metric: string
}

interface AnomaliesResponse {
  anomalies: Anomaly[]
}

interface SchedulerHealth {
  activeJobs: number
  running: number
  failed24h: number
  deadLetter: number
  overdue: number
  unrunnable: number
}

const REFRESH = { pollMs: 60_000 }

export function SystemWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const navigate = useNavigate()
  const anomaliesQ = useWidgetData<AnomaliesResponse>('/observability/anomalies', REFRESH)
  const healthQ = useWidgetData<SchedulerHealth>('/scheduler/health', REFRESH)

  const setTileRef = useCallback(
    (node: Element | null) => {
      anomaliesQ.tileRef(node)
      healthQ.tileRef(node)
    },
    [anomaliesQ.tileRef, healthQ.tileRef],
  )

  const isLoading = anomaliesQ.isLoading || healthQ.isLoading
  // Named for the family idiom (see pulse-widget.tsx): a source that failed
  // with nothing to show. Both must fail — either one alone still leaves a
  // real figure to display beside the other's fallback zero.
  const hasError = !!anomaliesQ.error && !anomaliesQ.data && !!healthQ.error && !healthQ.data

  const anomalyCount = anomaliesQ.data?.anomalies.length ?? 0
  const h = healthQ.data ?? { activeJobs: 0, running: 0, failed24h: 0, deadLetter: 0, overdue: 0, unrunnable: 0 }

  return (
    <div ref={setTileRef}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 -mx-1">
          <li>
            <DashboardRow onClick={() => navigate({ to: '/observability' })}>
              <Activity className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <span className="text-sm">{t('home.widget.system.anomalies')}</span>
                <span
                  data-testid="system-anomalies"
                  className={`text-sm font-medium tabular-nums ${anomalyCount > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}`}
                >
                  {anomalyCount}
                </span>
              </div>
            </DashboardRow>
          </li>
          <li>
            <DashboardRow onClick={() => navigate({ to: '/scheduler' })}>
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <span className="text-sm">{t('home.widget.system.failed24h')}</span>
                <span
                  data-testid="system-failed24h"
                  className={`text-sm font-medium tabular-nums ${h.failed24h > 0 ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground'}`}
                >
                  {h.failed24h}
                </span>
              </div>
            </DashboardRow>
          </li>
          <li>
            <DashboardRow onClick={() => navigate({ to: '/scheduler' })}>
              <Clock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <span className="text-sm">{t('home.widget.system.overdue')}</span>
                <span
                  data-testid="system-overdue"
                  className={`text-sm font-medium tabular-nums ${h.overdue > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}`}
                >
                  {h.overdue}
                </span>
              </div>
            </DashboardRow>
          </li>
          <li>
            <DashboardRow onClick={() => navigate({ to: '/scheduler' })}>
              <XCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <span className="text-sm">{t('home.widget.system.deadLetter')}</span>
                <span
                  data-testid="system-dead-letter"
                  className={`text-sm font-medium tabular-nums ${h.deadLetter > 0 ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground'}`}
                >
                  {h.deadLetter}
                </span>
              </div>
            </DashboardRow>
          </li>
          <li>
            <DashboardRow onClick={() => navigate({ to: '/scheduler' })}>
              <AlertOctagon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
                <span className="text-sm">{t('home.widget.system.unrunnable')}</span>
                <span
                  data-testid="system-unrunnable"
                  className={`text-sm font-medium tabular-nums ${h.unrunnable > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground'}`}
                >
                  {h.unrunnable}
                </span>
              </div>
            </DashboardRow>
          </li>
        </ul>
      )}
    </div>
  )
}
