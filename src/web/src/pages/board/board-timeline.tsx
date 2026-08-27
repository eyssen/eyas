// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { scaleTime } from 'd3-scale'
import { timeDay, timeHour, timeMinute, type TimeInterval } from 'd3-time'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useLanguageStore } from '@/stores/language-store'
import { cn } from '@/lib/utils'
import type { BoardConversation } from '@/stores/board-store'
import {
  useMissionControl,
  type AgentRunSnapshot,
  type AgentRunStatus,
} from '@/pages/mission-control/hooks/useMissionControl'
import type { BoardViewProps } from './board-view-props'
import {
  bucketRows,
  clampToWindow,
  conversationVisible,
  isVisible,
  parseTime,
  spanOverlaps,
  timeToX,
  windowRange,
  DEFAULT_TIMELINE_WINDOW,
  TIMELINE_WINDOWS,
  type TimelineGroupBy,
  type TimelineRow,
  type TimelineWindow,
  type TimeRange,
} from './board-timeline-utils'
import { t } from './i18n'

// Everything is positioned in percent of the plot column, so the view is
// responsive without ever measuring the DOM.
const PLOT_WIDTH = 100

// Width of the lane-label gutter. The labels are pulled into it with a negative
// offset from their (relative) lane, which is what keeps every label aligned to
// its row while the now-line stays free to span all rows in one element.
const GUTTER = 'w-28'
const LABEL_PULL = '-left-28'

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  normal: 'bg-blue-500',
  low: 'bg-zinc-600',
}

// Copied verbatim from conversations/components/run-tree.tsx so a run reads the
// same in both places. `idle`/`waiting_approval` never reach the run tree but do
// appear in mission-control snapshots.
const STATUS_BAR: Record<AgentRunStatus, string> = {
  running: 'bg-blue-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  cancelled: 'bg-zinc-400',
  paused: 'bg-amber-400',
  idle: 'bg-zinc-400',
  waiting_approval: 'bg-amber-400',
}

const TICK_INTERVAL: Record<TimelineWindow, TimeInterval | null> = {
  '1h': timeMinute.every(10),
  '24h': timeHour.every(3),
  '7d': timeDay.every(1),
  '30d': timeDay.every(5),
}

const selectClass =
  'h-6 px-1.5 text-[10px] bg-transparent border border-border/40 rounded-md text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer'

interface Marker {
  conv: BoardConversation
  updatedAt: number | null
  dueDate: number | null
}

interface AgentLane {
  run: AgentRunSnapshot
  leftPct: number
  widthPct: number
}

