// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/hooks/use-api'
import { useWebSocket } from '@/hooks/use-websocket'
import { api } from '@/lib/api'
import { WS_TOPICS } from '@/lib/ws-topics'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ExternalLink, Loader2 } from 'lucide-react'
import { t } from './i18n'
import { PageTitle } from '@/components/docs/contextual-help'
import { resolveHelpUrl } from '@/lib/docs-help'
import { useLanguageStore } from '@/stores/language-store'

type MediaKind = 'image' | 'video' | 'audio' | 'upscale' | 'edit' | '3d'

interface MediaBalance {
  providerId: string
  credits: number | null
  unit: string
}

interface MediaProviderCard {
  id: string
  name: string
  capabilities: MediaKind[]
  configured: boolean
  balance: MediaBalance | null
}

interface MediaKindRouting {
  defaultProviderId: string | null
  fallbackProviderId: string | null
  alsoRunOn: string[]
}

interface MediaSettings {
  routing: Record<MediaKind, MediaKindRouting>
  budget: Record<string, { dailyCredits: number | null; monthlyCredits: number | null }>
  expertRawMcpTools: boolean
}

interface MediaJob {
  id: string
  providerId: string
  kind: MediaKind
  status: string
  prompt: string
  createdAt: string
}

const KINDS: MediaKind[] = ['image', 'video', 'audio', 'upscale', 'edit', '3d']
const OAUTH_IDS = new Set(['magnific', 'higgsfield'])
const COMPARE_VENDORS = ['magnific', 'higgsfield', 'fal'] as const
const COMPARE_ROWS = ['bestFor', 'kinds', 'auth', 'credits', 'results', 'pickIf'] as const
const KIND_KEY: Record<MediaKind, string> = {
  image: 'media.kind.image',
  video: 'media.kind.video',
  audio: 'media.kind.audio',
  upscale: 'media.kind.upscale',
  edit: 'media.kind.edit',
  '3d': 'media.kind.3d',
}

function formatBalance(balance: MediaBalance | null): string | null {
  if (!balance || balance.credits == null) return null
  return `${balance.credits} ${balance.unit}`.trim()
}

function vendorLabel(id: (typeof COMPARE_VENDORS)[number]): string {
  if (id === 'magnific') return 'Magnific'
  if (id === 'higgsfield') return 'Higgsfield'
  return 'fal'
}

