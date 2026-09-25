import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Plus, Save, Loader2, Webhook, RefreshCw } from 'lucide-react'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { t } from './i18n'

type Severity = 'info' | 'warning' | 'error' | 'critical'
type DeliveryMode = 'immediate' | 'batched'
type Channel = 'web' | 'email' | 'telegram' | 'webhook'

interface Preference {
  userId: string
  eventPattern: string
  channel: Channel
  minSeverity: Severity
  quietHours: { from: string; to: string } | null
  deliveryMode?: DeliveryMode
}

interface WebhookInfo {
  url: string
  hasSecret: boolean
  headers: Record<string, string>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

interface RetryStats {
  pending: number
  failed: number
  enabled: boolean
}

const SEVERITIES: Severity[] = ['info', 'warning', 'error', 'critical']
const CHANNELS: Channel[] = ['web', 'email', 'telegram', 'webhook']
const DELIVERY_MODES: DeliveryMode[] = ['immediate', 'batched']

export default function NotificationSettingsPage() {
  const [prefs, setPrefs] = useState<Preference[]>([])
  const [loading, setLoading] = useState(true)

  // New-preference form
  const [newPattern, setNewPattern] = useState('')
  const [newChannel, setNewChannel] = useState<Channel>('web')
  const [newSeverity, setNewSeverity] = useState<Severity>('info')
  const [newDelivery, setNewDelivery] = useState<DeliveryMode>('immediate')
  const [newQuietFrom, setNewQuietFrom] = useState('')
  const [newQuietTo, setNewQuietTo] = useState('')
  const [saving, setSaving] = useState(false)

  // Webhook config
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null)
  const [whUrl, setWhUrl] = useState('')
  const [whSecret, setWhSecret] = useState('')
  const [whEnabled, setWhEnabled] = useState(true)
  const [whError, setWhError] = useState<string | null>(null)

