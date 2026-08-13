import { useState, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Globe, Power, PowerOff, ExternalLink, Loader2 } from 'lucide-react'
import { t } from './i18n'

interface IngressStatus {
  active: boolean
  url?: string
  connectedAt?: string
}

export default function IngressSettingsPage() {
  const { data, refetch } = useApi<IngressStatus>('/ingress/status')
  const [token, setToken] = useState('')
  const [hostname, setHostname] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = data?.active ?? false

  const handleStart = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, string> = {}
      if (token) body.token = token
      if (hostname) body.hostname = hostname
      await api.post('/ingress/start', body)
      refetch()
    } catch (e: any) {
      setError(e.message || t('ingress.startFailed'))
    } finally {
      setLoading(false)
    }
  }, [token, hostname, refetch])

  const handleStop = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await api.post('/ingress/stop', {})
      refetch()
    } catch (e: any) {
      setError(e.message || t('ingress.stopFailed'))
    } finally {
      setLoading(false)
    }
  }, [refetch])

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title">{t('ingress.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('ingress.subtitle')}</p>
        </div>
      </div>

      {/* Status */}
      <div className="glass-card p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                <span className="text-sm font-medium">{active ? t('ingress.connected') : t('ingress.disconnected')}</span>
              </div>
              {active && data?.url && (
                <a
                  href={data.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground font-mono mt-1 hover:text-foreground"
                >
                  {data.url} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {active && data?.connectedAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('ingress.since', { time: new Date(data.connectedAt).toLocaleString() })}
                </p>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant={active ? 'destructive' : 'default'}
            onClick={active ? handleStop : handleStart}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : active ? (
              <><PowerOff className="h-4 w-4 mr-1" /> {t('ingress.stop')}</>
            ) : (
              <><Power className="h-4 w-4 mr-1" /> {t('ingress.start')}</>
            )}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {/* Configuration */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-medium mb-4">{t('ingress.configuration')}</h2>
        <div className="grid gap-4 max-w-md">
          <div className="space-y-1.5">
            <Label>{t('ingress.tunnelToken')}</Label>
            <Input
              type="password"
              placeholder={t('ingress.tokenPlaceholder')}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('ingress.hostname')}</Label>
            <Input
              placeholder={t('ingress.hostnamePlaceholder')}
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('ingress.configNote')}
          </p>
        </div>
      </div>
    </div>
  )
}
