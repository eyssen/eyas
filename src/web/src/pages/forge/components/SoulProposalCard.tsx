// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, X, TrendingUp, Brain } from 'lucide-react'
import { t } from '../i18n'

export interface SoulProposal {
  id: string
  target: string
  targetId: string
  scope: string
  title: string
  description: string
  currentValue: string
  proposedValue: string
  reasoning: string
  confidence: number
  basedOnFeedbacks: number
  status: string
  createdAt: string
}

interface Props {
  proposal: SoulProposal
  onApply: (id: string) => void
  onReject: (id: string) => void
  actionInProgress?: boolean
}

export function SoulProposalCard({ proposal, onApply, onReject, actionInProgress }: Props) {
  return (
    <div className="glass-card p-4 border border-purple-500/20">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          <Brain className="h-4 w-4 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Title + badges */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-sm">{proposal.title}</span>
            <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30 bg-purple-400/10">
              Soul · {proposal.targetId}
            </Badge>
            <Badge variant="outline" className="text-[10px] text-violet-400 border-violet-400/30">
              {proposal.scope}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">{proposal.description}</p>

          {/* Confidence bar */}
          <div className="flex items-center gap-2 mt-2">
            <TrendingUp className="h-3 w-3 text-muted-foreground" />
            <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all"
                style={{ width: `${proposal.confidence * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {(proposal.confidence * 100).toFixed(0)}%
            </span>
          </div>

          {/* Current vs proposed */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                {t('forge.soulProposal.currentValue')}
              </div>
              <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                {proposal.currentValue || '—'}
              </pre>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                {t('forge.soulProposal.proposedValue')}
              </div>
              <pre className="text-[11px] text-emerald-400/80 bg-accent/30 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                {proposal.proposedValue || '—'}
              </pre>
            </div>
          </div>

          {/* Reasoning */}
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              {t('forge.soulProposal.reasoning')}
            </div>
            <p className="text-xs text-muted-foreground">{proposal.reasoning}</p>
          </div>

          {/* Meta */}
          <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
            <span>{t('forge.soulProposal.basedOn', { count: proposal.basedOnFeedbacks })}</span>
            <span>{new Date(proposal.createdAt).toLocaleDateString('hu-HU')}</span>
          </div>
        </div>

        {/* Actions */}
        {proposal.status === 'pending' && (
          <div className="flex gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
              onClick={() => onApply(proposal.id)}
              disabled={actionInProgress}
              title={t('forge.soulProposal.approveApply')}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onReject(proposal.id)}
              disabled={actionInProgress}
              title={t('forge.soulProposal.reject')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
