// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api, ApiError } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Inbox, RefreshCw, RotateCcw } from 'lucide-react'
import { t } from './i18n'

interface InboundEvent {
  id: number
  source: string
  provider_message_id: string
  channel_id: string
  sender_id: string
  sender_name: string | null
  content: string
  status: 'pending' | 'delivered' | 'dead' | 'skipped'
  attempts: number
  next_attempt_at: string | null
  conversation_id: string | null
  last_error: string | null
  received_at: string
  delivered_at: string | null
}

function statusVariant(s: InboundEvent['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (s === 'dead') return 'destructive'
  if (s === 'delivered') return 'secondary'
  if (s === 'skipped') return 'outline'
  return 'default' // pending
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

export default function InboundQueueTab() {
  const inbound = useApi<{ events: InboundEvent[] }>('/communication/inbound')
  const { subscribe } = useWebSocket()
  const [error, setError] = useState<string | null>(null)

  // Live nudges: the backend bridges eyas.communication.* onto the system topic.
  const refetchInbound = inbound.refetch
  useEffect(() => {
    return subscribe(WS_TOPICS.system, () => refetchInbound())
  }, [subscribe, refetchInbound])

  async function retry(id: number) {
    setError(null)
    try {
      await api.post(`/communication/inbound/${id}/retry`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      inbound.refetch()
    }
  }

  const events = inbound.data?.events ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">
          {t('communication.inbound.subtitle')}
        </p>
        <Button size="sm" variant="outline" onClick={() => inbound.refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {events.length === 0 ? (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <Inbox className="h-6 w-6 opacity-60" />
          {t('communication.inbound.empty')}
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{t('common.status')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.inbound.colSource')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.inbound.colSender')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.inbound.colMessage')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.inbound.colAttempts')}</th>
                <th className="px-3 py-2 font-medium">{t('communication.inbound.colReceived')}</th>
                <th className="px-3 py-2 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(e.status)}>
                      {t(`communication.inbound.status.${e.status}`)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-foreground capitalize">{e.source}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.sender_name ?? e.sender_id}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-xs truncate" title={e.content}>
                    {e.content}
                    {e.last_error && (
                      <span className="block text-[11px] text-destructive mt-0.5">{e.last_error}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{e.attempts}</td>
                  <td className="px-3 py-2 text-muted-foreground">{ago(e.received_at)}</td>
                  <td className="px-3 py-2 text-right">
                    {e.status === 'dead' && (
                      <Button size="sm" variant="ghost" onClick={() => retry(e.id)}>
                        <RotateCcw className="h-4 w-4 mr-1" /> {t('common.retry')}
                      </Button>
                    )}
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
