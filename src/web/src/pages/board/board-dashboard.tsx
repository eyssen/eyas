// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Bot, CircleDollarSign, CircleDot, Clock, ListChecks, Loader2, PauseCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AgentRunSnapshot } from '@/pages/mission-control/hooks/useMissionControl'
import { useMissionControl } from '@/pages/mission-control/hooks/useMissionControl'
import type { BoardViewProps } from './board-view-props'
import {
  deriveCounts,
  mergeActivity,
  perStageCounts,
  throughputBuckets,
  PRIORITY_KEYS,
  type ActivityItem,
} from './board-dashboard-utils'
import { t, tOr } from './i18n'

const THROUGHPUT_DAYS = 14
const ACTIVITY_LIMIT = 12

// Keeps the useMemo deps referentially stable while no snapshot has arrived.
const NO_AGENTS: AgentRunSnapshot[] = []

// Chart series need concrete colors (recharts paints SVG, not classes), so
// these mirror the Tailwind priority dots from board-list.tsx as hsl literals —
// the same convention observability-page.tsx uses for its CHART_COLORS.
const PRIORITY_FILL: Record<string, string> = {
  urgent: 'hsl(0, 84%, 60%)',
  high: 'hsl(25, 95%, 53%)',
  normal: 'hsl(217, 91%, 60%)',
  low: 'hsl(240, 5%, 34%)',
}
const FALLBACK_FILL = 'hsl(220, 9%, 46%)'

// Colors copied from conversations/components/run-tree.tsx. The `motion-safe:`
// prefix is the one change: it keeps the pulse but honours prefers-reduced-motion.
const STATUS_DOT: Record<string, string> = {
  running: 'bg-blue-400 motion-safe:animate-pulse',
  working: 'bg-blue-400 motion-safe:animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  error: 'bg-red-400',
  cancelled: 'bg-zinc-400',
  idle: 'bg-zinc-400',
  paused: 'bg-amber-400',
  waiting: 'bg-amber-400',
  waiting_approval: 'bg-amber-400',
}

const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: 11,
} as const

