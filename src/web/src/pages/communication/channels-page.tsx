// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback, useMemo } from 'react'
import { useApi } from '@/hooks/use-api'
import { api } from '@/lib/api'
import { t } from './i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MessageSquare,
  Radio,
  Globe,
  Plug,
  ChevronDown,
  ChevronUp,
  Send,
  Bot,
  Shield,
  RefreshCw,
  Save,
  Mail,
  Hash,
  Smartphone,
  Plus,
  Trash2,
} from 'lucide-react'

interface SecretField {
  name: string
  required: boolean
  label: string
  sensitive: boolean
  hint?: string
  placeholder?: string
  present: boolean
  vaultKey?: string
}

interface ChannelItem {
  id: string
  name: string
  type: string
  description?: string
  status?: 'not_configured' | 'configured' | 'connected' | 'error'
  connected: boolean
  configured?: boolean
  supportsPairing?: boolean
  webhookPaths?: string[]
  dependencyNote?: string
  secrets?: SecretField[]
  agentId?: string | null
  mode?: 'managed' | 'autonomous'
  health?: { status: 'healthy' | 'degraded' | 'fatal' | string; lastError?: string; fatalReason?: string }
  lastError?: string
  isDefault?: boolean
  templateId?: string
  setupIntro?: string
  setupSteps?: string[]
}

interface ChannelTemplate {
  id: string
  type: string
  name: string
  description: string
  setupIntro?: string
  setupSteps?: string[]
  secrets: Array<{
    name: string
    required: boolean
    label: string
    sensitive: boolean
    hint?: string
    placeholder?: string
  }>
}

/** Prefer i18n field label; fall back to API English label. */
function fieldLabel(secretName: string, fallback: string): string {
  const key = `communication.field.${secretName}.label`
  const v = t(key)
  return !v || v === key ? fallback : v
}

function fieldHint(secretName: string, fallback?: string): string | undefined {
  const key = `communication.field.${secretName}.hint`
  const v = t(key)
  if (v && v !== key) return v
  return fallback
}

function fieldPlaceholder(secretName: string, fallback?: string): string {
  const key = `communication.field.${secretName}.placeholder`
  const v = t(key)
  if (v && v !== key) return v
  return fallback || ''
}

/** Localized setup steps for a template id, else API English steps. */
function setupGuide(templateId: string | undefined, apiIntro?: string, apiSteps?: string[]): {
  intro?: string
  steps: string[]
} {
  if (!templateId) return { intro: apiIntro, steps: apiSteps ?? [] }
  const introKey = `communication.setup.${templateId}.intro`
  const introVal = t(introKey)
  const intro = introVal && introVal !== introKey ? introVal : apiIntro
  const steps: string[] = []
  for (let i = 1; i <= 12; i++) {
    const key = `communication.setup.${templateId}.step${i}`
    const val = t(key)
    if (!val || val === key) break
    steps.push(val)
  }
  return { intro, steps: steps.length > 0 ? steps : (apiSteps ?? []) }
}

