// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useMemo } from 'react'
import { AgentCard } from './AgentCard'
import { useMissionControl } from './hooks/useMissionControl'
import { useAgentActions } from './hooks/useAgentActions'
import { t } from './i18n'
import './agent-card-style.css'
import { ContextualHelp } from '@/components/docs/contextual-help'

export interface MissionControlProps {
  /** Current user id for permission checks (non-admin can only act on own sessions). */
  currentUserId?: string
  /** Whether the current user is admin (can act on any session). */
  isAdmin?: boolean
  /** Callback when the user clicks "Open conversation" on a card. */
  onOpenConversation?(sessionId: string): void
}

export default function MissionControl({
  currentUserId,
  isAdmin,
  onOpenConversation,
}: MissionControlProps) {
  const { snapshot, connection, error } = useMissionControl()
  const { run, pending } = useAgentActions()

  const sorted = useMemo(() => {
    if (!snapshot) return []
    const order: Record<string, number> = {
      waiting_approval: 0,
      running: 1,
      paused: 2,
      idle: 3,
      failed: 4,
      completed: 5,
      cancelled: 6,
    }
    return [...snapshot.agents].sort((a, b) => {
      const byStatus = (order[a.status] ?? 9) - (order[b.status] ?? 9)
      if (byStatus !== 0) return byStatus
      return b.lastUpdatedAt - a.lastUpdatedAt
    })
  }, [snapshot])

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">{t('missionControl.title')} <ContextualHelp helpId="agents.runs" /></h1>
          <p className="text-xs text-slate-400">{t('missionControl.subtitle')}</p>
        </div>
        {connection !== 'open' && (
          <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-200">
            {t('missionControl.disconnected')}
          </span>
        )}
      </header>

      {snapshot && (
        <div className="mc-totals">
          <TotalsCard
            label={t('missionControl.totals.running')}
            value={snapshot.totals.running}
            tone="emerald"
          />
          <TotalsCard
            label={t('missionControl.totals.waiting')}
            value={snapshot.totals.waiting}
            tone="amber"
          />
          <TotalsCard
            label={t('missionControl.totals.completedToday')}
            value={snapshot.totals.completedToday}
            tone="slate"
          />
          <TotalsCard
            label={t('missionControl.totals.costToday')}
            value={`$${snapshot.totals.costTodayUsd.toFixed(2)}`}
            tone="slate"
          />
        </div>
      )}

      {error && (
        <div className="rounded bg-rose-500/15 px-3 py-2 text-xs text-rose-200">{error}</div>
      )}

      {snapshot && snapshot.agents.length === 0 ? (
        <div className="rounded border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
          {t('missionControl.empty')}
        </div>
      ) : (
        <div className="mc-grid">
          {sorted.map((a) => {
            const canControl = Boolean(isAdmin || (currentUserId && a.ownerUserId === currentUserId))
            return (
              <AgentCard
                key={a.sessionId}
                agent={a}
                onAction={(sid, action) => void run(sid, action)}
                pendingAction={pending[a.sessionId] ?? null}
                canControl={canControl}
                onOpen={onOpenConversation}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function TotalsCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone: 'emerald' | 'amber' | 'slate'
}) {
  const toneCls =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : 'text-slate-200'
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  )
}
