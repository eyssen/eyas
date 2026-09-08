// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api, ApiError } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KeyRound, RefreshCw, Check, X } from 'lucide-react'
import { t } from './i18n'

interface Pairing {
  id: number
  source: string
  channel_id: string
  sender_name: string | null
  code: string | null
  status: string
  created_at: string
}

function ago(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return t('communication.time.secondsAgo', { n: s })
  if (s < 3600) return t('communication.time.minutesAgo', { n: Math.round(s / 60) })
  return t('communication.time.hoursAgo', { n: Math.round(s / 3600) })
}

export default function PairingTab() {
  const pending = useApi<{ pairings: Pairing[] }>('/communication/pairings?status=pending')
  const { subscribe } = useWebSocket()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  // Live nudges: pairing requests/decisions ride eyas.communication.* → system topic.
  const refetchPending = pending.refetch
  useEffect(() => {
    return subscribe(WS_TOPICS.system, () => refetchPending())
  }, [subscribe, refetchPending])

  async function decide(id: number, action: 'approve' | 'reject') {
    setBusyId(id)
    setError(null)
    try {
      await api.post(`/communication/pairings/${id}/${action}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusyId(null)
      pending.refetch()
    }
  }

  const pairings = pending.data?.pairings ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">
          {t('communication.pairing.subtitle')}
        </p>
        <Button size="sm" variant="outline" onClick={() => pending.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {pairings.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <KeyRound className="h-6 w-6 opacity-60" />
          {t('communication.pairing.empty')}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('communication.pairing.colSource')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.pairing.colSender')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.pairing.colCode')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.pairing.colRequested')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pairings.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 text-foreground capitalize">{p.source}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.sender_name ?? p.channel_id}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="font-mono">{p.code ?? '—'}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{ago(p.created_at)}</td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => decide(p.id, 'approve')}>
                      <Check className="h-4 w-4 mr-1" /> {t('communication.pairing.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busyId === p.id}
                      onClick={() => decide(p.id, 'reject')}
                    >
                      <X className="h-4 w-4 mr-1" /> {t('communication.pairing.reject')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
