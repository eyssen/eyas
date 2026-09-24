// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, TrendingUp, Zap } from 'lucide-react'
import { t } from '../i18n'

interface AgentBudgetItem {
  id: string
  name: string
  avatar?: string
  enabled: boolean
  monthlyTokenBudget?: number
  tokensUsedThisMonth?: number
}

type AlertLevel = 'normal' | 'warning' | 'exceeded' | 'critical'

function getAlertLevel(used: number, budget: number): AlertLevel {
  const pct = (used / budget) * 100
  if (pct >= 100) return 'critical'
  if (pct >= 90) return 'exceeded'
  if (pct >= 70) return 'warning'
  return 'normal'
}

const alertColors: Record<AlertLevel, string> = {
  normal: 'bg-purple-500',
  warning: 'bg-amber-500',
  exceeded: 'bg-orange-500',
  critical: 'bg-red-500',
}

const alertBadgeVariants: Record<AlertLevel, { labelKey: string; className: string }> = {
  normal: { labelKey: 'agents.budget.alert.normal', className: 'text-emerald-500' },
  warning: { labelKey: 'agents.budget.alert.warning', className: 'text-amber-500' },
  exceeded: { labelKey: 'agents.budget.alert.exceeded', className: 'text-orange-500' },
  critical: { labelKey: 'agents.budget.alert.critical', className: 'text-red-500' },
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

export function BudgetDashboard() {
  const { data, isLoading, error } = useApi<{ agents: AgentBudgetItem[] }>('/agents')

  const agents = (data?.agents ?? []).filter(
    (a) => a.enabled && a.monthlyTokenBudget && a.monthlyTokenBudget > 0
  )

  const totalUsed = agents.reduce((sum, a) => sum + (a.tokensUsedThisMonth ?? 0), 0)
  const totalBudget = agents.reduce((sum, a) => sum + (a.monthlyTokenBudget ?? 0), 0)
  const totalPct = totalBudget > 0 ? Math.min((totalUsed / totalBudget) * 100, 100) : 0

  // Project monthly usage based on current day of month
  const dayOfMonth = new Date().getDate()
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const projectedMonthly = dayOfMonth > 0 ? Math.round(totalUsed * (daysInMonth / dayOfMonth)) : totalUsed

  const alertAgents = agents.filter((a) => {
    const level = getAlertLevel(a.tokensUsedThisMonth ?? 0, a.monthlyTokenBudget!)
    return level !== 'normal'
  })

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">{t('agents.budget.loading')}</div>
  }

  if (error) {
    return <div className="text-sm text-destructive">{t('agents.budget.loadError')}</div>
  }

  if (agents.length === 0) {
    return (
      <div className="glass-card p-6 text-center text-sm text-muted-foreground">
        {t('agents.budget.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Zap className="h-3.5 w-3.5" />
            {t('agents.budget.totalUsage')}
          </div>
          <div className="text-lg font-semibold">{formatTokens(totalUsed)}</div>
          <div className="text-[10px] text-muted-foreground">{t('agents.budget.ofBudget', { budget: formatTokens(totalBudget) })}</div>
          <div className="h-1.5 rounded-full bg-accent/40 overflow-hidden mt-2">
            <div
              className={`h-full rounded-full transition-all ${totalPct > 80 ? 'bg-red-500' : totalPct > 50 ? 'bg-amber-500' : 'bg-purple-500'}`}
              style={{ width: `${totalPct}%` }}
            />
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <TrendingUp className="h-3.5 w-3.5" />
            {t('agents.budget.projectedMonthly')}
          </div>
          <div className="text-lg font-semibold">{formatTokens(projectedMonthly)}</div>
          <div className={`text-[10px] ${projectedMonthly > totalBudget ? 'text-red-400' : 'text-muted-foreground'}`}>
            {projectedMonthly > totalBudget ? t('agents.budget.overBudget') : t('agents.budget.withinBudget')}
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('agents.budget.alerts')}
          </div>
          <div className="text-lg font-semibold">{alertAgents.length}</div>
          <div className="text-[10px] text-muted-foreground">
            {alertAgents.length === 0 ? t('agents.budget.allOnTrack') : t('agents.budget.needAttention')}
          </div>
        </div>
      </div>

      {/* Per-agent usage bars */}
      <div className="glass-card p-4">
        <h3 className="text-xs font-medium mb-3">{t('agents.budget.perAgentUsage')}</h3>
        <div className="space-y-3">
          {agents
            .sort((a, b) => {
              const pctA = (a.tokensUsedThisMonth ?? 0) / (a.monthlyTokenBudget ?? 1)
              const pctB = (b.tokensUsedThisMonth ?? 0) / (b.monthlyTokenBudget ?? 1)
              return pctB - pctA
            })
            .map((agent) => {
              const used = agent.tokensUsedThisMonth ?? 0
              const budget = agent.monthlyTokenBudget!
              const pct = Math.min((used / budget) * 100, 100)
              const level = getAlertLevel(used, budget)
              const badgeInfo = alertBadgeVariants[level]

              return (
                <div key={agent.id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">
                        {agent.avatar ?? ''}
                      </span>
                      <span className="text-xs font-medium">{agent.name}</span>
                      {level !== 'normal' && (
                        <Badge variant="outline" className={`text-[9px] ${badgeInfo.className}`}>
                          {t(badgeInfo.labelKey)}
                        </Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {formatTokens(used)} / {formatTokens(budget)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-accent/40 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${alertColors[level]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
