// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Hammer,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Clock,
  BarChart3,
  Wrench,
  Sparkles,
  RefreshCw,
  MessageSquare,
  Brain,
} from 'lucide-react'
import { SoulProposalCard } from './components/SoulProposalCard'
import type { SoulProposal } from './components/SoulProposalCard'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

// --- Types (matching backend ForgeProposal / ForgeFeedback) ---

type ForgeTarget = 'skill' | 'tool' | 'soul'
type ForgeScope = 'description' | 'schema' | 'prompt' | 'behavior' | 'code'
type ProposalStatus = 'pending' | 'testing' | 'approved' | 'rejected' | 'applied'

interface ForgeProposal {
  id: string
  target: ForgeTarget
  targetId: string
  scope: ForgeScope
  title: string
  description: string
  currentValue: string
  proposedValue: string
  reasoning: string
  confidence: number
  basedOnFeedbacks: number
  status: ProposalStatus
  experimentId: string | null
  createdAt: string
  reviewedAt: string | null
}

interface ForgeFeedback {
  id: string
  target: ForgeTarget
  targetId: string
  conversationId: string
  agentId: string | null
  useful: boolean
  friction: string | null
  betterApproach: string | null
  createdAt: string
}

// --- Status / target / scope badge configs ---

const statusConfig: Record<ProposalStatus, { labelKey: string; cls: string }> = {
  pending: { labelKey: 'forge.page.status.pending', cls: 'text-amber-500 border-amber-500/30 bg-amber-500/10' },
  testing: { labelKey: 'forge.page.status.testing', cls: 'text-blue-500 border-blue-500/30 bg-blue-500/10' },
  approved: { labelKey: 'forge.page.status.approved', cls: 'text-green-500 border-green-500/30 bg-green-500/10' },
  rejected: { labelKey: 'forge.page.status.rejected', cls: 'text-red-500 border-red-500/30 bg-red-500/10' },
  applied: { labelKey: 'forge.page.status.applied', cls: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' },
}

const targetConfig: Record<ForgeTarget, { labelKey: string; cls: string; icon: typeof Wrench }> = {
  tool: { labelKey: 'forge.page.target.tool', cls: 'text-blue-400 border-blue-400/30 bg-blue-400/10', icon: Wrench },
  skill: { labelKey: 'forge.page.target.skill', cls: 'text-purple-400 border-purple-400/30 bg-purple-400/10', icon: Sparkles },
  soul: { labelKey: 'forge.page.target.soul', cls: 'text-violet-400 border-violet-400/30 bg-violet-400/10', icon: Brain },
}

const scopeColors: Record<ForgeScope, string> = {
  description: 'text-sky-400 border-sky-400/30',
  schema: 'text-orange-400 border-orange-400/30',
  prompt: 'text-violet-400 border-violet-400/30',
  behavior: 'text-rose-400 border-rose-400/30',
  code: 'text-teal-400 border-teal-400/30',
}

// --- Main page component ---

export default function ForgePage() {
  const [tab, setTab] = useState<'proposals' | 'feedback'>('proposals')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  const { data: proposalsData, isLoading: loadingProposals, error: errorProposals, refetch: refetchProposals } =
    useApi<{ proposals: ForgeProposal[] }>('/forge/proposals')
  const { data: soulProposalsData, refetch: refetchSoulProposals } =
    useApi<{ proposals: SoulProposal[] }>('/forge/proposals?target=soul')
  const { data: feedbackData, isLoading: loadingFeedback, error: errorFeedback } =
    useApi<{ feedback: ForgeFeedback[] }>('/forge/feedback')

  // --- Computed stats ---
  const allProposals = (proposalsData?.proposals ?? []).filter((p) => p.target !== 'soul')
  const soulProposals = soulProposalsData?.proposals ?? []
  const totalCount = allProposals.length + soulProposals.length
  const pendingCount = allProposals.filter((p) => p.status === 'pending').length + soulProposals.filter((p) => p.status === 'pending').length
  const appliedCount = allProposals.filter((p) => p.status === 'applied').length + soulProposals.filter((p) => p.status === 'applied').length

  // --- Filtered proposals ---
  const proposals = allProposals.filter((p) => statusFilter === 'all' || p.status === statusFilter)
  const filteredSoulProposals = soulProposals.filter((p) => statusFilter === 'all' || p.status === statusFilter)

  // --- Actions ---
  const handleScan = useCallback(async () => {
    setScanning(true)
    setScanMessage(null)
    try {
      const result = await api.post<{ message: string }>('/forge/scan')
      setScanMessage(result.message ?? t('forge.page.scanComplete'))
      refetchProposals()
    } catch (err: any) {
      setScanMessage(t('forge.page.scanFailed', { error: err.message }))
    } finally {
      setScanning(false)
      setTimeout(() => setScanMessage(null), 4000)
    }
  }, [refetchProposals])

  const handleApprove = useCallback(async (id: string) => {
    setActionInProgress(id)
    try {
      await api.post(`/forge/proposals/${id}/approve`)
      refetchProposals()
    } finally {
      setActionInProgress(null)
    }
  }, [refetchProposals])

  const handleReject = useCallback(async (id: string) => {
    setActionInProgress(id)
    try {
      await api.post(`/forge/proposals/${id}/reject`)
      refetchProposals()
    } finally {
      setActionInProgress(null)
    }
  }, [refetchProposals])

  const handleSoulApply = useCallback(async (id: string) => {
    setActionInProgress(id)
    try {
      await api.post(`/forge/proposals/${id}/apply`)
      refetchSoulProposals()
    } finally {
      setActionInProgress(null)
    }
  }, [refetchSoulProposals])

  const handleSoulReject = useCallback(async (id: string) => {
    setActionInProgress(id)
    try {
      await api.post(`/forge/proposals/${id}/reject`)
      refetchSoulProposals()
    } finally {
      setActionInProgress(null)
    }
  }, [refetchSoulProposals])

  // --- Feedback list ---
  const feedbackItems = feedbackData?.feedback ?? []

  return (
    <div>
      {/* Header */}
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('forge.page.title')} <ContextualHelp helpId="agents.forge" /></h1>
          <p className="text-sm text-muted-foreground">
            {t('forge.page.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scanMessage && (
            <span className="text-xs text-muted-foreground animate-in fade-in">{scanMessage}</span>
          )}
          <Button size="sm" onClick={handleScan} disabled={scanning}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${scanning ? 'animate-spin' : ''}`} />
            {t('forge.page.scanNow')}
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('forge.page.stat.total')}</span>
          </div>
          <div className="text-2xl font-bold">{totalCount}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('forge.page.stat.pending')}</span>
          </div>
          <div className="text-2xl font-bold text-amber-500">{pendingCount}</div>
        </div>
        <div className="glass-card p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
            <Check className="h-3.5 w-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-medium">{t('forge.page.stat.applied')}</span>
          </div>
          <div className="text-2xl font-bold text-emerald-500">{appliedCount}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <Button
          variant={tab === 'proposals' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('proposals')}
          className="text-xs"
        >
          {t('forge.page.tab.proposals')}
        </Button>
        <Button
          variant={tab === 'feedback' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('feedback')}
          className="text-xs"
        >
          {t('forge.page.tab.feedback')}
        </Button>
      </div>

      {/* === PROPOSALS TAB === */}
      {tab === 'proposals' && (
        <>
          {/* Status filter */}
          <div className="flex gap-1 mb-4">
            {['all', 'pending', 'testing', 'approved', 'rejected', 'applied'].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className="text-xs"
              >
                {s === 'all' ? t('forge.page.filter.all') : t(`forge.page.status.${s}`)}
              </Button>
            ))}
          </div>

          {/* Proposal cards */}
          <div className="flex flex-col gap-3">
            {proposals.map((proposal) => {
              const expanded = expandedId === proposal.id
              const sBadge = statusConfig[proposal.status]
              const tBadge = targetConfig[proposal.target]
              const TargetIcon = tBadge.icon
              return (
                <div key={proposal.id} className="glass-card p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                      <Hammer className="h-4.5 w-4.5 text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Title row with badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{proposal.title}</span>
                        <Badge variant="outline" className={`text-[10px] ${tBadge.cls}`}>
                          <TargetIcon className="h-2.5 w-2.5 mr-0.5" />
                          {t(tBadge.labelKey)}: {proposal.targetId}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${scopeColors[proposal.scope]}`}>
                          {proposal.scope}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${sBadge.cls}`}>
                          {t(sBadge.labelKey)}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground mt-0.5">{proposal.description}</p>

                      {/* Confidence bar */}
                      <div className="flex items-center gap-2 mt-2">
                        <TrendingUp className="h-3 w-3 text-muted-foreground" />
                        <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
                          <div
                            className="h-full bg-orange-500 rounded-full transition-all"
                            style={{ width: `${proposal.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {(proposal.confidence * 100).toFixed(0)}%
                        </span>
                      </div>

                      {/* Meta line */}
                      <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
                        <span>{t('forge.page.basedOn', { count: proposal.basedOnFeedbacks })}</span>
                        <span>{new Date(proposal.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {/* Approve / Reject for pending */}
                    {proposal.status === 'pending' && (
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => handleApprove(proposal.id)}
                          disabled={actionInProgress === proposal.id}
                          title={t('forge.page.approveApply')}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => handleReject(proposal.id)}
                          disabled={actionInProgress === proposal.id}
                          title={t('forge.page.reject')}
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
                    onClick={() => setExpandedId(expanded ? null : proposal.id)}
                  >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {expanded ? t('forge.page.hideDetails') : t('forge.page.showDetails')}
                  </button>

                  {expanded && (
                    <div className="ml-12 mt-2 space-y-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('forge.page.reasoning')}</div>
                        <p className="text-xs text-muted-foreground">{proposal.reasoning}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('forge.page.currentValue')}</div>
                          <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                            {proposal.currentValue}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('forge.page.proposedValue')}</div>
                          <pre className="text-[11px] text-emerald-400/80 bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                            {proposal.proposedValue}
                          </pre>
                        </div>
                      </div>
                      <div className="flex gap-4 text-[10px] text-muted-foreground">
                        <span>{t('forge.page.created', { date: new Date(proposal.createdAt).toLocaleString() })}</span>
                        {proposal.reviewedAt && (
                          <span>{t('forge.page.reviewed', { date: new Date(proposal.reviewedAt).toLocaleString() })}</span>
                        )}
                        {proposal.experimentId && (
                          <span>{t('forge.page.experiment', { id: proposal.experimentId })}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Soul proposals section */}
          {filteredSoulProposals.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-purple-400" />
                <h3 className="text-sm font-medium">{t('forge.page.soulProposals')}</h3>
                <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30 bg-purple-400/10">
                  {filteredSoulProposals.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-3">
                {filteredSoulProposals.map((sp) => (
                  <SoulProposalCard
                    key={sp.id}
                    proposal={sp}
                    onApply={handleSoulApply}
                    onReject={handleSoulReject}
                    actionInProgress={actionInProgress === sp.id}
                  />
                ))}
              </div>
            </div>
          )}

          {loadingProposals && proposals.length === 0 && (
            <p className="text-sm text-muted-foreground mt-4">{t('forge.page.loadingProposals')}</p>
          )}
          {errorProposals && (
            <p className="text-sm text-destructive mt-4">{t('forge.page.loadProposalsError', { error: errorProposals.message })}</p>
          )}
          {!loadingProposals && !errorProposals && proposals.length === 0 && filteredSoulProposals.length === 0 && (
            <div className="glass-card p-8 text-center">
              <Hammer className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {t('forge.page.emptyProposals')}
              </p>
            </div>
          )}
        </>
      )}

      {/* === FEEDBACK TAB === */}
      {tab === 'feedback' && (
        <>
          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary text-left">
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t('forge.page.feedback.target')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t('forge.page.feedback.id')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t('forge.page.feedback.useful')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t('forge.page.feedback.friction')}</th>
                  <th className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t('forge.page.feedback.date')}</th>
                </tr>
              </thead>
              <tbody>
                {feedbackItems.map((fb) => {
                  const tBadge = targetConfig[fb.target]
                  return (
                    <tr key={fb.id} className="border-b border-border-primary/50 last:border-0">
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={`text-[10px] ${tBadge.cls}`}>
                          {t(tBadge.labelKey)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono">{fb.targetId}</td>
                      <td className="px-4 py-2.5">
                        {fb.useful ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-red-500" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[300px] truncate">
                        {fb.friction ?? '-'}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {new Date(fb.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {loadingFeedback && feedbackItems.length === 0 && (
            <p className="text-sm text-muted-foreground mt-4">{t('forge.page.loadingFeedback')}</p>
          )}
          {errorFeedback && (
            <p className="text-sm text-destructive mt-4">{t('forge.page.loadFeedbackError', { error: errorFeedback.message })}</p>
          )}
          {!loadingFeedback && !errorFeedback && feedbackItems.length === 0 && (
            <div className="glass-card p-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {t('forge.page.emptyFeedback')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