export function BoardTimeline({ stages }: BoardViewProps) {
  const navigate = useNavigate()
  const lang = useLanguageStore((s) => s.lang)
  const { snapshot } = useMissionControl()
  const [timeWindow, setTimeWindow] = useState<TimelineWindow>(DEFAULT_TIMELINE_WINDOW)
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>('stage')
  const [now, setNow] = useState(() => Date.now())

  // The now-line and the whole window slide with wall-clock time. Re-anchor on a
  // coarse tick instead of on every render, so the memos below actually hold.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const range = useMemo(() => windowRange(timeWindow, now), [timeWindow, now])

  // d3 generates the tick instants; `timeToX` places them — the same mapping
  // every marker uses, so the axis and the data can never drift apart.
  const ticks = useMemo(() => {
    const scale = scaleTime()
      .domain([new Date(range.start), new Date(range.end)])
      .range([0, PLOT_WIDTH])
    const interval = TICK_INTERVAL[timeWindow]
    const values = interval ? scale.ticks(interval) : scale.ticks(6)
    return values.map((d) => ({ ms: d.getTime(), date: d, x: timeToX(d.getTime(), range, PLOT_WIDTH) }))
  }, [range, timeWindow])

  const tickFormat = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions =
      timeWindow === '1h' || timeWindow === '24h'
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric' }
    return new Intl.DateTimeFormat(lang, opts)
  }, [lang, timeWindow])

  const stampFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [lang],
  )

  const rows = useMemo(() => bucketRows(stages, groupBy), [stages, groupBy])

  const visibleRows = useMemo(
    () =>
      rows
        .map((row) => ({
          row,
          markers: row.items
            .filter((c) => conversationVisible(c, range))
            .map<Marker>((conv) => ({
              conv,
              updatedAt: parseTime(conv.updatedAt),
              dueDate: parseTime(conv.dueDate),
            })),
        }))
        .filter((r) => r.markers.length > 0),
    [rows, range],
  )

  const agentLanes = useMemo<AgentLane[]>(() => {
    if (!snapshot) return []
    return snapshot.agents
      .filter((run) => spanOverlaps(run.startedAt, run.lastUpdatedAt, range))
      .map((run) => {
        const from = timeToX(clampToWindow(run.startedAt, range), range, PLOT_WIDTH)
        const to = timeToX(clampToWindow(run.lastUpdatedAt, range), range, PLOT_WIDTH)
        // A just-started run has zero duration; keep a hairline so it is still
        // findable on the axis.
        return { run, leftPct: from, widthPct: Math.max(to - from, 0.4) }
      })
  }, [snapshot, range])

  const nowX = timeToX(now, range, PLOT_WIDTH)
  const isEmpty = visibleRows.length === 0 && agentLanes.length === 0

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 pb-2">
          <div className="flex items-center border border-border/40 rounded-md overflow-hidden" role="group">
            {TIMELINE_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setTimeWindow(w)}
                aria-pressed={timeWindow === w}
                className={cn(
                  'h-6 px-2 text-[10px] transition-colors',
                  timeWindow === w
                    ? 'bg-accent/40 text-foreground'
                    : 'text-muted-foreground/50 hover:text-foreground',
                )}
              >
                {t(`board.timeline.window.${w}`)}
              </button>
            ))}
          </div>

          <label htmlFor="timeline-groupby" className="text-[9px] text-muted-foreground/60 uppercase tracking-wider ml-1">
            {t('board.groupBy.label')}
          </label>
          <select
            id="timeline-groupby"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as TimelineGroupBy)}
            className={selectClass}
          >
            <option value="stage">{t('board.groupBy.stage')}</option>
            <option value="assignee">{t('board.groupBy.assignee')}</option>
          </select>
        </div>

        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-[11px]">
            {t('board.empty.timeline')}
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="flex">
              <div className={cn(GUTTER, 'shrink-0')} />
              <div className="relative flex-1 h-4 border-b border-border/30">
                {ticks.map(({ ms, date, x }) => (
                  <div
                    key={ms}
                    className="absolute top-0 text-[8px] text-muted-foreground/50 -translate-x-1/2 whitespace-nowrap"
                    style={{ left: `${x}%` }}
                  >
                    {tickFormat.format(date)}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex">
              <div className={cn(GUTTER, 'shrink-0')} />
              {/* Plot column. Gridlines and the now-line are single elements
                  spanning every lane inside it. */}
              <div className="relative flex-1 pt-1">
                {ticks.map(({ ms, x }) => (
                  <div
                    key={ms}
                    className="absolute top-0 bottom-0 w-px bg-border/20 pointer-events-none"
                    style={{ left: `${x}%` }}
                  />
                ))}
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary/60 z-[5] pointer-events-none"
                  style={{ left: `${nowX}%` }}
                >
                  <span className="absolute top-0 left-1 text-[8px] text-primary/80 whitespace-nowrap">
                    {t('board.timeline.now')}
                  </span>
                </div>

                {visibleRows.map(({ row, markers }) => (
                  <ConversationLane
                    key={row.key}
                    row={row}
                    markers={markers}
                    range={range}
                    now={now}
                    stampFormat={stampFormat}
                    onOpen={(id) =>
                      navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })
                    }
                  />
                ))}

                {agentLanes.length > 0 && (
                  <>
                    <div className="relative h-5 flex items-center border-t border-border/30 mt-1">
                      <span
                        className={cn(
                          LABEL_PULL,
                          GUTTER,
                          'absolute pr-2 text-[9px] text-muted-foreground/60 uppercase tracking-wider truncate',
                        )}
                      >
                        {t('board.timeline.agentRuns')}
                      </span>
                    </div>
                    {agentLanes.map((lane) => (
                      <AgentBar key={lane.run.sessionId} lane={lane} stampFormat={stampFormat} />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

function LaneLabel({ color, children }: { color?: string | null; children: React.ReactNode }) {
  return (
    <div className={cn(LABEL_PULL, GUTTER, 'absolute top-0 h-full pr-2 flex items-center gap-1 overflow-hidden')}>
      {color && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
      <span className="text-[9px] text-muted-foreground truncate">{children}</span>
    </div>
  )
}

function ConversationLane({
  row,
  markers,
  range,
  now,
  stampFormat,
  onOpen,
}: {
  row: TimelineRow
  markers: Marker[]
  range: TimeRange
  now: number
  stampFormat: Intl.DateTimeFormat
  onOpen: (id: string) => void
}) {
  return (
    <div className="relative h-6">
      <LaneLabel color={row.color}>{row.labelKey ? t(row.labelKey) : row.label}</LaneLabel>
      {markers.map((m) => (
        <ConversationMarkers
          key={m.conv.id}
          marker={m}
          range={range}
          now={now}
          stampFormat={stampFormat}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

/**
 * A conversation has no start/end — the board only knows when it last moved and
 * when it is due. So it is never a bar: it is an activity dot at `updatedAt`
 * plus an optional deadline diamond at `dueDate`. Inventing a duration between
 * the two would be a lie the data cannot support.
 */
function ConversationMarkers({
  marker,
  range,
  now,
  stampFormat,
  onOpen,
}: {
  marker: Marker
  range: TimeRange
  now: number
  stampFormat: Intl.DateTimeFormat
  onOpen: (id: string) => void
}) {
  const { conv, updatedAt, dueDate } = marker
  const title = conv.title || t('board.card.untitled')

  return (
    <>
      {isVisible(updatedAt, range) && updatedAt !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onOpen(conv.id)}
              aria-label={title}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 p-1 rounded-full hover:ring-1 hover:ring-ring"
              style={{ left: `${timeToX(updatedAt, range, PLOT_WIDTH)}%` }}
            >
              <span
                className={cn('block w-2 h-2 rounded-full', PRIORITY_DOT[conv.priority] ?? PRIORITY_DOT.normal)}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">#{conv.taskId} {title}</span>
              <span className="opacity-70">
                {t('board.timeline.updated')}: {stampFormat.format(new Date(updatedAt))}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {isVisible(dueDate, range) && dueDate !== null && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onOpen(conv.id)}
              aria-label={`${title} — ${t('board.timeline.due')}`}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 p-1 rounded-sm hover:ring-1 hover:ring-ring"
              style={{ left: `${timeToX(dueDate, range, PLOT_WIDTH)}%` }}
            >
              <span
                className={cn(
                  'block w-1.5 h-1.5 rotate-45 border',
                  dueDate < now ? 'border-destructive bg-destructive/40' : 'border-muted-foreground bg-muted',
                )}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">#{conv.taskId} {title}</span>
              <span className="opacity-70">
                {t('board.timeline.due')}: {stampFormat.format(new Date(dueDate))}
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )
}

/** Agent runs — unlike conversations these carry a real duration, so they are bars. */
function AgentBar({ lane, stampFormat }: { lane: AgentLane; stampFormat: Intl.DateTimeFormat }) {
  const { run, leftPct, widthPct } = lane

  return (
    <div className="relative h-6">
      <LaneLabel>{run.agentName}</LaneLabel>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 h-2 rounded-sm',
              STATUS_BAR[run.status] ?? 'bg-zinc-400',
              // `animate-pulse` rides on the status class; Tailwind's
              // motion-reduce variant compiles to prefers-reduced-motion and
              // switches it off there.
              'motion-reduce:animate-none',
            )}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{run.agentName}</span>
            <span className="opacity-70">{run.status}</span>
            {run.currentAction && <span className="opacity-70">{run.currentAction}</span>}
            <span className="opacity-70">
              {run.currentTurn}/{run.maxTurns} · {run.tokensUsed.toLocaleString()} tok
            </span>
            <span className="opacity-70">
              {stampFormat.format(new Date(run.startedAt))} → {stampFormat.format(new Date(run.lastUpdatedAt))}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
