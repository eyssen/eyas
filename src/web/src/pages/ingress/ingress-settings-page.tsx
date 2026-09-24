import { useState, useCallback, useEffect } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Globe, Power, PowerOff, ExternalLink, Loader2 } from 'lucide-react'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { unwrapIngressStatus, type IngressStatusPayload } from './status'

export default function IngressSettingsPage() {
  const { data, error: loadError, refetch } = useApi<IngressStatusPayload>('/ingress/status')
  const settings = useApi<{ hostname: string; tokenConfigured: boolean }>('/ingress/settings')
  const [token, setToken] = useState('')
  const [hostname, setHostname] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const status = unwrapIngressStatus(data)
  const active = status.active
  const tokenConfigured = settings.data?.tokenConfigured ?? status.tokenConfigured

  useEffect(() => {
    const saved = settings.data?.hostname || status.hostname
    if (saved) setHostname(saved)
  }, [settings.data?.hostname, status.hostname])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, string> = { hostname: hostname.trim() }
      if (token.trim()) body.token = token.trim()
      await api.put('/ingress/settings', body)
      setToken('')
      setNotice(t('ingress.saved'))
      settings.refetch()
      refetch()
    } catch (e: any) {
      setError(e.message || t('ingress.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [hostname, token, refetch, settings])

  const handleStart = useCallback(async () => {
    if (!token.trim() && !tokenConfigured) {
      setError(t('ingress.tokenRequired'))
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const body: Record<string, string> = {}
      if (token.trim()) body.token = token.trim()
      if (hostname.trim()) body.hostname = hostname.trim()
      await api.post('/ingress/start', body)
      setToken('')
      refetch()
      settings.refetch()
    } catch (e: any) {
      setError(e.message || t('ingress.startFailed'))
    } finally {
      setLoading(false)
    }
  }, [token, hostname, tokenConfigured, refetch, settings])

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
          <h1 className="page-title inline-flex items-center gap-1.5">{t('ingress.title')} <ContextualHelp helpId="admin.ingress" /></h1>
          <p className="text-sm text-muted-foreground">{t('ingress.subtitle')}</p>
        </div>
      </div>

      <div className="glass-card p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : status.running ? 'bg-amber-500' : 'bg-zinc-400'}`} />
                <span className="text-sm font-medium">
                  {active
                    ? t('ingress.connected')
                    : status.running
                      ? t('ingress.connecting')
                      : t('ingress.disconnected')}
                </span>
              </div>
              {active && status.url && (
                <a
                  href={status.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground font-mono mt-1 hover:text-foreground"
                >
                  {status.url} <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {active && status.connectedAt && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('ingress.since', { time: new Date(status.connectedAt).toLocaleString() })}
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

      {error || loadError || status.lastError ? (
        <p className="text-sm text-destructive mb-4">
          {error || loadError?.message || status.lastError}
        </p>
      ) : notice ? (
        <p className="text-sm text-emerald-500 mb-4">{notice}</p>
      ) : null}

      <div className="glass-card p-5">
        <h2 className="text-sm font-medium mb-4">{t('ingress.configuration')}</h2>
        <div className="grid gap-4 max-w-md">
          <div className="space-y-1.5">
            <Label>{t('ingress.tunnelToken')}</Label>
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={
                tokenConfigured
                  ? t('ingress.tokenConfiguredPlaceholder')
                  : t('ingress.tokenPlaceholder')
              }
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {tokenConfigured && (
              <p className="text-[11px] text-muted-foreground">{t('ingress.tokenStored')}</p>
            )}
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
          <div>
            <Button size="sm" variant="outline" onClick={() => void handleSave()} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {saving ? t('ingress.saving') : t('ingress.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
