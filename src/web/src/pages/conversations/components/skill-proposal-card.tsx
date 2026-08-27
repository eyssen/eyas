// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A matched skill, waiting on a yes or a no. Two buttons and no typing: the
// answer is a decision, not a sentence.
//
// It shows WHY the skill matched, because that is what makes a bad match
// obvious. The failure that produced this card read
// `Google Drive · 0.9 · name: Google Drive` on a request to print the time.

import { useState } from 'react'
import { Sparkles, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { t } from '../i18n'

export interface SkillProposal {
  skillId: string
  name: string
  score: number
  matchedPattern: string
}

interface Props {
  conversationId: string
  proposal: SkillProposal
  /** Answered — the caller records the decision and resumes the turn. */
  onAnswered(accepted: boolean): void
}

export function SkillProposalCard({ conversationId, proposal, onAnswered }: Props) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  const answer = async (accept: boolean) => {
    setBusy(accept ? 'accept' : 'decline')
    try {
      await api.post(`/conversations/${conversationId}/skill-decision`, { skillId: proposal.skillId, accept })
      onAnswered(accept)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="glass-card p-3 space-y-2 border-l-2 border-l-purple-500">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
        <span className="text-sm font-medium">{t('conversations.skillProposal.heading')}</span>
        <Badge variant="secondary" className="ml-auto tabular-nums text-[10px]">
          {proposal.score.toFixed(2)}
        </Badge>
      </div>

      <div className="text-sm">{proposal.name}</div>
      <div className="text-[11px] text-muted-foreground font-mono break-all">{proposal.matchedPattern}</div>
      <p className="text-xs text-muted-foreground">{t('conversations.skillProposal.hint')}</p>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={busy !== null} onClick={() => answer(true)}>
          <Check className="h-3.5 w-3.5 mr-1" />
          {t('conversations.skillProposal.accept')}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => answer(false)}>
          <X className="h-3.5 w-3.5 mr-1" />
          {t('conversations.skillProposal.decline')}
        </Button>
      </div>
    </div>
  )
}
