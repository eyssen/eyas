// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Lifted from dashboard-page.tsx:418-455 (the "Now running" side-column
// section): DashboardSection -> no wrapper (home-page.tsx already supplies
// the tile's WidgetFrame chrome, same reasoning as attention-widget.tsx and
// conversations-widget.tsx), and the three interrupt/pause/resume commands
// added, which the dashboard's own read-only list never had.
//
// Data source is useMissionControl, not useWidgetData: dashboard-page.tsx
// already goes through this hook for the identical list, and it already
// implements the same three properties useWidgetData exists for (reconnect
// refetch, WS-ping-triggered refetch via WS_TOPICS.missionControl) against
// this specific snapshot endpoint — reimplementing that against
// useWidgetData here would just be a second, divergent copy of the same
// logic. Consequence: no `tileRef` is attached here, unlike every
// useWidgetData-backed tile. That gate exists specifically to stop a
// `pollMs` interval from ticking while the tile is off-screen — this tile
// never polls (WS-driven only, like useMissionControl's other consumer),
// so there is no interval for the gate to guard. The registry's own
// `refresh.topics` entry is honest metadata (mirrors what useMissionControl
// itself subscribes to) rather than live wiring this component reads.
import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Pause, Play, Square } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  useMissionControl,
  type AgentRunSnapshot,
} from '@/pages/mission-control/hooks/useMissionControl'
import { relativeTime } from '../dashboard-utils'
import { StatusDot } from '../status-dot'
import { DashboardRow } from '../widget-frame'
import { t, tOr } from '../i18n'

// Reuses the dashboard's own relative-time keys verbatim (see
// conversations-widget.tsx for the same duplication rationale — the helper
// itself isn't exported from dashboard-utils, only its inputs are).
function formatRelative(code: string): string {
  if (!code) return ''
  if (code === 'just_now') return t('home.widget.time.justNow')
  if (code.startsWith('m:')) return t('home.widget.time.minutes', { count: code.slice(2) })
  if (code.startsWith('h:')) return t('home.widget.time.hours', { count: code.slice(2) })
  if (code.startsWith('d:')) return t('home.widget.time.days', { count: code.slice(2) })
  return code
}

type Command = 'interrupt' | 'pause' | 'resume'

const RUNNING_STATUSES = new Set(['running', 'waiting_approval', 'paused'])

export function RunningAgentsWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const navigate = useNavigate()
  const { snapshot, error } = useMissionControl()
  const [pending, setPending] = useState<{ sessionId: string; command: Command } | null>(null)
  // Matches dashboard-page.tsx's `actionError` (see attention-widget.tsx for
  // the same fix) — not hypothetical here: pause/resume currently answer 500
  // against the live agent registry (AgentCard.tsx's own comment documents
  // it), so today every click on those two buttons failed with zero visible
  // feedback before this fix.
  const [actionError, setActionError] = useState<string | null>(null)

  const running = useMemo(
    () => (snapshot?.agents ?? []).filter((a) => RUNNING_STATUSES.has(a.status)).slice(0, 6),
    [snapshot],
  )

  const run = useCallback(async (sessionId: string, command: Command) => {
    setPending({ sessionId, command })
    setActionError(null)
    try {
      await api.post(`/mission-control/agents/${sessionId}/${command}`)
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setPending(null)
    }
  }, [])

  const isLoading = !snapshot && !error
  // Same shape as every other tile (see the idiom note in pulse-widget.tsx),
  // with `!snapshot` doing the `!data` job: a socket error after a snapshot
  // has arrived leaves the last known agents on screen rather than throwing
  // them away.
  const hasError = !!error && !snapshot
  const isEmpty = !isLoading && !hasError && running.length === 0

  return (
    <div>
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
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.running.unavailable')}</p>
      ) : isEmpty ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.running.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 -mx-1">
          {running.map((a: AgentRunSnapshot) => (
            <li key={a.sessionId}>
              <DashboardRow onClick={() => navigate({ to: '/mission-control' })}>
                <StatusDot status={a.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{a.agentName}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {a.currentAction || tOr(`home.widget.agentStatus.${a.status}`, a.status)}
                    {' · '}
                    {formatRelative(relativeTime(a.lastUpdatedAt))}
                  </div>
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                  ${a.costUsd.toFixed(2)}
                </span>
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                >
                  {a.status === 'paused' ? (
                    <Button
                      size="icon-xs"
                      variant="outline"
                      disabled={pending?.sessionId === a.sessionId}
                      onClick={() => run(a.sessionId, 'resume')}
                      data-testid={`resume-${a.sessionId}`}
                      aria-label={t('home.widget.running.resume')}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  ) : (
                    <Button
                      size="icon-xs"
                      variant="outline"
                      disabled={pending?.sessionId === a.sessionId}
                      onClick={() => run(a.sessionId, 'pause')}
                      data-testid={`pause-${a.sessionId}`}
                      aria-label={t('home.widget.running.pause')}
                    >
                      <Pause className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={pending?.sessionId === a.sessionId}
                    onClick={() => run(a.sessionId, 'interrupt')}
                    data-testid={`interrupt-${a.sessionId}`}
                    aria-label={t('home.widget.running.interrupt')}
                  >
                    <Square className="h-3 w-3" />
                  </Button>
                </div>
              </DashboardRow>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
