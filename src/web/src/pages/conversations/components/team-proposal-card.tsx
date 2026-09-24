// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Users, AlertTriangle, CheckCircle, XCircle, Edit2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useConversationStore } from '@/stores/conversation-store'
import type { TeamSessionState } from '@/stores/team-session-store'
import { t } from '../i18n'

interface TeamProposalCardProps {
  sessionId: string
  proposal: NonNullable<TeamSessionState['proposal']>
  onApproved(): void
  onRejected(): void
}

export function TeamProposalCard({ sessionId, proposal, onApproved, onRejected }: TeamProposalCardProps) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [gapsDismissed, setGapsDismissed] = useState<Set<number>>(new Set())
  const [showPhases, setShowPhases] = useState(true)

  const activeGaps = proposal.agentGaps.filter((_, i) => !gapsDismissed.has(i))

  const handleApprove = async () => {
    setLoading(true)
    try {
      await api.post(`/team-sessions/${sessionId}/approve`, {})
      onApproved()
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setRejecting(true)
    try {
      await api.post(`/team-sessions/${sessionId}/reject`, {})
      onRejected()
    } finally {
      setRejecting(false)
    }
  }

  const handleCreateAgent = (gap: NonNullable<TeamSessionState['proposal']>['agentGaps'][0]) => {
    const pendingMessage = `Create a new agent with the following profile:
Name: ${gap.suggestedName}
Role: ${gap.suggestedRole}
Capabilities: ${gap.capabilities.join(', ')}
Context: ${gap.reason}`

    useConversationStore.getState().setPendingMessage(pendingMessage)
    navigate({ to: '/agents' })
  }

  const estimatedCost = proposal.estimatedCostUsd < 0.01
    ? '<$0.01'
    : `~$${proposal.estimatedCostUsd.toFixed(2)}`

  return (
    <div className="glass-card border border-primary/20 rounded-lg overflow-hidden my-2">
      <div className="flex items-center gap-2 px-4 py-3 bg-primary/5 border-b border-primary/10">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">{t('conversations.teamProposal.title')}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('conversations.teamProposal.usage', { tokens: proposal.estimatedTokens.toLocaleString(), cost: estimatedCost })}
        </span>
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/30">
        {proposal.reasoning}
      </div>

      <div className="px-4 py-2 border-b border-border/30">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-2 hover:text-primary transition-colors"
          onClick={() => setShowPhases(!showPhases)}
        >
          {showPhases ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {t('conversations.teamProposal.phases', { count: proposal.phases.length })}
        </button>

        {showPhases && (
          <div className="space-y-2">
            {proposal.phases.map((phase, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-[10px] text-muted-foreground mt-0.5 w-12 text-right shrink-0">
                  {t('conversations.teamProposal.phaseN', { n: i + 1 })}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium capitalize">{phase.name}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {phase.parallel ? t('conversations.teamProposal.parallel') : t('conversations.teamProposal.sequential')}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {phase.agents.map(agentId => (
                      <Badge key={agentId} variant="secondary" className="text-[9px]">
                        {agentId}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeGaps.length > 0 && (
        <div className="px-4 py-2 border-b border-border/30 bg-amber-500/5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500 mb-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('conversations.teamProposal.missingSpecialists', { count: activeGaps.length })}
          </div>
          <div className="space-y-2">
            {proposal.agentGaps.map((gap, i) => {
              if (gapsDismissed.has(i)) return null
              return (
                <div key={i} className="text-xs space-y-1">
                  <div className="font-medium">{gap.suggestedName}</div>
                  <div className="text-muted-foreground">{gap.reason}</div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={() => handleCreateAgent(gap)}
                    >
                      {t('conversations.teamProposal.createNow')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] text-muted-foreground"
                      onClick={() => setGapsDismissed(prev => new Set([...prev, i]))}
                    >
                      {gap.canProceedWithout ? t('conversations.teamProposal.skip') : t('conversations.teamProposal.skipRisky')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-3">
        <Button size="sm" onClick={handleApprove} disabled={loading} className="h-7 text-xs">
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          {t('conversations.teamProposal.approve')}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled title={t('conversations.teamProposal.editSoon')}>
          <Edit2 className="h-3.5 w-3.5 mr-1" />
          {t('conversations.teamProposal.edit')}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={handleReject} disabled={rejecting}>
          <XCircle className="h-3.5 w-3.5 mr-1" />
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
