// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { t } from './i18n'

interface ProviderItem {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  modelCount: number
}

interface Props {
  onComplete: (providerId: string) => Promise<void>
  isLast: boolean
}

// Cloud providers configured with an API key stored in the secrets vault.
// Names mirror provider-api-key-section.tsx so the wizard and the post-setup
// Providers page write the exact same secret.
const KEY_SECRETS: Record<string, string> = {
  anthropic: 'anthropic-api-key',
  openai: 'openai-api-key',
  openrouter: 'openrouter-api-key',
  gemini: 'gemini-api-key',
  kimi: 'kimi-api-key',
  xai: 'xai-api-key',
  mistral: 'mistral-api-key',
  groq: 'groq-api-key',
  together: 'together-api-key',
  deepseek: 'deepseek-api-key',
  cerebras: 'cerebras-api-key',
  venice: 'venice-api-key',
  huggingface: 'huggingface-api-key',
  nvidia: 'nvidia-api-key',
  zai: 'zai-api-key',
  kilocode: 'kilocode-api-key',
  'vercel-ai-gateway': 'vercel-ai-gateway-api-key',
  qianfan: 'qianfan-api-key',
  vllm: 'vllm-api-key',
  minimax: 'minimax-api-key',
  synthetic: 'synthetic-api-key',
  xiaomi: 'xiaomi-api-key',
}

// Local providers are auto-detected at boot from their default endpoint
// (the submodules read the URL from env, not from provider_config), so the
// wizard offers a status + re-check rather than a URL editor that wouldn't
// take effect until a restart.
const LOCAL_DEFAULT_URL: Record<string, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  vllm: 'http://127.0.0.1:8000',
}

const CLI_PROVIDER_IDS = new Set(['claude-code', 'grok-cli', 'kimi-cli'])

// Fixed display order in the wizard: local CLIs first, then cloud keys, then
// local servers. Providers not in this list fall to the end, stable-sorted.
const DISPLAY_ORDER = ['claude-code', 'grok-cli', 'kimi-cli', 'anthropic', 'openai', 'openrouter', 'gemini', 'kimi', 'ollama', 'lmstudio']

