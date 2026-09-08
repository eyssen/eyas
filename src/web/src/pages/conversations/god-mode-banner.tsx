// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { t } from './i18n'

export type GodSendDecision = 'send' | 'confirm' | 'block-ceiling'

export interface GodModeEstimateParticipant {
  id: string
  providerId: string
  modelId: string
}

export interface GodModeEstimate {
  usd: number
  ceilingUsd: number | null
  participants: GodModeEstimateParticipant[]
}

/** Ceiling always wins (no confirm bypass). First send otherwise confirms. */
export function shouldConfirmGodSend(
  hasConfirmedThisConversation: boolean,
  estimateUsd: number,
  ceilingUsd: number | null,
): GodSendDecision {
  if (ceilingUsd != null && estimateUsd > ceilingUsd) return 'block-ceiling'
  if (!hasConfirmedThisConversation) return 'confirm'
  return 'send'
}

export function formatGodUsd(usd: number): string {
  return usd.toFixed(2)
}

function chipLabel(p: GodModeEstimateParticipant): string {
  const model = p.modelId.includes('/') ? p.modelId.split('/').pop()! : p.modelId
  return `${p.providerId}/${model}`
}

function phaseLabel(phase: string): string {
  return t(`conversations.godMode.phase.${phase}`)
}

function useLatestGodRunPhase(conversationId: string, enabled: boolean): string | null {
  const [phase, setPhase] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !conversationId) {
      setPhase(null)
      return
    }
    let cancelled = false
    let runId: string | null = null

    const tick = async () => {
      try {
        if (!runId) {
          const list = await api.get<{ runs: Array<{ id: string }> }>(
            `/conversations/${conversationId}/god-mode/runs`,
          )
          runId = list.runs[0]?.id ?? null
        }
        if (!runId || cancelled) return
        const detail = await api.get<{ run: { status: string } }>(`/god-mode/runs/${runId}`)
        if (!cancelled) setPhase(detail.run.status)
      } catch {
        /* keep last known phase */
      }
    }

    void tick()
    const handle = window.setInterval(() => { void tick() }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [enabled, conversationId])

  return phase
}

interface GodModeBannerProps {
  conversationId: string
  conversationStatus?: string
  workingDirectories?: unknown
  estimate: GodModeEstimate | null
  estimateError: boolean
  gateMessage: 'ceiling' | 'config' | 'busy' | null
}

export function GodModeBanner({
  conversationId,
  conversationStatus,
  workingDirectories,
  estimate,
  estimateError,
  gateMessage,
}: GodModeBannerProps) {
  const working = conversationStatus === 'working'
  const phase = useLatestGodRunPhase(conversationId, working)
  const foldersEmpty = !Array.isArray(workingDirectories) || workingDirectories.length === 0
  const count = estimate?.participants.length ?? 0
  const rosterInvalid = estimateError || (estimate != null && count < 2)

  return (
    <div className="mb-2 rounded-md border border-god/40 bg-god/5 px-2.5 py-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-god">
        <span className="font-medium">
          {estimate
            ? t('conversations.godMode.banner', { count, usd: formatGodUsd(estimate.usd) })
            : t('conversations.fields.orchestrationGod')}
        </span>
        {estimate?.participants.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center rounded-full border border-god/40 px-1.5 py-px text-[10px] font-mono text-god"
          >
            {chipLabel(p)}
          </span>
        ))}
      </div>
      {working && phase && (
        <p className="text-[11px] text-god/90">{t('conversations.godMode.phase', { phase: phaseLabel(phase) })}</p>
      )}
      {foldersEmpty && (
        <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.emptyFolders')}</p>
      )}
      {rosterInvalid && (
        <p className="text-[11px] text-destructive">{t('conversations.godMode.configError')}</p>
      )}
      {gateMessage === 'ceiling' && estimate && estimate.ceilingUsd != null && (
        <p className="text-[11px] text-destructive">
          {t('conversations.godMode.ceilingBlock', {
            usd: formatGodUsd(estimate.usd),
            ceiling: formatGodUsd(estimate.ceilingUsd),
          })}
        </p>
      )}
      {gateMessage === 'busy' && (
        <p className="text-[11px] text-muted-foreground">{t('conversations.godMode.busy')}</p>
      )}
    </div>
  )
}

interface GodModeConfirmDialogProps {
  open: boolean
  estimate: GodModeEstimate | null
  onCancel: () => void
  onConfirm: () => void
}

export function GodModeConfirmDialog({
  open,
  estimate,
  onCancel,
  onConfirm,
}: GodModeConfirmDialogProps) {
  const count = estimate?.participants.length ?? 0
  const usd = formatGodUsd(estimate?.usd ?? 0)
  const ceiling = estimate?.ceilingUsd

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('conversations.godMode.confirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('conversations.godMode.confirmDescription', { count })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {estimate?.participants.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center rounded-full border border-god/40 px-1.5 py-px text-[10px] font-mono text-god"
              >
                {chipLabel(p)}
              </span>
            ))}
          </div>
          <p>{t('conversations.godMode.confirmEstimate', { usd })}</p>
          <p>
            {ceiling == null
              ? t('conversations.godMode.confirmCeilingNone')
              : t('conversations.godMode.confirmCeiling', { ceiling: formatGodUsd(ceiling) })}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('conversations.godMode.confirmCancel')}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t('conversations.godMode.confirmSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function useGodModeEstimate(conversationId: string, godMode: boolean) {
  return useApi<GodModeEstimate>(
    godMode && conversationId ? `/god-mode/estimate?conversationId=${encodeURIComponent(conversationId)}` : '',
  )
}