  // Retry stats
  const [retryStats, setRetryStats] = useState<RetryStats | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [prefsRes, webhookRes, retryRes] = await Promise.all([
        api.get<{ preferences: Preference[] }>('/notification-preferences'),
        api.get<{ webhook: WebhookInfo | null }>('/notification-webhooks').catch(() => ({ webhook: null })),
        api.get<RetryStats>('/notifications/retry-stats').catch(() => null),
      ])
      setPrefs(prefsRes.preferences ?? [])
      setWebhook(webhookRes.webhook)
      if (webhookRes.webhook) {
        setWhUrl(webhookRes.webhook.url)
        setWhEnabled(webhookRes.webhook.enabled)
      }
      setRetryStats(retryRes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addPref = useCallback(async () => {
    if (!newPattern) return
    setSaving(true)
    try {
      await api.patch('/notification-preferences', {
        eventPattern: newPattern,
        channel: newChannel,
        minSeverity: newSeverity,
        deliveryMode: newDelivery,
        quietHours: newQuietFrom && newQuietTo ? { from: newQuietFrom, to: newQuietTo } : null,
      })
      setNewPattern('')
      setNewQuietFrom('')
      setNewQuietTo('')
      await load()
    } finally {
      setSaving(false)
    }
  }, [newPattern, newChannel, newSeverity, newDelivery, newQuietFrom, newQuietTo, load])

  const deletePref = useCallback(async (pattern: string, channel: string) => {
    await api.delete(`/notification-preferences?eventPattern=${encodeURIComponent(pattern)}&channel=${encodeURIComponent(channel)}`)
    await load()
  }, [load])

  const saveWebhook = useCallback(async () => {
    setWhError(null)
    try {
      await api.put('/notification-webhooks', {
        url: whUrl,
        secret: whSecret || undefined,
        enabled: whEnabled,
      })
      setWhSecret('')
      await load()
    } catch (e: any) {
      setWhError(e.message || t('notifications.settings.saveWebhookFailed'))
    }
  }, [whUrl, whSecret, whEnabled, load])

  const deleteWebhook = useCallback(async () => {
    await api.delete('/notification-webhooks')
    setWhUrl('')
    setWhSecret('')
    await load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="page-title inline-flex items-center gap-1.5">{t('notifications.settings.title')} <ContextualHelp helpId="admin.notifications" /></h1>
        <p className="text-sm text-muted-foreground">
          {t('notifications.settings.subtitle')}
        </p>
      </div>

      <div className="space-y-4 max-w-3xl">
        {/* Preferences list */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium mb-3">{t('notifications.settings.activePreferences')}</h2>
          {prefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('notifications.settings.noPreferences')}</p>
          ) : (
            <div className="space-y-2">
              {prefs.map((p) => (
                <div
                  key={`${p.eventPattern}-${p.channel}`}
                  className="flex items-center justify-between border rounded-md px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="font-mono">{p.eventPattern}</Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline">{t(`notifications.settings.channelOptions.${p.channel}`)}</Badge>
                    <Badge variant="outline" className="text-xs">≥ {t(`notifications.settings.severity.${p.minSeverity}`)}</Badge>
                    {p.deliveryMode === 'batched' && (
                      <Badge variant="outline" className="text-xs">{t('notifications.settings.digest')}</Badge>
                    )}
                    {p.quietHours && (
                      <Badge variant="outline" className="text-xs">
                        {t('notifications.settings.quiet', { from: p.quietHours.from, to: p.quietHours.to })}
                      </Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deletePref(p.eventPattern, p.channel)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add new preference */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium mb-3">{t('notifications.settings.addPreference')}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs mb-1">{t('notifications.settings.eventPattern')}</Label>
              <Input
                placeholder={t('notifications.settings.eventPatternPlaceholder')}
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs mb-1">{t('notifications.settings.channel')}</Label>
              <Select value={newChannel} onValueChange={(v) => setNewChannel(v as Channel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => <SelectItem key={c} value={c}>{t(`notifications.settings.channelOptions.${c}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1">{t('notifications.settings.minSeverity')}</Label>
              <Select value={newSeverity} onValueChange={(v) => setNewSeverity(v as Severity)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`notifications.settings.severity.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1">{t('notifications.settings.deliveryMode')}</Label>
              <Select value={newDelivery} onValueChange={(v) => setNewDelivery(v as DeliveryMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DELIVERY_MODES.map((m) => <SelectItem key={m} value={m}>{t(`notifications.settings.delivery.${m}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs mb-1">{t('notifications.settings.quietFrom')}</Label>
                <Input type="time" value={newQuietFrom} onChange={(e) => setNewQuietFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs mb-1">{t('notifications.settings.quietTo')}</Label>
                <Input type="time" value={newQuietTo} onChange={(e) => setNewQuietTo(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={addPref} disabled={!newPattern || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {t('common.add')}
            </Button>
          </div>
        </div>

        {/* Webhook endpoint */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Webhook className="h-4 w-4" /> {t('notifications.settings.webhookEndpoint')}
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            {t('notifications.settings.webhookHint')}
          </p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs mb-1">{t('notifications.settings.url')}</Label>
              <Input
                placeholder={t('notifications.settings.urlPlaceholder')}
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs mb-1">{t('notifications.settings.sharedSecret')}</Label>
              <Input
                type="password"
                placeholder={webhook?.hasSecret ? t('notifications.settings.secretUnchanged') : ''}
                value={whSecret}
                onChange={(e) => setWhSecret(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="wh-enabled"
                type="checkbox"
                checked={whEnabled}
                onChange={(e) => setWhEnabled(e.target.checked)}
              />
              <Label htmlFor="wh-enabled" className="text-sm cursor-pointer">{t('common.enabled')}</Label>
            </div>
            {whError && <p className="text-xs text-destructive">{whError}</p>}
            <div className="flex gap-2 justify-end">
              {webhook && (
                <Button variant="ghost" size="sm" onClick={deleteWebhook}>
                  <Trash2 className="h-4 w-4 mr-1" /> {t('common.remove')}
                </Button>
              )}
              <Button size="sm" onClick={saveWebhook} disabled={!whUrl}>
                <Save className="h-4 w-4 mr-1" /> {t('notifications.settings.saveWebhook')}
              </Button>
            </div>
          </div>
        </div>

        {/* Retry queue stats */}
        {retryStats?.enabled && (
          <div className="glass-card p-5">
            <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
              <RefreshCw className="h-4 w-4" /> {t('notifications.settings.retryQueue')}
            </h2>
            <div className="flex gap-6 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">{t('notifications.settings.pending')}</div>
                <div className="text-lg font-mono">{retryStats.pending}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t('notifications.settings.failedDeadLetter')}</div>
                <div className="text-lg font-mono text-destructive">{retryStats.failed}</div>
              </div>
              <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
                <RefreshCw className="h-4 w-4 mr-1" /> {t('common.refresh')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