function SetupGuideBlock({
  templateId,
  apiIntro,
  apiSteps,
}: {
  templateId?: string
  apiIntro?: string
  apiSteps?: string[]
}) {
  const { intro, steps } = setupGuide(templateId, apiIntro, apiSteps)
  if (!intro && steps.length === 0) return null
  return (
    <div className="rounded-lg border border-border/60 bg-accent/20 px-3 py-3 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('communication.setup.howToTitle')}
      </p>
      {intro && <p className="text-sm text-foreground/90">{intro}</p>}
      {steps.length > 0 && (
        <ol className="list-decimal list-outside ml-4 space-y-1.5 text-sm text-muted-foreground">
          {steps.map((step, i) => (
            <li key={i} className="pl-1 leading-snug">
              {step}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

interface AgentRow {
  id: string
  name?: string
  displayName?: string
  tier?: string
  enabled?: boolean
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
  mcp: Plug,
  webchat: Globe,
}

function statusLabel(ch: ChannelItem): string {
  if (ch.connected || ch.status === 'connected') return t('communication.channels.statusConnected')
  if (ch.status === 'error') return t('communication.channels.statusError')
  if (ch.status === 'configured' || ch.configured) return t('communication.channels.statusConfigured')
  return t('communication.channels.statusNotConfigured')
}

function statusDot(ch: ChannelItem): string {
  if (ch.connected || ch.status === 'connected') return 'bg-emerald-500'
  if (ch.status === 'error') return 'bg-red-500'
  if (ch.status === 'configured' || ch.configured) return 'bg-amber-500'
  return 'bg-muted-foreground/40'
}

export default function ChannelsPage() {
  const { data, isLoading, error, refetch } = useApi<{ channels: ChannelItem[] }>(
    '/communication/channels',
  )
  const templatesApi = useApi<{ templates: ChannelTemplate[] }>('/communication/channel-templates')
  const agentsApi = useApi<{ agents: AgentRow[] }>('/agents')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [secretDrafts, setSecretDrafts] = useState<Record<string, Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addTemplateId, setAddTemplateId] = useState('')
  const [addName, setAddName] = useState('')
  const [addAgentId, setAddAgentId] = useState('')
  const [addSecrets, setAddSecrets] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  const channels = data?.channels ?? []
  const templates = templatesApi.data?.templates ?? []
  const agents = useMemo(
    () => (agentsApi.data?.agents ?? []).filter((a) => a.enabled !== false),
    [agentsApi.data],
  )

  const selectedTemplate = templates.find((x) => x.id === addTemplateId)

  /** Prefer template matching this instance, else first template of same type. */
  const templateForChannel = useCallback(
    (ch: ChannelItem): ChannelTemplate | undefined => {
      if (ch.templateId) {
        const byId = templates.find((x) => x.id === ch.templateId)
        if (byId) return byId
      }
      return templates.find((x) => x.id === ch.id) ?? templates.find((x) => x.type === ch.type)
    },
    [templates],
  )

  const openAddFor = useCallback(
    (ch: ChannelItem) => {
      const tpl = templateForChannel(ch)
      const tid = tpl?.id ?? ch.templateId ?? ch.id
      setAddTemplateId(tid)
      setAddSecrets({})
      const base = tpl?.name ?? ch.name
      const siblings = channels.filter((c) => c.type === ch.type).length
      setAddName(`${base} ${siblings + 1}`)
      setAddAgentId('')
      setShowAdd(true)
      // Scroll to the add form
      requestAnimationFrame(() => {
        document.getElementById('channel-add-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [templateForChannel, channels],
  )

  const setDraft = useCallback((channelId: string, secretName: string, value: string) => {
    setSecretDrafts((prev) => ({
      ...prev,
      [channelId]: { ...(prev[channelId] ?? {}), [secretName]: value },
    }))
  }, [])

  const handleSave = useCallback(
    async (ch: ChannelItem) => {
      setSavingId(ch.id)
      setFormError(null)
      try {
        const drafts = secretDrafts[ch.id] ?? {}
        const secrets: Record<string, string> = {}
        for (const [k, v] of Object.entries(drafts)) {
          if (v.trim()) secrets[k] = v.trim()
        }
        await api.post(`/communication/channels/${ch.id}/configure`, {
          secrets: Object.keys(secrets).length ? secrets : undefined,
          agentId: ch.agentId ?? undefined,
          mode: ch.mode ?? 'managed',
          reconnect: true,
          bindPrimaryIfUnbound: true,
        })
        setSecretDrafts((prev) => {
          const next = { ...prev }
          delete next[ch.id]
          return next
        })
        await refetch()
      } catch (err: any) {
        setFormError(err?.message ?? String(err))
      } finally {
        setSavingId(null)
      }
    },
    [secretDrafts, refetch],
  )

  const handleReconnect = useCallback(
    async (id: string) => {
      setSavingId(id)
      setFormError(null)
      try {
        await api.post(`/communication/channels/${id}/reconnect`, {})
        await refetch()
      } catch (err: any) {
        setFormError(err?.message ?? String(err))
      } finally {
        setSavingId(null)
      }
    },
    [refetch],
  )

  const handleDelete = useCallback(
    async (ch: ChannelItem) => {
      if (ch.isDefault) return
      if (!confirm(t('communication.channels.deleteConfirm', { name: ch.name }))) return
      setFormError(null)
      try {
        await api.delete(`/communication/channels/${ch.id}`)
        if (expandedId === ch.id) setExpandedId(null)
        await refetch()
      } catch (err: any) {
        setFormError(err?.message ?? String(err))
      }
    },
    [expandedId, refetch],
  )

  const handleAdd = useCallback(async () => {
    if (!addTemplateId || !addName.trim()) return
    setAdding(true)
    setFormError(null)
    try {
      const secrets: Record<string, string> = {}
      for (const [k, v] of Object.entries(addSecrets)) {
        if (v.trim()) secrets[k] = v.trim()
      }
      const res = await api.post<{ channel: ChannelItem }>('/communication/channels', {
        templateId: addTemplateId,
        name: addName.trim(),
        agentId: addAgentId || undefined,
        secrets: Object.keys(secrets).length ? secrets : undefined,
      })
      setShowAdd(false)
      setAddTemplateId('')
      setAddName('')
      setAddAgentId('')
      setAddSecrets({})
      await refetch()
      if (res?.channel?.id) setExpandedId(res.channel.id)
    } catch (err: any) {
      setFormError(err?.message ?? String(err))
    } finally {
      setAdding(false)
    }
  }, [addTemplateId, addName, addAgentId, addSecrets, refetch])

  const patchBinding = useCallback(
    async (id: string, patch: { agentId?: string | null; mode?: 'managed' | 'autonomous' }) => {
      setFormError(null)
      try {
        await api.patch(`/channels/${id}`, patch)
        await refetch()
      } catch (err: any) {
        setFormError(err?.message ?? String(err))
      }
    },
    [refetch],
  )

  const handleTest = useCallback(async (id: string) => {
    setTestingId(id)
    setFormError(null)
    try {
      await api.post(`/communication/channels/${id}/test`, {})
    } catch (err: any) {
      setFormError(err?.message ?? String(err))
    } finally {
      setTestingId(null)
    }
  }, [])

  const connectedCount = channels.filter((c) => c.connected).length
  const boundCount = channels.filter((c) => c.connected && c.agentId).length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {t('communication.channels.subtitle')}
        </p>
        <div className="flex items-center gap-2">
          {channels.length > 0 && (
            <span className="text-xs text-muted-foreground">
              <strong className="text-foreground">
                {connectedCount}/{channels.length}
              </strong>{' '}
              {t('communication.channels.connected')}
              {boundCount > 0 && (
                <>
                  {' · '}
                  <strong className="text-foreground">{boundCount}</strong>{' '}
                  {t('communication.channels.bound')}
                </>
              )}
            </span>
          )}
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('communication.channels.addInstance')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t('communication.channels.setupHint')}
      </p>
      <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/10 px-3 py-2.5 mb-5 text-xs text-foreground/90">
        <strong className="font-medium">{t('communication.channels.multiInstanceTitle')}</strong>
        {' — '}
        {t('communication.channels.multiInstanceHint')}
        {' '}
        <button
          type="button"
          className="text-indigo-400 hover:underline font-medium"
          onClick={() => setShowAdd(true)}
        >
          {t('communication.channels.addInstance')}
        </button>
        {' · '}
        {t('communication.channels.orPerCard')}
      </div>

      {formError && (
        <p className="text-sm text-destructive mb-3">{formError}</p>
      )}

      {showAdd && (
        <div id="channel-add-form" className="glass-card p-4 mb-4 border border-indigo-500/30">
          <h3 className="text-sm font-semibold mb-3">{t('communication.channels.addTitle')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">{t('communication.channels.templateLabel')}</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={addTemplateId}
                onChange={(e) => {
                  setAddTemplateId(e.target.value)
                  setAddSecrets({})
                  const tpl = templates.find((x) => x.id === e.target.value)
                  if (tpl && !addName) setAddName(`${tpl.name} 2`)
                }}
              >
                <option value="">{t('communication.channels.templatePick')}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">{t('communication.channels.instanceName')}</Label>
              <Input
                className="mt-1 h-9 text-sm"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={t('communication.channels.instanceNamePlaceholder')}
              />
            </div>
            <div>
              <Label className="text-xs">{t('communication.channels.agentLabel')}</Label>
              <select
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={addAgentId}
                onChange={(e) => setAddAgentId(e.target.value)}
              >
                <option value="">{t('communication.channels.agentPrimaryDefault')}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.displayName || a.name || a.id) +
                      (a.tier === 'primary' ? ` (${t('communication.channels.primary')})` : '')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedTemplate && (
            <div className="mt-3 space-y-3">
              <SetupGuideBlock
                templateId={selectedTemplate.id}
                apiIntro={selectedTemplate.setupIntro}
                apiSteps={selectedTemplate.setupSteps}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {selectedTemplate.secrets.map((s) => (
                  <div key={s.name}>
                    <Label className="text-xs">
                      {fieldLabel(s.name, s.label)}
                      {s.required ? ' *' : ''}
                    </Label>
                    <Input
                      type={s.sensitive !== false ? 'password' : 'text'}
                      className="mt-1 h-9 text-sm font-mono"
                      placeholder={
                        fieldPlaceholder(s.name, s.placeholder) ||
                        fieldHint(s.name, s.hint) ||
                        ''
                      }
                      value={addSecrets[s.name] ?? ''}
                      onChange={(e) =>
                        setAddSecrets((prev) => ({ ...prev, [s.name]: e.target.value }))
                      }
                      autoComplete="off"
                    />
                    {(fieldHint(s.name, s.hint) || s.hint) && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {fieldHint(s.name, s.hint)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={adding || !addTemplateId || !addName.trim()} onClick={handleAdd}>
              {adding ? t('communication.channels.saving') : t('communication.channels.createInstance')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
              {t('communication.channels.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {channels.map((channel) => {
          const expanded = expandedId === channel.id
          const Icon = typeIcons[channel.type] ?? MessageSquare
          const agentLabel = agents.find((a) => a.id === channel.agentId)

          return (
            <div key={channel.id} className="glass-card p-4">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon className="h-5 w-5 text-indigo-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{channel.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {channel.type}
                    </Badge>
                    {!channel.isDefault && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('communication.channels.extraInstance')}
                      </Badge>
                    )}
                    <span className={`h-2 w-2 rounded-full ${statusDot(channel)}`} />
                    <span className="text-[10px] text-muted-foreground">
                      {statusLabel(channel)}
                    </span>
                    {channel.supportsPairing && (
                      <Badge variant="secondary" className="text-[10px]">
                        {t('communication.channels.pairingBadge')}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {channel.description ?? channel.id}
                    <span className="font-mono ml-2 opacity-70">{channel.id}</span>
                  </p>
                  {channel.agentId && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t('communication.channels.boundTo')}:{' '}
                      <span className="text-foreground">
                        {agentLabel?.displayName || agentLabel?.name || channel.agentId.slice(0, 8)}
                      </span>
                    </p>
                  )}
                  {(channel.lastError || channel.health?.lastError) && (
                    <p className="text-[11px] text-destructive mt-0.5">
                      {channel.lastError ?? channel.health?.lastError}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openAddFor(channel)}
                    title={t('communication.channels.addAnotherTip', { type: channel.type })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('communication.channels.addAnother', { type: channel.type })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patchBinding(channel.id, {
                        mode: channel.mode === 'autonomous' ? 'managed' : 'autonomous',
                      })
                    }
                    className={channel.mode === 'autonomous' ? 'text-amber-400' : ''}
                  >
                    {channel.mode === 'autonomous' ? (
                      <Bot className="h-3.5 w-3.5 mr-1" />
                    ) : (
                      <Shield className="h-3.5 w-3.5 mr-1" />
                    )}
                    {channel.mode === 'autonomous'
                      ? t('communication.channels.mode.autonomous')
                      : t('communication.channels.mode.managed')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest(channel.id)}
                    disabled={!channel.connected || testingId === channel.id}
                  >
                    <Send className="h-3.5 w-3.5 mr-1" />
                    {testingId === channel.id
                      ? t('communication.channels.sending')
                      : t('communication.channels.test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedId(expanded ? null : channel.id)}
                  >
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5 mr-1" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 mr-1" />
                    )}
                    {t('communication.channels.configure')}
                  </Button>
                </div>
              </div>

              {expanded && (
                <div className="mt-4 border-t border-[var(--vibrancy-border)] pt-4 flex flex-col gap-4">
                  <SetupGuideBlock
                    templateId={channel.templateId ?? channel.id}
                    apiIntro={channel.setupIntro}
                    apiSteps={channel.setupSteps}
                  />

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">{t('communication.channels.agentLabel')}</Label>
                      <select
                        className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={channel.agentId ?? ''}
                        onChange={(e) =>
                          patchBinding(channel.id, {
                            agentId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{t('communication.channels.agentNone')}</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {(a.displayName || a.name || a.id) +
                              (a.tier === 'primary' ? ` (${t('communication.channels.primary')})` : '')}
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {t('communication.channels.agentHint')}
                      </p>
                    </div>
                    <div className="flex flex-col justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingId === channel.id}
                        onClick={() => handleReconnect(channel.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        {t('communication.channels.reconnect')}
                      </Button>
                      {!channel.isDefault && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => handleDelete(channel)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          {t('communication.channels.deleteInstance')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {channel.secrets && channel.secrets.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        {t('communication.channels.secretsLabel')}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {channel.secrets.map((s) => (
                          <div key={s.name}>
                            <Label className="text-xs">
                              {fieldLabel(s.name, s.label)}
                              {s.required ? ' *' : ''}
                              {s.present && (
                                <span className="ml-1 text-emerald-500 font-normal">
                                  ({t('communication.channels.secretPresent')})
                                </span>
                              )}
                            </Label>
                            <Input
                              type={s.sensitive !== false ? 'password' : 'text'}
                              className="mt-1 h-9 text-sm"
                              placeholder={
                                s.present
                                  ? t('communication.channels.secretPlaceholderKeep')
                                  : fieldPlaceholder(s.name, s.placeholder) ||
                                    fieldHint(s.name, s.hint) ||
                                    ''
                              }
                              value={secretDrafts[channel.id]?.[s.name] ?? ''}
                              onChange={(e) => setDraft(channel.id, s.name, e.target.value)}
                              autoComplete="off"
                            />
                            {(fieldHint(s.name, s.hint) || s.hint) && (
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {fieldHint(s.name, s.hint)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        className="mt-3"
                        disabled={savingId === channel.id}
                        onClick={() => handleSave(channel)}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        {savingId === channel.id
                          ? t('communication.channels.saving')
                          : t('communication.channels.saveAndConnect')}
                      </Button>
                    </div>
                  )}

                  {channel.webhookPaths && channel.webhookPaths.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        {t('communication.channels.webhooksLabel')}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {channel.webhookPaths.map((p) => (
                          <li key={p} className="text-xs font-mono text-muted-foreground">
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {channel.dependencyNote && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {channel.dependencyNote}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {isLoading && channels.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('communication.channels.loading')}</p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-4">
          {t('communication.channels.loadError', { error: error.message })}
        </p>
      )}
      {!isLoading && !error && channels.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4 text-center">
          {t('communication.channels.empty')}
        </p>
      )}
    </div>
  )
}
