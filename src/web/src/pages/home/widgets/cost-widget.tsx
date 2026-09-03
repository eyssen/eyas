// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// GET /costops/summary for the current period's total spend plus any
// configured budgets' burn-down. Poll-only (pollMs: 60_000) — costops has
// no WS_TOPICS entry (ws-topics.ts has no costops topic, same situation
// schedule-widget.tsx documents for the scheduler module), so there is
// nothing to subscribe to.
//
// No route to link out to: unlike Pulse/System, costops has no frontend
// page under src/web/src/pages/costops (confirmed — the module has never
// shipped a UI, only the REST routes this tile now reads). So this tile,
// alone among the nine, renders no click targets at all.
//
// No outer WidgetFrame here — see attention-widget.tsx for why (home-page.tsx
// already wraps every tile's Component in one).
import { useWidgetData } from '../use-widget-data'
import { t } from '../i18n'

interface Budget {
  id: string
  name: string
  ratio: number
  status: 'ok' | 'warning' | 'hard'
}

interface CostSummary {
  period: string
  currency: string
  total: number
  budgets: Budget[]
}

const REFRESH = { pollMs: 60_000 }

// Matches the tone convention already used family-wide for status
// severity (widget-frame.tsx's BADGE_TONE, schedule-widget.tsx's
// text-red-600 dark:text-red-300) — literal Tailwind tone classes, no
// hand-rolled hex/rgb.
const STATUS_TONE: Record<Budget['status'], string> = {
  ok: 'text-emerald-600 dark:text-emerald-300',
  warning: 'text-amber-600 dark:text-amber-300',
  hard: 'text-red-600 dark:text-red-300',
}

export function CostWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const { data, isLoading, error, tileRef } = useWidgetData<CostSummary>('/costops/summary', REFRESH)
  // See the idiom note at the top of pulse-widget.tsx.
  const hasError = !!error && !data

  return (
    <div ref={tileRef}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('home.widget.cost.total')}
            </div>
            <p className="mt-0.5 truncate text-xl font-semibold tabular-nums" data-testid="cost-total">
              {(data?.total ?? 0).toFixed(2)} {data?.currency ?? ''}
            </p>
          </div>
          {(data?.budgets.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">{t('home.widget.cost.noBudgets')}</p>
          ) : (
            <ul className="flex flex-col gap-1 -mx-1">
              {data!.budgets.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 px-1 text-xs">
                  <span className="truncate">{b.name}</span>
                  <span className={`tabular-nums font-medium ${STATUS_TONE[b.status]}`}>
                    {Math.round(b.ratio * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
