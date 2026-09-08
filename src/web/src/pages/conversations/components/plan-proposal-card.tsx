// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { Map, Check, X, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { t } from '../i18n'

export interface PlanProposal {
  id: string
  goal: string
  steps: { title: string; description?: string; successCriteria?: string }[]
  risks?: { description: string; severity?: string; mitigation?: string }[]
  rollback?: string
}

interface Props {
  conversationId: string
  proposal: PlanProposal
  onAnswered(decision: 'accepted' | 'skipped' | 'rejected'): void
}

export function PlanProposalCard({ conversationId, proposal, onAnswered }: Props) {
  const [busy, setBusy] = useState<'accept' | 'skip' | 'reject' | null>(null)

  const answer = async (kind: 'accept' | 'skip' | 'reject') => {
    setBusy(kind)
    try {
      await api.post(`/conversations/${conversationId}/plan-decision`, {
        accept: kind === 'accept',
        ...(kind === 'skip' ? { skip: true } : {}),
      })
      onAnswered(kind === 'accept' ? 'accepted' : kind === 'skip' ? 'skipped' : 'rejected')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="glass-card p-3 space-y-2 border-l-2 border-l-primary">
      <div className="flex items-center gap-2">
        <Map className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium">{t('conversations.planProposal.heading')}</span>
      </div>

      <p className="text-sm">{proposal.goal}</p>

      {proposal.steps.length > 0 && (
        <ol className="text-xs space-y-1 list-decimal pl-4">
          {proposal.steps.map((step, i) => (
            <li key={i}>
              <span className="font-medium">{step.title}</span>
              {step.successCriteria && (
                <span className="text-muted-foreground"> — {step.successCriteria}</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {proposal.rollback && (
        <p className="text-[11px] text-muted-foreground">{t('conversations.planProposal.rollback')}: {proposal.rollback}</p>
      )}

      <p className="text-xs text-muted-foreground">{t('conversations.planProposal.hint')}</p>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" disabled={busy !== null} onClick={() => void answer('accept')}>
          <Check className="h-3.5 w-3.5 mr-1" />
          {t('conversations.planProposal.approve')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void answer('skip')}>
          <ArrowRight className="h-3.5 w-3.5 mr-1" />
          {t('conversations.planProposal.skip')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void answer('reject')}>
          <X className="h-3.5 w-3.5 mr-1" />
          {t('conversations.planProposal.reject')}
        </Button>
      </div>
    </div>
  )
}