function relativeTime(ts: number, now: number): string {
  const mins = Math.floor(Math.max(0, now - ts) / 60_000)
  if (mins < 1) return t('board.list.time.justNow')
  if (mins < 60) return t('board.list.time.minutes', { count: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('board.list.time.hours', { count: hrs })
  return t('board.list.time.days', { count: Math.floor(hrs / 24) })
}

function StatTile({
  label,
  value,
  icon: Icon,
  muted,
}: {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
  muted?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card px-2.5 py-2">
      <div className="flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn('mt-1 text-lg font-semibold leading-none tabular-nums', muted && 'text-muted-foreground/40')}>
        {value}
      </p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-2.5">
      <h3 className="mb-2 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">{title}</h3>
      {children}
    </div>
  )
}

function ActivityRow({ item, now, onOpen }: { item: ActivityItem; now: number; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => item.conversationId && onOpen(item.conversationId)}
      className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left transition-colors hover:bg-accent/10"
    >
      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', STATUS_DOT[item.status] ?? 'bg-zinc-400')} />
      {item.kind === 'agent' && <Bot className="h-2.5 w-2.5 flex-shrink-0 text-muted-foreground/50" />}
      <span className="truncate text-[10px] font-medium text-foreground">{item.title || t('board.card.untitled')}</span>
      {item.detail && <span className="truncate text-[9px] text-muted-foreground/60">{item.detail}</span>}
      <span className="ml-auto flex-shrink-0 text-[9px] tabular-nums text-muted-foreground/40">
        {relativeTime(item.timestamp, now)}
      </span>
    </button>
  )
}

function RunningCard({ agent, onOpen }: { agent: AgentRunSnapshot; onOpen: (id: string) => void }) {
  const pct = agent.maxTurns > 0 ? Math.min(100, Math.round((agent.currentTurn / agent.maxTurns) * 100)) : 0
  return (
    <button
      type="button"
      onClick={() => onOpen(agent.sessionId)}
      className="w-full rounded border border-border/40 px-2 py-1.5 text-left transition-colors hover:bg-accent/10"
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', STATUS_DOT.running)} />
        <span className="truncate text-[10px] font-medium text-foreground">{agent.agentName}</span>
        <span className="ml-auto flex-shrink-0 text-[9px] tabular-nums text-muted-foreground/50">
          {agent.currentTurn}/{agent.maxTurns}
        </span>
      </div>
      {agent.currentAction && (
        <p className="mt-0.5 truncate text-[9px] text-muted-foreground/60">{agent.currentAction}</p>
      )}
      <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[9px] tabular-nums text-muted-foreground/40">
        {agent.tokensUsed.toLocaleString()} · ${agent.costUsd.toFixed(2)}
      </p>
    </button>
  )
}

export function BoardDashboard({ stages }: BoardViewProps) {
  const navigate = useNavigate()
  const { snapshot, connection } = useMissionControl()

  // A slow tick keeps "done today", the throughput window and the relative
  // timestamps honest without re-deriving on every render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const agents = snapshot?.agents ?? NO_AGENTS
  const totals = snapshot?.totals ?? null
  const isLive = connection === 'open'

  const counts = useMemo(() => deriveCounts(stages, now), [stages, now])
  const throughput = useMemo(() => throughputBuckets(stages, THROUGHPUT_DAYS, now), [stages, now])
  const perStage = useMemo(() => perStageCounts(stages), [stages])
  const activity = useMemo(() => mergeActivity(stages, agents, ACTIVITY_LIMIT), [stages, agents])
  const running = useMemo(() => agents.filter((a) => a.status === 'running'), [agents])

  const priorityEntries = useMemo(() => {
    const known = PRIORITY_KEYS.map((key) => ({ key: key as string, count: counts.byPriority[key] ?? 0 }))
    const extra = Object.keys(counts.byPriority)
      .filter((key) => !PRIORITY_KEYS.includes(key as (typeof PRIORITY_KEYS)[number]))
      .map((key) => ({ key, count: counts.byPriority[key] }))
    return [...known, ...extra]
  }, [counts])

  const priorityRow = useMemo(() => {
    const row: Record<string, number> = {}
    for (const entry of priorityEntries) row[entry.key] = entry.count
    return [row]
  }, [priorityEntries])

  const priorityTotal = priorityEntries.reduce((sum, e) => sum + e.count, 0)
  const openConversation = (id: string) =>
    navigate({ to: '/conversations/$conversationId', params: { conversationId: id } })

  if (priorityTotal === 0 && agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-[11px]">
        {t('board.empty.dashboard')}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="space-y-2.5">
        {/* Connection state */}
        <div className="flex items-center justify-end gap-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/60">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              isLive ? 'bg-emerald-400 motion-safe:animate-pulse' : 'bg-zinc-400',
            )}
          />
          {isLive ? t('board.dashboard.live') : t('board.dashboard.offline')}
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <StatTile label={t('board.dashboard.openTasks')} value={String(counts.open)} icon={ListChecks} />
          <StatTile label={t('board.dashboard.wip')} value={String(counts.wip)} icon={Loader2} />
          <StatTile label={t('board.dashboard.doneToday')} value={String(counts.doneToday)} icon={CircleDot} />
          <StatTile
            label={t('board.dashboard.running')}
            value={totals ? String(totals.running) : '—'}
            icon={Bot}
            muted={!totals}
          />
          <StatTile
            label={t('board.dashboard.waiting')}
            value={totals ? String(totals.waiting) : '—'}
            icon={PauseCircle}
            muted={!totals}
          />
          <StatTile
            label={t('board.dashboard.completedToday')}
            value={totals ? String(totals.completedToday) : '—'}
            icon={Clock}
            muted={!totals}
          />
          <StatTile
            label={t('board.dashboard.costToday')}
            value={totals ? `$${totals.costTodayUsd.toFixed(2)}` : '—'}
            icon={CircleDollarSign}
            muted={!totals}
          />
        </div>

        {/* Distributions */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
          <Panel title={t('board.dashboard.priorityMix')}>
            {priorityTotal > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={28}>
                  <BarChart data={priorityRow} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" hide />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={false} />
                    {priorityEntries
                      .filter((e) => e.count > 0)
                      .map((entry) => (
                        <Bar
                          key={entry.key}
                          dataKey={entry.key}
                          name={tOr(`board.priority.${entry.key}`, entry.key)}
                          stackId="priority"
                          fill={PRIORITY_FILL[entry.key] ?? FALLBACK_FILL}
                        />
                      ))}
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-0.5">
                  {priorityEntries.map((entry) => (
                    <div key={entry.key} className="flex items-center gap-1.5 text-[9px]">
                      <span
                        className="h-1.5 w-1.5 flex-shrink-0 rounded-sm"
                        style={{ backgroundColor: PRIORITY_FILL[entry.key] ?? FALLBACK_FILL }}
                      />
                      <span className="flex-1 truncate text-muted-foreground">
                        {tOr(`board.priority.${entry.key}`, entry.key)}
                      </span>
                      <span className="tabular-nums text-muted-foreground/60">{entry.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="py-4 text-center text-[10px] text-muted-foreground/50">{t('board.empty.dashboard')}</p>
            )}
          </Panel>

          <Panel title={t('board.dashboard.perStage')}>
            {perStage.length > 0 ? (
              <ResponsiveContainer width="100%" height={124}>
                <BarChart data={perStage} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9 }}
                    stroke="hsl(var(--muted-foreground))"
                    interval={0}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--accent))', fillOpacity: 0.15 }} />
                  <Bar dataKey="count" name={t('board.dashboard.perStage')} radius={[2, 2, 0, 0]}>
                    {perStage.map((stage, i) => (
                      <Cell key={i} fill={stage.color ?? FALLBACK_FILL} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-4 text-center text-[10px] text-muted-foreground/50">{t('board.empty.dashboard')}</p>
            )}
          </Panel>

          <Panel title={t('board.dashboard.throughput')}>
            <ResponsiveContainer width="100%" height={124}>
              <LineChart data={throughput} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9 }}
                  stroke="hsl(var(--muted-foreground))"
                  tickFormatter={(v: string) => v.slice(5)}
                  tickLine={false}
                  minTickGap={12}
                />
                <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="count"
                  name={t('board.dashboard.throughput')}
                  stroke="hsl(217, 91%, 60%)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        {/* Activity + running now */}
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel title={t('board.dashboard.activity')}>
              {activity.length > 0 ? (
                <div className="space-y-px">
                  {activity.map((item) => (
                    <ActivityRow key={item.id} item={item} now={now} onOpen={openConversation} />
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-[10px] text-muted-foreground/50">{t('board.empty.dashboard')}</p>
              )}
            </Panel>
          </div>

          <Panel title={t('board.dashboard.runningNow')}>
            {running.length > 0 ? (
              <div className="space-y-1.5">
                {running.map((agent) => (
                  <RunningCard key={agent.sessionId} agent={agent} onOpen={openConversation} />
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-[10px] text-muted-foreground/50">
                {isLive ? t('board.empty.dashboard') : t('board.dashboard.offline')}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}
