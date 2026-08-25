// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Hand, Unplug, RefreshCw } from 'lucide-react'
import { t } from './i18n'

interface ToolInfo {
  id: string
  name: string
  type: 'cli' | 'app'
  path: string
  version?: string
  capabilities: string[]
}

interface HandItem {
  handId: string
  name: string
  platform: string
  arch: string
  osVersion: string
  protocolVersion: string
  capabilities: {
    cli: boolean
    osAutomation: boolean
    computerUse: boolean
  }
  discoveredTools: ToolInfo[]
  connectedAt: string
  lastSeen: string
  userId?: string
}

interface PairCodeResponse {
  code: string
  expiresInSeconds: number
}

const PLATFORM_ICON: Record<string, string> = {
  darwin: '🍎',
  win32: '🪟',
  linux: '🐧',
}

function getPlatformIcon(platform: string): string {
  return PLATFORM_ICON[platform.toLowerCase()] ?? '💻'
}

function formatRelative(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return t('settings.hands.justNow')
  if (diff < 3600) return t('settings.hands.minutesAgo', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('settings.hands.hoursAgo', { count: Math.floor(diff / 3600) })
  return t('settings.hands.daysAgo', { count: Math.floor(diff / 86400) })
}

export default function HandsSettingsPage() {
  const { data, isLoading, error, refetch } = useApi<{ hands: HandItem[] }>('/hands')
  const [pairCode, setPairCode] = useState<PairCodeResponse | null>(null)
  const [generating, setGenerating] = useState(false)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const hands = data?.hands ?? []

  const [generateError, setGenerateError] = useState<string | null>(null)

  const handleGenerateCode = useCallback(async () => {
    setGenerating(true)
    setGenerateError(null)
    try {
      const res = await api.post<PairCodeResponse>('/hands/pair/generate')
      setPairCode(res)
      // Auto-clear after expiry
      setTimeout(() => setPairCode(null), res.expiresInSeconds * 1000)
    } catch (err: any) {
      setGenerateError(err.message ?? t('settings.hands.generateError'))
    } finally {
      setGenerating(false)
    }
  }, [])

  const handleDisconnect = useCallback(async (handId: string) => {
    setDisconnecting(handId)
    try {
      await api.delete(`/hands/${handId}`)
      refetch()
    } finally {
      setDisconnecting(null)
    }
  }, [refetch])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title">{t('settings.hands.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('settings.hands.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {t('common.refresh')}
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={handleGenerateCode} disabled={generating}>
            <Hand className="h-3.5 w-3.5 mr-1" />
            {generating ? t('settings.hands.generating') : t('settings.hands.generateCode')}
          </Button>
        </div>
      </div>

      {/* Generate error */}
      {generateError && (
        <div className="p-3 mb-4 rounded-lg bg-destructive/10 text-destructive text-sm">
          {generateError}
        </div>
      )}

      {/* Pairing code display */}
      {pairCode && (
        <div className="glass-card p-6 mb-6 flex flex-col items-center gap-3 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{t('settings.hands.pairingCode')}</p>
          <div className="text-[56px] font-bold tracking-[0.25em] font-mono leading-none">
            {pairCode.code}
          </div>
          <p className="text-xs text-amber-400">
            {t('settings.hands.expiresIn', { minutes: pairCode.expiresInSeconds / 60 })}
          </p>
        </div>
      )}

      {/* Loading / error states */}
      {isLoading && hands.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('settings.hands.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive">{t('settings.hands.loadError', { error: error.message })}</p>
      )}

      {/* Empty state */}
      {!isLoading && !error && hands.length === 0 && (
        <div className="glass-card p-10 flex flex-col items-center justify-center text-muted-foreground">
          <Hand className="h-10 w-10 mb-3 opacity-20" />
          <p className="text-sm font-medium">{t('settings.hands.emptyTitle')}</p>
          <p className="text-xs mt-1">{t('settings.hands.emptyHint')}</p>
        </div>
      )}

      {/* Hand list */}
      {hands.length > 0 && (
        <div className="flex flex-col gap-3">
          {hands.map((hand) => (
            <div key={hand.handId} className="glass-card p-4 flex items-start gap-4">
              {/* Platform icon + status */}
              <div className="flex flex-col items-center gap-1.5 pt-0.5">
                <span className="text-2xl leading-none">{getPlatformIcon(hand.platform)}</span>
                <div
                  className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                  title={t('settings.hands.connected')}
                />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold truncate">{hand.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono bg-accent/40 px-1.5 py-0.5 rounded">
                    {hand.handId.slice(0, 8)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hand.platform} · {hand.arch} · {hand.osVersion}
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                  <span>{t('settings.hands.toolCount', { count: hand.discoveredTools.length })}</span>
                  <span>·</span>
                  <span>{t('settings.hands.protocol', { version: hand.protocolVersion })}</span>
                  <span>·</span>
                  <span>{t('settings.hands.lastSeen', { time: formatRelative(hand.lastSeen) })}</span>
                </div>
                {/* Capability badges */}
                <div className="flex gap-1.5 mt-2">
                  {hand.capabilities.cli && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/20">CLI</span>
                  )}
                  {hand.capabilities.osAutomation && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">{t('settings.hands.cap.osAutomation')}</span>
                  )}
                  {hand.capabilities.computerUse && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">{t('settings.hands.cap.computerUse')}</span>
                  )}
                </div>
              </div>

              {/* Disconnect */}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 flex-shrink-0"
                onClick={() => handleDisconnect(hand.handId)}
                disabled={disconnecting === hand.handId}
              >
                <Unplug className="h-3.5 w-3.5 mr-1" />
                {disconnecting === hand.handId ? t('settings.hands.disconnecting') : t('settings.hands.disconnect')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