function sortProviders(list: ProviderItem[]): ProviderItem[] {
  return [...list].sort((a, b) => {
    const ia = DISPLAY_ORDER.indexOf(a.id)
    const ib = DISPLAY_ORDER.indexOf(b.id)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}

function cliLabel(id: string): string {
  if (id === 'claude-code') return t('aiProvider.cliName.claude')
  if (id === 'grok-cli') return t('aiProvider.cliName.grok')
  if (id === 'kimi-cli') return t('aiProvider.cliName.kimi')
  return id
}

function cliNote(id: string): string {
  if (id === 'claude-code') return t('aiProvider.cliNote.claude')
  if (id === 'grok-cli') return t('aiProvider.cliNote.grok')
  if (id === 'kimi-cli') return t('aiProvider.cliNote.kimi')
  return ''
}

function detectedBadge(id: string): string {
  if (id === 'claude-code') return t('aiProvider.detectedBadge.claude')
  if (id === 'grok-cli') return t('aiProvider.detectedBadge.grok')
  if (id === 'kimi-cli') return t('aiProvider.detectedBadge.kimi')
  return id
}

function detectedHint(id: string): string {
  if (id === 'claude-code') return t('aiProvider.detectedHint.claude')
  if (id === 'grok-cli') return t('aiProvider.detectedHint.grok')
  if (id === 'kimi-cli') return t('aiProvider.detectedHint.kimi')
  return ''
}

export function AiProviderStep({ onComplete, isLast }: Props) {
  const [providers, setProviders] = useState<ProviderItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  // When a host CLI is already active we show a confirmation first; this flips
  // the view to the full provider chooser so the user can pick a different one.
  const [showAlternatives, setShowAlternatives] = useState(false)
  // Primary CLI when multiple host CLIs are active.
  const [primaryCli, setPrimaryCli] = useState<string | null>(null)

  const load = () => {
    setError(null)
    api.get<{ providers: ProviderItem[] }>('/model/providers')
      .then((d) => {
        const sorted = sortProviders(d.providers ?? [])
        setProviders(sorted)
        const activeCli = sorted.filter((p) => CLI_PROVIDER_IDS.has(p.id) && p.active)
        if (activeCli.length === 1) setPrimaryCli(activeCli[0].id)
        else if (activeCli.length > 1 && !primaryCli) {
          // Prefer Claude as the pre-selected primary (stable default); user can switch.
          setPrimaryCli(activeCli.find((p) => p.id === 'claude-code')?.id ?? activeCli[0].id)
        }
      })
      .catch((e: any) => setError(e?.message || t('aiProvider.loadFailed')))
  }
  useEffect(load, [])

  const activeCliProviders = providers?.filter((p) => CLI_PROVIDER_IDS.has(p.id) && p.active) ?? []
  const singleCli = activeCliProviders.length === 1 ? activeCliProviders[0] : null
  const multiCli = activeCliProviders.length >= 2

  const saveKey = async (id: string) => {
    if (!apiKey.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/secrets', { name: KEY_SECRETS[id], scope: 'system', value: apiKey.trim() })
      await api.patch(`/model/providers/${id}`, { enabled: true })
      await api.post(`/model/providers/${id}/reload`, {})
      setApiKey('')
      setExpanded(null)
      load()
    } catch (e: any) {
      setError(e?.message || t('aiProvider.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const recheckLocal = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/model/providers/${id}`, { enabled: true })
      await api.post(`/model/providers/${id}/reload`, {})
      load()
    } catch (e: any) {
      setError(e?.message || t('aiProvider.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const finishStep = async (providerId?: string) => {
    setBusy(true)
    setError(null)
    try {
      const active = providers?.find((p) => p.active)
      const chosen =
        providerId ??
        (multiCli ? primaryCli : null) ??
        singleCli?.id ??
        active?.id ??
        ''
      await onComplete(chosen)
    } catch (e: any) {
      setError(e?.message || t('aiProvider.saveFailed'))
      setBusy(false)
    }
  }

  if (!providers && error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error}</p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={load}>{t('aiProvider.retry')}</Button>
        </div>
      </div>
    )
  }
  if (!providers) return <div className="text-sm text-muted-foreground">{t('aiProvider.loading')}</div>

  const continueLabel = busy ? t('aiProvider.pleaseWait') : isLast ? t('aiProvider.complete') : t('aiProvider.continue')

  // ─── Multi CLI: several detected — pick primary ─────────────────────────
  if (multiCli && !showAlternatives) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('aiProvider.title')}</h2>
        </div>
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 text-base leading-none">●</span>
            <span className="text-sm font-medium">{t('aiProvider.dualDetectedBadge')}</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6">{t('aiProvider.dualDetectedHint')}</p>
          <ul className="pl-6 space-y-1">
            {activeCliProviders.map((p) => (
              <li key={p.id} className="text-xs text-muted-foreground flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                  {cliLabel(p.id)}
                </Badge>
                <span>{t('aiProvider.models', { count: p.modelCount })}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('aiProvider.primaryTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('aiProvider.primaryHint')}</p>
          <div className="space-y-2">
            {activeCliProviders.map((p) => {
              const selected = primaryCli === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPrimaryCli(p.id)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    selected ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-3.5 w-3.5 rounded-full border flex items-center justify-center ${
                        selected ? 'border-primary' : 'border-muted-foreground/40'
                      }`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span className="text-sm font-medium">{cliLabel(p.id)}</span>
                    {selected && (
                      <Badge variant="secondary" className="text-[9px]">{t('aiProvider.primaryBadge')}</Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 pl-5">
                    {cliNote(p.id)}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAlternatives(true)}>
            {t('aiProvider.useAnother')}
          </Button>
          <Button onClick={() => finishStep(primaryCli ?? undefined)} disabled={busy || !primaryCli}>
            {continueLabel}
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  // ─── Single CLI detected + configured confirmation ──────────────────────
  if (singleCli && !showAlternatives) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('aiProvider.title')}</h2>
        </div>
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 text-base leading-none">●</span>
            <span className="text-sm font-medium">
              {detectedBadge(singleCli.id)}
            </span>
            <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
              {t('aiProvider.models', { count: singleCli.modelCount })}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground pl-6">
            {detectedHint(singleCli.id)}
          </p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAlternatives(true)}>
            {t('aiProvider.useAnother')}
          </Button>
          <Button onClick={() => finishStep(singleCli.id)} disabled={busy}>{continueLabel}</Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    )
  }

  // ─── Provider chooser ───────────────────────────────────────────────────
  const anyActive = providers.some((p) => p.active)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('aiProvider.chooseTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('aiProvider.chooseHint')}</p>
      </div>

      {(singleCli || multiCli) && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setShowAlternatives(false)}>
          ← {t('aiProvider.backToDetected')}
        </Button>
      )}

      <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
        {providers.map((p) => {
          const isKey = p.id in KEY_SECRETS
          const isLocal = p.id in LOCAL_DEFAULT_URL
          const isCli = CLI_PROVIDER_IDS.has(p.id)
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-3 transition-colors ${
                p.active ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border/50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{p.name}</span>
                    {p.active ? (
                      <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">{t('aiProvider.active')}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">{t('aiProvider.inactive')}</Badge>
                    )}
                  </div>
                  {isCli && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {cliNote(p.id)}
                    </p>
                  )}
                  {isLocal && !p.active && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {t('aiProvider.localHint', { url: LOCAL_DEFAULT_URL[p.id] })}
                    </p>
                  )}
                </div>

                {isKey && (
                  <Button
                    size="sm"
                    variant={p.active ? 'outline' : 'default'}
                    className="h-7 text-xs shrink-0"
                    onClick={() => { setExpanded(expanded === p.id ? null : p.id); setApiKey('') }}
                  >
                    {p.hasApiKey ? t('aiProvider.changeKey') : t('aiProvider.configure')}
                  </Button>
                )}
                {isLocal && (
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" disabled={busy} onClick={() => recheckLocal(p.id)}>
                    {t('aiProvider.recheck')}
                  </Button>
                )}
              </div>

              {isKey && expanded === p.id && (
                <div className="mt-3 flex gap-2">
                  <Input
                    type="password"
                    autoFocus
                    placeholder={t('aiProvider.apiKeyPlaceholder')}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="flex-1 h-8"
                    onKeyDown={(e) => { if (e.key === 'Enter') saveKey(p.id) }}
                  />
                  <Button size="sm" className="h-8" disabled={busy || !apiKey.trim()} onClick={() => saveKey(p.id)}>
                    {busy ? t('aiProvider.pleaseWait') : t('aiProvider.save')}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!anyActive && <p className="text-[11px] text-amber-500">{t('aiProvider.noneActiveNote')}</p>}

      <div className="flex justify-end pt-2">
        <Button onClick={() => finishStep()} disabled={busy}>{continueLabel}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
