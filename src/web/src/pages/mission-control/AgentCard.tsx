// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AgentRunSnapshot, AgentRunStatus } from './hooks/useMissionControl'
import type { AgentAction } from './hooks/useAgentActions'
import { t } from './i18n'

export interface AgentCardProps {
  agent: AgentRunSnapshot
  onAction(sessionId: string, action: AgentAction): void
  pendingAction?: AgentAction | null
  canControl: boolean
  onOpen?(sessionId: string): void
}

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  idle: 'bg-slate-400/20 text-slate-300',
  running: 'bg-emerald-400/20 text-emerald-300',
  waiting_approval: 'bg-amber-400/25 text-amber-200',
  paused: 'bg-sky-400/20 text-sky-300',
  completed: 'bg-slate-500/20 text-slate-200',
  failed: 'bg-rose-500/25 text-rose-200',
  cancelled: 'bg-slate-500/20 text-slate-300',
}

export function AgentCard({ agent, onAction, pendingAction, canControl, onOpen }: AgentCardProps) {
  const tokenPct = clamp01(agent.tokensUsed / Math.max(1, agent.tokensBudget))
  const turnPct = clamp01(agent.currentTurn / Math.max(1, agent.maxTurns))
  const isRunning = agent.status === 'running'

  return (
    <div
      className="rounded-lg border border-white/10 bg-slate-900/40 p-4 shadow-sm backdrop-blur-sm"
      data-testid="agent-card"
      data-session-id={agent.sessionId}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-sm font-semibold text-white">{agent.agentName}</div>
          <div className="truncate text-[11px] text-slate-400">{agent.agentId}</div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_COLORS[agent.status] ?? ''}`}
        >
          {t(`missionControl.status.${agent.status}`)}
        </span>
      </div>

      {(agent.team || agent.parentSessionId) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
          {agent.team && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-slate-300" title={agent.team.teamSessionId}>
              {agent.team.role}
            </span>
          )}
          {agent.parentSessionId && (
            <button
              type="button"
              className="text-slate-400 transition-colors hover:text-slate-200"
              title={agent.parentSessionId}
              onClick={() => onOpen?.(agent.parentSessionId!)}
            >
              ↳ {t('missionControl.card.parent')}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2 text-[11px] text-slate-300">
        <Row
          label={t('missionControl.card.turn')}
          value={`${agent.currentTurn} / ${agent.maxTurns}`}
          pct={turnPct}
          barClass="bg-sky-500"
        />
        <Row
          label={t('missionControl.card.tokens')}
          value={`${formatK(agent.tokensUsed)} / ${formatK(agent.tokensBudget)}`}
          pct={tokenPct}
          barClass={tokenPct > 0.85 ? 'bg-rose-500' : 'bg-emerald-500'}
        />
        <div className="flex items-center justify-between">
          <span className="text-slate-400">{t('missionControl.card.cost')}</span>
          <span className="font-mono text-slate-100">${agent.costUsd.toFixed(2)}</span>
        </div>
      </div>

      <div
        className="mt-3 truncate text-[11px] text-slate-300"
        title={agent.currentAction ?? ''}
      >
        {agent.currentAction ?? '—'}
      </div>

      <div className="mt-1 text-[10px] text-slate-500">
        {formatRelative(Date.now() - agent.lastUpdatedAt)}
      </div>

      {agent.pendingApprovals > 0 && (
        <div className="mt-2 rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200">
          {t('missionControl.card.pendingApprovals', { count: agent.pendingApprovals })}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!canControl || !!pendingAction || !isRunning}
          onClick={() => {
            if (window.confirm(t('missionControl.actions.confirmInterrupt'))) {
              onAction(agent.sessionId, 'interrupt')
            }
          }}
          className="rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-300 disabled:opacity-30"
          data-testid="action-interrupt"
        >
          {t('missionControl.actions.interrupt')}
        </button>
        {/* Pause/resume are deliberately absent: the agent session registry has
            no suspend primitive, so both endpoints answer 500 "not supported".
            Interrupt (→ supervisor.cancel) is the only control that works.
            Restore the buttons here once the registry gains real pause/resume —
            the actions and their translations are still in place. */}
        <div className="flex-1" />
        {onOpen && (
          <button
            type="button"
            onClick={() => onOpen(agent.sessionId)}
            className="rounded border border-white/15 px-2 py-1 text-[11px] text-slate-200"
          >
            {t('missionControl.actions.open')}
          </button>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  pct,
  barClass,
}: {
  label: string
  value: string
  pct: number
  barClass: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-100">{value}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-white/5">
        <div className={`h-full ${barClass}`} style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </div>
    </div>
  )
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function formatK(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}K`
}

function formatRelative(ms: number): string {
  if (ms < 0) return t('missionControl.card.lastSeen', { seconds: 0 })
  const s = Math.floor(ms / 1000)
  if (s < 60) return t('missionControl.card.lastSeen', { seconds: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('missionControl.card.lastSeenMinutes', { minutes: m })
  const h = Math.floor(m / 60)
  return t('missionControl.card.lastSeenHours', { hours: h })
}