function ComparePanel({ guideUrl }: { guideUrl: string | null }) {
  return (
    <div className="glass-card p-5 mb-8 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-medium">{t('media.compare.title')}</h2>
        {guideUrl ? (
          <a
            href={`${guideUrl.replace(/\/$/, '')}/#compare`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {t('media.guide.link')}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t('media.compare.lead')}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium whitespace-nowrap">{t('media.compare.aspect')}</th>
              {COMPARE_VENDORS.map((id) => (
                <th key={id} className="py-1 pr-3 font-medium">{vendorLabel(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => (
              <tr key={row} className="border-t border-border/40 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                  {t(`media.compare.${row}`)}
                </td>
                {COMPARE_VENDORS.map((id) => (
                  <td key={id} className="py-2 pr-3">
                    {t(`media.compare.${id}.${row}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="text-xs font-medium mb-2">{t('media.compare.recommend.title')}</h3>
        <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground">
          <li>{t('media.compare.recommend.1')}</li>
          <li>{t('media.compare.recommend.2')}</li>
          <li>{t('media.compare.recommend.3')}</li>
        </ol>
      </div>
    </div>
  )
}

export default function MediaPage() {
  const providersApi = useApi<{ providers: MediaProviderCard[] }>('/media/providers')
  const settingsApi = useApi<MediaSettings>('/media/settings')
  const jobsApi = useApi<{ jobs: MediaJob[] }>('/media/jobs')
  const { subscribe } = useWebSocket()
  const lang = useLanguageStore((s) => s.lang)
  const guideUrl = resolveHelpUrl('ai.media', lang)
  const [busy, setBusy] = useState<string | null>(null)
  const [oauthHint, setOauthHint] = useState(false)
  const [saving, setSaving] = useState(false)

  const providers = providersApi.data?.providers ?? []
  const settings = settingsApi.data
  const jobs = jobsApi.data?.jobs ?? []
  const anyConfigured = providers.some((p) => p.configured)

  const refetchAll = useCallback(() => {
    providersApi.refetch()
    settingsApi.refetch()
    jobsApi.refetch()
  }, [providersApi.refetch, settingsApi.refetch, jobsApi.refetch])

  useEffect(() => {
    return subscribe(WS_TOPICS.media, () => {
      refetchAll()
    })
  }, [subscribe, refetchAll])

  const handleConnect = useCallback(async (id: string) => {
    setBusy(`connect:${id}`)
    try {
      const res = await api.post<{ url?: string }>(`/media/providers/${id}/connect`)
      if (res?.url) {
        window.location.assign(res.url)
        return
      }
      if (OAUTH_IDS.has(id)) setOauthHint(true)
      providersApi.refetch()
    } finally {
      setBusy(null)
    }
  }, [providersApi.refetch])

  const handleDisconnect = useCallback(async (id: string) => {
    setBusy(`disconnect:${id}`)
    try {
      await api.post(`/media/providers/${id}/disconnect`)
      providersApi.refetch()
    } finally {
      setBusy(null)
    }
  }, [providersApi.refetch])

  const handleTest = useCallback(async (id: string) => {
    setBusy(`test:${id}`)
    try {
      await api.get(`/media/catalog?provider=${encodeURIComponent(id)}`)
      providersApi.refetch()
    } finally {
      setBusy(null)
    }
  }, [providersApi.refetch])

  const saveSettings = useCallback(async (next: MediaSettings) => {
    setSaving(true)
    try {
      await api.put('/media/settings', next)
      settingsApi.refetch()
    } finally {
      setSaving(false)
    }
  }, [settingsApi.refetch])

  const patchRouting = useCallback(async (
    kind: MediaKind,
    field: keyof MediaKindRouting,
    value: string | string[] | null,
  ) => {
    if (!settings) return
    const current = settings.routing[kind]
    await saveSettings({
      ...settings,
      routing: {
        ...settings.routing,
        [kind]: { ...current, [field]: value },
      },
    })
  }, [settings, saveSettings])

  const patchBudget = useCallback(async (
    providerId: string,
    field: 'dailyCredits' | 'monthlyCredits',
    value: number | null,
  ) => {
    if (!settings) return
    const prev = settings.budget[providerId] ?? { dailyCredits: null, monthlyCredits: null }
    await saveSettings({
      ...settings,
      budget: { ...settings.budget, [providerId]: { ...prev, [field]: value } },
    })
  }, [settings, saveSettings])

  const toggleExpert = useCallback(async (checked: boolean) => {
    if (!settings) return
    await saveSettings({ ...settings, expertRawMcpTools: checked })
  }, [settings, saveSettings])

  return (
    <div>
      <PageTitle
        title={t('media.title')}
        subtitle={t('media.subtitle')}
        helpId="ai.media"
        actions={
          <div className="flex items-center gap-3">
            {guideUrl ? (
              <a
                href={guideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
              >
                {t('media.guide.link')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        }
      />

      {!anyConfigured && (
        <p className="text-sm text-muted-foreground mb-4">{t('media.empty')}</p>
      )}
      {oauthHint && (
        <p className="text-sm text-muted-foreground mb-4">{t('media.oauth.redirect')}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {providers.map((provider) => {
          const balanceLabel = formatBalance(provider.balance)
          return (
            <div key={provider.id} className="glass-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{provider.name}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {provider.capabilities.map((kind) => (
                      <Badge key={kind} variant="outline" className="text-[10px]">
                        {t(KIND_KEY[kind])}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Badge variant={provider.configured ? 'default' : 'outline'}>
                  {provider.configured ? t('media.configured') : t('media.unconfigured')}
                </Badge>
              </div>
              {balanceLabel && (
                <p className="text-xs text-muted-foreground">
                  {t('media.balance')}: {balanceLabel}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {!provider.configured && (
                  <Button
                    size="sm"
                    onClick={() => handleConnect(provider.id)}
                    disabled={busy === `connect:${provider.id}`}
                  >
                    {busy === `connect:${provider.id}` && <Loader2 className="h-3 w-3 animate-spin" />}
                    {t('media.connect')}
                  </Button>
                )}
                {provider.configured && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDisconnect(provider.id)}
                    disabled={busy === `disconnect:${provider.id}`}
                  >
                    {busy === `disconnect:${provider.id}` && <Loader2 className="h-3 w-3 animate-spin" />}
                    {t('media.disconnect')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleTest(provider.id)}
                  disabled={busy === `test:${provider.id}`}
                >
                  {busy === `test:${provider.id}` && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t('media.test')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <ComparePanel guideUrl={guideUrl} />

      {settings && (
        <div className="space-y-6">
          <div className="glass-card p-5">
            <h2 className="text-sm font-medium mb-3">{t('media.routing')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">{t('media.routing.kind')}</th>
                    <th className="py-1 pr-3 font-medium">{t('media.routing.default')}</th>
                    <th className="py-1 pr-3 font-medium">{t('media.routing.fallback')}</th>
                    <th className="py-1 font-medium">{t('media.routing.also')}</th>
                  </tr>
                </thead>
                <tbody>
                  {KINDS.map((kind) => {
                    const row = settings.routing[kind]
                    return (
                      <tr key={kind} className="border-t border-border/40">
                        <td className="py-2 pr-3">{t(KIND_KEY[kind])}</td>
                        <td className="py-2 pr-3">
                          <select
                            value={row?.defaultProviderId ?? ''}
                            onChange={(e) => patchRouting(kind, 'defaultProviderId', e.target.value || null)}
                            className="h-7 px-2 text-xs bg-accent/30 border border-border/50 rounded-md w-full"
                          >
                            <option value="" />
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={row?.fallbackProviderId ?? ''}
                            onChange={(e) => patchRouting(kind, 'fallbackProviderId', e.target.value || null)}
                            className="h-7 px-2 text-xs bg-accent/20 border border-border/30 rounded-md w-full text-muted-foreground"
                          >
                            <option value="" />
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            {providers.map((p) => {
                              const checked = row?.alsoRunOn.includes(p.id) ?? false
                              return (
                                <label key={p.id} className="inline-flex items-center gap-1 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {
                                      const current = row?.alsoRunOn ?? []
                                      const next = checked
                                        ? current.filter((id) => id !== p.id)
                                        : [...current, p.id]
                                      void patchRouting(kind, 'alsoRunOn', next)
                                    }}
                                  />
                                  <span>{p.name}</span>
                                </label>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-card p-5 max-w-lg">
            <h2 className="text-sm font-medium mb-3">{t('media.budget')}</h2>
            <div className="space-y-4">
              {providers.map((p) => {
                const caps = settings.budget[p.id] ?? { dailyCredits: null, monthlyCredits: null }
                return (
                  <div key={p.id} className="space-y-2">
                    <div className="text-xs font-medium">{p.name}</div>
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-40">{t('media.budget.daily')}</Label>
                      <Input
                        type="number"
                        value={caps.dailyCredits ?? ''}
                        onChange={(e) => patchBudget(p.id, 'dailyCredits', e.target.value ? Number(e.target.value) : null)}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="text-xs w-40">{t('media.budget.monthly')}</Label>
                      <Input
                        type="number"
                        value={caps.monthlyCredits ?? ''}
                        onChange={(e) => patchBudget(p.id, 'monthlyCredits', e.target.value ? Number(e.target.value) : null)}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="glass-card p-4 flex items-center justify-between max-w-lg">
            <Label htmlFor="media-expert" className="text-sm pr-4 cursor-pointer">{t('media.expert')}</Label>
            <Switch
              id="media-expert"
              checked={settings.expertRawMcpTools}
              onCheckedChange={(checked) => { void toggleExpert(checked === true) }}
            />
          </div>
        </div>
      )}

      <div className="glass-card p-5 mt-6">
        <h2 className="text-sm font-medium mb-3">{t('media.jobs')}</h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-border/40 first:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{t(KIND_KEY[job.kind] ?? 'media.kind.image')}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{job.providerId}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{job.status}</td>
                    <td className="py-2 truncate max-w-xs">{job.prompt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
