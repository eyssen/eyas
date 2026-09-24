// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one aggregate tile, and the only hybrid-refresh one: a single
// GET /home/pulse (home/pulse.ts's computePulse, already built and reviewed
// in Task 5) assembles all five figures server-side, so the widest, topmost
// tile is also the cheapest fetch on the page — never three separate calls
// to mission-control/scheduler/autonomy just to fill five numbers.
//
// Hybrid because the discipline isn't uniform across the figures it shows:
// attention/running/waiting/costTodayUsd all ride the mission-control
// snapshot, which broadcasts on WS_TOPICS.missionControl — but failedJobs
// comes from the scheduler, which never broadcasts anything (schedule-widget.tsx's
// own comment: ws-topics.ts has no scheduler topic). A tile built from
// sources of different broadcast maturity must declare the WEAKER
// discipline for the whole tile, so both `topics` and `pollMs` are set here
// (spec §4.1) rather than only the WS side, which would leave failedJobs
// stale until the next full page load.
//
// StatChip here is a fresh, local implementation, not an import from
// dashboard-page.tsx — that component isn't exported, and the file stays
// live and untouched until Task 14. It also deliberately uses
// onClick+useNavigate rather than @tanstack/react-router's <Link>, per
// board-widget.tsx's note: every tile here is unit-tested by rendering the
// widget alone with no RouterProvider, and <Link>'s useLinkProps throws
// there while useNavigate only warns.
//
// No outer WidgetFrame here — see attention-widget.tsx for why (home-page.tsx
// already wraps every tile's Component in one).
//
// THE ERROR IDIOM, for all nine tiles. Every tile renders, in this order:
// loading -> `hasError` -> empty -> content. `hasError` means "a source
// failed and there is nothing left to show" (`error && !data`; for a tile
// with several sources, some source failed and the assembled result is
// empty). Two things fall out of it, and both are the point:
//   - stale data always beats the error state, because every guard carries
//     `!data` — a refetch that 500s never blanks a working tile;
//   - an empty state is a factual claim about the world ("nothing needs your
//     attention", "no upcoming jobs"), and a tile that never reached its
//     backend has not earned it. Four tiles used to make that claim anyway.
// A tile with its own wording for the failure (running agents, schedule)
// keeps it; the rest use `home.widget.error`.
import { AlertTriangle, Bot, Clock, DollarSign, XCircle, type LucideIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { WS_TOPICS } from '@/lib/ws-topics'
import { useWidgetData } from '../use-widget-data'
import { t } from '../i18n'

interface PulseResponse {
  attention: number
  running: number
  waiting: number
  costTodayUsd: number
  failedJobs: number
}

const REFRESH = { topics: [WS_TOPICS.missionControl], pollMs: 60_000 }

function Chip({
  testId,
  label,
  value,
  icon: Icon,
  error,
  onClick,
}: {
  testId: string
  label: string
  value: string
  icon: LucideIcon
  error: boolean
  onClick: () => void
}) {
  const toneCls = error ? 'border-destructive/40 text-destructive' : 'border-border/40'
  // One line, not a label stacked over a value, and every line height pinned
  // with `leading-none`. This is a height budget, not a style preference.
  //
  // The tile may legitimately be two rows tall — that is `minH`, and any user
  // can drag it there — which is a 90px cell (2 * 40 + one 10px row margin).
  // WidgetFrame's own chrome takes 60 of those (32px of `p-4`, a 20px header
  // line, 8px of `mb-2`), leaving 30px for everything below. The stacked
  // version measured ~50px: a 10px label, a `text-lg` value, `py-2`, and a
  // border. It could not fit, and once grid items started clipping (Task 5)
  // the tile rendered five labels and none of the five numbers — worse than
  // the overflow it replaced.
  //
  // Laid out horizontally with `py-1` and `leading-none` this is 24px
  // (2px border + 8px padding + a 14px `text-sm` line), so it fits the
  // smallest height the grid permits with room to spare, and needs no second
  // variant, no container query and no measured breakpoint to do it. The
  // value keeps `ml-auto`, so the five figures line up on their own right
  // edges however wide the chips end up.
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex flex-1 min-w-[6rem] items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-left hover:bg-accent/30 transition-colors ${toneCls}`}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate text-[10px] font-medium uppercase leading-none tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="ml-auto text-sm font-semibold leading-none tabular-nums">{value}</span>
    </button>
  )
}

export function PulseWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const navigate = useNavigate()
  const { data, isLoading, error, tileRef } = useWidgetData<PulseResponse>('/home/pulse', REFRESH)
  const hasError = !!error && !data
  const p = data ?? { attention: 0, running: 0, waiting: 0, costTodayUsd: 0, failedJobs: 0 }

  return (
    <div ref={tileRef}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Chip
            testId="pulse-attention"
            label={t('home.widget.pulse.attention')}
            value={String(p.attention)}
            icon={AlertTriangle}
            error={false}
            onClick={() => navigate({ to: '/autonomy' })}
          />
          <Chip
            testId="pulse-running"
            label={t('home.widget.pulse.running')}
            value={String(p.running)}
            icon={Bot}
            error={false}
            onClick={() => navigate({ to: '/mission-control' })}
          />
          <Chip
            testId="pulse-waiting"
            label={t('home.widget.pulse.waiting')}
            value={String(p.waiting)}
            icon={Clock}
            error={false}
            onClick={() => navigate({ to: '/autonomy' })}
          />
          <Chip
            testId="pulse-cost"
            label={t('home.widget.pulse.cost')}
            value={`$${p.costTodayUsd.toFixed(2)}`}
            icon={DollarSign}
            error={false}
            onClick={() => navigate({ to: '/mission-control' })}
          />
          <Chip
            testId="pulse-failed"
            label={t('home.widget.pulse.failed')}
            value={String(p.failedJobs)}
            icon={XCircle}
            error={p.failedJobs > 0}
            onClick={() => navigate({ to: '/scheduler' })}
          />
        </div>
      )}
    </div>
  )
}
