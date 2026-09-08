// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Brain,
  RefreshCw,
  Coins,
  DollarSign,
  Activity,
  Target,
  TrendingUp,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface EfficiencyReport {
  totalTokens: number
  totalCostUsd: number
  totalSessions: number
  successRate: number
}

interface PatternItem {
  id: string
  name: string
  frequency: number
  lastSeen: string
  category: string
}

interface InsightItem {
  id: string
  type: 'optimization' | 'cost' | 'quality' | 'speed'
  metric: string
  current: string
  suggested: string
  confidence: number
  reasoning: string
}

interface SkillSuggestion {
  id: string
  name: string
  description: string
  reason: string
  confidence: number
}

const insightTypeBadge: Record<InsightItem['type'], { cls: string }> = {
  optimization: { cls: 'text-blue-500 border-blue-500/30' },
  cost: { cls: 'text-emerald-500 border-emerald-500/30' },
  quality: { cls: 'text-purple-500 border-purple-500/30' },
  speed: { cls: 'text-amber-500 border-amber-500/30' },
}

export default function InsightsPage() {
  const { data: reportData, isLoading: reportLoading } = useApi<{ report: EfficiencyReport }>(
    '/self-learning/report?period=weekly',
  )
  const { data: patternsData, isLoading: patternsLoading } = useApi<{ patterns: PatternItem[] }>(
    '/self-learning/patterns',
  )
  const { data: insightsData, isLoading: insightsLoading } = useApi<{ insights: InsightItem[] }>(
    '/self-learning/insights',
  )
  const { data: suggestionsData, isLoading: suggestionsLoading } = useApi<{
    suggestions: SkillSuggestion[]
  }>('/self-learning/skills/suggestions')

  const [analyzing, setAnalyzing] = useState(false)

  const report = reportData?.report
  const patterns = patternsData?.patterns ?? []
  const insights = insightsData?.insights ?? []
  const suggestions = suggestionsData?.suggestions ?? []

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true)
    try {
      await api.post('/self-learning/analyze')
      // Reload all data after analysis
      window.location.reload()
    } finally {
      setAnalyzing(false)
    }
  }, [])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('selfLearning.title')} <ContextualHelp helpId="automation.self-learning" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('selfLearning.subtitle')}
          </p>
        </div>
        <Button size="sm" onClick={handleAnalyze} disabled={analyzing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${analyzing ? 'animate-spin' : ''}`} />
          {analyzing ? t('selfLearning.analyzing') : t('selfLearning.runAnalysis')}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          {
            label: t('selfLearning.card.totalTokens'),
            value: report ? report.totalTokens.toLocaleString() : '—',
            icon: Coins,
            color: 'text-blue-400',
            bg: 'bg-blue-500/20',
          },
          {
            label: t('selfLearning.card.totalCost'),
            value: report ? `$${report.totalCostUsd.toFixed(2)}` : '—',
            icon: DollarSign,
            color: 'text-emerald-400',
            bg: 'bg-emerald-500/20',
          },
          {
            label: t('selfLearning.card.sessions'),
            value: report ? report.totalSessions.toString() : '—',
            icon: Activity,
            color: 'text-purple-400',
            bg: 'bg-purple-500/20',
          },
          {
            label: t('selfLearning.card.successRate'),
            value: report ? `${Math.round(report.successRate * 100)}%` : '—',
            icon: Target,
            color: 'text-amber-400',
            bg: 'bg-amber-500/20',
          },
        ].map((card) => (
          <div key={card.label} className="glass-card p-4 flex items-center gap-3">
            <div
              className={`h-10 w-10 rounded-xl ${card.bg} flex items-center justify-center flex-shrink-0`}
            >
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{card.label}</p>
              <p className="text-lg font-semibold">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {reportLoading && <p className="text-sm text-muted-foreground mb-4">{t('selfLearning.loadingReport')}</p>}

      {/* Execution Insights */}
      <div className="mb-6">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {t('selfLearning.executionInsights')}
          {insights.length > 0 && (
            <span className="text-xs text-muted-foreground">({insights.length})</span>
          )}
        </h2>

        <div className="flex flex-col gap-2">
          {insights.map((insight) => {
            const badge = insightTypeBadge[insight.type]
            return (
              <div key={insight.id} className="glass-card p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>
                      {t(`selfLearning.insightType.${insight.type}`)}
                    </Badge>
                    <span className="text-sm font-medium">{insight.metric}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs mb-2">
                    <span className="text-muted-foreground">{insight.current}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="text-foreground font-medium">{insight.suggested}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{insight.reasoning}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="w-20 h-1.5 rounded-full bg-accent/40 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{ width: `${Math.round(insight.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {t('selfLearning.confidence', { value: Math.round(insight.confidence * 100) })}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {insightsLoading && insights.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('selfLearning.loadingInsights')}</p>
        )}
        {!insightsLoading && insights.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('selfLearning.noInsights')}
          </p>
        )}
      </div>

      {/* Activity Patterns */}
      <div className="mb-6">
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {t('selfLearning.activityPatterns')}
          {patterns.length > 0 && (
            <span className="text-xs text-muted-foreground">({patterns.length})</span>
          )}
        </h2>

        <div className="flex flex-col gap-2">
          {patterns.map((pattern) => (
            <div key={pattern.id} className="glass-card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{pattern.name}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {pattern.category}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('selfLearning.patternSeen', { count: pattern.frequency, date: new Date(pattern.lastSeen).toLocaleDateString() })}
                </p>
              </div>
            </div>
          ))}
        </div>

        {patternsLoading && patterns.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('selfLearning.loadingPatterns')}</p>
        )}
        {!patternsLoading && patterns.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('selfLearning.noPatterns')}
          </p>
        )}
      </div>

      {/* Skill Suggestions */}
      <div>
        <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {t('selfLearning.skillSuggestions')}
          {suggestions.length > 0 && (
            <span className="text-xs text-muted-foreground">({suggestions.length})</span>
          )}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="glass-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium">{suggestion.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{suggestion.description}</p>
              <p className="text-[11px] text-muted-foreground mt-2 italic">{suggestion.reason}</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-16 h-1.5 rounded-full bg-accent/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-500"
                    style={{ width: `${Math.round(suggestion.confidence * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>

        {suggestionsLoading && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('selfLearning.loadingSuggestions')}</p>
        )}
        {!suggestionsLoading && suggestions.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('selfLearning.noSuggestions')}
          </p>
        )}
      </div>
    </div>
  )
}
