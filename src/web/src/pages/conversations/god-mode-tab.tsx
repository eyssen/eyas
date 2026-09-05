// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { formatGodUsd } from './god-mode-banner'
import { t } from './i18n'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export function visibleGodTab(godMode: boolean, runCount: number): boolean {
  return godMode || runCount > 0
}

/** Sticky: once a conversation has shown a run, keep that fact across empty refetches. */
export function rememberGodRuns(alreadySeen: boolean, runCount: number): boolean {
  return alreadySeen || runCount > 0
}

export function isTerminalGodStatus(status: string): boolean {
  return TERMINAL.has(status)
}

export function participantHasPeerReview(p: {
  voteFor: string | null
  reviewSummary: string | null
  scores: unknown
  uniqueInsights: string[]
  risks: string[]
}): boolean {
  return Boolean(
    p.voteFor
    || p.reviewSummary
    || p.scores
    || p.uniqueInsights.length > 0
    || p.risks.length > 0,
  )
}

interface GodTabParticipant {
  id: string
  slotId: string
  providerId: string
  modelId: string
  status: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  durationMs: number
  voteFor: string | null
  scores: { quality: number; completeness: number; risk: number } | null
  uniqueInsights: string[]
  risks: string[]
  summary: string | null
  reviewSummary: string | null
  error: string | null
}

interface GodTabDecision {
  method: string
  winnerSlotId: string
  tieBroken: boolean
  chairSlotId: string | null
  votes: Array<{ fromSlotId: string; voteFor: string | null }>
  counts: Record<string, number>
}

interface GodTabTimelineEvent {
  at: string
  phase: string
  key: string
  slotId: string | null
}

interface GodTabRun {
  id: string
  status: string
  winnerParticipantId: string | null
  tieBroken: boolean
  totalTokens: number
  totalCostUsd: number
  durationMs: number
  insights: string[]
  error: string | null
  timeline: GodTabTimelineEvent[]
  decision: GodTabDecision | null
  participants: GodTabParticipant[]
}

interface GodModeTabProps {
  conversationId: string
  conversationStatus?: string
  onRunsDetected?: () => void
}

