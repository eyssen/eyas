// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { Shield, ShieldAlert, ShieldCheck, ShieldX, Filter } from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface SecurityEvent {
  id: string
  timestamp: string
  tool: string
  decision: 'allow' | 'deny' | 'escalate'
  checkpoint: string
  riskTier: 'low' | 'medium' | 'high' | 'critical'
  agentId?: string
  agentName?: string
  reason?: string
}

interface SecurityEventsResponse {
  events: SecurityEvent[]
  total: number
}

const decisionConfig: Record<string, { className: string; icon: typeof ShieldCheck }> = {
  allow: { className: 'text-emerald-500', icon: ShieldCheck },
  deny: { className: 'text-red-500', icon: ShieldX },
  escalate: { className: 'text-amber-500', icon: ShieldAlert },
}

const riskColors: Record<string, string> = {
  low: 'text-emerald-500',
  medium: 'text-amber-500',
  high: 'text-orange-500',
  critical: 'text-red-500',
}

type DecisionFilter = 'all' | 'allow' | 'deny' | 'escalate'
type RiskFilter = 'all' | 'low' | 'medium' | 'high' | 'critical'

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function SecurityEventsPage() {
  const { data, isLoading, error } = useApi<SecurityEventsResponse>('/security/events')
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('all')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [checkpointFilter, setCheckpointFilter] = useState('')

  const events = data?.events ?? []

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (decisionFilter !== 'all' && e.decision !== decisionFilter) return false
      if (riskFilter !== 'all' && e.riskTier !== riskFilter) return false
      if (checkpointFilter && !e.checkpoint.toLowerCase().includes(checkpointFilter.toLowerCase())) return false
      return true
    })
  }, [events, decisionFilter, riskFilter, checkpointFilter])

  // Stats
  const totalEvents = events.length
  const denials = events.filter((e) => e.decision === 'deny').length
  const denialRate = totalEvents > 0 ? ((denials / totalEvents) * 100).toFixed(1) : '0'
  const topBlockedTools = useMemo(() => {
    const counts: Record<string, number> = {}
    events
      .filter((e) => e.decision === 'deny')
      .forEach((e) => {
        counts[e.tool] = (counts[e.tool] ?? 0) + 1
      })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  }, [events])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('security.title')} <ContextualHelp helpId="admin.security" /></h1>
          <p className="text-sm text-muted-foreground">{t('security.subtitle')}</p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Shield className="h-3.5 w-3.5" />
            {t('security.stat.totalEvents')}
          </div>
          <div className="text-lg font-semibold">{totalEvents.toLocaleString()}</div>
        </div>
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ShieldX className="h-3.5 w-3.5" />
            {t('security.stat.denialRate')}
          </div>
          <div className="text-lg font-semibold">{denialRate}%</div>
          <div className="text-[10px] text-muted-foreground">{t('security.stat.denied', { count: denials })}</div>
        </div>
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            {t('security.stat.topBlockedTools')}
          </div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {topBlockedTools.length > 0 ? (
              topBlockedTools.map(([tool, count]) => (
                <Badge key={tool} variant="outline" className="text-[9px] text-red-400">
                  {tool} ({count})
                </Badge>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground">{t('security.stat.none')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />

        <div className="flex gap-1 text-xs">
          {(['all', 'allow', 'deny', 'escalate'] as const).map((f) => (
            <button
              key={f}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                decisionFilter === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setDecisionFilter(f)}
            >
              {t(`security.decision.${f}`)}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border/50" />

        <div className="flex gap-1 text-xs">
          {(['all', 'low', 'medium', 'high', 'critical'] as const).map((f) => (
            <button
              key={f}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                riskFilter === f ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setRiskFilter(f)}
            >
              {t(`security.risk.${f}`)}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border/50" />

        <input
          type="text"
          value={checkpointFilter}
          onChange={(e) => setCheckpointFilter(e.target.value)}
          placeholder={t('security.filterCheckpoint')}
          className="h-7 px-2 text-xs rounded-md border border-border/50 bg-background focus:outline-none focus:ring-1 focus:ring-ring w-40"
        />
      </div>

      {/* Events table */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.timestamp')}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.tool')}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.decision')}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.checkpoint')}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.risk')}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.agent')}</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('security.col.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.map((event) => {
              const dc = decisionConfig[event.decision]
              const DecisionIcon = dc?.icon ?? Shield
              return (
                <tr key={event.id} className="border-b border-border/10 hover:bg-accent/10 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(event.timestamp)}
                  </td>
                  <td className="px-3 py-2 font-mono">{event.tool}</td>
                  <td className="px-3 py-2">
                    <span className={`flex items-center gap-1 ${dc?.className}`}>
                      <DecisionIcon className="h-3 w-3" />
                      {t(`security.decision.${event.decision}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{event.checkpoint}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-[9px] ${riskColors[event.riskTier] ?? ''}`}>
                      {t(`security.risk.${event.riskTier}`)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{event.agentName ?? event.agentId ?? '-'}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">
                    {event.reason ?? '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredEvents.length === 0 && !isLoading && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {t('security.empty')}
          </div>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground mt-4">{t('security.loading')}</p>
      )}

      {error && (
        <p className="text-sm text-destructive mt-4">{t('security.loadError', { message: error.message })}</p>
      )}
    </div>
  )
}
