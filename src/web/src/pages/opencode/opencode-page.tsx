// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PageTitle } from '@/components/docs/contextual-help'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { useLanguageStore } from '@/stores/language-store'
import { t, tOr } from './i18n'
import {
  findModel,
  modelKey,
  parseModelKey,
  settingsPayload,
  variantAfterModelChange,
  variantChoices,
  variantLabel,
  type OcModelRef,
  type OcModelsResponse,
} from './model-settings'

type CheckStatus = 'ok' | 'missing' | 'warn'

interface Check {
  id: string
  label: string
  status: CheckStatus
  detail?: string
  /** Localized detail key suffix: opencode.check.<id>.<detailId>. */
  detailId?: string
  detailVars?: Record<string, string>
  remedy?: string
}

interface Status {
  available: boolean
  enabled: boolean
  checks: Check[]
  server: { running: boolean; url: string | null; version: string | null }
  pty: { available: boolean; platform: string }
}

/** Localized label, falling back to the backend text for a check without keys. */
function checkLabel(check: Check): string {
  return tOr(`opencode.check.${check.id}.label`, check.label)
}

function checkDetail(check: Check): string | undefined {
  if (check.detailId) return tOr(`opencode.check.${check.id}.${check.detailId}`, check.detail ?? '', check.detailVars)
  return check.detail
}

function checkKey(status: CheckStatus): string {
  if (status === 'ok') return 'opencode.check.ok'
  if (status === 'missing') return 'opencode.check.missing'
  return 'opencode.check.warn'
}

/** The saved model choice (GET /opencode/settings). */
interface SavedModelSettings {
  model: OcModelRef | null
  variant: string | null
}

const SELECT_CLASS = 'w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring'

/**
 * Model and reasoning variant of the tasks the assistant hands to OpenCode.
 * The options are OpenCode's own list, read from its running server; the
 * variant select is shown only when the chosen model has variants.
 */
function ModelSettingsCard() {
  const settings = useApi<SavedModelSettings>('/opencode/settings')
  const models = useApi<OcModelsResponse>('/opencode/models')
  const [draft, setDraft] = useState<{ key: string; variant: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const saved = settings.data
  const key = draft?.key ?? modelKey(saved?.model)
  const variant = draft?.variant ?? saved?.variant ?? ''
  const chosen = parseModelKey(key)
  const providers = models.data?.providers
  const running = models.data?.running === true
  const listed = findModel(providers, chosen) !== null
  const variants = variantChoices(providers, chosen, variant || null)
  const dirty = draft !== null && (key !== modelKey(saved?.model) || (variant || null) !== (saved?.variant ?? null))

  async function save() {
    setSaving(true)
    try {
      await api.put('/opencode/settings', settingsPayload(key, variant))
      toast.success(t('opencode.settings.saved'))
      setDraft(null)
      settings.refetch()
    } catch {
      toast.error(t('common.unknownError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <div className="text-sm font-medium">{t('opencode.settings.title')}</div>
      <p className="text-xs text-muted-foreground">{t('opencode.settings.hint')}</p>
      {models.error && <p className="text-xs text-muted-foreground">{t('opencode.settings.modelsUnavailable')}</p>}
      {!models.error && models.data && !running && (
        <p className="text-xs text-muted-foreground">{t('opencode.settings.serverNotRunning')}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs" htmlFor="opencode-model">{t('opencode.settings.model')}</Label>
          <select
            id="opencode-model"
            value={key}
            disabled={!saved}
            onChange={(e) => {
              const next = parseModelKey(e.target.value)
              setDraft({ key: e.target.value, variant: variantAfterModelChange(providers, next, variant) })
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t('opencode.settings.modelDefault')}</option>
            {chosen && !listed && (
              <option value={key}>
                {running
                  ? t('opencode.settings.modelMissing', { model: `${chosen.providerID}/${chosen.modelID}` })
                  : `${chosen.providerID}/${chosen.modelID}`}
              </option>
            )}
            {(providers ?? []).map((provider) => (
              <optgroup key={provider.id} label={provider.name}>
                {provider.models.map((m) => (
                  <option key={m.id} value={modelKey({ providerID: provider.id, modelID: m.id })}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {variants.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="opencode-variant">{t('opencode.settings.variant')}</Label>
            <select
              id="opencode-variant"
              value={variant}
              onChange={(e) => setDraft({ key, variant: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">{t('opencode.settings.variantDefault')}</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{variantLabel(v, (k, fallback) => tOr(k, fallback))}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={!dirty || saving}>{t('opencode.settings.save')}</Button>
      </div>
    </div>
  )
}

export default function OpencodePage() {
  useLanguageStore((s) => s.lang)
  const { data } = useApi<Status>('/opencode/status')
  // An attached external server keeps its own sign-in; the hint is for the EYAS-owned one.
  const external = (data?.checks ?? []).some((c) => c.id === 'attach' && c.detailId === 'detailExternal')

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <PageTitle title={t('opencode.title')} subtitle={t('opencode.subtitle')} helpId="automation.opencode" />

      <div className="glass-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium">{t('opencode.title')}</div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {data?.available ? t('opencode.available') : t('opencode.unavailable')}
          </Badge>
        </div>
        {!data?.available && (
          <p className="text-xs text-muted-foreground">{t('opencode.empty')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {data?.server.running && data.server.url
            ? t('opencode.server.running', { url: data.server.url, version: data.server.version ?? '?' })
            : t('opencode.server.stopped')}
        </p>
        <ul className="space-y-2">
          {(data?.checks ?? []).map((check) => {
            const detail = checkDetail(check)
            return (
              <li key={check.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{checkLabel(check)}</span>
                  <span className="text-muted-foreground">{t(checkKey(check.status))}</span>
                </div>
                {detail && <p className="text-muted-foreground mt-0.5">{detail}</p>}
                {check.remedy && check.status !== 'ok' && (
                  <p className="text-muted-foreground mt-0.5">{check.remedy}</p>
                )}
              </li>
            )
          })}
        </ul>
        {!external && <p className="text-xs text-muted-foreground">{t('opencode.signIn.hint')}</p>}
        <p className="text-xs text-muted-foreground">{t('opencode.help')}</p>
      </div>

      <ModelSettingsCard />
    </div>
  )
}
