// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The privacy policy editor: on/off, an action per built-in type, custom
// patterns, the hosts that count as local, and the audit switch. Saving
// replaces the whole policy (PUT /privacy/policy); from then on the policy is
// managed here and privacy.yaml is ignored. The server validates everything
// (unsafe regexes, hosts, limits) and its issues are shown at their fields.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Info, Lock, Plus, RotateCcw, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t, typeHint, typeLabel } from './i18n'
import {
  PRIVACY_ACTIONS,
  addLocalHost,
  formToPolicy,
  isDirty,
  isPrivacyAction,
  newRowKey,
  parsePolicyIssues,
  parsePolicyResponse,
  policyToForm,
  splitIssues,
  type CustomPatternRow,
  type PolicyForm,
  type PolicyResponse,
  type PrivacyAction,
  type SplitIssues,
} from './policy-form'

interface Props {
  response: PolicyResponse
  onSaved(next: PolicyResponse): void
  onDirtyChange?(dirty: boolean): void
}

const NO_ISSUES: SplitIssues = { fields: {}, general: [] }

function ActionSelect({
  value,
  disabled,
  label,
  invalid,
  onChange,
}: {
  value: PrivacyAction
  disabled: boolean
  label: string
  invalid?: boolean
  onChange(next: PrivacyAction): void
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => isPrivacyAction(v) && onChange(v)}>
      <SelectTrigger size="sm" className="w-32" aria-label={label} aria-invalid={invalid || undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIVACY_ACTIONS.map((action) => (
          <SelectItem key={action} value={action}>
            {t(`privacy.action.${action}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FieldError({ k }: { k?: string }) {
  if (!k) return null
  return <p className="text-[11px] text-destructive mt-1">{t(k)}</p>
}

export function PolicyEditor({ response, onSaved, onDirtyChange }: Props) {
  const baseline = useMemo(() => policyToForm(response.policy, response.builtinTypes), [response])
  const [form, setForm] = useState<PolicyForm>(baseline)
  const [issues, setIssues] = useState<SplitIssues>(NO_ISSUES)
  const [hostInput, setHostInput] = useState('')
  const [hostError, setHostError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const readOnly = !response.canManage
  const dirty = isDirty(form, baseline)
  const { limits } = response

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const update = (patch: Partial<PolicyForm>) => setForm((f) => ({ ...f, ...patch }))
  const setAction = (type: string, action: PrivacyAction) => setForm((f) => ({ ...f, actions: { ...f.actions, [type]: action } }))
  const setPattern = (key: string, patch: Partial<CustomPatternRow>) =>
    setForm((f) => ({ ...f, customPatterns: f.customPatterns.map((p) => (p.key === key ? { ...p, ...patch } : p)) }))

  const addPattern = () =>
    setForm((f) => ({
      ...f,
      customPatterns: [...f.customPatterns, { key: newRowKey(), name: '', regex: '', type: '', action: 'mask' }],
    }))

  const removePattern = (key: string) => {
    setForm((f) => ({ ...f, customPatterns: f.customPatterns.filter((p) => p.key !== key) }))
    // Row indexes shift: the old per-row errors no longer point at the right rows.
    setIssues(NO_ISSUES)
  }

  const addHost = () => {
    const result = addLocalHost(form.localHosts, hostInput, limits.localHosts)
    if (!result.ok) {
      setHostError(
        result.reason === 'invalid' ? 'privacy.localHosts.invalid'
          : result.reason === 'tooMany' ? 'privacy.error.tooMany'
          : null,
      )
      if (result.reason === 'duplicate') setHostInput('')
      return
    }
    update({ localHosts: result.hosts })
    setHostInput('')
    setHostError(null)
  }

  const removeHost = (host: string) => {
    update({ localHosts: form.localHosts.filter((h) => h !== host) })
    setIssues(NO_ISSUES)
  }

  const discard = () => {
    setForm(policyToForm(response.policy, response.builtinTypes))
    setIssues(NO_ISSUES)
    setHostInput('')
    setHostError(null)
  }

  const save = async () => {
    setSaving(true)
    try {
      const raw = await api.put<unknown>('/privacy/policy', formToPolicy(form))
      const next = parsePolicyResponse(raw)
      setIssues(NO_ISSUES)
      toast.success(t('privacy.policy.saved'))
      if (next) onSaved(next)
    } catch (err) {
      const found = err instanceof ApiError && err.status === 400 ? parsePolicyIssues(err.details) : []
      setIssues(found.length > 0 ? splitIssues(found) : NO_ISSUES)
      toast.error(t('privacy.policy.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const disabled = readOnly || saving
  const sourceKey = `privacy.policy.source.${response.source}`

  return (
    <div className="glass-card p-4 mb-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('privacy.policy.title')}</span>
            <Badge variant="outline" className="text-[10px]">
              {t('privacy.policy.version', { version: response.version })}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t('privacy.policy.subtitle')}</p>
        </div>
      </div>

      {/* Where the policy comes from */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>{t(sourceKey)}</span>
      </div>
      {response.seedError && response.source !== 'ui' && (
        <div className="flex items-start gap-2 text-xs rounded-md border border-destructive/40 p-2" role="alert">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
          <span className="break-all">{t('privacy.policy.seedError', { error: response.seedError })}</span>
        </div>
      )}
      {readOnly && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{t('privacy.policy.readOnly')}</span>
        </div>
      )}
      {issues.general.length > 0 && (
        <div className="space-y-1" role="alert">
          {issues.general.map((k) => (
            <p key={k} className="text-xs text-destructive">{t(k)}</p>
          ))}
        </div>
      )}

      {/* Switches */}
      <div className="space-y-3">
        <label className="flex items-start gap-3">
          <Switch checked={form.enabled} disabled={disabled} onCheckedChange={(v) => update({ enabled: v })} className="mt-0.5" />
          <span>
            <span className="text-sm">{t('privacy.policy.enabled')}</span>
            <span className="block text-xs text-muted-foreground">{t('privacy.policy.enabledHint')}</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <Switch checked={form.audit} disabled={disabled} onCheckedChange={(v) => update({ audit: v })} className="mt-0.5" />
          <span>
            <span className="text-sm">{t('privacy.audit.label')}</span>
            <span className="block text-xs text-muted-foreground">{t('privacy.audit.hint')}</span>
          </span>
        </label>
      </div>

      {/* Actions per type */}
      <div>
        <div className="section-label mb-2">{t('privacy.types.title')}</div>
        <dl className="grid gap-1 mb-3 text-xs">
          {PRIVACY_ACTIONS.map((action) => (
            <div key={action} className="flex gap-2">
              <dt className="font-medium min-w-16">{t(`privacy.action.${action}`)}</dt>
              <dd className="text-muted-foreground">{t(`privacy.action.${action}.hint`)}</dd>
            </div>
          ))}
        </dl>
        <div className="divide-y divide-[var(--vibrancy-border)]">
          {response.builtinTypes.map((type) => (
            <div key={type} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm">{typeLabel(type)}</div>
                {typeHint(type) && <div className="text-xs text-muted-foreground">{typeHint(type)}</div>}
                <FieldError k={issues.fields[`actions.${type}`]} />
              </div>
              <ActionSelect
                value={form.actions[type] ?? 'warn'}
                disabled={disabled}
                label={typeLabel(type)}
                invalid={!!issues.fields[`actions.${type}`]}
                onChange={(a) => setAction(type, a)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Custom patterns */}
      <div>
        <div className="section-label mb-1">{t('privacy.custom.title')}</div>
        <p className="text-xs text-muted-foreground mb-2">{t('privacy.type.custom.hint')}</p>
        {form.customPatterns.length === 0 && (
          <p className="text-xs text-muted-foreground italic mb-2">{t('privacy.custom.empty')}</p>
        )}
        <div className="space-y-2">
          {form.customPatterns.map((p, i) => {
            const err = (field: string) => issues.fields[`customPatterns.${i}.${field}`]
            return (
              <div key={p.key} className="rounded-md border border-[var(--vibrancy-border)] p-2">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-32">
                    <Input
                      value={p.name}
                      disabled={disabled}
                      placeholder={t('privacy.custom.name')}
                      aria-label={t('privacy.custom.name')}
                      aria-invalid={!!err('name') || undefined}
                      onChange={(e) => setPattern(p.key, { name: e.target.value })}
                    />
                    <FieldError k={err('name')} />
                  </div>
                  <div className="flex-[2] min-w-40">
                    <Input
                      value={p.regex}
                      disabled={disabled}
                      className="font-mono"
                      placeholder={t('privacy.custom.regex')}
                      aria-label={t('privacy.custom.regex')}
                      aria-invalid={!!err('regex') || undefined}
                      onChange={(e) => setPattern(p.key, { regex: e.target.value })}
                    />
                    <FieldError k={err('regex')} />
                  </div>
                  <div className="flex-1 min-w-28">
                    <Input
                      value={p.type}
                      disabled={disabled}
                      className="font-mono"
                      placeholder={t('privacy.custom.type')}
                      aria-label={t('privacy.custom.type')}
                      aria-invalid={!!err('type') || undefined}
                      onChange={(e) => setPattern(p.key, { type: e.target.value })}
                    />
                    <FieldError k={err('type')} />
                  </div>
                  <div>
                    <ActionSelect
                      value={p.action}
                      disabled={disabled}
                      label={t('privacy.custom.action')}
                      invalid={!!err('action')}
                      onChange={(a) => setPattern(p.key, { action: a })}
                    />
                    <FieldError k={err('action')} />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={t('privacy.custom.remove')}
                    title={t('privacy.custom.remove')}
                    onClick={() => removePattern(p.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        <FieldError k={issues.fields.customPatterns} />
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={disabled || form.customPatterns.length >= limits.customPatterns}
          onClick={addPattern}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('privacy.custom.add')}
        </Button>
      </div>

      {/* Local hosts */}
      <div>
        <div className="section-label mb-1">{t('privacy.localHosts.title')}</div>
        <p className="text-xs text-muted-foreground mb-2">{t('privacy.localHosts.hint')}</p>
        {form.localHosts.length === 0 ? (
          <p className="text-xs text-muted-foreground italic mb-2">{t('privacy.localHosts.empty')}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {form.localHosts.map((host, i) => (
              <span key={host} className="inline-flex flex-col">
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--vibrancy-border)] px-2 py-0.5 text-xs font-mono">
                  {host}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={disabled}
                    aria-label={t('privacy.localHosts.remove', { host })}
                    onClick={() => removeHost(host)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
                <FieldError k={issues.fields[`localHosts.${i}`]} />
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <Input
            value={hostInput}
            disabled={disabled}
            className="max-w-xs font-mono"
            placeholder={t('privacy.localHosts.placeholder')}
            aria-label={t('privacy.localHosts.title')}
            aria-invalid={!!hostError || undefined}
            onChange={(e) => {
              setHostInput(e.target.value)
              setHostError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addHost()
              }
            }}
          />
          <Button size="sm" variant="outline" disabled={disabled || !hostInput.trim()} onClick={addHost}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('privacy.localHosts.add')}
          </Button>
        </div>
        <FieldError k={hostError ?? issues.fields.localHosts} />
      </div>

      {/* Save */}
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {dirty && <span className="text-xs text-muted-foreground mr-auto">{t('privacy.policy.unsaved')}</span>}
          <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={discard}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {t('privacy.policy.discard')}
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {saving ? t('privacy.policy.saving') : t('privacy.policy.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
