// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sparkles,
  Search,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Clock,
  BarChart3,
  Zap,
} from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface EvolutionCandidate {
  id: string
  name: string
  description: string
  triggerPatterns: string[]
  content: string
  reasoning: string
  confidence: number
  basedOnSessions: number
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
  reviewedAt?: string
}

const statusConfig: Record<
  EvolutionCandidate['status'],
  { cls: string }
> = {
  pending: { cls: 'text-amber-500 border-amber-500/30 bg-amber-500/10' },
  approved: { cls: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' },
  rejected: { cls: 'text-red-500 border-red-500/30 bg-red-500/10' },
}

export default function SkillEvolutionPage() {
  const { data, isLoading, error, refetch } = useApi<{ candidates: EvolutionCandidate[] }>('/skill-evolution/candidates')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const candidates = (data?.candidates ?? []).filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
  })

  const handleApprove = useCallback(async (id: string) => {
    setActionInProgress(id)
    try {
      await api.post(`/skill-evolution/candidates/${id}/approve`)
      refetch()
    } finally {
      setActionInProgress(null)
    }
  }, [refetch])

  const handleReject = useCallback(async (id: string) => {
    setActionInProgress(id)
    try {
      await api.post(`/skill-evolution/candidates/${id}/reject`)
      refetch()
    } finally {
      setActionInProgress(null)
    }
  }, [refetch])

  const allCandidates = data?.candidates ?? []
  const pendingCount = allCandidates.filter((c) => c.status === 'pending').length
  const approvedCount = allCandidates.filter((c) => c.status === 'approved').length
  const rejectedCount = allCandidates.filter((c) => c.status === 'rejected').length
  const avgConfidence = allCandidates.length > 0
    ? (allCandidates.reduce((sum, c) => sum + c.confidence, 0) / allCandidates.length).toFixed(2)
    : '0'

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('skillEvolution.title')} <ContextualHelp helpId="automation.self-learning" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('skillEvolution.subtitle')}
          </p>
        </div>
      </div>

      {/* Stats overview */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('skillEvolution.status.pending')}</span>
          </div>
          <div className="text-2xl font-bold text-amber-500">{pendingCount}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <Check className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('skillEvolution.status.approved')}</span>
          </div>
          <div className="text-2xl font-bold text-emerald-500">{approvedCount}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <X className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('skillEvolution.status.rejected')}</span>
          </div>
          <div className="text-2xl font-bold text-red-500">{rejectedCount}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('skillEvolution.stat.avgConfidence')}</span>
          </div>
          <div className="text-2xl font-bold">{avgConfidence}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="w-full bg-transparent border border-border-primary rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('skillEvolution.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {['all', 'pending', 'approved', 'rejected'].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(s)}
              className="text-xs capitalize"
            >
              {s === 'all' ? t('skillEvolution.filter.all') : t(`skillEvolution.status.${s}`)}
            </Button>
          ))}
        </div>
      </div>

      {/* Candidates list */}
      <div className="flex flex-col gap-3">
        {candidates.map((candidate) => {
          const expanded = expandedId === candidate.id
          const badge = statusConfig[candidate.status]
          return (
            <div key={candidate.id} className="glass-card p-4">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <Zap className="h-4.5 w-4.5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{candidate.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>
                      {t(`skillEvolution.status.${candidate.status}`)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {t('skillEvolution.sessions', { count: candidate.basedOnSessions })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{candidate.description}</p>

                  {/* Confidence bar */}
                  <div className="flex items-center gap-2 mt-2">
                    <TrendingUp className="h-3 w-3 text-muted-foreground" />
                    <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all"
                        style={{ width: `${candidate.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {(candidate.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  {/* Trigger patterns */}
                  {candidate.triggerPatterns.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {candidate.triggerPatterns.map((p) => (
                        <Badge key={p} variant="secondary" className="text-[10px]">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {candidate.status === 'pending' && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => handleApprove(candidate.id)}
                      disabled={actionInProgress === candidate.id}
                      title={t('skillEvolution.approve')}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                      onClick={() => handleReject(candidate.id)}
                      disabled={actionInProgress === candidate.id}
                      title={t('skillEvolution.reject')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Expand toggle */}
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-2 ml-12"
                onClick={() => setExpandedId(expanded ? null : candidate.id)}
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? t('skillEvolution.hideDetails') : t('skillEvolution.showDetails')}
              </button>

              {expanded && (
                <div className="ml-12 mt-2 space-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('skillEvolution.reasoning')}</div>
                    <p className="text-xs text-muted-foreground">{candidate.reasoning}</p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('skillEvolution.suggestedContent')}</div>
                    <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {candidate.content}
                    </pre>
                  </div>
                  <div className="flex gap-4 text-[10px] text-muted-foreground">
                    <span>{t('skillEvolution.created', { date: new Date(candidate.createdAt).toLocaleString() })}</span>
                    {candidate.reviewedAt && (
                      <span>{t('skillEvolution.reviewed', { date: new Date(candidate.reviewedAt).toLocaleString() })}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {isLoading && candidates.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('skillEvolution.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">{t('skillEvolution.loadError', { message: error.message })}</p>
      )}
      {!isLoading && !error && candidates.length === 0 && (
        <div className="glass-card p-8 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {t('skillEvolution.empty')}
          </p>
        </div>
      )}
    </div>
  )
}
