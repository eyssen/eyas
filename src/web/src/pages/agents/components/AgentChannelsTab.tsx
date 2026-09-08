// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Radio,
  Mail,
  Hash,
  Smartphone,
  MessageSquare,
  ExternalLink,
  Unlink,
  Link2,
  RefreshCw,
} from 'lucide-react'
import { t } from '../i18n'

interface ChannelItem {
  id: string
  name: string
  type: string
  description?: string
  status?: string
  connected: boolean
  configured?: boolean
  agentId?: string | null
  mode?: 'managed' | 'autonomous'
  isDefault?: boolean
  supportsPairing?: boolean
}

interface Props {
  agentId: string
  agentName?: string
}

const typeIcons: Record<string, typeof MessageSquare> = {
  telegram: Radio,
  discord: Hash,
  slack: Hash,
  email: Mail,
  whatsapp: Smartphone,
  signal: Smartphone,
  googlechat: MessageSquare,
  teams: MessageSquare,
}

function statusDotClass(ch: ChannelItem): string {
  if (ch.connected || ch.status === 'connected') return 'bg-emerald-500'
  if (ch.status === 'error') return 'bg-red-500'
  if (ch.status === 'configured' || ch.configured) return 'bg-amber-500'
  return 'bg-muted-foreground/40'
}

function statusLabel(ch: ChannelItem): string {
  if (ch.connected || ch.status === 'connected') return t('agents.channels.status.connected')
  if (ch.status === 'error') return t('agents.channels.status.error')
  if (ch.status === 'configured' || ch.configured) return t('agents.channels.status.configured')
  return t('agents.channels.status.notConfigured')
}

export function AgentChannelsTab({ agentId, agentName }: Props) {
  const channelsApi = useApi<{ channels: ChannelItem[] }>('/communication/channels')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [bindId, setBindId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const channels = channelsApi.data?.channels ?? []

  const mine = useMemo(
    () => channels.filter((c) => c.agentId === agentId),
    [channels, agentId],
  )

  const availableToBind = useMemo(
    () => channels.filter((c) => !c.agentId || c.agentId !== agentId),
    [channels, agentId],
  )

  const refetch = channelsApi.refetch

  const unbind = useCallback(
    async (channelId: string) => {
      setBusyId(channelId)
      setError(null)
      try {
        await api.patch(`/channels/${channelId}`, { agentId: null })
        await refetch()
      } catch (err: any) {
        setError(err?.message ?? String(err))
      } finally {
        setBusyId(null)
      }
    },
    [refetch],
  )

  const bind = useCallback(async () => {
    if (!bindId) return
    setBusyId(bindId)
    setError(null)
    try {
      await api.patch(`/channels/${bindId}`, { agentId })
      setBindId('')
      await refetch()
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusyId(null)
    }
  }, [bindId, agentId, refetch])

  if (channelsApi.isLoading) {
    return <p className="text-sm text-muted-foreground">{t('agents.channels.loading')}</p>
  }

  if (channelsApi.error) {
    return (
      <div className="glass-card p-4 space-y-2">
        <p className="text-sm text-destructive">
          {t('agents.channels.loadError', { message: channelsApi.error.message })}
        </p>
        <p className="text-xs text-muted-foreground">{t('agents.channels.moduleHint')}</p>
        <Link to="/communication">
          <Button size="sm" variant="outline">
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            {t('agents.channels.openCommunication')}
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold">{t('agents.channels.title')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('agents.channels.subtitle', { name: agentName || agentId.slice(0, 8) })}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={!!busyId}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Link to="/communication">
              <Button size="sm" variant="outline">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                {t('agents.channels.openCommunication')}
              </Button>
            </Link>
          </div>
        </div>

        {error && <p className="text-sm text-destructive mb-3">{error}</p>}

        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t('agents.channels.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mine.map((ch) => {
              const Icon = typeIcons[ch.type] ?? MessageSquare
              return (
                <li
                  key={ch.id}
                  className="flex items-center gap-3 rounded-lg bg-accent/25 px-3 py-2.5"
                >
                  <div className="h-9 w-9 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-indigo-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{ch.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ch.type}
                      </Badge>
                      {!ch.isDefault && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t('agents.channels.extra')}
                        </Badge>
                      )}
                      <span className={`h-2 w-2 rounded-full ${statusDotClass(ch)}`} />
                      <span className="text-[10px] text-muted-foreground">{statusLabel(ch)}</span>
                      {ch.mode === 'autonomous' && (
                        <Badge variant="secondary" className="text-[10px] text-amber-500">
                          {t('agents.channels.mode.autonomous')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{ch.id}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    disabled={busyId === ch.id}
                    onClick={() => unbind(ch.id)}
                    title={t('agents.channels.unbind')}
                  >
                    <Unlink className="h-3.5 w-3.5 mr-1" />
                    {t('agents.channels.unbind')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Bind existing instance to this agent */}
      <div className="glass-card p-4 space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('agents.channels.bindTitle')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('agents.channels.bindHint')}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Label className="sr-only">{t('agents.channels.bindSelect')}</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={bindId}
              onChange={(e) => setBindId(e.target.value)}
            >
              <option value="">{t('agents.channels.bindPick')}</option>
              {availableToBind.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name} ({ch.type}
                  {ch.agentId
                    ? ` · ${t('agents.channels.boundElsewhere')}`
                    : ` · ${t('agents.channels.unbound')}`}
                  )
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            className="h-9"
            disabled={!bindId || !!busyId}
            onClick={bind}
          >
            <Link2 className="h-3.5 w-3.5 mr-1" />
            {t('agents.channels.bindAction')}
          </Button>
        </div>
        {availableToBind.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t('agents.channels.noOtherInstances')}{' '}
            <Link to="/communication" className="text-primary underline-offset-2 hover:underline">
              {t('agents.channels.createOnCommPage')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
