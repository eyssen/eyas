// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Bell,
  AlertTriangle,
  AlertCircle,
  Info,
  Lightbulb,
  RefreshCw,
  CheckCircle,
  Clock,
  TrendingUp,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface AlertItem {
  id: string
  type: 'anomaly' | 'opportunity' | 'reminder' | 'insight'
  priority: 'urgent' | 'high' | 'normal' | 'low'
  title: string
  body: string
  actionLabel?: string
  actionUrl?: string
  createdAt: string
}

interface LessonItem {
  id: string
  title: string
  summary: string
  confidence: number
  appliedAt?: string
}

const priorityConfig: Record<
  AlertItem['priority'],
  { cls: string; bgCls: string }
> = {
  urgent: { cls: 'text-red-500 border-red-500/30', bgCls: 'bg-red-500/20' },
  high: { cls: 'text-orange-500 border-orange-500/30', bgCls: 'bg-orange-500/20' },
  normal: { cls: 'text-blue-500 border-blue-500/30', bgCls: 'bg-blue-500/20' },
  low: { cls: 'text-zinc-400 border-zinc-400/30', bgCls: 'bg-zinc-500/20' },
}

const typeIcons: Record<AlertItem['type'], typeof Bell> = {
  anomaly: AlertTriangle,
  opportunity: TrendingUp,
  reminder: Clock,
  insight: Lightbulb,
}

export default function ProactiveDashboard() {
  const {
    data: alertsData,
    isLoading: alertsLoading,
    error: alertsError,
    refetch: refetchAlerts,
  } = useApi<{ alerts: AlertItem[] }>('/proactive/alerts')
  const {
    data: lessonsData,
    isLoading: lessonsLoading,
    refetch: refetchLessons,
  } = useApi<{ lessons: LessonItem[] }>('/proactive/lessons')
  const [checking, setChecking] = useState(false)

  const alerts = alertsData?.alerts ?? []
  const lessons = lessonsData?.lessons ?? []

  const handleCheck = useCallback(async () => {
    setChecking(true)
    try {
      await api.post('/proactive/check')
      refetchAlerts()
      refetchLessons()
    } finally {
      setChecking(false)
    }
  }, [refetchAlerts, refetchLessons])

  const urgentCount = alerts.filter((a) => a.priority === 'urgent' || a.priority === 'high').length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('proactive.title')} <ContextualHelp helpId="automation.proactive" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('proactive.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {urgentCount > 0 && (
            <Badge variant="outline" className="text-red-500 border-red-500/30 text-[10px]">
              {t('proactive.urgentCount', { count: urgentCount })}
            </Badge>
          )}
          <Button size="sm" onClick={handleCheck} disabled={checking}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${checking ? 'animate-spin' : ''}`} />
            {checking ? t('proactive.checking') : t('proactive.checkNow')}
          </Button>
        </div>
      </div>

      {/* Active Alerts */}
      <div className="mb-6">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Bell className="h-4 w-4" />
          {t('proactive.activeAlerts')}
          {alerts.length > 0 && (
            <span className="text-xs text-muted-foreground">({alerts.length})</span>
          )}
        </h2>

        <div className="flex flex-col gap-2">
          {alerts.map((alert) => {
            const prio = priorityConfig[alert.priority]
            const TypeIcon = typeIcons[alert.type]
            return (
              <div key={alert.id} className="glass-card p-4 flex items-start gap-3">
                <div
                  className={`h-8 w-8 rounded-lg ${prio.bgCls} flex items-center justify-center flex-shrink-0`}
                >
                  <TypeIcon className={`h-4 w-4 ${prio.cls.split(' ')[0]}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${prio.cls}`}>
                      {t(`proactive.priority.${alert.priority}`)}
                    </Badge>
                    <span className="font-medium text-sm">{alert.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{alert.body}</p>
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    {new Date(alert.createdAt).toLocaleString()}
                  </span>
                </div>
                {alert.actionLabel && (
                  <Button variant="ghost" size="sm" className="flex-shrink-0">
                    {alert.actionLabel}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {alertsLoading && alerts.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('proactive.loadingAlerts')}</p>
        )}
        {alertsError && (
          <p className="text-sm text-destructive">
            {t('proactive.alertsError', { message: alertsError.message })}
          </p>
        )}
        {!alertsLoading && !alertsError && alerts.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            <CheckCircle className="h-5 w-5 mx-auto mb-2 text-emerald-500" />
            {t('proactive.allClear')}
          </p>
        )}
      </div>

      {/* Lessons */}
      <div>
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4" />
          {t('proactive.learnedLessons')}
          {lessons.length > 0 && (
            <span className="text-xs text-muted-foreground">({lessons.length})</span>
          )}
        </h2>

        <div className="flex flex-col gap-2">
          {lessons.map((lesson) => (
            <div key={lesson.id} className="glass-card p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <Lightbulb className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{lesson.title}</span>
                <p className="text-xs text-muted-foreground mt-0.5">{lesson.summary}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <div className="w-16 h-1.5 rounded-full bg-accent/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.round(lesson.confidence * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {t('proactive.confidence', { value: Math.round(lesson.confidence * 100) })}
                </span>
              </div>
            </div>
          ))}
        </div>

        {lessonsLoading && lessons.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('proactive.loadingLessons')}</p>
        )}
        {!lessonsLoading && lessons.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('proactive.noLessons')}
          </p>
        )}
      </div>
    </div>
  )
}
