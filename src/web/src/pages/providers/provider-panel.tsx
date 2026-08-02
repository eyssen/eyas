import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Info, X } from 'lucide-react'
import { api } from '@/lib/api'
import { ApiKeySection } from './provider-api-key-section'
import { ModelsSection } from './provider-models-section'
import { t } from './i18n'

interface ProviderDetail {
  id: string
  name: string
  enabled: boolean
  active: boolean
  hasApiKey: boolean | null
  settings?: Record<string, unknown>
  models: Array<{
    id: string
    modelId: string
    name: string
    enabled: boolean
    contextWindow: number | null
    maxOutputTokens: number | null
    supportsTools: boolean
    supportsImages: boolean
    supportsStreaming: boolean
  }>
}

interface ProviderPanelProps {
  providerId: string | null
  onClose: () => void
  onRefresh: () => void
}

export function ProviderPanel({ providerId, onClose, onRefresh }: ProviderPanelProps) {
  const { data, refetch } = useApi<ProviderDetail>(
    providerId ? `/model/providers/${providerId}` : ''
  )

  useEffect(() => {
    if (!providerId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [providerId, onClose])

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    if (!providerId) return
    await api.patch(`/model/providers/${providerId}`, { enabled })
    refetch()
    onRefresh()
  }, [providerId, refetch, onRefresh])

  const handleSettingChange = useCallback(async (key: string, value: unknown) => {
    if (!providerId || !data) return
    const currentSettings = data.settings ?? {}
    await api.patch(`/model/providers/${providerId}`, {
      settings: { ...currentSettings, [key]: value },
    })
    // Reload provider so the setting takes effect immediately
    await api.post(`/model/providers/${providerId}/reload`, {})
    refetch()
    onRefresh()
  }, [providerId, data, refetch, onRefresh])

  const handleKeyOrModelsChanged = useCallback(() => {
    refetch()
    onRefresh()
  }, [refetch, onRefresh])

  if (!providerId) return null

  const detail = data
  const isClaudeCode = providerId === 'claude-code'
  const isGrokCli = providerId === 'grok-cli'
  const isKimiCli = providerId === 'kimi-cli'
  const isCli = isClaudeCode || isGrokCli || isKimiCli
  const loadClaudeMd = detail?.settings?.loadClaudeMd !== false
  const cliBinary = isGrokCli ? 'grok' : isKimiCli ? 'kimi' : 'claude'
  const panelTitle =
    detail?.name && detail.name !== providerId
      ? detail.name
      : (
          {
            anthropic: 'Anthropic',
            openai: 'OpenAI',
            openrouter: 'OpenRouter',
            gemini: 'Gemini',
            kimi: 'Kimi',
            'claude-code': 'Claude Code CLI',
            'grok-cli': 'Grok CLI',
            'kimi-cli': 'Kimi Code CLI',
            ollama: 'Ollama',
            lmstudio: 'LM Studio',
          } as Record<string, string>
        )[providerId] ?? detail?.name ?? providerId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[560px] max-h-[85vh] bg-background border rounded-xl shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{panelTitle}</h2>
            {detail?.active ? (
              <Badge variant="secondary" className="text-emerald-500 text-[10px]">{t('providers.panel.active')}</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-[10px]">{t('common.inactive')}</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={detail?.enabled ?? false}
              onCheckedChange={handleToggleEnabled}
            />
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {!isCli && detail && (
            <ApiKeySection
              providerId={providerId}
              hasApiKey={detail.hasApiKey}
              onKeyChanged={handleKeyOrModelsChanged}
            />
          )}

          {isCli && (
            <div className="space-y-4">
              <div className="space-y-1">
                <span className="text-sm font-medium">{t('providers.panel.authentication')}</span>
                <p className="text-xs text-muted-foreground">
                  {isGrokCli
                    ? t('providers.panel.cliAuthDescPre.grok')
                    : isKimiCli
                      ? t('providers.panel.cliAuthDescPre.kimi')
                      : t('providers.panel.cliAuthDescPre')}{' '}
                  <code className="text-[10px]">{cliBinary}</code> {t('providers.panel.cliAuthDescPost')}
                </p>
              </div>

              {isClaudeCode && (
                <div className="rounded-lg border border-border/50 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{t('providers.panel.loadClaudeMd')}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('providers.panel.loadClaudeMdHint')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={loadClaudeMd ? 'default' : 'outline'}
                      className="h-7 text-xs shrink-0 min-w-[48px]"
                      onClick={() => handleSettingChange('loadClaudeMd', !loadClaudeMd)}
                    >
                      {loadClaudeMd ? t('providers.panel.on') : t('providers.panel.off')}
                    </Button>
                  </div>

                  {loadClaudeMd && (
                    <div className="flex gap-2 p-2 rounded-md bg-amber-500/5 border border-amber-500/20">
                      <Info className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-500/90 leading-relaxed">
                        {t('providers.panel.claudeMdWarning')}
                        <code className="block mt-1.5 text-[10px] bg-background/50 rounded px-2 py-1 text-muted-foreground">
                          In EYAS conversations, use the propose_team tool for team proposals.
                        </code>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {isGrokCli && (
                <p className="text-xs text-muted-foreground">
                  {t('providers.panel.grokAcpHint')}
                </p>
              )}

              {isKimiCli && (
                <p className="text-xs text-muted-foreground">
                  {t('providers.panel.kimiAcpHint')}
                </p>
              )}
            </div>
          )}

          <div className="border-t" />

          {detail && (
            <ModelsSection
              providerId={providerId}
              models={detail.models}
              onModelsChanged={handleKeyOrModelsChanged}
            />
          )}
        </div>
      </div>
    </div>
  )
}