function chipLabel(providerId: string, modelId: string): string {
  const model = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  return `${providerId}/${model}`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${String(rest).padStart(2, '0')}s`
}

function phaseLabel(phase: string): string {
  return t(`conversations.godMode.phase.${phase}`)
}

function participantStatusLabel(status: string): string {
  return t(`conversations.godMode.participant.${status}`)
}

function votedModel(voteFor: string | null, participants: GodTabParticipant[]): string | null {
  if (!voteFor) return null
  const target = participants.find((p) => p.slotId === voteFor || p.id === voteFor)
  return target ? chipLabel(target.providerId, target.modelId) : voteFor
}

function slotLabel(slotId: string | null | undefined, participants: GodTabParticipant[]): string {
  if (!slotId) return ''
  const p = participants.find((x) => x.slotId === slotId || x.id === slotId)
  return p ? chipLabel(p.providerId, p.modelId) : slotId
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

export function GodModeTab({ conversationId, conversationStatus, onRunsDetected }: GodModeTabProps) {
  const [run, setRun] = useState<GodTabRun | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const status = run?.status
  const shouldPoll = status ? !isTerminalGodStatus(status) : conversationStatus === 'working'

  useEffect(() => {
    setRun(null)
    setLoaded(false)
    setError(false)
    setExpanded(new Set())
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false

    const tick = async () => {
      try {
        const data = await api.get<{ runs: GodTabRun[] }>(
          `/conversations/${conversationId}/god-mode/runs`,
        )
        if (cancelled) return
        setRun(data.runs[0] ?? null)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    void tick()
    if (!shouldPoll) return () => { cancelled = true }

    const handle = window.setInterval(() => { void tick() }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [conversationId, shouldPoll])

  useEffect(() => {
    if (run) onRunsDetected?.()
  }, [run, onRunsDetected])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (!loaded) {
    return (
      <div className="p-3 text-xs text-muted-foreground">{t('common.loading')}</div>
    )
  }

  if (error && !run) {
    return (
      <div className="p-3 text-xs text-destructive">{t('conversations.godMode.tab.loadError')}</div>
    )
  }

  if (!run) {
    return (
      <div className="p-3 space-y-1">
        <p className="text-xs font-medium text-foreground">{t('conversations.godMode.tab.empty')}</p>
        <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.tab.emptyHint')}</p>
      </div>
    )
  }

  const participants = run.participants ?? []
  const insights = run.insights ?? []

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="px-3 py-2 border-b border-border/30 space-y-0.5">
        <p className="text-xs font-medium text-god">
          {t('conversations.godMode.phase', { phase: phaseLabel(run.status) })}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t('conversations.godMode.tab.totals', {
            tokens: run.totalTokens,
            usd: formatGodUsd(run.totalCostUsd),
            duration: formatDuration(run.durationMs),
          })}
        </p>
        {run.tieBroken && (
          <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.tab.tieBroken')}</p>
        )}
        {run.error && (
          <p className="text-[11px] text-destructive">{run.error}</p>
        )}
      </div>

      {(run.timeline?.length ?? 0) > 0 && (
        <div className="px-3 py-2 border-b border-border/30 space-y-1">
          <p className="text-xs font-medium text-foreground">{t('conversations.godMode.tab.steps')}</p>
          <ol className="space-y-1">
            {run.timeline.map((ev, i) => {
              const model = slotLabel(ev.slotId, participants)
              return (
                <li key={`${ev.at}-${i}`} className="flex gap-2 text-[11px]">
                  <span className="text-muted-foreground tabular-nums shrink-0">{formatClock(ev.at)}</span>
                  <span className="text-foreground">
                    {t(`conversations.godMode.step.${ev.key}`, { model: model || '—' })}
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {run.decision && (
        <div className="px-3 py-2 border-b border-border/30 space-y-1.5">
          <p className="text-xs font-medium text-foreground">{t('conversations.godMode.tab.decision')}</p>
          <p className="text-[11px] text-foreground">
            {t(`conversations.godMode.decision.${run.decision.method}`, {
              winner: slotLabel(run.decision.winnerSlotId, participants),
            })}
          </p>
          {Object.keys(run.decision.counts).length > 0 && (
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {Object.entries(run.decision.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([slot, count]) => (
                  <li key={slot} className="text-[11px] text-muted-foreground">
                    {t('conversations.godMode.tab.voteCount', {
                      model: slotLabel(slot, participants),
                      count,
                    })}
                  </li>
                ))}
            </ul>
          )}
          {run.decision.votes.length > 0 && (
            <ul className="space-y-0.5">
              {run.decision.votes.map((v) => (
                <li key={v.fromSlotId} className="text-[11px] text-muted-foreground">
                  {t('conversations.godMode.tab.voteFromTo', {
                    from: slotLabel(v.fromSlotId, participants),
                    to: v.voteFor
                      ? slotLabel(v.voteFor, participants)
                      : t('conversations.godMode.tab.noVote'),
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {participants.some(participantHasPeerReview) && (
        <div className="px-3 py-2 border-b border-border/30 space-y-2">
          <p className="text-xs font-medium text-foreground">{t('conversations.godMode.tab.crossReview')}</p>
          {participants.filter(participantHasPeerReview).map((p) => {
            const vote = votedModel(p.voteFor, participants)
            return (
              <div key={p.id} className="space-y-0.5">
                <p className="text-[11px] font-mono text-foreground">
                  {chipLabel(p.providerId, p.modelId)}
                </p>
                {vote && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('conversations.godMode.tab.vote', { model: vote })}
                  </p>
                )}
                {p.scores && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('conversations.godMode.tab.scores', {
                      quality: p.scores.quality,
                      completeness: p.scores.completeness,
                      risk: p.scores.risk,
                    })}
                  </p>
                )}
                {p.reviewSummary && (
                  <p className="text-[11px] text-foreground whitespace-pre-wrap">{p.reviewSummary}</p>
                )}
                {p.uniqueInsights.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {p.uniqueInsights.map((insight, i) => (
                      <li key={i} className="text-[11px] text-foreground">{insight}</li>
                    ))}
                  </ul>
                )}
                {p.risks.length > 0 && (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {p.risks.map((risk, i) => (
                      <li key={i} className="text-[11px] text-destructive">{risk}</li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ul className="divide-y divide-border/30">
        {participants.map((p) => {
          const winner = p.id === run.winnerParticipantId
          const open = expanded.has(p.id)
          const vote = votedModel(p.voteFor, participants)
          const tokens = p.tokensIn + p.tokensOut
          return (
            <li
              key={p.id}
              className={winner ? 'bg-god/10' : undefined}
            >
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="w-full text-left px-3 py-2 flex items-start gap-1.5"
                aria-expanded={open}
                title={open ? t('conversations.godMode.tab.collapse') : t('conversations.godMode.tab.expand')}
              >
                {open
                  ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-mono ${winner ? 'text-god font-medium' : 'text-foreground'}`}>
                      {chipLabel(p.providerId, p.modelId)}
                    </span>
                    {winner && (
                      <span className="text-[10px] font-medium text-god">
                        {t('conversations.godMode.tab.winner')}
                      </span>
                    )}
                    <span className={`text-[10px] ${p.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {participantStatusLabel(p.status)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {t('conversations.godMode.tab.totals', {
                      tokens,
                      usd: formatGodUsd(p.costUsd),
                      duration: formatDuration(p.durationMs),
                    })}
                  </p>
                  {p.status === 'failed' && p.error && (
                    <p className="text-[11px] text-destructive line-clamp-2">{p.error}</p>
                  )}
                  {(vote || p.scores) && (
                    <p className="text-[11px] text-muted-foreground">
                      {vote
                        ? t('conversations.godMode.tab.vote', { model: vote })
                        : t('conversations.godMode.tab.noVote')}
                      {p.scores && (
                        <>
                          {' · '}
                          {t('conversations.godMode.tab.scores', {
                            quality: p.scores.quality,
                            completeness: p.scores.completeness,
                            risk: p.scores.risk,
                          })}
                        </>
                      )}
                    </p>
                  )}
                </div>
              </button>
              {open && (
                <div className="px-3 pb-2 pl-8 space-y-1.5">
                  {p.error && (
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">
                        {t('conversations.godMode.tab.error')}
                      </p>
                      <p className="text-[11px] text-destructive whitespace-pre-wrap">{p.error}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('conversations.godMode.tab.ownWork')}
                    </p>
                    <p className="text-[11px] text-foreground whitespace-pre-wrap">
                      {p.summary || t('conversations.godMode.tab.noSummary')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('conversations.godMode.tab.peerReview')}
                    </p>
                    {p.reviewSummary || vote || p.scores ? (
                      <div className="space-y-0.5">
                        {vote && (
                          <p className="text-[11px] text-foreground">
                            {t('conversations.godMode.tab.vote', { model: vote })}
                          </p>
                        )}
                        {p.scores && (
                          <p className="text-[11px] text-muted-foreground">
                            {t('conversations.godMode.tab.scores', {
                              quality: p.scores.quality,
                              completeness: p.scores.completeness,
                              risk: p.scores.risk,
                            })}
                          </p>
                        )}
                        <p className="text-[11px] text-foreground whitespace-pre-wrap">
                          {p.reviewSummary || t('conversations.godMode.tab.noReview')}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.tab.noReview')}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('conversations.godMode.tab.risks')}
                    </p>
                    {p.risks.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.tab.noRisks')}</p>
                    ) : (
                      <ul className="list-disc pl-4 space-y-0.5">
                        {p.risks.map((risk, i) => (
                          <li key={i} className="text-[11px] text-foreground">{risk}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="px-3 py-2 border-t border-border/30 space-y-1">
        <p className="text-xs font-medium text-foreground">{t('conversations.godMode.tab.insights')}</p>
        <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.tab.insightsHint')}</p>
        {insights.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.tab.insightsEmpty')}</p>
        ) : (
          <ul className="list-disc pl-4 space-y-0.5">
            {insights.map((insight, i) => (
              <li key={i} className="text-[11px] text-foreground">{insight}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
